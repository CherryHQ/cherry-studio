# 知识库嵌入文件队列架构重构报告

## 一、现状分析

### 1.1 当前架构概览

Cherry Studio 的知识库系统采用 **双层队列设计**：

```
┌──────────────────────────────────────────────────────────────┐
│                    渲染进程 (Renderer)                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  KnowledgeQueue.ts (259行)                               │ │
│  │  - processing: Map<baseId, boolean>                     │ │
│  │  - MAX_RETRIES = 1                                      │ │
│  │  - 串行处理每个知识库的 pending 项                        │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                           │ IPC: window.api.knowledgeBase.add()
                           ↓
┌──────────────────────────────────────────────────────────────┐
│                      主进程 (Main)                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  KnowledgeService.ts (746行)                             │ │
│  │  - MAXIMUM_WORKLOAD = 80MB                              │ │
│  │  - MAXIMUM_PROCESSING_ITEM_COUNT = 30                   │ │
│  │  - knowledgeItemProcessingQueueMappingPromise: Map      │ │
│  │  - processingQueueHandle() 负载感知调度                  │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 当前数据流

```
用户操作 (addFiles/addNote/addUrl/addSitemap/addDirectory/refreshItem/migrateBase)
    │
    ↓
useKnowledge hook → dispatch Redux action
    │
    ↓
KnowledgeQueue.checkAllBases() ← 被 8+ 处调用，无节流
    │
    ├─ 遍历所有 knowledge bases
    ├─ 过滤 pending 或 failed (retryCount < 1) 的项
    └─ 对每个 base 调用 processQueue(baseId)
           │
           ↓
       processQueue(baseId) ← 串行 while 循环
           │
           ├─ findProcessableItem()
           ├─ processItem(baseId, item)
           │      │
           │      └─ IPC: window.api.knowledgeBase.add({base, item})
           │              │
           │              ↓
           │         KnowledgeService.add() [主进程]
           │              │
           │              ├─ getRagApplication(base)
           │              ├─ 根据 item.type 创建 LoaderTask
           │              ├─ appendProcessingQueue(task)
           │              └─ processingQueueHandle() ← 负载感知调度
           │                      │
           │                      ├─ 评估任务工作负载
           │                      ├─ 检查 workload < 80MB
           │                      ├─ 检查 processingItemCount < 30
           │                      └─ Promise.all(subtasks)
           │                              │
           │                              ↓
           │                         embedding + 向量存储
           │
           ↓ 返回 LoaderReturn
       更新 Redux state (uniqueId, status)
