# Operations and failure interpretation

## Local prerequisites

- Node.js 22 or newer;
- PostgreSQL 17 reachable through `DATABASE_URL`;
- a private writable local directory for `OBJECT_STORE_ROOT`;
- a synthetic bearer-fingerprint secret of at least 32 bytes.

`compose.yaml` describes the same digest-pinned PostgreSQL/PostGIS image used in CI; this lab uses PostgreSQL only and does not
enable/use PostGIS.

## Commands

```sh
npm ci --ignore-scripts
npm run check
DATABASE_URL=... npm run test:infra
DATABASE_URL=... npm run smoke:infra
DATABASE_URL=... npm run benchmark:infra
```

Run the HTTP process with:

```sh
DATABASE_URL=... \
OBJECT_STORE_ROOT=... \
AUTH_FINGERPRINT_SECRET=... \
npm start
```

Optional `HOST` defaults to `127.0.0.1`; `PORT` defaults to 3000.

## Required environment

| Variable | Purpose | Ordinary-log rule |
|---|---|---|
| `DATABASE_URL` | PostgreSQL authority | never print |
| `OBJECT_STORE_ROOT` | private content store directory | never print |
| `AUTH_FINGERPRINT_SECRET` | HMAC principal fingerprinting | never print |
| `HOST`, `PORT` | listener selection | ready log may include port only |

The following are test-only crash hooks and must not be used as production controls:

- `CRASH_AFTER_FIRST_BUILD_ARTIFACT=1` sends SIGKILL after verified graph-object write;
- `CRASH_AFTER_PUBLISH_COMMIT=1` sends SIGKILL after publication commit but before HTTP response;
- `CRASH_AFTER_ROUTE_COMMIT=1` sends SIGKILL after route receipt commit but before HTTP response.

## Failure matrix

| Observation | Expected state | Recovery / interpretation |
|---|---|---|
| process dies after some object writes | build remains `deriving`; current unchanged; orphan/reusable objects may exist | exact build-key retry derives and verifies the same build; do not publish manually |
| object readback digest/size mismatch | request fails `artifact_corrupt` | quarantine filesystem/host; do not relabel bytes or mark build complete |
| publish loses response after commit | state revision/current already changed once | exact key + original precondition returns receipt; a fresh key with stale ETag must fail |
| two publishers use one revision | one commits; one gets current `precondition_failed` | caller rereads current and makes an explicit new decision |
| map generation changes | active overlay is cleared | activate an independently verified compatible overlay for the new generation |
| overlay is future/expired | `require_current` fails; `base_fallback` records base use | do not describe fallback as live traffic |
| route process dies before completion | route row remains `accepted` with frozen digests | exact route-key retry recomputes that snapshot |
| route process dies after completion | stored result exists | exact route-key retry returns it even if current changed |
| route hits expansion limit | durable `work_limit` | raise bound only through a new stable intent/key; do not call it no-route/optimal |
| old artifact requested after publish | retained generation returns exact old bytes/ETag | expected immutable behavior, not stale current labeling |
| PostgreSQL unavailable | authority operations fail | content objects alone do not authorize current/result state |

## Observability

Normal JSON logs contain only:

- operation name;
- HTTP status;
- elapsed milliseconds;
- low-cardinality evidence label;
- bounded artifact count or route outcome class where relevant.

They exclude bearer/fingerprint, stable keys, IDs, generations, digests, paths, coordinates, endpoints, graph/tile/overlay/route
bodies, source revisions, and database/object-store configuration. Request/response debugging must use generated isolated fixtures
and must not weaken the default logger.

Useful database-only operator checks include counts by build/route phase, current state revision, publication count, and age of
`deriving` builds. Avoid labeling IDs, digests, coordinates, or request keys in metrics.

## Backup, deletion, and deployment limits

v0.1 has no object garbage collector, tombstone workflow, backup/restore drill, replica, failover, secret rotation endpoint,
multi-region activation, CDN, container deployment, or SLO. Old complete content is deliberately retained for rollback/replay.
Deleting database rows or object files manually can break immutable receipts and is outside the supported protocol.

Successful checks prove only the recorded commit, runtime, local object store, synthetic fixture, and CI PostgreSQL service. They do
not prove production readiness, source/legal correctness, client rendering, navigation, safety, or external acceptance.
