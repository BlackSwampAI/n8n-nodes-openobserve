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

- `tests/scaffold.test.ts`: identity and packaging invariants; no server needed.
- `tests/foundation.test.ts`: credential, transport, JSON/date conversion, URL encoding, error, pagination, and local-harness invariants; no server needed.
- `tests/streams-logs.test.ts`: mocked request, UX, pagination, validation, partial-failure, input-lineage, normalized-name, and dynamic-list coverage for every Batch 2 operation.
- `tests/streams-logs.live.test.ts`: opt-in pinned OSS flow; run `OPENOBSERVE_LIVE=1 npx vitest run tests/streams-logs.live.test.ts` while Compose is healthy. The fixture rejects non-loopback Base URLs and organizations other than the disposable local `default` org. It owns exactly two streams named with `n8n_batch2_live_` plus a sanitized run-scoped suffix (`OPENOBSERVE_LIVE_RUN_ID`, or the local process ID), deletes only those exact names with `delete_all=false` in `finally`, and confirms both are absent. It never deletes related resources, sweeps by prefix, or removes the named volume. If safe deletion with `delete_all=false` stops working, the test must fail rather than broaden cleanup.
- `tests/search-metrics-traces.test.ts`: mocked request construction, validation, response normalization, repeated-parameter encoding, and metadata visibility for Batch 3.
- `tests/functions-dashboards.test.ts`: mocked VRL-only Function and Dashboard request construction, omission-preserving merge/concurrency behavior, folder-aware selectors, validation, limits, and lineage.
- `tests/functions-dashboards.live.test.ts`: opt-in exact-owned Function and Dashboard lifecycle in the disposable local `default` organization. It validates good/bad VRL and cleans only the exact run-scoped function and dashboard IDs in `finally`; no folders or panels are created or deleted.
- `tests/alert-infrastructure.test.ts`: mocked coverage for every Alert Template, Alert Destination, and Alert operation, current/mixed API routing, selectors, pagination, validation, response redaction, and lineage.
- `tests/alert-infrastructure.live.test.ts`: opt-in exact-owned real-time alert-to-webhook lifecycle. It refuses non-loopback API targets, non-`default` organizations, and receiver addresses outside the Docker private range. Determine the Compose bridge gateway and pass it as `OPENOBSERVE_LIVE_RECEIVER_HOST`; the fixture creates and removes only its exact stream/template/destination/alert/clone.
- `tests/openobserve-trigger.test.ts`: deterministic ownership, secret validation (including duplicate raw headers), selected-alert union, restart idempotence, collision refusal, reverse rollback, preservation, and exact deactivation tests.
- `tests/openobserve-trigger.live.test.ts`: opt-in pinned-OSS proof of selected-alert attachment, repeated activation, real secret-authenticated delivery through the trigger webhook method, exact detachment, preservation of the alert's unrelated destination/configuration, and dependency-ordered cleanup. It uses the same loopback/default/private-bridge guards as the Batch 5 receiver fixture.
- `tests/pipelines.test.ts`: operation visibility, selector routing, real-time/scheduled graph validation, evaluation/remote exclusions, exact update preservation, enable/disable/delete routing, and 1,000-row history pagination boundaries.
- `tests/pipelines.live.test.ts`: guarded loopback/default exact-owned proof that a real-time stream graph processes an ingested record, plus real-time and scheduled get/list/update/enable/disable/delete and history behavior. Scheduled creation requires the queried source stream schema to exist. Cleanup uses node Delete first, exact raw fallback only on failure, deletes exact streams with `delete_all=false`, and confirms pipeline absence.

The built trigger must receive an actual n8n editor/activation smoke before release: confirm credential, event, folder, and alert controls; activate twice; send rejected and accepted webhook requests; restart n8n; and deactivate. Batch 6's repository environment contains `@n8n/node-cli` but no installed `n8n` runtime, so that UI/runtime smoke cannot be claimed without a separately approved pinned n8n harness. Build and package registration tests remain the local boundary proof.

After starting Compose, read its current bridge gateway and pass that exact value to the Batch 5 fixture:

```bash
OPENOBSERVE_LIVE_RECEIVER_HOST="$(docker network inspect n8n-nodes-openobserve_default --format '{{(index .IPAM.Config 0).Gateway}}')"
OPENOBSERVE_LIVE=1 OPENOBSERVE_LIVE_RECEIVER_HOST="$OPENOBSERVE_LIVE_RECEIVER_HOST" npm test -- --run tests/alert-infrastructure.live.test.ts
OPENOBSERVE_LIVE=1 OPENOBSERVE_LIVE_RECEIVER_HOST="$OPENOBSERVE_LIVE_RECEIVER_HOST" npm test -- --run tests/openobserve-trigger.live.test.ts
```

