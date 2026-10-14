# Message an Agent Workflow Suspension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a saved Agent suspend inside `Message an Agent`, wait in a Chat Trigger workflow, and resume from a native approval or rich-card response in editor Chat or public Chat.

**Architecture:** The Agent checkpoint remains the source of truth. The workflow stores only correlation data and per-item loop progress in task metadata. `onMessage` validates the Chat envelope and stores a one-time resume command. The rerun of `execute()` consumes that command and calls a workflow-specific Agent resume path. Both Chat clients render one shared native interaction contract.

**Tech Stack:** TypeScript, Zod, n8n workflow engine, `@n8n/agents`, Vue 3, Pinia, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-message-an-agent-workflow-suspension-design.md`

## Current progress

The shared contracts, workflow Agent suspension and resume path, Message an Agent
wait state, Chat Hub mapping, editor Chat renderer, and public Chat renderer are
implemented. The focused workflow and node tests pass. Playwright coverage and
full end-to-end verification remain.

## Global Constraints

- Support saved Agents only. Do not enable suspension for inline Agents or DeepSeek Harness Agents.
- Enable suspension only for editor Chat and the public Chat Trigger URL.
- Derive the gate from the persisted Chat Trigger execution context, Chat session, and Chat resume channel. Do not add a second persisted capability boolean.
- Support native `approval` and `chat_action` interactions only.
- Reuse `richCardSchema`. Do not use `json-render-interaction` and do not create another form schema.
- Preserve Agent runtime checkpoint, concurrency, duplicate-resume, and resume-schema behavior.
- Do not add a timeout, a public resume endpoint, or a database table.
- Block ordinary text input while a native interaction is unresolved.
- Keep non-Chat workflow behavior unchanged. A suspension in that context must fail.
- Keep existing `ExecuteAgentData` fields backward compatible.
- Use i18n for all new user-facing editor text.
- Use design-system components and CSS variables in editor-ui.
- Use pnpm for all commands.

## Review Focus

- A custom session ID in a non-Chat workflow must not enable HITL. Task 3 adds this regression test.
- An old or duplicate card must not execute the tool twice or end a still-valid wait. Tasks 2, 3, and 4 add these tests.
- Invalid `resumeData` must leave the workflow waiting with the current cards active. Tasks 2 and 4 add these tests.
- `eachItem` must not rerun completed items after a later item suspends. Task 3 adds this test.
- A reconnect after the browser closes must restore unresolved cards without cancelling the execution. Tasks 4, 5, 6, and 7 add coverage.

---

### Task 1: Define the shared native interaction and resume contracts

**Files:**

- Create: `packages/@n8n/api-types/src/agents/workflow-suspension.schema.ts`
- Modify: `packages/@n8n/api-types/src/agents/index.ts`
- Modify: `packages/@n8n/api-types/src/chat-hub.ts`
- Modify: `packages/@n8n/api-types/src/index.ts`
- Modify: `packages/workflow/src/interfaces.ts`
- Test: `packages/@n8n/api-types/src/agents/__tests__/workflow-suspension.schema.test.ts`

**Interfaces:**

- Produces `agentWorkflowResumeMessageSchema` and `AgentWorkflowResumeMessage` with `{ type: 'agent-suspension-response', runId, toolCallId, resumeData }`.
- Produces `agentWorkflowInteractionSchema` and `AgentWorkflowInteraction`. The interaction has the correlation fields, `interactionType: 'approval' | 'chat_action'`, the native payload, and `blockUserInput: true`.
- Extends `ChatMessageContentChunk` with `{ type: 'agent-interaction'; interaction: AgentWorkflowInteraction; content?: undefined }`.
- Adds the structurally equivalent `ChatNodeMessageAgentInteraction` to `ChatNodeMessage`. `n8n-workflow` must not import `@n8n/api-types`.
- Adds `AgentWorkflowSuspensionData`, `ExecuteAgentResume`, and optional `ExecuteAgentData.suspension` to `n8n-workflow`.
- Adds `supportsHitl: boolean` to `ExecuteAgentInvocationContext`. `BaseExecuteContext` forwards the value that `Message an Agent` derives from the persisted execution context.

- [x] **Step 1: Write schema tests**

Test that approval and `chat_action` payloads parse. Test that the approved rich-card component types parse. Test that an unknown interaction type fails. Test that arbitrary `resumeData` remains intact in the transport envelope.

- [x] **Step 2: Run the schema test and verify it fails**

Run: `pushd packages/@n8n/api-types; pnpm test src/agents/__tests__/workflow-suspension.schema.test.ts; popd`

Expected: FAIL because the schemas do not exist.

- [x] **Step 3: Implement and export the contracts**

Use `richMessageSchema` for `chat_action`. Keep approval payload validation aligned with the existing Agent approval contract. Add only transport and rendering data. Do not place workflow metadata in the public contract.

- [x] **Step 4: Run tests and type checks**

Run: `pushd packages/@n8n/api-types; pnpm test src/agents/__tests__/workflow-suspension.schema.test.ts; pnpm typecheck; popd`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/@n8n/api-types packages/workflow/src/interfaces.ts
git commit -m "feat: add agent workflow suspension contracts"
```

