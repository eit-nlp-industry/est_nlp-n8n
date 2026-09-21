# Unified json-render interaction design

Date: 2026-09-21

## Goal

Make display and interactive `json-render-v1` documents use the same stateful renderer and component registry across the three n8n hosts:

1. top-level Agent Chat;
2. workflow `@n8n/chat`;
3. Instance AI.

The change must reduce host-owned form rendering code, keep submitted forms visible as read-only cards, and preserve the existing robot-dog agent orchestration and tool contracts.

## Non-goals

- Do not change the robot-dog instructions, candidate selection rules, destination eligibility rules, or MCP action planning.
- Do not change when `render_dashboard` or `render_interaction` is invoked.
- Do not change the `Render Dashboard` or `Render Interaction` node input schema.
- Do not change the Agent suspend payload or resume result contract:
  - suspend: `{ type: "json-render-interaction", jsonRender, message? }`;
  - resume: `{ approved, value? }`;
  - tool result: `{ decided, value? }`.
- Do not make json-render execute robot or workflow side effects. It only renders state and emits user interaction events.
- Do not change the existing React renderer's default behavior. Existing React consumers remain editable unless they explicitly opt into a read-only presentation helper.
- Do not require restarting Postgres, Redis, Mailpit, proxy, or other service containers.

## Current problems

The protocol already contains dynamic-form types, initial form state, action bindings, and a standardized event envelope. The Vue runtime, however, exposes only resolved initial state and has no reactive update API. The Element Plus registry contains display components only.

As a result, each n8n host renders `meta.dynamicForm` outside `JsonRenderPanel`:

- editor-ui uses `JsonRenderInteractionPanel.vue` with Element Plus controls;
- `@n8n/chat` uses native HTML controls and host-specific CSS;
- Instance AI wraps the editor-ui form implementation.

This duplicates default-value handling, option resolution, submission behavior, styling, and validation boundaries. It also makes a display document and an interaction document use different rendering mechanisms.

## Compatibility strategy

This is a backward-compatible `json-render-v1` runtime enhancement and a producer migration to the canonical spec-based form representation.

- The canonical form representation is `spec.elements.DynamicForm.props.fields` plus spec action bindings such as `form.submit` and `form.cancel`.
- New and updated producers stop emitting `meta.dynamicForm`.
- Keep `meta.dynamicForm` accepted by the v1 schema and supported through an explicit legacy normalization helper so saved conversations and waiting executions remain readable.
- Mark the `meta.dynamicForm` API and related fallback helpers deprecated.
- Do not remove the v1 compatibility reader in this change. Physical removal belongs to a future v2/major migration or to a separately approved change after the product's persisted-history compatibility window has elapsed.
- Keep current node input schemas and node output envelopes valid.
- Do not require the robot-dog Agent configuration to change.
- Add new public runtime and registry APIs without removing existing exports.

Existing saved conversations and waiting executions must continue to render after deployment.

## eit-json-render changes

### Protocol package

Add framework-independent helpers and constants for interaction rendering:

- standardized action names for form submit and cancel;
- a collision-safe legacy normalizer that converts `meta.dynamicForm` to canonical `DynamicForm` spec elements when reading old payloads;
- helpers to merge submitted values into `/form` state;
- helpers to collect the current form values for event payloads;
- a non-mutating presentation helper that applies submitted values and an explicitly requested read-only mode to a payload;
- optional field validation primitives needed by the current field set.

The presentation helper is framework-independent. A host can request read-only rendering with one option; by default payloads remain editable. In read-only mode it disables form fields and hides or disables submit/cancel actions without changing the persisted document.

The existing v1 payload schema remains accepted. Any new optional field properties must be backward compatible. New builders emit forms in `spec` and do not populate `meta.dynamicForm`.

### Vue runtime package

Change `JsonRenderPanel` from an initial-state-only renderer to an internally stateful renderer.

The runtime context will expose:

```ts
interface JsonRenderVueRuntimeValue {
  instanceId: string;
  state: JsonRenderState;
  setState(path: string, value: unknown): void;
  emit(event: JsonRenderEvent): void;
}
```

`JsonRenderPanel` will support:

- reactive state initialized from the payload;
- `$state` reads and `$bindState` two-way bindings;
- standardized submit and cancel event emission;
- rendering canonical `DynamicForm` spec elements through the supplied registry;
- stable, collision-free generated element keys.

The renderer remains responsible only for UI state and events. Hosts decide what an event means for their execution lifecycle.

### Element Plus registry package

Add registry components for the field types already supported by the protocol:

- Form;
- FormItem;
- Input;
- InputNumber;
- Select;
- MultipleSelect;
- FormActions;
- Button.

Components use Element Plus theme variables and avoid host-specific hard-coded colors. They honor the canonical field and action state produced by the protocol presentation helper. Submit and Cancel emit standardized json-render events containing the current form state.

No n8n package or n8n Design System dependency is added to eit-json-render.

### React compatibility

The React runtime and Ant Design registry already render canonical `DynamicForm` spec elements. Their default rendering and event behavior remain unchanged.