```

### 1.3 关键文件

| 文件路径                                         | 行数 | 职责                           |
| ------------------------------------------------ | ---- | ------------------------------ |
| `src/renderer/src/queue/KnowledgeQueue.ts`       | 259  | 渲染进程队列管理，串行处理     |
| `src/main/services/KnowledgeService.ts`          | 746  | 主进程核心服务，负载调度       |
| `src/renderer/src/store/knowledge.ts`            | ~200 | Redux 状态管理                 |
| `src/renderer/src/hooks/useKnowledge.ts`         | ~300 | 业务钩子，调用 checkAllBases() |
| `src/renderer/src/store/thunk/knowledgeThunk.ts` | ~100 | 异步操作 thunks                |
| `packages/shared/IpcChannel.ts`                  | 397  | IPC 通道定义                   |

---

## 二、问题诊断

### 2.1 架构问题

#### 问题 1：`checkAllBases()` 被多处调用，无节流/去重

**代码位置**: `src/renderer/src/hooks/useKnowledge.ts`

```typescript
// 以下操作都会触发 checkAllBases()
addFiles()      → KnowledgeQueue.checkAllBases()
addNote()       → KnowledgeQueue.checkAllBases()
addUrl()        → KnowledgeQueue.checkAllBases()
addSitemap()    → KnowledgeQueue.checkAllBases()
addDirectory()  → KnowledgeQueue.checkAllBases()
refreshItem()   → KnowledgeQueue.checkAllBases()
migrateBase()   → KnowledgeQueue.checkAllBases()
```

**影响**:

- 快速连续操作导致重复 IPC 调用
- 可能产生竞态条件
- 资源浪费

#### 问题 2：渲染进程串行处理是瓶颈

**代码位置**: `src/renderer/src/queue/KnowledgeQueue.ts:77-80`

```typescript
let processableItem = findProcessableItem();
while (processableItem) {
  await this.processItem(baseId, processableItem); // 等待完成才处理下一个
  processableItem = findProcessableItem();
}
```

**影响**:

- 主进程可并发处理 30 项，但渲染进程逐个提交
- 无法充分利用主进程并发能力
- 大量文件时处理速度慢

#### 问题 3：无优先级控制

**现状**: 所有任务按添加顺序 FIFO 处理

**影响**:

- 用户手动添加的重要文件可能排在批量导入之后
- 无法优先处理小文件快速反馈

#### 问题 4：无法取消正在进行的任务

**现状**: `stopProcessing(baseId)` 只阻止新任务，无法中断正在执行的任务

**影响**:

- 用户无法取消错误添加的大文件
- 无法中断卡住的任务

---

### 2.2 可靠性问题

#### 问题 5：重试机制不足

**代码位置**: `src/renderer/src/queue/KnowledgeQueue.ts:22`

```typescript
private readonly MAX_RETRIES = 1  // 最多重试 1 次
```

**影响**:

- 临时网络故障或 API 限流导致永久失败
- 无指数退避，重试过快可能加剧问题

#### 问题 6：预处理失败无降级

**代码位置**: `src/main/services/KnowledgeService.ts:~720`

```typescript
// 当前逻辑：预处理失败直接抛出异常
const { processedFile, quota } = await provider.parseFile(itemId, file);
// 注释掉的降级逻辑：
// fileToProcess = file  // 不会执行
```

**影响**:

- 预处理服务不可用时，整个文件嵌入失败
- 用户必须手动重试

#### 问题 7：删除清理不可靠

**代码位置**: `src/main/services/KnowledgeService.ts`

```typescript
// 删除失败时记录到待删除列表
const pendingDeleteFilePath = path.join(
  getDataPath(),
  "KnowledgeBase",
  "pendingDeleteFile",
);
// 只在应用启动时处理
```

**影响**:

- 删除失败的文件可能长时间残留
- 无运行时重试机制

#### 问题 8：崩溃后无恢复机制

**现状**: 正在处理的任务存储在内存 Map 中，无持久化

**影响**:

- 应用崩溃或被杀死后，正在处理的任务丢失
- 用户需要手动重新添加

---

### 2.3 性能问题

#### 问题 9：大文件内存风险

**代码位置**: 文件加载器相关代码

```typescript
// 文件一次性读入内存
const content = await fs.promises.readFile(filePath);
```

**影响**:

- 大型 PDF (>50MB) 可能导致内存峰值过高
- 多个大文件并发处理可能 OOM

#### 问题 10：数据库连接未正确管理

**代码位置**: `src/main/services/KnowledgeService.ts`

```typescript
private dbInstances: Map<string, LibSqlDb>  // 连接缓存