### Task 2: Add workflow-specific Agent suspension and resume

**Files:**

- Modify: `packages/cli/src/modules/agents/workflow-agent-stream.ts`
- Modify: `packages/cli/src/modules/agents/execution-recorder.ts`
- Modify: `packages/cli/src/modules/agents/agent-workflow-execution.service.ts`
- Modify: `packages/cli/src/modules/agents/agent-execution-orchestrator.service.ts`
- Test: `packages/cli/src/modules/agents/__tests__/workflow-agent-stream.test.ts`
- Test: `packages/cli/src/modules/agents/__tests__/agent-workflow-execution.service.test.ts`
- Test: `packages/cli/src/modules/agents/__tests__/agent-execution-orchestrator.service.test.ts`

**Interfaces:**

- `WorkflowAgentStreamAdapter` exposes the complete current suspension set after stream consumption.
- `compileIsolated(..., options?: { supportsHitl?: boolean; integrationType?: string })` forwards `supportsHitl` and `N8N_CHAT_INTEGRATION_TYPE` only for the allowed workflow Chat path.
- `AgentExecutionOrchestratorService.validateResumeCheckpoint(...)` exposes the existing checkpoint ownership validation without performing a Chat runtime resume.
- `AgentWorkflowExecutionService.resumeForWorkflow(...)` rebuilds the saved Agent with the same workflow tools, output schema, sandbox scope, and Chat integration as the original call. It calls `agent.resume(resumeData, { runId, toolCallId })` through the existing recorded stream path.
- Both initial execution and resume return `ExecuteAgentData.suspension` when the runtime suspends.

- [ ] **Step 1: Add failing stream-adapter tests**

Test that all `tool-call-suspended` chunks are collected with `runId`, `toolCallId`, `toolName`, `suspendPayload`, and `resumeSchema`. Test that text and capability events keep their current behavior.

- [ ] **Step 2: Run the stream test and verify it fails**

Run: `pushd packages/cli; pnpm test src/modules/agents/__tests__/workflow-agent-stream.test.ts; popd`

Expected: FAIL because suspension chunks are ignored.

- [x] **Step 3: Collect suspension chunks**

End any open text response before recording a suspension. Return a snapshot of the current set. Do not decide UI type in the generic stream adapter.

- [ ] **Step 4: Add failing service tests**

Add tests for these cases:

- Chat-capable saved Agent compilation passes `supportsHitl: true` and the n8n Chat integration.
- Ordinary workflow compilation passes `supportsHitl: false`.
- Initial suspension returns all supported suspension data instead of throwing.
- Workflow resume rebuilds the same per-call tools and resumes the exact run and tool call.
- Invalid resume data propagates the runtime validation error without consuming the checkpoint.
- Missing and expired checkpoints return distinct terminal errors.
- A checkpoint with the wrong Agent, project, or thread is rejected.
- A duplicate or stale resume does not execute the tool again.
- A resume that suspends again returns the replacement suspension set.

- [ ] **Step 5: Run the service tests and verify they fail**

Run: `pushd packages/cli; pnpm test src/modules/agents/__tests__/agent-workflow-execution.service.test.ts src/modules/agents/__tests__/agent-execution-orchestrator.service.test.ts; popd`

