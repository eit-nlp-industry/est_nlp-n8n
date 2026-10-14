# Streaming Chat Agent Interaction Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect streaming Chat Trigger executions to the existing Chat WebSocket so an Agent interaction resumes the same workflow execution.

**Architecture:** The HTTP stream sends one Chat-only `execution-started` control frame before workflow work starts. The public Chat client uses that frame to open the existing execution WebSocket. Model output stays on HTTP, while blocking Agent interactions and their responses use the WebSocket.

**Tech Stack:** TypeScript, Node.js, Express streaming responses, WebSocket, Vue 3, Pinia-style injected state, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-14-streaming-chat-agent-interaction-resume-design.md`

## Global Constraints

- Use pnpm for every build, test, lint, and typecheck command.
- Use the Chat Trigger execution context as the capability gate.
- Do not send a resume token to a generic streaming Webhook.
- Keep HTTP as the model-output stream.
- Use WebSocket as the only transport for blocking Agent interactions and their responses.
- Do not store or render the suspension response envelope as user Chat text.
- Keep non-streaming hosted Chat behavior unchanged.
- Keep existing WebSocket heartbeat and continue protocols unchanged.
- Use existing design-system controls and CSS variables.
- Do not add new user-facing text unless it uses i18n.
- Do not log resume tokens or full resume data.
- Preserve all unrelated dirty-worktree changes.

## Review Focus

- A control frame can be split across network chunks. Task 1 tests that parsing still calls the execution callback once.
- A generic streaming Webhook can also have an execution ID and resume token. Task 2 tests that it does not receive the Chat control frame.
- The same control frame can be observed twice. Task 3 tests that the client keeps one WebSocket for the execution.
- A workflow can reach `waiting` before the WebSocket finishes opening. Task 4 tests that the durable waiting message is delivered after attachment.
- A user can click while the socket is connecting or after it closes. Task 3 tests that controls stay disabled and no local selection is committed.

---

## File Structure

- `packages/workflow/src/interfaces.ts`: Own the shared streaming-frame discriminated union.
- `packages/frontend/@n8n/chat/src/types/streaming.ts`: Mirror the transport union at the public Chat package boundary.
- `packages/frontend/@n8n/chat/src/api/message.ts`: Parse and dispatch the execution control frame.
- `packages/cli/src/workflow-runner.ts`: Send the Chat-only control frame after execution registration.
- `packages/cli/src/active-executions.ts`: Write every member of the shared streaming-frame union.
- `packages/cli/src/__tests__/workflow-runner.test.ts`: Prove ordering and capability gating.
- `packages/frontend/@n8n/chat/src/plugins/chat.ts`: Convert the control frame into a WebSocket setup event.
- `packages/frontend/@n8n/chat/src/types/chat.ts`: Expose reactive WebSocket readiness to message components.
- `packages/frontend/@n8n/chat/src/components/Input.vue`: Own WebSocket replacement, readiness, and cleanup.
- `packages/frontend/@n8n/chat/src/components/MessageAgentInteraction.vue`: Disable unavailable controls and submit the resume envelope.
- `packages/cli/src/modules/agents/workflow-agent-stream.ts`: Collect suspension state without streaming a duplicate card.
- `packages/cli/src/chat/chat-service.ts`: Preserve early attachment and durable waiting-card delivery.
- Corresponding `__tests__` files: Pin transport, lifecycle, card, and resume behavior.

### Task 1: Add the Execution Control Frame to the Streaming Protocol

**Files:**

- Modify: `packages/workflow/src/interfaces.ts:4638`
- Modify: `packages/frontend/@n8n/chat/src/types/streaming.ts:1`
- Modify: `packages/frontend/@n8n/chat/src/api/message.ts:73`
- Test: `packages/frontend/@n8n/chat/src/__tests__/api/message.spec.ts`

**Interfaces:**

- Consumes: The current newline-delimited JSON response and existing node `StructuredChunk` values.
- Produces: `ExecutionStartedChunk`, `StreamingChunk`, and `StreamingEventHandlers.onExecutionStarted(executionId: string, resumeToken: string): void`.

- [ ] **Step 1: Write failing parser tests**

Add these cases to `api/message.spec.ts`:

- `dispatches an execution-started frame without rendering content`
- `parses an execution-started frame split across byte chunks once`
- `ignores a keepalive frame without calling onExecutionStarted`

Assert that `onExecutionStarted` receives `exec-123` and `token-123`. Assert that `onBeginMessage`, `onChunk`, and `onEndMessage` do not run for the control frame. Assert that `hasReceivedChunks` stays `false` when the response contains only control frames.

- [ ] **Step 2: Run the parser tests and verify RED**

Run from `packages/frontend/@n8n/chat`:

```bash
pnpm test src/__tests__/api/message.spec.ts
```

Expected: FAIL because `onExecutionStarted` and the control-frame type do not exist.

- [ ] **Step 3: Define the discriminated frame types**

In `packages/workflow/src/interfaces.ts`, keep node metadata required on `StructuredChunk`. Add:

```ts
export interface ExecutionStartedChunk {
	type: 'execution-started';
	executionId: string;
	resumeToken: string;
}

