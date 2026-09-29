# JSON Render Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable display-only `Steps` and `Step` elements that Render Dashboard can show without suspension and Render Interaction can show beside its existing form.

**Architecture:** `eit-json-render` owns the framework-independent Steps contract, collision-safe spec helper, shared dashboard spec builder, and Element Plus implementation. n8n consumes those builders in both nodes, keeps its existing output and suspend/resume envelopes, and extends the Render Interaction JSON editor with a nullable Steps configuration. React and Ant Design support is deferred.

**Tech Stack:** TypeScript, Zod 4, Vue 3, Element Plus, Vitest, pnpm workspaces, n8n node APIs.

**Spec:** `docs/superpowers/specs/2026-09-21-json-render-unified-interaction-design.md`

## Global Constraints

- Work in `D:/work/project/eit-json-render` first, then update `D:/work/project/n8n` after the new git dependency commit is available.
- Do not edit the installed packages under n8n `node_modules` or `.pnpm-fresh`.
- Preserve the existing uncommitted unified-interaction work in both repositories. Do not reset or overwrite it.
- Use pnpm for every install, build, and test command.
- Keep all technical text in ASD-STE100 Simplified Technical English.
- Keep `Steps` presentation-only. Do not add click navigation, previous or next actions, or local state mutation.
- Keep active step zero-based. Accept integer values from `0` through `items.length`, inclusive.
- Do not modify the React or Ant Design registries. Document that support as deferred.
- Keep existing n8n node configurations valid. Keep all node output, interrupt, form submit, cancel, and resume envelopes unchanged.
- Render Interaction continues to require at least one form field.
- Do not add n8n Design System dependencies to `eit-json-render`.
- Update affected README and AGENTS documentation when public APIs or supported components change.

## Review Focus

- An active value equal to `items.length` must render the all-complete state; Task 1 adds a boundary test.
- Existing element keys named `steps`, `step-0`, or similar must not be overwritten; Task 1 adds collision and immutability tests.
- A dashboard with no metrics or table but with valid Steps must pass, while a dashboard with no content must fail; Task 1 and Task 3 add tests.
- Old Render Interaction configurations without `steps` must still parse, apply, and copy; Task 5 adds compatibility tests.
- Steps inside a submitted or cancelled interaction must stay visible and must not emit a second lifecycle event; Task 6 adds host regression tests.

---

### Task 1: Add the framework-independent Steps contract and spec builder

**Repository:** `D:/work/project/eit-json-render`

**Files:**
- Create: `packages/protocol/src/steps.ts`
- Create: `packages/protocol/src/__tests__/steps.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/display-dashboard.ts`
- Modify: `packages/protocol/src/__tests__/display-dashboard.test.ts`
- Modify: `packages/protocol/AGENTS.md`

**Interfaces:**
- Produces: `JSON_RENDER_STEP_STATUS_VALUES`.
- Produces: `JsonRenderStepStatus`, `JsonRenderStepInput`, and `JsonRenderStepsInput`.
- Produces: `jsonRenderStepInputSchema` and `jsonRenderStepsInputSchema`.
- Produces: `appendStepsToSpec(spec: JsonRenderSpec, steps: JsonRenderStepsInput): JsonRenderSpec`.
- Produces: `buildDisplayDashboardSpec(input: DisplayDashboardInput): JsonRenderSpec`.
- Extends: `DisplayDashboardInput` with `steps?: JsonRenderStepsInput`.

- [ ] **Step 1: Write failing protocol tests for valid Steps composition**

Add tests named:

- `appends Steps and ordered Step children without mutating the source spec`;
- `allocates collision-safe keys for Steps and Step elements`;
- `accepts active zero and active equal to item count`.

Assert that two input items produce one `Steps` element, two ordered `Step` children, unchanged source objects, and preserved titles, descriptions, statuses, direction, alignment, simple mode, process status, and finish status.

- [ ] **Step 2: Write failing validation tests**

Add table tests that reject one item, active `-1`, active above `items.length`, a fractional active value, an empty title, and an unsupported status.

- [ ] **Step 3: Run the new protocol test and verify failure**

Run: `pnpm --filter @eit/json-render-protocol test -- src/__tests__/steps.test.ts`

Expected: FAIL because the Steps exports do not exist.

