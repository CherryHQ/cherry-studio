# Knowledge 队列系统设计（v2 后端队列）

本方案将知识库嵌入队列从渲染进程与 Redux 迁移到 **主进程 + DataApi** 的后端队列模型。渲染端只发起 DataApi 请求并通过轮询获取进度，**不做批量、去重或调度**。

## 目标

- 队列完全由主进程管理，渲染端无调度逻辑
- 队列严格按入队顺序（FIFO）处理
- 使用 DataApi 端点创建/刷新/取消任务
- 通过轮询获取进度，状态仅持久化到 SQLite

## 范围

- **包含**：队列调度、取消、状态更新
- **不包含**：UI 设计、具体实现代码、模型/向量服务细节

## 假设

- 队列仅保存在主进程内存，不做 SQLite 持久化
- 重启后队列不会恢复，需用户手动 `refresh` 重新入队
- 暂不考虑崩溃恢复

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
       └─ 渲染端通过轮询 API 获取状态
```

## 数据流（核心路径）

1. **创建/批量创建**  
   `POST /knowledge-bases/:id/items` 或  
   `POST /knowledge-bases/:id/items/batch`  
   主进程写入 `knowledge_item`，初始 `status = pending`，并将任务入队。

2. **队列执行**
   主进程调度器按入队顺序（FIFO）执行任务，更新 `status` 到数据库。

3. **完成/失败**  
   `status = completed | failed`，`error` 写入数据库。进度不持久化。失败需用户手动 `refresh` 重新入队。

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

- **顺序**：严格 FIFO，按入队顺序处理任务。
- **实现**：使用 `p-queue`，队列仅在内存中维护。
- **并发**：当前设定 `concurrency = 1`，确保处理顺序与入队顺序一致。
- **取消**：为每个任务分配 `AbortController`，取消后应尽快中止执行。

## 状态更新机制

- **持久化字段**：`status`, `error`（存 SQLite）
- **状态获取**：渲染端通过轮询 API 获取最新状态，不使用订阅推送

### 轮询策略

- 初始加载时同步一次状态
- 有 `pending` 或 `processing` 状态的 item 时，每 5 秒轮询一次
- 所有任务完成后停止轮询

### 状态字段

```typescript
type ItemStatus = 'idle' | 'pending' | 'preprocessing' | 'embedding' | 'completed' | 'failed'
```

## 迁移要点（v1 → v2）

- **移除渲染端队列与 Redux**：所有入队/调度全部移至主进程。
- **统一 DataApi 调用**：UI 仅调用上述端点并通过轮询获取状态。
- **状态字段对齐**：`knowledge_item.status` 作为唯一持久化状态。
- **历史数据**：复用 `knowledge_item` 表与向量库，不需要额外迁移队列数据。

## 验收标准

- 批量添加 100 个文件：单次批量请求入队，主进程并发处理，无重复提交
- 取消任务：1s 内停止处理并更新状态
- 大文件处理：遵守负载限制，不出现 OOM
- FIFO 顺序：队列严格按入队顺序处理

## 相关文档

- `v2-refactor-temp/docs/knowledge/knowledge-data-api.md`
- `docs/en/references/data/README.md`
