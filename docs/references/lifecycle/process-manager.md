---
description: Lifecycle ownership, startup state, and bounded shutdown for app-owned external child processes
sources:
  - src/main/services/process/
  - src/main/services/OpenClawService.ts
  - src/main/services/OvmsManager.ts
  - src/main/services/HermesDashboardService.ts
  - src/main/services/deepSeekHarness/DeepSeekHarnessService.ts
---

# Process Manager

`ProcessManager` owns external child processes started directly by Cherry Studio. It provides a registry of `ChildProcessHandle` instances and acts as the shutdown safety net for handles that remain active when the application stops.

Readiness probes, configuration rollback, diagnostics, and discovery of externally started processes stay in the business service. Those behaviors differ by executable and are not part of the generic process lifecycle.

## Scope

The current module has one process primitive:

```text
ProcessManager (lifecycle service)
  └── ChildProcessHandle
        └── Node.js ChildProcess created through crossPlatformSpawn()
```

Current production owners are:

| Owner | Managed process | Owner-specific responsibility |
| --- | --- | --- |
| `OpenClawService` | OpenClaw gateway | Health polling, diagnostics, and fallback discovery for externally started gateways |
| `OvmsManager` | OVMS server | Windows-only availability checks and fallback discovery for externally started OVMS processes |
| `HermesDashboardService` | Hermes Dashboard | Health polling and `HERMES_HOME` projection |
| `DeepSeekHarnessService` | DeepSeek Harness Web UI | Readiness output parsing, credentials, and configuration rollback |

The module does not own processes whose lifecycle is already controlled by another subsystem. For example, MCP SDK transports own their stdio children, and the Claude Agent SDK owns Claude Code spawning and cancellation.

## Public API

Consumers import through the process barrel:

```ts
import { type ChildProcessHandle, type ProcessLogLine, ProcessState } from '@main/services/process'
```

### Registration options

```ts
interface ChildProcessOptions {
  id: string
  command: string
  args?: string[]
  cwd?: string
  detached?: boolean
  env?: NodeJS.ProcessEnv
  killTimeoutMs?: number
  stdio?: StdioOptions
  skipOnStop?: boolean
}
```

- `id` is unique within `ProcessManager` until the handle is unregistered.
- `env` is merged over the user's shell environment. An `undefined` value explicitly removes that variable from the spawned environment.
- `detached` enables process-tree termination and calls `unref()` after spawn.
- `killTimeoutMs` is the total graceful-plus-forced termination budget. The default is 4 seconds so shutdown remains inside the lifecycle service ceiling.
- `skipOnStop` excludes a handle from the manager's application-shutdown sweep. The owning service must provide another reliable owner before using it.

### Handle surface

`ChildProcessHandle` exposes:

```ts
readonly id: string
readonly state: ProcessState
readonly pid: number | undefined
readonly skipOnStop: boolean

start(): Promise<void>
stop(): Promise<void>
restart(): Promise<void>

onStarted?: (pid: number) => void
onExited?: (code: number | null, signal: NodeJS.Signals | null) => void
onLog?: (line: ProcessLogLine) => void
```

Callbacks belong to the individual handle. `ProcessManager` does not publish a global process event hub.

## State Model

```text
Idle ── start ──> Starting ── spawn ──> Running ── stop ──> Stopping ── close ──> Stopped
                       │                    │                                      │
                       └── error ───────────┴──────────────────────────────────> Crashed

Stopped / Crashed ── start ──> Starting
```

`Starting` is a real in-flight state, not a log-only transition:

- Concurrent `start()` calls join the same promise and cannot create two children.
- `start()` resolves only after the child emits `spawn` and rejects on startup `error`.
- `stop()` called while shell-environment resolution is pending cancels startup before spawn. If launch has already begun, it joins the start transition and then stops the spawned child.
- `unregister()` called during startup joins the transition before deciding whether removal is safe.

An exit while stopping produces `Stopped`. A non-zero exit outside an intentional stop produces `Crashed`; a clean exit produces `Stopped`.

## Registration and Ownership

Register a handle before starting it:

