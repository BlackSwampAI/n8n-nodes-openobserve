# n8n nodes for OpenObserve

Independent Black Swamp AI n8n community integration for self-hosted [OpenObserve](https://openobserve.ai/) and OpenObserve Cloud.

This project is not affiliated with, endorsed by, sponsored by, or maintained by OpenObserve. The OpenObserve name and logo belong to their respective owner(s) and are used only to identify compatibility.

> [!WARNING]
> This repository is in API-foundation development. The current code contains credentials and shared internal helpers but no OpenObserve business operations, and it has not been published. Do not install it for production use.

## Installation

There is no installable release yet. When functionality and release validation are complete, the intended public package is `@blackswampai/n8n-nodes-openobserve`. Releases will be published only through GitHub Actions with npm provenance.

## Compatibility

The development baseline is Node.js 22.22 or newer and the host-provided `n8n-workflow` API. OpenObserve contract research currently targets the pinned OSS v0.92.2 test image and the current OpenObserve Cloud API; no runtime compatibility promise has been made yet.

## Credentials

Configure the OpenObserve API credential with:

- **Base URL**: Cloud or self-hosted API origin, including an optional reverse-proxy path.
- **Organization ID**: the configured OpenObserve organization.
- **Email / Account Identifier** and **Secret**: HTTP Basic credentials. The secret can be a user password or a self-hosted service-account token.

Service accounts are preferred for self-hosted production automation. OpenObserve Cloud currently requires user credentials because service accounts are not supported there. Never put production credentials in `docker-compose.yml` or committed fixtures.

## Operations

No business operations are implemented in Batch 1. The current package provides only the credential and shared API foundation; the proposed v0.1 resources and current API routes are frozen for review in [docs/api-matrix.md](docs/api-matrix.md). This README will list only implemented operations once they exist.

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

No package has been published. See [RELEASING.md](RELEASING.md) for the future GitHub Actions bootstrap and Trusted Publisher transition. Publishing, tagging, pushing, and release creation are outside the current API-foundation batch.

## License

This independent integration is available under the [MIT License](LICENSE.md). OpenObserve is a separate project with its own licensing.