Expected: FAIL on the new suspension and resume assertions.

- [x] **Step 6: Implement workflow execute and resume behavior**

Keep checkpoint validation in one service method. Keep Agent reconstruction in `AgentWorkflowExecutionService`. Reject any returned suspension that cannot later map to `approval` or `chat_action` before the workflow waits.

- [x] **Step 7: Run the focused CLI tests**

Run: `pushd packages/cli; pnpm test src/modules/agents/__tests__/workflow-agent-stream.test.ts src/modules/agents/__tests__/agent-workflow-execution.service.test.ts src/modules/agents/__tests__/agent-execution-orchestrator.service.test.ts; popd`

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/cli/src/modules/agents
git commit -m "feat: resume saved agents from workflow executions"
```

### Task 3: Implement the Message an Agent waiting state machine

**Files:**

- Create: `packages/nodes-base/nodes/MessageAnAgent/suspension.ts`
- Modify: `packages/nodes-base/nodes/MessageAnAgent/shared.ts`
- Modify: `packages/nodes-base/nodes/MessageAnAgent/v1/MessageAnAgentV1.node.ts`
- Modify: `packages/nodes-base/nodes/MessageAnAgent/v2/MessageAnAgentV2.node.ts`
- Modify: `packages/core/src/execution-engine/node-execution-context/base-execute-context.ts`
- Modify: `packages/cli/src/workflow-execute-additional-data.ts`
- Test: `packages/nodes-base/nodes/MessageAnAgent/__tests__/MessageAnAgent.node.test.ts`
- Test: `packages/core/src/execution-engine/node-execution-context/__tests__/base-execute-context.test.ts`

**Interfaces:**

- Adds `IExecuteFunctions.resumeAgent(agentInfo, resume, executionId, itemIndex): Promise<ExecuteAgentData>`.
- Adds the matching optional `IWorkflowExecuteAdditionalData.resumeAgent` callback and propagates it to integrated sub-executions.
- `isAgentWorkflowChatResumeCapable(context, sessionId)` requires a saved Agent, Chat Trigger `executionContext.triggerNode`, `executionContext.source` equal to `manual` or `webhook`, and a non-empty Chat session. The source value is necessary but is never sufficient without the Chat Trigger identity.
- `AgentWorkflowWaitMetadata` stores Agent ID, scoped thread ID, current item index, completed node outputs, open suspension references, native interactions, and an optional one-time resume command.
- `onMessage(context, data)` parses `data.json.chatInput`, validates the current reference, preserves the original input, and stores the one-time command. It does not call Agent resume.

- [ ] **Step 1: Add failing node tests for the capability gate**

Test editor Chat and public Chat Trigger contexts. Test a non-Chat manual run, a non-Chat webhook run, an inline Agent, no session ID, and a custom session ID without a Chat Trigger context.

- [ ] **Step 2: Add failing node tests for wait and resume**

Test these state transitions:

- Initial supported suspension stores metadata, emits `sendMessage.type === 'agent-interaction'`, and calls `putExecutionToWait()`.
- Unsupported suspension fails before `putExecutionToWait()`.
- `onMessage` rejects plain text, malformed envelopes, and references that are not current.
- `onMessage` stores a command and keeps the original node input.
- The next `execute()` clears the command before it calls `resumeAgent`.
- Completion clears suspension metadata and returns the normal output.
- Chained suspension replaces the old reference and waits again.
- Invalid resume data and duplicate cards keep the current wait metadata.
- `eachItem` keeps earlier outputs, resumes the suspended item, and continues later items without rerunning earlier items.

- [ ] **Step 3: Run the node test and verify it fails**

Run: `pushd packages/nodes-base; pnpm test nodes/MessageAnAgent/__tests__/MessageAnAgent.node.test.ts; popd`

Expected: FAIL because the node has no `onMessage` or suspension state.

- [x] **Step 4: Add the core resume bridge**

Mirror the existing `executeAgent` source selection, thread scoping, workflow context, streaming observer, and sandbox scope. Route saved Agents only. Throw for inline and DeepSeek sources.

- [x] **Step 5: Implement the node state machine**

Expose the shared `onMessage` method from both node classes. Use `setMetadata()` and `putExecutionToWait()`. Use a stable indefinite wait value already supported by the engine. Never place internal checkpoint data in node JSON.

- [x] **Step 6: Run focused tests and type checks**

Run: `pushd packages/nodes-base; pnpm test nodes/MessageAnAgent/__tests__/MessageAnAgent.node.test.ts; pnpm typecheck; popd`

Run: `pushd packages/core; pnpm test src/execution-engine/node-execution-context/__tests__/base-execute-context.test.ts; pnpm typecheck; popd`

Run: `pushd packages/cli; pnpm typecheck; popd`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/nodes-base/nodes/MessageAnAgent packages/core/src/execution-engine packages/cli/src/workflow-execute-additional-data.ts packages/workflow/src/interfaces.ts
git commit -m "feat: wait for agent interactions in message an agent"
```

