# DeepSeek Harness n8n Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect DeepSeek Harness display events and interactive requests to
n8n capabilities that already exist for Agent workflows.

**Architecture:** Extend the DeepSeek Harness RPC boundary to normalize live
Harness events and to bridge Harness waterfall interaction requests. Reuse
n8n's existing execution logs, interactive payloads, and pause/resume path.
Keep Harness source unchanged and keep the final node output compatible with
the current `text` and `session` fields.

**Tech Stack:** TypeScript, Vitest, n8n workflow execution contexts, Vue 3
interactive payloads, DeepSeek Harness WebSocket remote mux and HTTP JSON-RPC.

**Spec:** `.agents/specs/deepseek-harness-interactions.md`

## Global Constraints

- Do not modify the DeepSeek Harness repository.
- Do not add a Harness-specific form protocol to the n8n frontend.
- Preserve existing draft and publish gating.
- Do not expose profile paths, cookies, runtime ports, or Studio tokens.
- Use existing n8n execution pause/resume and interactive payload contracts.
- Use `unknown` and type guards instead of `any` in TypeScript.
- Write tests before production code for every behavior change.
- Preserve unrelated dirty worktree changes.

## Review Focus

- A nested `session/follow` frame must not be mistaken for a bare event.
- Historical snapshot messages must not be emitted as new live output.
- A Harness interaction must pause the workflow instead of timing out.
- A duplicate answer must not resume one Harness request twice.
- A closed socket must clear the pending interaction and fail the workflow.

### Task 1: Define normalized Harness event and interaction contracts

**Files:**
- Create: `packages/cli/src/modules/deepseek-harness/deepseek-harness-events.ts`
- Create: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness-events.test.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness-rpc.service.ts`
- Modify: `.agents/specs/deepseek-harness-interactions.md`

**Interfaces:**
- Consumes: Harness `session/follow` item payloads and remote waterfall event payloads.
- Produces: typed display events and a typed pending interaction contract for the next tasks.

- [ ] **Step 1: Write the failing tests for event normalization**

Add tests that pass nested `event` frames for `assistant/message`, reasoning,
`tool/call`, `tool/result`, progress, `turn/end`, cancellation, and failure.
Assert that each frame becomes a typed normalized event and that unknown event
types return an explicit unsupported result.

- [ ] **Step 2: Run the RPC tests and confirm the expected failure**

Run from `packages/cli`:

```powershell
pnpm test src/modules/deepseek-harness/__tests__/deepseek-harness-events.test.ts
```

Expected result: the new normalization tests fail because the current adapter
only extracts assistant text and turn completion.

- [ ] **Step 3: Write the failing tests for interaction identity**

Add tests that normalize an approval request and a user-question request with
the fields `agentId`, `projectId`, `sessionId`, `requestId`, interaction kind,
options, multi-select state, and custom-input support.
Assert that missing request IDs are rejected instead of silently accepted.

- [ ] **Step 4: Implement the minimal typed normalization layer**

Add type guards and pure mapping helpers in
`deepseek-harness-events.ts`. Keep snapshot records separate from live
records. Return a typed unsupported-event result for events that n8n cannot
display.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run the events test file and the existing RPC test file. Expected result: all
normalization tests pass and existing RPC tests remain green.

- [ ] **Step 6: Update the spec checklist**

Mark only the event-normalization item complete. Record any exact Harness
payload fields discovered during implementation.

### Task 2: Connect display events to n8n execution output

**Files:**
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness-rpc.service.ts`
- Modify: `packages/workflow/src/interfaces.ts`
- Modify: `packages/nodes-base/nodes/DeepSeekHarness/DeepSeekHarness.node.ts`
- Test: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness-rpc.service.test.ts`
- Test: `packages/nodes-base/nodes/DeepSeekHarness/__tests__/DeepSeekHarness.node.test.ts`

**Interfaces:**
- Consumes: normalized display events from Task 1.
- Produces: n8n execution log/stream events without changing final node output.

- [x] **Step 1: Write failing tests for display event forwarding**

Add tests for tool-call start, tool-result completion, reasoning updates,
cancellation, and failure. Assert that normal events do not end the turn and
that the final `text` and `session` output remains unchanged.

- [x] **Step 2: Run the focused CLI and node tests**

Run:

```powershell
pnpm --dir packages/cli test src/modules/deepseek-harness/__tests__/deepseek-harness-rpc.service.test.ts
pnpm --dir packages/nodes-base test nodes/DeepSeekHarness/__tests__/DeepSeekHarness.node.test.ts
```

Expected result: the new forwarding assertions fail because only assistant
text and turn completion are currently exposed.

- [x] **Step 3: Implement display-event forwarding**

Forward non-blocking events through the existing n8n execution stream/log
contract. Keep tool calls and tool results associated by Harness call ID.
Do not emit snapshot history as live execution events.

- [x] **Step 4: Run focused tests and typecheck the affected packages**

Run the two focused test commands and the owning package type checks. Fix
production code if a test fails; do not weaken assertions.

### Task 3: Bridge Harness interaction requests to n8n pause/resume

**Files:**
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness-rpc.service.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness.service.ts`
- Modify: `packages/workflow/src/interfaces.ts`
- Test: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness-rpc.service.test.ts`
- Test: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness.service.test.ts`

