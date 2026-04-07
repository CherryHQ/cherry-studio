# 知识库后端已确认决策

本文档只记录当前已经确认的后端分层、调用边界和 runtime 编排约束，不记录未定方案。

本轮调整的核心方向是：

1. 保留 `KnowledgeBaseService` / `KnowledgeItemService` 作为 data 面能力
2. 将知识库 runtime/vector 侧能力收口到一个更薄的 `KnowledgeService`
3. 使用 `p-queue` 作为并发控制原语
4. 不再维护一套自定义的 `TaskService + ExecutionService + round-robin scheduler`

这里的重点不是“代码更少”，而是“让 runtime 编排更简单，同时保留必要的状态语义和失败补偿”。

## 0. 当前架构图

```text
+----------------------------------------------------------------------------------+
|                                   Callers                                        |
|                                                                                  |
|   UI (Data API / main call)        Tool / CLI / API Gateway                      |
+------------------------------------------+---------------------------------------+
                                           |
                    +--------------------------+     +-----------------------------+
                    |       Data API           |     |      KnowledgeService       |
                    |  knowledge handlers      |     |   runtime / vector facade   |
                    +-------------+------------+     +---------------+-------------+
                                  |                                  |
                                  v                                  v
                    +--------------------------+          +---------------------------+
                    |   KnowledgeBaseService   |          | reader / chunk / embed / |
                    |   base data logic        |          | vectorstore helper chain  |
                    +-------------+------------+          +-------------+-------------+
                                  |                                  |
                                  v                                  v
                    +--------------------------+          +---------------------------+
                    |   KnowledgeItemService   |          |   p-queue based runtime   |
                    |   item data + status     |          |   queue + status updates  |
                    +-------------+------------+          +-------------+-------------+
                                  |                                  |
                                  v                                  v
                        +----------------------+              +------------------------+
                        |   SQLite / Drizzle   |              |  LibSQL / VectorStores |
                        +----------------------+              +------------------------+
```

当前 UI 双轨调用：

1. UI -> Data API -> `KnowledgeBaseService` / `KnowledgeItemService`
2. UI -> main-side call -> `KnowledgeService`

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

Data API 是接口适配层。

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

## 4. `KnowledgeService` 的定位

`KnowledgeService` 是知识库 runtime/vector 侧的单一 facade。

它负责：

1. runtime 侧入口方法
2. item 级索引任务编排
3. `knowledge_item.status` 的推进与错误写回
4. reader / chunk / embedding / vectorstore helper 的调用串联
5. 检索入口

它不负责：

1. `knowledge_base` / `knowledge_item` 的业务主数据 CRUD
2. 引入独立的持久化任务表
3. 暴露调度器内部概念给调用方

因此：

1. `KnowledgeBaseService` / `KnowledgeItemService` 负责 data 面
2. `KnowledgeService` 负责 runtime/vector 面

它属于 main service，不属于 data service。

## 5. 为什么不用 `KnowledgeTaskService + KnowledgeExecutionService`

本轮明确不再把 runtime 编排拆成：

1. 一个 lifecycle task scheduler
2. 一个 stage executor
3. 一套自定义 round-robin / waiting timer / next-task 协议

原因不是这些能力永远不需要，而是当前知识库索引链路还不值得为它们维护一整套专有调度框架。

当前更合适的收敛方式是：

1. 用一个更薄的 `KnowledgeService` 承接 runtime 入口
2. 用若干 helper 模块承接 reader / chunk / embed / vectorstore 细节
3. 用 `p-queue` 解决大部分并发约束

这里的决策是：

1. `p-queue` 是并发控制原语，不是新的业务边界
2. helper 可以继续拆，但调度层先不拆成多个 service
3. 如果未来真的出现独立进程执行、远程 file processing 编排、恢复策略显著变复杂，再评估是否重新抽象更重的执行层

## 6. `p-queue` 编排模型

### 6.1 总原则

我们接受 runtime 编排简化，但不接受因为“实现简单”而丢掉以下语义：

1. item 状态可观测
2. 失败可落库
3. 中断有补偿
4. 单库处理顺序可控
5. 内部 fan-out 不得绕过并发控制

### 6.2 队列归属

`KnowledgeService` 持有知识库 runtime queue。

当前确认的实现约束：

1. queue 为 in-memory best-effort queue
2. queue 不单独持久化到数据库
3. queue 的存在是 runtime 实现细节，不进入对外数据模型

### 6.3 并发模型

并发模型不再使用自定义 round-robin scheduler。

当前推荐模型：

1. 每个 knowledge base 一条串行 queue
2. 单库默认 `concurrency = 1`
3. 如果需要额外限制跨库总吞吐，可在外层再叠加一个小的全局 limiter

也就是说：

1. “单库串行”是知识库 runtime 的核心约束
2. “跨库可并行”是可选能力
3. 不推荐只保留一个全局大 queue 然后把所有 item 混在一起跑

