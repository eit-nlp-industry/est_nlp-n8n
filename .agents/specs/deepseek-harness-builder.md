# Harness Builder

## Goal

Add an interactive `build-harness` flow that follows the existing
`build-agent` experience. The flow creates and configures a DeepSeek Harness
profile for the current project.

## Phase one scope

- Create a Harness profile.
- Resolve the current Assistant model against the Harness runtime catalog.
- Automatically use the only matching project Credential.
- Ask for a model or Credential only when automatic resolution is not unique.
- Configure the provider, model, and credential in the Harness profile.
- Verify the profile in standard mode.
- Return the verified profile as an unpublished draft.

Phase one supports DeepSeek, OpenAI, and Anthropic when the Harness runtime
reports them as available. Creator mode is not part of this phase. n8n does
not edit shared Harness configuration files.

## User flow

```text
Assistant
  |
  v
Load harness-builder
  |
  v
build-harness
  |
  v
Create Harness profile
  |
  v
Resolve Assistant model and project Credential
  |
  v
Ask only when resolution is ambiguous
  |
  v
Configure provider, model, and Credential
  |
  v
Verify standard mode
  |
  v
  Return the verified unpublished draft
```

The Builder uses interactive cards for questions and Credential selection. It
must suspend and resume through the same mechanism as `build-agent`.

The standard-mode check must succeed before the Builder returns the profile.
The profile remains unpublished. The user can configure advanced Harness
features manually in Studio.

## Model and provider selection

The Builder must use the Harness model catalog as the source of truth. It must
not hard-code a model list in the Assistant prompt.

The selected model is represented as:

```json
{
  "provider": "openai",
  "model": "gpt-4.1"
}
```

The actual provider and model IDs come from the Harness runtime. Unsupported
models must be rejected before profile configuration.

## Credential selection

The Assistant lists project-accessible n8n Credentials when selection is
required. When the current model provider is known, only Credentials for that
provider are offered. A single matching Credential is selected automatically.
The backend validates that the selected Credential is accessible to the current
user and project.

The backend decrypts the selected Credential only inside the CLI process. The
decrypted value must never enter the Builder prompt, Assistant event, tool
result, or log.

The provider-specific mapping is owned by the Harness configuration adapter:

```text
provider  -> Harness credential reference
DeepSeek  -> provider-specific Harness reference
OpenAI    -> provider-specific Harness reference
Anthropic -> provider-specific Harness reference
```

The adapter must not assume that an n8n Credential type name is the same as a
Harness provider reference.

The selected Credential must be resolved through the existing project-scoped
credential provider. The flow must reject a Credential that the current user
cannot use in the current project before decryption.

The Harness profile does not persist the API key in the n8n database. The
Harness profile home remains the source of the Harness runtime configuration.
The n8n Credential remains the source of the user-managed secret.

n8n reads only redacted Harness configuration facts. A profile is configured
when its `default-model` namespace has a provider and model, and the mapped
Harness credential reference reports `configured: true`. n8n never reads a
credential value from the Harness API.

The configuration request must carry only identifiers at the Assistant
boundary:

```json
{
  "profileId": "harness-profile-id",
  "credentialId": "n8n-credential-id",
  "provider": "openai",
  "model": "gpt-4.1"
}
```

The CLI resolves and decrypts the Credential, maps the provider to the
Harness credential reference, writes the secret through the authenticated
Harness API, and restarts the runtime.

## Builder contract

The public Assistant tool is `build-harness`. It follows the targeting and
suspend/resume behavior of `build-agent`.

The Builder accepts a user message and an optional target profile:

```json
{
  "message": "Create a research Harness",
  "profileId": "optional-existing-profile-id"
}
```

In phase one, `message` is request context only. It does not configure a
Persona, plugin, preset, Skill, or runtime tool.

The tool returns only non-secret metadata:

```json
{
  "ok": true,
  "profileId": "harness-profile-id",
  "profileName": "Research Harness",
  "provider": "openai",
  "model": "gpt-4.1",
  "published": false
}
```

## Backend components

- `harness-builder` skill: defines routing and Builder behavior.
- `build-harness` tool: starts or resumes the Builder session.
- Harness Builder delegate: applies project scope and target binding.
- Harness configuration adapter: maps provider/model/Credential values to the
  Harness API.
- `DeepSeekHarnessService`: creates profiles through the Builder delegate and controls lifecycle.
- Existing `DeepSeekHarnessWebService`: configures the runtime and restarts it.
- `DeepSeekHarnessRpcService`: executes standard Harness sessions.

The Harness Builder must not call the Agent Builder. A Harness Profile is
represented as an n8n Agent resource and uses the same draft/published model.

## Existing resource behavior

- An explicit existing profile ID edits that profile.
- A unique profile name may resume a profile already targeted in the current
  Builder session.
- The Builder must not create a second profile when the current session target
  is unambiguous.
- Profile discovery by semantic description is out of scope for phase one.

Builder target metadata records the current phase and the standard test session
ID. The phases are `selection`, `baseline`, and `completed`.

## Error handling

- No provider or model: ask the user to choose one.
- Harness does not report the selected provider or model: reject the choice.
- Standard mode fails: keep the profile unpublished and report the failure.
- No Credential: ask the user to create or select one.
- Credential is not accessible: reject without decryption.
- Credential has no usable provider field: return a clear user error.
- Profile creation fails: do not publish the profile.
- Runtime configuration fails: keep the profile unpublished and return the
  setup error.
- Restart fails: preserve the written configuration and allow retry.
- Test fails: keep the profile as a draft and show the non-secret error.
- Publish fails when the profile has no configured model or mapped credential.
- Workflow execution fails when the profile has no configured model or mapped
  credential, including draft manual and chat execution.

If a selected Credential has no usable provider value, return a clear user
error and allow another Credential to be selected. If runtime restart fails,
preserve the written configuration so the user can retry without creating a
second profile.

## Security constraints

- Never expose decrypted Credential data to the model.
- Never include API keys in tool results, events, prompts, or logs.
- Do not request `danger-full-access` for normal profile setup.
- Do not modify shared Harness configuration files during profile setup.
- Use project-scoped Credential access checks.
- Use the existing backend Credential decryption path.
- Keep the default Harness tools, skills, prompts, and presets owned by the
  Harness default profile. n8n may only write its managed workspace and the
  selected runtime model credential.

## Out of scope

- Persona prefix configuration.
- Plugin installation.
- Custom preset creation.
- Shared Harness configuration mutation.
- Agent-to-Harness or Harness-to-Agent automatic conversion.
- Automatic semantic reuse of arbitrary existing profiles.

## Implementation TODO

- [x] Add the `harness-builder` skill.
- [x] Add the `build-harness` orchestration tool.
- [x] Add Builder session targeting and suspend/resume support for model and Credential selection.
- [x] Add Harness provider and model catalog discovery.
- [x] Add provider-specific Credential mapping for DeepSeek, OpenAI, and Anthropic.
- [x] Extend the Harness API adapter for provider and model configuration.
- [x] Add interactive Credential and model selection.
- [x] Return a verified unpublished draft.
- [x] Read redacted model and credential state from the Harness runtime.
- [x] Reject publish and Workflow execution for unconfigured profiles.
- [ ] Add tests for targeting, permissions, provider mapping, secret handling,
  restart, test failure, and publish behavior.

The Builder is the only Assistant creation and configuration path. The
Overview may create an empty profile through the resource API and open its
detail page for manual configuration. It does not configure credentials or
models through the old Assistant tool. Workflow construction can select an
existing profile or direct the user to the Builder when a configured profile
is required.
