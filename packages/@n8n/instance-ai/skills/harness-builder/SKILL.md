---
name: harness-builder
description: >-
  Creates, configures, or uses a DeepSeek Harness profile through the
  interactive build-harness flow. Use when the user asks the Assistant to
  create a Harness profile or use one in a workflow. This skill does not build
  an n8n Agent.
recommended_tools:
  - build-harness
  - deepseek-harness
  - build-workflow
  - nodes
---

# Harness Builder

Use this skill when the user asks the Assistant to create or configure a
DeepSeek Harness profile.

## Required flow

1. Use `build-harness` for the setup flow.
2. Let the Harness runtime provide the provider and model choices.
3. Ask the user to select a project Credential.
4. Verify standard mode.
5. Return the verified profile as an unpublished draft.
6. Never ask the user to paste an API key into chat.

The request message is context only in phase one. Do not claim that it changed a
Persona, plugin, preset, Skill, or runtime tool configuration.

Do not start Harness Creator in this phase. The user can configure advanced
Harness features manually in Studio.

## Workflow flow

1. Use `deepseek-harness` with `action: "list"`.
2. Reuse a profile only when the user provides its ID or an exact unique name.
3. If no existing profile matches, use `build-harness` before building the workflow.
4. Load `workflow-builder` and use `nodes` to inspect
   `n8n-nodes-base.deepSeekHarness`.
5. Use `build-workflow` to create or edit the workflow.
6. Bind the selected profile ID to the node `agentId` parameter.
7. Use `deepseek-harness` with `action: "publish"` only when production
   execution requires a published profile.

Do not create a profile through `deepseek-harness`. Do not use Message an Agent
for an explicit Harness request.

The Builder does not edit shared Harness configuration files.

## Provider support

Phase one supports DeepSeek, OpenAI, and Anthropic when the runtime catalog
reports those providers. Do not invent model IDs.

## Existing profiles

Use an explicit profile ID when the user provides one. Do not create a second
profile when the current Builder session already has an unambiguous target.

## Security

Credential values stay inside the CLI process. Do not place them in prompts,
tool results, logs, or profile names. Do not modify shared Harness files.
