# the-boss UAR driver contract

The contract the-boss's UAR runtime driver (step 3) must follow when it launches and talks to
`uar-sidecar`. Each section names the UAR OpenSpec change that defines the sidecar side. Update this note
when a UAR change lands; the-boss code must cite the change by name.

## `sidecar-launch-security` (UAR commit `e44846af`)

1. **Spawn.** Start `uar-sidecar` from the bundled-binary path with stdin as a pipe the driver keeps open
   for the sidecar's lifetime. Closing stdin shuts the sidecar down.
2. **Token first.** Generate a fresh 256-bit token per launch and write it as the **first line of stdin**
   before anything else. Never pass it in argv, environment variables, files, URLs or logs, and never send
   it to the renderer. Rotate it on every restart. Without a valid first line the sidecar exits with
   status 2 and never prints `READY`.
3. **Ready.** Read stdout until `READY:{port}`.
4. **Connect.** Connect only to `127.0.0.1:{port}` (Host header `127.0.0.1:{port}` or `localhost:{port}`).
   Send `Authorization: Bearer <token>` on **every** request, including SSE streams. Never send an
   `Origin` header. Expect 401 for a missing or wrong token and 403 for a bad Host or any Origin.
5. **No CORS, no UI.** The sidecar serves no CORS, no operator UI, no `[::1]` listener and no A2A gRPC.
   All calls come from the Electron main process; the renderer never talks to the sidecar.
6. **Capabilities.** Call `GET /api/uar/capabilities` after `READY`. Refuse UAR agents with a clear
   message when a required capability flag is missing (flags are added as the later changes land).
7. **Global MCP is off in the current bootstrap.** Global MCP registration returns 409 through the
   settings-manager lock; the driver passes MCP servers per run (`run-scoped-credentials-and-mcp-servers`).
   Commit `cd739e82` records that the lock depends on persistence/settings-manager initialization.
   `surreal-scoped-signin-and-embedded-fallback` must preserve it on every new fallback path.
8. **Governance is on.** A token-authenticated sidecar reports governance `required`
   (`host_token_required`); run-policy denials and approvals are enforced.

## Later changes

Sections are added as `sidecar-session-principal`, `run-scoped-credentials-and-mcp-servers`,
`run-request-host-context`, `agui-runs-stream-fidelity` and the others land.