- [ ] **Step 4: Implement the Steps schemas, types, key allocation, and append helper**

Implement the interfaces exactly as listed above. Keep component-level validation in `steps.ts`. Keep the generic v1 element envelope open. Clone the input elements before insertion and append the new `Steps` key to the current root children.

- [ ] **Step 5: Run the Steps test and verify success**

Run: `pnpm --filter @eit/json-render-protocol test -- src/__tests__/steps.test.ts`

Expected: PASS.

- [ ] **Step 6: Write failing dashboard builder tests**

Add tests named:

- `builds a Steps-only display dashboard`;
- `orders description, Steps, metrics, and table`;
- `rejects a dashboard without Steps, metrics, or table`.

Assert that `buildDisplayDashboardSpec()` can create an empty Card for later form composition, while `buildDisplayDashboardPayload()` enforces display content.

- [ ] **Step 7: Refactor the dashboard builder around `buildDisplayDashboardSpec()`**

Make `buildDisplayDashboardPayload()` validate content, call `buildDisplayDashboardSpec()`, and pass the result to `buildJsonRenderPayload()`. Use `appendStepsToSpec()` inside the spec builder when Steps are present.

- [ ] **Step 8: Export the public APIs and update protocol guidance**

Export the new file from `packages/protocol/src/index.ts`. Add Steps types and builder ownership to `packages/protocol/AGENTS.md`.

- [ ] **Step 9: Run protocol tests and build**

Run:

```bash
pnpm --filter @eit/json-render-protocol test
pnpm --filter @eit/json-render-protocol build
```

Expected: all tests and the build pass.

- [ ] **Step 10: Commit the protocol change**

```bash
git add packages/protocol
git commit -m "feat: add steps protocol builders"
```

### Task 2: Add Steps and Step to the Element Plus registry

**Repository:** `D:/work/project/eit-json-render`

**Files:**
- Create: `packages/element-plus/src/steps-components.ts`
- Modify: `packages/element-plus/src/registry.ts`
- Modify: `packages/element-plus/src/index.ts`
- Modify: `packages/element-plus/src/module.ts`
- Modify: `packages/element-plus/src/__tests__/registry.test.ts`
- Modify: `packages/element-plus/AGENTS.md`
- Modify: `README.md`
- Test: `packages/vue/src/__tests__/JsonRenderPanel.test.ts`

**Interfaces:**
- Consumes: `JsonRenderStepsInput` output as `Steps` and `Step` spec elements from Task 1.
- Produces: `Steps` and `Step` `JsonRenderVueComponent` exports.
- Produces: `elementPlusRegistry.components.Steps` and `.Step`.

- [ ] **Step 1: Write failing Element Plus rendering tests**

Add tests named:

- `renders horizontal Steps with titles and descriptions`;
- `renders vertical Steps with explicit statuses`;
- `renders active equal to item count as complete`.

Mount `JsonRenderPanel` with `elementPlusRegistry`. Assert `ElSteps` props, the number and order of `ElStep` components, visible text, and status props.

- [ ] **Step 2: Run the registry test and verify failure**

Run: `pnpm --filter @eit/json-render-element-plus test -- src/__tests__/registry.test.ts`

Expected: FAIL because the registry reports unknown Steps components.

- [ ] **Step 3: Implement `Steps` and `Step` components**

Map `Steps` to `ElSteps` and `Step` to `ElStep`. Map protocol camelCase props to Element Plus props. Pass rendered Step VNodes as the default slot. Do not attach change, click, submit, or state-update handlers.

- [ ] **Step 4: Register and export the components**

Add both components to `elementPlusComponents`, export them from the package entry point, and add `steps` to the Element Plus module supported scenes.

- [ ] **Step 5: Add the Vue runtime no-event regression test**

Extend the test registry with `Steps` and `Step`. Render a Steps-only payload with an `onJsonRenderEvent` spy. Assert that it renders and the spy remains empty.

- [ ] **Step 6: Update package and root documentation**

List Steps and Step in `packages/element-plus/AGENTS.md` and the Vue + Element Plus section of `README.md`. State that React and Ant Design support is deferred.

- [ ] **Step 7: Run affected tests and builds**

Run:

