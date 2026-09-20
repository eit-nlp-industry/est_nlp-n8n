# DeepSeek Harness Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated DeepSeek Harness agent capability to n8n without modifying the DeepSeek Harness source code.

**Architecture:** Each n8n DeepSeek Harness agent maps to one Harness profile and one isolated `DSH_HOME` directory. A runtime manager starts one runtime for the profile only when it is active. The current frontend entry is an extension of the existing Agents module so it is visible whenever the existing Agents module is active.

**Tech Stack:** Vue 3, TypeScript, Pinia, `@n8n/design-system`, `@n8n/i18n`, n8n frontend modules, TypeORM migrations, Docker or process runtimes, DeepSeek Harness Studio.

**Spec:** `docs/superpowers/specs/2026-09-20-deepseek-harness-integration.md`

## Global Constraints

- Do not modify the DeepSeek Harness source code.
- Keep one writable runtime per `DSH_HOME` directory.
- Store DeepSeek Harness agents in a dedicated database model.
- Encrypt connection data through `cipher.encryptV2()` and `cipher.decryptV2()`.
- Use i18n for all user-facing text.
- Use n8n design-system components and CSS variables.
- Use `pnpm` for all commands.

## Review Focus

- A profile must not load another profile's home directory, settings, or sessions.
- A second runtime for the same profile must fail before it writes data.
- A user without project access must not open, configure, or run the profile.
- An idle stop must preserve the profile data and must release its runtime lock.
- A workflow call must return a clear runtime-unavailable error when the runtime cannot start.

---

### Task 1: Add the frontend entry page

**Status:** Completed on 2026-09-20.

**Files:**

- Create: `packages/frontend/editor-ui/src/features/agents/views/DeepSeekHarnessListView.vue`
- Create: `packages/frontend/editor-ui/src/features/agents/__tests__/DeepSeekHarnessEntry.test.ts`
- Modify: `packages/frontend/editor-ui/src/features/agents/constants.ts`
- Modify: `packages/frontend/editor-ui/src/features/agents/module.descriptor.ts`
- Modify: `packages/frontend/editor-ui/src/features/collaboration/projects/components/ProjectHeader.vue`
- Modify: `packages/frontend/@n8n/i18n/src/locales/en.json`

**Interfaces:**

- Consumes: `AgentsModule`, `ProjectHeader`, `N8nEmptyState`, and the active `agents` module.
- Produces: `DeepSeekHarnessListView` and `ProjectDeepSeekHarness` route names.

- [x] **Step 1: Write the failing entry test**

Add a test that requires an Overview route at `/home/deepseek-harness`, a project route at `deepseek-harness`, and tabs placed after `Agents`.

- [x] **Step 2: Verify the test fails**

Run: `pnpm.cmd --filter n8n-editor-ui exec vitest run src/features/agents/__tests__/DeepSeekHarnessEntry.test.ts`

Expected result before implementation: the Overview route is undefined.

- [x] **Step 3: Add the minimal entry implementation**

Register both routes in `AgentsModule`. Reuse `ResourcesListLayout` and `ProjectHeader` so the page matches the Agent empty state. Add active no-op creation actions and i18n text. Do not add an API call, database entity, or runtime operation.

- [x] **Step 4: Verify the test passes**

Run: `pnpm.cmd --filter n8n-editor-ui exec vitest run src/features/agents/__tests__/DeepSeekHarnessEntry.test.ts`

Expected result: two tests pass.

### Task 2: Persist DeepSeek Harness agent identities

**Files:**

- Create: `packages/cli/src/modules/deepseek-harness/entities/deepseek-harness-agent.entity.ts`
- Create: `packages/cli/src/modules/deepseek-harness/database/deepseek-harness-agent.repository.ts`
- Create: `packages/cli/src/modules/deepseek-harness/services/deepseek-harness-agent.service.ts`
- Create: `packages/cli/src/modules/deepseek-harness/controllers/deepseek-harness-agent.controller.ts`
- Create: the next ordered file in `packages/@n8n/db/src/migrations/common/` named `CreateDeepSeekHarnessAgentTables.ts`
- Create: unit and API tests beside the owning module files.

**Interfaces:**

- Consumes: project identity, project scopes, encryption services, and `TransactionRunner`.
- Produces: a project-scoped DeepSeek Harness agent record with `id`, `projectId`, `name`, `profileId`, `status`, and timestamps.

- [ ] **Step 1: Write failing repository tests**

Create fixtures for two projects and two Harness agents. Assert that listing one project returns only its own agent records. Assert that duplicate names in one project return a `UserError`.