// 删除知识库时
async delete(id: string) {
  // dbInstances 中的连接可能未关闭
}
```

**影响**:

- 长时间运行后可能积累未关闭的连接
- 资源泄漏

#### 问题 11：无搜索结果缓存

**现状**: 每次搜索都执行完整的向量化 + 相似度计算

**影响**:

- 相同查询重复计算
- 搜索响应时间不稳定

---

### 2.4 数据一致性问题

#### 问题 12：笔记存储与向量 DB 可能不同步

**存储位置**:

- 笔记内容: IndexedDB (Dexie.js) - `src/renderer/src/databases/`
- 向量数据: SQLite (LibSqlDb) - 主进程

**风险**: 删除操作可能只删除一边，导致孤立数据

---

## 三、重构方案设计

### 3.1 新架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        渲染进程 (Renderer)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   useKnowledge hook                                             │
│         │                                                       │
│         ↓                                                       │
│   KnowledgeQueueManager (单例)                                   │
│         │                                                       │
│         ├─ 防抖批量提交 (debounce 100ms)                         │
│         ├─ 内容 hash 去重                                        │
│         ├─ 优先级分配 (high/normal/low)                          │
│         └─ 批量缓冲 (batchBuffer: Map<baseId, items[]>)          │
│         │                                                       │
│         ↓ 单次批量 IPC 调用                                      │
│   IPC: knowledge-queue:submit-batch                             │
│         │                                                       │
│         │←──────── IPC: knowledge-queue:progress ←──────────────│
│         │                                                       │
│   Redux Middleware                                              │
│         └─ 自动更新 store 状态                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│                        主进程 (Main)                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   KnowledgeTaskScheduler                                        │
│         │                                                       │
│         ├─ 优先级队列 (p-queue × 3 levels)                       │
│         │     Level 0: high   (用户主动添加)                     │
│         │     Level 1: normal (批量导入)                         │
│         │     Level 2: low    (重试任务)                         │
│         │                                                       │
│         ├─ 并发控制                                              │
│         │     maxConcurrency: 5                                 │
│         │     maxWorkloadBytes: 80MB                            │
│         │                                                       │
│         ├─ 取消令牌 (cancelTokens: Map<taskId, AbortController>) │
│         │                                                       │
│         └─ 崩溃恢复 (RecoveryStore)                              │
│               └─ queue_recovery.json 持久化                      │
│         │                                                       │
│         ↓                                                       │
│   TaskExecutor                                                  │
│         │                                                       │
│         ├─ Stage 1: 预处理 (带降级回退)                          │
│         ├─ Stage 2: 分块 (>10MB 流式处理)                        │
│         ├─ Stage 3: 嵌入 (指数退避重试)                          │
│         └─ Stage 4: 向量存储                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 组件设计

#### 3.2.1 渲染进程：KnowledgeQueueManager

```typescript
// src/renderer/src/queue/KnowledgeQueueManager.ts

interface QueueConfig {
  debounceMs: number; // 默认 100ms
  batchSizeLimit: number; // 默认 50 items
  retryDelayBase: number; // 默认 1000ms
  maxRetries: number; // 默认 3
}

interface EnqueueOptions {
  priority?: "high" | "normal" | "low";
  bypassDedup?: boolean;
}

class KnowledgeQueueManager {
  private static instance: KnowledgeQueueManager;
  private debouncer: Map<string, NodeJS.Timeout> = new Map();
  private batchBuffer: Map<string, KnowledgeItem[]> = new Map();
  private config: QueueConfig;

  static getInstance(): KnowledgeQueueManager;

  // 入队 - 自动防抖和批量
  enqueue(
    baseId: string,
    items: KnowledgeItem[],
    options?: EnqueueOptions,
  ): void {
    // 1. 添加到批量缓冲
    // 2. 基于内容 hash 去重
    // 3. 调度防抖后的 flush
  }

  // 刷新批量到主进程
  private async flushBatch(baseId: string): Promise<void> {
    const items = this.batchBuffer.get(baseId);
    if (!items?.length) return;

    this.batchBuffer.delete(baseId);

    // 单次 IPC 调用提交整批
    const taskIds = await window.api.knowledgeQueue.submitBatch({
      baseId,
      items,
      priority: this.determinePriority(items),
    });

    // 更新 Redux 状态为 'queued'
    items.forEach((item, i) => {
      store.dispatch(
        updateItemProcessingStatus({
          baseId,
          itemId: item.id,
          status: "queued",
          taskId: taskIds[i],
        }),
      );
    });
  }

  // 取消任务
  async cancel(baseId: string, itemIds: string[]): Promise<void> {
    // 1. 从本地缓冲移除未发送的
    // 2. 发送取消请求到主进程
  }

  // 暂停/恢复
  pause(baseId: string): void;
  resume(baseId: string): void;
}
```

#### 3.2.2 主进程：KnowledgeTaskScheduler

```typescript
// src/main/services/knowledge/KnowledgeTaskScheduler.ts

import PQueue from "p-queue";

