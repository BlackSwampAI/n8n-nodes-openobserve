---
name: Release 0.1.0
about: Track the first provenance-backed npm release
title: 'Release v0.1.0'
labels: release
assignees: ''
---

- [ ] Repository is public and identity matches `BlackSwampAI/n8n-nodes-openobserve`
- [ ] npm scope ownership and package identity `@blackswampai/n8n-nodes-openobserve` confirmed
- [ ] Hosted `observe.blackswampai.com` least-privilege, non-destructive smoke passed
- [ ] README installation, compatibility, credentials, operations, and license sections complete
- [ ] `npm ci`, format check, lint, typecheck, full Vitest, build, release audit, and dry-run pack pass
- [ ] All guarded pinned OSS live suites pass and Compose is stopped without `-v`
- [ ] Packed package installs/loads in disposable current n8n; action, trigger, and credential are discovered
- [ ] Tarball contains only intended metadata/docs and `dist` artifacts
- [ ] Temporary granular npm token stored only as GitHub Actions secret `NPM_TOKEN`
- [ ] Release commit is on `main` and CI is green
- [ ] Annotated `v0.1.0` tag points to the release commit
- [ ] Publish workflow succeeds
- [ ] npm `latest` is `0.1.0` and SLSA provenance is present
- [ ] `@n8n/scan-community-package@0.34.0` prints an explicit successful result for the published package (do not trust its exit code alone)
- [ ] GitHub release exists
- [ ] npm Trusted Publisher configured for `publish.yml`
- [ ] `NPM_TOKEN` secret deleted and temporary npm token revoked