export interface StreamingKeepaliveChunk {
	type: 'keepalive';
}

export type StreamingChunk = StructuredChunk | ExecutionStartedChunk | StreamingKeepaliveChunk;
```

Mirror the same transport boundary in `@n8n/chat/src/types/streaming.ts`. Do not make node metadata optional.

- [ ] **Step 4: Dispatch the control frame in the Chat stream parser**

Change `createLineParser()` to output `StreamingChunk`. Add `onExecutionStarted` to `StreamingEventHandlers`. In `sendMessageStreaming()`, call it only for `type === 'execution-started'`. Keep `hasReceivedChunks` unchanged for control and keepalive frames.

- [ ] **Step 5: Run the parser tests and verify GREEN**

Run: `pnpm test src/__tests__/api/message.spec.ts`

Expected: all tests pass.

- [ ] **Step 6: Run package typecheck**

Run: `pnpm typecheck`

Expected: exit code 0.

- [ ] **Step 7: Commit the protocol unit**

```bash
git add packages/workflow/src/interfaces.ts packages/frontend/@n8n/chat/src/types/streaming.ts packages/frontend/@n8n/chat/src/api/message.ts packages/frontend/@n8n/chat/src/__tests__/api/message.spec.ts
git commit -m "feat(chat): add streaming execution control frame"
```

### Task 2: Send the Control Frame Only for Streaming Chat Executions

**Files:**

- Modify: `packages/cli/src/workflow-runner.ts:450`
- Modify: `packages/cli/src/active-executions.ts:216`
- Test: `packages/cli/src/__tests__/workflow-runner.test.ts:1676`
- Test: `packages/cli/src/__tests__/active-executions.test.ts:486`

**Interfaces:**

- Consumes: `StreamingChunk` from Task 1, `data.executionData.resumeToken`, and `data.executionData.executionData.runtimeData.triggerNode.type`.
- Produces: One flushed `ExecutionStartedChunk` before `runMainProcess()` or `enqueueExecution()` starts.

- [ ] **Step 1: Write failing WorkflowRunner tests**

Add these cases under `streaming functionality`:

- `sends execution-started before starting a streaming Chat Trigger execution`
- `does not send execution-started for a generic streaming Webhook`
- `does not send execution-started when the Chat execution has no resume token`

Use `CHAT_TRIGGER_NODE_TYPE` for the Chat execution context. Assert the first response write equals a newline-delimited frame with the registered execution ID and test token. Assert the run method starts only after that write. Assert no such write occurs in the two negative cases.

- [ ] **Step 2: Run the WorkflowRunner tests and verify RED**

Run from `packages/cli`:

```bash
pnpm test src/__tests__/workflow-runner.test.ts
```

Expected: FAIL because the runner does not send the control frame.

- [ ] **Step 3: Add the Chat capability guard**

Add a focused helper in `workflow-runner.ts`:

```ts
function getStreamingChatExecutionStartedChunk(
	data: IWorkflowExecutionDataProcess,
	executionId: string,
): ExecutionStartedChunk | undefined;
```

Return a frame only when streaming is enabled, an HTTP response exists, `data.executionData?.executionData?.runtimeData?.triggerNode?.type` equals `CHAT_TRIGGER_NODE_TYPE`, and the resume token is a non-empty string.

- [ ] **Step 4: Write and flush the frame before dispatch**

After `activeExecutions.add()` returns, write the frame through `activeExecutions.sendChunk(executionId, frame)` before the queue/local branch. Keep heartbeat setup unchanged. Do not log the token.

- [ ] **Step 5: Extend the ActiveExecutions transport test**

Update `active-executions.test.ts` to prove `sendChunk()` accepts the control-frame union and writes exactly one JSON line followed by a flush.

- [ ] **Step 6: Run the focused backend tests and verify GREEN**

Run from `packages/cli`:

```bash
pnpm test src/__tests__/workflow-runner.test.ts src/__tests__/active-executions.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Run backend typecheck**

Run: `pnpm typecheck`

Expected: exit code 0.

- [ ] **Step 8: Commit the backend handshake unit**

```bash
git add packages/cli/src/workflow-runner.ts packages/cli/src/active-executions.ts packages/cli/src/__tests__/workflow-runner.test.ts packages/cli/src/__tests__/active-executions.test.ts
git commit -m "feat(chat): announce resumable streaming executions"
```

