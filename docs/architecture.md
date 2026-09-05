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

Batch 0 registered an inert, compile-safe action-node shell. Batch 1 adds its credential and shared API foundation without adding resource operations or trigger registration; later batches add bounded resource groups and their tests.

## API and authentication boundary

The implemented OpenObserve API credential requires a Base URL, Organization ID, Email / Account Identifier, and password-protected Secret. The required Base URL defaults to empty so the integration never assumes a Cloud or self-hosted deployment; validation accepts HTTP and HTTPS roots, including reverse-proxy paths, and normalization removes redundant trailing slashes. HTTPS is strongly recommended for every non-local deployment, but is not enforced because local and self-hosted OpenObserve installations may intentionally use HTTP. Requests use HTTP Basic authentication with the account identifier as the username and the Secret as either a user password or supported self-hosted service-account token. The organization is encoded into the path by a shared helper, never concatenated ad hoc by operations.

Shared helpers own authenticated requests, path-segment encoding, time conversion to API units, query serialization (including repeated Prometheus parameters), pagination, binary responses, response normalization, and actionable n8n error construction. The transport does not retry requests. Operations must not duplicate transport or silently fall back from v2 to deprecated endpoints.

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
3. **Prefer current v2 endpoints through explicit routing.** Shared transport defaults to unversioned `/api/{org}` paths and requires operations such as Alerts to select `/api/v2/{org}` explicitly. Legacy alert CRUD is not a fallback. Mixed-version routes such as alert history are retained only where the current contract does so.
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
