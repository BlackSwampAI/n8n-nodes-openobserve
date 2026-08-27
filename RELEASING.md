# Releasing an n8n community node

This repository publishes only from `.github/workflows/publish.yml`. Never run `npm publish` locally for a version intended for n8n verification.

## Before development

1. Create the final public GitHub repository from this template.
2. Choose the final npm name beginning with `n8n-nodes-` and confirm it is available.
3. Replace all `<...>` placeholders in `package.json`, the README, metadata, and source files.
4. Keep `.github/workflows/publish.yml` on the default `main` branch from the beginning.
5. Do not create a version tag yet.

## Release gate

Run:

```sh
npm ci
npm run lint
npm run build
npm run release:check
npm pack --dry-run
git diff --check
```

Also install the packed tarball in a disposable n8n instance and verify credentials, operations, outputs, errors, and any trigger behavior. Replace the starter README with `README_TEMPLATE.md` and document installation, compatibility, credentials, operations, resources, and license.

## First publication as 0.1.0

npm requires a package to exist before it can have a Trusted Publisher. Bootstrap the first version without sacrificing provenance:

1. Create a temporary granular npm access token with publish access only to the new package and the required 2FA bypass for CI.
2. Add it to the GitHub repository as an Actions secret named `NPM_TOKEN`.
3. Confirm `package.json` is `0.1.0`, CI is green, and `npm run release:check` passes.
4. Create and push an annotated `v0.1.0` tag on the validated release commit.
5. Watch the Publish workflow through the final release step.
6. Verify `npm view <package>@0.1.0 dist.attestations --json` contains SLSA provenance.
7. Create the matching GitHub release.

The temporary token authenticates the first GitHub Actions run; GitHub still supplies the provenance identity.

## Switch to OIDC immediately

After the package exists, add an npm Trusted Publisher:

- Provider: GitHub Actions
- Repository owner: the exact GitHub owner
- Repository name: the exact repository name
- Workflow filename: `publish.yml`
- Environment: blank unless the workflow declares a matching GitHub Environment
- Allowed action: npm publish

Delete the `NPM_TOKEN` GitHub secret and revoke the temporary npm token. The existing workflow will then use OIDC automatically.

## Later releases

1. Update the package version and changelog.
2. Run the complete release gate.
3. Commit and push the release state to `main`.
4. Create and push the matching annotated `v<version>` tag.
5. Verify GitHub Actions, npm `latest`, the attestation, and the GitHub release.

npm versions and published tags are immutable. Never reuse a version, move a published tag, or delete and recreate release history to hide a correction.
