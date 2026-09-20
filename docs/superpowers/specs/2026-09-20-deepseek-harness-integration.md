# DeepSeek Harness Integration Specification

## Purpose

This document defines the planned DeepSeek Harness integration in n8n. It records the decisions that are stable today. It also separates implemented behavior from planned behavior.

## Product Model

DeepSeek Harness is a peer to n8n Agents. It is not an n8n workflow node in the first delivery.

One n8n DeepSeek Harness agent owns one isolated Harness profile. The profile is backed by one Harness home directory (`DSH_HOME`) and, when creation is implemented, one `.dsh` configuration scope. The profile holds Harness credentials, settings, plugins, presets, and session data. “Profile” is an internal isolation boundary, not an extra user-facing object.

```mermaid
flowchart LR
	U["n8n user"] --> A["n8n DeepSeek Harness agent"]
	A --> P["Harness profile"]
	P --> H["Isolated DSH_HOME"]
	P --> R["Harness runtime when active"]
	R --> S["Harness sessions"]
```

## Isolation Rules

- A Harness profile has its own `DSH_HOME` directory.
- A runtime can access one profile only.
- Only one runtime can write to one `DSH_HOME` directory at a time.
- Different profiles can run at the same time.
- A stopped runtime does not delete the profile directory.
- n8n must not modify the DeepSeek Harness source code.

These rules prevent settings, credentials, plugins, and sessions from being shared by accident.

## Runtime Model

The future runtime manager starts a Harness runtime only when an agent needs it. It can stop an idle runtime after a configured period. This does not require one permanent container for every agent.

The deployment model can use Docker containers. It can also use isolated processes in a development environment. The runtime contract is the same in both models: one active runtime maps to one profile home directory.

## n8n Environment Configuration

n8n exposes the Harness home root through an environment variable:

```text
N8N_DEEPSEEK_HARNESS_HOME=D:\\n8n-data\\deepseek
```

When the variable is not set, n8n keeps the native Harness default of `~/.dsh`. The future runtime launcher passes the resolved value to the Harness process as `DSH_HOME`. Agent-specific `.dsh` data must remain below this configured root and must not use a user-supplied arbitrary path.

## Configuration UI

The native Harness Studio remains the preferred configuration UI. It is not part of the initial entry-page delivery.

When Studio support is added, n8n opens Studio for the selected profile only. The runtime manager must pass the profile-specific `DSH_HOME` and a scoped Studio access URL. A Studio page must never point to another profile.

## Current Delivery: Create an Isolated Harness Profile

The current delivery contains the frontend entry, project-scoped creation, persistence, and isolated Harness home creation. It does not start a Harness process or open Studio.

Implemented behavior:

- Add a `DeepSeek Harness` preview tab after `Agents`.
- Add routes for Overview and project pages.
- Show the Agent-style empty state with an active `Create DeepSeek Harness` action.
- Show the existing Insights summary on the Overview page.
- Show `DeepSeek Harness` in the project-header create menu.
- Use `Create DeepSeek Harness` consistently for the header and empty-state actions.
- Read `N8N_DEEPSEEK_HARNESS_HOME`, defaulting to `~/.dsh`.
  - Create a Harness agent with a workflow-style unique default name.
  - Open the created agent detail page with a `Personal / Agent name` breadcrumb.
  - Rename the agent from the breadcrumb. The profile directory follows the new name.
  - Reserve the detail page body for the future native Harness Studio surface.
  - Create the isolated home at `<N8N_DEEPSEEK_HARNESS_HOME>/<userName>/<agentName>-<agentId>`.
- List the created Harness agents for the current project.

The entry belongs to the existing `AgentsModule`. This is deliberate. The project header shows custom tabs only for active frontend modules. The creation and persistence logic uses a dedicated backend module and table.

## Persistence Boundary

The Harness agent uses the dedicated `deepseek_harness_agents` table. It does not reuse the native `agents` table.

  The table stores the agent ID, project ID, account email, name, status, and timestamps. A unique `(projectId, name)` constraint prevents duplicate names inside one project. The project foreign key cascades when the project is deleted.

  The server derives the profile directory from the authenticated n8n account email, the persisted agent name, and the persisted agent ID. The API never accepts a client-provided filesystem path. If home creation fails, the database row is not left behind. Legacy records keep the original `<root>/agents/<agentId>` location until they are deleted.

  Renaming an account-scoped agent moves its profile directory before the database update. If the database update fails, the directory move is rolled back.

The current REST contract is:

```text
POST /projects/:projectId/deepseek-harness/agents
GET  /projects/:projectId/deepseek-harness/agents
GET  /projects/:projectId/deepseek-harness/agents/:agentId
```

  Creation accepts an empty object and returns the agent ID, project ID, generated name, status, and timestamps. The generated name uses the existing n8n naming rule: the base name is used when available, otherwise the highest numeric suffix is incremented. Names can be reused after deletion, matching workflow behavior.

  `PATCH /projects/:projectId/deepseek-harness/agents/:agentId` accepts `{ name }` and updates the display name. The name must be non-empty and is limited to 128 characters.

## Non-goals of the Current Delivery

- No DeepSeek Harness source change.
- No Harness container or process startup.
- No Studio launch.
- No n8n workflow node.
- No runtime manager or idle shutdown policy.

## Open Product Decisions

The following decisions need a separate requirement before implementation:

- The runtime-manager deployment service and authentication model.
- The Studio reverse-proxy and scoped access-token design.
- The idle timeout and capacity policy.
- The workflow-node contract for calling a Harness agent.
