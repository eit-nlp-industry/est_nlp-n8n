# Unified json-render Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render canonical spec-based forms through one json-render Vue runtime and registry in Agent Chat, workflow Chat, and Instance AI, while removing the metadata form representation and retaining resolved forms as host-controlled read-only cards.

**Architecture:** Make `spec.elements.DynamicForm.props.fields` plus `form.submit` / `form.cancel` action bindings the only supported form representation. Extend the eit-json-render Vue runtime and Element Plus registry to match the already-working React/AntD spec-based model, remove the metadata form path completely, and reduce each n8n host to event/lifecycle adaptation.

**Tech Stack:** TypeScript, Zod, Vue 3, Element Plus, React/Ant Design compatibility, Vitest, pnpm/Turbo, n8n Agent suspend/resume.

**Spec:** `docs/superpowers/specs/2026-09-21-json-render-unified-interaction-design.md`

## Global Constraints

- Do not modify robot-dog instructions, tool names, tool input schemas, candidate logic, MCP calls, or suspend/resume result shapes.
- Remove `meta.dynamicForm` from protocol, runtimes, builders, demos, tests, and n8n hosts; do not add a fallback reader.
- New builders must emit `DynamicForm` in `spec` and must not emit `meta.dynamicForm`.
- Existing React/AntD default behavior must not change.
- Read-only rendering is explicitly selected by the host and defaults to editable.
- Do not restart dependency service containers; only rebuild/restart the n8n application processes when required.
- Preserve unrelated user changes in both repositories.

## Review Focus

- A spec whose existing element keys collide with generated form keys must append a form without overwriting elements.
- Preparing a read-only payload must not mutate the persisted payload or its nested fields/options.
- A resolved card reloaded from history must show submitted values and must not emit a second resume.
- Cancel must emit no form value to the execution lifecycle and must remain visibly cancelled/read-only.
- An invalid payload or unregistered component must render a safe fallback rather than bypassing protocol validation.

---

### Task 1: Canonical form and presentation helpers in eit-json-render protocol

**Files:**
- Create: `D:/work/project/eit-json-render/packages/protocol/src/interaction.ts`
- Modify: `D:/work/project/eit-json-render/packages/protocol/src/form-utils.ts`
- Modify: `D:/work/project/eit-json-render/packages/protocol/src/index.ts`
- Modify: `D:/work/project/eit-json-render/packages/protocol/src/schemas/v1.ts`
- Test: `D:/work/project/eit-json-render/packages/protocol/src/__tests__/interaction.test.ts`
- Test: `D:/work/project/eit-json-render/packages/protocol/src/__tests__/form-utils.test.ts`

**Interfaces:**
- Produces: `JSON_RENDER_FORM_SUBMIT_ACTION`, `JSON_RENDER_FORM_CANCEL_ACTION`.
- Produces: `appendDynamicFormToSpec(spec, fields, options): JsonRenderSpec`.
- Produces: `prepareJsonRenderInteractionPayload(payload, options): JsonRenderPayload` where `options` is `{ values?: Record<string, unknown>; readOnly?: boolean }`.
- Removes: `getDynamicFormFromPayload()` and all `meta.dynamicForm` schema/builder APIs.

- [ ] **Step 1: Add failing tests for canonical spec generation and key collision handling**

```ts
it("appends a canonical DynamicForm without overwriting colliding keys", () => {
  const spec = { root: "root", elements: { root: { type: "Card" }, form: { type: "Text" } } };
  const result = appendDynamicFormToSpec(spec, fields, { submitLabel: "Submit", cancelLabel: "Cancel" });
  expect(result.elements.form).toEqual({ type: "Text" });
  expect(Object.values(result.elements)).toContainEqual(
    expect.objectContaining({ type: "DynamicForm", props: { fields } }),
  );
  expect(Object.values(result.elements)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ on: { press: expect.objectContaining({ action: "form.submit" }) } }),
      expect.objectContaining({ on: { press: expect.objectContaining({ action: "form.cancel" }) } }),
    ]),
  );
});
```

- [ ] **Step 2: Run the protocol test and verify the new API is missing**