### Task 4: Preserve native interactions through Chat resume and history

**Files:**

- Modify: `packages/cli/src/chat/chat-execution-manager.ts`
- Modify: `packages/cli/src/chat/utils.ts`
- Modify: `packages/cli/src/modules/chat-hub/chat-hub-execution.service.ts`
- Modify: `packages/cli/src/modules/chat-hub/chat-hub-execution-watcher.service.ts`
- Modify: `packages/cli/src/modules/chat-hub/chat-hub-workflow.service.ts`
- Test: `packages/cli/src/chat/__tests__/chat-execution-manager.test.ts`
- Test: `packages/cli/src/chat/__tests__/utils.test.ts`
- Test: `packages/cli/src/modules/chat-hub/__tests__/chat-hub-execution.service.test.ts`
- Test: `packages/cli/src/modules/chat-hub/__tests__/chat-hub.service.integration.test.ts`

**Interfaces:**

- `ChatExecutionManager` remains generic. It recognizes `Message an Agent` only because the node now implements `onMessage`.
- The Chat Hub output mapper converts `ChatNodeMessageAgentInteraction` to the shared `agent-interaction` content chunk without changing the payload.
- Waiting execution reads rebuild native interactions from persisted task metadata and the current checkpoint-backed references.
- A rejected retryable resume returns a safe Chat error and leaves the execution status as `waiting`.

- [ ] **Step 1: Add failing Chat resume tests**

Test that `Message an Agent` passes the existing `onMessage` allowlist. Test that its structured envelope reaches `onMessage`. Test that ordinary text is rejected while waiting. Test that disconnect cleanup does not cancel this waiting execution.

- [ ] **Step 2: Add failing Chat Hub mapping and reconnect tests**

Test live output, persisted history, reconnect, a resolved read-only card, invalid resume data, a stale card, and a chained suspension.

- [ ] **Step 3: Run the focused CLI tests and verify they fail**

Run: `pushd packages/cli; pnpm test src/chat/__tests__/chat-execution-manager.test.ts src/chat/__tests__/utils.test.ts src/modules/chat-hub/__tests__/chat-hub-execution.service.test.ts src/modules/chat-hub/__tests__/chat-hub.service.integration.test.ts; popd`

Expected: FAIL on native interaction mapping and lifecycle assertions.

- [x] **Step 4: Implement generic transport and history support**

Do not add Agent-specific calls to `ChatExecutionManager`. Keep card rebuilding in the output/history layer. Redact checkpoint details from client errors.

