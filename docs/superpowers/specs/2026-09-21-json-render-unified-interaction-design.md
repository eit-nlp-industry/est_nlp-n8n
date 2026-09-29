# Unified json-render interaction design

Date: 2026-09-21
Updated: 2026-09-29

## Goal

Make display and interactive `json-render-v1` documents use the same stateful renderer and component registry across the three n8n hosts:

1. top-level Agent Chat;
2. workflow `@n8n/chat`;
3. Instance AI.

The change must reduce host-owned form rendering code, keep submitted forms visible as read-only cards, and preserve the existing robot-dog agent orchestration and tool contracts.

Add reusable `Steps` and `Step` elements to the same rendering path. Render Dashboard can use them as display-only progress. Render Interaction can show them beside a form without changing the suspend and resume contract.

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
- Do not make `Steps` clickable in this phase.
- Do not add previous-step or next-step state actions in this phase.
- Do not add `Steps` or `Step` to the React or Ant Design registries in this phase. A later change will add those implementations.

## Current problems

The protocol already contains dynamic-form types, initial form state, action bindings, and a standardized event envelope. The Vue runtime, however, exposes only resolved initial state and has no reactive update API. The Element Plus registry contains display components only.

As a result, each n8n host renders `meta.dynamicForm` outside `JsonRenderPanel`:

- editor-ui uses `JsonRenderInteractionPanel.vue` with Element Plus controls;
- `@n8n/chat` uses native HTML controls and host-specific CSS;
- Instance AI wraps the editor-ui form implementation.

This duplicates default-value handling, option resolution, submission behavior, styling, and validation boundaries. It also makes a display document and an interaction document use different rendering mechanisms.

## Compatibility strategy

This is a `json-render-v1` cleanup and runtime enhancement that makes the canonical spec-based form representation the only supported form representation.

- The canonical form representation is `spec.elements.DynamicForm.props.fields` plus spec action bindings such as `form.submit` and `form.cancel`.
- Remove `meta.dynamicForm` from the v1 schema, builders, helpers, runtimes, demos, tests, and all n8n producers/consumers.
- Do not add a legacy normalizer or fallback reader. Payloads must contain a canonical `DynamicForm` element to render an interaction.
- Keep existing node configurations valid. Add Steps only through optional node parameters. Keep node output envelopes unchanged.
- Do not require the robot-dog Agent configuration to change.
- Add new public runtime and registry APIs without removing existing exports.
- Define `Steps` as a neutral display element. The host or tool decides whether the payload interrupts execution.
- Keep the active step zero-based. Allow values from zero through the number of steps. A value equal to the number of steps means that all steps are complete.

Existing display-only payloads continue to render. Historical interaction payloads that only contain `meta.dynamicForm` are intentionally unsupported after this migration.

## eit-json-render changes

### Protocol package

Add framework-independent helpers and constants for interaction rendering:

- standardized action names for form submit and cancel;
- a collision-safe helper that appends canonical `DynamicForm` elements and actions to a spec;
- helpers to merge submitted values into `/form` state;
- helpers to collect the current form values for event payloads;
- a non-mutating presentation helper that applies submitted values and an explicitly requested read-only mode to a payload;
- optional field validation primitives needed by the current field set.

The presentation helper is framework-independent. A host can request read-only rendering with one option; by default payloads remain editable. In read-only mode it disables form fields and hides or disables submit/cancel actions without changing the persisted document.

The v1 payload schema no longer accepts `meta.dynamicForm`. New builders emit forms in `spec` only.

Add framework-independent step types and builders:

```ts
interface JsonRenderStepInput {
  title: string;
  description?: string;
  status?: 'wait' | 'process' | 'finish' | 'error' | 'success';
}

interface JsonRenderStepsInput {
  active: number;
  items: JsonRenderStepInput[];
  direction?: 'horizontal' | 'vertical';
  alignCenter?: boolean;
  simple?: boolean;
  processStatus?: 'wait' | 'process' | 'finish' | 'error' | 'success';
  finishStatus?: 'wait' | 'process' | 'finish' | 'error' | 'success';
}
```

Add a non-mutating `appendStepsToSpec(spec, steps)` helper. It creates one `Steps` element and one `Step` child element for each item. It allocates collision-safe element keys and appends the `Steps` element to the current root. It rejects fewer than two items, non-integer active values, and active values outside the inclusive range from zero through `items.length`.

Add `buildDisplayDashboardSpec(input)` as the shared dashboard composition helper. It builds the Card, description, Steps, metrics, and table elements without applying display-only content requirements. Extend `buildDisplayDashboardPayload(input)` to call that helper and to accept Steps as valid dashboard content. The display payload builder requires at least one of Steps, metrics, or a table.

