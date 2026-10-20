# Message a DeepSeek Harness Workflow Suspension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `Message a DeepSeek Harness` wait for Harness `ask_user_question` input in a Chat Trigger workflow and resume the same Harness session from editor Chat or public Chat.

**Architecture:** The Harness RPC service follows both `session/follow` and `$events`. It returns a Harness question through the existing internal suspension result. The node owns Harness-specific task metadata, waiting, and resume. The shared Chat transport gains a `harness_question` renderer but keeps the existing resume envelope.

**Tech Stack:** TypeScript, Zod, WebSocket Remote Mux, n8n workflow engine, Vue 3, Element Plus, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-message-deepseek-harness-workflow-suspension-design.md`

## Global Constraints

- Support Harness `ask_user_question` only.
- Do not support Harness approval requests.
- Do not reuse saved Agent checkpoints or `agentWorkflowSuspension` metadata.
- Reuse the existing `agent-suspension-response` Chat envelope.
- Enable waiting only for resumable Chat Trigger executions with a session ID.
- Resume the same Harness session without sending the original prompt again.
- Preserve earlier item outputs when a later item suspends.
- Remove the interaction card after a successful submission.
- Keep normal Harness output, streaming, workspace, and session behavior compatible.
- Keep the 30-second timeout for discrete Harness RPC requests.
- Do not add an n8n response timeout to the Harness follow stream.
- Do not implement timed question waits or late-answer fallback.
- Use i18n for new editor text.
- Use design-system components and CSS variables in frontend code.
- Use pnpm for all commands.

## Review Focus

- A custom session ID in a non-Chat workflow must not enable Harness waiting. Task 3 adds this test.
- A Remote Event reconnect has a new client ID but must use the stable event ID. Task 2 adds this test.
- A missing live Remote Event must fail without sending an answer to another question. Task 2 adds this test.
- A stale or duplicate card must not answer Harness twice. Tasks 2, 3, and 5 add this test.
- A suspended later input item must not rerun earlier items. Task 3 adds this test.

---

### Task 1: Define the Harness question contracts

**Files:**

- Modify: `packages/@n8n/api-types/src/agents/workflow-suspension.schema.ts`
- Modify: `packages/@n8n/api-types/src/chat-hub.ts`
- Modify: `packages/workflow/src/interfaces.ts`
- Test: `packages/@n8n/api-types/src/agents/__tests__/workflow-suspension.schema.test.ts`

**Interfaces:**

- Adds `harnessQuestionSchema` and `harnessQuestionInteractionPayloadSchema`.
- Adds `interactionType: 'harness_question'` to `AgentWorkflowInteraction` and `ChatNodeMessageAgentInteraction`.
- Adds `DeepSeekHarnessWorkflowWaitMetadata` to `ITaskMetadata.deepSeekHarnessWorkflowSuspension`.
- The metadata stores profile ID, session ID, item index, completed outputs, current suspension, and optional `ExecuteAgentResume`.

- [ ] **Step 1: Write failing schema tests**

Test a single-select question, a multi-select question, a text question, several questions in one payload, and an invalid empty question list. Verify that the existing resume envelope preserves the Harness answer shape.

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `pushd packages/@n8n/api-types; pnpm test src/agents/__tests__/workflow-suspension.schema.test.ts; popd`

Expected: FAIL because `harness_question` is not accepted.

- [ ] **Step 3: Implement and export the contracts**

Use strict Zod objects. Keep the payload equal to the Harness fields in the approved spec. Keep workflow-only metadata out of `@n8n/api-types`.

- [ ] **Step 4: Run tests and type checks**

Run: `pushd packages/@n8n/api-types; pnpm test src/agents/__tests__/workflow-suspension.schema.test.ts; pnpm typecheck; popd`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/@n8n/api-types packages/workflow/src/interfaces.ts
git commit -m "feat: add harness question interaction contracts"
```

### Task 2: Follow and resume Harness user questions

**Files:**

- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness-rpc.service.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness.service.ts`
- Modify: `packages/cli/src/workflow-execute-additional-data.ts`
- Test: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness-rpc.service.test.ts`

**Interfaces:**

- `DeepSeekHarnessRpcService.execute(..., options)` accepts `supportsHitl?: boolean` and `resume?: ExecuteAgentResume`.
- The initial path opens `session/follow` and `$events`, then sends `session/prompt` after both streams are ready.
- A `user-questions/request` waterfall event returns `ExecuteAgentData.suspension` with `toolName: 'ask_user_question'`.
- The resume path reuses the session and settles the matching live event through `$events/result`.
- `DeepSeekHarnessService.executeForWorkflow(...)` forwards the interaction options.
- `workflow-execute-additional-data.ts` forwards `supportsHitl` and `resume` for the Harness source.

