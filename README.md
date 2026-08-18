# Version-Coherent Map Service Lab

This clean-room system-design practice starts with one question: while map data, derived tiles, routing graphs, traffic overlays,
and caches are changing independently, how can a server return one bounded synthetic viewport or route without mixing incompatible
generations or overstating what the response proves?

The prompt title is commonly framed as “design Google Maps.” This repository does not copy a product, source chapter, map,
dataset, tile, route, diagram, trace, or proprietary behavior. The initial contract was frozen from the title alone before reading
the fixed secondary chapter.

## Current phase

- Closed-book problem contract: [docs/closed-book-contract.md](docs/closed-book-contract.md)
- Fixed-source comparison and primary-source corrections: [docs/research-log.md](docs/research-log.md)
- Selected v0.1 decision: [ADR 0001](docs/adr/0001-immutable-builds-and-frozen-route-snapshots.md)
- Runnable implementation and public CI: pending

## Evidence boundary

The intended vertical slice may eventually prove synthetic dataset lineage, complete-before-publish generation changes, coherent
tile/feature or graph-version reads, bounded routing correctness against a direct oracle, cache/version separation, retry behavior,
and process recovery. It must not call those facts source accuracy, legal map-data rights, client receipt, map rendering, GPS truth,
turn-by-turn guidance, physical travel, arrival, accessibility, safety, production deployment, or external acceptance.

## License

MIT. Third-party study material and map data are not included.