interface TaskDefinition {
  taskId: string;
  baseId: string;
  item: KnowledgeItem;
  priority: 0 | 1 | 2; // 0 = highest
  retryCount: number;
  createdAt: number;
  estimatedWorkload: number; // bytes
}

interface SchedulerConfig {
  maxConcurrency: number; // 默认 5
  maxWorkloadBytes: number; // 默认 80MB
  priorityLevels: number; // 默认 3
}

class KnowledgeTaskScheduler {
  private queues: PQueue[]; // 每个优先级一个队列
  private runningTasks: Map<string, TaskDefinition> = new Map();
  private cancelTokens: Map<string, AbortController> = new Map();
  private recoveryStore: RecoveryStore;
  private currentWorkload: number = 0;

  constructor(config: SchedulerConfig) {
    this.queues = Array.from(
      { length: config.priorityLevels },
      () => new PQueue({ concurrency: config.maxConcurrency }),
    );
    this.recoveryStore = new RecoveryStore();
  }

  // 提交批量任务
  async submitBatch(
    baseId: string,
    items: KnowledgeItem[],
    priority: number,
  ): Promise<string[]> {
    const taskIds: string[] = [];

    for (const item of items) {
      const taskId = uuidv4();
      const task: TaskDefinition = {
        taskId,
        baseId,
        item,
        priority,
        retryCount: 0,
        createdAt: Date.now(),
        estimatedWorkload: this.estimateWorkload(item),
      };

      // 持久化以支持崩溃恢复
      await this.recoveryStore.saveTask(task);

      // 添加到对应优先级队列
      this.queues[priority].add(() => this.executeTask(task));
      taskIds.push(taskId);
    }

    return taskIds;
  }

  // 执行单个任务
  private async executeTask(task: TaskDefinition): Promise<void> {
    // 工作负载检查
    while (
      this.currentWorkload + task.estimatedWorkload >
      this.config.maxWorkloadBytes
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const abortController = new AbortController();
    this.cancelTokens.set(task.taskId, abortController);
    this.runningTasks.set(task.taskId, task);
    this.currentWorkload += task.estimatedWorkload;

    try {
      const executor = new TaskExecutor(task, abortController.signal);
      const result = await executor.execute();

      this.sendProgress(task.taskId, { status: "completed", result });
      await this.recoveryStore.removeTask(task.taskId);
    } catch (error) {
      if (abortController.signal.aborted) {
        this.sendProgress(task.taskId, { status: "cancelled" });
      } else if (task.retryCount < 3) {
        await this.scheduleRetry(task, error);
      } else {
        this.sendProgress(task.taskId, {
          status: "failed",
          error: error.message,
        });
      }
    } finally {
      this.currentWorkload -= task.estimatedWorkload;
      this.runningTasks.delete(task.taskId);
      this.cancelTokens.delete(task.taskId);
    }
  }

  // 指数退避重试
  private async scheduleRetry(
    task: TaskDefinition,
    error: Error,
  ): Promise<void> {
    const delay = Math.min(
      1000 * Math.pow(2, task.retryCount) * (0.9 + Math.random() * 0.2),
      30000,
    );
    task.retryCount++;
    task.priority = 2; // 降级到低优先级

    await this.recoveryStore.saveTask(task);

    this.sendProgress(task.taskId, {
      status: "retrying",
      retryCount: task.retryCount,
      nextRetryIn: delay,
    });

    setTimeout(() => {
      this.queues[task.priority].add(() => this.executeTask(task));
    }, delay);
  }

  // 取消任务
  cancel(taskIds: string[]): void {
    for (const taskId of taskIds) {
      const controller = this.cancelTokens.get(taskId);
      if (controller) {
        controller.abort();
      }
    }
  }
}
```

#### 3.2.3 主进程：TaskExecutor

```typescript
// src/main/services/knowledge/TaskExecutor.ts

class TaskExecutor {
  private task: TaskDefinition;
  private signal: AbortSignal;
  private base: KnowledgeBaseParams;

  constructor(task: TaskDefinition, signal: AbortSignal) {
    this.task = task;
    this.signal = signal;
  }

