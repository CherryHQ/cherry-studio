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
- 编辑知识库配置会触发迁移/备份，但不影响当前队列（参考 `src/renderer/src/pages/knowledge/components/EditKnowledgeBasePopup.tsx`）
- **孤儿状态处理**：不自动清理，由用户通过 UI 手动恢复（详见"孤儿任务恢复"章节）
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
- directory：与 file 相同，按 `file.size` 估算（每个文件独立 item）
- url/note/sitemap：按字符长度估算
- 不改变 FIFO，仅用于后续扩展（如大任务降并发/配额）

### 取消与去重

- 若 `itemId` 已存在于 `jobs`，拒绝或忽略入队
- 建议在 DataApi 层也做同一 `itemId` 的去重（双层防重）
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

## 目录处理策略

### 数据模型

用户选择目录后，系统会扫描目录中的文件，为每个文件创建独立的 `type: 'directory'` item，通过 `groupId` 关联：

```ts
// 用户选择目录 /docs（包含 3 个文件）→ 创建 3 个 items
{ id: 'item-1', type: 'directory', data: { groupId: 'grp-xxx', groupName: '/docs', file: { name: 'readme.md', ... } } }
{ id: 'item-2', type: 'directory', data: { groupId: 'grp-xxx', groupName: '/docs', file: { name: 'guide.md', ... } } }
{ id: 'item-3', type: 'directory', data: { groupId: 'grp-xxx', groupName: '/docs', file: { name: 'api.md', ... } } }
```

### 读取约束

- 仅允许添加**最后一级目录**（不递归子目录）
- 读取时**忽略子目录**，只处理当前目录中的文件
- 若包含子目录：不报错，不深入读取

### 优势

- **独立处理**：每个文件独立入队、独立处理、独立显示进度
- **单独 reprocess**：失败的文件可单独重试，无需重新处理整个目录
- **复用逻辑**：处理流程与 `file` 类型一致（都有 `FileMetadata`）
- **UI 分组**：通过 `groupId` 分组，用 accordion 展示

## 进度设计（整体百分比）

- **单一百分比**：UI 只显示 0–100%，不区分阶段文本。
- **权重合成**：
  `read+chunk 60%`，`embed+write 40%`（可配置）
- **所有类型统一**：read 阶段快速推进到 60%；embed/write 使用批次进度补齐到 100%。
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
  - 批次完成更新内存进度（使用 `lodash.throttle`，建议 300ms）
  - 完成时进度强制为 `100`，并在短 TTL 后移除记录

```ts
import { throttle } from 'lodash'

// 进度更新节流，300ms 内最多触发一次
const updateProgress = throttle((itemId: string, progress: number) => {
  progressTracker.set(itemId, progress)
}, 300)
```

## 删除/取消一致性

- 删除 item 时：
  1. 将 itemId 放入内存 `DeletionTracker`，`deleting=true` 对外可见
  2. 后台触发 `cancel(itemId)`
  3. 若正在执行，尽快中止并清理向量
  4. 清理完成后从 `knowledge_item` 删除记录，并移除 `DeletionTracker`
- `DeletionTracker` 仅内存维护，不落库；多窗口通过 DataApi 统一展示“删除中”
- 取消不需要单独 UI 状态展示，仅用于后台止损。

## 失败与重试策略

### 错误分类

- **永久性错误（不重试）**
  - 文件不存在、权限不足、格式不支持、URL 无效
  - 直接 `status=failed`，记录明确 `error`
- **短暂错误（可重试）**
  - Embedding API 429/5xx/超时
  - libsql 写入短暂失败（锁、busy、连接抖动）
- **取消/删除（不重试）**
  - `signal.aborted` 或 `deleting=true` 时立即退出，不做重试

### 重试策略（建议默认）

- **Embedding**：最多 2–3 次
  - 指数退避 + 抖动：`base=500ms, factor=2, max=10s`
  - 若响应包含 `Retry-After`，优先使用
