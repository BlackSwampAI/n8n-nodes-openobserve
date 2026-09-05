# Releasing

This package is not release-ready in Batch 0. Never publish locally. An authorized release must come from `.github/workflows/publish.yml` on the public `BlackSwampAI/n8n-nodes-openobserve` repository and must follow current n8n verification and npm provenance guidance.

## Release gate

Run `npm ci`, format check, lint, typecheck, unit/contract/E2E tests appropriate to the implemented scope, build, `npm run package:check`, a disposable packed-package n8n install, and `git diff --check`. Confirm the README lists real operations and compatibility rather than planned scope.

## First publication only

npm requires a package to exist before its Trusted Publisher can be attached. For an explicitly authorized first `0.1.0` publication, create a temporary narrowly scoped granular token, store it only as the GitHub Actions secret `NPM_TOKEN`, and let the tag workflow publish with GitHub provenance. Do not configure or store any token during development.

After npm contains the package, configure its GitHub Actions Trusted Publisher for owner `BlackSwampAI`, repository `n8n-nodes-openobserve`, workflow `publish.yml`, with no environment unless the workflow and npm configuration both declare the same one. Delete the GitHub secret and revoke the temporary token immediately. Verify the exact npm version, `latest` dist-tag, SLSA provenance, immutable Git tag, successful workflow, and matching GitHub release.

npm versions and published tags are immutable. Never reuse or move them.