  async execute(): Promise<LoaderReturn> {
    // Stage 1: 预处理 (带降级)
    this.sendProgress("preprocessing", 0);
    const processedFile = await this.preprocess();
    this.sendProgress("preprocessing", 100);

    this.checkAborted();

    // Stage 2: 分块
    this.sendProgress("chunking", 0);
    const chunks = await this.loadAndChunk(processedFile);
    this.sendProgress("chunking", 100);

    this.checkAborted();

    // Stage 3: 嵌入
    this.sendProgress("embedding", 0);
    const embeddings = await this.generateEmbeddings(chunks);
    this.sendProgress("embedding", 100);

    this.checkAborted();

    // Stage 4: 存储
    this.sendProgress("storing", 0);
    const result = await this.storeVectors(embeddings);
    this.sendProgress("storing", 100);

    return result;
  }

  // 预处理 - 带降级回退
  private async preprocess(): Promise<FileMetadata> {
    const { item, baseId } = this.task;
    if (item.type !== "file") return item.content as FileMetadata;

    const file = item.content as FileMetadata;
    if (!this.base.preprocessProvider || file.ext.toLowerCase() !== ".pdf") {
      return file;
    }

    try {
      const provider = new PreprocessProvider(
        this.base.preprocessProvider.provider,
      );
      const cached = await provider.checkIfAlreadyProcessed(file);
      if (cached) return cached;

      const { processedFile } = await provider.parseFile(item.id, file);
      return processedFile;
    } catch (error) {
      // 关键改进：降级到原始文件而非失败
      logger.warn(
        `Preprocessing failed for ${file.name}, using original`,
        error,
      );
      return file;
    }
  }

  // 分块 - 大文件流式处理
  private async loadAndChunk(file: FileMetadata): Promise<Chunk[]> {
    const STREAM_THRESHOLD = 10 * 1024 * 1024; // 10MB

    if (file.size > STREAM_THRESHOLD) {
      return this.streamLoadAndChunk(file);
    }
    return this.standardLoadAndChunk(file);
  }

  // 流式处理大文件
  private async streamLoadAndChunk(file: FileMetadata): Promise<Chunk[]> {
    const chunks: Chunk[] = [];
    const readStream = fs.createReadStream(file.path, {
      highWaterMark: 1024 * 1024, // 1MB buffer
    });

    // ... 流式处理逻辑
    return chunks;
  }

  private checkAborted(): void {
    if (this.signal.aborted) {
      throw new DOMException("Task cancelled", "AbortError");
    }
  }

  private sendProgress(stage: string, percent: number): void {
    mainWindow?.webContents.send("knowledge-queue:progress", {
      taskId: this.task.taskId,
      itemId: this.task.item.id,
      baseId: this.task.baseId,
      stage,
      progress: percent,
    });
  }
}
```

#### 3.2.4 崩溃恢复：RecoveryStore

```typescript
// src/main/services/knowledge/RecoveryStore.ts

class RecoveryStore {
  private filePath: string;
  private tasks: Map<string, TaskDefinition> = new Map();
  private saveDebouncer: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = path.join(
      getDataPath(),
      "KnowledgeBase",
      "queue_recovery.json",
    );
    this.loadFromDisk();
  }

  async saveTask(task: TaskDefinition): Promise<void> {
    this.tasks.set(task.taskId, task);
    this.debouncedSave();
  }

  async removeTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
    this.debouncedSave();
  }

  getUnfinishedTasks(): TaskDefinition[] {
    const now = Date.now();
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

    return Array.from(this.tasks.values())
      .filter((task) => now - task.createdAt < MAX_AGE)
      .sort((a, b) => a.priority - b.priority);
  }

  private debouncedSave(): void {
    if (this.saveDebouncer) clearTimeout(this.saveDebouncer);
    this.saveDebouncer = setTimeout(() => this.persistToDisk(), 500);
  }

  private async persistToDisk(): Promise<void> {
    const data = JSON.stringify(Array.from(this.tasks.entries()));
    await fs.promises.writeFile(this.filePath, data, "utf-8");
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
        this.tasks = new Map(data);
      }
    } catch (error) {
      logger.warn("Failed to load recovery store", error);
      this.tasks = new Map();
    }
  }
}
```

### 3.3 IPC 通道设计

```typescript
// packages/shared/IpcChannel.ts 新增

