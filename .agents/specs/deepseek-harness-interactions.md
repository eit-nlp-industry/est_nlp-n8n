# DeepSeek Harness n8n Interactions

## Goal

Connect DeepSeek Harness events to interaction capabilities that n8n already
supports. Keep Harness-specific UI out of this scope.

## Scope

### Events n8n can display

The node must map these Harness events to n8n execution output or execution
logs:

- assistant messages
- reasoning or thinking updates
- tool calls
- tool results
- tool progress and completion states
- turn completion
- cancellation and failure

The mapping must preserve the Harness session identifiers and must not expose
profile paths, cookies, runtime ports, or Studio tokens.

### Events n8n can answer

The node must map these Harness interactions to n8n's existing interactive
execution flow:

- approval decisions
- single selection
- multiple selection
- free-text input
- submit
- skip
- cancel

The workflow must pause while an answer is pending. The answer must resume the
same Harness session and the same pending request. A repeated answer must not
resume the request twice.

## Architecture

The DeepSeek Harness RPC adapter remains the protocol boundary. It subscribes
to Harness session events and interaction requests, then translates them to
n8n execution events and interactive payloads.

The n8n node uses the existing execution pause and resume mechanism. It must
not invent a second frontend interaction protocol. The editor reuses the
interactive card components already used by n8n Agent.

The adapter must keep a pending interaction record containing the agent ID,
project ID, Harness session ID, Harness request ID, and n8n execution context.
The record is removed only after a successful answer or a terminal failure.

## Protocol rules

- A normal event must not block the workflow.
- An interaction request must block the workflow until the user responds.
- A Harness interaction request must be answered through the Harness remote
  event protocol, not by sending a normal chat message.
- An answer must include the original Harness request ID.
- Unsupported interaction fields must fail clearly instead of being silently
  discarded.
- The final node output keeps the existing `text` and `session` fields.
- Existing draft and publish gating remains unchanged.

## Failure behavior

- Close the pending n8n interaction when Harness cancels the request.
- Return a node execution error when the Harness connection closes while an
  interaction is pending.
- Reject duplicate answers for the same request ID.
- Preserve the original Harness error when the request fails.
- Do not leave a workflow waiting after a terminal Harness failure.

## Deliberate exclusions

- No Harness source changes.
- No new Harness-specific form components.
- No new workflow-level interaction language.
- No change to Studio routing or session deep links.

## Implementation TODO

- [x] Normalize display-only Harness events.
- [x] Connect display events to n8n execution logs.
- [ ] Define the n8n adapter contract for pending interactions.
- [ ] Map approval requests.
- [ ] Map selection and text-input requests.
- [ ] Map submit, skip, and cancel actions.
- [ ] Resume the original Harness request exactly once.
- [ ] Add backend and node tests for the event and resume flows.
- [ ] Add frontend tests for the reused interactive payloads.
- [ ] Verify the implementation against this spec.