Run: `pnpm --filter @eit/json-render-protocol test -- interaction.test.ts`

Expected: FAIL because `appendDynamicFormToSpec` is not exported.

- [ ] **Step 3: Implement canonical form constants and `appendDynamicFormToSpec`**

```ts
export const JSON_RENDER_FORM_SUBMIT_ACTION = "form.submit";
export const JSON_RENDER_FORM_CANCEL_ACTION = "form.cancel";

export interface AppendDynamicFormOptions {
  submitLabel?: string;
  cancelLabel?: string;
}

export function appendDynamicFormToSpec(
  spec: JsonRenderSpec,
  fields: FormField[],
  options: AppendDynamicFormOptions = {},
): JsonRenderSpec;
```

Clone the spec, allocate collision-safe keys, append one `DynamicForm`, an action `Stack`, and Submit/Cancel `Button` elements to a cloned root. Never mutate the input spec.

- [ ] **Step 4: Add failing tests that remove the meta form API**

```ts
it("does not expose meta.dynamicForm in parsed payloads", () => {
  const parsed = parseJsonRenderPayload(payloadWithMetaDynamicForm);
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data.meta).not.toHaveProperty("dynamicForm");
});
```

- [ ] **Step 5: Remove the meta form schema, builder argument, and helpers**

Delete `jsonRenderDynamicFormV1Schema` from payload metadata, `BuildJsonRenderPayloadInput.dynamicForm`, `getDynamicFormFromPayload`, and every related export/test. Keep the standalone `FormField` schemas and state helpers because canonical `DynamicForm.props.fields` still use them.

- [ ] **Step 6: Add failing tests for submitted values, read-only mode, cancellation actions, and immutability**

```ts
it("prepares submitted values and disables fields/actions without mutation", () => {
  const original = structuredClone(canonicalPayload);
  const prepared = prepareJsonRenderInteractionPayload(canonicalPayload, {
    values: { destination: "candidate_2" },
    readOnly: true,
  });
  expect(prepared.state?.initial).toMatchObject({ form: { destination: "candidate_2" } });
  expect(findDynamicForm(prepared).props?.fields).toEqual([
    expect.objectContaining({ key: "destination", disabled: true }),
  ]);
  expect(findActionButtons(prepared)).toEqual(
    expect.arrayContaining([expect.objectContaining({ visible: false })]),
  );
  expect(canonicalPayload).toEqual(original);
});
```

- [ ] **Step 7: Implement `prepareJsonRenderInteractionPayload` and export all APIs**

Require a canonical `DynamicForm`, merge `options.values` into `state.initial.form`, clone every changed field, and set `visible: false` on buttons bound to Submit/Cancel when `readOnly` is true. With no options, return an editable clone.

- [ ] **Step 8: Run protocol tests and build**

Run:

```powershell
pnpm --filter @eit/json-render-protocol test
pnpm --filter @eit/json-render-protocol build
```

Expected: PASS.

- [ ] **Step 9: Commit the protocol task in eit-json-render**

```powershell
git add packages/protocol
git commit -m "feat: add canonical form presentation helpers"
```

### Task 2: Stateful Vue action runtime

**Files:**
- Modify: `D:/work/project/eit-json-render/packages/vue/src/provider/RuntimeContext.ts`
- Modify: `D:/work/project/eit-json-render/packages/vue/src/registry/types.ts`
- Modify: `D:/work/project/eit-json-render/packages/vue/src/renderer/resolve.ts`
- Modify: `D:/work/project/eit-json-render/packages/vue/src/renderer/renderElement.ts`
- Modify: `D:/work/project/eit-json-render/packages/vue/src/renderer/JsonRenderPanel.ts`
- Modify: `D:/work/project/eit-json-render/packages/vue/src/index.ts`
- Test: `D:/work/project/eit-json-render/packages/vue/src/__tests__/JsonRenderPanel.test.ts`

