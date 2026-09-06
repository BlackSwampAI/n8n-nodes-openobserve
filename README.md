# @blackswampai/n8n-nodes-openobserve

[![npm version](https://img.shields.io/npm/v/%40blackswampai%2Fn8n-nodes-openobserve)](https://www.npmjs.com/package/@blackswampai/n8n-nodes-openobserve)
[![CI](https://github.com/BlackSwampAI/n8n-nodes-openobserve/actions/workflows/ci.yml/badge.svg)](https://github.com/BlackSwampAI/n8n-nodes-openobserve/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/%40blackswampai%2Fn8n-nodes-openobserve)](LICENSE.md)

Independent Black Swamp AI n8n community integration for self-hosted [OpenObserve](https://openobserve.ai/) and OpenObserve Cloud.

> This is an unofficial Black Swamp AI community integration. It is not affiliated with, endorsed by, sponsored by, or maintained by OpenObserve. The OpenObserve name and logo belong to their respective owner(s) and are used only to identify compatibility.

[Installation](#installation) · [Compatibility](#compatibility) · [Credentials](#credentials) · [Operations](#operations) · [Troubleshooting](#troubleshooting) · [Resources](#resources)

## Installation

Install this package in a self-hosted n8n instance:

1. Open **Settings → Community Nodes**.
2. Select **Install** and enter `@blackswampai/n8n-nodes-openobserve`.
3. Review n8n's community-node warning and confirm the installation.

Releases are published only by the tag-triggered GitHub Actions workflow with provenance; local publication is unsupported. Verify the **Provenance** record on the npm package page or run `npm view @blackswampai/n8n-nodes-openobserve dist.attestations`.

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

- Stream: Get Many, Get Schema, Update Settings, Delete Fields, and Delete for log, metric, and trace stream types.
- Log: Ingest one structured JSON object or batch all n8n input-item JSON objects through OpenObserve's ordinary JSON-array endpoint.
- Search: SQL Query, Get Field Values, and current POST Search Around.
- Metric: PromQL instant/range queries, metadata, labels, label values, and series discovery.
- Trace: read-only Get Latest and Get DAG. Enterprise-only Service Graph is not exposed.
- Function: Create, Get Many, Get Dependencies, Update, Delete, and Validate VRL.
- Dashboard: Create, Get, Get Many, Update, and Delete with version/hash-preserving updates.
- Alert Template: Create, Get, Get Many, Get Prebuilt, Update, and Delete.
- Alert Destination: webhook Create, Get, Get Many, Update, and Delete, with returned header values redacted.
- Alert: scheduled/real-time Create, Get, Get Many, Update, Delete, Enable/Disable, Trigger Manually, Clone, Get History, and JSON Export.
- OpenObserve Trigger: Alert Triggered for explicitly selected alerts, with secret-authenticated webhook delivery and owned lifecycle artifacts.
- Pipeline: real-time and scheduled Create, Get, Get Many, Update, Delete, Enable/Disable, and Get History using validated structured graphs.

Log ingestion can infer and create its target stream. Continuous metrics should arrive through native collectors such as Prometheus, Telegraf, or OpenTelemetry; n8n focuses on log events, search/query, configuration, alerts/triggers, and remediation. Destructive operations and manual alert triggering require confirmation. Deferred and potential post-v0.1 surfaces are documented in [docs/api-matrix.md](docs/api-matrix.md); explicit stream provisioning, metric ingestion, panel CRUD, and Enterprise-only Service Graph remain deferred.

## Usage

Resource locators select existing streams, dashboards, alerts, and pipelines and retain manual name/ID modes for expressions. Structured JSON fields cover high-entropy OpenObserve definitions; documented friendly fields take precedence.

- **Log → Ingest** sends one JSON object as a one-element JSON array without adding n8n metadata. **Ingest Many** sends input items in order and preserves lineage to all items.
- **Search → Query** accepts ordinary Start/End values and converts them to OpenObserve microseconds. Normalized JSON rows support Return All; raw and formatted responses are intentionally single-response modes.
- Metric query operations expose PromQL directly. Series discovery supports repeated `match[]` values.
- Pipeline JSON contains `source`, `nodes`, and `edges`. Real-time pipelines need an explicit default/same-stream route when unmatched events must not be dropped.

The Alert Triggered node creates one deterministic template and webhook destination and adds only that destination to explicitly selected alerts. It stores a separate random secret in n8n node static data and validates inbound delivery in constant time. Deactivation removes only its exact attachment and owned artifacts; ambiguous ownership fails closed. OpenObserve retries can produce duplicate executions because payloads have no universal stable event ID. Workflows needing exactly-once effects should deduplicate or make side effects idempotent; alert identity plus trigger time can assist.

## Troubleshooting

- If the credential test fails, confirm that the Base URL contains no `/api/{org}` suffix and that the Organization ID matches the credential's account.
- If a dynamic selector is empty, confirm the credential can list that resource in the selected folder or stream type; manual locator modes remain available for expressions.
- Use HTTPS outside local development. Never paste credentials, destination headers, trigger secrets, or complete error payloads into an issue.
- For self-hosted and local-container details, see [docs/testing.md](docs/testing.md). Report reproducible package issues through the [project issue tracker](https://github.com/BlackSwampAI/n8n-nodes-openobserve/issues).

## Resources

- [OpenObserve API documentation](https://openobserve.ai/docs/reference/api/)
- [OpenObserve alert documentation](https://openobserve.ai/docs/user-guide/alerts/)
- [n8n community node installation](https://docs.n8n.io/integrations/community-nodes/installation/)
- [API and edition matrix](docs/api-matrix.md)
- [v0.1 minimum-configuration UX audit](docs/ux-requirements-audit.md)
- [Architecture and safety decisions](docs/architecture.md)
- [Validation record and local test procedure](docs/testing.md)
- [Branding and icon provenance](docs/branding.md)
- [Release process](RELEASING.md)

The packaged light and dark icons use the unmodified official OpenObserve product glyph from [`openobserve/openobserve` commit `c651f43f29c864478f5107612622a5e20492ea39`](https://github.com/openobserve/openobserve/blob/c651f43f29c864478f5107612622a5e20492ea39/web/src/assets/images/common/o2_logo.svg). Use of that mark does not imply affiliation, sponsorship, endorsement, or maintenance. See [branding and icon provenance](docs/branding.md).

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

## Release provenance

Published versions originate from immutable version tags through the repository's least-privilege GitHub Actions workflow. npm provenance links each package to its public source commit. Maintainers should follow [RELEASING.md](RELEASING.md) for release authorization and verification.

## License

This independent integration is available under the [MIT License](LICENSE.md). OpenObserve is a separate project with its own licensing.