Keep the generic v1 element envelope open for future components. Add exported component-level schemas for `Steps` and `Step` props so builders and tests can validate their stable contract without turning the generic payload parser into a closed component registry.

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
- Button;
- Steps;
- Step.

Components use Element Plus theme variables and avoid host-specific hard-coded colors. They honor the canonical field and action state produced by the protocol presentation helper. Submit and Cancel emit standardized json-render events containing the current form state.

`Steps` maps to `ElSteps`. `Step` maps to `ElStep`. The registry maps the protocol property names to the Element Plus property names. The components do not emit n8n lifecycle events and do not change local state in this phase.

No n8n package or n8n Design System dependency is added to eit-json-render.

### React compatibility

The React runtime and Ant Design registry already render canonical `DynamicForm` spec elements. Their default rendering and event behavior remain unchanged.

- Do not rewrite the React state or action runtime as part of this work.
- Remove its `meta.dynamicForm` runtime fallback and render canonical forms only.
- Add regression coverage proving canonical forms still render with unchanged default behavior.
- Hosts using React may opt into the same protocol presentation helper for submitted values and read-only display, but no existing consumer is switched automatically.

React and Ant Design do not receive `Steps` support in this phase. A Steps payload rendered through a registry without `Steps` and `Step` continues to use the existing unknown-component fallback. This temporary limitation must be documented in the protocol release notes. It does not change existing React payload behavior.

## Steps composition

Steps are parallel to `DynamicForm` in the json-render spec. They are not a form field and do not cause suspension.

Display-only payload:

```text
Card
└── Stack
    ├── Description
    ├── Steps
    │   ├── Step
    │   ├── Step
    │   └── Step
    ├── Metrics
    └── Table
```

Interactive payload:

```text
Card
├── Stack
│   ├── Description
│   ├── Steps
│   ├── Metrics
│   └── Table
├── DynamicForm
└── Form Actions
```

Render Dashboard displays the first structure and does not suspend execution. Render Interaction displays the second structure and suspends because it contains the existing canonical form actions. Adding Steps never changes the lifecycle by itself.

The initial Steps implementation is presentation-only. Node builders use a resolved numeric `active` value. A raw json-render spec can bind the component property to a `$state` read through the existing dynamic-value envelope. The component-level schema accepts both forms, while the builder input schema validates the resolved number. No component in this phase increments or decrements it. A future wizard design can add local state actions, conditional step content, per-step validation, and previous or next controls.

## n8n host migration

Create one thin shared n8n wrapper around `JsonRenderPanel`. Its responsibilities are limited to:

- parse and reject invalid payloads;
- select the shared registry;
- pass a unique instance ID;
- apply submitted state and the host-controlled read-only option through the shared protocol helper;
- translate standardized submit/cancel events into host callbacks.

It does not render individual form fields.

The shared registry automatically renders Steps in all Vue hosts. No host-specific Steps component is added. Read-only interaction preparation leaves Steps visible and only disables or hides the existing decision controls.

### Render Dashboard node

Add an optional Steps parameter group with active step, direction, alignment, simple mode, process status, finish status, and two or more step items. Each item contains a title, optional description, and optional explicit status.

Change node validation so that Steps, metrics, or a table is sufficient content. Replace the n8n-owned dashboard spec implementation with `buildDisplayDashboardPayload()` from `@eit/json-render-protocol`. Remove the local builder after parity tests pass. Keep the node output wrapper unchanged.

This is the first migration step away from n8n-owned dashboard spec composition. Later changes can move other producers to the same protocol builders without blocking Steps.

### Render Interaction node

Add the same optional Steps parameter group. Continue to require at least one form field in this phase. Build the base content with `buildDisplayDashboardSpec()`, including Steps when present, and then call `appendDynamicFormToSpec()`.

Keep the existing output wrapper, `phase: 'decision'`, suspension behavior, form submit payload, and resume result unchanged.

Extend the Render Interaction JSON configuration with a top-level `steps` property. Use `null` when the node has no Steps configuration. A configured value uses the protocol input structure. Best-effort export includes incomplete step items. Strict Copy and Apply validation requires at least two valid items and a valid active range. Model-defined values use the existing structured `$fromAI` representation and preserve the model key, description, type, and optional default.

### Top-level Agent Chat

- Replace the host-rendered form in `JsonRenderInteractionPanel.vue` with the shared stateful renderer.
- On Submit, resume with `{ approved: true, value: formValues }`.
- On Cancel, resume with `{ approved: false }`.
- Keep resolved json-render interactions in the transcript.
- Render submitted values in read-only mode after resolution.
- Render cancelled interactions in read-only mode with an explicit cancelled state.
- Use the tool call ID in the renderer instance ID.
- Render Steps through the shared registry for both display and interaction cards.

### Workflow `@n8n/chat`