```bash
pnpm --filter @eit/json-render-element-plus test
pnpm --filter @eit/json-render-vue test
pnpm --filter @eit/json-render-element-plus build
pnpm --filter @eit/json-render-vue build
pnpm verify:git-consumer
```

Expected: all commands pass.

- [ ] **Step 8: Commit the Element Plus change**

```bash
git add README.md packages/element-plus/AGENTS.md packages/element-plus/src/steps-components.ts packages/element-plus/src/registry.ts packages/element-plus/src/index.ts packages/element-plus/src/module.ts packages/element-plus/src/__tests__/registry.test.ts packages/vue/src/__tests__/JsonRenderPanel.test.ts
git commit -m "feat: render steps with element plus"
```

### Task 3: Move Render Dashboard to the protocol builder and expose Steps

**Repository:** `D:/work/project/n8n`

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/@n8n/nodes-langchain/package.json`
- Modify: `packages/@n8n/nodes-langchain/nodes/tools/RenderDashboard/RenderDashboard.node.ts`
- Delete: `packages/@n8n/nodes-langchain/nodes/tools/RenderDashboard/render-dashboard-payload.ts`
- Modify: `packages/@n8n/nodes-langchain/nodes/tools/RenderDashboard/__tests__/RenderDashboard.node.test.ts`
- Modify if metadata changes: `packages/@n8n/nodes-langchain/nodes/tools/RenderDashboard/RenderDashboard.node.json`

**Interfaces:**
- Consumes: `buildDisplayDashboardPayload()` and `JsonRenderStepsInput` from Task 1.
- Produces: optional Render Dashboard Steps parameters and unchanged `{ format, payload }` node output.

- [ ] **Step 1: Make the new eit-json-render commit consumable by n8n**

Push or otherwise expose the Task 1 and Task 2 commits on the approved git ref. Update the three `@eit/json-render-*` dependency refs together. Run `pnpm install` without editing lockfiles by hand.

- [ ] **Step 2: Write failing Render Dashboard node tests**

Add tests named:

- `builds a Steps-only dashboard through the protocol builder`;
- `builds mixed Steps, metrics, and table content`;
- `rejects a dashboard without Steps, metrics, or table`.

Assert the node output wrapper is unchanged and the payload contains one Steps element with ordered Step children.

- [ ] **Step 3: Run the focused test and verify failure**

From `packages/@n8n/nodes-langchain`, run:

`pnpm test nodes/tools/RenderDashboard/__tests__/RenderDashboard.node.test.ts`

Expected: FAIL because the node has no Steps parameters and still uses its local builder.

- [ ] **Step 4: Add the optional Steps parameter group**

Add active step, direction, align center, simple mode, process status, finish status, and repeatable items with title, description, and status. Read the group into `JsonRenderStepsInput`. Treat an absent group as `undefined`.

- [ ] **Step 5: Replace local spec construction with the protocol builder**

Import `buildDisplayDashboardPayload()` from `@eit/json-render-protocol`. Keep the existing outer node output wrapper. Change validation so Steps, metrics, or table content is sufficient. Delete `render-dashboard-payload.ts` after parity tests pass.

- [ ] **Step 6: Run focused tests, typecheck, and lint**

From `packages/@n8n/nodes-langchain`, run:

```bash
pnpm test nodes/tools/RenderDashboard/__tests__/RenderDashboard.node.test.ts
pnpm typecheck
pnpm lint
```

Expected: all commands pass.

- [ ] **Step 7: Commit the Dashboard migration**

```bash
git add pnpm-lock.yaml pnpm-workspace.yaml packages/@n8n/nodes-langchain/package.json packages/@n8n/nodes-langchain/nodes/tools/RenderDashboard
git commit -m "feat: add steps to render dashboard"
```

### Task 4: Compose Steps with the Render Interaction form

**Repository:** `D:/work/project/n8n`

**Files:**
- Modify: `packages/@n8n/nodes-langchain/nodes/tools/RenderInteraction/RenderInteraction.node.ts`
- Modify: `packages/@n8n/nodes-langchain/nodes/tools/RenderInteraction/render-interaction-payload.ts`
- Modify: `packages/@n8n/nodes-langchain/nodes/tools/RenderInteraction/__tests__/RenderInteraction.node.test.ts`
- Modify if metadata changes: `packages/@n8n/nodes-langchain/nodes/tools/RenderInteraction/RenderInteraction.node.json`

**Interfaces:**
- Consumes: `buildDisplayDashboardSpec()`, `appendDynamicFormToSpec()`, and `JsonRenderStepsInput` from Task 1.
- Produces: optional Steps before the canonical DynamicForm and unchanged decision output.

- [ ] **Step 1: Write failing Render Interaction tests**

Add tests named:

- `renders Steps before the canonical form`;
- `keeps the decision wrapper and form actions unchanged with Steps`;
- `still rejects an interaction without form fields`.

Assert the output keeps `format: 'json-render-v1'`, `phase: 'decision'`, one `DynamicForm`, `form.submit`, `form.cancel`, and the same initial form state.

- [ ] **Step 2: Run the focused test and verify failure**

From `packages/@n8n/nodes-langchain`, run:

`pnpm test nodes/tools/RenderInteraction/__tests__/RenderInteraction.node.test.ts`

Expected: FAIL because the interaction node does not read or render Steps.

- [ ] **Step 3: Add the same optional Steps parameter group**

Use the same names, defaults, status values, and conversion helper as Render Dashboard. Extract shared node-parameter definitions only if this prevents literal duplication without changing the node UI contract.

- [ ] **Step 4: Refactor the interaction payload builder**

Replace its local description, metrics, table, Stack, and Card construction with `buildDisplayDashboardSpec()`. Pass Steps with the base input. Append the canonical form through `appendDynamicFormToSpec()`. Preserve current initial form state and metadata extensions.

- [ ] **Step 5: Run focused tests, typecheck, and lint**

From `packages/@n8n/nodes-langchain`, run:

```bash
pnpm test nodes/tools/RenderInteraction/__tests__/RenderInteraction.node.test.ts
pnpm typecheck
pnpm lint
```

Expected: all commands pass.

- [ ] **Step 6: Commit the interaction composition**

```bash
git add packages/@n8n/nodes-langchain/nodes/tools/RenderInteraction
git commit -m "feat: add steps to render interaction"
```

### Task 5: Add Steps to the Render Interaction JSON editor

**Repository:** `D:/work/project/n8n`

**Files:**
- Modify: `packages/@n8n/api-types/src/render-interaction-config.schema.ts`
- Modify: `packages/@n8n/api-types/src/__tests__/render-interaction-config.test.ts`
- Modify: `packages/frontend/editor-ui/src/features/shared/toolConfig/RenderInteractionConfigJsonPanel.vue`

**Interfaces:**
- Consumes: the Render Interaction node parameter names from Task 4.
- Produces: `steps: null | RenderInteractionStepsConfig` in canonical editor JSON.
- Preserves: structured `$fromAI` values with key, description, type, and optional default.

- [ ] **Step 1: Write failing JSON export and compatibility tests**

Add tests named:

- `exports null Steps for an existing configuration without Steps`;
- `exports every Steps parameter and incomplete item in best-effort JSON`;
- `keeps old JSON without Steps valid and normalizes it to null`.

Assert that the existing top-level parameters remain unchanged.

- [ ] **Step 2: Write failing strict validation and round-trip tests**

Cover two valid items, one invalid item, duplicate or empty titles if prohibited by the protocol schema, active `-1`, active above item count, active equal to item count, and `$fromAI` values for active, title, and description. Assert invalid JSON does not produce node parameters.

- [ ] **Step 3: Run the API test and verify failure**

From `packages/@n8n/api-types`, run:

`pnpm test src/__tests__/render-interaction-config.test.ts`

Expected: FAIL because the canonical schema does not contain `steps`.

- [ ] **Step 4: Extend canonical, draft, legacy, and node conversion paths**

Add a nullable Steps schema. Always emit the top-level `steps` key. Convert model expressions through the existing `$fromAI` helpers. Keep best-effort export permissive and strict Copy or Apply validation aligned with the protocol builder constraints.

- [ ] **Step 5: Update the editor template**

Add `steps: null` to the inserted minimal template. Do not add a second JSON editor or a Steps-specific modal.

- [ ] **Step 6: Run API and frontend checks**

Run:

```bash
cd packages/@n8n/api-types
pnpm test src/__tests__/render-interaction-config.test.ts
pnpm build
pnpm typecheck

