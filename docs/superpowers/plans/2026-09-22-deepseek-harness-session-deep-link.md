# DeepSeek Harness Session Deep Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task.

**Goal:** Open the native DeepSeek Harness Trajectory view for the exact Session produced by a DeepSeek Harness workflow node.

**Architecture:** Extend the existing n8n execution-log session link to open the existing DeepSeek Harness Profile page with encoded query parameters. The Profile page appends those parameters to its embedded Studio URL. Add a small Harness Web bootstrap hook that consumes the parameters after the normal Session list becomes ready, selects the Session, and activates the native Trajectory view.

**Tech Stack:** TypeScript, Vue 3, n8n REST APIs, Harness Cordis client services, Vitest.

**Spec:** `.agents/specs/deepseek-harness-session-deep-link.md`

## Global Constraints

- Do not change Harness Agent, execution, RPC, or storage behavior.
- Do not duplicate Harness trajectory data in n8n.
- Reuse the existing project-scoped Profile route, Studio endpoint, and native Web process.
- Keep user-facing text in n8n i18n.
- Use URL encoding for all Session identifiers.
- Keep the existing n8n Agent session link behavior unchanged.

## Review Focus

- A valid DeepSeek Harness Session opens the matching Profile and Trajectory view.
- A missing Session does not select another Session by accident.
- Query parameters are removed after processing and are not retained on refresh.
- A missing or malformed node output does not render a View session action.
- A Profile URL with an existing query string receives the deep-link parameters correctly.

### Task 1: Harness Web deep-link behavior

**Files:**
- Modify: `D:/Programs/workbranch/deepseek-harness/packages/client/ui-workspace/src/client/navigation.ts`
- Modify: `D:/Programs/workbranch/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts`
- Test: `D:/Programs/workbranch/deepseek-harness/packages/client/ui-workspace/tests/workspaces-service.client.spec.ts`

**Interfaces:**
- Consumes: `n8nSessionId` and `n8nTrajectory` query parameters.
- Produces: selection of the requested Session and activation of the native `trajectory` view.

- [x] Write a failing test for the deep-link URL contract.
- [x] Run the focused Harness test and confirm it fails before the helper exists.
- [x] Implement a small navigation bootstrap that waits for ready Session data, opens the target, and clears the URL parameters.
- [x] Add the trajectory activation step through the existing `uiConversation` view API.
- [x] Handle an unavailable Session without selecting another Session.
- [x] Run the focused Harness tests and confirm they pass.

### Task 2: n8n DeepSeek Harness session link

**Files:**
- Modify: `packages/frontend/editor-ui/src/features/agents/composables/useMessageAgentSessionLink.ts`
- Modify: `packages/frontend/editor-ui/src/features/execution/logs/components/LogDetailsPanel.vue`
- Test: `packages/frontend/editor-ui/src/features/agents/__tests__/useMessageAgentSessionLink.test.ts`

**Interfaces:**
- Consumes: DeepSeek Harness node output with `session.agentId`, `session.projectId`, `session.sessionId`, and `session.profileUrl`.
- Produces: `{ href, open }` for a new tab, with `n8nSessionId` and `n8nTrajectory=1` query parameters.

- [x] Write a failing test for DeepSeek Harness output.
- [x] Run the focused n8n test and confirm it fails before DeepSeek Harness output is supported.
- [x] Implement the DeepSeek Harness branch without changing the n8n Agent branch.
- [x] Reuse the existing n8n-style View session button for either supported Session link.
- [x] Run the focused frontend tests and confirm they pass.

### Task 3: Profile page link contract

**Files:**
- Modify: `packages/frontend/editor-ui/src/features/agents/views/DeepSeekHarnessDetailView.vue`
- Test: `packages/frontend/editor-ui/src/features/agents/__tests__/DeepSeekHarnessDetailView.test.ts`

**Interfaces:**
- Consumes: Profile route query parameters and the existing Studio URL for the project-owned Agent.
- Produces: an embedded Studio URL with the Session deep-link parameters.

- [x] Add a Profile page test for forwarding Session parameters to Studio.
- [x] Keep the existing Studio endpoint stable.
- [x] Run the focused Profile page test and confirm it passes.

### Task 4: Verification and spec alignment

**Files:**
- Modify: `.agents/specs/deepseek-harness-session-deep-link.md`
- Modify: `docs/superpowers/plans/2026-09-22-deepseek-harness-session-deep-link.md`

- [x] Run focused Harness tests.
- [x] Run focused n8n frontend and CLI tests.
- [x] Run type checks for affected packages.
- [x] Run `git diff --check`.
- [x] Re-read the spec and update completed TODO items and interface drift.
