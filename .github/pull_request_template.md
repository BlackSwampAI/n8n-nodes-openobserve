## Scope

- [ ] This PR implements one bounded outcome and does not include unrelated cleanup.
- [ ] Added dependencies, public API changes, and release-strategy changes were explicitly approved.
- [ ] `git diff --name-only` matches the assignment's allowed-file list.

## Evidence

- [ ] Required operation controls and blank/default-state behavior are covered.
- [ ] Resource locators are tested with manual strings and list-mode objects where applicable.
- [ ] OpenObserve claims distinguish generated contract, human documentation, and observed behavior.
- [ ] Live fixtures, if any, are target-guarded, exact-owned, and assert cleanup.

## Validation

- [ ] Format, lint, strict typecheck, and Vitest pass.
- [ ] Build and official source/built scanner preflight pass.
- [ ] Package boundary and compiled-registration load/install smokes pass.
- [ ] User-visible behavior was inspected in disposable n8n where practical; limitations are stated.

## Safety

- [ ] No secrets, production data, publication, tag, release, or unrelated external mutation occurred.
- [ ] Destructive behavior is confirmed, exact-targeted, and does not retry implicitly.
