# Process Manager Reference

Unified process management for Cherry Studio's main process. Manages child processes (external binaries) and Electron utility processes (isolated Node.js workloads). Also provides `TaskExecutor`, a higher-level abstraction for parallel task execution built on top of utility processes.

## Quick Navigation

### System Overview (Architecture)
- [Process Manager Overview](#overview) - Motivation, architecture, process types
- [API Design](#api-design) - Interfaces, registration patterns

### Usage Guides (Code Examples)
- [Child Process Usage](#child-process-usage) - Managing external binaries
- [Utility Process Usage](#utility-process-usage) - Isolated Node.js processes
- [TaskExecutor Usage](#taskexecutor-usage) - Parallel task execution
- [AI SDK Streaming Integration](#integration-with-ai-sdk-streaming) - useChat + ProcessManager

### Reference Guides (Standards)
- [Process Type Decision Guide](#choosing-the-right-process-type) - Which process type to use

---

## Overview

### Motivation

Cherry Studio currently manages child processes in a fragmented way:

| Service | How It Manages Processes |
|---------|------------------------|
| `MCPService` | Delegates to MCP SDK's `StdioClientTransport` |
| `OpenClawService` | Detached `spawn()` + PID-based kill via `pkill`/`taskkill` |
| `OvmsManager` | `exec()` + PowerShell tree kill |
| `CodeCliService` | Direct `spawn()` with manual cleanup |
| `FileStorage` | Per-query `spawn()` for ripgrep |

Each service independently handles spawning, logging, error recovery, and shutdown cleanup. There is no unified tracking, no consistent graceful shutdown, and no reusable abstraction for common patterns.

Additionally, **aiCore is moving to a backend process** in v2. This requires:
- Running Node.js workloads in isolated Electron `utilityProcess` instances
- Task executor support for parallel AI task execution (multi-conversation, batch embedding)
- Crash isolation so a failing AI task doesn't bring down the main process

### Architecture

```
Primitive Layer — ProcessManagerService (lifecycle service)
  |
  |-- ChildProcessHandle         External binaries (ollama, MCP, rg)
  |     spawn(), stdio communication
  |
  |-- UtilityProcessHandle       Isolated Node.js (aiCore, heavy computation)
        Electron utilityProcess, MessagePort IPC

Composite Layer — TaskExecutor (built on ProcessManagerService)
  |
  |-- N x UtilityProcessHandle   Parallel task execution
        Ephemeral workers, task dispatch, auto-scaling
```

Both process handle types implement a shared `ProcessHandle` interface for consistent lifecycle control. `TaskExecutor` is a separate abstraction — it does not implement `ProcessHandle`, and internally creates utility processes via ProcessManagerService.

### Design Principles

1. **Unified interface** - `start()` / `stop()` / `restart()` / `status` across both process types
2. **Explicit registration** - Imperative API, no hidden magic, easy to trace
3. **Lifecycle integration** - Extends `BaseService`, graceful shutdown on `onStop()`
4. **Fault isolation** - Process crashes don't affect the main process
5. **Layered abstraction** - Primitives (ProcessHandle) for single processes, composites (TaskExecutor) for parallel workloads

---

## Process Types

### Quick Decision Table

| Type | Layer | Use Case | Communication | Isolation | Examples |
|------|-------|----------|--------------|-----------|----------|
| **ChildProcess** | Primitive | External binaries, non-Node programs | stdio (stdin/stdout/stderr) | OS process | ollama, MCP stdio servers, ripgrep |
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
| One-shot command execution (`git --version`) | `executeCommand()` from `src/main/utils/process.ts` |
| In-memory MCP servers | `InMemoryTransport` (no process needed) |
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
  Starting  = 'starting',   // Spawn in progress
  Running   = 'running',    // Alive and healthy
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
  readonly uptime: number | undefined  // ms since start, undefined if not running

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

/**
 * Events emitted by ProcessManagerService
 */
interface ProcessManagerEvents {
  'process:started':  (id: string, pid: number) => void
  'process:exited':   (id: string, code: number | null, signal: NodeJS.Signals | null) => void
  'process:log':      (line: ProcessLogLine) => void
}
```

### ChildProcess Definition

```typescript
interface ChildProcessDefinition {
  type: 'child'
  /** Unique identifier */
  id: string
  /** Executable path or command name */
  command: string
  args?: string[]
  cwd?: string
  /** Merged with shell environment */
  env?: Record<string, string>
  /** ms to wait for SIGTERM before SIGKILL. Default: 5000 */
  killTimeoutMs?: number
}
```

### UtilityProcess Definition

```typescript
interface UtilityProcessDefinition {
  type: 'utility'
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
  postMessage(message: unknown): void
  /** Listen for messages from the utility process */
  onMessage(handler: (message: unknown) => void): void
}
```

### TaskExecutor (Composite Layer)

`TaskExecutor` is not part of ProcessManagerService's API. It's a standalone class that internally uses `pm.register({ type: 'utility' })` to create workers.

```typescript
interface TaskExecutorOptions {
  id: string
  /** Path to the worker module entry point */
  modulePath: string
  /** Maximum concurrent workers. Default: number of CPU cores */
  max: number
  /** Kill idle workers after this duration (ms). Default: 30000 */
  idleTimeoutMs?: number
  env?: Record<string, string>
  killTimeoutMs?: number
}

/**
 * TaskExecutor — submit tasks, workers are managed internally.
 * Does NOT implement ProcessHandle (no pid, no start/stop/restart).
 */
class TaskExecutor {
  constructor(pm: ProcessManagerService, options: TaskExecutorOptions) {}

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

### Registering a Child Process

```typescript
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ProcessHandle } from '@main/services/process'

@Injectable('OllamaService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManagerService'])
export class OllamaService extends BaseService {
  private ollama!: ProcessHandle

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManagerService')

    this.ollama = pm.register({
      type: 'child',
      id: 'ollama',
      command: '/usr/local/bin/ollama',
      args: ['serve'],
      env: { OLLAMA_HOST: '127.0.0.1:11434' },
      killTimeoutMs: 8000,
    })

    await this.ollama.start()
  }

  protected async onStop(): Promise<void> {
    await this.ollama.stop()
  }
}
```

### Registering a Utility Process

```typescript
@Injectable('AiCoreBackendService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManagerService'])
export class AiCoreBackendService extends BaseService {
  private aicore!: UtilityProcessHandle

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManagerService')

    this.aicore = pm.register({
      type: 'utility',
      id: 'aicore',
      modulePath: './workers/aicore.js',
    })

    await this.aicore.start()

    this.aicore.onMessage((msg) => {
      if (msg.type === 'stream-chunk') {
        this.handleStreamChunk(msg.data)
      }
    })
  }

  protected async onStop(): Promise<void> {
    await this.aicore.stop()
  }
}
```

### Using a TaskExecutor

`TaskExecutor` is not registered on ProcessManagerService — it's instantiated directly, receiving `pm` as a dependency:

```typescript
import { TaskExecutor } from '@main/services/process'

@Injectable('KnowledgeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManagerService'])
export class KnowledgeService extends BaseService {
  private executor!: TaskExecutor

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManagerService')

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
    // Workers are registered with PM, so PM.onStop() also cleans them up as a safety net
  }
}
```

### Conditional Registration

The imperative API naturally supports conditional or dynamic registration:

```typescript
protected async onInit(): Promise<void> {
  const pm = application.get('ProcessManagerService')

  // Platform-specific process
  if (process.platform === 'win32') {
    this.ovms = pm.register({
      type: 'child',
      id: 'ovms',
      command: ovmsPath,
      args: ['--model_path', modelDir],
    })
  }

  // Register only if binary exists
  const ollamaPath = await findExecutableInEnv('ollama')
  if (ollamaPath) {
    this.ollama = pm.register({
      type: 'child',
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
const pm = application.get('ProcessManagerService')

const ollama = pm.register({
  type: 'child',
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
const pm = application.get('ProcessManagerService')

pm.on('process:log', (line) => {
  if (line.processId === 'ollama' && line.stream === 'stderr') {
    // Forward error output to renderer
    mainWindow.webContents.send(IpcChannel.Process_Log, line)
  }
})
```

### Graceful Shutdown Sequence

When `ProcessManagerService.onStop()` is called (app shutdown):

```
For each running process:
  1. Send SIGTERM
  2. Wait up to killTimeoutMs (default: 5000ms)
  3. If still alive, send SIGKILL
  4. Wait for process exit
```

---

## Utility Process Usage

### Basic: Isolated Node.js Workload

```typescript
const pm = application.get('ProcessManagerService')

const aicore = pm.register({
  type: 'utility',
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
const pm = application.get('ProcessManagerService')

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

## Integration with AI SDK Streaming

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
@DependsOn(['ProcessManagerService'])
export class AiCoreService extends BaseService {
  private chatProcess!: UtilityProcessHandle    // streaming, I/O-bound
  private computeExecutor!: TaskExecutor         // batch tasks, CPU-bound

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManagerService')

    this.chatProcess = pm.register({
      type: 'utility',
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

## ProcessManagerService

### Lifecycle Integration

```typescript
@Injectable('ProcessManagerService')
@ServicePhase(Phase.WhenReady)
export class ProcessManagerService extends BaseService {

  protected async onInit(): Promise<void> {
    // Ready to accept registrations
  }

  protected async onStop(): Promise<void> {
    // 1. Stop all utility processes (includes TaskExecutor workers)
    // 2. Stop all child processes (SIGTERM → wait → SIGKILL)
  }
}
```

### Registration in serviceRegistry.ts

```typescript
import { ProcessManagerService } from '@main/services/process/ProcessManagerService'

export const services = {
  DbService,
  CacheService,
  DataApiService,
  PreferenceService,
  CodeCliService,
  ProcessManagerService,  // one line
} as const
```

### Event Subscription

```typescript
const pm = application.get('ProcessManagerService')

pm.on('process:started', (id, pid) => {
  logger.info(`Process ${id} started with pid ${pid}`)
})

pm.on('process:exited', (id, code, signal) => {
  if (code !== 0) {
    logger.error(`Process ${id} crashed: code=${code}, signal=${signal}`)
  }
})

pm.on('process:log', (line) => {
  // Route to UI, external logging, etc.
})
```

---

## File Structure

```
src/main/services/process/
  types.ts                  # ProcessState, ProcessHandle, definitions, events
  ProcessManagerService.ts  # Lifecycle service, registry, event hub
  ChildProcessHandle.ts     # ChildProcess implementation of ProcessHandle
  UtilityProcessHandle.ts   # utilityProcess implementation of ProcessHandle
  TaskExecutor.ts     # Task dispatch, worker lifecycle, auto-scaling
  index.ts                  # Barrel export (public API only)
  __tests__/
    ProcessManagerService.test.ts
    ChildProcessHandle.test.ts
    UtilityProcessHandle.test.ts
    TaskExecutor.test.ts
```

---

## Implementation Phases

### Phase 1: Core + ChildProcess

- `ProcessHandle` interface, `ProcessState` enum, `ProcessManagerEvents`
- `ChildProcessHandle` using `crossPlatformSpawn`
- `ProcessManagerService` with `register()` API
- Graceful shutdown in `onStop()`
- Unit tests

### Phase 2: UtilityProcess

- `UtilityProcessHandle` wrapping Electron `utilityProcess`
- `UtilityProcessHandle` extends `ProcessHandle` with MessagePort communication
- Unit tests

### Phase 3: TaskExecutor

- `TaskExecutor` with task dispatch and auto-scaling
- Unit tests

### Phase 4: Migration (Optional)

Gradually migrate existing services to use ProcessManager:
- `MCPService` stdio processes
- `OpenClawService` gateway process
- `CodeCliService` CLI tool processes

---

## Common Anti-patterns

| Wrong Choice | Why It's Wrong | Correct Choice |
|-------------|---------------|----------------|
| Using ChildProcess for aiCore | Loses structured IPC, higher startup cost | **UtilityProcess** |
| Using UtilityProcess for ollama | External binary, not a Node.js module | **ChildProcess** |
| Using TaskExecutor for a single long-lived server | TaskExecutor is for task dispatch, not daemon management | **UtilityProcess** (single) |
| Spawning processes outside ProcessManager | Bypasses tracking, no graceful shutdown | **Register with ProcessManager** |
| Using worker_threads for I/O-bound work | Async I/O already non-blocking, threads add complexity | **Single UtilityProcess** with async |
| Pre-spawning workers at startup | Wastes memory; spawn on demand, let idle timeout reclaim | **Let TaskExecutor spawn on first exec()** |

---

## Related Source Code

### Existing Process Utilities
- `src/main/utils/process.ts` - `crossPlatformSpawn`, `executeCommand`, `findExecutableInEnv`
- `src/main/utils/shell-env.ts` - Login shell environment for process spawning

### Existing Process Management (Pre-ProcessManager)
- `src/main/services/MCPService.ts` - MCP stdio server lifecycle
- `src/main/services/OpenClawService.ts` - Detached gateway process
- `src/main/services/CodeCliService.ts` - CLI tool process management
- `src/main/services/OvmsManager.ts` - Windows OVMS process management

### Lifecycle System
- `src/main/core/lifecycle/` - BaseService, decorators, IoC container
- `src/main/core/application/serviceRegistry.ts` - Service registration
