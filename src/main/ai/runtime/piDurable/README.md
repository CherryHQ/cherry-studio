# Pi Durable desktop integration

`PiDurableRuntimeDriver` registers the `pi-durable` Agent type. Its connection owns
one `agent-runtime-pi-durable` backend, the root access and all observed children.
The package implements native execution; `agent-behavior` owns product rules.

## Host services

The connection reuses Pi's gateway model binding, behavior host, approval facts,
shell configuration and tool rendering. Each native provider call reaches Cherry's
internal gateway, which owns upstream credentials and billing. Child bindings share
the root model registry and are restored before native execution resumes. Each added
model uses its own native provider registration, preserving other models' routes,
request options and usage callbacks even when their Cherry Provider is the same.

`durableDesktop.ts` installs native coding tools, codemode and tool search, Cherry's
prompt and selected skills. `durableMcp.ts` connects Cherry-selected MCP servers through
linked transports. Deferred MCP tools remain discoverable through native codemode;
nested calls pass the shared approval gate. Replay safety follows the server's explicit
read-only annotation; other MCP operations use native unsafe replay semantics.

Approvals, questions, model selection, summaries and large output storage use existing
host services. No additional interaction table or AI SDK model port is introduced.

## Storage and projection

`durableNativeContext.ts` resolves backend files through the central path registry.
`agent_runtime_backend` and `agent_session_context` bind product sessions to native
SQLite storage and conversations. Native backend and conversation markers repair an
interrupted association write without guessing by history or replacing a missing store.
Creation is exclusive; reopening checks identity and never creates a new SQLite file.

Pi Durable owns its transcript, task graph, submissions and behavior records. Product
messages remain display projections. Root output passes through `ThreadProjection` and
the normal stream manager. Every child has an independent `ChildThreadProjection`,
archive and shared `ai.projection.*` subscription. Parent parts contain task metadata
and navigation, not the child's streamed body. Accepted child text remains the user's
text even when shared behavior wraps its native input.

Input placement reserves attribution before a model call. Each native answer is
associated with its product input once; later snapshots and autonomous child-result
turns do not repeat a prior input's response association.
Stop reconciles input outcomes through the retained native submission identity, which
does not depend on optional request deduplication keys or observation delivery timing.

## Stop, close and reopen

- User Stop calls `interrupt()` before closing, records the shared stop policy and
  cancels the native foreground scope. Unconsumed input is withdrawn.
- Owner shutdown closes and joins the native scheduler without marking ordinary
  unfinished root work cancelled. Child committed archives flush before access release.
- Reopening restores the same backend and conversation, rebinds child models, applies
  shared `onOpen`, then resumes the scheduler. Shared policy disarms goals and stops
  interrupted background children; shutdown is not a promise to resume every child.
- Closing a child panel only detaches its projection subscription.

Background continuation keeps one child identity. Independent continuation of an ended
foreground child is rejected because native ownership remains attached to its tool task.
Desktop fork/edit checkpoints and `vcc_recall` are not exposed by this driver.

## Verification

`PiDurableRuntimeConnection.test.ts` uses the real runtime and SQLite with a scripted
provider. It covers approved argument edits, question answers, incremental output,
native identity on reopen, independent background output and continuation, late steer
attribution, repeated snapshots, and the difference between stop and shutdown.
`durableMcp.test.ts` runs an actual linked MCP server through the native tool loop.
The storage and child-projection suites cover strict reopen, interrupted binding
recovery and asynchronous archive reconciliation. These tests do not replace Electron
or live-provider acceptance, nor do they prove recovery after a process kill.