- [ ] **Step 5: Run the focused CLI tests**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/chat packages/cli/src/modules/chat-hub
git commit -m "feat: carry agent interactions through workflow chat"
```

### Task 5: Render native interactions in editor Chat

**Files:**

- Create: `packages/frontend/editor-ui/src/features/ai/chatHub/components/ChatAgentInteractionChunk.vue`
- Modify: `packages/frontend/editor-ui/src/features/ai/chatHub/components/ChatMarkdownChunk.vue`
- Modify: `packages/frontend/editor-ui/src/features/ai/chatHub/components/ChatMessage.vue`
- Modify: `packages/frontend/editor-ui/src/features/ai/chatHub/components/CanvasChatHubPanel.vue`
- Modify: `packages/frontend/editor-ui/src/features/ai/chatHub/ChatView.vue`
- Modify: `packages/frontend/editor-ui/src/features/ai/chatHub/chat.utils.ts`
- Modify: `packages/frontend/@n8n/i18n/src/locales/en.json`
- Test: `packages/frontend/editor-ui/src/features/ai/chatHub/components/ChatMessage.test.ts`
- Test: `packages/frontend/editor-ui/src/features/ai/chatHub/chat.utils.test.ts`

**Interfaces:**

- `ChatAgentInteractionChunk` consumes the shared `AgentWorkflowInteraction` type.
- It reuses `ApprovalCard.vue`, `N8nChatActionCard.vue`, and the existing rich-card parser.
- It emits `submit` with the exact `AgentWorkflowResumeMessage` envelope.
- `submitAgentInteraction(message)` uses the existing workflow Chat send path and does not add a visible plain-text transcript item.

- [ ] **Step 1: Add failing component and state tests**

Test approval, button, select, and radio responses. Test all display-only components. Test input blocking while unresolved. Test read-only state after success. Test safe retry after a retryable backend error. Test restored cards after session reload.

- [ ] **Step 2: Run the editor tests and verify they fail**

Run: `pushd packages/frontend/editor-ui; pnpm test src/features/ai/chatHub/components/ChatMessage.test.ts src/features/ai/chatHub/chat.utils.test.ts; popd`

Expected: FAIL because `agent-interaction` is not rendered.

- [x] **Step 3: Implement the editor adapter**

Pass the submit callback through both full Chat and canvas Chat. Keep `json-render-interaction` code independent. Add concise i18n text for submitted, rejected, stale, and unavailable states only where the existing cards do not already provide it.

- [x] **Step 4: Run editor tests, lint, and type checks**

Run: `pushd packages/frontend/editor-ui; pnpm test src/features/ai/chatHub/components/ChatMessage.test.ts src/features/ai/chatHub/chat.utils.test.ts; pnpm lint; pnpm typecheck; popd`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/editor-ui/src/features/ai/chatHub packages/frontend/@n8n/i18n/src/locales/en.json
git commit -m "feat: render agent interactions in editor chat"
```

### Task 6: Render native interactions in public Chat

**Files:**

- Create: `packages/frontend/@n8n/chat/src/components/MessageAgentInteraction.vue`
- Create: `packages/frontend/@n8n/chat/src/components/AgentRichCard.vue`
- Modify: `packages/frontend/@n8n/chat/src/constants/messageComponents.ts`
- Modify: `packages/frontend/@n8n/chat/src/constants/defaults.ts`
- Modify: `packages/frontend/@n8n/chat/src/types/messages.ts`
- Modify: `packages/frontend/@n8n/chat/src/types/options.ts`
- Modify: `packages/frontend/@n8n/chat/src/utils/utils.ts`
- Modify: `packages/frontend/@n8n/chat/src/plugins/chat.ts`
- Modify: `packages/frontend/@n8n/chat/src/components/Input.vue`
- Test: `packages/frontend/@n8n/chat/src/__tests__/MessageAgentInteraction.spec.ts`
- Test: `packages/frontend/@n8n/chat/src/__tests__/utils/utils.spec.ts`
- Test: `packages/frontend/@n8n/chat/src/__tests__/plugins/chat.spec.ts`
- Test: `packages/frontend/@n8n/chat/src/__tests__/Input.spec.ts`

**Interfaces:**

- Adds `MessageComponentKey.AGENT_INTERACTION`.
- `MessageAgentInteraction` renders approval and every component in `RICH_CARD_COMPONENT_TYPES`.
- The component submits the same JSON resume envelope through `chatStore.sendMessage(..., { addToTranscript: false, throwOnError: true })`.
- `shouldBlockUserInput()` returns true for an unresolved native interaction and false after resolution.
- Session restoration matches a human resume envelope to the preceding unresolved card and marks it read-only.

- [ ] **Step 1: Add failing public Chat tests**

Test parsing, rendering, exact resume values, hidden transcript transport, input blocking, successful resolution, retryable failure, and session restoration. Add a lockstep test that fails when `RICH_CARD_COMPONENT_TYPES` gains an unsupported renderer.

- [ ] **Step 2: Run the public Chat tests and verify they fail**

