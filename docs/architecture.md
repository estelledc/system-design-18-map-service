# Architecture

## One-sentence design

Immutable content-addressed files hold synthetic map bytes; PostgreSQL 17 holds build/current/overlay/route authority; a route
records one graph/overlay digest pair before bounded Dijkstra starts.

## Components

### HTTP process

The Node process validates bearer format, body size/content type, exact JSON shape, idempotency keys, state ETags, route bounds,
and tile coordinates. It logs only low-cardinality operation evidence. There is no browser/mobile/CDN implementation.

### Build service

The build service canonicalizes a synthetic graph, persists the `deriving` intent, derives one canonical graph object and non-empty
zoom-2 tile summaries, writes/verifies each content object, writes/verifies a manifest, then asks PostgreSQL to record all artifact
metadata and mark the build `complete`.

```text
stable build intent -> PostgreSQL deriving row
                    -> graph object --sync/digest--+
                    -> tile objects --sync/digest--+-> manifest --sync/digest
                                                     -> one complete transaction
```

An object written before a crash can be orphaned or reused; it cannot become current by itself.

### Content store

The store maps digest `d` to `sha256/d[0:2]/d`. A write creates a same-directory temporary file, syncs it, hard-links it into the
digest name without replacing an existing object, removes the temporary name, syncs the directory, then hashes a readback.

This is a local POSIX-oriented protocol. It does not model S3 conditional writes, multipart upload, replication, CDN propagation,
or remote durability.

### PostgreSQL authority

PostgreSQL stores:

- build intent/phase and artifact metadata;
- singleton `state_revision`, current build, and current overlay pointers;
- publication/rollback history and stable state-mutation receipts;
- immutable overlay temporal metadata;
- accepted/completed route receipts with a frozen snapshot.

State-changing publication/rollback/overlay transactions take `FOR UPDATE` on the singleton row. Route acceptance takes `FOR
SHARE`, which allows concurrent route admissions but conflicts with pointer changes. Stable intents use a transaction-scoped
advisory lock to serialize the same `(owner, key)` inside this database.

### Router

The router loads the frozen graph and optional overlay by digest, constructs a directed adjacency index, applies non-negative
per-edge delay, and runs bounded Dijkstra. It persists one of:

```text
route_found -> connected nodes/edges + checked total + expansion count
no_route    -> reachable frozen graph exhausted
work_limit  -> bound reached; no completeness/optimality claim
```

The service re-walks a found result independently before persistence. Tests use exhaustive simple-path enumeration only on small
graphs as the direct oracle.

## State sequences

### Build and publish

```text
absent -> deriving -> complete -> current -> superseded/retained
                    ^              |
                    |              +-> later rollback target -> current at a new revision
          exact-key resume
```

`deriving` is never current. A response-loss retry finds the stable build or state-mutation receipt before evaluating today's
pointer.

### Current state

```text
revision N:   generation A + compatible overlay A1
publish B:   revision N+1: generation B + no overlay
activate B1: revision N+2: generation B + compatible overlay B1
rollback A:  revision N+3: generation A + no overlay
```

Overlay is cleared at a base-generation change. Old route/artifact receipts still name immutable old digests.

### Route response loss across publication

```text
accept key K at revision N -> persist graph A / overlay A1 snapshot
compute + persist result   -> process dies before HTTP response
publish generation B      -> revision N+1
retry key K               -> return stored A/A1 result, never recompute on B
new key K2                -> accept current B snapshot
```

## Tile model

Node coordinates are signed integer degrees × 10^7 in the documented Web Mercator latitude/longitude domain. The builder computes
OGC `WebMercatorQuad` z/x/y at fixed zoom 2 and emits JSON summaries for non-empty tiles. An edge belongs to the tile containing its
`from` node and may reference a node in another tile.

This is enough to test addressing, generation identity, manifest completeness, cache headers, and cross-tile references. It is not
a raster tile, Mapbox Vector Tile, complete viewport, geometry clipping/simplification, label/style/glyph package, or renderer.

## Consistency boundary

- Content objects are immutable after verified write.
- Artifact metadata and build completion are one database transaction.
- Current build/overlay pointers and state revision are one locked row.
- Route acceptance freezes a pointer snapshot in one transaction; search is safe outside it because referenced content is
  immutable.
- HTTP cache validators identify exact artifact bytes, not current publication or legal/source truth.

## Intentional bottlenecks

- one PostgreSQL instance and one singleton state row;
- whole graph loaded per route;
- Dijkstra rather than hierarchy/preprocessing;
- synchronous build in an HTTP process;
- local filesystem object store and no garbage collector;
- one fixed tile zoom/style and generated JSON artifacts.

They keep the correctness claim executable. Scaling any of them requires a new activation, ownership, failure, and evidence
contract rather than a diagram-only substitution.
