# Threat model

## Protected properties

- Stable intent cannot be rebound to different build/publication/overlay/route semantics.
- A partial or corrupt generation cannot become current.
- Current publication changes have one monotonic revision and explicit winner.
- Immutable artifact identity cannot silently serve changed bytes under the same digest/generation key.
- A route cannot mix graph and overlay generations or silently move to current after retry.
- Ordinary logs do not disclose synthetic coordinates, endpoints, paths, identifiers, keys, digests, tokens, or object/database
  locations.
- Server facts are not promoted to map truth, client outcome, navigation, arrival, or safety evidence.

## Trust boundaries

### Untrusted HTTP client

The client controls bearer bytes, idempotency key, JSON, coordinates, graph shape, costs, overlay delays, endpoints, expansion
bound, headers, and timing. Exact shapes/bounds are checked before expensive work. Bearer syntax and HMAC fingerprinting are lab
authentication mechanics, not identity proof, authorization roles, revocation, rate limiting, or abuse prevention.

### PostgreSQL

PostgreSQL is trusted for transaction/row/advisory-lock semantics, database time, durable metadata, and route/publication receipts
within the tested service. A database administrator, compromised host, logical replica lag, backup corruption, or multi-region
split brain is outside v0.1.

### Local content store

The directory and filesystem are trusted to implement tested file/link/sync/read semantics. Digest readback detects accidental or
host-level byte changes but does not stop an attacker who can alter both files and database metadata/code. Disk encryption,
permissions beyond private create modes, quota isolation, backup, remote replication, and secure deletion are unproved.

### CI and dependencies

Public CI uses fully pinned action commits and a digest-pinned database image. npm install uses a lockfile and high-severity audit.
These reduce drift; they do not constitute provenance attestation, malware analysis, reproducible builds, or supply-chain proof.

## Abuse and failure cases

| Threat / failure | v0.1 control | Residual risk |
|---|---|---|
| oversized/dense graph DoS | body, node, edge, identifier, cost, overlay, and route-work bounds | no per-principal quota, admission control, async build queue, or CPU/storage isolation |
| duplicate/delayed mutation | stable key + canonical intent digest + transaction advisory lock | key retention is unbounded; no cross-region/global lock |
| partial build publish | database phase + verified artifact transaction + publish state check | orphan objects accumulate; no GC/reconciliation tool |
| object substitution/corruption | SHA-256 path and every-read digest/size verification | SHA-256 is identity, not authenticity/ownership; host admin can alter code/metadata |
| stale writer overwrites current | strong expected revision + locked singleton state | single-row bottleneck; no distributed publication protocol |
| stale/incompatible traffic | generation check + database effective/expiry + explicit fallback | no incident truth, clock-distribution, ingestion, or model-quality proof |
| route changes on retry | frozen graph/overlay digest receipt | accepted rows can remain forever; no cleanup/lease/worker ownership |
| route algorithm overclaims | non-negative costs, checked sum/path, exhaustive small oracle, explicit work limit | no turn rules, hierarchy, real cost, ETA, alternatives, or world scale |
| cache serves wrong semantics | generation/style/tile identity + digest ETag; mutable current no-store | no proxy/CDN integration test, locale/layer/media negotiation, purge, or tombstones |
| endpoint/location disclosure | generated-only fixtures, POST route body, ordinary-log redaction | API responses and database still contain synthetic path/coordinates; real use forbidden |
| unauthorized artifact access | bearer required even for immutable tile endpoint | no tenant/data ACL model; cache header is public, suitable only for synthetic public bytes |
| misleading evidence | explicit evidence vocabulary and exclusions | downstream humans/systems can still quote receipts out of context |

## Privacy stance

This repository must never receive real people, devices, homes/workplaces, addresses, routes, GPS traces, proprietary map extracts,
or internal data. Even synthetic coordinates/paths are omitted from ordinary logs. Route/tile API bodies are intentionally visible
to the authenticated synthetic caller and PostgreSQL/object storage; this is not a privacy-compliant architecture for real users.

Required future work before any real-data discussion includes data classification, purpose/consent, minimization, retention and
erasure, access policy/audit, encryption/key rotation, isolation, abuse and anti-stalking review, legal/source licensing and
attribution, incident response, and independent privacy/security review.

## Evidence boundary

A matching green gate may prove canonical input handling, local content identity, database publication semantics, synthetic route
correctness, cache headers, and observed retry/restart behavior for one commit. It cannot prove CDN/client receipt, decode/render,
GPS truth, map accuracy/freshness, legal road access, physical travel, navigation instruction delivery, arrival, accessibility,
safety, regulatory compliance, production deployment, or external acceptance.
