# DeepSeek Harness Agent Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Create DeepSeek Harness` create a project-scoped n8n record, open its detail page, and create an isolated Harness home directory without starting Harness or opening Studio.

**Architecture:** Add a dedicated backend module and table for DeepSeek Harness agents. The service derives each agent home from `GlobalConfig.deepSeekHarness.home`, the authenticated account email, the persisted agent name, and the persisted agent ID, so users never submit an arbitrary filesystem path. The frontend creates the agent from the project header or empty state and redirects to its detail page after the API returns.

**Tech Stack:** TypeScript, Vue 3, `@n8n/api-types`, `@n8n/config`, `@n8n/db`, TypeORM migrations, n8n REST decorators, `@n8n/design-system`, `@n8n/i18n`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-deepseek-harness-integration.md`

## Global Constraints

- Do not modify DeepSeek Harness source code.
- Read the root from `N8N_DEEPSEEK_HARNESS_HOME`; default to `~/.dsh`.
- Derive the agent home as `<N8N_DEEPSEEK_HARNESS_HOME>/<userName>/<agentName>-<agentId>`.
- Keep the old `<root>/agents/<agentId>` location for legacy deletion compatibility.
- Do not store a user-provided absolute path in the database.
- Do not start a Harness process or open Studio in this delivery.
- Use project scopes already required for n8n Agent creation: `agent:create`, `agent:list`, and `agent:read`.
- Use i18n for every user-facing string.
- Use design-system components and CSS variables.
- Use `pnpm.cmd` on Windows.

## Review Focus

- Generate the default name with the same prefix scan and highest-suffix rule used by workflow creation.
- The create request does not require a user-provided name.
- Support workflow-style inline renaming on the detail page.
- Move the account-scoped profile directory when the name changes.
- A failed directory creation must not leave a database row.
- A project must not read or create another project's agent.

---

### Task 1: Define the API contract

**Files:**

- Modify: `packages/@n8n/api-types/src/agents/dto.ts`
- Test: `packages/@n8n/api-types/src/agents/__tests__/deepseek-harness.dto.test.ts`

**Interfaces:**

- Produces `CreateDeepSeekHarnessAgentDto` for an empty creation payload and `DeepSeekHarnessAgentDto` for the generated agent.

- [x] Write a failing schema test for the empty creation payload and unsupported fields.
- [x] Run the API-types test and confirm it fails because the contract does not exist.
- [x] Implement the schema and exported types.
- [x] Run the focused API-types test and typecheck.
- [ ] Commit the contract independently.

### Task 2: Add persistence and project-scoped creation

**Files:**

- Create: `packages/cli/src/modules/deepseek-harness/deepseek-harness.module.ts`
- Create: `packages/cli/src/modules/deepseek-harness/entities/deepseek-harness-agent.entity.ts`
- Create: `packages/cli/src/modules/deepseek-harness/repositories/deepseek-harness-agent.repository.ts`
- Create: `packages/cli/src/modules/deepseek-harness/deepseek-harness.service.ts`
- Create: `packages/cli/src/modules/deepseek-harness/deepseek-harness.controller.ts`
- Create: `packages/@n8n/db/src/migrations/common/<next>-CreateDeepSeekHarnessAgents.ts`
- Test: service, repository, controller, and migration tests beside the owning files.

**Interfaces:**

- `POST /projects/:projectId/deepseek-harness/agents` accepts `{}` and returns `{ id, projectId, name, status, createdAt, updatedAt }`.
- `PATCH /projects/:projectId/deepseek-harness/agents/:agentId` updates the agent name and profile directory.
- `GET /projects/:projectId/deepseek-harness/agents` lists only agents in the requested project.
- `GET /projects/:projectId/deepseek-harness/agents/:agentId` returns only an agent owned by the requested project.
- The service exposes `createForProject`, `listForProject`, and `getForProject`.

- [x] Write failing service tests for workflow-style default naming, project scoping, and rollback on directory failure.
- [x] Run the tests and confirm the module, entity, and service do not resolve.
- [x] Add a table with `id`, `projectId`, `name`, `status`, timestamps, and a unique `(projectId, name)` index.
- [x] Add the project foreign key with cascade deletion.
- [x] Implement the protected controller using `@ProjectScope`.
- [x] Register the entity and controller in the backend module.
- [x] Run service, controller, and migration tests.
- [ ] Commit the backend persistence slice.

### Task 3: Create isolated Harness homes

**Files:**

- Create: `packages/cli/src/modules/deepseek-harness/deepseek-harness-home.service.ts`
- Test: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness-home.service.test.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness.service.ts`

**Interfaces:**

- `getHome(userName, agentName, agentId): string` returns the account-scoped profile path.
- `createHome(userName, agentName, agentId): Promise<string>` creates the directory and returns its path.
- The service never accepts a client-provided path.

- [x] Write failing tests for default and configured roots, path traversal-safe IDs, idempotent creation, and cleanup after persistence failure.
- [x] Run the tests and confirm the home service does not resolve.
- [x] Implement path derivation with the configured `GlobalConfig.deepSeekHarness.home` value and filesystem creation with `mkdir(..., { recursive: true })`.
- [x] Wrap database creation and home creation so a failed home operation removes only the newly created row or directory.
- [x] Run focused service tests and the config tests.
- [ ] Commit the isolation slice.

### Task 4: Add automatic creation and the agent detail page

**Files:**

- Create: `packages/frontend/editor-ui/src/features/agents/composables/useDeepSeekHarnessApi.ts`
- Modify: `packages/frontend/editor-ui/src/features/agents/constants.ts`
- Modify: `packages/frontend/editor-ui/src/features/agents/module.descriptor.ts`
- Modify: `packages/frontend/editor-ui/src/features/agents/views/DeepSeekHarnessListView.vue`
- Create: `packages/frontend/editor-ui/src/features/agents/views/DeepSeekHarnessDetailView.vue`

**Interfaces:**

- `useDeepSeekHarnessApi().create(projectId)` calls the protected REST endpoint with an empty payload.
- The list empty state and project header create the agent before navigating to its detail page.
- The create route creates the agent automatically and redirects to its detail page.
- The detail page displays a project and agent breadcrumb and reserves the main area for Harness Studio.

- [x] Write a failing component test for automatic creation and redirect.
- [x] Run the test and confirm the create route and API composable do not exist.
- [x] Add the automatic creation route and detail page with design-system components.
- [x] Replace the current no-op actions with navigation to the create route.
- [x] Add the list view navigation and detail-page placeholder without implementing Studio.
- [x] Run the focused frontend tests, lint, and typecheck.
- [ ] Commit the frontend creation slice.

### Task 5: End-to-end verification

- [x] Run the focused backend and frontend suites.
- [x] Run the affected package typechecks and lint checks.
- [ ] Start local n8n with `N8N_DEEPSEEK_HARNESS_HOME` set to a temporary directory.
- [ ] Create two agents in one project and verify two separate agent directories.
- [ ] Verify that no Harness process starts and no Studio URL is opened.
- [ ] Update the main spec and plan statuses with the delivered behavior.
