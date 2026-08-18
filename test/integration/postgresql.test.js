import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { ContentStore } from '../../src/object-store.js';
import { graphA, graphB, gridGraph, routeRequest } from '../../src/fixtures.js';
import { initializeDatabase, MapRepository, resetDatabase } from '../../src/repository.js';
import { MapService } from '../../src/service.js';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for infrastructure tests');

const owner = 'a'.repeat(64);
let pool;
let root;
let repository;
let service;

test.before(async () => {
  pool = new Pool({ connectionString: databaseUrl, max: 16 });
  await initializeDatabase(pool);
});

test.beforeEach(async () => {
  await resetDatabase(pool, 'version-coherent-map-lab-reset');
  root = await mkdtemp(join(tmpdir(), 'map-lab-infra-'));
  repository = new MapRepository(pool);
  service = new MapService(repository, new ContentStore(root));
});

test.afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test.after(async () => {
  await pool.end();
});

async function build(body, key) {
  return service.build({ owner, requestKey: key, body });
}

async function publish(buildId, expectedRevision, key) {
  return service.publish({ owner, requestKey: key, expectedRevision, buildId });
}

test('PostgreSQL is real version 17 and the current pointer starts empty', async () => {
  const version = await pool.query(`SHOW server_version`);
  assert.match(version.rows[0].server_version, /^17\./);
  const current = await service.current();
  assert.equal(current.body.stateRevision, 0);
  assert.equal(current.body.generation, null);
  assert.equal(current.body.overlay, null);
});

test('a crash after the first durable object leaves a non-current resumable build', async () => {
  const crashing = new MapService(repository, new ContentStore(root), {
    afterArtifactStored: async () => { throw new Error('controlled crash'); },
  });
  await assert.rejects(
    crashing.build({ owner, requestKey: 'build-crash-001', body: graphA }),
    /controlled crash/,
  );
  const partial = await pool.query(`SELECT * FROM map_builds`);
  assert.equal(partial.rowCount, 1);
  assert.equal(partial.rows[0].state, 'deriving');
  assert.equal((await service.current()).body.generation, null);

  const resumed = await build(graphA, 'build-crash-001');
  assert.equal(resumed.body.buildId, partial.rows[0].build_id);
  assert.equal(resumed.body.state, 'complete');
  assert.ok(resumed.body.artifactCount >= 2);
  const replay = await build(graphA, 'build-crash-001');
  assert.equal(replay.body.buildId, resumed.body.buildId);
  assert.equal(replay.body.replayed, true);
});

test('a build key binds exact normalized source intent', async () => {
  await build(graphA, 'build-intent-001');
  await assert.rejects(
    build(graphB, 'build-intent-001'),
    (error) => error.code === 'intent_conflict',
  );
});

test('publication replay is exact and changed intent conflicts', async () => {
  const built = await build(graphA, 'build-pub-0001');
  const first = await publish(built.body.buildId, 0, 'publish-key-0001');
  assert.equal(first.body.stateRevision, 1);
  assert.equal(first.body.replayed, false);
  const replay = await publish(built.body.buildId, 0, 'publish-key-0001');
  assert.deepEqual({ ...replay.body, replayed: false }, first.body);
  await assert.rejects(
    service.rollback({
      owner,
      requestKey: 'publish-key-0001',
      expectedRevision: 1,
      body: { targetBuildId: built.body.buildId },
    }),
    (error) => error.code === 'intent_conflict',
  );
});

test('two publications at one expected revision have one winner', async () => {
  const first = await build(graphA, 'build-race-0001');
  const second = await build(graphB, 'build-race-0002');
  await publish(first.body.buildId, 0, 'publish-race-0000');
  const third = await build(gridGraph(3, 'synthetic-race-third'), 'build-race-0003');
  const outcomes = await Promise.allSettled([
    publish(second.body.buildId, 1, 'publish-race-0001'),
    publish(third.body.buildId, 1, 'publish-race-0002'),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'precondition_failed');
  assert.equal((await service.current()).body.stateRevision, 2);
});

test('a route freezes graph and overlay across a later map publication', async () => {
  const first = await build(graphA, 'build-route-0001');
  await publish(first.body.buildId, 0, 'publish-route-0001');
  const overlay = await service.activateOverlay({
    owner,
    requestKey: 'overlay-route-001',
    expectedRevision: 1,
    body: {
      buildGeneration: first.body.generation,
      delays: [{ edgeId: 'alpha-bravo', delayMillis: 100 }],
      activatesAfterSeconds: 0,
      ttlSeconds: 300,
    },
  });
  assert.equal(overlay.body.stateRevision, 2);
  const routed = await service.route({
    owner,
    requestKey: 'route-frozen-001',
    body: { ...routeRequest, overlayPolicy: 'require_current' },
  });
  assert.equal(routed.body.result.totalCostMillis, 48);
  assert.equal(routed.body.snapshot.generation, first.body.generation);
  assert.equal(routed.body.snapshot.overlayResolution, 'current');

  const second = await build(graphB, 'build-route-0002');
  await publish(second.body.buildId, 2, 'publish-route-0002');
  const replay = await service.route({
    owner,
    requestKey: 'route-frozen-001',
    body: { ...routeRequest, overlayPolicy: 'require_current' },
  });
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.result.totalCostMillis, 48);
  assert.equal(replay.body.snapshot.generation, first.body.generation);

  const newRoute = await service.route({ owner, requestKey: 'route-frozen-002', body: routeRequest });
  assert.equal(newRoute.body.result.totalCostMillis, 10);
  assert.equal(newRoute.body.snapshot.generation, second.body.generation);
  assert.equal(newRoute.body.snapshot.overlayResolution, 'base_fallback');
});

