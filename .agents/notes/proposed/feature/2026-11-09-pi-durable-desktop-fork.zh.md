# Agent Note: Pi Durable 桌面分叉共享一个 backend 所有者

Status: proposed

[English](2026-11-09-pi-durable-desktop-fork.md) | 中文

## 问题

Pi Durable 原生支持同一存储中的分叉，但桌面回复没有分叉检查点，driver 也没有实现 fork。只补上该方法，会让两条桌面连接分别打开、关闭同一存储上的 Harness。桌面 gateway 请求头、批准、环境和 behavior 回调目前也都捕获单个产品根会话。

独立的产品会话不要求独立数据库。本方案只替代[历史操作方案](../architecture/2026-11-08-agent-history-operation-boundaries.md)中目标 backend 必须隔离的前提；原生历史、显式所有权、失败处理和保留文件状态等要求继续成立。不新增上游 SDK 行为补丁，也不升级依赖。

## 方案

### 范围

为带新捕获原生检查点的成功 Pi Durable 回复启用现有桌面**分叉对话**操作。分叉谱系复用源 backend，无关根会话继续使用各自已有的 backend。这不是应用级存储迁移。文件回滚和 Pi Durable 的**编辑并重发**不属于本次交付。

现有原生 `Conversation.fork()`／`tx.forkConversation()` 从明确的 entry 创建无任务归属的会话。原生分叉规则保留前缀和历史智能体配置，初始化新的 provider／live 状态，并保留 document 的分叉策略。这些决策继续归 SDK。

### Backend 所有权与根会话隔离

将原生 runtime 的创建和最终关闭从单个 `PiDurableRuntimeConnection` 移到由现有 driver／runtime service 生命周期持有的 backend 资源。每个 backend 只保留一个初始化 Promise 和一个原生所有者，包括并发打开、分叉准备以及关闭后重开。连接借用根会话 handle，只持有自己的观察、产品投影及根会话 host 资源。释放一条连接不能关闭或重配其他连接。最后一次释放等待原生工作、排空观察后关闭 backend 一次；与最终关闭竞争的获取操作，先等关闭完成再重新打开。

不增加通用 runtime manager、第二套 scheduler 或应用级数据库单例。现有 runtime 已支持多个 `open()` 访问；通过 Pi Durable facet 暴露原生 fork，不向 harness-neutral Runtime 契约增加 fork。

按实际原生 conversation 及其归属树分派 host 行为。Gateway 身份、模型参数、trace、用量回调、批准、提问、交互可用性、工作区、skills、MCP 和环境必须解析到正确的产品根会话，即使它是曾经分叉谱系中唯一打开的成员。使用原生公开的环境和 extension 选择 API。不能让最后连接的根会话覆盖共享 provider／extension 注册，也不能将所有根会话送入首条连接的闭包。只有现有单根假设阻碍显式路由时，才修改共享 behavior 的 host 选择。

启用共享 scheduler 前，恢复保留原生工作所需的 host 绑定。关闭根会话不能让活跃工作继续使用已释放的 host 资源；保留的工作继续持有所需所有者，显式用户 Stop 则保持 conversation 范围。Backend 失败要送达所有受影响访问。备份／关闭只等待并关闭共享 backend 一次，不能让某个根会话等待它无关的同级会话停止。

### 检查点与原生分叉

从确认前台完成的同一批原子原生观察中捕获明确的已提交 entry。增加包含 backend、conversation 和 entry 身份的不透明 Pi Durable 检查点；预览内容或 idle 活动不能建立该边界。证据缺失时，保留已完成回答并禁用 Fork。没有这类检查点的已有回复继续不支持分叉。

Driver 校验检查点归属，并通过活跃 backend 所有者调用公开原生 fork。冷操作获取同一 backend 资源，不提交输入，也不为读取／分叉历史而恢复 scheduler；绝不启动竞争的 Harness。返回新 conversation 身份和保留检查点的映射；新产品 context 继续使用原 backend ID。原生数字 ID 不具备全局唯一性，检查点解析必须包含 backend 身份。

保留的早期检查点继续定位同一存储中的原生祖先。源会话可以在选中 entry 后继续追加，这些新 entry 不进入分叉。系统工作区副本仍反映当前文件，普通工作区继续共享；两者都不恢复选中历史 entry 时的文件。

### 发布、失败与删除

复用 `AgentSessionForkOperations` 和 `AgentSessionForkService`，负责工作区准备、源前缀复核以及产品会话／消息／context 的原子发布。在现有操作资源记录中保存已准备的原生 conversation、backend 和操作身份。原生准备结果未确认之前，不发布产品会话。

原生与产品 SQLite 提交无法组成一个事务。发布失败或取消时，不能出现产品分叉半成品，已有源会话和同级会话状态保持不变。已确认但尚无产品绑定的 conversation 保持静默，并可通过记录识别和恢复。Pi Durable 没有公开的 conversation 删除 API；保留这类原生孤儿，不截断原生表、删除共享存储或新增补偿用 SDK 行为。原生提交结果未知时，先根据操作标记核对，再决定是否重新创建。工作区清理仍只删除已证明属于本操作、且尚未发布的文件。

删除或关闭源产品会话只移除其产品资源，不删除分叉仍依赖的共享原生祖先。只要还有 context 引用，就保留 backend。本功能不新增原生历史裁剪策略。

增加 `driver.fork` 不能通过当前共享可用性判断意外启用 Durable 的编辑并重发。该操作在具备独立且经过验证的绑定／发布契约前，继续返回不支持。Claude、Pi 的可用性和已持久化检查点格式保持不变。

