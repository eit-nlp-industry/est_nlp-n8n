# SDD ledger — plan: docs/superpowers/plans/2026-09-21-json-render-unified-interaction.md

## Setup

- Ruling: current dirty feature workspace used instead of an isolated worktree — implementation depends on existing uncommitted json-render work in both repositories; a new worktree would omit it — cost if wrong: reduced isolation from unrelated edits.
- Ruling: manual SDD workspace used because the Bash `sdd-workspace` helper failed with `E_ACCESSDENIED` — the same plan-scoped path and ledger contract are preserved — cost if wrong: helper-generated ownership metadata is absent.
- Ruling: skip per-task commits because both repositories contain pre-existing uncommitted/untracked feature work and commit permission was declined — tests and diffs are used as task boundaries — cost if wrong: no per-task rollback commits.

## Pre-flight

- Contract: `json-render-v1` interaction forms live only in `spec.elements` as `DynamicForm` elements; `meta.dynamicForm` is removed without a compatibility reader or writer.
- Contract: form fields remain accessible through protocol helpers so hosts never traverse `spec.elements.<id>.props.fields` directly.
- Contract: form actions use protocol-level submit/cancel action names and renderer registries dispatch them through the runtime action layer.
- Contract: resolved submit/cancel interactions render as read-only cards; robot-dog tool schemas and suspend/resume values remain unchanged.
- Scope: protocol, renderer registries, and the three n8n hosts only; robot-dog instructions and business logic are out of scope.

## Progress

- [x] Task 1 — canonical protocol form helpers and removal of `meta.dynamicForm`
- [x] Task 2 — Vue state/action runtime
- [x] Task 3 — Element Plus form registry and React canonical cleanup
- [x] Task 4 — n8n payload producers
- [x] Task 5 — shared n8n renderer and workflow chat migration
- [x] Task 6 — Agent Chat and Instance AI migration/read-only history
- [ ] Task 7 — verification, build, and local restart

Verification: independent review findings addressed (multiple-select state, hidden transport envelope, read-only history restoration, invalid-form guard). EIT final build 10/10 and test 4/4 tasks; n8n final full build 70/70; editor-ui and chat typecheck pass; Agent Chat, Instance AI, chat and backend targeted tests pass; changed frontend and CLI files pass targeted ESLint. Full CLI lint exhausted Node's default heap; full editor-ui lint was stopped under resource pressure after direct dependency declarations, then changed files passed targeted lint. No n8n process listens on 5678; only unrelated sandbox Docker containers are running, so no local app can be restarted without starting a new instance.
