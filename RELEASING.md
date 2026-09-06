# Releasing

Version 0.1.0 is a release candidate, not a published release. Never publish locally. An authorized release must come from `.github/workflows/publish.yml` on the public `BlackSwampAI/n8n-nodes-openobserve` repository and follow current n8n verification and npm provenance guidance.

## Release gate

Before creating a tag:

1. Make the repository public and confirm its GitHub owner, package repository URL, npm scope owner, and author identity agree.
2. Complete the non-destructive hosted smoke using runtime-supplied least-privilege credentials; never alter/delete the existing hosted stream.
3. Run `npm ci`, format check, lint, typecheck, full Vitest, build, `npm run scan:source`, `npm run package:check`, `npm run smoke:load`, `npm run smoke:install`, the pinned OSS live suites, a disposable current-n8n UI/execution smoke, and `git diff --check`.
4. Inspect the dry-run tarball: only package metadata/license/README and intended `dist` artifacts may be present.
5. Confirm the intended version in `package.json`, the release commit is on `main`, CI is green, and the npm version and matching tag do not already exist.
6. Only after explicit user authorization, create the immutable annotated `v<package-version>` tag at that commit and push it. The workflow validates the candidate and runs `n8n-node release` in GitHub Actions CI mode, which publishes the already-versioned package with provenance; it does not perform an interactive version bump there.

## First publication only

npm requires a package to exist before its Trusted Publisher can be attached. For an explicitly authorized first `0.1.0` publication, create a temporary narrowly scoped granular token, store it only as the GitHub Actions secret `NPM_TOKEN`, and let the tag workflow publish with GitHub provenance. Do not configure or store any token during development.

After npm contains the package, configure its GitHub Actions Trusted Publisher for owner `BlackSwampAI`, repository `n8n-nodes-openobserve`, workflow `publish.yml`, with no environment unless the workflow and npm configuration both declare the same one, and allow direct `npm publish` for this workflow. Delete the GitHub secret and revoke the temporary token immediately. Verify the exact npm version, `latest` dist-tag, provenance attestation, immutable Git tag, successful workflow, and matching GitHub release.

The workflows pin npm 11.16.0 before `npm ci` so Node.js 22 and 24 use the same lockfile semantics; Trusted Publishing itself requires npm 11.5.1 or newer. Authentication preparation retains setup-node's registry token entry only while `NPM_TOKEN` is present; after the secret is removed, it deletes only that empty placeholder from the temporary npm user config so npm can perform the OIDC exchange.

Before packaging, `npm run scan:source` applies scanner 0.34.0 to its official source patterns and separately to built `dist/**/*.js` plus `package.json`. The publish workflow retains `npm run scan:published` after publication. Its bounded retries allow likely registry/source propagation failures, and it fails unless the scanner explicitly reports that the exact package name and version passed all security checks. Scanner 0.34.0 can misleadingly exit with status 0 while printing that security checks failed; verify the explicit success text rather than trusting the exit code alone. A scanner failure blocks Creator Portal submission.

npm versions and published tags are immutable. Never reuse or move them.