原因：

1. 单库串行可以避免同库 item 互相抢占写入时序
2. 不同库之间是否并行，应由一个简单的全局上限控制
3. 这样比自定义 round-robin 简单，但仍保留关键隔离性

### 6.4 任务粒度

队列粒度为 item 级。

一个 `knowledge_item` 的一次索引流程是一个 queue task。

当前明确不做：

1. chunk 级任务
2. 单独的调度记录对象暴露给外部
3. `completed / failed / next` 这类内部任务协议作为稳定公共抽象

### 6.5 执行链路

当前 item 级执行链路为：

```text
enqueue item
 -> load source documents
 -> optional file-processing handling
 -> chunk
 -> embed
 -> vector add
 -> persist completed / failed
```

这条链路放在 `KnowledgeService` 内部编排。

reader / chunk / embed / vectorstore 只是 helper，不是调度边界。

### 6.6 状态推进责任

虽然 runtime 编排收口到一个 service，但 `knowledge_item.status` 仍然是正式业务状态，不是可省略细节。

当前确认：

1. 入队前或入队时写 `pending`
2. 进入 file processing 阶段时写 `file_processing`
3. 进入读取或切块阶段时可写 `read`
4. 进入 embedding / vector write 阶段时写 `embed`
5. 成功结束写 `completed`
6. 任意异常统一写 `failed`
7. `error` 字段记录最终失败原因

结论：

1. queue 可以简化
2. 状态语义不能被 queue 简化掉

### 6.7 中断与恢复策略

当前确认的策略是：

1. queue 为内存态
2. 不做持久化任务恢复
3. 但必须做中断补偿

因此：

1. 启动时扫描中间状态并标记为 `failed`
2. 停止时将未完成任务标记为 `failed`
3. 写入明确中断原因

当前不做：

1. 任务续跑
2. 持久化任务队列
3. 自动重试

### 6.8 fan-out 与内部并发

`p-queue` 只在外层控制 item 并发还不够。

对以下场景必须继续限制内部 fan-out：

1. sitemap 展开后抓取多个 URL
2. directory 展开后读取多个文件
3. file processor 的轮询或批量远程请求

明确要求：

1. 内部不得无边界 `Promise.all`
2. 内部 fan-out 需要复用同一个 limiter，或使用独立但有上限的小 queue
3. 不允许出现“外层 queue 很保守，内层 reader 一次打爆网络/CPU”的实现

### 6.9 生命周期边界

`KnowledgeService` 不一定必须成为复杂 lifecycle scheduler，但需要具备最小可管理性：

1. 初始化时完成中断状态清理
2. 停止时尽量停止新任务进入
3. 停止时对未完成 item 写失败状态

如果后续它正式接入 lifecycle system，应把这些行为挂到明确的 `onInit` / `onStop` 钩子中。

## 7. Helper 边界

为了保持 `KnowledgeService` 简单，helper 继续保留，但它们的边界要更明确。

### 7.1 Reader

reader 负责 source -> `Document[]` 的适配。

reader 不负责：

1. 调度
2. item 状态推进
3. 任务恢复

### 7.2 Chunk / Embed

`chunkDocuments` / `embedDocuments` 是纯执行 helper。

它们负责：

1. 文档切块
2. embedding 计算
3. node 构造

它们不负责：

1. queue
2. status
3. storage lifecycle

### 7.3 VectorStoreManager

`VectorStoreManager` 负责 runtime vector store 的最小缓存与复用。

它负责：

1. 按 base 获取 store
2. 释放或删除 store

它不负责：

1. item 调度
2. 状态推进
3. 索引任务重试

## 8. 当前确认的调用边界

### UI

```text
UI
 |
 +--> Data API -> knowledge handler -> KnowledgeBaseService / KnowledgeItemService
 |
 \--> main-side invocation -> KnowledgeService
```

### Tool / CLI / API Gateway

```text
Tool / CLI / API Gateway
 |
 +--> KnowledgeBaseService / KnowledgeItemService
 |
 \--> KnowledgeService
```

## 9. 当前明确不做的内容

当前不做：

1. 自定义 round-robin scheduler
2. 独立的 `KnowledgeTaskService`
3. 独立的 `KnowledgeExecutionService`
4. 持久化任务队列
5. 自动恢复执行中的任务
6. chunk 级 queue
7. 优先级队列
8. 暂停 / 恢复
9. 为每个 knowledge base 创建一个独立 service 实例

## 10. 当前不写入本文档的内容

以下内容当前未在本文档中展开：

1. 最终 facade 的完整公共方法集合
2. UI 是否长期保留两条调用分支
3. 哪些具体 handler 最终会走 Data API，哪些会直调 main service
4. 最终 retrieval / rerank API 细节
5. 是否引入远程 file processing provider 的正式 provider 抽象

这些内容待进一步收敛后再单独记录。