cd ../../frontend/editor-ui
pnpm typecheck
pnpm lint
pnpm lint:styles
```

Expected: the focused test and affected-file checks pass. Record unrelated baseline failures separately; do not weaken checks to hide them.

- [ ] **Step 7: Commit the JSON configuration change**

```bash
git add packages/@n8n/api-types/src/render-interaction-config.schema.ts packages/@n8n/api-types/src/__tests__/render-interaction-config.test.ts packages/frontend/editor-ui/src/features/shared/toolConfig/RenderInteractionConfigJsonPanel.vue
git commit -m "feat: configure interaction steps as json"
```

### Task 6: Verify all Vue hosts, dependency packaging, and documentation

**Repositories:** `D:/work/project/eit-json-render`, then `D:/work/project/n8n`

**Files:**
- Modify tests as needed: `packages/frontend/@n8n/chat/src/__tests__/JsonRenderInteraction.spec.ts`
- Modify tests as needed: `packages/frontend/@n8n/chat/src/__tests__/MessageJsonRenderInteraction.spec.ts`
- Modify tests as needed: `packages/frontend/editor-ui/src/features/agents/__tests__/jsonRenderInteractionPanel.render.test.ts`
- Modify tests as needed: `packages/frontend/editor-ui/src/features/ai/shared/__tests__/jsonRender.utils.test.ts`
- Modify: `docs/superpowers/specs/2026-09-21-json-render-unified-interaction-design.md` only if implementation decisions changed
- Modify: `docs/superpowers/plans/2026-09-29-json-render-steps.md` checkboxes during execution

**Interfaces:**
- Consumes: the final git-consumable eit-json-render packages and both updated n8n nodes.
- Produces: verified display, active interaction, submitted history, and cancelled history behavior in all Vue hosts.

- [ ] **Step 1: Add host regression fixtures**

Use a shared Steps payload fixture where practical. Assert that display rendering does not call a resume callback. Assert that active interaction rendering includes Steps. Assert that submitted and cancelled read-only cards keep Steps visible and do not emit a second response.

- [ ] **Step 2: Run affected n8n frontend tests**

Run the exact Vitest files from their owning package directories. Include both `@n8n/chat` interaction tests, Agent Chat interaction rendering, and json-render display utility tests.

Expected: all affected tests pass.

- [ ] **Step 3: Run the complete eit-json-render verification**

From `D:/work/project/eit-json-render`, run:

```bash
pnpm test
pnpm build
pnpm verify:git-consumer
```

Expected: all commands pass and the git consumer can import the new public APIs.

- [ ] **Step 4: Run the complete affected n8n verification**

Run package tests, lint, and typecheck for `@n8n/nodes-langchain`, `@n8n/api-types`, `@n8n/chat`, and editor-ui. Then run the repository build with redirected output:

```bash
pnpm build > build.log 2>&1
```

Inspect the final build log lines and record any unrelated baseline failures.

- [ ] **Step 5: Perform manual checks in all three hosts**

Verify:

1. Render Dashboard shows a Steps-only card and does not block input.
2. Render Interaction shows Steps and Form together and blocks until Submit or Cancel.
3. Submit preserves Steps in a read-only card and returns the same form value envelope.
4. Cancel preserves Steps in a read-only card and returns the same cancellation envelope.
5. Agent Chat, workflow chat, and Instance AI use the same Element Plus rendering.

- [ ] **Step 6: Confirm deferred React behavior**

Run existing React and Ant Design regression tests without adding Steps components. Confirm existing payloads remain unchanged and document the unknown-component fallback for Steps.

- [ ] **Step 7: Commit integration coverage and documentation**

```bash
git add packages/frontend/@n8n/chat/src/__tests__/JsonRenderInteraction.spec.ts packages/frontend/@n8n/chat/src/__tests__/MessageJsonRenderInteraction.spec.ts packages/frontend/editor-ui/src/features/agents/__tests__/jsonRenderInteractionPanel.render.test.ts packages/frontend/editor-ui/src/features/ai/shared/__tests__/jsonRender.utils.test.ts docs/superpowers/specs/2026-09-21-json-render-unified-interaction-design.md docs/superpowers/plans/2026-09-29-json-render-steps.md
git commit -m "test: cover steps across json render hosts"
```