// 队列操作
KnowledgeQueue_SubmitBatch = 'knowledge-queue:submit-batch',
KnowledgeQueue_Cancel = 'knowledge-queue:cancel',
KnowledgeQueue_Pause = 'knowledge-queue:pause',
KnowledgeQueue_Resume = 'knowledge-queue:resume',
KnowledgeQueue_Progress = 'knowledge-queue:progress',
KnowledgeQueue_Status = 'knowledge-queue:status',
```

```typescript
// 进度事件结构
interface ProgressEvent {
  taskId: string;
  itemId: string;
  baseId: string;
  stage:
    | "queued"
    | "preprocessing"
    | "chunking"
    | "embedding"
    | "storing"
    | "completed"
    | "failed"
    | "cancelled"
    | "retrying";
  progress: number; // 0-100
  message?: string;
  error?: string;
  retryCount?: number;
  nextRetryIn?: number; // ms
}
```

### 3.4 Redux 中间件

```typescript
// src/renderer/src/store/middleware/knowledgeQueueMiddleware.ts

import { Middleware } from "@reduxjs/toolkit";
import { updateItemProcessingStatus } from "../knowledge";

function mapStageToStatus(stage: string): ProcessingStatus {
  switch (stage) {
    case "queued":
      return "pending";
    case "preprocessing":
    case "chunking":
    case "embedding":
    case "storing":
      return "processing";
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    case "retrying":
      return "processing";
    default:
      return "pending";
  }
}

export const knowledgeQueueMiddleware: Middleware = (store) => {
  // 订阅 IPC 进度事件
  window.electron.ipcRenderer.on(
    "knowledge-queue:progress",
    (_, event: ProgressEvent) => {
      store.dispatch(
        updateItemProcessingStatus({
          baseId: event.baseId,
          itemId: event.itemId,
          status: mapStageToStatus(event.stage),
          progress: event.progress,
          error: event.error,
        }),
      );
    },
  );

  return (next) => (action) => next(action);
};
```

---

## 四、重试策略设计

### 4.1 指数退避算法

```typescript
function calculateRetryDelay(attempt: number): number {
  const baseDelay = 1000; // 1 秒
  const maxDelay = 30000; // 30 秒
  const jitter = 0.1; // 10% 抖动

  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  const jitteredDelay = cappedDelay * (1 - jitter + Math.random() * jitter * 2);

  return Math.round(jitteredDelay);
}

// 重试延迟示例:
// 尝试 0: ~1000ms
// 尝试 1: ~2000ms
// 尝试 2: ~4000ms
// 尝试 3: ~8000ms (达到最大)
```

### 4.2 可重试错误分类

| 错误类型     | 是否重试 | 说明                   |
| ------------ | -------- | ---------------------- |
| 网络超时     | 是       | 临时网络问题           |
| API 429 限流 | 是       | 降速后重试             |
| API 5xx 错误 | 是       | 服务端临时故障         |
| API 401/403  | 否       | 认证问题需用户介入     |
| 文件不存在   | 否       | 永久性错误             |
| 解析错误     | 否       | 文件格式问题           |
| 内存不足     | 是       | 等待其他任务完成后重试 |

---

## 五、降级策略设计

### 5.1 预处理降级

```
PDF 文件预处理流程:
   ┌─────────────────┐
   │  PDF 文件输入    │
   └────────┬────────┘
            ↓
   ┌─────────────────┐     失败     ┌─────────────────┐
   │  检查预处理缓存  │────────────→│  使用原始文件    │
   └────────┬────────┘              └────────┬────────┘
            ↓ 命中                            │
   ┌─────────────────┐                        │
   │  返回缓存结果    │                        │
   └────────┬────────┘                        │
            ↓ 未命中                          │
   ┌─────────────────┐     失败               │
   │  调用预处理 API  │────────────────────────┤
   └────────┬────────┘                        │
            ↓ 成功                            │
   ┌─────────────────┐                        │
   │  保存到缓存      │                        │
   └────────┬────────┘                        │
            ↓                                 ↓
   ┌─────────────────────────────────────────────┐
   │              继续嵌入流程                    │
   └─────────────────────────────────────────────┘