**Interfaces:**
- Consumes: form action constants and `collectFormValues` from Task 1.
- Produces: `JsonRenderVueRuntimeValue.setState(path, value)` and reactive `state`.
- Produces: `JsonRenderVueComponentContext.on(eventName)?.emit()` compatible with the React registry pattern.
- Emits: `JsonRenderEvent` with `payload.form` for Submit and without a decision value for Cancel.

- [ ] **Step 1: Add failing Vue tests for `$bindState`, Submit, Cancel, and invalid payloads**

Mount a test registry containing a bound input and Button. Assert that input changes update `/form/name`, Submit emits `event.name === "form.submit"` with `{ form: { name: "Ada" } }`, Cancel emits `event.name === "form.cancel"`, and an invalid root renders `Invalid json-render payload`.

- [ ] **Step 2: Run the Vue tests and verify state/action failures**

Run: `pnpm --filter @eit/json-render-vue test -- JsonRenderPanel.test.ts`

Expected: FAIL because the Vue runtime has no state setter and ignores element actions.

- [ ] **Step 3: Implement reactive state and safe path updates**

```ts
export interface JsonRenderVueRuntimeValue {
  instanceId: string;
  state: JsonRenderState;
  context?: Record<string, unknown>;
  setState(path: string, value: unknown): void;
  onEvent?: (event: JsonRenderEvent) => void;
}
```

Initialize state from `resolvePayloadInitialState`, reset it only when the payload changes, and update nested paths without replacing unrelated form values.

- [ ] **Step 4: Implement binding extraction and element event dispatch**

Add a resolver that recognizes `{ $bindState: "/form/name" }`, resolves its current value, and retains the path in component context. Map each element `on` binding to an emitter. For `form.submit`, build a protocol event containing `collectFormValues(runtime.state)`; for `form.cancel`, emit the action without form values.

- [ ] **Step 5: Run Vue tests and build**

```powershell
pnpm --filter @eit/json-render-vue test
pnpm --filter @eit/json-render-vue build
```

Expected: PASS.

- [ ] **Step 6: Commit the Vue runtime task in eit-json-render**

```powershell
git add packages/vue
git commit -m "feat: add stateful Vue json-render actions"
```

### Task 3: Element Plus form registry and React compatibility guard

**Files:**
- Create: `D:/work/project/eit-json-render/packages/element-plus/src/form-components.ts`
- Modify: `D:/work/project/eit-json-render/packages/element-plus/src/registry.ts`
- Modify: `D:/work/project/eit-json-render/packages/element-plus/src/module.ts`
- Test: `D:/work/project/eit-json-render/packages/element-plus/src/__tests__/registry.test.ts`
- Test: `D:/work/project/eit-json-render/packages/protocol/src/__tests__/interaction.test.ts`
- Verify unchanged: `D:/work/project/eit-json-render/packages/react/src/renderer/JsonRenderPanel.tsx`
- Verify unchanged: `D:/work/project/eit-json-render/packages/antd/src/registry.tsx`

**Interfaces:**
- Consumes: Vue runtime binding/event APIs from Task 2.
- Produces registry types: `DynamicForm`, `FormField`, `Input`, `InputNumber`, `DateInput`, `DateRange`, `Select`, `Button`.
- Preserves existing display components and React/AntD behavior.

- [ ] **Step 1: Add failing registry tests for all existing protocol field types**

Render a canonical `DynamicForm` with `input`, `inputNumber`, `date`, `daterange`, `select`, and `multipleSelect`. Assert labels, defaults, option labels, state changes, disabled fields, and Submit/Cancel events.

- [ ] **Step 2: Run registry tests and verify the components are unregistered**

Run: `pnpm --filter @eit/json-render-element-plus test -- registry.test.ts`

Expected: FAIL with unknown `DynamicForm`/`Button` components.

- [ ] **Step 3: Implement focused Element Plus controls**

Each control reads its current value from the Vue runtime, writes through `setState(formStatePath(field.key), value)`, and honors `field.disabled`. `DynamicForm` owns the field-type switch so host systems never switch on field types. `Button` delegates to `ctx.on?.("press")?.emit()`.

- [ ] **Step 4: Replace hard-coded visual values with Element Plus theme variables**

