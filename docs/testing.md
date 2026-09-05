# Testing strategy

## Pinned OSS environment

`docker-compose.yml` pins official OpenObserve **v0.92.2** at multi-platform digest `sha256:88fb692ac791d3eaff69653a4a4686f1c7eceb9e105491d58d29ac2739560b3b`. The root account is deliberately deterministic and local-only:

- URL: `http://127.0.0.1:5080`
- organization: `default`
- email: `root@example.test`
- password: `OpenObserve-Local-Test-Only-9x!`
- future streams: `n8n_e2e_logs`, `n8n_e2e_metrics`, `n8n_e2e_traces`

These values are fixtures, not production secrets. The port binds to loopback. The named volume persists for debugging; `docker compose down -v` explicitly makes a run disposable.

## Suites and fixtures

- `tests/scaffold.test.mjs`: Batch 0 identity/packaging invariants; no server needed.
- `tests/unit/`: operation parameters, JSON/date conversion, URL encoding, errors, and pagination; starts in Batch 1.
- `tests/contract/oss/`: one suite against the pinned container, independently runnable.
- `tests/contract/cloud/`: the same safe reads plus isolated writes against a designated non-production Cloud org; credentials come only from CI secrets.
- `tests/e2e/`: n8n workflow execution and trigger lifecycle, added with the corresponding features.

Fixtures use unique, deterministic prefixes plus a run ID. Tests create only owned resources and clean them in reverse dependency order. Golden payloads must be small, hand-authored, scrubbed, and tied to the pinned version; never copy the full generated API client/spec.

## Local smoke procedure

```sh
docker compose config
docker compose up -d openobserve
curl --fail --silent http://127.0.0.1:5080/healthz
curl --fail --silent --user 'root@example.test:OpenObserve-Local-Test-Only-9x!' \
  'http://127.0.0.1:5080/api/default/streams?type=logs'
docker compose down
```

Health and authenticated stream-list calls are separate so startup cannot be mistaken for working authentication/organization routing. Never run the fixtures against an unrecognized base URL or organization.

## Core E2E scenario

When implementation exists: authenticate; ingest two timestamped JSON log records through the ordinary JSON-array endpoint; confirm inferred stream/schema; query with SQL/date/offset/limit; retrieve field values and search around; ingest ordinary JSON metric records and query them with PromQL; create a VRL function and validate it; create reusable alert template/destination and a disabled scheduled alert; create a real-time pipeline; read each resource; update safe fields; exercise enable/disable; then delete only owned resources. Trace reads run as a separate fixture. Trigger E2E proves signed/secret webhook receipt, selected-alert filtering, retries/replay behavior, activation rollback, and safe shared-artifact cleanup.

## Error and security coverage

Required cases include invalid credentials, missing org/stream/resource, malformed raw JSON, wrong JSON type, invalid SQL/PromQL/VRL, time conversion boundaries, encoded path characters, partial ingestion errors, API rate/timeout/server errors, oversized responses, secret redaction, TLS defaults, hostile webhook payloads, bad/missing trigger headers, replayed events, and refusal to delete unowned artifacts. Destructive operations must not retry automatically.

## CI and upgrade policy

CI runs frozen install, formatting, n8n lint, TypeScript typecheck, unit tests, build, release audit, and dry-run package inspection. Docker contract tests remain independent so normal code checks do not silently depend on a service.

Upgrade only to a non-prerelease OpenObserve release after reviewing release notes, resolving the image digest, diffing relevant local and Cloud OAS paths/components, running OSS and Cloud suites, and updating `api-matrix.md` plus this file. An RC never replaces the stable baseline. Feature tests are deferred until their implementation batch; Batch 0 proves only scaffold/package invariants and the server smoke.
