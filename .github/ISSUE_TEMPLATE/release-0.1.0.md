---
name: Release 0.1.0
about: Track the first provenance-backed npm release
title: 'Release v0.1.0'
labels: release
assignees: ''
---

- [ ] Final public repository and npm package names selected
- [ ] All template placeholders and unused examples removed
- [ ] README installation, compatibility, credentials, operations, and license sections complete
- [ ] `npm ci`, lint, build, release audit, dry-run pack, and package installation checks pass
- [ ] Temporary granular npm token stored only as GitHub Actions secret `NPM_TOKEN`
- [ ] Release commit is on `main` and CI is green
- [ ] Annotated `v0.1.0` tag points to the release commit
- [ ] Publish workflow succeeds
- [ ] npm `latest` is `0.1.0` and SLSA provenance is present
- [ ] GitHub release exists
- [ ] npm Trusted Publisher configured for `publish.yml`
- [ ] `NPM_TOKEN` secret deleted and temporary npm token revoked