- [ ] **Step 2: Run the repository test**

Run the owning module's Vitest command with the new repository test path.

Expected result before implementation: the entity and repository imports do not resolve.

- [ ] **Step 3: Create the dedicated entity and migration**

Define a `deepseek_harness_agents` table. Use a unique index on `(projectId, name)`. Store the profile identifier, but do not store a physical `DSH_HOME` path from user input.

- [ ] **Step 4: Implement repository and service methods**

Implement `createForProject`, `listForProject`, `getForProject`, and `deleteForProject`. Pass `OperationContext` through repository calls in a `TransactionRunner` transaction.

- [ ] **Step 5: Add protected API routes**

Add project-scoped create, list, read, update, and delete routes. Gate every route with the correct `@ProjectScope` decorator.

- [ ] **Step 6: Verify database and API tests**

Run the owning module tests and the migration test suite. Confirm that cross-project reads and writes fail.

### Task 3: Create and manage profile directories

**Files:**

- Create: `packages/cli/src/modules/deepseek-harness/services/deepseek-harness-profile.service.ts`
- Create: `packages/cli/src/modules/deepseek-harness/services/deepseek-harness-profile.service.test.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/services/deepseek-harness-agent.service.ts`

**Interfaces:**

- Consumes: a persisted Harness agent `id` and a configured application data root.
- Produces: `getProfileHome(agentId): string`, which returns a deterministic, application-owned `DSH_HOME` directory.

- [ ] **Step 1: Write failing profile-home tests**

Set a test-owned application data root. Assert that two agent identifiers return different absolute directories. Assert that a path traversal string cannot produce a directory outside the configured root.

- [ ] **Step 2: Run the profile-home test**

Run: `pnpm --filter n8n test deepseek-harness-profile.service.test.ts`

Expected result before implementation: `getProfileHome` does not exist.

- [ ] **Step 3: Implement deterministic profile homes**

Build the directory from the configured root and a validated persisted identifier. Create the directory only through the service. Do not accept a path from an HTTP request.

- [ ] **Step 4: Create the profile during agent creation**

Call the profile service after the database record is created. If profile creation fails, roll back the database transaction or remove only the just-created profile directory.

- [ ] **Step 5: Verify isolation tests**

Run the profile tests with isolated filesystem paths. Confirm that no test accesses the developer home directory.

### Task 4: Add the runtime-manager contract

**Files:**

- Create: `packages/cli/src/modules/deepseek-harness/services/deepseek-harness-runtime-manager.ts`
- Create: `packages/cli/src/modules/deepseek-harness/services/deepseek-harness-runtime-manager.test.ts`
- Create: `packages/cli/src/modules/deepseek-harness/types/runtime.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/services/deepseek-harness-agent.service.ts`

**Interfaces:**

- Consumes: `agentId`, profile home path, runtime configuration, and an injected runtime launcher.
- Produces: `ensureRunning(agentId): Promise<RuntimeHandle>` and `stopIfIdle(agentId): Promise<void>`.

- [ ] **Step 1: Write failing runtime-lock tests**

Use a fake launcher. Call `ensureRunning` twice for the same agent. Assert that the launcher starts one runtime and both calls return the same handle. Call it for a second agent and assert that the launcher starts a second runtime with a different profile home.

- [ ] **Step 2: Run the runtime-manager test**

Run: `pnpm --filter n8n test deepseek-harness-runtime-manager.test.ts`

Expected result before implementation: the runtime manager import does not resolve.

- [ ] **Step 3: Implement a per-agent runtime lock**

Keep an in-memory lock keyed by the persisted agent id. Acquire the lock before launching. Release the lock only after the runtime stops or the launch fails.

- [ ] **Step 4: Implement idle shutdown**

Record the last activity time for each runtime. Stop only inactive runtimes. Preserve the profile home directory when the runtime stops.

- [ ] **Step 5: Verify runtime-manager tests**

Run the tests. Confirm that a failed launch releases the lock and permits a later retry.

### Task 5: Add the agent list and creation UI

**Files:**

- Modify: `packages/frontend/editor-ui/src/features/agents/views/DeepSeekHarnessListView.vue`
- Create: `packages/frontend/editor-ui/src/features/agents/components/DeepSeekHarnessAgentCard.vue`
- Create: `packages/frontend/editor-ui/src/features/agents/components/DeepSeekHarnessCreateModal.vue`
- Create: `packages/frontend/editor-ui/src/features/agents/composables/useDeepSeekHarnessAgents.ts`
- Create: component and composable tests beside the new files.