Run: `pushd packages/frontend/@n8n/chat; pnpm test src/__tests__/MessageAgentInteraction.spec.ts src/__tests__/utils/utils.spec.ts src/__tests__/plugins/chat.spec.ts src/__tests__/Input.spec.ts; popd`

Expected: FAIL because the component key and renderer do not exist.

- [x] **Step 3: Implement the public Chat adapter**

Use the public Chat theme tokens and existing controls. Do not import editor-ui. Do not route through JSON Render components.

- [x] **Step 4: Run public Chat tests, lint, and type checks**

Run: `pushd packages/frontend/@n8n/chat; pnpm test src/__tests__/MessageAgentInteraction.spec.ts src/__tests__/utils/utils.spec.ts src/__tests__/plugins/chat.spec.ts src/__tests__/Input.spec.ts; pnpm lint; pnpm typecheck; popd`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/@n8n/chat
git commit -m "feat: render agent interactions in public chat"
```

### Task 7: Add end-to-end workflow coverage

**Files:**

- Create: `packages/testing/playwright/tests/e2e/workflows/message-an-agent-chat-suspension.spec.ts`
- Create: `packages/testing/playwright/tests/e2e/chat-hub/message-an-agent-suspension.spec.ts`
- Create: `packages/testing/playwright/workflows/message-an-agent-chat-suspension.json`
- Modify: `packages/testing/playwright/pages/ChatHubChatPage.ts`
- Modify: `packages/testing/playwright/pages/components/ManualChatModal.ts`

**Interfaces:**

- Uses a saved test Agent with one approval tool and one `chat_action` tool.
- Exercises the actual editor Chat and public Chat Trigger URL.

- [ ] **Step 1: Add page-object selectors for native Agent cards**

Follow `packages/testing/playwright/AGENTS.md`. Add scoped selectors for an interaction card, approval actions, rich-card controls, and resolved state. Do not put raw locators in the specs.

- [ ] **Step 2: Add the editor Chat scenario**

Assert that the workflow enters `waiting`, ordinary text is blocked, the card resumes the exact tool call, a chained card can wait again, and the workflow reaches `success` after the final response.

- [ ] **Step 3: Add the public Chat scenario**

Assert the same flow through the generated URL. Close and reopen the page while waiting. Assert that the card is restored and the workflow is not cancelled.

- [ ] **Step 4: Add negative scenarios**

Assert that an unsupported suspension ends with an error. Assert that a stale card does not execute the tool twice. Assert that a non-Chat workflow does not wait.

- [ ] **Step 5: Run the two Playwright specs**

Run: `pnpm --filter=n8n-playwright test:local tests/e2e/workflows/message-an-agent-chat-suspension.spec.ts tests/e2e/chat-hub/message-an-agent-suspension.spec.ts --reporter=list`

Expected: PASS in Chromium.

- [ ] **Step 6: Commit**

```bash
git add packages/testing/playwright
git commit -m "test: cover agent suspension in workflow chat"
```

### Task 8: Run cross-package verification and update documentation

**Files:**

- Modify: `docs/superpowers/specs/2026-10-13-message-an-agent-workflow-suspension-design.md`
- Modify: `docs/superpowers/plans/2026-10-13-message-an-agent-workflow-suspension.md`

**Interfaces:**

- No new interface. This task verifies the integrated contract and records only implementation-driven clarifications.

- [ ] **Step 1: Build after cross-package type changes**

Run: `pnpm build > build.log 2>&1`

Expected: exit code 0. Inspect the final lines of `build.log` if it fails.

- [ ] **Step 2: Run affected tests**

Run: `pnpm test:affected`

Expected: PASS.

- [ ] **Step 3: Run package lint and type checks**

Run lint and typecheck from `packages/cli`, `packages/nodes-base`, `packages/core`, `packages/frontend/editor-ui`, and `packages/frontend/@n8n/chat`.

Expected: PASS.

- [ ] **Step 4: Review failure behavior manually**

Verify expired checkpoint, missing checkpoint, wrong ownership, invalid resume data, duplicate submission, unknown interaction, browser reconnect, and `eachItem` continuation. Confirm that errors do not expose checkpoint contents.

- [ ] **Step 5: Check the diff**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 6: Commit final integration fixes**

```bash
git add docs packages
git commit -m "test: verify workflow agent suspension"
```