test('future overlay is explicit: required fails while base fallback succeeds', async () => {
  const built = await build(graphA, 'build-future-001');
  await publish(built.body.buildId, 0, 'publish-future-01');
  await service.activateOverlay({
    owner,
    requestKey: 'overlay-future-01',
    expectedRevision: 1,
    body: {
      buildGeneration: built.body.generation,
      delays: [{ edgeId: 'alpha-bravo', delayMillis: 100 }],
      activatesAfterSeconds: 60,
      ttlSeconds: 60,
    },
  });
  await assert.rejects(
    service.route({
      owner,
      requestKey: 'route-future-001',
      body: { ...routeRequest, overlayPolicy: 'require_current' },
    }),
    (error) => error.code === 'overlay_unavailable',
  );
  const fallback = await service.route({ owner, requestKey: 'route-future-002', body: routeRequest });
  assert.equal(fallback.body.snapshot.overlayResolution, 'base_fallback');
  assert.equal(fallback.body.result.totalCostMillis, 20);
});

test('work-limit and no-route outcomes are durable receipts', async () => {
  const built = await build(graphA, 'build-outcome-01');
  await publish(built.body.buildId, 0, 'publish-outcome1');
  const limitedBody = { ...routeRequest, maxExpansions: 1 };
  const limited = await service.route({ owner, requestKey: 'route-limited-01', body: limitedBody });
  assert.equal(limited.body.result.outcome, 'work_limit');
  const replay = await service.route({ owner, requestKey: 'route-limited-01', body: limitedBody });
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.result, limited.body.result);
});

test('rollback appends a new revision and preserves immutable old tile bytes', async () => {
  const first = await build(graphA, 'build-back-0001');
  await publish(first.body.buildId, 0, 'publish-back-01');
  const coordinate = { generation: first.body.generation, style: 'synthetic-v1', zText: '2', xText: '0', yText: '2' };
  const oldBefore = await service.tile(coordinate);
  const second = await build(graphB, 'build-back-0002');
  await publish(second.body.buildId, 1, 'publish-back-02');
  const rolled = await service.rollback({
    owner,
    requestKey: 'rollback-back-01',
    expectedRevision: 2,
    body: { targetBuildId: first.body.buildId },
  });
  assert.equal(rolled.body.stateRevision, 3);
  assert.equal((await service.current()).body.generation, first.body.generation);
  const oldAfter = await service.tile(coordinate);
  assert.equal(oldAfter.artifact.digest, oldBefore.artifact.digest);
  assert.deepEqual(oldAfter.bytes, oldBefore.bytes);
});

test('overlay cannot name an unknown edge or a non-current generation', async () => {
  const first = await build(graphA, 'build-overlay-001');
  const second = await build(graphB, 'build-overlay-002');
  await publish(first.body.buildId, 0, 'publish-overlay1');
  await assert.rejects(service.activateOverlay({
    owner,
    requestKey: 'overlay-unknown-1',
    expectedRevision: 1,
    body: {
      buildGeneration: first.body.generation,
      delays: [{ edgeId: 'does-not-exist', delayMillis: 1 }],
      activatesAfterSeconds: 0,
      ttlSeconds: 60,
    },
  }), /outside its compatible graph/);
  await assert.rejects(service.activateOverlay({
    owner,
    requestKey: 'overlay-old-gen1',
    expectedRevision: 1,
    body: {
      buildGeneration: second.body.generation,
      delays: [],
      activatesAfterSeconds: 0,
      ttlSeconds: 60,
    },
  }), (error) => error.code === 'intent_conflict');
});
