# Closed-book contract: version-coherent map service

## Reading boundary

This contract was written from the case title alone, before reading the fixed `system-design-notes` chapter. The title identifies a
problem family, not one current product contract. Map layers, vector/raster tiles, search, routing, traffic, navigation, offline
downloads, update cadence, data sources, scale, and consistency are hypotheses for this lab—not facts about Google or any other
provider. Later research must record confirmations, conflicts, omissions, and changes instead of silently rewriting this baseline.

## Users and core behavior

### Map viewer

1. An authenticated synthetic client requests a bounded viewport, layer/style set, zoom, and supported coordinate reference.
2. Every returned object belongs to one published dataset/style generation or carries an explicit independently composable overlay
   version. A response must not silently mix old geometry with new metadata, labels, or access policy.
3. Stable request identity and cache validators converge after response loss. A stale page/tile token cannot jump into a newer
   generation and still claim one coherent view.
4. Server bytes do not prove the client received, decoded, rendered, displayed, or understood a map.

### Route requester

1. A synthetic request provides canonical endpoints and a bounded travel-mode/cost contract.
2. The returned path is connected from its resolved start to end, uses edges allowed by one graph/policy generation, and reports a
   cost reproducible from that same snapshot.
3. Dynamic traffic or closures are explicit overlays with their own observation/effective time and fallback semantics. They cannot
   silently mutate base topology halfway through a route computation.
4. A computed route is not turn-by-turn delivery, actual travel, legal access, accessibility, arrival, or safety advice.

### Map-data operator

1. An operator can ingest one bounded synthetic source revision, derive artifacts, validate completeness/integrity/lineage, and
   atomically publish or reject a generation.
2. Failed, partial, or superseded builds remain non-current. Rollback selects a previously complete immutable generation rather
   than rewriting cache-visible bytes under the same identity.
3. Ordinary logs and metrics exclude raw coordinates, endpoints, route geometry, source payloads, tokens, request keys/digests,
   and result bodies.

## Non-goals for v0.1

- real users, devices, identities, addresses, homes/workplaces, searches, trips, GPS traces, traffic, incidents, or road networks;
- Google, OpenStreetMap, commercial basemap, satellite, Street View, transit, elevation, weather, business, or proprietary data;
- geocoding, address normalization, autocomplete, place search, reviews, photos, ads, recommendations, or user contributions;
- mobile SDKs, gestures, rendering engines, fonts/glyph shaping, label placement, 3D buildings, camera control, or GPU behavior;
- sensor fusion, map matching, positioning accuracy, background location, battery/radio policy, spoof detection, or attestation;
- turn-by-turn navigation, rerouting, voice guidance, lane guidance, speed limits, legal access, accessibility, emergency routing,
  arrival, or safety decisions;
- authoritative map truth, freshness SLA, source licensing, attribution compliance, moderation, or production privacy compliance;
- global active-active publication, CDN invalidation, disaster recovery, backup/restore, production deployment, SLA, or capacity;
- proving client receipt/rendering, physical movement, arrival, satisfaction, or external acceptance.

## Hypothetical scale envelope

These numbers select failure modes; they are not sourced requirements:

- 100 million daily synthetic viewport users, 20 viewport interactions/day, and 12 artifacts/interaction gives about 24 billion
  artifact reads/day or 278,000/s average before peak/cache effects;
- a 20× regional/event peak is a design input, not an achievable claim;
- 10 million route requests/day is about 116/s average, with a deliberately modeled 100× local peak;
- 10 billion base features averaging 160 bytes would be about 1.6 TB before indexes, topology, derived tiles, replicas, metadata,
  compression, and history;
- four immutable dataset generations plus derived artifacts can multiply storage unless retention and content identity are bounded;
- supported zoom, viewport area, layers, result bytes, route nodes/edges, alternatives, token size, build concurrency, and retry
  count all require hard limits.

The runnable lab will use a tiny generated planar or geographic graph and synthetic artifacts, report raw fixture counts, and never
extrapolate them to a global map.

## Candidate state model

Dataset publication:

```text
source_received -> validating -> deriving -> complete
                     |             |
                     +-> rejected  +-> rejected

complete -> current -> superseded
         -> retained rollback candidate -> expired/tombstoned
```

Artifact identity:

