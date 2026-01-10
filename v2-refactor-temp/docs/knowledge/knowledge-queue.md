# Knowledge 队列系统设计（v2 后端队列）

本方案将知识库嵌入队列从渲染进程与 Redux 迁移到 **主进程 + DataApi** 的后端队列模型。渲染端只发起 DataApi 请求并订阅进度，**不做批量、去重或调度**。

## 目标

- 队列完全由主进程管理，渲染端无调度逻辑
- 使用 DataApi 端点创建/刷新/取消任务
- 通过 DataApi 订阅推送进度，状态仅持久化到 SQLite

## 范围

- **包含**：队列调度、优先级、重试、取消、崩溃恢复、进度推送
- **不包含**：UI 设计、具体实现代码、模型/向量服务细节

## 总体架构

```
Renderer
  └─ DataApi 请求 (create/refresh/cancel)
       │
       ▼
Main Process
  ├─ KnowledgeQueueScheduler
  ├─ TaskExecutor (预处理/分块/嵌入/存储)
  ├─ SQLite (knowledge_base / knowledge_item)
  └─ Vector Store (LibSQL)
       ▲
       └─ DataApi 订阅推送进度/状态
```

## 数据流（核心路径）

1. **创建/批量创建**  
   `POST /knowledge-bases/:id/items` 或  
   `POST /knowledge-bases/:id/items/batch`  
   主进程写入 `knowledge_item`，初始 `status = pending`，并将任务入队。

2. **队列执行**  
   主进程调度器根据优先级与负载执行任务，更新 `status` 并通过订阅推送进度。

3. **完成/失败**  
   `status = completed | failed`，`error` 写入数据库。进度不持久化。

4. **刷新/取消**  
   `POST /knowledge-items/:id/refresh` 重新入队；  
   `POST /knowledge-items/:id/cancel` 取消队列任务。

## DataApi 端点（必须明确）

遵循 `docs/en/references/data/api-design-guidelines.md` 的 REST 规范。

| Path | Method | 说明 |
| ---- | ------ | ---- |
| `/knowledge-bases/:id/items` | POST | 创建单个 item 并入队 |
| `/knowledge-bases/:id/items/batch` | POST | 批量创建 items 并入队 |
| `/knowledge-items/:id/refresh` | POST | 重新处理并入队 |
| `/knowledge-items/:id/cancel` | POST | 取消队列任务 |
| `/knowledge-items/:id` | GET | 获取 item 详情与状态 |
| `/knowledge-bases/:id/items` | GET | 按状态分页查询队列项 |
| `/knowledge-queue/status` | GET | 队列状态（长度/并发/负载，可选） |

> 说明：状态过滤通过 `GET /knowledge-bases/:id/items?status=pending` 等 query 完成。

## 队列调度（主进程职责）

- **优先级**：建议分 `high / normal / low`，由主进程根据来源决定（用户手动添加 > 批量导入 > 重试）。
- **并发与负载**：限制并发数 + 总工作负载（如 80MB）以避免内存峰值。
- **重试策略**：指数退避，最多重试 3 次，且降级为低优先级。
- **取消**：为每个任务分配 `AbortController`，取消后应尽快中止执行。
- **崩溃恢复**：将未完成任务持久化到本地（如 `queue_recovery.json`），重启后恢复入队。

## 状态与进度推送

- **持久化字段**：`status`, `error`（存 SQLite）
- **实时进度**：通过 DataApi 订阅推送，不落库

推荐订阅路径（与 `knowledge-data-api.md` 一致）：

| 订阅 Path | 说明 |
| --------- | ---- |
| `/knowledge-bases/:id/items` | base 下 item 变更与进度 |
| `/knowledge-items/:id` | 单 item 变更与进度 |

事件载荷示例：

```typescript
export interface KnowledgeItemStatusEvent {
  baseId: string
  itemId: string
  status: ItemStatus
  progress?: number
  stage?: 'preprocessing' | 'embedding'
  error?: string
  updatedAt: string
}
```

## 迁移要点（v1 → v2）

- **移除渲染端队列与 Redux**：所有入队/调度/重试全部移至主进程。
- **统一 DataApi 调用**：UI 仅调用上述端点并订阅进度。
- **状态字段对齐**：`knowledge_item.status` 作为唯一持久化状态。
- **历史数据**：复用 `knowledge_item` 表与向量库，不需要额外迁移队列数据。

## 验收标准

- 批量添加 100 个文件：单次批量请求入队，主进程并发处理，无重复提交
- 临时网络故障：指数退避重试后成功或明确失败
- 取消任务：1s 内停止处理并更新状态
- 崩溃恢复：重启后恢复未完成任务并继续处理
- 大文件处理：遵守负载限制，不出现 OOM

## 相关文档

- `v2-refactor-temp/docs/knowledge/knowledge-data-api.md`
- `docs/en/references/data/README.md`
