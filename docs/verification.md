# Verification evidence

## Status

The identity-safe rewrite preserved every existing tree, message, and timestamp while mapping the seven commits in order: `ea989b9c46867ae9dd7a816a95151c62949a4e13` → `df03595862cf0cff9ac4c94871864bd6295cceb6`, `6ed72002a062b659ac686c4bbfeacc5f0232fb33` → `61b229febb3edd9385e004d69eb788d673af1c17`, `e2e86fce19c8abb68f1c78d5a7fc3261823406d7` → `3e20bbeb6fd28cb5aa4b4a4ce3103e652d08d748`, `ae346125020f043acbe7b73e1f3d13666beaf2fa` → `4eb811c5dbdf367437879ae31e8aa5e016dbcc03`, `8dc7fbf94bc813faad56a53bfe36440f83bd2240` → `e449049009359b62b61b22d80c8fb5190c1ab1df`, `11b0b22143e9f9946951bd60098af5ea71922127` → `53b342a42288a86207b96fcfd7313ccae590b2c6`, and `95dc68675fcce18b0eb202410ef1fa6a36a82da3` → `69b4b724a45398dc7713ddc48209f95e9dcb261e`.

Implementation commit `53b342a42288a86207b96fcfd7313ccae590b2c6` passed the complete tree-equivalent public matrix in historical pre-rewrite [GitHub Actions run 32190734084](https://github.com/estelledc/system-design-18-map-service/actions/runs/32190734084). The run remains bound to the old commit object.

Current reachable `main` uses the repository owner's GitHub noreply identity. Rewritten baseline `69b4b724a45398dc7713ddc48209f95e9dcb261e` passed [CI run 32227079128](https://github.com/estelledc/system-design-18-map-service/actions/runs/32227079128) on Node 22, 24, and 26 with PostgreSQL 17 and the full quality gate.

Each Node 22/24/26 job used PostgreSQL 17.11 and completed:

- 13 pure tests, 13 passed, 0 failed/skipped/cancelled/todo;
- 11 real PostgreSQL tests, 11 passed, 0 failed/skipped/cancelled/todo;
- repository-policy/syntax/link/workflow-pin checks;
- npm high-severity audit with 0 reported vulnerabilities;
- one true-process recovery sequence with three separate SIGKILL windows;
- one bounded generated-fixture benchmark.

Implementation evidence remains bound to the implementation commit above rather than silently moving with later prose-only
changes. A later all-green documentation run can prove repository consistency for that later commit, not retroactively change the
implementation observations.

## Public receipts

### Final implementation gate

- Commit: `53b342a42288a86207b96fcfd7313ccae590b2c6`
- Run: [32190734084](https://github.com/estelledc/system-design-18-map-service/actions/runs/32190734084)
- Jobs: Node 22, 24, and 26 with PostgreSQL 17.11, all green
- Pure/infra per job: 13/11, all pass, zero skip/fail
- Smoke per job: two complete builds, one complete frozen route, two publications, final revision 3
- Smoke assertions: partial build recovered; publish response loss replayed; route response loss replayed after a newer generation;
  old immutable artifact retained byte/ETag identity

### Retained red runs

- Initial tree-equivalent implementation `3e20bbeb6fd28cb5aa4b4a4ce3103e652d08d748` failed
  [run 32190140854](https://github.com/estelledc/system-design-18-map-service/actions/runs/32190140854). PostgreSQL rejected the
  NUL separator passed to the advisory-lock text hash (`22021`). Pure tests passed; only 1/10 infrastructure tests reached green.
- Fix `4eb811c5dbdf367437879ae31e8aa5e016dbcc03` failed
  [run 32190252294](https://github.com/estelledc/system-design-18-map-service/actions/runs/32190252294). The NUL defect was gone and
  8/10 infrastructure tests passed, but PostgreSQL rejected one overlay timestamp parameter inferred as both interval and
  `timestamptz` (`42P08`).
- Fix `e449049009359b62b61b22d80c8fb5190c1ab1df` passed
  [run 32190365067](https://github.com/estelledc/system-design-18-map-service/actions/runs/32190365067) across all three runtimes.
  The later `53b342a...` hardening split state-row locking from immutable metadata resolution and added pre-accept endpoint
  membership; its 11-test infrastructure gate is the authoritative implementation receipt.

The failures are evidence that the real PostgreSQL gate found behavior pure tests could not prove. They are not flaky runs and are
not erased from the history.

## Gate map

| Gate | What it can prove | What it cannot prove |
|---|---|---|
| `npm run lint` | required files, syntax, fixed-source identity, workflow pins, schema/code contracts, portable-data policy | runtime semantics or live database behavior |
| `npm test` | strict contracts, WebMercatorQuad boundaries, content corruption detection, HTTP cache policy, bounded route/oracle logic | PostgreSQL transaction/lock/durability behavior |
| `npm audit --audit-level=high` | registry audit reported no known high-severity issue for the exact lock at run time | absence of vulnerabilities or supply-chain compromise |
| `npm run test:infra` | real PostgreSQL build/publish/race/rollback/overlay/route semantics for the fixture | multi-region/object-cloud/CDN/client behavior |
| `npm run smoke:infra` | true API-process SIGKILL windows and restart replay against real PostgreSQL/local objects | host crash/power loss, remote storage, deployment, client receipt |
| `npm run benchmark:infra` | bounded observations for the exact generated graph/runtime/service | production capacity, route quality, global scaling |

## Pure test design

- canonical graph equivalence under reordered input;
- rejection of unknown fields, duplicate IDs, unsupported mode, unsafe costs, and Web Mercator polar overflow;
- fixed `WebMercatorQuad` coordinate examples;
- canonical overlay ordering and duplicate rejection;
- content-addressed deduplication and corrupt-read failure;
- authenticated/no-store HTTP state, immutable ETag/cache response, conditional 304, content-type/precondition rejection;
- deterministic route, overlay reroute, explicit work limit, disconnected no-route;
- 240 generated directed small graphs compared with exhaustive simple-path cost.

## Real PostgreSQL test design

- confirm the service is PostgreSQL 17 and starts with empty revision 0;
- controlled exception after the first verified object leaves one `deriving` non-current build; exact retry completes the same ID;
- build, publication, and route stable keys reject changed intent and replay exact receipts;
- two publish transactions at one expected revision have one winner and one `precondition_failed` loser;
- active overlay changes synthetic route cost; publishing a new graph clears current overlay while the old route replays exactly;
- future overlay fails `require_current` and records explicit base fallback when allowed;
- `work_limit` persists as its own receipt;
- unknown endpoints fail before a stable route receipt is inserted;
- rollback appends a revision and old tile bytes/digest remain identical;
- overlay rejects unknown edges and non-current generations.

## True-process smoke design

1. Start an API process with the build crash hook; SIGKILL after the graph object is verified.
2. Confirm PostgreSQL has one `deriving` build and no current generation.
3. Restart normally; exact build key completes the same build and a second generation is built.
4. Start with the publish crash hook; commit revision 1 then SIGKILL before response.
5. Restart; exact publish key/precondition returns replay rather than a second revision.
6. Activate an overlay, fetch old immutable tile bytes/ETag, then start with the route crash hook.
7. Commit an overlay-bound route and SIGKILL before response.
8. Publish generation B, retry the old route key, and require the same generation A/cost receipt.
9. Require old tile conditional 304 and byte equality after B is current.
10. Scan child logs for token, fixture node/source strings, and 64-hex digests/fingerprints.

## Benchmark fixture

The bounded benchmark uses one generated 24×24 directed grid, its exact node/edge counts, at most 128 delayed edges, one
compatible overlay, and 60 persisted routes. It records Node/PostgreSQL versions, artifact count, build wall time, route throughput,
p50/p95/max per-route wall time, and total expansions. Network, CDN/client rendering, real data/route quality, replication, and
production extrapolation are excluded.

## Benchmark observations

All observations below came from run 32190734084, PostgreSQL 17.11, the same generated fixture (576 nodes, 2,208 directed edges,
128 delayed edges, 9 graph/tile artifacts, 1 overlay, 60 persisted routes), and 32,221 total Dijkstra expansions.

| Runtime | Build ms | Routes/s | Route p50 ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|---:|
| Node 22.23.2 | 297.801 | 93.343 | 8.212 | 23.425 | 85.768 |
| Node 24.19.0 | 82.659 | 100.448 | 9.368 | 13.620 | 16.319 |
| Node 26.7.0 | 81.995 | 107.183 | 8.891 | 12.065 | 16.324 |

These are raw single-run observations, not a runtime ranking. The Node 22 build outlier is retained rather than explained without
profiling/repetition. Network latency, CDN/client rendering, real map data/route quality, multi-region replication, and production
extrapolation were excluded.
