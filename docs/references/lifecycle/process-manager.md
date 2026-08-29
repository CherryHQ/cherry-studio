---
description: Lifecycle-managed child and utility processes, typed events, shutdown ownership, and pooled task execution
sources:
  - src/main/services/process/
  - src/main/services/OpenClawService.ts
  - src/main/services/OvmsManager.ts
  - src/main/services/HermesDashboardService.ts
  - src/main/services/deepSeekHarness/DeepSeekHarnessService.ts
---

# Process Manager

Lifecycle ownership for processes started by Cherry Studio's main process. `ChildProcessHandle` is used by the current managed external-binary consumers. `UtilityProcessHandle` and `TaskExecutor` provide the implemented foundation for isolated and parallel Node.js workloads, including planned local-model inference; they do not yet have production consumers.

## Quick Navigation

### System Overview (Architecture)
- [Process Manager Overview](#overview) - Motivation, architecture, process types
- [API Design](#api-design) - Interfaces, registration patterns

### Usage Guides (Code Examples)
- [Child Process Usage](#child-process-usage) - Managing external binaries
- [Utility Process Usage](#utility-process-usage) - Isolated Node.js processes
- [TaskExecutor Usage](#taskexecutor-usage) - Parallel task execution
- [Planned AI and Local-Model Integration](#planned-ai-and-local-model-integration) - Future utility-process patterns

### Reference Guides (Standards)
- [Process Type Decision Guide](#choosing-the-right-process-type) - Which process type to use

---

## Overview

### Motivation

Process ownership depends on who controls the process lifecycle:

| Owner | Process contract |
|-------|------------------|
| `OpenClawService` | ProcessManager-owned gateway; external-process discovery is only a fallback for gateways Cherry did not start |
| `OvmsManager` | ProcessManager-owned OVMS server; Windows process discovery remains a fallback for externally started instances |
| `HermesDashboardService` | ProcessManager-owned dashboard with service-owned health and configuration-home checks |
| `DeepSeekHarnessService` | ProcessManager-owned web process with service-owned readiness and configuration rollback |
| `McpRuntimeService` | MCP SDK transport owns stdio child lifecycle |
| `ClaudeCodeProcessManager` | Claude Agent SDK owns its spawn and abort contract |
| `CodeCliService` | Launches user-owned external terminal sessions rather than app-owned daemons |

ProcessManager centralizes spawn-state tracking, process events, and shutdown for the processes Cherry owns directly. Health checks, readiness parsing, configuration rollback, and externally started process discovery remain with the business service because those contracts are process-specific.

The utility-process surface supports future isolated workloads such as local-model inference:
- Running Node.js workloads in isolated Electron `utilityProcess` instances
- Task executor support for parallel AI task execution (multi-conversation, batch embedding)
- Crash isolation so a failing AI task doesn't bring down the main process

### Architecture

```
Primitive Layer — ProcessManager (lifecycle service)
  |
  |-- ChildProcessHandle         App-owned external binaries
  |     spawn(), stdio communication
  |
  |-- UtilityProcessHandle       Isolated Node.js (aiCore, heavy computation)
        Electron utilityProcess, MessagePort IPC

Composite Layer — TaskExecutor (built on ProcessManager)
  |
  |-- N x UtilityProcessHandle   Parallel task execution
        Ephemeral workers, task dispatch, auto-scaling
```

Both process handle types implement a shared `ProcessHandle` interface for consistent lifecycle control. `TaskExecutor` is a separate abstraction — it does not implement `ProcessHandle`, and internally creates utility processes via ProcessManager.

### Design Principles

1. **Unified interface** - `start()` / `stop()` / `restart()` / `state` across both process types
2. **Explicit registration** - Imperative API, no hidden magic, easy to trace
3. **Lifecycle integration** - Extends `BaseService`, graceful shutdown on `onStop()`
4. **Fault isolation** - Process crashes don't affect the main process
5. **Explicit ownership** - Business services stop and unregister their handles; ProcessManager is the shutdown safety net
6. **Layered abstraction** - Primitives (ProcessHandle) for single processes, composites (TaskExecutor) for parallel workloads

---

## Process Types

### Quick Decision Table

| Type | Layer | Use Case | Communication | Isolation | Examples |
|------|-------|----------|--------------|-----------|----------|
| **ChildProcess** | Primitive | External binaries, non-Node programs | stdio (stdin/stdout/stderr) | OS process | OpenClaw, OVMS, Hermes Dashboard, DeepSeek Harness |
| **UtilityProcess** | Primitive | Isolated Node.js workloads | MessagePort (structured clone) | Electron process | aiCore backend, heavy computation |
| **TaskExecutor** | Composite | Parallel Node.js tasks | MessagePort per worker | N x Electron process | Batch embedding, knowledge indexing |

### Choosing the Right Process Type

```
                    +---------------------------+
                    | Is it a non-Node.js       |
                    | external binary?          |
                    +------+------------+-------+
                       yes |            | no
                           v            v
                    +-------------+  +---------------------------+
                    | ChildProcess|  | Need parallel execution   |
                    +-------------+  | of the same workload?     |
                                     +------+------------+------+
                                        yes |            | no
                                            v            v
                                  +-----------------+  +----------------+
                                  | UtilityProcess  |  | UtilityProcess |
                                  | TaskExecutor    |  | (single)       |
                                  +-----------------+  +----------------+
```

### When NOT to Use ProcessManager

| Scenario | Use Instead |
|----------|-------------|
| One-shot command execution (`git --version`) | `executeCommand()` from `src/main/utils/processRunner.ts` |
| In-memory MCP servers | `InMemoryTransport` (no process needed) |
| SDK-owned subprocess lifecycle | Keep ownership with the SDK adapter |
| User-owned external terminal session | Launch through `CodeCliService` |
| Simple async I/O work | Just use `async/await` in the main process |
| CPU work < 50ms | Not worth the IPC overhead |

---

## API Design

### Core Interfaces

```typescript
/**
 * Process states - shared across all process types
 */
enum ProcessState {
  Idle      = 'idle',        // Registered, not started
  Starting  = 'starting',   // Environment resolution or spawn is in progress
  Running   = 'running',    // The process emitted spawn; business health is separate
  Stopping  = 'stopping',   // Graceful shutdown in progress
  Stopped   = 'stopped',    // Exited cleanly
  Crashed   = 'crashed',    // Exited with error
}

/**
 * Unified handle returned to consumers - all process types implement this
 */
interface ProcessHandle {
  readonly id: string
  readonly state: ProcessState
  readonly pid: number | undefined
  readonly skipOnStop: boolean

  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

/**
 * Log line emitted on stdout/stderr
 */
interface ProcessLogLine {
  processId: string
  stream: 'stdout' | 'stderr'
  data: string
  timestamp: number
}

interface ProcessStartedEvent {
  id: string
  pid: number
}

interface ProcessExitedEvent {
  id: string
  code: number | null
  signal: NodeJS.Signals | null
}
```

### Child Process Options

```typescript
interface ChildProcessOptions {
  /** Unique identifier */
  id: string
  /** Executable path or command name */
  command: string
  args?: string[]
  cwd?: string
  /** Merged with shell environment */
  env?: Record<string, string>
  /** Spawn in a detached process group */
  detached?: boolean
  stdio?: StdioOptions
  /** Exclude this handle from ProcessManager shutdown */
  skipOnStop?: boolean
  /** Total graceful + forced shutdown budget in ms. Default: 4000 */
  killTimeoutMs?: number
}
```

### Utility Process Options

```typescript
interface UtilityProcessOptions {
  id: string
  /** Path to the worker module entry point */
  modulePath: string
  args?: string[]
  env?: Record<string, string>
  killTimeoutMs?: number
}

/**
 * Extended handle for utility processes - adds MessagePort communication
 */
interface UtilityProcessHandle extends ProcessHandle {
  /** Send a message to the utility process */
  postMessage(message: unknown, transfer?: MessagePortMain[]): void
  /** Listen for messages from the utility process */
  onMessage(handler: (message: unknown) => void): () => void
}
```

### TaskExecutor (Composite Layer)

`TaskExecutor` is not part of ProcessManager's API. It's a standalone class that internally registers utility-process workers through `pm.register()`.

```typescript
interface TaskExecutorOptions {
  id: string
  /** Path to the worker module entry point */
  modulePath: string
  /** Maximum concurrent workers */
  max: number
  /** Kill idle workers after this duration (ms). Default: 30000 */
  idleTimeoutMs?: number
  /** Reject a task after this duration; 0 disables it. Default: 0 */
  taskTimeoutMs?: number
  env?: Record<string, string>
  killTimeoutMs?: number
}

/**
 * TaskExecutor — submit tasks, workers are managed internally.
 * Does NOT implement ProcessHandle (no pid, no start/stop/restart).
 */
class TaskExecutor {
  constructor(pm: ProcessManager, options: TaskExecutorOptions) {}

  readonly id: string

  /**
   * Execute a task on the next available worker.
   * Spawns a worker on demand if below max capacity, queues otherwise.
   */
  exec<T>(taskType: string, payload: unknown): Promise<T>

  /** Stop all workers and reject pending tasks */
  shutdown(): Promise<void>
}
```

---

## Registration API

All process registration uses an explicit, imperative API. No decorators, no hidden scanning — call `pm.register()` and get a typed handle back.

| API | Contract |
|-----|----------|
| `register(options)` | Creates an idle child or utility handle and rejects a duplicate ID |
| `get(id)` | Returns the tracked handle, including terminal `Stopped` or `Crashed` handles |
| `unregister(id)` | Removes a terminal handle; joins an in-flight start, then rejects if the handle is still active |
| `onProcessStarted` | Fires only after the underlying process emits `spawn` and supplies a PID |
| `onProcessExited` | Fires after the handle has entered `Stopped` or `Crashed` |
| `onProcessLog` | Emits child-process stdout/stderr chunks |

`stop()` and `unregister()` are deliberately separate. A service that owns a process must stop it and then unregister it on normal stop and failed startup. If the process exits by itself, its terminal handle remains tracked until the service unregisters it; this must happen before the ID is registered again. `ProcessManager.onStop()` stops active handles as a lifecycle safety net, but it does not remove registrations.

Both handle implementations expose a joinable `Starting` transition. Concurrent `start()` calls share the same in-flight promise, and `stop()` waits for that transition before stopping the spawned process. `start()` resolves on the process `spawn` event, not on application-level readiness; consumers remain responsible for protocol or health checks.

### Registering a Child Process

```typescript
import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ChildProcessHandle } from '@main/services/process'

@Injectable('OllamaService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManager'])
export class OllamaService extends BaseService {
  private ollama: ChildProcessHandle | undefined

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManager')

    const handle = pm.register({
      id: 'ollama',
      command: '/usr/local/bin/ollama',
      args: ['serve'],
      env: { OLLAMA_HOST: '127.0.0.1:11434' },
      killTimeoutMs: 8000,
    })
    this.ollama = handle

    try {
      await handle.start()
      await waitUntilHealthy()
    } catch (error) {
      await handle.stop()
      await pm.unregister(handle.id)
      this.ollama = undefined
      throw error
    }
  }

  protected async onStop(): Promise<void> {
    if (!this.ollama) return
    const pm = application.get('ProcessManager')
    await this.ollama.stop()
    await pm.unregister(this.ollama.id)
    this.ollama = undefined
  }
}
```

### Registering a Utility Process

```typescript
@Injectable('AiCoreBackendService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManager'])
export class AiCoreBackendService extends BaseService {
  private aicore!: UtilityProcessHandle
  private disposeMessageHandler: (() => void) | undefined

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManager')

    this.aicore = pm.register({
      id: 'aicore',
      modulePath: './workers/aicore.js',
    })

    await this.aicore.start()

    this.disposeMessageHandler = this.aicore.onMessage((msg) => {
      if (msg.type === 'stream-chunk') {
        this.handleStreamChunk(msg.data)
      }
    })
  }

  protected async onStop(): Promise<void> {
    this.disposeMessageHandler?.()
    await this.aicore.stop()
    await application.get('ProcessManager').unregister(this.aicore.id)
  }
}
```

### Using a TaskExecutor

`TaskExecutor` is not registered on ProcessManager — it's instantiated directly, receiving `pm` as a dependency:

```typescript
import { TaskExecutor } from '@main/services/process'

@Injectable('KnowledgeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManager'])
export class KnowledgeService extends BaseService {
  private executor!: TaskExecutor

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManager')

    this.executor = new TaskExecutor(pm, {
      id: 'knowledge-workers',
      modulePath: './workers/knowledge-worker.js',
      max: 4,
      idleTimeoutMs: 30_000,
    })
  }

  async batchEmbed(documents: string[]): Promise<number[][]> {
    const chunks = splitIntoChunks(documents, 100)
    const results = await Promise.all(
      chunks.map(chunk => this.executor.exec('embed', chunk))
    )
    return results.flat()
  }

  protected async onStop(): Promise<void> {
    await this.executor.shutdown()
    // shutdown() stops and unregisters every worker. ProcessManager remains the safety net.
  }
}
```

### Conditional Registration

The imperative API naturally supports conditional or dynamic registration:

```typescript
protected async onInit(): Promise<void> {
  const pm = application.get('ProcessManager')

  // Platform-specific process
  if (process.platform === 'win32') {
    this.ovms = pm.register({
      id: 'ovms',
      command: ovmsPath,
      args: ['--model_path', modelDir],
    })
  }

  // Register only if binary exists
  const ollamaPath = await findExecutableInEnv('ollama')
  if (ollamaPath) {
    this.ollama = pm.register({
      id: 'ollama',
      command: ollamaPath,
      args: ['serve'],
    })
  }
}
```

---

## Child Process Usage

### Basic: Manage an External Binary

```typescript
const pm = application.get('ProcessManager')

const ollama = pm.register({
  id: 'ollama',
  command: '/usr/local/bin/ollama',
  args: ['serve'],
})

await ollama.start()
logger.info(`ollama started, pid=${ollama.pid}`)
```

### Monitoring stdout/stderr

Logs are automatically routed to `loggerService.withContext('Process:<id>')`. For custom handling, listen to events:

```typescript
const pm = application.get('ProcessManager')

pm.onProcessLog((line) => {
  if (line.processId === 'ollama' && line.stream === 'stderr') {
    logger.warn(line.data.trimEnd())
  }
})
```

The event function returns a `Disposable`. Lifecycle services should pass it to `registerDisposable()` or dispose it explicitly.

### Graceful Shutdown Sequence

When `ProcessManager.onStop()` is called, it stops all non-`skipOnStop` handles that are `Starting`, `Running`, or `Stopping`. Handles are stopped concurrently. A handle still starting first joins its start transition. Individual stop failures are logged so shutdown can continue with the remaining handles.

For each active child process, `killTimeoutMs` is one total deadline:

```
For each active child process:
  1. Send SIGTERM
  2. Reserve 75% of killTimeoutMs for graceful exit
  3. If still alive, send SIGKILL
  4. Wait for process exit within the remaining total budget (default: 4000ms)
```

Detached processes and Windows children are terminated as process trees. A non-detached POSIX child receives the signal directly. Failure to confirm exit within the total deadline rejects `stop()`; callers must not treat that process as successfully stopped.

---

## Utility Process Usage

### Basic: Isolated Node.js Workload

```typescript
const pm = application.get('ProcessManager')

const aicore = pm.register({
  id: 'aicore',
  modulePath: './workers/aicore.js',
})

await aicore.start()

aicore.onMessage((msg) => {
  if (msg.type === 'stream-chunk') {
    this.handleStreamChunk(msg.data)
  }
})

// Send a request to the utility process
aicore.postMessage({ type: 'request', data: request })
```

`UtilityProcessHandle.stop()` calls Electron's `utilityProcess.kill()` and waits up to `killTimeoutMs` for `exit`. If Electron never reports an exit, the handle clears its tracked state and resolves at the deadline; unlike `ChildProcessHandle`, it does not perform or confirm process-tree escalation. `postMessage()` also accepts transferable `MessagePortMain` instances, and `onMessage()` returns a cleanup function.

### Worker Module Entry Point

```typescript
// workers/aicore.js — runs inside Electron utilityProcess
process.parentPort.on('message', async (event) => {
  const { type, data } = event.data

  switch (type) {
    case 'request':
      const result = await handleAiRequest(data)
      process.parentPort.postMessage({ type: 'response', data: result })
      break
  }
})
```

### Why UtilityProcess over Child Process?

| Feature | ChildProcess | UtilityProcess |
|---------|-------------|----------------|
| Communication | stdio (text streams) | MessagePort (structured clone, transferable) |
| Data transfer | Serialize to string | Zero-copy for ArrayBuffer, efficient for objects |
| Node.js APIs | Full (separate Node instance) | Full (shares Electron's Node) |
| Electron APIs | None | `net`, `systemPreferences`, etc. |
| Startup cost | Higher (new Node.js instance) | Lower (shares Electron binary) |
| Best for | External binaries | Internal Node.js workloads |

---

## TaskExecutor Usage

### Basic: Parallel Task Execution

```typescript
const pm = application.get('ProcessManager')

const embedExecutor = new TaskExecutor(pm, {
  id: 'embed-workers',
  modulePath: './workers/embedding-worker.js',
  max: 4,
})

async function embedDocuments(docs: string[]): Promise<number[][]> {
  const chunks = splitIntoChunks(docs, 50)

  // Each chunk dispatched to a different worker in parallel
  const results = await Promise.all(
    chunks.map(chunk => embedExecutor.exec<number[][]>('embed', chunk))
  )

  return results.flat()
}
```

### Scaling Behavior

Workers are ephemeral — spawned on demand, killed after idle timeout. No persistent workers.

```
TaskExecutor: max=4, idleTimeoutMs=30000

Timeline:
  t=0s    0 workers (idle)
  t=1s    Task A arrives → spawn worker 1
  t=1s    Task B arrives → spawn worker 2 (< max)
  t=1s    Task C arrives → spawn worker 3 (< max)
  t=1s    Task D arrives → spawn worker 4 (= max)
  t=2s    Task E arrives → queued (at max capacity)
  t=3s    Task A completes → worker 1 picks up Task E
  t=10s   All tasks complete → 4 idle workers
  t=40s   All workers idle > 30s → killed, back to 0
```

### Worker Module for TaskExecutor

```typescript
// workers/embedding-worker.js
process.parentPort.on('message', async (event) => {
  const { taskType, payload, taskId } = event.data

  try {
    let result: unknown
    switch (taskType) {
      case 'embed':
        result = await computeEmbeddings(payload)
        break
      default:
        throw new Error(`Unknown task type: ${taskType}`)
    }

    process.parentPort.postMessage({ taskId, result })
  } catch (error) {
    process.parentPort.postMessage({ taskId, error: error.message })
  }
})
```

---

## Planned AI and Local-Model Integration

> **Status:** This section is architectural guidance for future UtilityProcess consumers. The current production consumers use `ChildProcessHandle`; aiCore and local-model inference are not yet wired through this surface.

### The Problem

`useChat` (Vercel AI SDK) creates long-lived streaming connections — a single chat session sends a request and receives tokens over seconds or minutes. The task executor's `exec()` is designed for request/response, not streaming. This section explains how to correctly combine ProcessManager with AI SDK streaming patterns.

### Workload Classification

The key question: **what percentage of time does the worker spend waiting for I/O vs doing CPU work?**

| Workload | I/O vs CPU | Right Abstraction |
|----------|-----------|-------------------|
| `useChat` streaming (remote LLM) | 99% I/O (waiting for API response) | Single UtilityProcess, multiplexed |
| Batch embedding (remote API) | 90% I/O, moderate concurrency | Single UtilityProcess, multiplexed |
| Batch embedding (local model) | 90% CPU | TaskExecutor + `exec()` |
| Knowledge base indexing | 80% CPU (chunking, parsing) | TaskExecutor + `exec()` |
| Image preprocessing | 95% CPU | TaskExecutor + `exec()` |

### Recommended Architecture: Hybrid

Split by workload characteristics — don't force everything through one pattern:

```
useChat streaming (I/O-bound)
  → Single UtilityProcess + multiplexed streams
      Multiple useChat sessions share one process, async I/O, no blocking

Batch embedding (CPU-bound)
  → TaskExecutor + exec()
      Each chunk dispatched to a different worker

Knowledge base indexing (CPU-bound)
  → TaskExecutor + exec()
```

```typescript
@Injectable('AiCoreService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManager'])
export class AiCoreService extends BaseService {
  private chatProcess!: UtilityProcessHandle    // streaming, I/O-bound
  private computeExecutor!: TaskExecutor         // batch tasks, CPU-bound

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManager')

    this.chatProcess = pm.register({
      id: 'aicore-chat',
      modulePath: './workers/aicore-chat.js',
    })

    this.computeExecutor = new TaskExecutor(pm, {
      id: 'aicore-compute',
      modulePath: './workers/aicore-compute.js',
      max: 4,
    })

    await this.chatProcess.start()
  }
}
```

### Key Insight: Direct MessagePort, Not IPC Relay

Electron supports transferring `MessagePort` objects between processes. Streaming data should flow **directly** between renderer and utility process via MessagePort — the main process only handles lifecycle (spawn, shutdown, health), not data relay.

```
BAD: Renderer → IPC → Main → MessagePort → Utility → MessagePort → Main → IPC → Renderer
     (every token bounces through main = unnecessary overhead)

GOOD: Renderer ←→ MessagePort ←→ UtilityProcess (direct)
      Main only: spawn, monitor, shutdown
```

### Port Bridging: Main Process Sets Up the Channel

When the renderer needs a streaming connection, main creates a `MessageChannelMain` and transfers one port to each side:

```typescript
// AiCoreService — main process
async acquireChatPort(webContents: WebContents): Promise<void> {
  const { port1, port2 } = new MessageChannelMain()

  // port1 → renderer (via webContents.postMessage, which transfers ownership)
  webContents.postMessage(IpcChannel.Chat_Port, null, [port1])

  // port2 → utility process (via parentPort transfer)
  this.chatProcess.postMessage({ type: 'renderer-port' }, [port2])
}
```

After this, main is **out of the data path**. Renderer and utility talk directly.

### Worker Side: Accept Transferred Port

```typescript
// workers/aicore-chat.js
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

const activeStreams = new Map<string, AbortController>()

// parentPort: management commands from main (shutdown, health check)
// rendererPort: direct data channel from renderer
let rendererPort: MessagePort | null = null

process.parentPort.on('message', (event) => {
  // Main transfers the renderer port
  if (event.data?.type === 'renderer-port' && event.ports.length > 0) {
    rendererPort = event.ports[0]
    rendererPort.on('message', handleRendererMessage)
    return
  }

  // Other management commands from main (health check, etc.)
})

async function handleRendererMessage(event: MessageEvent) {
  const { type, streamId, data } = event.data

  if (type === 'chat-start') {
    const controller = new AbortController()
    activeStreams.set(streamId, controller)

    try {
      const result = await streamText({
        model: openai('gpt-4o'),
        messages: data.messages,
        abortSignal: controller.signal,
      })

      for await (const chunk of result.textStream) {
        rendererPort!.postMessage({ streamId, type: 'chunk', data: chunk })
      }

      rendererPort!.postMessage({ streamId, type: 'done' })
    } catch (error) {
      if (error.name !== 'AbortError') {
        rendererPort!.postMessage({ streamId, type: 'error', data: error.message })
      }
    } finally {
      activeStreams.delete(streamId)
    }
  }

  if (type === 'chat-cancel') {
    activeStreams.get(streamId)?.abort()
    activeStreams.delete(streamId)
  }
}
```

**Why one process handles many streams:** LLM API calls are I/O-bound. While waiting for tokens from OpenAI, the event loop is free to handle other streams. 10 concurrent chats = 10 concurrent `fetch()` calls, zero CPU contention.

### Renderer Side: useChat + MessagePort

```typescript
// Request a direct port to the aicore utility process (one-time setup)
const port = await window.api.acquireChatPort()

const { messages, append, stop } = useChat({
  // Custom fetch adapter: MessagePort instead of HTTP
  fetch: async (url, init) => {
    const streamId = crypto.randomUUID()
    const body = JSON.parse(init.body as string)

    port.postMessage({ type: 'chat-start', streamId, data: body })

    // Convert MessagePort events into a ReadableStream (what useChat expects)
    const stream = new ReadableStream({
      start(controller) {
        const handler = (event: MessageEvent) => {
          const msg = event.data
          if (msg.streamId !== streamId) return
          if (msg.type === 'chunk') controller.enqueue(new TextEncoder().encode(msg.data))
          if (msg.type === 'done') { port.removeEventListener('message', handler); controller.close() }
          if (msg.type === 'error') { port.removeEventListener('message', handler); controller.error(new Error(msg.data)) }
        }
        port.addEventListener('message', handler)
      },
      cancel() {
        port.postMessage({ type: 'chat-cancel', streamId })
      },
    })

    return new Response(stream)
  },
})
```

### Complete Data Flow

```
Setup (one-time):
  Main creates MessageChannelMain
  port1 → Renderer (via webContents.postMessage)
  port2 → UtilityProcess (via parentPort transfer)

Streaming (per chat, main process NOT involved):
  Renderer
    |  port.postMessage({ type: 'chat-start', streamId, data })
    v
  UtilityProcess (aicore-chat.js)
    |  streamText() → fetch(LLM API) → async iterate tokens
    |
    |  for each token:
    v
  UtilityProcess → port.postMessage({ streamId, type: 'chunk', data })
    |
    v
  Renderer → ReadableStream controller.enqueue(chunk)
    |
    v
  useChat → displays streaming text

Management (main ↔ utility, separate channel):
  Main → parentPort → UtilityProcess: shutdown, health check
  UtilityProcess → parentPort → Main: status reports, errors
```

---

## ProcessManager

### Lifecycle Integration

```typescript
@Injectable('ProcessManager')
@ServicePhase(Phase.WhenReady)
export class ProcessManager extends BaseService {

  protected async onInit(): Promise<void> {
    // Ready to accept registrations
  }

  protected async onStop(): Promise<void> {
    // Concurrently stop active non-skip handles; Starting handles join startup first.
  }
}
```

### Registration in serviceRegistry.ts

```typescript
import { ProcessManager } from '@main/services/process'

export const services = {
  DbService,
  CacheService,
  DataApiService,
  PreferenceService,
  CodeCliService,
  ProcessManager,  // one line
} as const
```

### Event Subscription

```typescript
const pm = application.get('ProcessManager')

const startedSubscription = pm.onProcessStarted(({ id, pid }) => {
  logger.info(`Process ${id} started with pid ${pid}`)
})

const exitedSubscription = pm.onProcessExited(({ id, code, signal }) => {
  if (code !== 0) {
    logger.error(`Process ${id} crashed: code=${code}, signal=${signal}`)
  }
})

const logSubscription = pm.onProcessLog((line) => {
  // Route to UI, external logging, etc.
})

// Lifecycle services normally register these Disposables with BaseService.
this.registerDisposable(startedSubscription)
this.registerDisposable(exitedSubscription)
this.registerDisposable(logSubscription)
```

---

## File Structure

```
src/main/services/process/
  types.ts                  # ProcessState, ProcessHandle, definitions, events
  ProcessManager.ts  # Lifecycle service, registry, event hub
  ChildProcessHandle.ts     # ChildProcess implementation of ProcessHandle
  UtilityProcessHandle.ts   # utilityProcess implementation of ProcessHandle
  TaskExecutor.ts     # Task dispatch, worker lifecycle, auto-scaling
  index.ts                  # Barrel export (public API only)
  __tests__/
    ProcessManager.test.ts
    ChildProcessHandle.test.ts
    UtilityProcessHandle.test.ts
    TaskExecutor.test.ts
```

---

## Implementation Status

### Core + ChildProcess — in production

- `ProcessHandle` interface, `ProcessState` enum, and typed process event payloads
- `ChildProcessHandle` using `crossPlatformSpawn`
- `ProcessManager` with `register()` API
- Graceful shutdown in `onStop()`
- Unit tests

Current production consumers are `OpenClawService`, `OvmsManager`, `HermesDashboardService`, and `DeepSeekHarnessService`.

### UtilityProcess — implemented, awaiting a production consumer

- `UtilityProcessHandle` wrapping Electron `utilityProcess`
- `UtilityProcessHandle` extends `ProcessHandle` with MessagePort communication
- Unit tests

This surface is retained for planned local-model inference and other isolated Node.js workloads.

### TaskExecutor — implemented, awaiting a production consumer

- `TaskExecutor` with task dispatch and auto-scaling
- Unit tests

It remains a composite over UtilityProcess handles and should be adopted only when a concrete parallel workload needs its queue and worker-pool contract.

---

## Common Anti-patterns

| Wrong Choice | Why It's Wrong | Correct Choice |
|-------------|---------------|----------------|
| Using ChildProcess for aiCore | Loses structured IPC, higher startup cost | **UtilityProcess** |
| Using UtilityProcess for ollama | External binary, not a Node.js module | **ChildProcess** |
| Using TaskExecutor for a single long-lived server | TaskExecutor is for task dispatch, not daemon management | **UtilityProcess** (single) |
| Directly spawning an app-owned daemon | Bypasses tracking and lifecycle shutdown | **Register with ProcessManager** |
| Moving an SDK-owned or user-owned process into ProcessManager | Breaks the existing ownership contract | **Keep lifecycle with the SDK or external launcher** |
| Using worker_threads for I/O-bound work | Async I/O already non-blocking, threads add complexity | **Single UtilityProcess** with async |
| Pre-spawning workers at startup | Wastes memory; spawn on demand, let idle timeout reclaim | **Let TaskExecutor spawn on first exec()** |

---

## Related Source Code

### Existing Process Utilities
- `src/main/utils/processRunner.ts` - `crossPlatformSpawn`, `executeCommand`, `findExecutableInEnv`
- `src/main/utils/shellEnv.ts` - Login shell environment for process spawning

### ProcessManager Consumers
- `src/main/services/OpenClawService.ts` - ProcessManager-owned gateway process
- `src/main/services/OvmsManager.ts` - Windows OVMS process management
- `src/main/services/HermesDashboardService.ts` - Hermes dashboard process management
- `src/main/services/deepSeekHarness/DeepSeekHarnessService.ts` - DeepSeek Harness process management

### Specialized Process Owners
- `src/main/ai/mcp/McpRuntimeService.ts` - MCP SDK transport lifecycle
- `src/main/ai/runtime/claudeCode/ClaudeCodeProcessManager.ts` - Claude Agent SDK spawn contract
- `src/main/services/CodeCliService.ts` - User-owned external terminal launches

### Lifecycle System
- `src/main/core/lifecycle/` - BaseService, decorators, IoC container
- `src/main/core/application/serviceRegistry.ts` - Service registration
