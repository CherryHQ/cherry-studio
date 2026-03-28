# 进程管理器参考文档

Cherry Studio 主进程的统一进程管理方案。管理子进程（外部二进制）和 Electron Utility 进程（隔离的 Node.js 工作负载）。同时提供 `TaskExecutor` —— 基于 Utility 进程构建的更高层抽象，用于并行任务执行。

## 快速导航

### 系统概览（架构）
- [进程管理器概览](#概览) — 动机、架构、进程类型
- [API 设计](#api-设计) — 接口、注册模式

### 使用指南（代码示例）
- [子进程使用](#子进程使用) — 管理外部二进制程序
- [Utility 进程使用](#utility-进程使用) — 隔离的 Node.js 进程
- [TaskExecutor 使用](#taskexecutor-使用) — 并行任务执行
- [AI SDK 流式集成](#与-ai-sdk-流式连接的集成) — useChat + ProcessManager

### 参考指南（标准）
- [进程类型选择指南](#选择合适的进程类型) — 何时使用哪种类型
---

## 概览

### 动机

Cherry Studio 目前以碎片化的方式管理子进程：

| 服务 | 进程管理方式 |
|------|------------|
| `MCPService` | 委托给 MCP SDK 的 `StdioClientTransport` |
| `OpenClawService` | 分离式 `spawn()` + 基于 PID 的 `pkill`/`taskkill` 终止 |
| `OvmsManager` | `exec()` + PowerShell 进程树终止 |
| `CodeCliService` | 直接 `spawn()` + 手动清理 |
| `FileStorage` | 按查询 `spawn()` ripgrep |

每个服务独立处理进程的创建、日志、错误恢复和关闭清理。没有统一的追踪机制、没有一致的优雅关闭、也没有可复用的公共抽象。

此外，**aiCore 将在 v2 中迁移到后端进程**。这需要：
- 在隔离的 Electron `utilityProcess` 实例中运行 Node.js 工作负载
- TaskExecutor 支持并行 AI 任务执行（多会话、批量 embedding）
- 崩溃隔离，确保单个 AI 任务失败不会拖垮主进程

### 架构

```
原语层 — ProcessManager（生命周期服务）
  |
  |-- ChildProcessHandle         外部二进制（ollama、MCP、rg）
  |     spawn()，stdio 通信
  |
  |-- UtilityProcessHandle       隔离 Node.js（aiCore、重计算）
        Electron utilityProcess，MessagePort IPC

组合层 — TaskExecutor（基于 ProcessManager 构建）
  |
  |-- N x UtilityProcessHandle   并行任务执行
        临时 worker，任务分发，自动扩缩容
```

两种进程句柄类型都实现共享的 `ProcessHandle` 接口，提供一致的生命周期控制。`TaskExecutor` 是独立的抽象 — 它不实现 `ProcessHandle`，内部通过 ProcessManager 创建 Utility 进程。

### 设计原则

1. **统一接口** — 两种进程类型共享 `start()` / `stop()` / `restart()` / `status`
2. **显式注册** — 命令式 API，无隐式魔法，易于追踪
3. **生命周期集成** — 继承 `BaseService`，`onStop()` 优雅关闭
4. **故障隔离** — 进程崩溃不影响主进程
5. **分层抽象** — 原语（ProcessHandle）管单个进程，组合（TaskExecutor）管并行工作负载

---

## 进程类型

### 快速决策表

| 类型 | 层级 | 使用场景 | 通信方式 | 隔离级别 | 示例 |
|------|------|---------|---------|---------|------|
| **ChildProcess** | 原语 | 外部二进制、非 Node 程序 | stdio（stdin/stdout/stderr） | OS 进程 | ollama、MCP stdio 服务器、ripgrep |
| **UtilityProcess** | 原语 | 隔离的 Node.js 工作负载 | MessagePort（structured clone） | Electron 进程 | aiCore 后端、重计算 |
| **TaskExecutor** | 组合 | 并行 Node.js 任务 | 每个 worker 一个 MessagePort | N x Electron 进程 | 批量 embedding、知识库索引 |

### 选择合适的进程类型

```
                    +---------------------------+
                    | 是否为非 Node.js 的        |
                    | 外部二进制程序？            |
                    +------+------------+-------+
                       是  |            | 否
                           v            v
                    +-------------+  +---------------------------+
                    | ChildProcess|  | 是否需要并行执行            |
                    +-------------+  | 同一类工作负载？            |
                                     +------+------------+------+
                                        是  |            | 否
                                            v            v
                                  +-----------------+  +----------------+
                                  | UtilityProcess  |  | UtilityProcess |
                                  | TaskExecutor    |  |（单实例）       |
                                  +-----------------+  +----------------+
```

### 不应使用 ProcessManager 的场景

| 场景 | 应使用 |
|------|-------|
| 一次性命令执行（`git --version`） | `executeCommand()`（`src/main/utils/process.ts`） |
| 内存中的 MCP 服务器 | `InMemoryTransport`（无需进程） |
| 简单的异步 I/O 操作 | 直接在主进程中使用 `async/await` |
| CPU 工作 < 50ms | 不值得 IPC 开销 |

---

## API 设计

### 核心接口

```typescript
/**
 * 进程状态 — 所有进程类型共享
 */
enum ProcessState {
  Idle      = 'idle',       // 已注册，未启动
  Starting  = 'starting',   // 正在创建进程
  Running   = 'running',    // 运行中
  Stopping  = 'stopping',   // 正在优雅关闭
  Stopped   = 'stopped',    // 已正常退出
  Crashed   = 'crashed',    // 异常退出
}

/**
 * 统一句柄 — 返回给消费者，所有进程类型都实现此接口
 */
interface ProcessHandle {
  readonly id: string
  readonly state: ProcessState
  readonly pid: number | undefined
  readonly uptime: number | undefined  // 启动以来的毫秒数，未运行时为 undefined

  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

/**
 * stdout/stderr 日志行
 */
interface ProcessLogLine {
  processId: string
  stream: 'stdout' | 'stderr'
  data: string
  timestamp: number
}

/**
 * ProcessManager 发出的事件
 */
interface ProcessManagerEvents {
  'process:started':  (id: string, pid: number) => void
  'process:exited':   (id: string, code: number | null, signal: NodeJS.Signals | null) => void
  'process:log':      (line: ProcessLogLine) => void
}
```

### 子进程定义

```typescript
interface ChildProcessDefinition {
  type: 'child'
  /** 唯一标识符 */
  id: string
  /** 可执行文件路径或命令名 */
  command: string
  args?: string[]
  cwd?: string
  /** 与 shell 环境合并 */
  env?: Record<string, string>
  /** SIGTERM 到 SIGKILL 的等待时间（毫秒）。默认：5000 */
  killTimeoutMs?: number
}
```

### Utility 进程定义

```typescript
interface UtilityProcessDefinition {
  type: 'utility'
  id: string
  /** Worker 模块入口文件路径 */
  modulePath: string
  args?: string[]
  env?: Record<string, string>
  killTimeoutMs?: number
}

/**
 * Utility 进程的扩展句柄 — 增加 MessagePort 通信
 */
interface UtilityProcessHandle extends ProcessHandle {
  /** 向 utility 进程发送消息 */
  postMessage(message: unknown): void
  /** 监听 utility 进程发来的消息 */
  onMessage(handler: (message: unknown) => void): void
}
```

### TaskExecutor（组合层）

`TaskExecutor` 不是 ProcessManager 的 API。它是独立的类，内部通过 `pm.register({ type: 'utility' })` 创建 worker。

```typescript
interface TaskExecutorOptions {
  id: string
  /** Worker 模块入口文件路径 */
  modulePath: string
  /** 最大并发 worker 数。默认：CPU 核心数 */
  max: number
  /** 空闲 worker 超时回收时间（毫秒）。默认：30000 */
  idleTimeoutMs?: number
  env?: Record<string, string>
  killTimeoutMs?: number
}

/**
 * TaskExecutor — 提交任务，worker 内部管理。
 * 不实现 ProcessHandle（没有 pid、没有 start/stop/restart）。
 */
class TaskExecutor {
  constructor(pm: ProcessManager, options: TaskExecutorOptions) {}

  readonly id: string

  /**
   * 在下一个空闲 worker 上执行任务。
   * 如果低于最大容量则按需创建 worker，否则排队等待。
   */
  exec<T>(taskType: string, payload: unknown): Promise<T>

  /** 停止所有 worker，拒绝待处理任务 */
  shutdown(): Promise<void>
}
```

---

## 注册 API

所有进程注册使用显式的命令式 API。没有装饰器，没有隐式扫描 — 调用 `pm.register()` 即可获得类型化的句柄。

### 注册子进程

```typescript
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ProcessHandle } from '@main/services/process'

@Injectable('OllamaService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManager'])
export class OllamaService extends BaseService {
  private ollama!: ProcessHandle

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManager')

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

### 注册 Utility 进程

```typescript
@Injectable('AiCoreBackendService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManager'])
export class AiCoreBackendService extends BaseService {
  private aicore!: UtilityProcessHandle

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManager')

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

### 使用 TaskExecutor

`TaskExecutor` 不在 ProcessManager 上注册 — 直接实例化，接收 `pm` 作为依赖：

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
    // Worker 已通过 PM 注册，PM.onStop() 也会兜底清理
  }
}
```

### 条件注册

命令式 API 天然支持条件或动态注册：

```typescript
protected async onInit(): Promise<void> {
  const pm = application.get('ProcessManager')

  // 平台特定的进程
  if (process.platform === 'win32') {
    this.ovms = pm.register({
      type: 'child',
      id: 'ovms',
      command: ovmsPath,
      args: ['--model_path', modelDir],
    })
  }

  // 仅在二进制存在时注册
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

## 子进程使用

### 基础：管理外部二进制

```typescript
const pm = application.get('ProcessManager')

const ollama = pm.register({
  type: 'child',
  id: 'ollama',
  command: '/usr/local/bin/ollama',
  args: ['serve'],
})

await ollama.start()
logger.info(`ollama started, pid=${ollama.pid}`)
```

### 监控 stdout/stderr

日志自动路由到 `loggerService.withContext('Process:<id>')`。如需自定义处理，监听事件：

```typescript
const pm = application.get('ProcessManager')

pm.on('process:log', (line) => {
  if (line.processId === 'ollama' && line.stream === 'stderr') {
    // 将错误输出转发到渲染进程
    mainWindow.webContents.send(IpcChannel.Process_Log, line)
  }
})
```

### 优雅关闭流程

当 `ProcessManager.onStop()` 被调用时（应用关闭）：

```
对每个运行中的进程：
  1. 发送 SIGTERM
  2. 等待 killTimeoutMs（默认：5000ms）
  3. 如果仍然存活，发送 SIGKILL
  4. 等待进程退出
```

---

## Utility 进程使用

### 基础：隔离的 Node.js 工作负载

```typescript
const pm = application.get('ProcessManager')

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

// 向 utility 进程发送请求
aicore.postMessage({ type: 'request', data: request })
```

### Worker 模块入口

```typescript
// workers/aicore.js — 运行在 Electron utilityProcess 内
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

### 为什么选择 UtilityProcess 而不是 ChildProcess？

| 特性 | ChildProcess | UtilityProcess |
|------|-------------|----------------|
| 通信方式 | stdio（文本流） | MessagePort（structured clone，可转移） |
| 数据传输 | 序列化为字符串 | ArrayBuffer 零拷贝，对象传输高效 |
| Node.js API | 完整（独立 Node 实例） | 完整（共享 Electron 的 Node） |
| Electron API | 无 | `net`、`systemPreferences` 等 |
| 启动开销 | 较高（新 Node.js 实例） | 较低（共享 Electron 二进制） |
| 最适合 | 外部二进制程序 | 内部 Node.js 工作负载 |

---

## TaskExecutor 使用

### 基础：并行任务执行

```typescript
const pm = application.get('ProcessManager')

const embedExecutor = new TaskExecutor(pm, {
  id: 'embed-workers',
  modulePath: './workers/embedding-worker.js',
  max: 4,
})

async function embedDocuments(docs: string[]): Promise<number[][]> {
  const chunks = splitIntoChunks(docs, 50)

  // 每个分块分发到不同的 worker 并行执行
  const results = await Promise.all(
    chunks.map(chunk => embedExecutor.exec<number[][]>('embed', chunk))
  )

  return results.flat()
}
```

### 扩缩容行为

Worker 是临时的 — 按需创建，空闲超时后回收。不维护持久化 worker。

```
TaskExecutor: max=4, idleTimeoutMs=30000

时间线:
  t=0s    0 个 worker（空闲）
  t=1s    任务 A 到达 → 创建 worker 1
  t=1s    任务 B 到达 → 创建 worker 2（< max）
  t=1s    任务 C 到达 → 创建 worker 3（< max）
  t=1s    任务 D 到达 → 创建 worker 4（= max）
  t=2s    任务 E 到达 → 排队等待（已达最大容量）
  t=3s    任务 A 完成 → worker 1 接手任务 E
  t=10s   所有任务完成 → 4 个空闲 worker
  t=40s   所有 worker 空闲 > 30s → 全部回收，恢复到 0
```

### TaskExecutor Worker 模块

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

## 与 AI SDK 流式连接的集成

### 问题

`useChat`（Vercel AI SDK）创建长连接流式会话 — 单次聊天发送请求后持续接收 token，可能持续数秒到数分钟。TaskExecutor 的 `exec()` 设计用于请求/响应模式，不支持流式。本节说明如何正确将 ProcessManager 与 AI SDK 的流式模式结合。

### 工作负载分类

关键判断：**worker 有多少时间在等 I/O vs 做 CPU 计算？**

| 工作负载 | I/O vs CPU | 正确的抽象 |
|---------|-----------|-----------|
| `useChat` 流式对话（远程 LLM） | 99% I/O（等 API 响应） | 单 UtilityProcess，多路复用 |
| 批量 embedding（远程 API） | 90% I/O，中等并发 | 单 UtilityProcess，多路复用 |
| 批量 embedding（本地模型） | 90% CPU | TaskExecutor + `exec()` |
| 知识库索引 | 80% CPU（分块、解析） | TaskExecutor + `exec()` |
| 图片预处理 | 95% CPU | TaskExecutor + `exec()` |

### 推荐架构：混合模式

按工作负载特性分流 — 不要把所有东西都塞进同一种模式：

```
useChat 流式对话（I/O 密集）
  → 单 UtilityProcess + 多路复用流
      多个 useChat 会话共享一个进程，async I/O，无阻塞

批量 embedding（CPU 密集）
  → TaskExecutor + exec()
      每个分块分发到不同的 worker

知识库索引（CPU 密集）
  → TaskExecutor + exec()
```

```typescript
@Injectable('AiCoreService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ProcessManager'])
export class AiCoreService extends BaseService {
  private chatProcess!: UtilityProcessHandle    // 流式，I/O 密集
  private computeExecutor!: TaskExecutor           // 批量任务，CPU 密集

  protected async onInit(): Promise<void> {
    const pm = application.get('ProcessManager')

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

### 核心洞察：直连 MessagePort，而非 IPC 中转

Electron 支持在进程间转移 `MessagePort` 对象。流式数据应该通过 MessagePort 在 Renderer 和 UtilityProcess 之间**直连** — 主进程只负责生命周期管理（spawn、shutdown、健康检查），不中转数据。

```
错误: Renderer → IPC → 主进程 → MessagePort → Utility → MessagePort → 主进程 → IPC → Renderer
     （每个 token 都经过主进程 = 不必要的开销）

正确: Renderer ←→ MessagePort ←→ UtilityProcess（直连）
      主进程只负责: 创建、监控、关闭
```

### Port 桥接：主进程建立通道

Renderer 需要流式连接时，主进程创建 `MessageChannelMain`，将两端分别转交：

```typescript
// AiCoreService — 主进程
async acquireChatPort(webContents: WebContents): Promise<void> {
  const { port1, port2 } = new MessageChannelMain()

  // port1 → renderer（通过 webContents.postMessage 转移所有权）
  webContents.postMessage(IpcChannel.Chat_Port, null, [port1])

  // port2 → utility process（通过 parentPort 转移）
  this.chatProcess.postMessage({ type: 'renderer-port' }, [port2])
}
```

此后，主进程**退出数据通路**。Renderer 与 Utility 直接通信。

### Worker 侧：接收转移的 Port

```typescript
// workers/aicore-chat.js
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

const activeStreams = new Map<string, AbortController>()

// parentPort: 来自主进程的管理指令（shutdown、健康检查）
// rendererPort: 来自 renderer 的直连数据通道
let rendererPort: MessagePort | null = null

process.parentPort.on('message', (event) => {
  // 主进程转交 renderer port
  if (event.data?.type === 'renderer-port' && event.ports.length > 0) {
    rendererPort = event.ports[0]
    rendererPort.on('message', handleRendererMessage)
    return
  }

  // 其他来自主进程的管理命令（健康检查等）
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

**为什么一个进程能处理多个流：** LLM API 调用是 I/O 密集型的。等待 OpenAI 返回 token 时，事件循环是空闲的，可以处理其他流。10 个并发聊天 = 10 个并发 `fetch()` 调用，零 CPU 竞争。

### Renderer 侧：useChat + MessagePort

```typescript
// 获取到 aicore utility process 的直连 port（一次性建立）
const port = await window.api.acquireChatPort()

const { messages, append, stop } = useChat({
  // 自定义 fetch 适配器：用 MessagePort 替代 HTTP
  fetch: async (url, init) => {
    const streamId = crypto.randomUUID()
    const body = JSON.parse(init.body as string)

    port.postMessage({ type: 'chat-start', streamId, data: body })

    // 将 MessagePort 事件转换为 ReadableStream（useChat 期望的格式）
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

### 完整数据流

```
建立阶段（一次性）:
  主进程创建 MessageChannelMain
  port1 → Renderer（通过 webContents.postMessage 转移）
  port2 → UtilityProcess（通过 parentPort 转移）

流式阶段（每次聊天，主进程不参与）:
  Renderer
    |  port.postMessage({ type: 'chat-start', streamId, data })
    v
  UtilityProcess (aicore-chat.js)
    |  streamText() → fetch(LLM API) → 异步迭代 token
    |
    |  对每个 token:
    v
  UtilityProcess → port.postMessage({ streamId, type: 'chunk', data })
    |
    v
  Renderer → ReadableStream controller.enqueue(chunk)
    |
    v
  useChat → 展示流式文本

管理通道（主进程 ↔ utility，独立通道）:
  主进程 → parentPort → UtilityProcess: shutdown、健康检查
  UtilityProcess → parentPort → 主进程: 状态上报、错误通知
```

---

## ProcessManager

### 生命周期集成

```typescript
@Injectable('ProcessManager')
@ServicePhase(Phase.WhenReady)
export class ProcessManager extends BaseService {

  protected async onInit(): Promise<void> {
    // 准备好接受注册
  }

  protected async onStop(): Promise<void> {
    // 1. 停止所有 utility 进程（包括 TaskExecutor 的 worker）
    // 2. 停止所有子进程（SIGTERM → 等待 → SIGKILL）
  }
}
```

### 在 serviceRegistry.ts 中注册

```typescript
import { ProcessManager } from '@main/services/process/ProcessManager'

export const services = {
  DbService,
  CacheService,
  DataApiService,
  PreferenceService,
  CodeCliService,
  ProcessManager,  // 一行搞定
} as const
```

### 事件订阅

```typescript
const pm = application.get('ProcessManager')

pm.on('process:started', (id, pid) => {
  logger.info(`进程 ${id} 已启动，pid=${pid}`)
})

pm.on('process:exited', (id, code, signal) => {
  if (code !== 0) {
    logger.error(`进程 ${id} 崩溃：code=${code}, signal=${signal}`)
  }
})

pm.on('process:log', (line) => {
  // 路由到 UI、外部日志等
})
```

---

## 文件结构

```
src/main/services/process/
  types.ts                  # ProcessState, ProcessHandle, 定义, 事件
  ProcessManager.ts  # 生命周期服务, 注册中心, 事件中枢
  ChildProcessHandle.ts     # ChildProcess 的 ProcessHandle 实现
  UtilityProcessHandle.ts   # utilityProcess 的 ProcessHandle 实现
  TaskExecutor.ts     # 任务分发, worker 生命周期, 自动扩缩容
  index.ts                  # Barrel export（仅公开 API）
  __tests__/
    ProcessManager.test.ts
    ChildProcessHandle.test.ts
    UtilityProcessHandle.test.ts
    TaskExecutor.test.ts
```

---

## 实现阶段

### 第一阶段：核心 + 子进程

- `ProcessHandle` 接口、`ProcessState` 枚举、`ProcessManagerEvents`
- `ChildProcessHandle`，使用 `crossPlatformSpawn`
- `ProcessManager`，提供 `register()` API
- `onStop()` 优雅关闭
- 单元测试

### 第二阶段：Utility 进程

- `UtilityProcessHandle`，封装 Electron `utilityProcess`
- `UtilityProcessHandle` 扩展 `ProcessHandle`，增加 MessagePort 通信
- 单元测试

### 第三阶段：TaskExecutor

- `TaskExecutor`，任务分发与自动扩缩容
- 单元测试

### 第四阶段：迁移（可选）

逐步将现有服务迁移到 ProcessManager：
- `MCPService` 的 stdio 进程
- `OpenClawService` 的网关进程
- `CodeCliService` 的 CLI 工具进程

---

## 常见反模式

| 错误选择 | 为什么错 | 正确选择 |
|---------|---------|---------|
| 用 ChildProcess 运行 aiCore | 失去结构化 IPC，启动成本更高 | **UtilityProcess** |
| 用 UtilityProcess 运行 ollama | 外部二进制，不是 Node.js 模块 | **ChildProcess** |
| 用 TaskExecutor 管理单个长期运行的服务 | TaskExecutor 是为任务分发设计的，不是守护进程管理 | **UtilityProcess**（单实例） |
| 在 ProcessManager 外部创建进程 | 绕过追踪，没有优雅关闭 | **通过 ProcessManager 注册** |
| 用 worker_threads 处理 I/O 密集任务 | 异步 I/O 本身就不阻塞，线程增加复杂度 | **单个 UtilityProcess** + async |
| 启动时预创建 worker | 浪费内存；应按需创建，空闲超时回收 | **让 TaskExecutor 在首次 exec() 时再创建** |

---

## 相关源码

### 现有进程工具
- `src/main/utils/process.ts` — `crossPlatformSpawn`、`executeCommand`、`findExecutableInEnv`
- `src/main/utils/shell-env.ts` — 进程创建所需的登录 shell 环境

### 现有进程管理（ProcessManager 之前）
- `src/main/services/MCPService.ts` — MCP stdio 服务器生命周期
- `src/main/services/OpenClawService.ts` — 分离式网关进程
- `src/main/services/CodeCliService.ts` — CLI 工具进程管理
- `src/main/services/OvmsManager.ts` — Windows OVMS 进程管理

### 生命周期系统
- `src/main/core/lifecycle/` — BaseService、装饰器、IoC 容器
- `src/main/core/application/serviceRegistry.ts` — 服务注册
