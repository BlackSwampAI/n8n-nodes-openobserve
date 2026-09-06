# Releasing

Version 0.1.0 is a release candidate, not a published release. Never publish locally. An authorized release must come from `.github/workflows/publish.yml` on the public `BlackSwampAI/n8n-nodes-openobserve` repository and follow current n8n verification and npm provenance guidance.

## Release gate

Before creating a tag:

1. Make the repository public and confirm its GitHub owner, package repository URL, npm scope owner, and author identity agree.
2. Complete the non-destructive hosted smoke using runtime-supplied least-privilege credentials; never alter/delete the existing hosted stream.
3. Run `npm ci`, format check, lint, typecheck, full Vitest, build, `npm run package:check`, `npm run smoke:load`, `npm run smoke:install`, the pinned OSS live suites, a disposable current-n8n UI/execution smoke, and `git diff --check`.
4. Inspect the dry-run tarball: only package metadata/license/README and intended `dist` artifacts may be present.
5. Confirm `package.json` is exactly `0.1.0`, the release commit is on `main`, CI is green, and no tag/version already exists.
6. Only after explicit user authorization, create the immutable annotated `v0.1.0` tag at that commit and push it. The workflow validates the candidate and runs `n8n-node release` in GitHub Actions CI mode, which publishes the already-versioned package with provenance; it does not perform an interactive version bump there.

## First publication only

npm requires a package to exist before its Trusted Publisher can be attached. For an explicitly authorized first `0.1.0` publication, create a temporary narrowly scoped granular token, store it only as the GitHub Actions secret `NPM_TOKEN`, and let the tag workflow publish with GitHub provenance. Do not configure or store any token during development.

After npm contains the package, configure its GitHub Actions Trusted Publisher for owner `BlackSwampAI`, repository `n8n-nodes-openobserve`, workflow `publish.yml`, with no environment unless the workflow and npm configuration both declare the same one, and allow direct `npm publish` for this workflow. Delete the GitHub secret and revoke the temporary token immediately. Verify the exact npm version, `latest` dist-tag, provenance attestation, immutable Git tag, successful workflow, and matching GitHub release.

The workflow requires npm 11.5.1 or newer. Its authentication preparation retains setup-node's registry token entry only while `NPM_TOKEN` is present; after the secret is removed, it deletes only that empty placeholder from the temporary npm user config so npm can perform the OIDC exchange.

The publish workflow runs `npm run scan:published` immediately after publication. Its bounded retries allow npm registry propagation, and it fails unless scanner 0.34.0 prints `Package @blackswampai/n8n-nodes-openobserve@0.1.0 has passed all security checks`. The official scanner accepts only a published npm package, verifies its provenance, and fetches the attested public GitHub source, so it cannot meaningfully validate this unpublished package before its source is public. Scanner 0.34.0 can misleadingly exit with status 0 while printing that security checks failed; verify the explicit success text rather than trusting the exit code alone. A scanner failure blocks Creator Portal submission and must not be bypassed by renaming the valid scoped package.

npm versions and published tags are immutable. Never reuse or move them.