Use `--el-*` variables for text, border, background, radius, and spacing where available. Keep all form layout in the registry; do not add n8n-specific CSS.

- [ ] **Step 5: Add a compatibility fixture covering React's canonical input after fallback removal**

Remove `dynamicForm` from the React runtime context and panel, then validate the canonical spec used by React/AntD. Do not change state handling, actions, or default editability.

- [ ] **Step 6: Run Element Plus tests and build all eit-json-render packages**

```powershell
pnpm --filter @eit/json-render-element-plus test
pnpm --filter @eit/json-render-element-plus build
pnpm --filter @eit/json-render-react build
pnpm --filter @eit/json-render-antd build
pnpm build
```

Expected: PASS.

- [ ] **Step 7: Commit the registry task in eit-json-render**

```powershell
git add packages/element-plus packages/protocol/src/__tests__
git commit -m "feat: render forms in the Element Plus registry"
```

### Task 4: Migrate n8n interaction producers to canonical spec forms

**Files:**
- Modify: `packages/@n8n/nodes-langchain/nodes/tools/RenderInteraction/render-interaction-payload.ts`
- Modify: `packages/@n8n/nodes-langchain/nodes/tools/RenderInteraction/__tests__/RenderInteraction.node.test.ts`
- Modify: `packages/@n8n/instance-ai/src/tools/collect-decision/collect-decision.payload.ts`
- Modify: `packages/@n8n/instance-ai/src/tools/collect-decision/__tests__/collect-decision.tool.test.ts`

**Interfaces:**
- Consumes: `appendDynamicFormToSpec` from Task 1.
- Preserves all node/tool inputs and outer output envelopes.
- Produces canonical payloads with one `DynamicForm`, Submit/Cancel buttons, and no `meta.dynamicForm`.

- [ ] **Step 1: Change producer tests to require canonical forms and reject new metadata emission**

```ts
expect(payload.meta?.dynamicForm).toBeUndefined();
expect(Object.values(payload.spec.elements)).toContainEqual(
  expect.objectContaining({ type: 'DynamicForm', props: { fields: expect.any(Array) } }),
);
expect(Object.values(payload.spec.elements)).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ on: { press: expect.objectContaining({ action: 'form.submit' }) } }),
    expect.objectContaining({ on: { press: expect.objectContaining({ action: 'form.cancel' }) } }),
  ]),
);
```

- [ ] **Step 2: Run both producer tests and verify they fail on `meta.dynamicForm`**

Run the RenderInteraction test from `packages/@n8n/nodes-langchain` and the collect-decision test from `packages/@n8n/instance-ai` using each package's `pnpm test <file>` command.

- [ ] **Step 3: Replace duplicated form-spec assembly with the protocol helper**

Keep local dashboard construction unchanged. Pass its completed display spec and the existing protocol fields to `appendDynamicFormToSpec`. Keep the payload format, schema version, title, description, extensions, and initial form state unchanged except for removing `meta.dynamicForm`.

- [ ] **Step 4: Run producer tests, typecheck, and build affected packages**

Expected: tests and typechecks PASS; snapshots/output wrappers remain unchanged apart from canonical form placement.

- [ ] **Step 5: Commit the producer migration in n8n**

Stage only the four producer/test files and commit with `feat: emit canonical json-render forms`.

### Task 5: Shared n8n Vue interaction renderer and workflow Chat migration

**Files:**
- Create: `packages/frontend/@n8n/chat/src/components/JsonRenderInteraction.vue`
- Create: `packages/frontend/@n8n/chat/src/__tests__/JsonRenderInteraction.spec.ts`
- Modify: `packages/frontend/@n8n/chat/src/components/index.ts`
- Modify: `packages/frontend/@n8n/chat/src/components/MessageJsonRenderInteraction.vue`
- Modify: `packages/frontend/@n8n/chat/src/__tests__/plugins/chat.spec.ts`
- Modify: `packages/frontend/@n8n/chat/src/__tests__/utils/utils.spec.ts`

