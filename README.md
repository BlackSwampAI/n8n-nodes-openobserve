# n8n nodes for OpenObserve

Independent n8n community integration for self-hosted [OpenObserve](https://openobserve.ai/) and OpenObserve Cloud, maintained by Black Swamp AI.

> [!WARNING]
> This repository is in discovery/scaffold development. The current code contains no OpenObserve credentials or operations and has not been published. Do not install it for production use.

## Installation

There is no installable release yet. When functionality and release validation are complete, the intended public package is `@blackswampai/n8n-nodes-openobserve`. Releases will be published only through GitHub Actions with npm provenance.

## Compatibility

The development baseline is Node.js 22.22 or newer and the host-provided `n8n-workflow` API. OpenObserve contract research currently targets the pinned OSS v0.92.2 test image and the current OpenObserve Cloud API; no runtime compatibility promise has been made yet.

## Credentials

Credentials are intentionally deferred to Batch 1. The design will support a configurable self-hosted or Cloud base URL, organization, and an authentication method verified against both environments. Never put production credentials in `docker-compose.yml` or committed fixtures.

## Operations

No operations are implemented in Batch 0. The proposed v0.1 resources and current API routes are frozen for review in [docs/api-matrix.md](docs/api-matrix.md). This README will list only implemented operations once they exist.

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

No package has been published. See [RELEASING.md](RELEASING.md) for the future GitHub Actions bootstrap and Trusted Publisher transition. Publishing, tagging, pushing, and release creation are outside the discovery batch.

## License

This independent integration is available under the [MIT License](LICENSE.md). OpenObserve is a separate project with its own licensing. This project is not affiliated with or endorsed by OpenObserve.
