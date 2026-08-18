import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { invalid } from './errors.js';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function ownerFingerprint(token, secret) {
  return createHmac('sha256', secret).update('map-lab-owner\0').update(token).digest('hex');
}

export function constantTimeHexEqual(left, right) {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function parseStateEtag(value) {
  const match = typeof value === 'string' && /^"state-rev-(0|[1-9][0-9]{0,15})"$/.exec(value);
  if (!match) throw invalid('If-Match must be a strong state revision ETag');
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision)) throw invalid('If-Match state revision is out of range');
  return revision;
}

export const stateEtag = (revision) => `"state-rev-${revision}"`;
export const artifactEtag = (digest) => `"sha256-${digest}"`;