- [ ] **Step 1: Write failing Remote Event parsing tests**

Test `$events` readiness, one valid `user-questions/request`, ignored unrelated events, and an unsupported question outside the HITL gate.

- [ ] **Step 2: Write failing resume tests**

Test live `$events/result` with a new client ID, missing event failure, stale event rejection, duplicate answer prevention, and a second question after resume. Verify that the service does not call `userQuestions/attachWait` or `userQuestions/answer`.

- [ ] **Step 3: Run the RPC test and verify it fails**

Run: `pushd packages/cli; pnpm test src/modules/deepseek-harness/__tests__/deepseek-harness-rpc.service.test.ts; popd`

Expected: FAIL because the RPC service follows only the session stream.

- [ ] **Step 4: Implement the Remote Mux interaction state machine**

Keep frame parsing in focused pure helpers. Use one authenticated connection when possible. Close all streams when the call completes, suspends, or fails. Preserve the duplicate-text behavior. Do not add a follow-stream response timeout.

- [ ] **Step 5: Forward invocation options through the workflow bridge**

Forward only the current `supportsHitl` and `resume` values. Do not add a Harness-specific method to the generic execution context.

- [ ] **Step 6: Run focused CLI tests and type checks**

Run: `pushd packages/cli; pnpm test src/modules/deepseek-harness/__tests__/deepseek-harness-rpc.service.test.ts; pnpm typecheck; popd`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/modules/deepseek-harness packages/cli/src/workflow-execute-additional-data.ts
git commit -m "feat: resume harness user questions"
```

### Task 3: Add the Harness node waiting state machine

**Files:**

- Modify: `packages/nodes-base/nodes/DeepSeekHarness/DeepSeekHarness.node.ts`
- Test: `packages/nodes-base/nodes/DeepSeekHarness/__tests__/DeepSeekHarness.node.test.ts`

**Interfaces:**

- `DeepSeekHarness` exposes `onMessage(this: IExecuteFunctions, data: INodeExecutionData)`.
- `supportsHarnessWorkflowInteraction(context, sessionId)` requires a Chat Trigger resume context and a session ID.
- `execute()` passes `supportsHitl` and the stored one-time resume command to `executeAgent()`.
- A suspension stores `deepSeekHarnessWorkflowSuspension`, emits `harness_question`, and calls `putExecutionToWait()`.
- A resumed multi-item execution restores completed output and starts at the stored item index.

- [ ] **Step 1: Write failing capability tests**

Test editor Chat, public Chat Trigger, non-Chat manual, non-Chat webhook, missing session ID, and custom session ID without Chat Trigger context.

- [ ] **Step 2: Write failing wait and resume tests**

Test initial wait metadata, emitted interaction, indefinite wait, malformed response rejection, stale response rejection, one-time command storage, completion cleanup, chained suspension replacement, and no prompt replay on resume.

- [ ] **Step 3: Write the failing multi-item test**

Suspend the second item. Verify that resume restores the first output, resumes the second item, and then processes later items once.

- [ ] **Step 4: Run the node test and verify it fails**

Run: `pushd packages/nodes-base; pnpm test nodes/DeepSeekHarness/__tests__/DeepSeekHarness.node.test.ts; popd`

Expected: FAIL because the node has no waiting state or `onMessage()`.

- [ ] **Step 5: Implement the node state machine**

Use the existing Chat capability check pattern from `Message an Agent`. Keep all Harness metadata under its dedicated property. Return the existing final JSON shape after completion.

- [ ] **Step 6: Run node tests and type checks**

Run: `pushd packages/nodes-base; pnpm test nodes/DeepSeekHarness/__tests__/DeepSeekHarness.node.test.ts; pnpm typecheck; popd`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/nodes-base/nodes/DeepSeekHarness packages/workflow/src/interfaces.ts
git commit -m "feat: wait for harness questions in workflows"
```

### Task 4: Render Harness questions in editor Chat

**Files:**

- Create: `packages/frontend/editor-ui/src/features/ai/chatHub/components/ChatHarnessQuestion.vue`
- Modify: `packages/frontend/editor-ui/src/features/ai/chatHub/components/ChatAgentInteractionChunk.vue`
- Modify: `packages/frontend/@n8n/i18n/src/locales/en.json`
- Test: `packages/frontend/editor-ui/src/features/ai/chatHub/components/ChatHarnessQuestion.test.ts`
- Test: `packages/frontend/editor-ui/src/features/ai/chatHub/components/ChatMessage.test.ts`

**Interfaces:**

