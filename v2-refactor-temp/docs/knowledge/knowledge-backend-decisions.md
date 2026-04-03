# 知识库后端已确认决策

本文档只记录当前已经确认的后端分层和调用边界，不记录未定方案。

## 0. 当前架构图

```text
+----------------------------------------------------------------------------------+
|                                   Callers                                        |
|                                                                                  |
|   UI (Data API / main call)        Tool / CLI / API Gateway                      |
+------------------------------------------+---------------------------------------+
                                           |
                                           v
+----------------------------------------------------------------------------------+
|                      KnowledgeApplicationService                                  |
|                                                                                  |
|  Public API:                                                                     |
|  - createBase                                                                    |
|  - deleteBase                                                                    |
|  - addItem                                                                       |
|  - deleteItem                                                                    |
|  - search                                                                        |
+-----------------------------+-----------------------------+----------------------+
                              |                             |
                              | data CRUD                   | async addItem
                              v                             v
                 +---------------------------+   +---------------------------+
                 |   KnowledgeBaseService    |   |   KnowledgeTaskService    |
                 |   base data logic         |   |   queue / concurrency     |
                 +-------------+-------------+   +-------------+-------------+
                               |                               |
                               |                               v
                               |                 +---------------------------+
                               |                 | KnowledgeExecutionService |
                               |                 | local execute pipeline    |
                               |                 | future: process-backed    |
                               |                 +-------------+-------------+
                               |                               |
                               v                               v
                 +---------------------------+   +---------------------------+
                 |   KnowledgeItemService    |   |  LibSQL / VectorStores    |
                 |   item data + status      |   +---------------------------+
                 +-------------+-------------+
                               |
                               v
                     +----------------------+
                     |   SQLite / Drizzle   |
                     +----------------------+

addItem flow:

  addItem
    -> KnowledgeApplicationService
    -> KnowledgeItemService.create(status=pending)
    -> KnowledgeTaskService.enqueueMany(...)
    -> KnowledgeExecutionService.execute(task)
```

## 1. Data service 的定位

`src/main/data/services/` 中的 service 负责：

1. 与数据相关的业务逻辑
2. 数据读写和状态变更
3. 对外提供可复用的主进程能力

这些 service 不只给 Data API 使用，也可以给其他主进程业务直接使用。

当前知识库中的：

1. `KnowledgeBaseService`
2. `KnowledgeItemService`

都属于 data services。

## 2. Data API 的定位

Data API 是一层接口适配层。

它可以调用 data service，但不是数据能力的唯一入口。

当前可理解为：

```text
UI -> Data API -> knowledge handler -> data service
```

## 3. Tool / CLI / API Gateway 的调用方式

知识库相关的 tool 是我们自己实现的。

这类 tool 运行在 main 进程，不需要经过 renderer，也不需要额外设计 IPC 转发链路。

因此：

1. tool 可以直接调用主进程中的 service
2. CLI 可以直接调用主进程中的 service
3. API gateway 也可以直接调用主进程中的 service

它们不需要先经过 Data API。

## 4. KnowledgeApplicationService 的定位

`KnowledgeApplicationService` 用于承接知识库中需要编排的能力，例如：

1. `addItem`
2. `search`
3. `deleteItem`

它同样属于主进程中的可直接复用能力。

它属于 main services，不属于 data services。

## 5. KnowledgeTaskService 与 KnowledgeExecutionService

当前阶段：

1. `KnowledgeTaskService` 负责任务队列、并发控制和调度
2. `KnowledgeExecutionService` 负责单个 item 的实际执行流程
3. 当前执行器先采用本地执行

未来：

1. `KnowledgeExecutionService` 可以替换为基于进程管理的执行器
2. `KnowledgeTaskService` 继续保留为统一调度层

## 5.1 KnowledgeExecutionService 设计

### 定位

`KnowledgeExecutionService` 是单个 task 的阶段执行器。

它负责：

1. 执行单个 task 的一个阶段
2. 推进 `knowledge_item.status`
3. 返回下一步执行结果

它不负责：

1. 排队
2. 并发控制
3. round-robin 调度
4. 生命周期清理

### 输入

`KnowledgeExecutionService` 接收完整 task 作为输入。

task 至少包含：

1. `itemId`
2. `baseId`
3. `stage`
4. `readyAt`

### 输出

执行结果固定为三类：

1. `completed`
2. `failed`
3. `next`

其中 `next` 需要返回：

1. 下一阶段 `stage`
2. 下一次可执行时间 `readyAt`

### 当前执行阶段

当前只确认 3 个执行阶段：

1. `file_processing_submit`
2. `file_processing_poll`
3. `embed`

### 各阶段职责

#### `file_processing_submit`

负责：

1. 提交远程 file processing
2. 保存远程 taskId 或必要元数据

成功后进入：

- `file_processing_poll`

#### `file_processing_poll`

负责：

1. 查询远程 file processing 结果

如果远程任务完成：

- 进入 `embed`

如果远程任务未完成：

- 继续进入 `file_processing_poll`
- 并设置新的 `readyAt`

如果远程任务失败：

- 返回 `failed`

#### `embed`

负责完整本地执行链：

1. 读取原始文件或 file-processing 结果
2. reader/loadData
3. chunk
4. embedding
5. 写入 `LibSQL / VectorStores`