- **写入向量库**：最多 2 次
  - 适用错误：`SQLITE_BUSY` / 临时连接错误
- **读取阶段**：默认不重试（除非是短暂 IO 错误）

### 批次失败处理

- **Embedding/写入按批次**
  - 单批失败 → 按重试策略重试该批
  - 仍失败 → 标记 item 为 `failed`
- **部分写入的处理**
  - 若已写入部分向量，失败时执行 `remove({ externalId: itemId })` 清理残留
  - 下次 `reprocess` 前也会先清理，确保幂等

### 状态与进度

- **失败**：`status=failed`，`error` 写入 DB
- **取消**：`status=failed` + `error="Cancelled"`（仅用于日志）
- **进度**：失败时保留最后进度（若希望清零可统一设为 0）

### reprocess 语义

- 重试前先 `cancel(itemId)`
- 清理向量（externalId）
- 状态重置为 `pending`，进度置 0，重新入队

## Workload 估算与限流策略

### 目标

- 用“估算成本”控制调度公平与资源使用，避免超大任务拖垮系统
- 不改变“库内 FIFO”，只在资源占用上做限制

### Workload 估算规则

- **file**：使用 `file.size`（字节）
- **directory**：与 file 相同，使用 `data.file.size`（每个文件独立 item）
- **url / note / sitemap**：按字符长度估算
  - `workload = textLength / 2`（近似字节）

### 分级限流策略

- **全局并发**：控制总任务数
- **每库并发**：控制单库吞吐
- **阶段并发**：IO / Embed / Write 资源池
- **大任务降并发**（可选扩展）：当 workload 超过阈值时，降低该任务的并发权重

### 批次 embedding 与写入

- embed/write 采用批次处理，批次大小默认 100–200 nodes
- 每批完成更新进度，减少单次内存占用

### 异常与上限

- 单任务节点数过大（例如 > 50k）时强制拆批
- 队列超过 `maxQueueSize` 时拒绝新任务并返回错误
- 单任务最大文件大小可设软阈值（提示用户而非硬拒绝）

## 批量创建与部分失败

### 批量创建 items

批量创建时，部分 item 可能因路径无效、权限问题等原因创建失败。采用**部分成功**策略：

- 成功的 item 正常入队
- 失败的 item 返回错误列表
- API 响应格式：`{ created: [...], failed: [{ path, error }] }`

### 目录批量创建

用户选择目录后，系统扫描目录中的文件，为每个文件创建独立的 `type: 'directory'` item：

- 扫描阶段若某文件无法访问，该文件记入 `failed` 列表
- 成功扫描的文件各自创建 item 并入队
- 每个 item 独立处理，失败不影响其他文件
- 用户可单独 reprocess 失败的文件

## 推荐默认参数

- 全局并发：4
- 每库并发：2
- IO 并发：2–3
- Embedding 并发：2–4
- 写入并发：2

## 孤儿任务恢复

### 定义

**孤儿任务**：应用崩溃或关闭时，正处于中间状态（`preprocessing`/`embedding`）但未完成的任务。这些任务在数据库中状态为中间态，但内存队列中没有对应的任务在处理它们。

### 产生原因

1. 任务开始处理 → 状态写入 DB 为 `preprocessing`/`embedding`
2. 应用崩溃/关闭 → 内存队列丢失
3. 重启后 → DB 中状态仍是中间态，但没有对应的内存任务在处理

### 检测机制

主进程维护 `activeJobs: Set<itemId>`，记录当前队列中正在处理或等待处理的任务。

```ts
// 判断是否为孤儿任务
const isOrphan = (item: KnowledgeItem): boolean => {
  const incompleteStatuses = ['pending', 'preprocessing', 'embedding']
  return incompleteStatuses.includes(item.status) && !activeJobs.has(item.id)
}
```

### API 端点

