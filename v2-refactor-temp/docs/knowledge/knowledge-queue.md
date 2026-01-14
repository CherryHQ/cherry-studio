# Knowledge 队列与调度系统设计（v2 后端）

本方案将知识库嵌入任务的调度完全移到 **主进程 + DataApi**，渲染端只发起 CRUD 与状态查询。核心目标是支持并发、跨知识库公平、类型不一致的统一处理，并在 UI 上仅展示“整体百分比”进度。

## 目标

- 队列由主进程统一管理，渲染端不做调度与去重
- 支持并发处理、跨知识库公平，不因单库大量任务阻塞其他库
- 统一处理 file/url/note/sitemap/directory 等多类型 item
- 仅展示整体进度（单一百分比）
- 删除时立即从 UI 移除，但后台能中止正在执行的任务

## 范围

- **包含**：队列调度、并发限制、进度计算、取消/删除一致性、状态更新
- **不包含**：UI 设计细节、Embedding 模型选型、向量库实现细节、崩溃恢复

## 约束与假设

- 队列仅保存在主进程内存，不做持久化；重启后需重新入队
- 允许同一时间批量添加 100 个 item
- 向量与元数据使用 libsql 存储
- UI 不暴露"取消按钮"，取消由删除或 reprocess 触发
- **孤儿状态处理**：应用启动时，将卡在 `preprocessing` / `embedding` 状态的记录重置为 `failed`
- **取消机制**：使用 `AbortController` 中止正在进行的 IO / Embedding 请求

## 总体架构

```
Renderer
  └─ DataApi 请求 (create/reprocess/delete/list)
       │
       ▼
Main Process
  ├─ KnowledgeItemService (CRUD + 状态更新)
  ├─ KnowledgeScheduler (全局/每库调度)
  ├─ KnowledgeServiceV2 (read/chunk/embed/write)
  ├─ SQLite (knowledge_item)
  └─ Vector Store (LibSQL)
       ▲
       └─ Progress 通过 DataApi 查询/轮询返回
```

## 核心抽象

- **Job**：以 item 为单位的任务载体
  `{ baseId, itemId, type, workload, stage, progress, createdAt }`
- **Stage**：内部执行阶段
  `read -> chunk -> embed -> write`
  对外状态仍使用现有 `ItemStatus`（pending/preprocessing/embedding/completed/failed）
- **Scheduler**：全局队列 + 每库子队列 + 资源池并发限制
- **Workload**：估算任务成本，用于调度公平与背压（估算策略待定）

## 调度策略（A + B）

1. **全局并发上限**：限制同时处理的任务数量
2. **每库并发上限**：防止某个知识库占满资源
3. **轮询公平**：按 baseId 轮询从子队列取任务（Round-robin）
4. **阶段并发分离**：IO、Embedding、写入各自有并发上限
5. **背压**：阶段资源耗尽时任务停留在队列中，避免 IO/Embedding 堵死

## 调度器接口与并发策略（详细设计草案）

### 公共接口

```ts
export type KnowledgeJobStage = "read" | "chunk" | "embed" | "write";

export type KnowledgeJob = {
  baseId: string;
  itemId: string;
  type: KnowledgeItemType;
  workload: number;
  createdAt: number;
  controller: AbortController;
};

export type SchedulerConfig = {
  globalConcurrency: number;
  perBaseConcurrency: number;
  ioConcurrency: number;
  embeddingConcurrency: number;
  writeConcurrency: number;
  maxQueueSize?: number;
};

export interface KnowledgeScheduler {
  enqueue(job: KnowledgeJob): Promise<void>;
  cancel(itemId: string): { status: "cancelled" | "ignored" };
  getStatus(): {
    queueSize: number;
    processingCount: number;
    perBaseQueue: Record<string, number>;
  };
}
```

### 核心数据结构

- `baseQueues: Map<baseId, Deque<Job>>`：库内 FIFO
- `baseOrder: string[] + cursor`：跨库轮询
- `activeByBase: Map<baseId, number>` 与 `activeGlobal: number`
- `jobs: Map<itemId, Job>`：去重、取消索引

### 轮询与公平策略

- 轮询 `baseOrder` 取下一非空队列
- 满足 `activeGlobal < globalConcurrency` 且 `activeByBase[baseId] < perBaseConcurrency` 时启动
- 当前库满载则跳过，继续轮询其他库
- 任务完成或失败后释放计数并继续调度

### 分阶段并发（资源池）

- 独立资源池：`ioPool`、`embedPool`、`writePool`
- 任务管线：
  `read + chunk` 占用 IO → 释放 → `embed` 占用 → 释放 → `write` 占用 → 释放
- 防止 IO 与 Embedding 峰值相互阻塞

### Workload 估算

