# Pi agent runtime

`createPiRuntime` adapts native Pi 1.3.0 sessions to the common runtime contract.
`create` creates a new access; `open` loads an existing native context and checks its identity.
Concurrent handles share execution and observation. Releasing a handle stops its observation;
shutdown aborts owned sessions and disposes their resources without deleting native storage.

The caller supplies a borrowed native `ModelRuntime` and `Model`, a working directory and an agent
directory. Credentials and provider registration remain with the caller. Closing the runtime leaves
the supplied model runtime usable. This package has no AI SDK or Cherry application dependency.

`createAgentRuntimeSession` constructs native sessions with explicit tools and extension factories.
Resource discovery is disabled; workspace context and skill paths are opt-in. Native retry settings
remain effective. Pi owns input preflight, busy steering/follow-up, the agent loop and tool execution.

Pass a native `SessionManager.create` or `SessionManager.open` for file storage; omit it for in-memory
storage. The host selects paths and records product-session associations. Native low-level `open`
accepts a missing path as a new session, so the host must check file existence when reopening saved
associations; the adapter rejects a returned session ID that differs from the requested thread.

Common observations normalize current native messages, live output and foreground activity. They
are projections, not an archive or a storage replay source. Cherry model binding and execution
extensions are added by subsequent layers; this adapter is not wired into the desktop runtime yet.

```sh
pnpm --filter @cherrystudio/agent-runtime build
pnpm test:agent-runtime-pi packages/agent-runtime-pi/tests/nativeSession.test.ts packages/agent-runtime-pi/tests/runtime.test.ts
pnpm --filter @cherrystudio/agent-runtime-pi typecheck
```
