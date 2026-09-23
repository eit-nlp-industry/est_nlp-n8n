# DeepSeek Harness Session Deep Link

## Goal

Open the native DeepSeek Harness Trajectory view for the exact Session emitted
by a DeepSeek Harness workflow node.

## Scope

- Add a `View session` action to n8n execution log details for DeepSeek Harness
  node output.
- Reuse the existing native Harness Web process for the selected Profile.
- Add a small Harness Web bootstrap hook that accepts `sessionId` in the URL.
- Open the matching Session and activate the `trajectory` view after Harness
  finishes loading its Session list.
- Remove the deep-link query parameters after the target is selected.

## Out of scope

- Do not copy or reimplement the Harness Trajectory UI in n8n.
- Do not add a second n8n database table for Harness trajectory events.
- Do not change Harness execution, Agent, Session storage, or RPC behavior.
- Do not change the existing Profile iframe page in this task.

## Deep-link contract

The n8n link uses the authenticated Harness URL and appends:

```text
?n8nSessionId=<sessionId>&n8nTrajectory=1
```

The Harness Web client reads these parameters once. It waits until Workspace
and Session data are ready. It opens the requested Session and activates the
Trajectory view. It removes the parameters with `history.replaceState`.

If the Session is not available, Harness keeps its normal recent-Session
restore behavior and removes the invalid parameters.

## Security

- n8n must resolve the project-owned Agent page through the normal router.
- The existing Profile page remains responsible for obtaining the authenticated
  Studio URL.
- The Session ID is treated as an opaque value and URL-encoded by the router.
- Harness must only use the Session ID to select a Session already visible to
  the active Profile.

## Implementation TODO

- [x] Add Harness Web deep-link bootstrap logic.
- [x] Add tests for parsing and removing deep-link parameters.
- [x] Add n8n Session link extraction for DeepSeek Harness node output.
- [x] Add n8n link tests for the project-scoped Session endpoint.
- [x] Reuse the existing View session action in execution log details.
- [x] Run focused Harness and n8n tests.
- [x] Re-read this spec and verify implementation alignment.

The valid and unavailable Session selection paths use the same bootstrap
cleanup behavior. The Harness UI integration test remains covered by the
existing UI conversation test suite and the focused type checks.
