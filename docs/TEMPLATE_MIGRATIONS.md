# Template migrations

GitHub created this repository from a template snapshot. It does not inherit later template changes automatically.

The adopted reusable baseline and canonical source repository are recorded in `.blackswamp/template.json`. Updating that marker alone is not a migration: compare the canonical template version, assess every applicable script, workflow, test, and documentation change against this project's stronger OpenObserve-specific controls, run all local gates, and only then update the marker.

## 2.0.0 adopted

- Retained the official n8n source and built-output scanner preflight and explicit-success post-publication scan.
- Retained npm Trusted Publisher authentication preparation, npm version verification, generic compiled-registration load smoke, and isolated packed-install smoke.
- Adopted the machine-readable template marker, npm 11.19.0 tool pin, reusable PR checklist, batch-handoff guidance, and final API/testing/branding document invariants.
- Preserved the repository's stricter OpenObserve credential, icon-hash, lifecycle, package-boundary, and live-fixture checks.

Future migrations must remain bounded, must not overwrite project-specific decisions, and must not imply authorization to publish or mutate external services.