```

### 5.2 嵌入模型降级

```
嵌入生成流程:
   ┌─────────────────┐
   │  主嵌入模型      │
   └────────┬────────┘
            ↓
   ┌─────────────────┐     成功     ┌─────────────────┐
   │  调用嵌入 API    │────────────→│  返回向量结果    │
   └────────┬────────┘              └─────────────────┘
            ↓ 失败 (可重试)
   ┌─────────────────┐
   │  指数退避重试    │
   │  (最多 3 次)     │
   └────────┬────────┘
            ↓ 仍然失败
   ┌─────────────────┐     存在     ┌─────────────────┐
   │  检查备用模型    │────────────→│  使用备用模型    │
   └────────┬────────┘              └────────┬────────┘
            ↓ 不存在                          │
   ┌─────────────────┐                        │
   │  标记为失败      │←───────────────────────┘
   │  (可手动重试)    │           如果备用也失败
   └─────────────────┘
```

---

## 六、实施路线图

### 阶段 1：核心基础设施 (高优先级)

| 步骤 | 任务                        | 文件                                                    | 复杂度 |
| ---- | --------------------------- | ------------------------------------------------------- | ------ |
| 1.1  | 创建 KnowledgeTaskScheduler | `src/main/services/knowledge/KnowledgeTaskScheduler.ts` | 高     |
| 1.2  | 创建 RecoveryStore          | `src/main/services/knowledge/RecoveryStore.ts`          | 中     |
| 1.3  | 添加新 IPC 通道             | `packages/shared/IpcChannel.ts`                         | 低     |
| 1.4  | 添加 preload 绑定           | `src/preload/index.ts`                                  | 低     |
| 1.5  | 重构 KnowledgeService.add() | `src/main/services/KnowledgeService.ts`                 | 中     |

### 阶段 2：可靠性改进 (高优先级)

| 步骤 | 任务               | 文件                                          | 复杂度 |
| ---- | ------------------ | --------------------------------------------- | ------ |
| 2.1  | 创建 TaskExecutor  | `src/main/services/knowledge/TaskExecutor.ts` | 高     |
| 2.2  | 实现指数退避重试   | TaskExecutor / Scheduler                      | 中     |
| 2.3  | 添加预处理降级逻辑 | TaskExecutor                                  | 低     |
| 2.4  | 改进删除清理机制   | `src/main/services/KnowledgeService.ts`       | 中     |

### 阶段 3：渲染进程优化 (中优先级)

| 步骤 | 任务                       | 文件                                              | 复杂度 |
| ---- | -------------------------- | ------------------------------------------------- | ------ |
| 3.1  | 创建 KnowledgeQueueManager | `src/renderer/src/queue/KnowledgeQueueManager.ts` | 高     |
| 3.2  | 替换 checkAllBases() 调用  | `src/renderer/src/hooks/useKnowledge.ts`          | 中     |
| 3.3  | 添加 Redux 中间件          | `src/renderer/src/store/middleware/`              | 中     |
| 3.4  | 废弃旧 KnowledgeQueue      | `src/renderer/src/queue/KnowledgeQueue.ts`        | 低     |

### 阶段 4：性能优化 (中优先级)

| 步骤 | 任务                | 文件             | 复杂度 |
| ---- | ------------------- | ---------------- | ------ |
| 4.1  | 大文件流式处理      | TaskExecutor     | 高     |
| 4.2  | 数据库连接池管理    | KnowledgeService | 中     |
| 4.3  | 搜索结果缓存 (可选) | KnowledgeService | 中     |

### 阶段 5：高级功能 (低优先级)

| 步骤 | 任务          | 文件                     | 复杂度 |
| ---- | ------------- | ------------------------ | ------ |
| 5.1  | 优先级调整 UI | 知识库页面组件           | 中     |
| 5.2  | 暂停/恢复 UI  | 知识库页面组件           | 低     |
| 5.3  | 批量导入优化  | TaskExecutor / Scheduler | 中     |

---

## 七、文件变更清单

### 新增文件

```
src/main/services/knowledge/
├── KnowledgeTaskScheduler.ts    # 主进程任务调度器
├── TaskExecutor.ts              # 任务执行器
└── RecoveryStore.ts             # 崩溃恢复存储