**Interfaces:**
- Consumes: Harness `approval/request` and `user-questions/request` events.
- Produces: n8n interactive payloads and a one-shot resume callback bound to the
  original Harness request ID.

- [ ] **Step 1: Write failing tests for pending interaction lifecycle**

Cover these cases:

```typescript
// request creates one pending interaction
// answer sends the original request ID once
// second answer is rejected
// cancel clears the request and fails the turn
// socket close clears the request and fails the workflow
```

Assert the request stores agent, project, session, and request identity.

- [ ] **Step 2: Run the RPC tests and confirm the expected failure**

Run the CLI RPC test file. Expected result: the lifecycle tests fail because
the current implementation waits only for `turn/end` and has no resume path.

- [ ] **Step 3: Add the pending interaction boundary**

Add a small service or private component that owns pending request state. It
must expose a typed `create`, `resolveOnce`, and `reject` contract. It must not
store credentials or filesystem paths.

- [ ] **Step 4: Connect n8n execution pause/resume**

Use the existing n8n execution suspension mechanism. Map approval to the
existing approval payload. Map question options, multi-select, custom text,
submit, skip, and cancel to the existing interactive payload contract. Resume
the same execution and send the structured Harness answer through the remote
event protocol.

- [ ] **Step 5: Add failure and timeout handling**

When Harness cancels, the socket closes, or the request fails, clear the
pending interaction and finish the n8n execution with the original error.
Reject duplicate answers by request ID.

- [ ] **Step 6: Run focused tests and typecheck**

Run the CLI interaction tests, node tests, and owning package type checks.

### Task 4: Reuse the n8n Agent interactive UI

**Files:**
- Modify: `packages/frontend/editor-ui/src/features/ai/shared/agentsChat/types.ts`
- Modify: `packages/frontend/editor-ui/src/features/ai/shared/agentsChat/messageMappers.ts`
- Modify: `packages/frontend/editor-ui/src/features/ai/shared/agentsChat/components/InteractionRenderer.vue`
- Test: `packages/frontend/editor-ui/src/features/ai/shared/agentsChat/__tests__/n8nChatInteraction.test.ts`

**Interfaces:**
- Consumes: the n8n interactive payload produced by Task 3.
- Produces: visible approval, selection, text-input, submit, skip, and cancel
  controls with a response sent once.

- [ ] **Step 1: Write failing frontend tests**

Add tests that render the normalized approval and question payloads and assert
that selecting, submitting, skipping, and cancelling call the existing resume
handler with the expected structured value.

- [ ] **Step 2: Run the frontend tests and confirm the expected failure**

Run `n8nChatInteraction.test.ts`. Expected result: the new assertions fail
until the shared interaction mapper accepts the normalized payloads.

- [ ] **Step 3: Add the smallest frontend adapter**

Reuse existing Agent interaction components. Do not create a DeepSeek Harness
component when the shared component already supports the payload.

- [ ] **Step 4: Run frontend tests and typecheck**

Run the focused test file and the editor UI typecheck.

### Task 5: End-to-end verification and spec alignment

**Files:**
- Modify: `.agents/specs/deepseek-harness-interactions.md`
- Test: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness-rpc.service.test.ts`

- [ ] **Step 1: Add an integration test for one complete interaction**

Use the existing mocked Harness remote mux and HTTP JSON-RPC test helpers. Start one prompt,
emit a question request, resolve it once, emit the final assistant message,
and assert the node returns the final text with the original session ID.

- [ ] **Step 2: Add an integration test for a tool call**

Emit tool call, tool result, and turn end. Assert execution logs contain the
tool lifecycle and the final output contains only the existing node result
shape.

- [ ] **Step 3: Run the complete affected test suites**

Run the CLI, workflow, nodes-base, and editor UI tests that own the changed
files. Run type checks for every affected package.

- [ ] **Step 4: Re-read the spec against the implementation**

Update the TODO checklist and record any unsupported Harness fields as explicit
gaps. Do not mark a requirement complete without a passing test.

- [ ] **Step 5: Report verification results**

Report the exact commands, pass/fail results, and any unrelated pre-existing
failures from the dirty worktree.
