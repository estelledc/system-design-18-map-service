# Research log

## Evidence boundary

The secondary chapter is fixed at repository commit `9d8388721e7231442763ad37398b8d82224aa68f`, chapter tree
`b06b1a75fb95f0c2867f3f7a0f401da3665ec41a`, and `README.md` blob
`1cba204f93a7196453a09b242daecebec486d31a`. The tree has no detected license, so this repository contains only independent
analysis and implementation. It does not copy the chapter's prose, diagrams, images, API examples, maps, routes, datasets, or
code.

The source title and product examples do not establish a current Google Maps contract. Historic user counts, coverage, storage,
QPS, route quality, product behavior, and infrastructure choices in the chapter remain secondary, uncited claims. Public
standards, an original research-paper record, and official project documentation are used only to correct mechanisms. They do not
make this lab an OGC-conforming service, a Google-compatible service, a legal map-data pipeline, or a production navigation
system.

Controlled public-source acquisition produced verified evidence bundles for the OGC `WebMercatorQuad` JSON definition, RFC 9111,
RFC 8246, PostgreSQL 17 transaction isolation/locking, and Crossref's record for the original A* paper. The full OGC HTML/PDF and
an accessible paper copy failed controlled fetch, while the IEEE landing page yielded only a partial 202 response. Those failed or
thin acquisitions are candidates, not extra verified evidence.

## Closed-book comparison

| Question | Closed-book decision | Fixed chapter | Result for v0.1 |
|---|---|---|---|
| data publication | immutable generation, manifest/digests/lineage, complete-before-current, CAS publish, monotonic rollback | raw road data is periodically transformed into routing tiles and placed in object storage; no activation barrier or generation | build immutable synthetic graph/tile objects first, verify a manifest, then atomically select one complete generation in PostgreSQL |
| tile identity | named CRS/tile matrix plus dataset/style/layer/z/x/y; new bytes require a new identity and ETag | 256×256 tiles, zoom levels, CDN, raster/vector ideas; URL may be computed from a geohash | use OGC `WebMercatorQuad` z/x/y bounds and a generation/style-bearing immutable artifact URL |
| route snapshot | one frozen graph and compatible overlay with explicit acceptance/expiry times | route planner reads routing tiles and live traffic components, but graph/traffic/model versions are absent | freeze graph digest and optional compatible overlay digest when accepting a route request |
| routing claim | exact small-graph oracle, connected path, checked cost, explicit work limit/no-route | modified Dijkstra/A* and hierarchy are proposed while also allowing “good enough” paths | use bounded non-negative Dijkstra for the production slice and exhaustive small-graph tests; make optimality conditional and explicit |
| update/retry | stable intent, response-loss replay, partial build remains non-current, publish race has one winner | periodic map processing and request flows have no operation identity or crash windows | persist build/publication/route receipts and test crash/restart around artifact write, publish commit, and route response |
| evidence | separate generated artifact, current publication, route computation, server write, and client outcome | diagrams end at app/service arrows and often speak as if the user received a map or navigation | stop at verified server artifacts/responses; rendering, device receipt, physical travel, arrival, and safety remain unproved |

## What the chapter contributes

- Map rendering, geocoding, routing, location updates, traffic, and navigation have different data lifetimes and access patterns;
  a single generic “map database” hides the important boundaries.
- Precomputing static map tiles and serving them through object storage/CDN moves expensive repeated work away from the request
  path. Vector tiles trade transfer size against client decode/render work rather than making cost disappear.
- Road networks are graphs. Partitioning them into routing tiles and adding hierarchy are plausible ways to bound memory and search
  work, but they need cross-partition correctness contracts.
- Batched mobile location updates can reduce request/radio overhead, while streaming them through a log can feed traffic and other
  consumers. This creates ordering, privacy, retention, and replay obligations the chapter does not close.
- ETA/rerouting is not only shortest-path search: live observations, candidate generation, ranking, route state, and notification
  all have distinct freshness and correctness boundaries.