src/renderer/src/queue/
└── KnowledgeQueueManager.ts     # 渲染进程队列管理器

src/renderer/src/store/middleware/
└── knowledgeQueueMiddleware.ts  # Redux 中间件
```

### 修改文件

```
packages/shared/IpcChannel.ts                    # +6 IPC 通道
src/preload/index.ts                             # +新 IPC 绑定
src/main/services/KnowledgeService.ts            # 委托调度器、降级、连接管理
src/renderer/src/queue/KnowledgeQueue.ts         # 废弃，重定向
src/renderer/src/hooks/useKnowledge.ts           # 使用新队列管理器
src/renderer/src/store/index.ts                  # 添加中间件
src/renderer/src/hooks/useAppInit.ts             # 移除 checkAllBases() 调用
```

---

## 八、迁移策略

### 8.1 功能开关

```typescript
// src/renderer/src/config/featureFlags.ts
export const FEATURE_FLAGS = {
  USE_NEW_KNOWLEDGE_QUEUE: false, // 默认关闭，测试后开启
};
```

### 8.2 兼容层

```typescript
// src/renderer/src/queue/KnowledgeQueue.ts (修改后)
class KnowledgeQueue {
  async checkAllBases(): Promise<void> {
    if (FEATURE_FLAGS.USE_NEW_KNOWLEDGE_QUEUE) {
      // 新系统：由 KnowledgeQueueManager 自动处理
      return;
    }
    // 旧逻辑保持不变
    // ...
  }
}
```

### 8.3 数据迁移

无需数据迁移，新系统兼容现有 Redux 状态结构和向量数据库。

---

## 九、风险与缓解

| 风险               | 概率 | 影响 | 缓解措施                           |
| ------------------ | ---- | ---- | ---------------------------------- |
| 新旧系统状态不一致 | 中   | 高   | 功能开关原子切换                   |
| 迁移期间任务丢失   | 低   | 高   | RecoveryStore 持久化 + 向前兼容    |
| 性能回归           | 低   | 中   | 基准测试对比，保留回退路径         |
| 内存使用增加       | 中   | 中   | 流式处理大文件，工作负载限制       |
| 并发问题           | 中   | 高   | 完善单元测试，使用 AbortController |

---

## 十、验收标准

| 场景                | 当前表现           | 目标表现                  |
| ------------------- | ------------------ | ------------------------- |
| 批量添加 100 个文件 | 可能竞态，重复 IPC | 无竞态，单次批量 IPC      |
| 临时网络故障        | 重试 1 次后失败    | 指数退避重试 3 次         |
| 应用崩溃后重启      | 任务丢失           | 自动恢复未完成任务        |
| 处理 100MB PDF      | 可能 OOM           | 流式处理，内存峰值 <200MB |
| 取消正在进行的任务  | 无法取消           | 秒级响应取消              |
| 优先处理用户任务    | FIFO               | 用户任务优先执行          |

---

## 十一、总结

本次重构将知识库嵌入队列从 **简单的串行处理** 升级为 **优先级感知的并发调度系统**，主要改进包括：

1. **渲染进程优化**: 防抖批量提交，减少 IPC 调用
2. **主进程调度**: 3 级优先级队列，工作负载感知
3. **可靠性**: 指数退避重试，预处理降级，崩溃恢复
4. **性能**: 大文件流式处理，连接池管理
5. **用户体验**: 任务取消，细粒度进度报告

通过分阶段实施和功能开关，可以安全地逐步迁移到新架构。