**Interfaces:**
- Consumes: `prepareJsonRenderInteractionPayload`, `JsonRenderPanel`, and `elementPlusRegistry`.
- Produces component props `{ payload, instanceId, values?, readOnly?, status? }`.
- Produces events `submit(value)` and `cancel()`.
- Preserves workflow Chat's `json-render-interaction-response` transport.

- [ ] **Step 1: Add failing shared-component tests**

Test editable Submit, editable Cancel, read-only submitted values, cancelled status, duplicate-click suppression, invalid payload fallback, and a unique instance ID.

- [ ] **Step 2: Run the component test and verify the component is missing**

Run from `packages/frontend/@n8n/chat`:

```powershell
pnpm test JsonRenderInteraction.spec.ts
```

- [ ] **Step 3: Implement the thin shared renderer**

```ts
const preparedPayload = computed(() =>
  prepareJsonRenderInteractionPayload(props.payload, {
    values: props.values,
    readOnly: props.readOnly,
  }),
);
```

Render exactly one `JsonRenderPanel`. Map `event.event.name === "form.submit"` to `submit(event.payload?.form ?? {})` and `form.cancel` to `cancel()`. Invalid input renders a safe callout/error state rather than a type cast.

- [ ] **Step 4: Replace workflow Chat's native form with the shared renderer**

Keep `submitDecision()` and its HTTP/WebSocket envelope. Store the submitted values locally, switch the shared renderer to read-only after the first accepted event, and retain the card in the message list. Remove the duplicated field switch and hard-coded form/control/button CSS.

- [ ] **Step 5: Run workflow Chat tests, lint, typecheck, and build**

```powershell
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Run from `packages/frontend/@n8n/chat`. Expected: PASS.

- [ ] **Step 6: Commit the shared renderer and workflow Chat migration**

Stage only `packages/frontend/@n8n/chat` changes and commit with `refactor: use json-render registry for chat forms`.

### Task 6: Agent Chat and Instance AI migration with retained read-only history

**Files:**
- Modify: `packages/frontend/editor-ui/src/features/ai/shared/JsonRenderInteractionPanel.vue`
- Modify: `packages/frontend/editor-ui/src/features/agents/components/interactive/JsonRenderInteractionCard.vue`
- Modify: `packages/frontend/editor-ui/src/features/agents/components/interactive/InteractiveCard.vue`
- Modify: `packages/frontend/editor-ui/src/features/agents/components/AgentChatMessageList.vue`
- Modify: `packages/frontend/editor-ui/src/features/ai/instanceAi/components/JsonRenderInteractionConfirmation.vue`
- Modify: `packages/frontend/editor-ui/src/features/agents/__tests__/InteractiveCard.test.ts`
- Modify: `packages/frontend/editor-ui/src/features/agents/__tests__/AgentChatMessageList.test.ts`
- Modify: `packages/frontend/editor-ui/src/features/agents/__tests__/agentChatMessages.test.ts`
- Test: `packages/frontend/editor-ui/src/features/ai/instanceAi/components/__tests__/JsonRenderInteractionConfirmation.test.ts`

**Interfaces:**
- Consumes: shared `@n8n/chat` interaction renderer from Task 5.
- Preserves Agent resume `{ approved, value? }` and Instance AI confirmation APIs.
- Uses `resolvedValue.value` for submitted read-only state and `resolvedValue.approved` for submitted/cancelled status.

- [ ] **Step 1: Add failing Agent tests for retained resolved cards**

Change `shouldRenderInteractive` expectations so resolved json-render interaction cards remain visible. Assert the rendered card receives the tool call ID as instance ID, submitted values, `readOnly: true`, and submitted/cancelled status. Assert clicking or emitting from a resolved card produces no resume event.

- [ ] **Step 2: Run Agent tests and verify resolved cards are currently filtered out**

Run the three listed Agent test files from `packages/frontend/editor-ui`.

- [ ] **Step 3: Make the existing editor wrapper delegate to the shared renderer**

Remove all Element Plus field imports, form state, field switches, and duplicated styles from `JsonRenderInteractionPanel.vue`. Keep its public Submit/Cancel events temporarily so existing callers migrate without a large diff.

- [ ] **Step 4: Retain resolved Agent interactions and pass historical state**

Allow `JSON_RENDER_INTERACTION_TOOL_NAME` in `shouldRenderInteractive` after resolution. Pass `toolCallId`, `resolvedValue?.value`, and `disabled/readOnly` through `InteractiveCard` to the renderer. Replace the unchecked fallback cast with a safe invalid-payload state.

- [ ] **Step 5: Add and run Instance AI tests**

Assert an open confirmation emits the unchanged resume call, a submitted local confirmation becomes read-only immediately, and a cancelled confirmation shows cancelled/read-only state without a decision value. Do not change DTOs, tool IDs, or `collect-decision` suspension behavior.

- [ ] **Step 6: Run editor-ui tests, lint, typecheck, and build**

Run from `packages/frontend/editor-ui`:

```powershell
pnpm test InteractiveCard.test.ts AgentChatMessageList.test.ts agentChatMessages.test.ts JsonRenderInteractionConfirmation.test.ts
pnpm lint
pnpm typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 7: Commit the Agent and Instance AI migration**

