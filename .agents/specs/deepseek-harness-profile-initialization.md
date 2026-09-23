# DeepSeek Harness Profile Initialization

## Goal

Create a real DeepSeek Harness profile when an n8n DeepSeek Harness agent is created.

## Scope

- Use the agent directory as the isolated `DSH_HOME`.
- Use the official DeepSeek Harness CLI without changing Harness source code.
- Initialize the custom `n8n-web` profile from the shipped `web` profile.
- Create one default `empty-workspace` directory for each agent profile.
- Register the default workspace through Harness's existing `workspace/create` API when Web starts.
- Migrate persisted workspace paths before an agent profile directory is renamed.
- Keep a compatibility link at the old profile path for historical session headers.
- Merge duplicate workspace records when a previous rename already created both paths.
- Keep Studio process management out of this change.
- Keep the current n8n database and naming behavior.

## Configuration

| Environment variable | Meaning | Default |
| --- | --- | --- |
| `N8N_DEEPSEEK_HARNESS_HOME` | Root directory for n8n-owned Harness homes | `~/.dsh` |
| `N8N_DEEPSEEK_HARNESS_PATH` | Harness source or installation directory used as the CLI working directory | `''` |
| `N8N_DEEPSEEK_HARNESS_PROFILE` | Profile name created for each agent | `n8n-web` |

When the Harness path is empty, n8n reports a configuration error instead of
running a command from an unknown directory.

## Creation flow

1. Generate the unique n8n agent name and ID.
2. Create the isolated agent home.
3. Create `<agentHome>/empty-workspace`.
4. Run the platform-specific pnpm executable from the configured Harness path.
   Use the boot-free `--dump-config` mode so Profile creation does not start Studio:

   ```text
   pnpm dsh --profile <profile> --from-default-profile web --dump-config
   ```

5. Pass `DSH_HOME=<agentHome>` to the child process.
6. Verify `<agentHome>/profiles/<profile>/package.json` and
   `<agentHome>/profiles/<profile>/cordis.patch.yml` exist.
7. Persist the agent only after initialization succeeds.
8. Remove the new home when initialization or persistence fails.

When Studio starts, n8n authenticates with the URL token returned by Harness
and calls `workspace/create` with the default workspace path only when the
profile registry does not already contain `empty-workspace`. n8n reuses the
registered workspace ID after a restart. n8n processes one startup URL only,
even when the child emits the same URL in multiple output chunks. Workflow
session creation passes the returned `workspaceId` to `session/create`.

When an agent is renamed, n8n stops the Web process and updates Harness's
persisted `storages/workspace.json` file. n8n rebases current and historical
workspace paths and merges records that resolve to the same target path. n8n
then renames the physical profile directory and creates a compatibility link
at the old path for historical session headers.

## Failure behavior

- The database must not contain an agent whose Harness profile failed to initialize.
- The database must not contain an agent whose home cleanup failed after persistence failed.
- The child process error must be returned to the caller.
- Existing agent homes must not be reused by initialization.

## Non-goals

- Starting or stopping the Studio Web process.
- Assigning a Studio port.
- Publishing state persistence.
- Studio process startup, port allocation, and idle shutdown.

## Implementation TODO

- [x] Add Harness CLI configuration.
- [x] Add a testable CLI initialization service.
- [x] Initialize and verify the profile during agent creation.
- [x] Add failure cleanup tests.
- [x] Create and register the default `empty-workspace`.
- [x] Bind workflow-created sessions to the default workspace.
- [x] Ignore duplicate startup URL output while workspace registration is pending.
- [x] Migrate persisted workspace paths during profile rename.
- [x] Preserve old profile paths through compatibility links.
- [x] Merge duplicate workspace records during path migration.
- [x] Update the implementation plan after verification.

Studio process startup, port allocation, and idle shutdown remain outside this
spec and require a later implementation cycle.