```text
(dataset generation, style generation, layer, z/x/y or feature page)
  -> immutable bytes + digest + lineage
  -> cacheable

same logical tile under a new generation -> new identity, never in-place byte replacement
```

Route computation:

```text
validated request -> endpoints resolved on graph generation
  -> bounded search -> connected candidate(s) -> cost recomputed -> response
                    -> no_route / work_limit / stale_overlay / invalid_request
```

The exact source format, projection, tile scheme, graph builder, cache, database, and vertical slice remain undecided until source
and primary specifications are reviewed.

## Core invariants

1. **Coordinate and tile domain.** Latitude/longitude, projection, zoom, x/y, viewport bounds, antimeridian wrapping, endpoint
   order, travel mode, cost units, page size, tokens, and byte limits use one canonical named domain. NaN/infinity, unknown fields,
   unsupported CRS/mode, ambiguous wrapping, and unsafe integer ranges fail before cache/index work.
2. **Complete before current.** A dataset generation becomes current only after every required source manifest, derived artifact,
   graph/index component, digest, count, and lineage check is durable. A partial build is never queryable as current.
3. **Immutable generation identity.** Published generation IDs bind immutable source/normalizer/builder/style/policy versions and
   content digests. Reusing an ID for changed bytes or graph semantics conflicts.
4. **Coherent viewport read.** One viewport/page chain freezes the dataset/style generation and ordering boundary. Cache misses,
   retries, late publication, or eviction cannot return a hybrid while preserving the old token/ETag.
5. **Cache keys authorize nothing.** Cache identity includes every semantic input that changes bytes or eligibility. A cache hit is
   still checked against current publication/access/tombstone state where required; tile coordinates alone are not sufficient.
6. **One graph/cost snapshot per route.** Every traversed edge, restriction, weight, closure, and reported total belongs to the same
   frozen base graph plus explicitly compatible overlay version. Mixed generations fail or restart.
7. **Path/cost correctness.** A returned route begins/ends at the documented resolved nodes, every consecutive edge connects and is
   allowed, total cost equals a checked bounded sum, and the selected result matches the chosen exact oracle on small graphs. No
   negative/overflowing/NaN cost is accepted.
8. **No silent partial completeness.** Viewport candidates, feature pages, route search states, alternatives, graph degree, build
   artifacts, response bytes, retries, and work time are bounded. Exceeding a bound returns an explicit error/continuation; it never
   claims a complete viewport or optimal route after truncation.
9. **Stable mutation/build intent.** `(operator, request key)` binds the source digest, builder contract, expected base, and publish
   intent. Exact replay returns the original receipt; changed intent conflicts; response loss cannot create two current generations.
10. **Rollback is a publication event.** Selecting an older complete generation creates a new monotonic publication revision and
    invalidation boundary. It does not erase history or mutate immutable artifacts.
11. **Deletion and retention are versioned.** Source/artifact/generation tombstones, cache staleness, active sessions/tokens, and
    retention have an explicit order. Old URLs/tokens cannot resurrect deleted or unauthorized content.
12. **Overlay time is explicit.** Dynamic cost observations distinguish observation, acceptance, validity, and expiry time. Missing
    or expired overlay data follows a documented fail/fallback rule and never masquerades as current traffic truth.
13. **Lineage and license are separate from bytes.** A digest or successful build proves technical identity, not source accuracy,
    ownership, attribution compliance, or legal permission. Real map data is excluded from the lab.
14. **Location privacy in evidence.** Raw coordinates, endpoints, route geometry, query/source payloads, account/session/build IDs,
    request keys/digests, tokens, and result bodies do not enter ordinary logs or metric labels.
15. **Evidence separation.** `source_validated`, `generation_published`, `artifact_response`, `route_computed`, and
    `server_bytes_written` are distinct. None implies client receipt, decode/render/display, GPS truth, physical travel, arrival,
    accessibility, safety, source correctness, deployment, or external acceptance.

## Initial API/event sketch

Authenticated operator routes:

- `POST /v1/dataset-builds` with stable key, source manifest digest, expected builder contract, and bounded synthetic input;
- `POST /v1/dataset-builds/{id}/publish` with strong expected-current precondition;
- `POST /v1/publications/{id}/rollback` as a new monotonic publication event;
- `GET /v1/dataset-builds/{id}` for phase/count/digest receipts without returning source payloads.