### 实现归属

| 所有者 | 修改 |
|---|---|
| `packages/agent-runtime-pi-durable/src/projection.ts`、`runtime.ts` | 已提交完成检查点，以及通过已有所有者提供的类型化原生 fork 访问 |
| `src/main/ai/runtime/piDurable/PiDurableRuntimeDriver.ts`、`PiDurableRuntimeConnection.ts` | Backend 生命周期、根会话访问／host 路由，以及原生 fork／检查点校验 |
| `src/main/ai/runtime/piDurable/durableDesktop.ts`、已有 Pi gateway／behavior host helper | 正确归属 conversation 的 provider、extension、环境、批准和用量 |
| `src/main/ai/agentSession/fork/AgentSessionForkOperations.ts`、`resources.ts` | 原生准备操作身份、核对和产品发布，不删除共享存储 |
| `src/main/ai/agentSession/durableNativeContext.ts`、context／fork service | 恢复原生分叉标记，将原 backend 与新的 conversation／context 一起发布 |
| `src/main/ai/agentSession/fork/historyActions.ts` | 根据证据启用 Fork，继续禁用尚未实现的 Durable 编辑 |

### 交付与验证

先实现原生检查点／fork 访问，再完成 backend／根会话所有权及产品发布，最后接通桌面可用性。所有验收标准都有实际证据之前，文档保持 proposed。使用明确的 package／Main／renderer 测试文件覆盖修改的消费者；广泛测试留给 CI。

在基线 `c8cb24e988482bfee2c4041f11c0bf6400768859` 上，使用当前带既有补丁的 Pi Durable 1.5.0 和真实原生 SQLite，已通过本地公开 API 探针验证同存储分叉、历史 `AgentDoc`、父子独立追加、子会话无任务归属以及关闭后重开。本地产物为 `.context/cherry-electron-dev/durable-fork-native/result.json`。探针没有调用模型，不属于桌面或真实模型验收；不需要新增 SDK 补丁。

## 已考虑的替代方案

- 每个分叉使用独立数据库：会话独立不需要该限制，而且会要求 SDK 新增跨存储历史／document 迁移操作。
- 在源 backend 上打开另一套 Harness：形成竞争的原生所有者，也无法修复根会话专属 host 回调。
- 让一个根会话长期持有其全部后代：关闭／删除该根会话后，存活分叉会依赖已释放的产品资源。
- 将产品文本重放到新原生会话：丢失原生历史、压缩和 document 语义。
- 复制或截断活跃 SQLite 存储：复制无关任务状态，绕过原生所有权和历史规则。

## 验收标准

- AC1 — Durable 成功回复只在具有已提交、归属已验证的检查点时提供 Fork；预览、旧回复、损坏／跨归属检查点和 Durable 编辑并重发，在列表与执行中均保持不可用。 (verification: package/Main/renderer tests — implementation author)
- AC2 — 分叉只继承选定的原生前缀和历史配置，保留压缩／document 语义及早期继承检查点，不获得源任务／submission／批准权限，也不包含源后续追加。 (verification: real SDK SQLite tests — implementation author)
- AC3 — 同一 backend 的并发根会话打开和分叉准备只创建一个原生所有者；释放、停止、重建或删除一个根会话不停止同级会话或释放其资源，最终关闭／重开不产生重叠所有者。 (verification: Main/native lifecycle tests — implementation author)
- AC4 — 并发的父／分叉请求、工具和子线程使用各自的模型参数、gateway 计费／trace 身份、批准、交互可用性、工作区、MCP 及 host 回调；重连顺序不改变路由。 (verification: Main gateway and behavior consumer tests — implementation author)
- AC5 — 产品发布具有原子性；取消、原生接纳未知、产品提交失败和重启恢复，均不发布部分产品分叉、不重复创建已核对的原生分叉、不修改同级会话，也不删除共享原生存储；未发布的原生孤儿保持静默且可识别。 (verification: file-backed SQLite failure/recovery tests — implementation author)
- AC6 — 删除源会话并重启应用后，分叉仍可打开、续聊，并从保留的旧检查点再次分叉；在所有 context 均不再引用前，保留共享原生历史。 (verification: Main/native tests and Electron — implementation author)
- AC7 — 真实模型 Electron 验收通过现有 UI 创建 Durable 分叉，父子独立续聊并保留各自回答与用量关联，关闭／删除源会话后重启并恢复分叉；记录提供商／模型，将这些运行与脚本测试区分。 (verification: Electron with configured real provider — implementation author)
- AC8 — Claude／Pi 历史行为不变，Fork 不承诺文件回滚，配对支持文档反映实际交付，且不新增上游 SDK 行为补丁。 (verification: affected consumer tests and docs gate — implementation author and maintainer)

## 风险

- 多处 host 回调仍捕获单个根会话。只共享 runtime 对象会导致跨会话批准、工作区和计费错误；AC4 是启用门槛。
- 原生存储和 scheduler 失败会影响整个 backend 谱系。UI 必须如实通知每个访问，不能承诺分叉之间的存储故障隔离。
- 原生分叉祖先保留源历史，已确认但未发布的分叉也占用存储。在没有公开原生删除契约之前，不新增回收保证。
- Registry／模型选择和共享 behavior 修改可能影响已有 Pi 消费者。保留其单根行为，验证实际受影响消费者，不引入 host 选择兜底。
- 跨数据库发布依赖核对恢复，不能仅凭函数成功返回就宣称 exactly-once。
