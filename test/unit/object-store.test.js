import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ContentStore } from '../../src/object-store.js';

test('content store deduplicates exact bytes and detects later corruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'map-lab-store-'));
  try {
    const store = new ContentStore(root);
    const first = await store.putJson({ b: 2, a: 1 });
    const second = await store.putJson({ a: 1, b: 2 });
    assert.deepEqual(second, first);
    assert.deepEqual(await store.readJson(first.digest), { a: 1, b: 2 });
    await writeFile(store.objectPath(first.digest), 'changed');
    await assert.rejects(store.read(first.digest), (error) => error.code === 'artifact_corrupt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