### Task 3: Open and Track the Streaming Execution WebSocket

**Files:**

- Modify: `packages/frontend/@n8n/chat/src/plugins/chat.ts:180`
- Modify: `packages/frontend/@n8n/chat/src/types/chat.ts:8`
- Modify: `packages/frontend/@n8n/chat/src/components/Input.vue:101`
- Modify: `packages/frontend/@n8n/chat/src/components/MessageAgentInteraction.vue:53`
- Test: `packages/frontend/@n8n/chat/src/__tests__/plugins/chat.spec.ts:249`
- Test: `packages/frontend/@n8n/chat/src/__tests__/Input.spec.ts:127`
- Test: `packages/frontend/@n8n/chat/src/__tests__/MessageAgentInteraction.spec.ts`

**Interfaces:**

- Consumes: `StreamingEventHandlers.onExecutionStarted` from Task 1 and the existing `setupWebsocket` event.
- Produces: `Chat.websocketReady: Ref<boolean>` and an idempotent `setupWebsocketConnection(executionId: string, resumeToken?: string): void`.

- [ ] **Step 1: Write failing Chat plugin tests**

Add these cases to `plugins/chat.spec.ts`:

- `requests WebSocket setup for an execution-started frame`
- `does not add the execution-started frame to the transcript`

Capture the streaming handler passed to `sendMessageStreaming()`. Call `onExecutionStarted('exec-123', 'token-123')`. Assert `chatEventBus.emit` receives `setupWebsocket`, `exec-123`, and `token-123` once. Assert the messages array has no bot message for the frame.

- [ ] **Step 2: Write failing Input lifecycle tests**

Add these cases to `Input.spec.ts`:

- `does not replace an active WebSocket for the same execution`
- `closes the previous WebSocket before connecting a different execution`
- `sets websocketReady only after open and clears it after close`

Assert one `WebSocket` construction for duplicate setup. Assert `close()` precedes construction for a new execution. Invoke the mocked `onopen` and `onclose` handlers to verify the reactive state.

- [ ] **Step 3: Write failing interaction availability tests**

Update `MessageAgentInteraction.spec.ts` with these cases:

- `disables controls while the execution socket is connecting`
- `does not commit a radio selection while the socket is unavailable`
- `sends one response and removes the card when the socket is open`
- `keeps the card available when WebSocket.send throws`

Assert the exact `agent-suspension-response` envelope. Assert it is nested in the existing Chat WebSocket `sendMessage` frame. Assert no HTTP `sendMessage()` call occurs.

- [ ] **Step 4: Run the frontend tests and verify RED**

Run from `packages/frontend/@n8n/chat`:

```bash
pnpm test src/__tests__/plugins/chat.spec.ts src/__tests__/Input.spec.ts src/__tests__/MessageAgentInteraction.spec.ts
```

Expected: FAIL because the plugin does not handle the control callback and WebSocket readiness is not reactive.

- [ ] **Step 5: Emit WebSocket setup from the Chat plugin**

Implement `onExecutionStarted(executionId, resumeToken)` in `handleStreamingMessage()`. Emit `chatEventBus.emit('setupWebsocket', executionId, resumeToken)`. Do not add a message or mark model content as received.

- [ ] **Step 6: Add reactive WebSocket lifecycle state**

Add `websocketReady: Ref<boolean>` to `Chat`. Initialize it in the plugin store. In `Input.vue`, track the execution ID owned by the current socket. Set readiness in `onopen`. Clear readiness and the matching execution ID in `onclose` and `onerror`. Close an old socket before replacing it with a different execution.

- [ ] **Step 7: Gate interaction controls with WebSocket readiness**

In `MessageAgentInteraction.vue`, define:

```ts
const interactionDisabled = computed(
	() => sending.value || !chat.websocketReady.value || chat.ws?.readyState !== WebSocket.OPEN,
);
```

Use it for buttons, radio controls, and selects. In `submitOption()`, update `selectedOptions` only after `submit()` reports success. Keep the card visible and the old selection unchanged on failure.

- [ ] **Step 8: Run the focused frontend tests and verify GREEN**

Run: `pnpm test src/__tests__/plugins/chat.spec.ts src/__tests__/Input.spec.ts src/__tests__/MessageAgentInteraction.spec.ts`

Expected: all tests pass.

- [ ] **Step 9: Run frontend quality checks**

Run from `packages/frontend/@n8n/chat`:

```bash
pnpm typecheck
pnpm lint
pnpm stylelint
pnpm format:check
```

Expected: every command exits with code 0.

- [ ] **Step 10: Commit the frontend handoff unit**