成功后：

- 返回 `completed`

失败后：

- 返回 `failed`

### 状态更新责任

`KnowledgeExecutionService` 负责更新 `knowledge_item.status`。

也就是说：

1. 进入哪个阶段，就写哪个阶段状态
2. 成功完成后写 `completed`
3. 失败时写 `failed`

## 6. KnowledgeTaskService 设计

### 6.1 定位

`KnowledgeTaskService` 是 lifecycle service，属于 main services。

它负责：

1. item 级任务入队
2. 任务调度
3. 并发控制
4. 启停时的状态清理

它不负责具体索引执行，执行流程由 `KnowledgeExecutionService` 负责。

### 6.2 任务粒度

任务粒度为 item 级。

一个 `knowledge_item` 对应一个任务上下文。

但调度不是让一个 item 从头到尾一直占用执行槽，而是按阶段推进。

### 6.3 状态与阶段

状态存放在 `knowledge_item.status` 中。

当前确认的阶段模型如下。

普通文件：

```text
pending
 -> embed
 -> completed
```

PDF：

```text
pending
 -> file_processing_submit
 -> file_processing_waiting
 -> file_processing_poll
 -> embed
 -> completed
```

失败：

```text
任意执行阶段 -> failed
```

当前文档中涉及的状态语义：

1. `pending`
2. `file_processing_submit`
3. `file_processing_waiting`
4. `file_processing_poll`
5. `embed`
6. `completed`
7. `failed`

其中：

1. `file_processing_waiting` 不占执行槽
2. 其他执行阶段占执行槽

### 6.4 入队接口

`KnowledgeTaskService` 只保留批量入队接口：

- `enqueueMany`

不单独保留 `enqueue`。

规则：

1. 同一个 item 如果已经处于 pending / running 中，重复入队直接忽略
2. `enqueueMany` 完成后只触发一次调度

### 6.5 内部任务结构

内部任务至少包含以下字段：

1. `itemId`
2. `baseId`
3. `stage`
4. `readyAt`
5. `createdAt`

其中：

1. `stage` 表示当前要执行的阶段
2. `readyAt` 表示任务最早可再次执行的时间

`readyAt` 用于避免 `file_processing_poll` 阶段空转。

### 6.6 并发模型

`KnowledgeTaskService` 使用一个共享实例，不按 knowledge base 创建多个实例。

当前并发控制分为两层：

1. 全局并发上限 `maxConcurrentItems`
2. 单库并发上限 `maxConcurrentPerBase`

建议默认值：

1. `maxConcurrentItems = 3`
2. `maxConcurrentPerBase = 1`

### 6.7 队列与运行态

`KnowledgeTaskService` 内部维护：

1. 按 `baseId` 分组的 pending queue
2. `runningItemIds`
3. `runningCountByBase`
4. `runningGlobalCount`
5. round-robin 调度顺序

### 6.8 调度策略

调度按 `baseId` 分队列管理。

在调度时：

1. 只有全局并发未满时才继续派发
2. 只有当前 base 并发未满时才允许派发该 base 的任务
3. 不同 base 之间采用 round-robin 调度
4. 只有 `readyAt <= now` 的任务才允许执行

`file_processing_poll` 每次只查询一次：

1. 如果远程 file processing 已完成，进入下一阶段
2. 如果未完成，重新放回队尾，并设置新的 `readyAt`

当前不额外引入 waiting 扫描器。

### 6.9 与 KnowledgeExecutionService 的边界

`KnowledgeTaskService` 只负责调度。

`KnowledgeExecutionService` 负责单个 task 的实际执行，包括：

1. `file_processing_submit`
2. `file_processing_poll`
3. `embed`

以及：

1. 推进 `knowledge_item.status`
2. 写入错误信息
3. 返回下一阶段或结束结果

### 6.10 生命周期行为

#### onInit

由于当前不支持任务恢复，启动时需要扫描残留中间状态并统一清理为 `failed`。

包括但不限于：

1. `pending`
2. `file_processing_submit`
3. `file_processing_waiting`
4. `file_processing_poll`
5. `read_chunk`
6. `embed`

#### onStop

关闭时：

1. 队列中未执行的任务标记为 `failed`
2. 正在执行的任务标记为 `failed`
3. 写入明确的中断原因

### 6.11 当前明确不做的内容

当前不做：

1. 任务恢复
2. 自动重试
3. chunk 级任务
4. 优先级队列
5. 持久化任务队列
6. 暂停 / 恢复
7. 每个 knowledge base 一个 task service
8. 单独的 waiting 扫描器

## 7. 当前确认的调用边界

### UI

```text
UI
 |
 +--> Data API -> knowledge handler -> KnowledgeBaseService / KnowledgeItemService
 |
 \--> main-side invocation -> KnowledgeApplicationService
```

### Tool / CLI / API Gateway

```text
Tool / CLI / API Gateway
 |
 +--> KnowledgeBaseService / KnowledgeItemService
 |
 \--> KnowledgeApplicationService
```

## 8. 当前不写入本文档的内容

以下内容当前未在本文档中展开：

1. 最终的最小 facade 公共方法集合
2. UI 是否长期保留两条调用分支
3. 哪些具体 handler 未来一定改为调用 facade
4. 最终的完整知识库总体架构图

这些内容待进一步收敛后再单独记录。
