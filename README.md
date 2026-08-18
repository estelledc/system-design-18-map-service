# Version-Coherent Map Service Lab

This clean-room system-design practice starts with one question: while map data, derived tiles, routing graphs, traffic overlays,
and caches are changing independently, how can a server return one bounded synthetic viewport or route without mixing incompatible
generations or overstating what the response proves?

The prompt title is commonly framed as “design Google Maps.” This repository does not copy a product, source chapter, map,
dataset, tile, route, diagram, trace, or proprietary behavior. The initial contract was frozen from the title alone before reading
the fixed secondary chapter.

## What is implemented

- PostgreSQL 17 authority for build phase, immutable artifact metadata, current map/overlay pointers, monotonic
  publish/rollback revisions, stable mutation receipts, and frozen route receipts;
- a local SHA-256 content store for canonical synthetic graph, fixed-style `WebMercatorQuad` tile summaries, overlay, and manifest
  bytes, with synced no-replace write and digest readback;
- exact-key build resume plus publish/route response-loss replay, revision-CAS publication races, monotonic rollback, and retained
  old artifact identity;
- compatible effective/expiry-bounded synthetic traffic overlays and explicit base fallback;
- bounded deterministic Dijkstra with post-checks and exhaustive small-graph oracle tests;
- pure, real-PostgreSQL, true-process SIGKILL, bounded benchmark, repository-policy, dependency-audit, and Node 22/24/26 CI gates.

Implementation commit `11b0b22143e9f9946951bd60098af5ea71922127` passed the complete public Node 22/24/26 matrix in
[CI run 32190734084](https://github.com/estelledc/system-design-18-map-service/actions/runs/32190734084). Each runtime ran 13
pure tests and 11 real PostgreSQL 17 tests with zero failures/skips, then the true-process smoke, bounded benchmark, and
high-severity dependency audit. Exact receipts, two retained red runs, and limits are in
[docs/verification.md](docs/verification.md).

## Read the system

- Problem and invariants: [docs/closed-book-contract.md](docs/closed-book-contract.md)
- Fixed-source comparison and primary corrections: [docs/research-log.md](docs/research-log.md)
- Runnable requirements: [docs/requirements.md](docs/requirements.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- HTTP contract: [docs/api.md](docs/api.md)
- Decision record: [ADR 0001](docs/adr/0001-immutable-builds-and-frozen-route-snapshots.md)
- Operations and failures: [docs/operations.md](docs/operations.md)
- Threat model: [docs/threat-model.md](docs/threat-model.md)
- Verification evidence: [docs/verification.md](docs/verification.md)

## Run the gates

```sh
npm ci --ignore-scripts
npm run check
DATABASE_URL=... npm run test:infra
DATABASE_URL=... npm run smoke:infra
DATABASE_URL=... npm run benchmark:infra
```

`compose.yaml` describes the digest-pinned PostgreSQL service used in public CI. See [docs/operations.md](docs/operations.md) for
runtime variables, crash hooks, and failure interpretation.

## Evidence boundary

For its recorded commit and matching green gates, this vertical slice proves synthetic artifact identity,
complete-before-current publication, coherent graph/overlay route snapshots, bounded routing against a direct small-graph oracle,
cache/version separation, stable replay, and the tested process-recovery windows. It must not call those facts source accuracy,
legal map-data rights, CDN/client receipt, map rendering, GPS truth, turn-by-turn guidance, physical travel, arrival, accessibility,
safety, production deployment, or external acceptance.

## License

MIT. Third-party study material and map data are not included.
