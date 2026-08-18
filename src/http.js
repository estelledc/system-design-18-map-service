import { createServer } from 'node:http';
import { limits } from './contracts.js';
import { artifactEtag, ownerFingerprint, parseStateEtag, stateEtag } from './crypto.js';
import { AppError, asAppError, invalid, unauthorized } from './errors.js';

function bearerToken(header) {
  if (typeof header !== 'string') throw unauthorized();
  const match = /^Bearer ([\x21-\x7e]{8,256})$/.exec(header);
  if (!match) throw unauthorized();
  return match[1];
}

async function readJson(request) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw invalid('Content-Type must be application/json');
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limits.bodyBytes) throw invalid('request body is too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limits.bodyBytes) throw invalid('request body is too large');
    chunks.push(chunk);
  }
  if (!size) throw invalid('request body must contain JSON');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw invalid('request body must contain valid JSON');
  }
}

function assertNoQuery(url) {
  if ([...url.searchParams].length) throw invalid('query parameters are not accepted on this route');
}

function sendJson(response, status, body, headers = {}, onWritten = undefined) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(bytes, onWritten);
}

function sendArtifact(response, request, result, onWritten) {
  const etag = artifactEtag(result.artifact.digest);
  const headers = {
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    response.end(onWritten);
    return 304;
  }
  response.writeHead(200, {
    ...headers,
    'Content-Type': `${result.artifact.mediaType}; charset=utf-8`,
    'Content-Length': result.bytes.length,
  });
  response.end(result.bytes, onWritten);
  return 200;
}

function safeLog(logger, entry) {
  logger(JSON.stringify(entry));
}

function publicError(error) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