- Projection distortion, zoom-dependent tile counts, caching, routing hot paths, mobile battery/data use, and geographically
  concentrated traffic are the right pressure categories to investigate.

The runnable slice deliberately narrows these directions to one missing join: immutable map artifacts must become visible as one
complete generation, and every route must remain on one frozen graph/cost snapshot even when a newer generation publishes.

## Defects and missing contracts in the fixed chapter

1. **There is no map-data generation.** Raw sources, normalized roads, routing tiles, render tiles, geocoding state, and traffic can
   update independently, but no source revision, builder version, manifest, digest, completeness rule, or compatibility matrix
   binds them.
2. **Offline output becomes visible without an activation barrier.** Periodically transforming data and uploading objects does not
   say when a reader may treat the set as complete. A process exit or partially copied region can expose a hybrid generation.
3. **Rollback and retention are absent.** There is no monotonic publication record, expected-current precondition, immutable older
   generation, tombstone order, or rule for caches and active route sessions during rollback/deletion.
4. **The geohash explanation conflates two indexes.** Recursively splitting into four quadrants describes a quadtree-style scheme;
   standard geohash alternates longitude/latitude bit partitions and encodes them. Neither is automatically an XYZ tile address.
5. **Tile URL construction is underspecified.** A geohash-derived URL does not define CRS, matrix identifier, z/x/y range, row
   direction, antimeridian wrapping, polar cutoff, dataset/style/language/layer version, encoding, or error behavior.
6. **The 256×256 statement is incomplete.** It omits the standard tile matrix, coordinate bounds, point of origin, matrix width and
   height, supported zooms, scale/cell-size meaning, and projection distortion near the poles.
7. **Cache identity omits semantic inputs.** CDN/object-store diagrams have no generation, style, locale, layer, policy, media
   encoding, ETag, `Vary`, freshness, purge, or immutable-name contract. A coordinate-only key can serve valid bytes for the wrong
   map semantics.
8. **Raster/vector trade-offs are not measured.** “Vector saves bandwidth” lacks geometry distribution, encoding, compression,
   style/glyph assets, decode CPU, memory, render latency, battery, or device-class observations. It is a candidate, not a result.
9. **Route optimality is contradictory.** The chapter invokes Dijkstra/A* and fastest routes, then permits a merely “good enough”
   path. It defines neither the selected claim nor admissible/consistent heuristics, non-negative costs, ties, restrictions,
   overflow, work limits, and no-route semantics.
10. **Routing-tile stitching has no proof obligation.** Border nodes/edges, ownership, duplicated edges, cross-tile connectivity,
    hierarchy transitions, shortcuts, unpacking, turn restrictions, and graph-version compatibility are absent.
11. **Traffic can mix with the wrong graph.** Incident/traffic stores have no edge identity version, observation/effective/expiry
    time, acceptance rule, compatible graph digest, frozen request snapshot, fallback, or stale-data label.
12. **ETA/model lineage is absent.** A route ranker and ETA service appear in the flow without feature/model version, calibration
    set, confidence, failure fallback, reproducible cost, or distinction between estimated and observed travel.
13. **Adaptive reroute membership is not route impact.** A user's route touching a broad routing tile does not prove that an
    incident affects a traversed edge. Checking the final tile can miss hierarchy/cross-tile effects or generate large false
    positives.
14. **Reroute delivery has no application protocol.** WebSocket bidirectionality does not supply a route/session epoch, durable
    cursor, replay window, acknowledgment, gap repair, takeover, slow-consumer limit, or device-apply evidence.
15. **The geocoding data direction is confused.** “Latitude/longitude to places” is reverse geocoding, not address-to-coordinate
    geocoding. Calling Redis fast does not define normalization, index, ambiguity/ranking, durable authority, locale, or update
    semantics.
16. **The navigation GET example leaks sensitive intent.** Origins, destinations, and addresses in a URL can enter browser history,
    proxies, access logs, and analytics. Authentication, request size, canonical identity, bounds, replay, version, errors, and log
    redaction are missing.
