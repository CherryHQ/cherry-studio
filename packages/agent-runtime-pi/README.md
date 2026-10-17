# Pi agent runtime

`createPiRuntime` adapts native Pi 1.3.0 sessions to the common runtime contract.
`create` creates a new access; `open` loads an existing native context and checks its identity.
Concurrent handles share execution and observation. Releasing a handle stops its observation;
shutdown aborts owned sessions and disposes their resources without deleting native storage.


Constructs native Pi coding-agent sessions. The caller supplies Pi's `ModelRuntime` and `Model`;
Pi owns the execution loop, tools, context accounting and compaction. The package has no AI SDK
dependency and imports no Cherry application code.

## Session builder

`createAgentRuntimeSession({ modelRuntime, model, cwd, agentDir, ... })` returns a native
`AgentSession` and an asynchronous `dispose()` method. The model runtime is borrowed: the caller
owns credentials and provider registration, and closing a session does not unregister its providers.
Settings, including retries and thinking level, retain native Pi semantics.

The owner of a model runtime can require things of every session built on it with
`setSessionRequirements(modelRuntime, { extensionFactories, settings })`: the builder installs those
extension factories ahead of the session's own and applies those settings over the session's,
whichever host builds the session. Cherry's AI SDK binding uses it for its tool-call guard and to
keep Pi's retry off.

The builder uses in-memory settings and session state, disables resource discovery, and accepts
explicit tools, extension factories, system prompts, workspace context files and skill directories.
`dispose()` aborts execution, lets extensions handle `session_shutdown`, then disposes the session.
Pi is ESM-only; CommonJS hosts must load the package with dynamic `import()`.

## Cherry integration

Cherry's AI SDK provider bridge lives in `src/main/ai/runtime/pi/aiSdkModelBinding.ts`. It supplies
native model configuration and, through session requirements, its tool-call guard ahead of approval
handlers. AI SDK conversion, retries, provider metadata and request side channels stay in Cherry.

This package is not wired into the desktop runtime yet. The integration tests live with Cherry's
bridge; `tests/nativeSession.test.ts` verifies native provider execution and borrowed-runtime ownership.

```bash
pnpm test:agent-runtime packages/agent-runtime-pi/tests/nativeSession.test.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
```
