# Architecture and design decisions

## Intended layout

```text
nodes/
  OpenObserve/
    OpenObserve.node.ts       action-node registration and routing
    actions/<resource>/       operation descriptions and execution
    shared/                   transport, pagination, errors, JSON, dates
  OpenObserveTrigger/         alert webhook trigger after feasibility gate
credentials/
  OpenObserveApi.credentials.ts
tests/
  unit/ contract/ e2e/
```

Batch 0 registers only an inert, compile-safe action-node shell. It contains no credentials, network transport, resource operations, or trigger registration. Batch 1 owns credentials and the API foundation; later batches add bounded resource groups and their tests.

## API and authentication boundary

The future credential stores a base URL (self-hosted or Cloud), organization identifier, and supported authentication fields. The organization is interpolated into the path by one shared helper, never concatenated ad hoc by operations. Base URLs are normalized once and HTTPS is required by default; any local HTTP allowance must be explicit and non-secret. Basic authentication is documented by the current API index, but exact Cloud/self-hosted credential choices and n8n credential tests remain a Batch 1 decision requiring live verification.

Shared helpers will own authenticated requests, path-segment encoding, time conversion to API units, query serialization (including repeated Prometheus parameters), pagination, retry classification, binary responses, response normalization, and actionable `NodeApiError` construction. Operations must not duplicate transport or silently fall back from v2 to deprecated endpoints.

## Input and output strategy

Common fields get typed n8n controls. Complex OpenObserve schemas use a raw JSON object/string option with parsing, object-only validation, and item-indexed errors. Raw JSON is an escape hatch, not an unreviewed URL/method escape: resource, org, authentication, and endpoint remain controlled by the node. Responses preserve OpenObserve data unless stable n8n pagination metadata or binary handling requires a documented wrapper.

## Trigger ownership and safety

The trigger is limited to “Alert Triggered.” Preferred automation creates or reuses a template and webhook destination, validates a non-URL secret header, and attaches only explicitly selected alerts. Every created artifact must carry an ownership marker derived from workflow/node identity, be read back before mutation, and be removed only when still owned and unshared. Existing user artifacts are never adopted or deleted. If OpenObserve cannot guarantee this lifecycle through supported APIs, activation fails closed to documented manual attachment; deactivation only removes n8n state.

SSRF risk is minimized because OpenObserve calls the n8n webhook, not a user-selected arbitrary target through n8n. Secrets must never appear in names, logs, outputs, or query strings. Payload authenticity, replay handling, retries, and activation rollback require focused tests before registration.

## Licensing boundary

This repository is an independent MIT-licensed API integration and is not affiliated with or endorsed by OpenObserve. The OpenObserve server and generated Swagger contract identify AGPL-3.0 licensing. We use public API facts and links, do not copy server source, do not vendor generated clients, and do not redistribute the generated contract. Any future pinned spec fixture must first document its license, exact provenance, minimality, and refresh process.

## ADRs

1. **One conventional action node plus one webhook trigger.** Resource/operation routing keeps n8n discovery simple; separate internal modules keep code reviewable.
2. **Generated OAS is structural authority; human docs are semantic authority; live tests decide behavior.** Conflicts remain visible in `api-matrix.md` rather than guessed away.
3. **Prefer current v2 endpoints.** Alerts use `/api/v2`; legacy alert CRUD is not a fallback. Mixed-version routes such as alert history are retained only where the current contract does so.
4. **No runtime dependencies.** `n8n-workflow` remains host-provided. Additions require an architecture and verification review.
5. **Raw JSON for high-entropy schemas.** This avoids brittle, incomplete UI while retaining controlled transport and validation.
6. **Destructive and side-effecting operations are explicit.** Stream deletion, field deletion, manual alert triggering, and trigger artifact cleanup require clear labels and tests.
7. **Edition-aware, capability-tested behavior.** A route in Cloud Swagger is not evidence that it works in OSS. Enterprise-aware features are deferred unless clearly gated.
8. **No release claims during discovery.** The shell exists only to keep the package scaffold buildable; README and changelog state that it is not yet functional or released.

## Batch boundaries

- Batch 0: research, identity, inert scaffold, CI, local OSS harness.
- Batch 1: credential design, transport/error/date/JSON helpers, health/auth contract tests.
- Later action batches: implement only matrix operations with focused unit + OSS/Cloud contract tests.
- Trigger batch: only after the documented feasibility and safety gate.
- Release batch: UX audit, compatibility declaration, package install test, first-publication bootstrap, provenance verification.
