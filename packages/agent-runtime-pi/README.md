# Pi agent runtime

`createPiRuntime` adapts native Pi 1.4.0 sessions to the common runtime contract.
`create` creates a new access; `open` loads an existing native context and checks its identity.
Concurrent handles share execution and observation. Releasing a handle stops its observation;
shutdown aborts owned sessions and disposes their resources without deleting native storage.

The caller supplies a borrowed native `ModelRuntime` and `Model`, a working directory and an agent
directory. Credentials and provider registration remain with the caller. Closing the runtime leaves
the supplied model runtime usable. Content uses the common AI SDK message protocol; this package has no Cherry application dependency.


Constructs native Pi coding-agent sessions. The caller supplies Pi's `ModelRuntime` and `Model`;
Pi owns the execution loop, tools, context accounting and compaction. Content uses the common AI SDK message protocol; the package imports no Cherry application code.
Native deltas accumulate once into ordered SDK messages, including preliminary/final tool results.


## Session builder

`createAgentRuntimeSession({ modelRuntime, model, cwd, agentDir, ... })` returns a native
`AgentSession` and an asynchronous `dispose()` method. The model runtime is borrowed: the caller
owns credentials and provider registration, and closing a session does not unregister its providers.
Settings, including retries and thinking level, retain native Pi semantics.

The builder uses in-memory settings and session state, disables resource discovery, and accepts
explicit tools, extension factories, system prompts, workspace context files and skill directories.
Without a `systemPrompt` Pi's own prompt is used, and Pi appends a `<cwd>` section either way. No
built-in tool is enabled unless `builtinTools` names it. Workspace `AGENTS.md` / `CLAUDE.md` files
load only with `contextFiles: true`, and skills only from the host's `skillPaths`.
`dispose()` aborts execution, lets extensions handle `session_shutdown`, then disposes the session.
Pi is ESM-only; CommonJS hosts must load the package with dynamic `import()`.

Known gap: Pi's resource loader still resolves its discovery directories while it loads; the
`no*` flags and prompt overrides discard everything it finds there.

## Cherry integration

Cherry registers a native Pi provider pointed at its internal gateway in
`src/main/ai/runtime/pi/gatewayModelBinding.ts`. Pi owns protocol encoding, streaming, replay and
tool execution; the gateway owns Cherry provider resolution, credentials and usage records.
No model-call interface or session requirements are needed in this package.

The desktop cutover is a later stack layer. Gateway integration tests live in Cherry's Main
process project; `tests/nativeSession.test.ts` verifies native providers and borrowed-runtime ownership.

```bash
pnpm test:agent-runtime-pi packages/agent-runtime-pi/tests/nativeSession.test.ts
pnpm --filter @cherrystudio/agent-runtime-pi typecheck
```
