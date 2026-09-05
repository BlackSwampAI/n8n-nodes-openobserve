# n8n nodes for OpenObserve

Independent Black Swamp AI n8n community integration for self-hosted [OpenObserve](https://openobserve.ai/) and OpenObserve Cloud.

This project is not affiliated with, endorsed by, sponsored by, or maintained by OpenObserve. The OpenObserve name and logo belong to their respective owner(s) and are used only to identify compatibility.

> [!WARNING]
> This repository contains a 0.1.0 release candidate. It has not been published or declared production-ready.

## Installation

There is no installable npm release yet. After the repository is public and the release checklist is approved, install `@blackswampai/n8n-nodes-openobserve` in n8n under **Settings → Community Nodes**. Releases are published only by the tag-triggered GitHub Actions workflow with npm provenance; local publication is unsupported.

## Compatibility

| Component         | Validated baseline                                                               | Notes                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Node.js           | 22.22 or newer                                                                   | Enforced by package metadata; the release workflow uses Node.js 24.                                        |
| n8n               | 2.37.10 disposable runtime; host-provided `n8n-workflow` 2.33.2 compile boundary | The packed action, trigger, credential, resources, and operations loaded from a clean `/tmp` installation. |
| OpenObserve OSS   | v0.92.2, pinned by immutable image digest                                        | Writable lifecycles are exercised only against the local disposable organization.                          |
| OpenObserve Cloud | Current generated OAS reviewed                                                   | Runtime execution remains unverified because no designated Cloud credentials were supplied.                |

## Credentials

Configure the OpenObserve API credential with:

- **Base URL**: Cloud or self-hosted API origin, including an optional reverse-proxy path.
- **Organization ID**: the configured OpenObserve organization.
- **Email / Account Identifier** and **Secret**: HTTP Basic credentials. The secret can be a user password or a self-hosted service-account token.

Service accounts are preferred for self-hosted production automation. OpenObserve Cloud currently requires user credentials because service accounts are not supported there. Never put production credentials in `docker-compose.yml` or committed fixtures.

## Operations

- Stream: Create, Get Many, Get Schema, Update Settings, Delete Fields, and Delete for log, metric, and trace stream types.
- Log: Ingest one structured JSON object or batch all n8n input-item JSON objects through OpenObserve's ordinary JSON-array endpoint.
- Search: SQL Query, Get Field Values, and current POST Search Around.
- Metric: ordinary JSON Ingest/Ingest Many plus PromQL instant/range queries, metadata, labels, label values, and series discovery.
- Trace: read-only Get Latest and Get DAG. Enterprise-only Service Graph is not exposed.
- Function: Create, Get Many, Get Dependencies, Update, Delete, and Validate VRL.
- Dashboard: Create, Get, Get Many, Update, and Delete with version/hash-preserving updates.
- Alert Template: Create, Get, Get Many, Get Prebuilt, Update, and Delete.
- Alert Destination: webhook Create, Get, Get Many, Update, and Delete, with returned header values redacted.
- Alert: scheduled/real-time Create, Get, Get Many, Update, Delete, Enable/Disable, Trigger Manually, Clone, Get History, and JSON Export.
- OpenObserve Trigger: Alert Triggered for explicitly selected alerts, with secret-authenticated webhook delivery and owned lifecycle artifacts.
- Pipeline: real-time and scheduled Create, Get, Get Many, Update, Delete, Enable/Disable, and Get History using validated structured graphs.

Ingestion can infer and create log or metric streams. Destructive operations and manual alert triggering require confirmation. Deferred and potential post-v0.1 surfaces are documented in [docs/api-matrix.md](docs/api-matrix.md); panel CRUD and Enterprise-only Service Graph remain deferred.

## Usage

Resource locators select existing streams, dashboards, alerts, and pipelines and retain manual name/ID modes for expressions. Structured JSON fields cover high-entropy OpenObserve definitions; documented friendly fields take precedence.

- **Log → Ingest** sends one JSON object as a one-element JSON array without adding n8n metadata. **Ingest Many** sends input items in order and preserves lineage to all items.
- **Search → Query** accepts ordinary Start/End values and converts them to OpenObserve microseconds. Normalized JSON rows support Return All; raw and formatted responses are intentionally single-response modes.
- Metric query operations expose PromQL directly. Series discovery supports repeated `match[]` values.
- Pipeline JSON contains `source`, `nodes`, and `edges`. Real-time pipelines need an explicit default/same-stream route when unmatched events must not be dropped.

The Alert Triggered node creates one deterministic template and webhook destination and adds only that destination to explicitly selected alerts. It stores a separate random secret in n8n node static data and validates inbound delivery in constant time. Deactivation removes only its exact attachment and owned artifacts; ambiguous ownership fails closed. OpenObserve retries can produce duplicate executions because payloads have no universal stable event ID. Workflows needing exactly-once effects should deduplicate or make side effects idempotent; alert identity plus trigger time can assist.

## Resources

- [OpenObserve API documentation](https://openobserve.ai/docs/reference/api/)
- [OpenObserve alert documentation](https://openobserve.ai/docs/user-guide/alerts/)
- [n8n community node installation](https://docs.n8n.io/integrations/community-nodes/installation/)
- [API and edition matrix](docs/api-matrix.md)
- [Architecture and safety decisions](docs/architecture.md)
- [Validation record and local test procedure](docs/testing.md)

## Development

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run package:check
docker compose config
```

The local OpenObserve harness and smoke procedure are documented in [docs/testing.md](docs/testing.md). Architecture decisions and trigger safety rules are in [docs/architecture.md](docs/architecture.md).

## Release status

Version 0.1.0 is a release candidate only; no package, tag, or GitHub release exists. n8n verification and provenance-backed publication require a public repository, so repository visibility must be confirmed before release. See [RELEASING.md](RELEASING.md) for the authorized first-publication bootstrap and immediate Trusted Publisher transition.

## License

This independent integration is available under the [MIT License](LICENSE.md). OpenObserve is a separate project with its own licensing.
