# HTTP contract

## Common rules

- All `/v1` routes require `Authorization: Bearer <8–256 printable bytes>`; the server stores only an HMAC fingerprint.
- Mutations and route creation require `Idempotency-Key` matching the bounded printable contract.
- JSON requests require `Content-Type: application/json`, reject unknown fields, and are capped at 256 KiB.
- Publish, rollback, and overlay activation require strong `If-Match: "state-rev-N"`.
- JSON and current-state responses use `private, no-store`. Immutable artifact cache behavior is documented separately.
- Errors are `{ "error": { "code", "message", "details"? } }` and never echo sensitive request bodies.

The examples use generated values. IDs/digests are opaque and abbreviated only in prose; clients must use exact returned values.

## Create or resume a build

`POST /v1/builds`

```json
{
  "sourceRevision": "synthetic-region-a-revision-1",
  "graph": {
    "nodes": [
      { "id": "alpha", "latitudeE7": 0, "longitudeE7": -1200000000 },
      { "id": "bravo", "latitudeE7": 0, "longitudeE7": 1200000000 }
    ],
    "edges": [
      { "id": "alpha-bravo", "from": "alpha", "to": "bravo", "baseCostMillis": 10, "modes": ["drive"] }
    ]
  }
}
```

First completion returns 201; exact completed replay returns 200. A process can die while the row remains `deriving`; exact replay
regenerates/reuses content and completes the same `buildId`/`generation`.

`GET /v1/builds/{buildId}` returns bounded phase/digest/count metadata, not graph or tile bodies.

## Read current state

`GET /v1/current`

```json
{
  "stateRevision": 2,
  "generation": "gen_...",
  "manifestDigest": "...",
  "overlay": {
    "digest": "...",
    "effectiveAt": "2026-08-19T00:00:00.000Z",
    "expiresAt": "2026-08-19T00:05:00.000Z",
    "effective": true
  },
  "observedAt": "2026-08-19T00:00:01.000Z"
}
```

The response has `ETag: "state-rev-2"` for preconditions but remains `private, no-store`. It is an observation, not an immutable
artifact.

## Publish a complete build

`POST /v1/builds/{buildId}/publish` with `If-Match: "state-rev-0"` and no body.

The response includes operation, publication ID, new revision, selected build/generation, previous build/generation, and
`replayed`. It has the new state ETag. `deriving` returns `build_incomplete`; stale revision returns `precondition_failed` plus the
observed state ETag; publishing the already-current build under a new key conflicts.

## Roll back

`POST /v1/rollbacks` with a state precondition:

```json
{ "targetBuildId": "00000000-0000-4000-8000-000000000000" }
```

The target must be a retained complete non-current build. Success appends a new `rollback` publication revision and clears the
active overlay rather than mutating old objects.

## Activate a synthetic traffic overlay

`POST /v1/traffic-overlays` with a state precondition:

```json
{
  "buildGeneration": "gen_00000000000040008000000000000000",
  "delays": [
    { "edgeId": "alpha-bravo", "delayMillis": 100 }
  ],
  "activatesAfterSeconds": 0,
  "ttlSeconds": 300
}
```

The generation must be current; every edge must exist; delay is non-negative. Database time creates `acceptedAt`, `effectiveAt`,
and `expiresAt`. A future overlay can be current as state but is not effective for `require_current` routes until its effective
time.

## Compute or replay a route

`POST /v1/routes`

```json
{
  "sourceNodeId": "alpha",
  "targetNodeId": "delta",
  "mode": "drive",
  "overlayPolicy": "require_current",
  "maxExpansions": 1000
}
```

201 means this call accepted/completed the stable request; 200 means an exact receipt was resumed/replayed. The response records:

- acceptance/completion time;
- frozen state revision, generation, graph digest, overlay resolution/digest/effective/expiry;
- canonical request;
- `route_found`, `no_route`, or `work_limit` result and expansion count;
- node/edge path and checked synthetic cost only for `route_found`;
- whether the stable request was replayed.

`require_current` rejects a missing/future/expired/incompatible overlay. `base_fallback` records `overlayResolution:
"base_fallback"`. A response says nothing about a real road, fastest travel, navigation, client receipt, or arrival.

`GET /v1/routes/{routeId}` returns the authenticated owner's stored receipt.

## Read immutable tile artifact

`GET /v1/tiles/{generation}/synthetic-v1/2/{x}/{y}`

- generation is explicit and immutable;
- z is exactly 2; x/y are each 0–3;
- missing/non-empty-only artifact returns 404;
- success returns `application/vnd.map-lab.tile+json`, a strong `"sha256-..."` ETag, and
  `Cache-Control: public, max-age=31536000, immutable`;
- exact `If-None-Match` returns 304.

The response is a generated JSON tile summary. It is not a rendered map or standard vector-tile conformance result.

## Error vocabulary

| Code | Meaning |
|---|---|
| `invalid_request` | shape, bound, header, coordinate, endpoint, cost, or content type is invalid |
| `unauthorized` | bearer authentication is absent/malformed |
| `not_found` | authenticated resource or retained artifact does not exist |
| `intent_conflict` | stable key or current/target semantics conflict |
| `precondition_failed` | state revision changed |
| `build_incomplete` | target build is not verified complete |
| `overlay_unavailable` | `require_current` cannot freeze a compatible effective overlay |
| `artifact_corrupt` | immutable readback does not match the recorded digest/size |
| `internal_error` | bounded public error for an unclassified server failure |
