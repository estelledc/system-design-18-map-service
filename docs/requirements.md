# Runnable requirements

## Scope

v0.1 is a server-side synthetic map publication and routing lab. It accepts a bounded directed graph with generated coordinates,
derives immutable graph/tile artifacts, atomically selects one complete generation, optionally activates one compatible synthetic
traffic overlay, and computes a bounded route from a frozen snapshot.

It does not ingest real maps, geocode addresses, render a client map, operate a CDN, estimate real travel, guide a device, or prove
source accuracy, legal rights, accessibility, safety, deployment, or external acceptance.

## R1: canonical bounded build input

- JSON objects reject unknown/missing fields; identifiers, counts, integer costs, longitude, and the Web Mercator latitude domain
  are bounded before object/database work.
- Nodes and edges are canonicalized by stable ID. Edge IDs and node IDs are unique; every endpoint exists; self-loops, non-positive
  cost, non-safe integers, unsupported modes, NaN, and infinity fail.
- Stable `(owner, Idempotency-Key)` binds normalized source digest, builder contract, and artifact contract. Exact replay resumes or
  returns the same build; changed intent returns `intent_conflict`.

Acceptance: pure contract tests plus real PostgreSQL build replay/conflict tests.

## R2: complete before current

- The build row exists as `deriving` before artifact work starts.
- Graph, non-empty fixed-zoom tile summaries, and the manifest are canonical JSON in a SHA-256 content store. Every write uses a
  temporary file, file sync, no-replace link, directory sync, and digest readback.
- PostgreSQL changes a build to `complete` only in the transaction that records every required artifact and the manifest/graph
  digest. `deriving`/`rejected` cannot publish.
- A crash after the first object leaves current unchanged. Exact retry completes the same build and reuses verified objects.

Acceptance: corruption unit test, real-database partial-build test, and true-process build SIGKILL smoke.

## R3: linearized publication and rollback

- Publish/rollback locks the singleton state row, checks strong `If-Match: "state-rev-N"`, selects a retained complete build,
  appends one immutable publication row, increments revision, and changes current in one transaction.
- Two mutations at one expected revision yield one winner. Exact-key replay returns its committed receipt after response loss;
  changed intent conflicts.
- Rollback is a new revision that selects old immutable bytes and clears incompatible overlay state. It never rewrites artifacts or
  removes publication history.

Acceptance: PostgreSQL race/replay/rollback tests and publish-after-commit SIGKILL smoke.

## R4: named immutable artifact identity

- Tile artifacts use OGC `WebMercatorQuad`, style `synthetic-v1`, zoom 2, and bounded x/y in `[0, 2^z)`.
- Explicit artifact identity is `(generation, tile matrix, style, z, x, y, digest)`. Changed map bytes require a different
  generation/digest; retained old identity reads the same verified bytes after later publication/rollback.
- Immutable responses use a strong SHA-256 ETag and `public, max-age=31536000, immutable`; matching `If-None-Match` returns 304.
  The mutable current resource is `private, no-store`.

Acceptance: HTTP cache tests, PostgreSQL old-byte test, and process smoke before/after publication.

## R5: compatible overlay time

- One overlay names a complete generation and unique known edge IDs with bounded non-negative delay.
- Database time defines acceptance, effective, and expiry. Activation locks current state, checks the expected revision and current
  generation, stores immutable overlay bytes, increments state revision, and points current at that overlay.
- A route with `require_current` fails if no compatible overlay is effective at acceptance. `base_fallback` explicitly records that
  it used base cost. Expiry after acceptance does not mutate a frozen receipt.

Acceptance: real-database current/future/non-current/unknown-edge tests.

## R6: one frozen route snapshot

- Stable route intent binds principal, endpoints, `drive`, overlay policy, and expansion limit.
- Acceptance shares the locked state boundary with publication, then records state revision, generation, graph digest, and either
  one compatible effective overlay digest or explicit base fallback.
- Search reads only those immutable digests. Exact retry after an interrupted computation recomputes that snapshot; retry after
  completion returns the stored result even after current changes.

Acceptance: PostgreSQL generation-change test and route-after-commit SIGKILL smoke.

## R7: bounded checked routing

- Production search is Dijkstra over positive safe-integer synthetic millisecond costs. Overlay delay is checked before addition.
- Deterministic node/edge ordering resolves equal-cost queue choices. A returned path is independently rechecked for endpoints,
  edge continuity, mode, frozen overlay application, safe sum, and reported total.
- Exhausting the reachable set returns `no_route`; reaching the configured expansion bound returns `work_limit` and never claims
  completeness/optimality.
- Generated small-graph cases compare returned cost with exhaustive simple-path enumeration.

Acceptance: deterministic examples, boundary cases, and 240 generated oracle comparisons.

## R8: privacy and evidence vocabulary

- Only generated fixtures are accepted by repository policy. Ordinary logs exclude coordinates, endpoints, path/result bodies,
  node/edge/build/route IDs, principals, stable keys, digests, object paths, and bearer tokens.
- Low-cardinality log facts include operation, HTTP status, elapsed time, bounded counts, outcome class, and evidence label.
- `object_verified`, `build_complete`, `publication_committed`, `overlay_activated`, `route_computed`, `artifact_response`, and
  `server_bytes_written` remain separate facts.
- No result is labeled client receipt/render/display, GPS truth, physical travel, navigation, arrival, accessibility, safety,
  source correctness, legal rights, production deployment, or external acceptance.

Acceptance: repository policy scan plus true-process log disclosure scan.

## Fixed limits

| Input/state | v0.1 limit |
|---|---:|
| request body | 256 KiB |
| nodes per build | 2–2,000 |
| directed edges per build | 1–10,000 |
| edge/base or overlay delay | 0/1–1,000,000,000 synthetic ms as applicable |
| checked route total | 9,000,000,000,000 synthetic ms |
| overlay entries | 10,000 |
| overlay activation delay | 0–3,600 s |
| overlay lifetime after effective time | 1–86,400 s |
| route expansions | 1–100,000 |
| artifact zoom | exactly 2 |

These select executable failure modes and are not production capacity claims.
