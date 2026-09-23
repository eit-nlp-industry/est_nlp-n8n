# json-render Interaction Demo

This demo exercises the **decision** path (json-render form → structured response) without executing side effects.

## Chat workflow demo (recommended)

1. Start n8n: `demo/start-n8n.ps1`
2. Import `demo/workflows/03-chat-interaction-demo.json`
3. Open the workflow and activate it
4. Open the hosted chat URL from the **Chat Trigger** node
5. Send any message (e.g. `show failed executions`)
6. The bot renders a dashboard + form:
   - Select executions to retry
   - Adjust max retries
7. Click **Submit** — the workflow resumes and replies with a summary (demo only; no real retries)

### What this validates

- `Render Interaction` node builds `{ format, payload, phase: decision }`
- Chat node **Response Content Type → Interaction** sends `json-render-interaction`
- Hosted chat blocks free-text input until Submit/Cancel
- User response arrives as JSON on `$json.chatInput`

## Instance AI path

When Instance AI is enabled, the orchestrator exposes the **`collect-decision`** tool:

- Suspend payload: `inputType: 'json-render'` + `jsonRender`
- Frontend: `InstanceAiConfirmationPanel` → `JsonRenderInteractionConfirmation`
- Resume: `confirmAction({ kind: 'interaction', approved, value })`

Try: *"Show me failed executions and let me pick which to retry"* — the agent should call `collect-decision`, not `ask-user`, for the rich UI.
