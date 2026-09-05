# Architecture and design decisions

## Intended layout

```text
nodes/
  OpenObserve/
    OpenObserve.node.ts       action-node registration and routing
    resources/<resource>/     operation descriptions, types, and execution
    shared/                   transport, pagination, errors, JSON, dates
  OpenObserveTrigger/         owned alert-webhook lifecycle and execution
credentials/
  OpenObserveApi.credentials.ts
tests/
  unit/ contract/ e2e/
```

Batches 1–6 added credentials/shared transport, bounded action resources, alert infrastructure, and the selected-alert trigger. Later batches add only the remaining bounded resource groups and their tests.

## API and authentication boundary

The implemented OpenObserve API credential requires a Base URL, Organization ID, Email / Account Identifier, and password-protected Secret. The required Base URL defaults to empty so the integration never assumes a Cloud or self-hosted deployment; validation accepts HTTP and HTTPS roots, including reverse-proxy paths, and normalization removes redundant trailing slashes. HTTPS is strongly recommended for every non-local deployment, but is not enforced because local and self-hosted OpenObserve installations may intentionally use HTTP. Requests use HTTP Basic authentication with the account identifier as the username and the Secret as either a user password or supported self-hosted service-account token. The organization is encoded into the path by a shared helper, never concatenated ad hoc by operations.

Shared helpers own authenticated requests, path-segment encoding, time conversion to API units, query serialization (including repeated Prometheus parameters), pagination, binary responses, response normalization, and actionable n8n error construction. The transport does not retry requests. Operations must not duplicate transport or silently fall back from v2 to deprecated endpoints.

## Input and output strategy

Common fields get typed n8n controls. Complex OpenObserve schemas use a raw JSON object/string option with parsing, object-only validation, and item-indexed errors. Raw JSON is an escape hatch, not an unreviewed URL/method escape: resource, org, authentication, and endpoint remain controlled by the node. Responses preserve OpenObserve data unless stable n8n pagination metadata or binary handling requires a documented wrapper.

## Trigger ownership and safety

The trigger is limited to “Alert Triggered.” Activation creates or reconciles one deterministic template and webhook destination, validates a non-URL secret header, and attaches only explicitly selected alerts. Persistent node static data records ownership and the random secret. Every owned artifact is read back and matched on stable content before mutation or deletion; existing user artifacts are never adopted or deleted. Deactivation performs full-alert GET/PUT preservation, bounded confirmation polling, fail-closed cross-folder reference scans, and dependency-ordered cleanup. Ambiguous or shared artifacts are retained with an actionable error and persistent ownership state.

SSRF risk is minimized because OpenObserve calls the n8n webhook, not a user-selected arbitrary target through n8n. Secrets must never appear in names, logs, outputs, or query strings. The shared secret authenticates delivery, but OpenObserve retries can produce duplicate workflow executions because there is no universal stable event ID. Workflows needing exactly-once effects must deduplicate or make downstream effects idempotent; trigger time plus alert identity can assist with an application-specific key.

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
9. **Dashboard updates preserve server state.** The node fetches the current versioned definition and conflict hash, then merges advanced JSON followed by explicitly selected friendly update fields. Omitted title and description remain unchanged; advanced JSON is the explicit escape hatch for broader changes. Dashboard selectors are scoped to the selected folder. Panel CRUD remains deferred because its tab/panel schema and conflict semantics warrant a separate UX design.
10. **Functions are VRL-only.** Create, Update, and Validate always send transformation type `0`, after advanced JSON is merged, so the node cannot silently switch to another transformation language.

## Batch boundaries

- Batch 0: research, identity, inert scaffold, CI, local OSS harness.
- Batch 1: credential design, transport/error/date/JSON helpers, health/auth contract tests.
- Batch 2: six Stream operations and ordinary JSON Log Ingest/Ingest Many, including pinned OSS coverage.
- Batch 3: SQL Search, ordinary JSON metrics plus Prometheus-compatible reads, and OSS-safe Trace Latest/DAG reads. Enterprise-only Service Graph is deferred.
- Batch 4: Function lifecycle/VRL validation and version-preserving Dashboard lifecycle. Panel CRUD remains deferred.
- Batch 5: reusable Alert Templates and webhook Destinations plus current-v2 scheduled/real-time Alert lifecycle and mixed-version history. Destination response headers are always redacted.
- Batch 6: the Alert Triggered webhook owns deterministic template/destination names and a random per-node secret in node static data. Activation unions its destination into selected alerts through full v2 GET/PUT preservation; rollback and deactivation remove only owned changes. Name collisions or changed ownership fields fail closed.
- Later action batches: implement only matrix operations with focused unit + OSS/Cloud contract tests.
- Trigger batch: only after the documented feasibility and safety gate.
- Release batch: UX audit, compatibility declaration, package install test, first-publication bootstrap, provenance verification.
