# ADR 0001: Immutable builds and frozen route snapshots

- Status: accepted for v0.1
- Date: 2026-08-19

## Context

The fixed chapter usefully separates map rendering, routing, live traffic, location ingestion, and navigation, but its periodic
offline processing and object-storage diagrams do not define when one derived set is complete or how a reader avoids mixing it
with another. Its route planner similarly has no graph, weight, traffic, or model generation. Caching and fast graph search amplify
these gaps: they can return internally valid bytes or paths whose components were never meant to coexist.

The lab needs one executable slice that survives a partial build, concurrent publication, rollback, response loss, and a route
accepted just before a newer generation appears. It does not need real map data, a rendering engine, geocoding, a global CDN,
hierarchical routing, mobile navigation, or traffic prediction.

## Decision

### 1. Content-addressed files hold immutable synthetic artifacts

Canonical synthetic graph, fixed-style `WebMercatorQuad` tile summaries, traffic overlay, and build-manifest bytes are addressed by
SHA-256. The local object store writes a temporary file in the target directory, syncs it, renames it without replacing a different
object, syncs the directory, then reads and verifies the final digest.

A successful local write proves only that exact bytes were durably read back from this filesystem under the tested failure model.
It does not prove cloud object replication, CDN fill, remote read, map truth, source ownership, or legal rights.

### 2. PostgreSQL owns build state and current publication

A stable build key binds operator, canonical source digest, builder contract, and fixed artifact contract. The build row is created
before derivation. A crash can leave it `deriving`; exact replay regenerates/reuses deterministic objects and completes the same
build, while changed intent conflicts.

The final transaction verifies every required object's digest/size, records artifact metadata and manifest, then changes the build
to `complete`. Only a retained `complete` build may publish. A singleton system-state row is locked for publish/rollback, and a
strong expected revision chooses one winner. Every publish or rollback appends a monotonic immutable publication receipt and
changes the current pointer atomically.

One state row is an intentional lab bottleneck. It is not a multi-region publication protocol.

### 3. Artifact URLs carry semantic generation identity

Tile identity includes tile-matrix ID, build generation, style version, z/x/y, media type, and byte digest. Explicit-generation
responses return a strong digest ETag and long-lived `Cache-Control: immutable`. The current-publication resource returns
`Cache-Control: no-store`.

Old retained generation URLs continue to name their old bytes after a later publish or rollback. Retention/tombstone state can
eventually make them unavailable, but never rebinds the URL to changed bytes.

### 4. Traffic overlay is immutable and graph-compatible

An overlay contains bounded non-negative delay by stable edge ID, its compatible build/generation, canonical digest, acceptance
time, effective time, and expiry time. Activation locks the same state row, checks an expected revision, and appends a state
revision. Publishing/rolling back a base generation clears an incompatible active overlay.

A route request explicitly chooses `require_current` or `base_fallback`. At acceptance, the transaction freezes one compatible,
currently effective overlay digest or an explicit no-overlay fallback. Expiry after acceptance does not mutate an in-flight
snapshot; the receipt states the acceptance boundary and must not be described as current traffic later.

### 5. Stable route intent freezes one graph/cost snapshot

A route stable key binds authenticated synthetic principal, source/target node, travel mode/cost contract, overlay policy, and work
limit. The acceptance transaction locks current state and records publication revision, build/generation, graph digest, and
overlay digest before search begins.

The search may run after that short transaction because all referenced bytes are immutable. Exact retry resumes or returns the
same frozen receipt even if current publication changes. Changed intent conflicts. A failed process cannot silently rebind the
request to a newer graph.

### 6. Bounded Dijkstra is the only route claim

v0.1 accepts directed edges with positive safe-integer synthetic millisecond costs and one `drive` mode. Bounded Dijkstra has
deterministic node/edge tie ordering. It returns:

- `route_found` with a connected path and checked safe summed cost;
- `no_route` after exhausting the reachable frozen graph within the bound; or
- `work_limit` before claiming completeness or optimality.

After search, the service independently rechecks endpoint identity, every edge transition/mode, overlay application, and total
cost before persisting the receipt. Small generated graphs are compared with exhaustive simple-path enumeration. No A*, hierarchy,
ETA, real travel time, fastest-real-world route, navigation, arrival, or safety claim is made.

### 7. Evidence stops at server artifacts and receipts

Allowed facts include `object_verified`, `build_complete`, `publication_committed`, `overlay_activated`, `route_computed`,
`artifact_response`, and `server_bytes_written` when their corresponding gates pass.

Ordinary logs omit coordinates, graph/tile/route bodies, endpoints, node/edge/build/route identifiers, keys/digests, tokens, and
object paths. No event may claim CDN/client receipt, decode/render/display, GPS truth, physical travel, instruction following,
arrival, accessibility, safety, source accuracy, legal rights, deployment, or external acceptance.

## Consequences

### Positive

- A current pointer can never authorize a known partial build; publication and rollback have explicit linearized receipts.
- Cacheable names cannot silently acquire new bytes, and a mutable pointer cannot be mistaken for an immutable artifact.
- A route accepted on generation A remains reproducible after generation B publishes because its graph/overlay digests are frozen.
- Response-loss replay cannot duplicate publication or change route intent/snapshot.
- The algorithm's exact claim is testable against a direct oracle without depending on an unproved heuristic or hierarchy.

### Costs and limits

- One PostgreSQL state row serializes every publication, rollback, overlay activation, and route-snapshot acceptance.
- Local filesystem durability and one PostgreSQL instance do not model cloud object stores, replicas, regional activation, or
  disaster recovery.
- Dijkstra and whole-graph loading are intentionally unsuitable for world-scale routing.
- Fixed zoom/style JSON tile summaries do not prove raster/vector encoding, rendering, label placement, or CDN behavior.
- A route receipt can preserve an overlay that expired after acceptance; callers must use its recorded temporal boundary rather
  than call it live traffic.
- Orphaned content-addressed objects after a crash require a future retention/GC protocol; deletion is excluded from v0.1.

## Rejected alternatives

### Mutable object keys plus CDN purge

Rejected because purge completion and cache state are not an atomic multi-object publication barrier. Generation-bearing names
make byte identity explicit; a separate mutable state row selects current.

### Database large objects for every artifact

Rejected because the exercise needs to expose metadata/object-store publication boundaries. PostgreSQL stores authority and
receipts; the local content store deliberately keeps immutable bytes separate.

### A* with geographic straight-line heuristic

Rejected for v0.1 because synthetic edge cost is not yet proven lower-bounded by geographic distance under every mode/overlay.
An attractive heuristic without that contract could invalidate optimality. Dijkstra plus an exhaustive oracle gives a smaller,
defensible slice.

### Hierarchical routing tiles

Rejected because border ownership, cross-tile completeness, shortcut generation/unpacking, turn restrictions, overlay
customization, and version activation are each separate correctness problems. Partitioning without those proofs would add boxes,
not evidence.

### Read current publication before and after search

Rejected because matching pointer checks do not make intermediate mutable reads coherent and force unnecessary restart under
unrelated publication. The route instead records one immutable snapshot before search.

### Treating an ETag or manifest digest as legal/source truth

Rejected because technical identity proves neither source accuracy nor permission, attribution compliance, safety, nor product
outcome. Only generated synthetic fixtures are included.