**Interfaces:**

- Consumes: the protected DeepSeek Harness agent API and the current project id.
- Produces: a project-scoped list, create action, and navigation to one Harness agent.

- [ ] **Step 1: Write failing list tests**

Mock the API response for one project. Assert that the page renders the agent name and status. Assert that an empty response shows an enabled create action for a user with create scope.

- [ ] **Step 2: Write failing creation tests**

Submit a name in the create modal. Assert that the API receives the project id and name. Assert that a duplicate-name response appears next to the name field.

- [ ] **Step 3: Implement the API composable and list page**

Load agents for the current project. Render cards with the n8n design system. Replace the current disabled action only after the create API exists.

- [ ] **Step 4: Implement the create modal**

Use an n8n dialog and input components. Disable submission while the request is active. Route to the created agent after the API returns successfully.

- [ ] **Step 5: Verify frontend tests**

Run the targeted Vitest files and the editor-ui lint command.

### Task 6: Open profile-scoped Harness Studio

**Files:**

- Create: `packages/cli/src/modules/deepseek-harness/services/deepseek-harness-studio.service.ts`
- Create: `packages/cli/src/modules/deepseek-harness/controllers/deepseek-harness-studio.controller.ts`
- Create: `packages/frontend/editor-ui/src/features/agents/components/DeepSeekHarnessStudioButton.vue`
- Create: service, controller, and component tests beside the owning files.

**Interfaces:**

- Consumes: a project-authorized Harness agent and its running runtime handle.
- Produces: a short-lived Studio launch URL that maps to that agent profile only.

- [ ] **Step 1: Write failing Studio authorization tests**

Use two agents from separate projects. Assert that a user can request a Studio URL for an accessible agent and receives an authorization failure for the other agent.

- [ ] **Step 2: Write failing profile-binding tests**

Use a fake runtime manager. Assert that the Studio service calls `ensureRunning` with the requested agent only and that the returned URL contains a new scoped token.

- [ ] **Step 3: Implement the Studio launch service**

Start or reuse the selected profile runtime. Mint a short-lived, single-profile token. Return a URL behind an n8n-controlled proxy. Do not return the runtime's unprotected local URL.

- [ ] **Step 4: Implement the protected controller and UI action**

Protect the controller with a project scope. Add an `Open Studio` action to the Harness agent page. Open the returned URL in a new tab only after the request succeeds.

- [ ] **Step 5: Verify Studio tests**

Run the controller, service, and component tests. Confirm that token reuse and cross-profile URLs fail.

### Task 7: Add a workflow node after the agent lifecycle is stable

**Files:**

- Create: `packages/nodes-base/nodes/DeepSeekHarness/DeepSeekHarness.node.ts`
- Create: `packages/nodes-base/nodes/DeepSeekHarness/DeepSeekHarness.node.test.ts`
- Create: the matching credential or connection selector only if the node requires a separate n8n credential.

**Interfaces:**

- Consumes: a selected persisted Harness agent, workflow input items, and the runtime-manager client.
- Produces: one workflow output item per input item with the Harness response or a clear execution error.

- [ ] **Step 1: Write failing execution tests**

Use a fake runtime client. Assert that the node sends each input item to the selected Harness agent. Assert that an unavailable runtime returns an `OperationalError` with a retry-safe message.

- [ ] **Step 2: Implement the minimal node contract**

Add an agent selector field and an input text field. Call the runtime manager through a backend API. Return structured response data without exposing profile paths, Studio tokens, or Harness credentials.

- [ ] **Step 3: Verify node tests and type checks**

Run the node test file, package lint, package typecheck, and the affected workflow execution tests.

## Plan Review

**Spec coverage:** Task 1 covers the current entry. Tasks 2 and 3 create an independent identity and profile boundary. Task 4 enforces one writer per profile. Tasks 5 and 6 add user-facing creation and Studio configuration. Task 7 adds workflow execution only after the lifecycle is stable.

**Placeholder scan:** This plan does not use implementation placeholders. Each planned task names the owning files, expected interfaces, failing-test behavior, and verification command.

**Type consistency:** `agentId` always means the persisted DeepSeek Harness agent identifier. `profileId` identifies the profile that owns one `DSH_HOME`. `RuntimeHandle` is returned only by the runtime manager.

**Review focus coverage:** Task 3 covers profile isolation. Task 4 covers duplicate runtime prevention and idle shutdown. Tasks 2 and 6 cover project authorization. Task 7 covers runtime-unavailable workflow errors.
