# DeepSeek Harness Web Embedding

## Goal

Start the native DeepSeek Harness Web UI on demand and embed it in the n8n
DeepSeek Harness agent detail page.

## Scope

- Start one Web process for an agent when its detail page requests the Studio URL.
- Use `--port 0` and `--no-open`.
- Use the agent's isolated Harness home as `DSH_HOME`.
- Return the native authenticated Harness URL to the n8n frontend.
- Embed the URL in an iframe.
- Replace the URL host with the current n8n host before embedding so local
  browsers can retain the Harness authentication cookie.
- Keep the live `ChildProcess` reference in memory.
- Persist the last known runtime summary in the database.
- Stop a process when n8n shuts down.

## Isolation

Each process receives the selected agent home through `DSH_HOME`. The process
also uses the configured Harness profile name. The base embedded Studio page
does not require Harness source changes. The separate Session deep-link
feature adds a small Web bootstrap hook in Harness.

## API

`GET /projects/:projectId/deepseek-harness/agents/:agentId/studio`

`POST /projects/:projectId/deepseek-harness/agents/:agentId/publish`

`POST /projects/:projectId/deepseek-harness/agents/:agentId/unpublish`

The endpoint requires the existing `agent:read` project access and returns:

```ts
{ url: string }
```

Agent list and detail responses also include the last persisted runtime summary:
`runtimeStatus`, `runtimePort`, `runtimeUrl`, and `runtimeError`.
They also include the persisted `published` flag.

The service verifies the agent belongs to the project before starting a
process. Repeated requests for the same agent reuse the running process.

## Process lifecycle

- Spawn the compiled Harness entry from `N8N_DEEPSEEK_HARNESS_PATH`.
- Run `apps/cli/lib/bin.js` with the current Node executable.
- Pass `--profile <profile> --no-open --port 0`.
- Parse the authenticated `dsh web:` URL from stdout.
- Persist `starting`, `running`, `error`, and `stopped` runtime states.
- Persist the last PID, port, URL, error, and start/stop timestamps.
- Start all published agents when the n8n module initializes.
- Keep published processes running until the agent is unpublished or n8n shuts down.
- `published` means managed lifecycle (restore on boot, keep-alive). Workflow
  nodes may also start an unpublished agent on demand during manual/chat runs;
  that does not flip `published`.
- Reject startup when the process exits or no URL is received within the startup timeout.
- Kill the child process when the service is disposed.
- Treat persisted PID and port values as historical data after an n8n restart.

## Deliberate MVP limits

- The browser connects to the native Harness port through the iframe. n8n does
  not proxy the Studio yet.
- The first version is intended for local same-host access. Remote deployments
  still need the planned same-origin proxy.
- Idle process shutdown is a follow-up task.
- n8n does not restore an old process from persisted PID or port data.

## Implementation TODO

- [x] Add a process manager with injectable child-process and timer boundaries.
- [x] Add the project-scoped Studio endpoint.
- [x] Add API client support.
- [x] Embed the returned URL in the detail view.
- [x] Add backend and frontend tests.
- [x] Verify startup and shutdown behavior on Windows command resolution.
- [x] Persist runtime state and summary fields.
- [x] Persist publish state and restore published processes on startup.