Stage only the files listed in this task and commit with `refactor: unify json-render interaction hosts`.

### Task 7: Cross-host regression, full builds, and local process restart

**Files:**
- Update if behavior changed: `D:/work/project/eit-json-render/README.md`
- Update if public APIs changed: relevant eit-json-render package documentation
- Update test evidence only; do not modify robot-dog Agent JSON or instructions.

**Interfaces:**
- Verifies all outputs from Tasks 1–6.
- Produces build logs and a manual verification record in the final handoff, not committed generated artifacts.

- [ ] **Step 1: Run the complete eit-json-render verification**

```powershell
pnpm test
pnpm build
pnpm verify:git-consumer
```

Expected: PASS. If React/AntD has no test script, their builds plus protocol compatibility fixtures are the regression gate.

- [ ] **Step 2: Run affected n8n backend and frontend package tests**

Run targeted tests for:

- RenderInteraction;
- collect-decision;
- node-tool-factory suspend/resume;
- Agent interactive message mapping;
- `@n8n/chat` structured interaction transport.

Expected: PASS with unchanged suspend/resume envelopes.

- [ ] **Step 3: Run affected package lint and typecheck**

Run `pnpm lint` and `pnpm typecheck` from `packages/@n8n/instance-ai`, `packages/@n8n/nodes-langchain`, `packages/frontend/@n8n/chat`, `packages/frontend/editor-ui`, and `packages/cli` as applicable.

- [ ] **Step 4: Run the full n8n build with redirected output**

From `D:/work/project/n8n`:

```powershell
pnpm build *> json-render-build.log
Get-Content -Tail 40 -LiteralPath json-render-build.log
```

Expected: build exits 0. Do not commit `json-render-build.log`.

- [ ] **Step 5: Restart only the n8n application dev processes**

Inspect the current terminal/process state first. Restart the local backend and editor frontend processes that load the linked eit-json-render packages. Do not restart Postgres, Redis, Mailpit, proxy, or other service containers. If n8n itself is running as an application container, rebuild/restart that application container only.

- [ ] **Step 6: Manually verify all three hosts**

Verify:

1. Agent Chat: open interaction, Submit, retained read-only values, reload session, retained read-only values, Cancel path.
2. Workflow Chat: open interaction, blocked text input, Submit/Cancel transport, retained read-only card.
3. Instance AI: collect-decision Submit/Cancel and retained read-only presentation where the transcript retains the confirmation.
4. Dashboard-only messages remain unchanged.
5. Robot-dog v3 still produces the same search/render/suspend/MCP sequence and action parameters.

- [ ] **Step 7: Review the final diffs for scope and compatibility**

Confirm no robot-dog instructions/configuration changed, no unrelated dirty files were staged, and `rg "dynamicForm"` finds no metadata-based protocol/runtime/host usage; local variable names referring to canonical `DynamicForm` elements are allowed.

- [ ] **Step 8: Commit any documentation-only follow-up**

Stage only required README/API documentation changes and commit with `docs: document canonical json-render forms`.
