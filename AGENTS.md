# Orchestrator and builder workflow

## Roles

- The human user and the primary Codex agent are co-orchestrators.
- The user supplies the prompts that define builder work.
- The only implementation sub-agent is `builder`, configured in `.codex/agents/builder.toml` to use `gpt-5.6-sol` with low reasoning effort.
- The primary agent remains the orchestrator. Do not pin its model or reasoning effort in this repository; the user controls those session settings.

## Delegation contract

- Do not spawn a builder merely to answer a question, inspect status, or discuss a possible task.
- When the user gives a concrete prompt intended for implementation, the primary agent should turn it into one bounded builder assignment without changing its intent.
- Spawn exactly one builder at a time. Explicitly select `gpt-5.6-sol` and low reasoning when the spawning interface supports overrides; otherwise use the project defaults.
- Give the builder the user's acceptance criteria, relevant constraints, and requested verification. Do not silently broaden the work.
- The builder owns implementation and focused verification. The primary agent owns requirements, coordination, review, and the final response to the user.
- Inspect the builder's result and repository diff. If the work is incomplete or checks fail, send targeted follow-up instructions to the same builder and re-review the result.
- Ask the user when a missing decision would materially change scope, behavior, dependencies, public APIs, data, or release actions.
- Do not create additional agents, delegate recursively, or parallelize edits unless the user explicitly changes this workflow.

## Repository safeguards

- Preserve unrelated changes in the worktree.
- Write automated tests as `*.test.ts` files and run them with Vitest. Reserve `.mjs` for genuine direct-execution operational or release tooling; document any exception.
- Use the scripts in `package.json` for validation. At minimum, run relevant focused checks; for completed code changes, run `npm run lint` and `npm run build` when practical.
- Do not publish packages, create releases or tags, push commits, or open pull requests unless the user explicitly asks.
- Follow `RELEASING.md` for any authorized release work.

## Template migrations and batch handoffs

- This repository records its adopted Black Swamp template version in `.blackswamp/template.json`. GitHub template repositories do not propagate later improvements automatically; review `docs/TEMPLATE_MIGRATIONS.md` before adopting a newer template revision.
- Use `docs/BATCH_HANDOFF_TEMPLATE.md` for bounded implementation batches. Record scope, evidence, verification, safety constraints, and explicitly deferred work without turning the handoff into authorization for release or external changes.
- Keep the final project documents `docs/api-matrix.md`, `docs/testing.md`, and `docs/branding.md` current. Do not add or retain uppercase template-source document copies in this generated repository.