- Do not rewrite the React state or action runtime as part of this work.
- Retain its deprecated `meta.dynamicForm` fallback for old payloads during the v1 compatibility period.
- Add regression coverage proving canonical forms and legacy forms still render.
- Hosts using React may opt into the same protocol presentation helper for submitted values and read-only display, but no existing consumer is switched automatically.

## n8n host migration

Create one thin shared n8n wrapper around `JsonRenderPanel`. Its responsibilities are limited to:

- parse and reject invalid payloads;
- select the shared registry;
- pass a unique instance ID;
- apply submitted state and the host-controlled read-only option through the shared protocol helper;
- translate standardized submit/cancel events into host callbacks.

It does not render individual form fields.

### Top-level Agent Chat

- Replace the host-rendered form in `JsonRenderInteractionPanel.vue` with the shared stateful renderer.
- On Submit, resume with `{ approved: true, value: formValues }`.
- On Cancel, resume with `{ approved: false }`.
- Keep resolved json-render interactions in the transcript.
- Render submitted values in read-only mode after resolution.
- Render cancelled interactions in read-only mode with an explicit cancelled state.
- Use the tool call ID in the renderer instance ID.

### Workflow `@n8n/chat`

- Replace the native HTML form in `MessageJsonRenderInteraction.vue` with the shared renderer.
- Preserve the existing `json-render-interaction-response` transport envelope and current Chat-node wait/resume behavior.
- After Submit or Cancel, keep the card mounted and render it read-only.
- Preserve `blockUserInput` behavior.

### Instance AI

- Replace field rendering with the same shared renderer.
- Preserve the existing Instance AI confirmation request and resume DTOs.
- Keep the resolved interaction visible as read-only wherever the confirmation transcript retains the tool call.
- Do not change `collect-decision` tool behavior or the runtime suspension contract.

## Read-only card behavior

After resolution, every host must retain the interaction card instead of removing it.

Read-only behavior is controlled explicitly by each host through the shared wrapper. The renderer does not infer that every submitted form must be locked, and the default remains editable. n8n passes read-only mode for resolved Agent, workflow Chat, and Instance AI history cards.

Submitted card:

- shows the original display content;
- shows the submitted values;
- disables all fields;
- hides or disables Submit and Cancel;
- exposes a submitted status in the host wrapper.

Cancelled card:

- shows the original display content;
- disables all fields;
- hides or disables actions;
- exposes a cancelled status in the host wrapper.

Resolved cards must never emit another resume request.

## Error handling

- Invalid payloads render a safe error state and never fall back to an unchecked type cast.
- Unknown registry component types continue to render the existing unknown-component fallback.
- Invalid or incomplete form state does not emit a submit event.
- A host ignores duplicate Submit/Cancel events after the first accepted event.
- Loading historical payloads must not mutate persisted payload objects.

## Testing

### eit-json-render

- protocol tests for legacy form normalization, collision-safe keys, state merging, read-only presentation, and events;
- Vue runtime tests for reactive binding, prepared submitted state, Submit, and Cancel;
- Element Plus registry tests for all supported current form field types;
- backward-compatibility test using an existing `meta.dynamicForm` payload.
- React/Ant Design regression tests proving canonical spec forms remain unchanged and the deprecated meta fallback still renders.

### n8n

- Agent Chat tests for Submit, Cancel, history reconstruction, and retained read-only cards;
- workflow Chat tests for transport compatibility, blocked input, and retained read-only cards;
- Instance AI tests for unchanged confirmation/resume DTOs and read-only rendering;
- regression tests for display-only Dashboard rendering;
- regression tests for unchanged Render Interaction suspend/resume tool output.

## Build and restart procedure

After implementation:

1. build and test the affected eit-json-render packages;
2. run the affected n8n package tests, lint, and typecheck;
3. run the n8n repository build with output redirected to a build log, because the change crosses frontend, API, and linked package boundaries;
4. restart local n8n backend and frontend development processes so they reload linked package output;
5. perform a manual end-to-end check in all three hosts.

Docker service containers do not need to restart because no database, Redis, mail, proxy, or service-container contract changes. If the n8n application itself is running inside a Docker image instead of through local dev processes, that application image/container must be rebuilt or restarted, but the dependency service containers remain untouched.

## Acceptance criteria

- Dashboard rendering is unchanged.
- Interaction display content and form fields are rendered by one `JsonRenderPanel` and one registry path.
- New n8n interaction payloads contain canonical `DynamicForm` spec elements and do not emit `meta.dynamicForm`.
- Legacy v1 payloads containing `meta.dynamicForm` still render through the deprecated compatibility path.
- Existing React behavior is unchanged.
- No n8n host manually switches over form field types.
- All three hosts map the same standardized json-render events into their existing lifecycle contracts.
- Submitted and cancelled interactions remain visible as non-interactive historical cards.
- Read-only presentation is host-controlled and defaults to editable when not requested.
- Existing saved `json-render-v1` interactions still render.
- Robot-dog tool names, tool schemas, instructions, selection logic, MCP calls, and suspend/resume result shapes are unchanged.
- A full n8n build succeeds, affected tests pass, and the three manual host flows pass.
