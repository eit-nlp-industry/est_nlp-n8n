# DeepSeek Harness Workflow Node

## Goal

Allow a workflow to send a message to one DeepSeek Harness agent.

## Node contract

- Display name: `Message a DeepSeek Harness Agent`.
- Select the agent from the current project.
- Accept a message expression for each input item.
- Accept an optional session ID to continue a Harness conversation.
- Return one item for each input item.
- Return the response text and the Harness session identifiers.
- Do not return profile paths, runtime ports, cookies, or Studio tokens.

## Execution

The node uses the existing agent execution context. The execution source is
`deepSeekHarnessAgentId`. The n8n backend resolves the agent in the current
project.

Publish gating aligns with built-in Agents:

- `manual` and `chat` executions may call an unpublished (draft) agent.
- All other execution modes require `published === true`.
- `published` still controls managed lifecycle (keep-alive and restore on n8n
  startup). It is not the sole gate for draft testing.

The backend starts or reuses the agent Web runtime (`startForAgent`). It then:

1. Authenticates the runtime URL and stores the session cookie in memory.
2. Creates or reuses the requested Harness session.
3. Opens `session/follow` over the WebSocket multiplex endpoint.
4. Waits for the opening `snapshot` frame (readiness only; ignore historical
   records), then sends `session/prompt` over HTTP JSON-RPC.
5. Reads later mux `item` payloads as `SessionFollowFrame` values
   (`{ type: 'event', event }`), not as bare wire events.
6. Collects `assistant/message` text from nested live `event` frames.
7. Completes when a nested live `turn/end` event is received.

## Agent picker

The node list includes draft and published agents in the project. Draft entries
are labeled with `(draft)` so builders can tell them apart. Production workflow
runs still reject unpublished agents at execute time.

## Failure behavior

- Reject an unknown agent.
- Reject an agent outside the current project.
- Reject an unpublished agent on production (non-manual/chat) runs.
- Convert runtime, authentication, protocol, and timeout failures to an
  execution error.
- Never expose Harness credentials or internal filesystem paths in the node
  output.

## Deliberate MVP limits

- The node waits for the final response and does not stream partial output.
- The node returns text and session metadata only.
- Tool-call details and model usage are not mapped to workflow output yet.
- Published agent processes remain managed by the existing lifecycle service.
- Draft runs may start a process on demand; idle shutdown for those processes
  remains a follow-up (same as Studio embedding).

## Implementation status

- [x] Add the execution source type.
- [x] Add project-scoped agent listing.
- [x] Add the workflow node and selector.
- [x] Add the Harness Web RPC client.
- [x] Add node execution tests.
- [x] Allow draft agents on manual/chat runs; require publish for production.
- [ ] Add an end-to-end test against a running Harness Web runtime.
