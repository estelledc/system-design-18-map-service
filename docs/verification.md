# Verification evidence

## Status

The implementation and verification design exist locally. Public Node 22/24/26 PostgreSQL 17 receipts are pending the first
implementation commit and GitHub Actions run. This document must be updated with the exact commit, run URL/ID, test counts,
service/runtime versions, benchmark observations, and any failed/red runs before v0.1 is called complete.

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