| Path                                 | Method | 说明                                             |
| ------------------------------------ | ------ | ------------------------------------------------ |
| `/knowledge-bases/:id/queue`         | GET    | 获取指定知识库的队列状态（含孤儿任务、活跃任务） |
| `/knowledge-bases/:id/queue/recover` | POST   | 恢复指定知识库的孤儿任务（重新入队）             |

### UI 交互

- **位置**：知识库详情页顶部
- **触发条件**：检测到当前知识库存在孤儿任务时显示 Banner
- **文案**：`"检测到 N 个未完成的任务，是否恢复？"` + `[恢复]` `[忽略]`
- **恢复行为**：调用 `POST /knowledge-queue/recover`，将孤儿任务重新入队
- **忽略行为**：将孤儿任务标记为 `failed`（可选：新增 `interrupted` 状态）

### 前端实现示例

```tsx
// KnowledgeContent.tsx
const { items } = useKnowledgeItems(baseId)
const { data: queueStatus } = useBaseQueueStatus(baseId)  // 直接获取该知识库的队列状态

{queueStatus?.orphanItemIds.length > 0 && (
  <RecoverBanner
    count={queueStatus.orphanItemIds.length}
    onRecover={() => recoverMutation.mutate()}  // 无需传 baseId，端点已包含
    onDismiss={() => dismissOrphans(queueStatus.orphanItemIds)}
  />
)}
```

## DataApi 端点（v2）

遵循 `docs/en/references/data/api-design-guidelines.md` 的 REST 规范。

| Path                             | Method | 说明                            |
| -------------------------------- | ------ | ------------------------------- |
| `/knowledge-bases/:id/items`     | POST   | 创建 items 并入队（单个或批量） |
| `/knowledge-items/:id/reprocess` | POST   | 重新处理并入队                  |
| `/knowledge-items/:id`           | GET    | 获取 item 详情、状态与 progress |
| `/knowledge-bases/:id/items`         | GET    | 查询 items 列表                       |
| `/knowledge-bases/:id/queue`         | GET    | 获取该知识库的队列状态（含孤儿任务）  |
| `/knowledge-bases/:id/queue/recover` | POST   | 恢复该知识库的孤儿任务                |

## DataApi 返回结构细化

### 单个 item 返回

`GET /knowledge-items/:id` 返回 `KnowledgeItem` + `progress` + `deleting` 字段：

```json
{
  "id": "...",
  "baseId": "...",
  "type": "file",
  "status": "embedding",
  "error": null,
  "createdAt": "...",
  "updatedAt": "...",
  "progress": 72,
  "deleting": false
}
```

### 进度合并规则

- 若内存 `ProgressTracker` 有记录 → 返回该值（限制在 0–100）
- 否则：
  - `status = completed` → `progress = 100`
  - 其他状态 → `progress = 0`
- 若需要保留失败前进度，可保留短 TTL（1–5 分钟）

### 删除标记合并规则

- 若内存 `DeletionTracker` 有记录 → `deleting = true`
- 否则 → `deleting = false`

### 列表接口

- `GET /knowledge-bases/:id/items` 建议默认返回 `progress`
- 若担心负载，可增加 `?includeProgress=true` 控制

### 一致性约定

- 进度单调递增
- 状态更新优先于进度更新
- 进入 `completed` 时强制 `progress = 100`
- `deleting = true` 时 UI 优先展示“删除中”，不再展示进度

## 轮询策略（渲染端）

- 初次加载同步一次 `GET /knowledge-bases/:id/items`
- 存在 `pending` / `preprocessing` / `embedding` 状态时，每 5 秒轮询一次
- 全部完成后停止轮询

## 验收标准

- 批量添加 100 个文件：任务分配稳定，UI 有进度，不卡死
- 删除正在处理的 item：后台停止并清理向量
- 大文件/目录处理：无明显内存爆涨或 UI 卡死

## 后续扩展（暂不实现）

- Provider 级限流（按 provider/model 维度的并发或 QPS 控制）

## 相关文档

- `v2-refactor-temp/docs/knowledge/knowledge-data-api.md`
- `docs/en/references/data/README.md`