export function createHttpServer({
  service,
  authSecret,
  logger = (line) => process.stdout.write(`${line}\n`),
  crashAfterPublishCommit = false,
  crashAfterRouteCommit = false,
  killProcess = () => process.kill(process.pid, 'SIGKILL'),
}) {
  if (typeof authSecret !== 'string' || Buffer.byteLength(authSecret) < 32) {
    throw new Error('authSecret must contain at least 32 bytes');
  }

  const server = createServer(async (request, response) => {
    const started = performance.now();
    let operation = 'unknown_route';
    try {
      const url = new URL(request.url, 'http://service.invalid');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        operation = 'health';
        assertNoQuery(url);
        sendJson(response, 200, { status: 'ok' }, {}, () => safeLog(logger, {
          operation, status: 200, evidence: 'server_bytes_written', elapsedMs: Math.round(performance.now() - started),
        }));
        return;
      }

      const owner = ownerFingerprint(bearerToken(request.headers.authorization), authSecret);
      const buildMatch = /^\/v1\/builds\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(url.pathname);
      const publishMatch = /^\/v1\/builds\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/publish$/.exec(url.pathname);
      const routeMatch = /^\/v1\/routes\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(url.pathname);
      const tileMatch = /^\/v1\/tiles\/(gen_[0-9a-f]{32})\/([A-Za-z0-9._-]+)\/([0-9]+)\/([0-9]+)\/([0-9]+)$/.exec(url.pathname);
      let result;
      let status;
      let headers = {};

      if (request.method === 'POST' && url.pathname === '/v1/builds') {
        operation = 'build_map';
        assertNoQuery(url);
        result = await service.build({
          owner,
          requestKey: request.headers['idempotency-key'],
          body: await readJson(request),
        });
        status = result.created ? 201 : 200;
      } else if (request.method === 'GET' && buildMatch) {
        operation = 'get_build';
        assertNoQuery(url);
        result = await service.getBuild(buildMatch[1]);
        status = 200;
      } else if (request.method === 'POST' && publishMatch) {
        operation = 'publish_map';
        assertNoQuery(url);
        result = await service.publish({
          owner,
          requestKey: request.headers['idempotency-key'],
          expectedRevision: parseStateEtag(request.headers['if-match']),
          buildId: publishMatch[1],
        });
        status = 200;
        headers = { ETag: stateEtag(result.body.stateRevision) };
        if (crashAfterPublishCommit && !result.body.replayed) {
          safeLog(logger, { operation, status, evidence: 'publication_committed', elapsedMs: Math.round(performance.now() - started) });
          killProcess();
          return;
        }
      } else if (request.method === 'POST' && url.pathname === '/v1/rollbacks') {
        operation = 'rollback_map';
        assertNoQuery(url);
        result = await service.rollback({
          owner,
          requestKey: request.headers['idempotency-key'],
          expectedRevision: parseStateEtag(request.headers['if-match']),
          body: await readJson(request),
        });
        status = 200;
        headers = { ETag: stateEtag(result.body.stateRevision) };
      } else if (request.method === 'POST' && url.pathname === '/v1/traffic-overlays') {
        operation = 'activate_overlay';
        assertNoQuery(url);
        result = await service.activateOverlay({
          owner,
          requestKey: request.headers['idempotency-key'],
          expectedRevision: parseStateEtag(request.headers['if-match']),
          body: await readJson(request),
        });
        status = 200;
        headers = { ETag: stateEtag(result.body.stateRevision) };
      } else if (request.method === 'GET' && url.pathname === '/v1/current') {
        operation = 'get_current';
        assertNoQuery(url);
        result = await service.current();
        status = 200;
        headers = { ETag: stateEtag(result.body.stateRevision) };
      } else if (request.method === 'POST' && url.pathname === '/v1/routes') {
        operation = 'compute_route';
        assertNoQuery(url);
        result = await service.route({
          owner,
          requestKey: request.headers['idempotency-key'],
          body: await readJson(request),
        });
        status = result.created ? 201 : 200;
        if (crashAfterRouteCommit && result.body.status === 'complete' && !result.body.replayed) {
          safeLog(logger, { operation, status, evidence: 'route_computed', elapsedMs: Math.round(performance.now() - started) });
          killProcess();
          return;
        }
      } else if (request.method === 'GET' && routeMatch) {
        operation = 'get_route';
        assertNoQuery(url);
        result = await service.getRoute({ owner, routeId: routeMatch[1] });
        status = 200;
      } else if (request.method === 'GET' && tileMatch) {
        operation = 'get_immutable_tile';
        assertNoQuery(url);
        result = await service.tile({
          generation: tileMatch[1],
          style: tileMatch[2],
          zText: tileMatch[3],
          xText: tileMatch[4],
          yText: tileMatch[5],
        });
        status = sendArtifact(response, request, result, () => safeLog(logger, {
          operation,
          status,
          evidence: 'server_bytes_written',
          elapsedMs: Math.round(performance.now() - started),
        }));
        return;
      } else {
        throw new AppError('not_found', 404, 'resource not found');
      }

      const logOutcome = ['route_found', 'no_route', 'work_limit'].includes(result.body?.result?.outcome)
        ? result.body.result.outcome
        : undefined;
      const logArtifactCount = Number.isSafeInteger(result.body?.artifactCount)
        ? result.body.artifactCount
        : undefined;
      sendJson(response, status, result.body, headers, () => safeLog(logger, {
        operation,
        status,
        evidence: 'server_bytes_written',
        ...(logOutcome ? { outcome: logOutcome } : {}),
        ...(logArtifactCount === undefined ? {} : { artifactCount: logArtifactCount }),
        elapsedMs: Math.round(performance.now() - started),
      }));
    } catch (error) {
      const safe = asAppError(error);
      const headers = Number.isSafeInteger(safe.details?.stateRevision)
        ? { ETag: stateEtag(safe.details.stateRevision) }
        : {};
      sendJson(response, safe.status, publicError(safe), headers, () => safeLog(logger, {
        operation,
        status: safe.status,
        evidence: safe.code === 'precondition_failed' ? 'precondition_failed' : 'request_rejected',
        elapsedMs: Math.round(performance.now() - started),
      }));
    }
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 16_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function listen(server, { host = '127.0.0.1', port = 0 } = {}) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return { host, port: address.port, origin: `http://${host}:${address.port}` };
}

export async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