- Replace the native HTML form in `MessageJsonRenderInteraction.vue` with the shared renderer.
- Preserve the existing `json-render-interaction-response` transport envelope and current Chat-node wait/resume behavior.
- After Submit or Cancel, keep the card mounted and render it read-only.
- Preserve `blockUserInput` behavior.
- Render Steps through the shared registry without changing the interaction response envelope.

### Instance AI

- Replace field rendering with the same shared renderer.
- Preserve the existing Instance AI confirmation request and resume DTOs.
- Keep the resolved interaction visible as read-only wherever the confirmation transcript retains the tool call.
- Do not change `collect-decision` tool behavior or the runtime suspension contract.
- Render Steps through the shared registry without adding an Instance AI-specific Steps implementation.

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

- protocol tests for canonical form generation, collision-safe keys, state merging, read-only presentation, and events;
- Vue runtime tests for reactive binding, prepared submitted state, Submit, and Cancel;
- Element Plus registry tests for all supported current form field types;
- parser tests proving `meta.dynamicForm` is stripped or rejected according to the strict parse API contract.
- React/Ant Design regression tests proving canonical spec forms remain unchanged after fallback removal.
- protocol tests for Steps input validation, active boundaries, collision-safe keys, immutability, dashboard-only Steps payloads, and mixed dashboard content;
- Element Plus tests for horizontal and vertical Steps, descriptions, explicit statuses, completed state, and registry registration;
- Vue runtime regression tests proving a Steps payload renders and does not emit an interaction event;
- React and Ant Design regression tests proving existing payloads remain unchanged. Steps rendering in those registries is deferred.

### n8n

- Agent Chat tests for Submit, Cancel, history reconstruction, and retained read-only cards;
- workflow Chat tests for transport compatibility, blocked input, and retained read-only cards;
- Instance AI tests for unchanged confirmation/resume DTOs and read-only rendering;
- regression tests for display-only Dashboard rendering;
- regression tests for unchanged Render Interaction suspend/resume tool output.
- Render Dashboard tests for Steps-only output and mixed Steps, metrics, and table output;
- Render Interaction tests for Steps plus form output and unchanged form decision actions;
- Render Interaction JSON editor tests for best-effort export, strict validation, `$fromAI` round trips, Apply, Copy, and old configurations without Steps;
- host regression tests proving display Steps do not suspend and interaction Steps remain visible after submit or cancel.

## Build and restart procedure

After implementation:

1. build and test the affected eit-json-render packages;
2. run the affected n8n package tests, lint, and typecheck;
3. run the n8n repository build with output redirected to a build log, because the change crosses frontend, API, and linked package boundaries;
4. restart local n8n backend and frontend development processes so they reload linked package output;
5. perform a manual end-to-end check in all three hosts.

Because n8n consumes git-based `@eit/json-render-*` packages, update the pinned dependency commit after the eit-json-render changes pass. Reinstall and rebuild the affected n8n packages before host verification.

Docker service containers do not need to restart because no database, Redis, mail, proxy, or service-container contract changes. If the n8n application itself is running inside a Docker image instead of through local dev processes, that application image/container must be rebuilt or restarted, but the dependency service containers remain untouched.

## Acceptance criteria

- Dashboard rendering is unchanged.
- Interaction display content and form fields are rendered by one `JsonRenderPanel` and one registry path.
- New n8n interaction payloads contain canonical `DynamicForm` spec elements and do not emit `meta.dynamicForm`.
- No protocol, runtime, demo, test fixture, or n8n host uses `meta.dynamicForm`.
- Existing React behavior is unchanged.
- No n8n host manually switches over form field types.
- All three hosts map the same standardized json-render events into their existing lifecycle contracts.
- Submitted and cancelled interactions remain visible as non-interactive historical cards.
- Read-only presentation is host-controlled and defaults to editable when not requested.
- Existing canonical `json-render-v1` interactions still render; meta-only interaction payloads are intentionally unsupported.
- Render Dashboard can render a Steps-only card without suspending execution.
- Render Interaction can render Steps beside its form without changing when or how execution suspends and resumes.
- The same Steps and Step protocol elements render through the shared Element Plus registry in all three Vue hosts.
- Steps alone never emit submit, cancel, or resume events.
- Active step zero, an intermediate active step, and the all-complete value render correctly.
- Render Dashboard calls the protocol dashboard builder and no longer owns a duplicate dashboard spec builder.
- Render Interaction uses the protocol dashboard spec helper before it appends the canonical DynamicForm.
- Render Interaction JSON import and export represent every Steps parameter and preserve `$fromAI` metadata.
- Existing payloads without Steps remain valid and render unchanged.
- React and Ant Design behavior remains unchanged. Their Steps implementation is explicitly deferred.
- Robot-dog tool names, tool schemas, instructions, selection logic, MCP calls, and suspend/resume result shapes are unchanged.
- A full n8n build succeeds, affected tests pass, and the three manual host flows pass.