- `ChatHarnessQuestion` consumes the typed Harness question payload.
- It emits one Harness answer object for all questions.
- `ChatAgentInteractionChunk` routes only `harness_question` to this component.

- [ ] **Step 1: Write failing editor component tests**

Test single-select, multi-select, free text, several questions, optional header and detail, incomplete answer validation, exact submitted answer, disabled state, and retry after submission failure.

- [ ] **Step 2: Run the editor tests and verify they fail**

Run: `pushd packages/frontend/editor-ui; pnpm test src/features/ai/chatHub/components/ChatHarnessQuestion.test.ts src/features/ai/chatHub/components/ChatMessage.test.ts; popd`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement the editor renderer**

Use design-system controls and CSS variables. Use i18n for the submit action and validation text. Keep the existing approval, Chat Action, and JSON Render routes unchanged.

- [ ] **Step 4: Run editor tests, lint, and type checks**

Run: `pushd packages/frontend/editor-ui; pnpm test src/features/ai/chatHub/components/ChatHarnessQuestion.test.ts src/features/ai/chatHub/components/ChatMessage.test.ts; pnpm lint; pnpm typecheck; popd`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/editor-ui/src/features/ai/chatHub packages/frontend/@n8n/i18n/src/locales/en.json
git commit -m "feat: render harness questions in editor chat"
```

### Task 5: Render Harness questions in public Chat

**Files:**

- Create: `packages/frontend/@n8n/chat/src/components/HarnessQuestionInteraction.vue`
- Modify: `packages/frontend/@n8n/chat/src/components/MessageAgentInteraction.vue`
- Test: `packages/frontend/@n8n/chat/src/__tests__/HarnessQuestionInteraction.spec.ts`
- Test: `packages/frontend/@n8n/chat/src/__tests__/MessageAgentInteraction.spec.ts`
- Test: `packages/frontend/@n8n/chat/src/__tests__/Input.spec.ts`

**Interfaces:**

- `HarnessQuestionInteraction` consumes the same shared payload and emits the same Harness answer object.
- `MessageAgentInteraction` submits it through the existing hidden resume transport.
- Successful submission removes the card. A failed submission leaves it available.

- [ ] **Step 1: Write failing public Chat tests**

Test every question mode, exact answer transport, input blocking, duplicate prevention, successful card removal, failed-submit retry, and session restoration.

- [ ] **Step 2: Run the public Chat tests and verify they fail**

Run: `pushd packages/frontend/@n8n/chat; pnpm test src/__tests__/HarnessQuestionInteraction.spec.ts src/__tests__/MessageAgentInteraction.spec.ts src/__tests__/Input.spec.ts; popd`

Expected: FAIL because `harness_question` has no renderer.

- [ ] **Step 3: Implement the public Chat renderer**

Use existing public Chat controls and theme variables. Do not import editor-ui. Keep the existing hidden transcript envelope.

- [ ] **Step 4: Run public Chat tests, lint, and type checks**

Run: `pushd packages/frontend/@n8n/chat; pnpm test src/__tests__/HarnessQuestionInteraction.spec.ts src/__tests__/MessageAgentInteraction.spec.ts src/__tests__/Input.spec.ts; pnpm lint; pnpm typecheck; popd`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/@n8n/chat
git commit -m "feat: render harness questions in public chat"
```

### Task 6: Verify the integrated workflow

**Files:**

- Modify: `docs/superpowers/specs/2026-10-15-message-deepseek-harness-workflow-suspension-design.md`
- Modify: `docs/superpowers/plans/2026-10-15-message-deepseek-harness-workflow-suspension.md`

**Interfaces:**

- No new interface. This task verifies the cross-package contract.

- [ ] **Step 1: Run focused tests in all owning packages**

Run the commands from Tasks 1 through 5.

Expected: PASS.

- [ ] **Step 2: Build after shared type changes**

Run: `pnpm build > build.log 2>&1`

Expected: exit code 0.

- [ ] **Step 3: Run affected tests**

Run: `pnpm test:affected`

Expected: PASS.

- [ ] **Step 4: Run package lint and type checks**

Run lint and typecheck from `packages/@n8n/api-types`, `packages/cli`, `packages/nodes-base`, `packages/frontend/editor-ui`, and `packages/frontend/@n8n/chat`.

Expected: PASS.

- [ ] **Step 5: Verify the manual Chat flow**

Verify initial question, multi-question submission, a second question, browser reconnect, duplicate submission, stale submission, multi-item continuation, and final downstream execution.

- [ ] **Step 6: Check the diff**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 7: Commit final integration fixes**

```bash
git add docs packages
git commit -m "test: verify harness workflow questions"
```
