# Releasing

`@blackswampai/n8n-nodes-openobserve` is an established npm package. Never publish locally: an authorized release must come from `.github/workflows/publish.yml` on the public `BlackSwampAI/n8n-nodes-openobserve` repository through npm Trusted Publishing and GitHub provenance.

## Release gate

Before creating a tag:

1. Confirm the repository is public and its GitHub owner, package repository URL, npm scope owner, Trusted Publisher configuration, and author identity agree.
2. Complete the non-destructive hosted smoke using runtime-supplied least-privilege credentials; never alter or delete the existing hosted stream.
3. Run `npm ci`, format check, lint, typecheck, full Vitest, build, `npm run scan:source`, `npm run package:check`, `npm run smoke:load`, `npm run smoke:install`, the pinned OSS live suites, a disposable current-n8n UI/execution smoke, and `git diff --check`.
4. Inspect the dry-run tarball: only package metadata, license, README, and intended `dist` artifacts may be present.
5. Confirm the intended version in `package.json`, the release commit is on `main`, CI is green, and the npm version and matching tag do not already exist.
6. Only after explicit user authorization, create the immutable annotated `v<package-version>` tag at that commit and push it. The workflow verifies that the tag exactly matches `package.json`, validates the candidate, and runs `n8n-node release` in GitHub Actions CI mode.

## Trusted Publishing

npm Trusted Publishing is the normal and only configured authentication path. npm is configured for GitHub owner `BlackSwampAI`, repository `n8n-nodes-openobserve`, and workflow `publish.yml`. The historical 0.1.0 bootstrap used a temporary token because npm required the package to exist before attaching a Trusted Publisher; that token and repository secret are not part of current releases and must not be recreated for routine publishing.

The workflows pin npm 11.19.0 before `npm ci` so Node.js 22 and 24 use the same lockfile semantics. `scripts/verify-npm-version.mjs` confirms npm supports Trusted Publishing. `scripts/prepare-npm-auth.mjs` removes only setup-node's empty registry-token placeholder so npm can perform the OIDC exchange; it never supplies credentials.

Before packaging, `npm run scan:source` applies scanner 0.34.0 to its official source patterns and separately to built `dist/**/*.js` plus `package.json`. After publication, `npm run scan:published` verifies registry provenance and attested public source. Its bounded retries allow only the observed exact-version metadata absence, analysis 404, and provenance source-repository 404 propagation states. A 403, policy/lint finding, timeout, rate limit, or unrelated failure exits immediately. The wrapper fails unless the scanner explicitly reports that the exact package name and version passed all security checks. Scanner 0.34.0 can misleadingly exit with status 0 while printing that security checks failed, so success text—not exit status alone—is authoritative.

After `publish` succeeds, the dependent `verify-published` job performs registry/provenance scanning separately. If only verification fails, use GitHub Actions **Re-run failed jobs**: this reruns the verifier without invoking `npm run release` again. Never rerun the successful publish job for an immutable npm version. Verify the exact npm version, `latest` dist-tag, provenance attestation, immutable Git tag, successful workflow, matching GitHub release, and scanner result before Creator Portal submission.

Submit only that exact published version. Visually inspect and record the Creator Portal card version and logo; a correct npm tarball does not guarantee fresh portal metadata.

npm versions and published tags are immutable. Never reuse or move them.