```ts
const pm = application.get('ProcessManager')
const handle = pm.register({
  id: 'example-server',
  command: executablePath,
  args: ['serve'],
  cwd: workingDirectory,
  detached: !isWin,
  stdio: ['ignore', 'pipe', 'pipe']
})

handle.onLog = (line) => captureStartupDiagnostic(line)
handle.onExited = (code, signal) => handleUnexpectedExit(code, signal)

try {
  await handle.start()
  await waitForServiceReady()
} catch (error) {
  await handle.stop()
  await pm.unregister(handle.id)
  throw error
}
```

The registry is the ownership boundary:

1. `register()` rejects duplicate IDs.
2. Once `ProcessManager` begins stopping, it rejects new registrations and registered handles reject new starts.
3. The business service starts the handle and performs process-specific readiness checks.
4. A failed spawn, failed readiness check, or normal service stop must end with the inactive handle unregistered.
5. `unregister()` rejects `Starting`, `Running`, and `Stopping` handles. Stop the handle first.
6. `ProcessManager.onStop()` stops every active registered handle that is not marked `skipOnStop`.

Do not leave a failed-readiness child registered. A later retry would correctly fail duplicate-ID registration even if the old child remained alive. A service may unregister an unexpected terminal exit immediately or clean up the terminal handle before its next registration attempt.

## Shutdown Contract

`stop()` is idempotent and joins an in-flight stop. For a running process it:

1. Enters `Stopping`.
2. Sends graceful termination and waits for 75% of `killTimeoutMs`.
3. Sends forced termination if necessary.
4. Uses only the remaining time in the original total deadline to confirm exit.
5. Rejects when the child still has not exited by the deadline.

The stop promise settles only after the child's `close` event has updated the handle to `Stopped` or `Crashed`. This keeps immediate unregister and restart operations consistent with the observed state.

On Windows, and for detached children on other platforms, termination targets the process tree. Non-detached Unix children receive `SIGTERM` followed by `SIGKILL`.

The manager logs a stop failure and continues stopping the remaining handles so one stuck executable does not prevent cleanup attempts for the others.

## Service Integration

A lifecycle service that owns a managed process should declare the same-phase dependency and retain the returned handle when it needs status or callbacks:

```ts
@Injectable('ExampleService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManager'])
export class ExampleService extends BaseService {
  private handle: ChildProcessHandle | null = null

  async startServer(): Promise<void> {
    const pm = application.get('ProcessManager')
    const existing = pm.get('example-server')
    if (existing) {
      await existing.stop()
      await pm.unregister(existing.id)
    }

    const handle = pm.register({ id: 'example-server', command: executablePath })
    this.handle = handle
    await handle.start()
  }

  async stopServer(): Promise<void> {
    const handle = this.handle
    if (!handle) return

    await handle.stop()
    await application.get('ProcessManager').unregister(handle.id)
    if (this.handle === handle) this.handle = null
  }
}
```

Use the manager only for the generic spawn and shutdown contract. Keep protocol readiness, output interpretation, retries, and external-process fallback in the owning service.

## Utility Processes

Electron `utilityProcess` workloads are intentionally outside this module's current API. Local-model inference still needs that capability, but its contract includes concerns that do not apply to external child daemons: named build entries, a ready handshake, typed requests, cancellation, lazy generations, crash quarantine, and consumer-owned scheduling.

That design is tracked separately in [issue #19621](https://github.com/CherryHQ/cherry-studio/issues/19621) and [PR #19660](https://github.com/CherryHQ/cherry-studio/pull/19660). When implemented, it belongs under the proposed `src/main/core/utilityProcess/` boundary. Do not add a generic `UtilityProcessHandle`, task pool, or public event hub here before a production consumer establishes the contract.

## Checklist

- Use a stable, unique registration ID.
- Attach startup callbacks before calling `start()`.
- Await `start()` before reporting the process as running.
- Stop and unregister after failed readiness, normal stop, or terminal exit.
- Reserve discovery by port or process name for externally started processes.
- Keep the total kill deadline within the owning lifecycle service's shutdown budget.
- Add focused handle, manager, and owning-service tests for lifecycle changes.
