# Knowledge 队列与调度系统设计（v2 后端）

本设计将知识库入队与调度完全放在主进程，通过 DataApi 对外提供 CRUD 与状态查询。渲染端只发起请求并显示整体进度（单一百分比），同时兼顾多类型 item、一致的取消/删除和跨库公平调度。

## 快速导航

### 系统概览

- [总体架构](#总体架构)
- [核心抽象](#核心抽象)
- [调度策略](#调度策略)

### 运行规则

- [处理流水线](#处理流水线统一类型)
- [目录处理策略](#目录处理策略)
- [进度与状态](#进度与状态)
- [删除取消一致性](#删除取消一致性)
- [失败与重试策略](#失败与重试策略)

### API 与运行

- [DataApi 端点](#dataapi-端点v2)
- [返回结构与合并规则](#dataapi-返回结构与合并规则)
- [孤儿任务恢复](#孤儿任务恢复)
- [轮询策略](#轮询策略渲染端)

### 其他

- [推荐默认参数](#推荐默认参数)
- [验收标准](#验收标准)
- [相关文档](#相关文档)

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
- UI 不暴露“取消按钮”，取消由删除或 reprocess 触发
- 编辑知识库配置会触发迁移/备份，但不影响当前队列（参考 `src/renderer/src/pages/knowledge/components/EditKnowledgeBasePopup.tsx`）
- 取消机制使用 `AbortController` 中止正在进行的 IO / Embedding 请求
- 孤儿任务由用户在 UI 侧手动恢复（详见“孤儿任务恢复”）

## 总体架构

```
Renderer
  └─ DataApi 请求 (create/reprocess/delete/list)
       │
       ▼
Main Process
  ├─ KnowledgeItemService (CRUD + 状态更新)
  ├─ KnowledgeOrchestrator (协调层 - 状态管理)
  ├─ KnowledgeQueueManager (全局/每库调度)
  ├─ KnowledgeProcessor (处理层 - OCR/Read/Embed)
  ├─ KnowledgeServiceV2 (存储层 - 向量操作)
  ├─ SQLite (knowledge_item)
  └─ Vector Store (LibSQL)
       ▲
       └─ Progress 通过 DataApi 查询/轮询返回
```

## 核心抽象

- **Job**：以 item 为单位的任务载体
  `{ baseId, itemId, type, createdAt }`
- **Stage**：内部执行阶段
  `ocr -> read -> embed`
  对外状态使用 `ItemStatus`（`idle` | `pending` | `ocr` | `read` | `embed` | `completed` | `failed`）
- **QueueManager**：全局队列 + 每库子队列 + 资源池并发限制

## 调度策略

1. **全局在途上限**：限制已启动但未完成的任务数量，防止内存/排队膨胀
2. **每库并发上限**：防止某个知识库占满资源
3. **轮询公平**：按 baseId 轮询从子队列取任务（Round-robin）
4. **阶段并发分离**：OCR、IO（读取）、Embedding 各自有并发上限
5. **背压**：阶段资源耗尽时任务停留在队列中，避免 IO/Embedding 堵死

### 队列管理器接口

```ts
export type KnowledgeStage = "ocr" | "read" | "embed";

export type KnowledgeJob = {
  baseId: string;
  itemId: string;
  type?: KnowledgeItemType;
  createdAt: number;
};

export type SchedulerConfig = {
  globalConcurrency: number;
  perBaseConcurrency: number;
  ocrConcurrency: number;
  ioConcurrency: number;
  embeddingConcurrency: number;
  maxQueueSize?: number;
};

export interface KnowledgeQueueManager {
  enqueue<T>(job: KnowledgeJob, task: KnowledgeJobTask<T>): Promise<T>;
  cancel(itemId: string): { status: "cancelled" | "ignored" };
  isQueued(itemId: string): boolean;
  isProcessing(itemId: string): boolean;
  getStatus(): {
    queueSize: number;
    processingCount: number;
    perBaseQueue: Record<string, number>;
  };
  getProgress(itemId: string): number | undefined;
  updateProgress(itemId: string, progress: number): void;
}
```

### 核心数据结构

- `baseQueues: Map<baseId, Deque<Job>>`：库内 FIFO
- `baseOrder: string[] + cursor`：跨库轮询
- `activeByBase: Map<baseId, number>` 与 `activeGlobal: number`：在途任务计数
- `jobs: Map<itemId, Job>`：去重、取消索引

### 并发与阶段池

- 任务管线：`ocr` 占用 OCR 池 → `read` 占用 IO 池 → `embed` 占用 Embedding 池，阶段完成即释放
- `globalConcurrency` 用于限制"已启动但未完成"的任务总数，阶段池决定实际并发
- `globalConcurrency` 过低会导致阶段池空转；过高会造成等待积压
- 三个并发池独立控制：
  - **OCR Pool** (`ocrConcurrency: 2`)：文档预处理
  - **IO Pool** (`ioConcurrency: 3`)：内容读取与分块
  - **Embedding Pool** (`embeddingConcurrency: 3`)：向量嵌入与存储

## 处理流水线（统一类型）

1. **入队**：`POST /knowledge-bases/:id/items` 创建记录，`status=pending`，入队
2. **OCR/预处理**：文档预处理阶段（PDF 解析等），`status=ocr`
3. **读取与分块**：`KnowledgeProcessor` 通过 reader 将任意类型转换为 nodes，`status=read`
4. **嵌入与存储**：批次 embedding 并写入 LibSQL 向量库，`status=embed`
5. **完成/失败**：`status=completed | failed`，`error` 写入 DB

## 目录处理策略

### 数据模型

用户选择目录后，系统会扫描目录中的文件，为每个文件创建独立的 `type: 'directory'` item，通过 `groupId` 关联：

```ts
{ id: "item-1", type: "directory", data: { groupId: "grp-xxx", groupName: "/docs", file: { name: "readme.md" } } }
{ id: "item-2", type: "directory", data: { groupId: "grp-xxx", groupName: "/docs", file: { name: "guide.md" } } }
```

### 读取约束

- 仅允许添加**最后一级目录**（不递归子目录）
- 读取时**忽略子目录**，只处理当前目录中的文件
- 若包含子目录：不报错，不深入读取

### 优势

- **独立处理**：每个文件独立入队、独立处理、独立显示进度
- **单独 reprocess**：失败的文件可单独重试，无需重新处理整个目录
- **复用逻辑**：处理流程与 `file` 类型一致
- **UI 分组**：通过 `groupId` 分组，用 accordion 展示

## 进度与状态

- **单一百分比**：UI 只显示 0–100%，不区分阶段文本
- **权重合成**：`ocr+read 60%`，`embed 40%`（可配置）
- **进度读取**：`GET /knowledge-items/:id` 返回 `progress`（仅内存维护，不落库）
- **阶段映射**：
  - `ocr` → `ItemStatus=ocr`（文档预处理）
  - `read` → `ItemStatus=read`（内容读取与分块）
  - `embed` → `ItemStatus=embed`（向量嵌入与存储）
  - 完成 → `completed`
  - 中止/错误 → `failed`（记录 error）
- **进度存储**：主进程内存 `ProgressTracker`（例如 `Map<itemId, number>`），短 TTL 清理
- **更新节奏**：
  - 阶段切换更新 DB 状态与进度阈值
  - 批次完成更新内存进度（建议 300ms 节流）
  - 完成时强制为 `100`

```ts
import { throttle } from "lodash";

const updateProgress = throttle((itemId: string, progress: number) => {
  progressTracker.set(itemId, progress);
}, 300);
```

## 删除/取消一致性

- 删除 item 时：
  1. 将 itemId 放入内存 `DeletionTracker`，`deleting=true` 对外可见
  2. 后台触发 `cancel(itemId)`
  3. 若正在执行，尽快中止并清理向量
  4. 清理完成后从 `knowledge_item` 删除记录，并移除 `DeletionTracker`
- `DeletionTracker` 仅内存维护，不落库
- 取消不需要单独 UI 状态展示，仅用于后台止损

## 失败与重试策略

### 错误分类

- **永久性错误（不重试）**：文件不存在、权限不足、格式不支持、URL 无效
- **短暂错误（可重试）**：Embedding API 429/5xx/超时，libsql 写入短暂失败
- **取消/删除（不重试）**：`signal.aborted` 或 `deleting=true` 时立即退出

### 重试策略（建议默认）

- **Embedding**：最多 2–3 次，指数退避 + 抖动（`base=500ms, factor=2, max=10s`）
- **写入向量库**：最多 2 次（`SQLITE_BUSY` / 临时连接错误）
- **读取阶段**：默认不重试（除非短暂 IO 错误）

### 批次失败处理

- 单批失败 → 按重试策略重试该批
- 仍失败 → 标记 item 为 `failed`
- 若已写入部分向量，失败时执行 `remove({ externalId: itemId })` 清理残留

### reprocess 语义

- 重试前先 `cancel(itemId)`
- 清理向量（externalId）
- 状态重置为 `pending`，进度置 0，重新入队

## 批量创建与部分失败

- 成功的 item 正常入队，失败的 item 返回错误列表
- API 响应格式：`{ created: [...], failed: [{ path, error }] }`

## 孤儿任务恢复

### 定义

**孤儿任务**：应用崩溃或关闭时处于 `pending`/`ocr`/`read`/`embed` 的任务；重启后 DB 仍为中间态，但内存队列中无对应任务。

### 检测机制

主进程维护 `activeJobs: Set<itemId>`，用于判定是否为孤儿任务。

```ts
const isOrphan = (item: KnowledgeItem): boolean => {
  const incompleteStatuses = ["pending", "ocr", "read", "embed"];
  return incompleteStatuses.includes(item.status) && !activeJobs.has(item.id);
};
```

### API 端点

| Path                                 | Method | 说明                                             |
| ------------------------------------ | ------ | ------------------------------------------------ |
| `/knowledge-bases/:id/queue`         | GET    | 获取指定知识库的队列状态（含孤儿任务、活跃任务） |
| `/knowledge-bases/:id/queue/recover` | POST   | 恢复指定知识库的孤儿任务（重新入队）             |
| `/knowledge-bases/:id/queue/ignore`  | POST   | 忽略指定知识库的孤儿任务（标记为 failed）        |

### UI 交互

- 位置：知识库详情页顶部 Banner
- 触发：检测到当前知识库存在孤儿任务
- 文案：`"检测到 N 个未完成的任务，是否恢复？"` + `[恢复] [忽略]`
- 恢复：调用 `POST /knowledge-bases/:id/queue/recover`
- 忽略：将孤儿任务标记为 `failed`（可选：新增 `interrupted` 状态）

## DataApi 端点（v2）

遵循 `docs/en/references/data/api-design-guidelines.md` 的 REST 规范。

| Path                                 | Method | 说明                                 |
| ------------------------------------ | ------ | ------------------------------------ |
| `/knowledge-bases/:id/items`         | POST   | 创建 items 并入队（单个或批量）      |
| `/knowledge-items/:id/reprocess`     | POST   | 重新处理并入队                       |
| `/knowledge-items/:id`               | GET    | 获取 item 详情、状态与 progress      |
| `/knowledge-bases/:id/items`         | GET    | 查询 items 列表                      |
| `/knowledge-bases/:id/queue`         | GET    | 获取该知识库的队列状态（含孤儿任务） |
| `/knowledge-bases/:id/queue/recover` | POST   | 恢复该知识库的孤儿任务               |
| `/knowledge-bases/:id/queue/ignore`  | POST   | 忽略该知识库的孤儿任务               |

## DataApi 返回结构与合并规则

### 单个 item 返回

`GET /knowledge-items/:id` 返回 `KnowledgeItem` + `progress` + `deleting` 字段：

```json
{
  "id": "...",
  "baseId": "...",
  "type": "file",
  "status": "embed",
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
- 存在 `pending` / `ocr` / `read` / `embed` 状态时，每 500ms 轮询一次
- 全部完成后停止轮询

## 推荐默认参数

- 全局并发：4
- 每库并发：2
- OCR 并发：2
- IO 并发：3
- Embedding 并发：3

## 验收标准

- 批量添加 100 个文件：任务分配稳定，UI 有进度，不卡死
- 删除正在处理的 item：后台停止并清理向量
- 大文件/目录处理：无明显内存爆涨或 UI 卡死

## 相关文档

- `v2-refactor-temp/docs/knowledge/knowledge-data-api.md`
- `docs/en/references/data/README.md`
