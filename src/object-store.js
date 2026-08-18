import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalBytes } from './contracts.js';
import { constantTimeHexEqual, sha256 } from './crypto.js';
import { corrupted } from './errors.js';

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class ContentStore {
  constructor(root) {
    if (typeof root !== 'string' || !root.length) throw new Error('object store root is required');
    this.root = root;
  }

  objectKey(digest) {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('invalid object digest');
    return `sha256/${digest.slice(0, 2)}/${digest}`;
  }

  objectPath(digest) {
    return join(this.root, this.objectKey(digest));
  }

  async putJson(value) {
    return this.put(canonicalBytes(value));
  }

  async put(bytes) {
    const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const digest = sha256(content);
    const target = this.objectPath(digest);
    const directory = dirname(target);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    if (!(await exists(target))) {
      const temporary = join(directory, `.${digest}.${process.pid}.${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, target);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      } finally {
        await unlink(temporary).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
      }
      await syncDirectory(directory);
    }

    const readback = await readFile(target);
    const readbackDigest = sha256(readback);
    if (readback.length !== content.length || !constantTimeHexEqual(readbackDigest, digest)) throw corrupted();
    return { digest, bytes: content.length, objectKey: this.objectKey(digest) };
  }

  async read(digest) {
    const content = await readFile(this.objectPath(digest)).catch((error) => {
      if (error?.code === 'ENOENT') throw corrupted();
      throw error;
    });
    if (!constantTimeHexEqual(sha256(content), digest)) throw corrupted();
    return content;
  }

  async readJson(digest) {
    const content = await this.read(digest);
    try {
      return JSON.parse(content.toString('utf8'));
    } catch {
      throw corrupted();
    }
  }
}
