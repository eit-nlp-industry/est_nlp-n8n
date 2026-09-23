# DeepSeek Harness Web Embedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Start the native DeepSeek Harness Web UI on demand and embed it in the n8n DeepSeek Harness agent detail page.

**Architecture:** Add an in-memory process manager to the DeepSeek Harness module. It starts one native Web process per active agent with `DSH_HOME` set to that agent's isolated directory and `--port 0`, then returns the authenticated URL. The detail page loads that URL in an iframe. Runtime state is not stored in the database.

**Tech Stack:** TypeScript, Node.js child processes, n8n REST controllers, Vue 3, Vitest.

**Spec:** `.agents/specs/deepseek-harness-web-embedding.md`

## Global Constraints

- Use the configured Harness source path from `N8N_DEEPSEEK_HARNESS_PATH`.
- Use `pnpm.cmd` through `cmd.exe` on Windows and `pnpm` on other platforms.
- Start Web with `--profile <profile> --no-open --port 0`.
- Keep process state in memory and stop children during service disposal.
- Protect the new project route with `@ProjectScope('agent:read')`.
- Keep all frontend text in i18n and use CSS variables for layout values.

## Review Focus

- A second Studio request for one agent must reuse the same process and URL.
- Two agents must receive different isolated homes and process entries.
- A child that exits before printing a URL must return a clear error.
- Windows must invoke `pnpm.cmd` through `cmd.exe`.
- A missing or cross-project agent must not start a process.

### Task 1: Process manager

**Files:**
- Create: `packages/cli/src/modules/deepseek-harness/deepseek-harness-web.service.ts`
- Test: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness-web.service.test.ts`

**Interfaces:**
- Consumes: `DeepSeekHarnessConfig`, `DeepSeekHarnessHomeService`, `DeepSeekHarnessAgentRepository`.
- Produces: `startForAgent(agentId, projectId): Promise<{ url: string }>` and `dispose(): Promise<void>`.

- [x] Write tests for reuse, isolated `DSH_HOME`, Windows command selection, and early child exit.
- [x] Run the focused test and confirm it fails because the service does not exist.
- [x] Implement the smallest process manager with injectable spawn and process boundaries.
- [x] Run the focused test and confirm it passes.

### Task 2: REST endpoint

**Files:**
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness.controller.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness.service.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness.module.ts`
- Test: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness.controller.test.ts`

**Interfaces:**
- Consumes: `DeepSeekHarnessWebService.startForAgent`.
- Produces: `GET /projects/:projectId/deepseek-harness/agents/:agentId/studio` returning `{ url }`.

- [x] Add a failing controller test for the scoped Studio route.
- [x] Run the focused test and confirm it fails.
- [x] Add the route, service method, DI registration, and project ownership check.
- [x] Run the focused test and confirm it passes.

### Task 3: Frontend embed

**Files:**
- Modify: `packages/frontend/editor-ui/src/features/agents/composables/useDeepSeekHarnessApi.ts`
- Modify: `packages/frontend/editor-ui/src/features/agents/views/DeepSeekHarnessDetailView.vue`
- Modify: `packages/frontend/@n8n/i18n/src/locales/en.json`
- Test: `packages/frontend/editor-ui/src/features/agents/__tests__/DeepSeekHarnessDetailView.test.ts`

**Interfaces:**
- Consumes: `GET .../studio` returning `{ url }`.
- Produces: iframe loading the native Studio URL in the existing detail content area.

- [x] Add a failing component test for loading and rendering the Studio iframe.
- [x] Run the focused test and confirm it fails.
- [x] Add API client method, loading/error state, iframe, and i18n fallback text.
- [x] Run the focused test and confirm it passes.

### Task 4: Verification and spec alignment

**Files:**
- Modify: `.agents/specs/deepseek-harness-web-embedding.md`
- Modify: `docs/superpowers/plans/2026-09-21-deepseek-harness-web-embedding.md`

- [x] Run the DeepSeek Harness module tests.
- [x] Run CLI typecheck and lint.
- [x] Run the editor UI focused tests and typecheck.
- [x] Re-read the spec and update completed TODO items and any interface drift.
- [x] Run `git diff --check`.