```bash
git add packages/frontend/@n8n/chat/src/plugins/chat.ts packages/frontend/@n8n/chat/src/types/chat.ts packages/frontend/@n8n/chat/src/components/Input.vue packages/frontend/@n8n/chat/src/components/MessageAgentInteraction.vue packages/frontend/@n8n/chat/src/__tests__/plugins/chat.spec.ts packages/frontend/@n8n/chat/src/__tests__/Input.spec.ts packages/frontend/@n8n/chat/src/__tests__/MessageAgentInteraction.spec.ts
git commit -m "fix(chat): connect streaming interactions to execution socket"
```

### Task 4: Make the Waiting WebSocket the Single Interaction Source

**Files:**

- Modify: `packages/cli/src/modules/agents/workflow-agent-stream.ts:8`
- Modify: `packages/cli/src/modules/agents/__tests__/workflow-agent-stream.test.ts:98`
- Modify: `packages/cli/src/chat/__tests__/chat-service.test.ts`
- Modify: `packages/cli/src/modules/agents/__tests__/agent-workflow-execution.service.test.ts`

**Interfaces:**

- Consumes: The existing persisted waiting-node `agent-interaction` message and the WebSocket created in Task 3.
- Produces: One durable WebSocket card, one accepted HITL response event, and continuation of the same Agent and workflow execution.

- [ ] **Step 1: Write failing duplicate-card tests**

In `workflow-agent-stream.test.ts`, replace the interaction streaming expectation with `collects a suspended tool call without emitting an HTTP interaction chunk`. Assert the adapter closes open model text, records the suspension, and emits no `interaction` observer event.

- [ ] **Step 2: Write the early-attachment Chat service test**

Add `delivers the waiting interaction after a socket attaches to a running execution` to `chat-service.test.ts`. Return `running` on the first poll and `waiting` with an `agent-interaction` message on the second poll. Assert the socket stays open and receives the card exactly once.

- [ ] **Step 3: Write the same-execution resume regression test**

In `agent-workflow-execution.service.test.ts`, add or extend a suspension-resume case. Assert all of these results:

- The initial call and resumed call use the same Agent run ID.
- Resume targets the original tool call ID.
- The resume payload is recorded with `recordHitlResponse`.
- The response envelope is not passed as the next user message.
- Intermediate response chunks remain ordered.
- The resumed model turn increments instead of restarting the execution-local count.

- [ ] **Step 4: Run the backend tests and verify RED**

Run from `packages/cli`:

```bash
pnpm test src/modules/agents/__tests__/workflow-agent-stream.test.ts src/chat/__tests__/chat-service.test.ts src/modules/agents/__tests__/agent-workflow-execution.service.test.ts
```

Expected: at least the duplicate-card test fails because the adapter still emits the interaction through HTTP.

- [ ] **Step 5: Stop HTTP interaction emission**

Remove the observer-level `interaction` event from `workflow-agent-stream.ts`. Keep suspension collection and text-segment closure. Do not change standalone Agent streaming.

- [ ] **Step 6: Confirm durable waiting delivery needs no service change**

Run the new Chat service test alone. Confirm the current poll loop delivers the waiting card exactly once without a production change. If this test fails, stop this task and revise the approved design before changing the generic Chat service.

- [ ] **Step 7: Run the focused backend tests and verify GREEN**

Run: `pnpm test src/modules/agents/__tests__/workflow-agent-stream.test.ts src/chat/__tests__/chat-service.test.ts src/modules/agents/__tests__/agent-workflow-execution.service.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Run package regression checks**

Run from `packages/cli`:

```bash
pnpm typecheck
pnpm lint
```

Run from `packages/frontend/@n8n/chat`:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm stylelint
pnpm format:check
```

Expected: every command exits with code 0.

- [ ] **Step 9: Perform the manual streaming Chat regression**

Run the refund workflow shown in the bug report. Verify one execution ID from the first message through the final response. Verify each card appears once, accepts one click, disappears after submission, and produces one `Chat action · Response received` entry. Verify model turns increment and no raw suspension JSON or `fetch_input_data` call appears.

- [ ] **Step 10: Commit the single-source and regression unit**

```bash
git add packages/cli/src/modules/agents/workflow-agent-stream.ts packages/cli/src/modules/agents/__tests__/workflow-agent-stream.test.ts packages/cli/src/chat/__tests__/chat-service.test.ts packages/cli/src/modules/agents/__tests__/agent-workflow-execution.service.test.ts
git commit -m "fix(chat): resume agent interactions on the waiting execution"
```

## Final Verification

- [ ] Run `git diff --check`.
- [ ] Review `git diff --stat` and confirm that only planned files changed.
- [ ] Search changed files for logged `resumeToken` values and raw resume payloads.
- [ ] Confirm no new hardcoded UI text was added.
- [ ] Confirm the design acceptance criteria against the manual workflow.
- [ ] Use `superpowers:verification-before-completion` before reporting completion.
