import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { gridGraph } from '../src/fixtures.js';
import { ContentStore } from '../src/object-store.js';
import { initializeDatabase, MapRepository, resetDatabase } from '../src/repository.js';
import { MapService } from '../src/service.js';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const side = 24;
const routeCount = 60;
const fixture = gridGraph(side, 'synthetic-benchmark-grid-24');
const root = await mkdtemp(join(tmpdir(), 'map-lab-benchmark-'));
const pool = new Pool({ connectionString: databaseUrl, max: 16 });
const owner = 'b'.repeat(64);

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function rounded(value) {
  return Number(value.toFixed(3));
}

try {
  await initializeDatabase(pool);
  await resetDatabase(pool, 'version-coherent-map-lab-reset');
  const repository = new MapRepository(pool);
  const service = new MapService(repository, new ContentStore(root));
  const version = await pool.query(`SHOW server_version`);

  const buildStarted = performance.now();
  const built = await service.build({ owner, requestKey: 'benchmark-build-001', body: fixture });
  const buildMs = performance.now() - buildStarted;
  await service.publish({ owner, requestKey: 'benchmark-publish1', expectedRevision: 0, buildId: built.body.buildId });
  const delayedEdges = fixture.graph.edges.filter((_, index) => index % 17 === 0).slice(0, 128);
  await service.activateOverlay({
    owner,
    requestKey: 'benchmark-overlay1',
    expectedRevision: 1,
    body: {
      buildGeneration: built.body.generation,
      delays: delayedEdges.map((edge, index) => ({ edgeId: edge.id, delayMillis: index % 7 })),
      activatesAfterSeconds: 0,
      ttlSeconds: 3_600,
    },
  });

  const latencies = [];
  let totalExpansions = 0;
  const routeStarted = performance.now();
  for (let index = 0; index < routeCount; index += 1) {
    const sourceRow = index % side;
    const targetRow = side - 1 - sourceRow;
    const start = performance.now();
    const routed = await service.route({
      owner,
      requestKey: `benchmark-route-${String(index).padStart(3, '0')}`,
      body: {
        sourceNodeId: `n-${sourceRow}-0`,
        targetNodeId: `n-${targetRow}-${side - 1}`,
        mode: 'drive',
        overlayPolicy: 'require_current',
        maxExpansions: 10_000,
      },
    });
    latencies.push(performance.now() - start);
    assert.equal(routed.body.result.outcome, 'route_found');
    totalExpansions += routed.body.result.expansions;
  }
  const routeMs = performance.now() - routeStarted;
  const counts = await pool.query(`
    SELECT
      (SELECT count(*) FROM map_artifacts) AS artifacts,
      (SELECT count(*) FROM route_requests) AS routes,
      (SELECT count(*) FROM traffic_overlays) AS overlays
  `);
  assert.equal(Number(counts.rows[0].routes), routeCount);

  process.stdout.write(`${JSON.stringify({
    evidence: 'bounded_benchmark_observation',
    node: process.version,
    postgresql: version.rows[0].server_version,
    fixture: {
      nodes: fixture.graph.nodes.length,
      edges: fixture.graph.edges.length,
      delayedEdges: delayedEdges.length,
      artifacts: Number(counts.rows[0].artifacts),
      overlays: Number(counts.rows[0].overlays),
      routes: routeCount,
    },
    buildMs: rounded(buildMs),
    routeOpsPerSecond: rounded(routeCount / (routeMs / 1_000)),
    routeLatencyMs: {
      p50: rounded(percentile(latencies, 0.5)),
      p95: rounded(percentile(latencies, 0.95)),
      max: rounded(Math.max(...latencies)),
    },
    totalExpansions,
    exclusions: [
      'network latency',
      'CDN and client rendering',
      'real map data and route quality',
      'multi-region replication',
      'production extrapolation',
    ],
  })}\n`);
} finally {
  await pool.end();
  await rm(root, { recursive: true, force: true });
}