17. **Location events trust ambiguous client time.** The Cassandra sketch has no device generation, monotonic sequence,
    idempotency key, clock/skew policy, partition-hotspot bound, retention, consent, deletion, or late-event rule.
18. **The event stream has no replay contract.** Kafka consumers for traffic, personalization, analytics, and routing tiles lack
    event/schema identity, partition ordering, deduplication, offset/checkpoint ownership, backfill isolation, poison-message
    handling, deletion propagation, or purpose-based authorization.
19. **Sensitive route/location state has no lifecycle.** Active routes, tile memberships, raw location, home/destination intent,
    and personalization are stored without minimization, consent, purpose, TTL, access audit, erasure, encryption, abuse controls,
    or ordinary-log exclusion.
20. **Scale figures are not reproducible requirements.** Product history, users, coverage, update volume, 70 PB storage, metadata
    overhead, cache savings, WebSocket efficiency, and route traffic are uncited and have no time window, unit definition,
    distribution, source, or benchmark. Arithmetic plausibility is not evidence.
21. **Availability is a slogan rather than a failure policy.** The design does not separate stale static tiles, missing geocoding,
    stale traffic, unavailable routes, and safety-sensitive navigation; failover, backpressure, overload shedding, regional
    ownership, RPO/RTO, and observability are absent.
22. **Server response is treated as product outcome.** There is no proof of CDN/client receipt, decode, render, map correctness,
    GPS truth, instruction presentation, route following, physical arrival, accessibility, safety, legal access, or external
    acceptance.

## Primary-source corrections

### WebMercatorQuad is a named tile matrix, not a geohash convention