Authenticated read routes:

- `POST /v1/view-sessions` with canonical viewport, zoom, layers/style, result/byte cap, and optional current-generation
  precondition;
- `GET /v1/view-sessions/{id}/features?pageToken=...` or immutable `GET /v1/tiles/{generation}/{style}/{z}/{x}/{y}`;
- `POST /v1/routes` with endpoints, mode/cost contract, graph/overlay policy, work bound, and stable request key;
- `GET /v1/routes/{id}` for a frozen synthetic route receipt.

Exact fields, auth model, projection, tile/feature choice, route algorithm, overlay contract, persistence, cache, and error vocabulary
remain hypotheses until primary specifications are reviewed.

## Failure matrix

| Failure window | Required result |
|---|---|
| build crashes after some derived artifacts | generation remains non-current; retry reuses verified immutable artifacts or rejects drift |
| publish response is lost after commit | identical retry returns the same publication revision; changed intent conflicts |
| two complete generations race to publish | strong expected-current check gives one explicit winner; loser cannot silently overwrite |
| cache contains prior-generation bytes | versioned key/validator returns old immutable identity only when explicitly requested and retained; current read cannot mislabel it |
| viewport page 1 is read, then a new generation publishes | old page token stays on its frozen generation or expires explicitly; page 2 cannot jump generations |
| one derived artifact has wrong lineage/digest/count | whole generation is rejected; completeness is not inferred from process exit |
| graph topology and weights update separately | route uses one compatible frozen graph/cost boundary or restarts/fails |
| dynamic overlay expires mid-search | documented frozen validity/fallback applies; no half-old/half-new cost claim |
| route search exceeds node/time/memory budget | explicit work-limit result; no optimal/complete claim |
| endpoint lies outside graph or on ambiguous wrap/boundary | deterministic documented resolve/no-route behavior |
| deletion/rollback races with a read | result binds one publication snapshot; post-cutover reads obey tombstone/current revision |
| client disconnects after response bytes start | server-write evidence stays distinct from receipt, render, navigation, or arrival |

## Required executable evidence before v0.1 completion

1. A clean-room README, source comparison, requirements, architecture, API/events, operations, threat model, and at least one ADR.
2. Exact coordinate/tile/token/build/route validation and deterministic version/cache identity tests.
3. Generated/property tests comparing the chosen routing algorithm or artifact index with a direct small-model oracle across random
   graphs, ties, disconnected nodes, boundaries, generation changes, replay, and truncation.
4. Real-infrastructure tests for build idempotency, complete-before-current publication, concurrent publish preconditions, immutable
   artifacts, frozen read sessions, rollback/tombstone, and transaction isolation.
5. A true-process crash/restart smoke covering build/publish response loss and frozen old read versus new current generation.
6. A bounded benchmark with exact graph/artifact distribution, runtime/service versions, exclusions, and raw observations—without
   production extrapolation or route-quality claims.
7. Node 22/24/26 public CI with pinned actions/services, dependency audit, zero skipped infrastructure tests, and exact commit/run
   receipts.
8. Log/evidence-vocabulary scans that reject synthetic private values and any claim of client receipt/render, GPS truth, travel,
   arrival, safety, source accuracy, legal rights, or external acceptance.

## Initial design choices to challenge after source review

- Is the chapter actually centered on map tiles, location search, directions, navigation, traffic, or some smaller combination?
- Does it freeze a map-data version across a viewport/route, or assume caches and derived stores update coherently?
- Is quadtree/geohash/S2 used for candidate generation, tile addressing, graph partitioning, or incorrectly treated as exact truth?
- What makes a tile/segment/graph build complete and immutable before metadata/publication points to it?
- How do cache keys and invalidation include dataset, style, locale, layer, policy, and overlay generation?
- Does route search define graph/weight snapshot, restrictions, admissible heuristic, work limit, ties, and no-route behavior?
- Which latency, QPS, storage, user, update, tile-size, and cache-hit figures are cited, reproducible, or silently assumed?
- Which claims require client/GPS/map-data evidence that a server-only lab must abstain from?

Implementation remains pending until this baseline is committed, the fixed source is inspected, primary specifications are
verified, and the smallest executable invariant is selected.