- file：按文件大小估算
- directory：初始按 1，读取阶段拿到 fileCount 后可修正
- url/note/sitemap：按字符长度估算
- 不改变 FIFO，仅用于后续扩展（如大任务降并发/配额）

### 取消与去重

- 若 `itemId` 已存在于 `jobs`，拒绝或忽略入队
- `cancel(itemId)`：
  - 队列中任务直接移除
  - 执行中任务触发 `AbortController.abort()`，在阶段/批次边界检查中止

## 处理流水线（统一类型）

1. **入队**
   `POST /knowledge-bases/:id/items` 创建记录，`status=pending`，入队。
2. **读取与分块**
   `KnowledgeServiceV2` 通过 reader 将任意类型转换为 nodes。
3. **嵌入**
   批次 embedding，避免一次性内存峰值。
4. **写入**
   批次写入 LibSQL 向量库。
5. **完成/失败**
   `status=completed | failed`，`error` 写入 DB。

## 进度设计（整体百分比）

- **单一百分比**：UI 只显示 0–100%，不区分阶段文本。
- **权重合成**：
  `read+chunk 60%`，`embed+write 40%`（可配置）
- **目录**：read 阶段按"已处理文件/已发现文件数"推进（动态分母）；embed 阶段按"已嵌入节点/总节点数"推进。
- **非目录**：read 阶段快速推进到 60%；embed/write 使用批次进度补齐到 100%。
- **进度读取**：通过 `GET /knowledge-items/:id` 返回 `progress` 字段（仅内存维护，不落库）。

## 进度与状态更新链路

- **归属**：进度仅内存维护，通过 DataApi 返回；状态/错误写入 `knowledge_item`。
- **入口**：创建 item 时写入 `status=pending`、`error=null`，进度为 `0`，随后入队。
- **阶段映射**：
  - `read + chunk` → `ItemStatus=preprocessing`
  - `embed + write` → `ItemStatus=embedding`
  - 完成 → `completed`
  - 中止/错误 → `failed`（记录 error）
- **进度存储**：主进程内存 `ProgressTracker`（例如 `Map<itemId, number>`），由 `GET /knowledge-items/:id` 合并返回。
- **更新节奏**：
  - 阶段切换更新 DB 状态与进度阈值
  - 批次完成更新内存进度（建议 200–500ms 节流）
  - 完成时进度强制为 `100`，并在短 TTL 后移除记录

## 删除/取消一致性

- 删除 item 时：
  1. 立即从 UI 移除
  2. 后台触发 `cancel(itemId)`
  3. 若正在执行，尽快中止并清理向量
  4. 从 `knowledge_item` 删除记录
- 取消不需要 UI 状态展示，仅用于后台止损。

## 失败与重试

- 读取失败：直接 `failed`
- Embedding 失败：可配置有限重试（建议轻量退避）
- 用户可通过 `reprocess` 重新入队

## 批量创建与部分失败

### 批量创建 items

批量创建时，部分 item 可能因路径无效、权限问题等原因创建失败。采用**部分成功**策略：

- 成功的 item 正常入队
- 失败的 item 返回错误列表
- API 响应格式：`{ created: [...], failed: [{ path, error }] }`

### Directory 类型部分失败（待定）

一个 directory 类型的 item 中，某些子文件可能处理失败。处理策略待定，可能的方案：

- 整个 item 标记为 `completed` 或新增 `partial` 状态
- 在 item 的 `error` 或 `warnings` 字段记录失败的子文件列表
- 用户可通过 `reprocess` 重试

## 推荐默认参数

- 全局并发：4
- 每库并发：2
- IO 并发：2–3
- Embedding 并发：2–4
- 写入并发：2

## DataApi 端点（v2）

遵循 `docs/en/references/data/api-design-guidelines.md` 的 REST 规范。

| Path                             | Method | 说明                            |
| -------------------------------- | ------ | ------------------------------- |
| `/knowledge-bases/:id/items`     | POST   | 创建 items 并入队（单个或批量） |
| `/knowledge-items/:id/reprocess` | POST   | 重新处理并入队                  |
| `/knowledge-items/:id`           | GET    | 获取 item 详情、状态与 progress |
| `/knowledge-bases/:id/items`     | GET    | 查询 items 列表                 |

## 轮询策略（渲染端）

- 初次加载同步一次 `GET /knowledge-bases/:id/items`
- 存在 `pending` / `preprocessing` / `embedding` 状态时，每 5 秒轮询一次
- 全部完成后停止轮询

## 验收标准

- 批量添加 100 个文件：任务分配稳定，UI 有进度，不卡死
- 删除正在处理的 item：后台停止并清理向量
- 大文件/目录处理：无明显内存爆涨或 UI 卡死

## 相关文档

- `v2-refactor-temp/docs/knowledge/knowledge-data-api.md`
- `docs/en/references/data/README.md`