The OGC's official
[`WebMercatorQuad` JSON](https://schemas.opengis.net/tms/2.0/json/examples/tilematrixset/WebMercatorQuad.json) identifies
EPSG:3857, a fixed point of origin, 256×256 tiles, and matrix width/height doubling from 1×1 at matrix 0. The OGC standard's common
definition also bounds Web Mercator latitude near ±85.05112878 degrees and warns that cell size is distorted away from the
equator.

v0.1 therefore accepts canonical integer longitude/latitude inputs in the documented Web Mercator domain, computes bounded z/x/y
keys under `WebMercatorQuad`, and includes the tile-matrix ID, generation, style, and logical coordinate in artifact identity. It
does not call a geohash an XYZ tile address, does not support the poles, and does not claim full OGC API conformance.

### Immutable URLs and HTTP freshness are separate promises

[RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) defines cache reuse, selected representation matching, freshness,
validation, invalidation, and entity-tag validators. [RFC 8246](https://www.rfc-editor.org/rfc/rfc8246.html) defines
`Cache-Control: immutable` only during a response's freshness lifetime; stale responses still follow normal revalidation.

v0.1 gives changed artifact bytes a changed generation/digest identity, returns a strong ETag for exact bytes, and uses long-lived
`immutable` caching only on explicit generation/style/z/x/y URLs. A mutable “current publication” resource is `no-store` and must
not inherit immutable cache semantics. This is an application design derived from the RFCs, not a claim that an ETag alone creates
atomic multi-object publication.

### PostgreSQL provides primitives; the application defines publication

PostgreSQL 17
[transaction isolation documentation](https://www.postgresql.org/docs/17/transaction-iso.html) states that successive Read
Committed statements can see different snapshots, Repeatable Read fixes a transaction snapshot but can admit serialization
anomalies, and Serializable emulates a serial order while requiring retries after `40001` failures. Its
[explicit-locking documentation](https://www.postgresql.org/docs/17/explicit-locking.html) states that `SELECT ... FOR UPDATE`
blocks conflicting row changes until transaction end and transaction-level advisory locks are automatically released.

The lab stores a singleton current-publication row and locks it while applying expected-revision publication, rollback, overlay
activation, and route-snapshot acceptance. Immutable object writes finish and are digest-verified before that short database
transaction. A row lock is an intentional single-writer correctness bottleneck, not a globally scalable deployment claim.

### A* is not a synonym for “faster shortest path”

Crossref's verified record for Hart, Nilsson, and Raphael's 1968 paper,
[*A Formal Basis for the Heuristic Determination of Minimum Cost Paths*](https://doi.org/10.1109/TSSC.1968.300136), establishes
the original paper identity and DOI. The accessible IEEE page was too thin for this run to use as verified paper content, so this
lab does not rest an A* optimality claim on a search snippet or secondary tutorial.

v0.1 selects bounded Dijkstra over non-negative safe-integer synthetic costs. Property tests compare returned cost/connectivity
with exhaustive simple-path enumeration on small generated graphs. Hierarchical routing, A*, contraction hierarchies, turn-cost
models, and world-scale memory/latency remain candidate future work rather than decorative components.

## Decisions after comparison

- PostgreSQL 17 owns build intent/phase, immutable artifact metadata, current publication, monotonic revisions, compatible traffic
  overlay selection, stable mutation receipts, and frozen route receipts.
- A local content-addressed object directory owns canonical synthetic graph, tile, overlay, and manifest bytes. Files are written to
  a temporary path, synced, atomically renamed, directory-synced, and verified by digest before PostgreSQL can mark a build
  complete. This proves the lab's local durability protocol only, not S3/CDN behavior.
- Build generation derives from a canonical manifest. A build stays `deriving` after a mid-build crash; exact-key retry resumes the
  same build and reuses verified content-addressed objects. Publish rejects anything except `complete`.
- Publishing or rolling back locks the current-state row, checks a strong expected revision, and appends a new revision. Rollback
  selects an older retained complete generation; it never rewrites bytes or history.
- Generated tile artifacts use `WebMercatorQuad`, one fixed style, one bounded zoom, and explicit generation-bearing keys. The
  mutable current-resource response is not cacheable; immutable artifact responses carry digest ETags.
- An optional immutable synthetic traffic overlay names its compatible graph generation and bounded non-negative per-edge delay,
  plus server acceptance/effective/expiry times. Activation is a revisioned state change. A route freezes either the current valid
  compatible overlay or an explicitly labeled base-cost fallback.
- Route stable keys bind canonical endpoints, cost contract, work limit, and overlay policy. Acceptance freezes the publication
  revision, graph digest, and overlay digest; exact replay returns the stored result even if a newer generation publishes.
- Bounded Dijkstra returns `route_found`, `no_route`, or `work_limit`. A found path is rechecked for endpoint/edge connectivity,
  allowed mode, safe summed cost, and the frozen digest identities before persistence.
- Ordinary logs expose only low-cardinality event names, phase/counts, and failure classes. They exclude coordinates, graph/path
  bodies, node/edge/build/route IDs, keys/digests, object paths, tokens, origins, and destinations.

## Remaining unknowns

- Real map-source licensing, attribution, accuracy, conflation, moderation, edit conflict, topology repair, change capture, and
  regional publication ownership.
- Global object storage/CDN replication, cache purge, negative caching, multi-region activation, partial regional rollout,
  disaster recovery, retention/tombstone enforcement, and proof that every replica has a generation.
- Raster/vector tile encoding, simplification, clipping, label/glyph/sprite/style compatibility, localization, accessibility,
  rendering performance, offline packages, and device battery/data behavior.
- Geocoding/search/place identity, address privacy, ranking, abuse, business data, user edits, and locale-specific normalization.
- Road restrictions, turns, time zones, vehicle profiles, live closures, map matching, A*/hierarchy correctness, alternative routes,
  ETA calibration, reroute sessions, and navigation delivery.
- Real GPS/location consent, retention/deletion, anti-stalking controls, encryption/key rotation, lawful processing, safety review,
  incident response, and audit access.
- Capacity, partitioning, queue/backpressure, hot regions, failover, SLOs, cost, production observability, deployment, and external
  acceptance.