- `tests/search-metrics-traces.live.test.ts`: guarded loopback-only Search/Metric flow, including JSON rows plus CSV and Markdown query output, and honest empty/missing Trace behavior. It creates three exact run-scoped streams, deletes each with `delete_all=false`, and confirms absence in `finally`; it never seeds traces through an out-of-scope ingestion route.
- `tests/contract/oss/`: one suite against the pinned container, independently runnable.
- `tests/contract/cloud/`: the same safe reads plus isolated writes against a designated non-production Cloud org; credentials come only from CI secrets.
- `tests/e2e/`: n8n workflow execution and trigger lifecycle, added with the corresponding features.

All automated tests are TypeScript `*.test.ts` files run by Vitest. Direct-execution `.mjs` files are reserved for operational and release tooling rather than test suites.

Fixtures use unique, deterministic prefixes plus a run ID. Tests create only owned resources and clean them in reverse dependency order. Golden payloads must be small, hand-authored, scrubbed, and tied to the pinned version; never copy the full generated API client/spec.

The Compose harness sets `ZO_SKIP_SSRF_CHECKS=true` solely so pinned OpenObserve can reach the disposable receiver on its private Docker bridge. This intentionally weakens outbound URL protection and must never be copied into production or any shared deployment. Production should retain OpenObserve's default SSRF protections.

## Local smoke procedure

```sh
docker compose config
docker compose up -d --wait openobserve
curl --fail --silent http://127.0.0.1:5080/healthz
curl --fail --silent --user 'root@example.test:OpenObserve-Local-Test-Only-9x!' \
  'http://127.0.0.1:5080/api/default/streams?type=logs'
docker compose down
```

The container healthcheck uses the distroless image's native `/openobserve node list` command; it proves that the initialized node reports successfully without depending on a shell or curl inside the image. It does not prove HTTP readiness or authentication. The host-side HTTP health and authenticated stream-list calls are the authoritative API smoke checks and remain separate so process initialization cannot be mistaken for working HTTP/authentication/organization routing. Never run the fixtures against an unrecognized base URL or organization.

The final pre-npm smoke target is the non-disposable deployment at `https://observe.blackswampai.com` and its existing `n8n` stream. Do not store its credentials. With a runtime-supplied least-privilege account, that smoke may ingest one uniquely tagged synthetic record and verify it through Stream/Search reads. It must never update settings, delete fields, or delete the `n8n` stream. All destructive lifecycle testing remains confined to the local Docker fixture.

## Core E2E scenario

When implementation exists: authenticate; ingest two timestamped JSON log records through the ordinary JSON-array endpoint; confirm inferred stream/schema; query with SQL/date/offset/limit; retrieve field values and search around; ingest ordinary JSON metric records and query them with PromQL; create a VRL function and validate it; create reusable alert template/destination and a disabled scheduled alert; create a real-time pipeline; read each resource; update safe fields; exercise enable/disable; then delete only owned resources. Trace reads run as a separate fixture. Trigger E2E proves signed/secret webhook receipt, selected-alert filtering, retries/replay behavior, activation rollback, and safe shared-artifact cleanup.

## Error and security coverage

Required cases include invalid credentials, missing org/stream/resource, malformed raw JSON, wrong JSON type, invalid SQL/PromQL/VRL, time conversion boundaries, encoded path characters, partial ingestion errors, API rate/timeout/server errors, oversized responses, secret redaction, TLS defaults, hostile webhook payloads, bad/missing trigger headers, replayed events, and refusal to delete unowned artifacts. Destructive operations must not retry automatically.

## CI and upgrade policy

CI runs frozen install, formatting, n8n lint, TypeScript typecheck, unit tests, build, release audit, and dry-run package inspection. Docker contract tests remain independent so normal code checks do not silently depend on a service.

Upgrade only to a non-prerelease OpenObserve release after reviewing release notes, resolving the image digest, diffing relevant local and Cloud OAS paths/components, running OSS and Cloud suites, and updating `api-matrix.md` plus this file. An RC never replaces the stable baseline. Feature tests are deferred until their implementation batch; Batch 0 proves only scaffold/package invariants and the server smoke.

## Batch 1 live result

On 2026-09-05, pinned v0.92.2 passed health, root email/password Basic auth, and disposable self-hosted service-account email/token Basic auth through `GET /api/default/streams?type=logs&limit=1`. Invalid credentials returned 401 and a missing organization returned 404. The service account was deleted, absence was confirmed by listing accounts, and the temporary token response was removed. The container was stopped without `-v`, preserving the non-production named volume for repeatable local work. Cloud execution remains unverified because no designated Cloud test credentials were provided.

After removing the Cloud Base URL default, the root-user smoke was repeated through the compiled `OpenObserveApi.authenticate` function: it replaced the non-routable credential-test sentinel with the configured loopback Base URL, encoded the organization path, applied Basic auth, and received a 200 stream-list response with the expected shape.
