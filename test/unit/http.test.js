import assert from 'node:assert/strict';
import test from 'node:test';
import { closeServer, createHttpServer, listen } from '../../src/http.js';

const secret = 'unit-test-auth-fingerprint-secret-000000000000';
const authorization = { Authorization: 'Bearer unit-test-principal' };

function fakeService() {
  return {
    async current() {
      return { body: { stateRevision: 7, generation: null, manifestDigest: null, overlay: null, observedAt: new Date(0).toISOString() } };
    },
    async tile() {
      return {
        artifact: {
          digest: 'a'.repeat(64),
          bytes: 3,
          mediaType: 'application/vnd.map-lab.tile+json',
        },
        bytes: Buffer.from('{}\n'),
      };
    },
    async build() {
      return { created: true, body: { artifactCount: 2 } };
    },
  };
}

test('health is public while map state requires bearer authentication', async () => {
  const lines = [];
  const server = createHttpServer({ service: fakeService(), authSecret: secret, logger: (line) => lines.push(line) });
  const address = await listen(server);
  try {
    assert.equal((await fetch(`${address.origin}/healthz`)).status, 200);
    const missing = await fetch(`${address.origin}/v1/current`);
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error.code, 'unauthorized');
    const current = await fetch(`${address.origin}/v1/current`, { headers: authorization });
    assert.equal(current.status, 200);
    assert.equal(current.headers.get('cache-control'), 'private, no-store');
    assert.equal(current.headers.get('etag'), '"state-rev-7"');
  } finally {
    await closeServer(server);
  }
  assert.ok(lines.every((line) => !line.includes('unit-test-principal')));
});

test('immutable tile response has generation-safe caching and conditional 304', async () => {
  const server = createHttpServer({ service: fakeService(), authSecret: secret, logger: () => {} });
  const address = await listen(server);
  const url = `${address.origin}/v1/tiles/gen_${'b'.repeat(32)}/synthetic-v1/2/0/2`;
  try {
    const first = await fetch(url, { headers: authorization });
    assert.equal(first.status, 200);
    assert.equal(await first.text(), '{}\n');
    assert.equal(first.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(first.headers.get('etag'), `"sha256-${'a'.repeat(64)}"`);
    const conditional = await fetch(url, {
      headers: { ...authorization, 'If-None-Match': first.headers.get('etag') },
    });
    assert.equal(conditional.status, 304);
    assert.equal(await conditional.text(), '');
  } finally {
    await closeServer(server);
  }
});

test('JSON mutations reject missing content type before service execution', async () => {
  const server = createHttpServer({ service: fakeService(), authSecret: secret, logger: () => {} });
  const address = await listen(server);
  try {
    const response = await fetch(`${address.origin}/v1/builds`, {
      method: 'POST',
      headers: { ...authorization, 'Idempotency-Key': 'http-build-key1' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_request');
  } finally {
    await closeServer(server);
  }
});

test('publication requires a strong state revision precondition', async () => {
  const server = createHttpServer({ service: fakeService(), authSecret: secret, logger: () => {} });
  const address = await listen(server);
  try {
    const response = await fetch(`${address.origin}/v1/builds/00000000-0000-4000-8000-000000000000/publish`, {
      method: 'POST',
      headers: { ...authorization, 'Idempotency-Key': 'http-publish-01' },
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_request');
  } finally {
    await closeServer(server);
  }
});
