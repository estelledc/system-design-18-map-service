import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { graphA, graphB, routeRequest } from '../src/fixtures.js';
import { initializeDatabase, resetDatabase } from '../src/repository.js';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const authToken = 'synthetic-smoke-principal';
const authSecret = 'synthetic-smoke-auth-fingerprint-secret-000000';
const objectRoot = await mkdtemp(join(tmpdir(), 'map-lab-smoke-'));
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const collectedLogs = [];

async function start(extra = {}) {
  const child = spawn(process.execPath, ['src/main.js', 'serve'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      OBJECT_STORE_ROOT: objectRoot,
      AUTH_FINGERPRINT_SECRET: authSecret,
      PORT: '0',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not become ready')), 10_000);
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        collectedLogs.push(line);
        try {
          const event = JSON.parse(line);
          if (event.operation === 'server_ready') {
            clearTimeout(timeout);
            resolve({ child, origin: `http://127.0.0.1:${event.port}` });
          }
        } catch {
          // Non-JSON output cannot satisfy readiness and is audited below.
        }
      }
    });
    child.stderr.on('data', (chunk) => collectedLogs.push(chunk.toString('utf8').trim()));
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before ready: ${code ?? signal}`));
    });
  });
  return ready;
}

async function stop(server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill('SIGTERM');
  await new Promise((resolve) => server.child.once('exit', resolve));
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once('exit', resolve));
}

async function jsonRequest(origin, path, { method = 'GET', key, ifMatch, body } = {}) {
  const headers = { Authorization: `Bearer ${authToken}` };
  if (key) headers['Idempotency-Key'] = key;
  if (ifMatch) headers['If-Match'] = ifMatch;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const parsed = await response.json();
  if (!response.ok) throw new Error(`request failed with ${response.status}: ${parsed.error?.code}`);
  return { response, body: parsed };
}

try {
  await initializeDatabase(pool);
  await resetDatabase(pool, 'version-coherent-map-lab-reset');

  const crashingBuild = await start({ CRASH_AFTER_FIRST_BUILD_ARTIFACT: '1' });
  await assert.rejects(jsonRequest(crashingBuild.origin, '/v1/builds', {
    method: 'POST', key: 'smoke-build-key-01', body: graphA,
  }));
  await waitForExit(crashingBuild.child);
  const partial = await pool.query(`SELECT build_id, state FROM map_builds`);
  assert.equal(partial.rowCount, 1);
  assert.equal(partial.rows[0].state, 'deriving');
  assert.equal((await pool.query(`SELECT current_build_id FROM map_system_state`)).rows[0].current_build_id, null);

  let server = await start();
  const resumed = await jsonRequest(server.origin, '/v1/builds', {
    method: 'POST', key: 'smoke-build-key-01', body: graphA,
  });
  assert.equal(resumed.body.buildId, partial.rows[0].build_id);
  assert.equal(resumed.body.state, 'complete');
  const second = await jsonRequest(server.origin, '/v1/builds', {
    method: 'POST', key: 'smoke-build-key-02', body: graphB,
  });
  await stop(server);

  const crashingPublish = await start({ CRASH_AFTER_PUBLISH_COMMIT: '1' });
  await assert.rejects(jsonRequest(crashingPublish.origin, `/v1/builds/${resumed.body.buildId}/publish`, {
    method: 'POST', key: 'smoke-publish-001', ifMatch: '"state-rev-0"',
  }));
  await waitForExit(crashingPublish.child);
  const publishedState = await pool.query(`SELECT state_revision, current_build_id FROM map_system_state`);
  assert.equal(Number(publishedState.rows[0].state_revision), 1);
  assert.equal(publishedState.rows[0].current_build_id, resumed.body.buildId);

  server = await start();
  const publishReplay = await jsonRequest(server.origin, `/v1/builds/${resumed.body.buildId}/publish`, {
    method: 'POST', key: 'smoke-publish-001', ifMatch: '"state-rev-0"',
  });
  assert.equal(publishReplay.body.replayed, true);
  assert.equal(publishReplay.body.stateRevision, 1);
  const overlay = await jsonRequest(server.origin, '/v1/traffic-overlays', {
    method: 'POST',
    key: 'smoke-overlay-001',
    ifMatch: '"state-rev-1"',
    body: {
      buildGeneration: resumed.body.generation,
      delays: [{ edgeId: 'alpha-bravo', delayMillis: 100 }],
      activatesAfterSeconds: 0,
      ttlSeconds: 300,
    },
  });
  assert.equal(overlay.body.stateRevision, 2);
  const oldTile = await fetch(
    `${server.origin}/v1/tiles/${resumed.body.generation}/synthetic-v1/2/0/2`,
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  assert.equal(oldTile.status, 200);
  const oldTileEtag = oldTile.headers.get('etag');
  const oldTileBytes = Buffer.from(await oldTile.arrayBuffer());
  await stop(server);

  const crashingRoute = await start({ CRASH_AFTER_ROUTE_COMMIT: '1' });
  const frozenRequest = { ...routeRequest, overlayPolicy: 'require_current' };
  await assert.rejects(jsonRequest(crashingRoute.origin, '/v1/routes', {
    method: 'POST', key: 'smoke-route-key-1', body: frozenRequest,
  }));
  await waitForExit(crashingRoute.child);
  const committedRoute = await pool.query(`SELECT status, generation, result_json FROM route_requests`);
  assert.equal(committedRoute.rowCount, 1);
  assert.equal(committedRoute.rows[0].status, 'complete');
  assert.equal(committedRoute.rows[0].generation, resumed.body.generation);
  assert.equal(committedRoute.rows[0].result_json.totalCostMillis, 48);

  server = await start();
  const publishedSecond = await jsonRequest(server.origin, `/v1/builds/${second.body.buildId}/publish`, {
    method: 'POST', key: 'smoke-publish-002', ifMatch: '"state-rev-2"',
  });
  assert.equal(publishedSecond.body.stateRevision, 3);
  const routeReplay = await jsonRequest(server.origin, '/v1/routes', {
    method: 'POST', key: 'smoke-route-key-1', body: frozenRequest,
  });
  assert.equal(routeReplay.body.replayed, true);
  assert.equal(routeReplay.body.snapshot.generation, resumed.body.generation);
  assert.equal(routeReplay.body.result.totalCostMillis, 48);
  const oldTileAgain = await fetch(
    `${server.origin}/v1/tiles/${resumed.body.generation}/synthetic-v1/2/0/2`,
    { headers: { Authorization: `Bearer ${authToken}`, 'If-None-Match': oldTileEtag } },
  );
  assert.equal(oldTileAgain.status, 304);
  assert.equal(oldTileAgain.headers.get('etag'), oldTileEtag);
  const byteReadback = await fetch(
    `${server.origin}/v1/tiles/${resumed.body.generation}/synthetic-v1/2/0/2`,
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  assert.deepEqual(Buffer.from(await byteReadback.arrayBuffer()), oldTileBytes);
  await stop(server);

  const summary = await pool.query(`
    SELECT
      (SELECT state_revision FROM map_system_state WHERE singleton = true) AS revision,
      (SELECT count(*) FROM map_builds WHERE state = 'complete') AS complete_builds,
      (SELECT count(*) FROM route_requests WHERE status = 'complete') AS complete_routes,
      (SELECT count(*) FROM map_publications) AS publications
  `);
  assert.deepEqual(
    {
      revision: Number(summary.rows[0].revision),
      completeBuilds: Number(summary.rows[0].complete_builds),
      completeRoutes: Number(summary.rows[0].complete_routes),
      publications: Number(summary.rows[0].publications),
    },
    { revision: 3, completeBuilds: 2, completeRoutes: 1, publications: 2 },
  );

  const logText = collectedLogs.join('\n');
  for (const forbidden of [authToken, 'alpha', 'bravo', 'charlie', 'delta', graphA.sourceRevision, graphB.sourceRevision]) {
    assert.equal(logText.includes(forbidden), false, `ordinary logs disclosed ${forbidden}`);
  }
  assert.equal(/[0-9a-f]{64}/.test(logText), false, 'ordinary logs disclosed a digest or fingerprint');
  process.stdout.write(`${JSON.stringify({
    evidence: 'true_process_recovery',
    buildCrashRecovered: true,
    publishResponseLossReplayed: true,
    routeResponseLossReplayed: true,
    oldArtifactStableAfterPublish: true,
    stateRevision: 3,
    completeBuilds: 2,
    completeRoutes: 1,
    publications: 2,
  })}\n`);
} finally {
  await pool.end();
  await rm(objectRoot, { recursive: true, force: true });
}
