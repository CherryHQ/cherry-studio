# Agent Note: Pi Durable 桌面分叉共享一个 backend 所有者

Status: implemented

[English](2026-11-09-pi-durable-desktop-fork.md) | 中文

## 问题

Pi Durable 已支持原生同存储分叉，但桌面回复没有分叉检查点，每条连接也各自持有 Harness。只增加 driver 方法会产生竞争的所有者，并将同级会话送入单个根会话的模型、批准和环境闭包。

本决策只替代[历史操作方案](../../proposed/architecture/2026-11-08-agent-history-operation-boundaries.md)中目标 backend 必须隔离的前提和 Durable 桌面编辑排除规则，保留原生历史、独立产品会话、失败恢复和当前工作区文件。不增加上游 SDK 补丁，不升级依赖，也不增加产品数据库迁移。

## 决策

### 范围

带新提交检查点的成功 Pi Durable 回复支持现有桌面**分叉对话**操作。分叉谱系共享 backend；无关会话仍使用独立存储。编辑并重发替换产品消息树中选中的尾部，不新增历史版本。桌面端提交编辑前要求二次确认；取消会保留编辑草稿和原消息。隐藏或卸载发起确认的页面会使尚未回答的确认失效，之后重新显示同一会话也不会恢复该确认。首条输入编辑启动空 context；后续输入编辑要求有效的前驱检查点。旧回复不能建立原生边界；文件回滚和 `vcc_recall` 仍不支持。

SDK 公开的 `tx.forkConversation()` 从选中的可见 entry 创建无任务归属的会话。原生历史、压缩和 document 分叉策略继续归 SDK。后续连接启动会应用目标会话当前的产品配置。

### Backend 与 host 所有权

`PiDurableRuntimeDriver` 在同一个 backend 队列上串行化初始化、原生分叉准备和最终释放。一个 `DurableBackend` 持有 Harness、模型注册表、根会话 host 资源和执行环境。连接借用根 handle，持有观察和子线程投影。最后一次释放只关闭一次原生所有者，排空回调并落盘产品写入，替代所有者才能打开。产品落盘失败可以重试，无需再次关闭原生所有者。

原生任务归属将 conversation 映射到产品根会话；历史祖先关系不会使 fork 归属于源会话。模型、请求参数、trace、计费、批准、提问、交互可用性、MCP、skills、提示词 section 和环境均按该根路由。每个绑定使用独立 provider 注册和选中的 extension 名称。Durable 使用跨重启稳定的模型目录 key；Pi 保留现有原生模型 key 契约。共享的 `Models.find` 和 verifier 请求现在携带实际 thread。

只要 backend 仍能执行保留的工作，host 资源就保持存活。根会话将模型、推理档位、服务档位、Fast 和知识选择保存到原生 `cherry.desktop-request` document，不保存凭据或 trace span。冷恢复时，driver 找出有未完成原生任务的根会话，在恢复共享 scheduler 前接上现有 Main 连接和投影消费者。临时就绪屏障随 host 替换转交，不是第二份任务账本。缺少产品归属时恢复失败，不会执行未绑定的根会话。显式 Stop 仍保持 conversation 范围。

### 检查点与发布

原子完成批次将最后一个可见的已提交 entry ID 与内容、输入结束事实一起交付。不透明检查点包含 backend、conversation 和 entry ID。预览和 idle 活动不能建立分叉边界。观察者接入时已有的活跃预览仍归 live；若把它当成历史，整个恢复生成的内容都会被产品写入方忽略。已提交前缀仍归历史。预览消失后再次出现时，即使原生 task 和 attempt 编号相同，也分配新的本地身份；已退休的产品 source 不能复用。Driver 核对源产品绑定，验证每个保留检查点均属于选中的原生前缀，并在当前所有者的变更队列上分叉。冷分叉在同一串行化 backend 队列中使用原生 Session，不启动 Harness 或 scheduler。

协调器分配目标 context 身份，在准备原生分叉前写入操作日志。原生分叉和产品 context 标记在同一事务中提交。重复相同准备会核对标记和源边界，不会重复创建 conversation。结果将分配的 context ID 带入现有产品会话、消息、绑定的原子发布。重映射的检查点使用新 conversation，保留原生祖先 entry ID。

原生事务与产品事务彼此独立。取消或产品提交失败不会发布部分产品会话。已准备的原生孤儿保持无任务归属、未运行且可通过保留的日志识别；SDK 没有公开的 conversation 删除 API。清理只移除已证明归操作所有的未发布文件，不截断或删除共享存储。源会话删除后，仍保留存活 fork 所需的祖先历史。

继承的模型上下文仍然可见，behavior 权限则只来自 conversation 自有记录。祖先的 Goal、子线程控制、摘要费用和 job key 不能成为 fork 的权限。无任务归属的原生分叉不会复制任务、submission 或 provider 状态。产品副本也移除活跃任务、批准状态和用量统计。

系统工作区复制当前文件，用户工作区继续共享；两者都不恢复历史文件版本。编辑并重发在同一事务中删除原输入及其后续子树，并发布替换后的尾部；子树之外的已有兄弟分支和独立 Fork 会话保持不变。被移除的根投影来源会记录墓碑，防止重放恢复旧消息。尚未完成的外发投递阻止编辑，避免丢失回执返回位置。原生历史仍由 adapter 管理，不直接截断。非首条编辑复用原生分叉准备，保留其预分配的产品 context 身份，并在一个产品事务中发布新输入、context 绑定和分支检查点映射。首条输入编辑预留新的空 backend/context，准备阶段不分叉，也不执行原生任务。旧原生输入绑定不复用。原生数字 ID 可能跨存储重复，因此发布和恢复都按具体 context 核对。未发布的原生产物沿用保留日志策略，保持不执行。

### 实现归属

| 归属 | 职责 |
|---|---|
| Durable package 投影和 runtime | 原子检查点证据、原生事务访问和 conversation 自有 behavior 事实 |
| Durable driver、backend 和连接 | 单一所有者、根 host 路由、就绪屏障、请求配置保留和访问释放 |
| 现有 Pi gateway 与 behavior helper | 独立原生绑定和 thread 正确的 host 请求，不再增加参数翻译器 |
| Fork 协调器、资源日志和 data service | 准备身份、原生核对和产品原子发布 |
| 共享历史资格判断 | 基于证据的 Fork 和编辑并重发 |

## 考虑过的替代方案

- 独立目标数据库需要 SDK 跨存储导出／导入，而会话独立性并不要求独立数据库。
- 在同一存储打开另一个 Harness 会产生竞争所有者，也无法修复捕获根会话的闭包。
- 由源连接持有整条谱系，会让存活 fork 与源会话删除耦合。
- 重放产品文本会丢失原生历史、压缩和 document 语义。
- 复制或截断活跃 SQLite 会绕开原生任务和历史所有权。

## 验证

- AC1 — Main 历史操作测试允许首条输入编辑，拒绝不支持的前驱以及旧版／无效边界。Durable 完成测试将已提交 entry 与最终内容、输入结果配对，覆盖被阻塞的观察者以及接入已有部分输出的生成。真实 UI 在新边界提供 Fork。
- AC2 — 真实 SQLite 测试和公开 API 原生探针保留精确前缀与历史 `AgentDoc`；排除源后续追加，冷分叉准备具备幂等性，跨存储且原生 ID 相同的前缀仍保留各自 context 归属，无任务归属的历史事实保留上下文而不继承祖先 behavior 权限。现有压缩和归档测试保持通过。
- AC3 — Main 生命周期测试验证根会话共用 runtime、独立释放、最终关闭／重开串行化和归档落盘失败重试。真实父／fork 运行确认共用 Harness 身份。
- AC4 — Main 并发测试通过不同系统工作区和批准通道写入。生产 gateway 测试在共享模型注册表中保留每个根的 session 请求头和推理档位。冷恢复未完成同级会话的测试保留其 `high + Fast` 请求与消费者，同时 fork 使用 `low`；现有子线程、MCP、摘要和 behavior 消费者通过。 真实供应商 Electron 验收在部分输出时关闭源会话标签，重启后只打开分叉会话，仍能自动恢复源任务，将完整结果写回原助手消息，同时保持分叉独立。
- AC5 — 文件数据库产品发布测试覆盖取消、提交失败和日志恢复。原生回执丢失和重复冷准备核对同一个 conversation；不产生部分产品 fork，保留的原生准备记录也不会执行。
- AC6 — Main 测试删除源会话后重新打开 fork，并再次分叉早期继承检查点。Electron 通过正式生命周期永久删除源会话，重启应用后继续存活的 fork，并再次分叉旧检查点。
- AC7 — Electron 使用真实 LongCat AI `longcat::LongCat-2.5`：源会话在后续更新后回答 `kiwi`，选中前缀的 fork 回答 `apricot`。用量绑定到不同助手消息，复制的当前文件保留。重启后的 fork 仍回答 `apricot`。本地证据位于 `.context/cherry-electron-dev/durable-desktop-fork/`。
- AC8 — 定向 Pi 和共享 behavior 契约、Claude／Pi 多 context 分叉消费者、Node／package 类型、限定范围 lint 和文档检查覆盖受影响边界。未增加 SDK 补丁。模块和分叉／runtime 参考文档记录实际交付范围。
- AC9 — 真实 SQLite 测试覆盖首条、后续和重复尾部替换、重开、保留已有兄弟分支、外发投递准入、编辑后再分叉，以及关闭／产品提交失败和原生回执丢失。跨存储相同原生 ID 不会误更新绑定或误判发布。Pi、Pi Durable 和 Claude Code 的真实 LongCat UI 验收得到前文 apricot、新首条输入 mango；被删除的消息返回 404，不出现新的版本切换入口，替换前创建的 Fork 仍回答 plum，当前文件未变化。证据位于 `.context/cherry-electron-dev/edit-in-place/`。

离线案例使用原生 SQLite 和脚本化 provider，与真实 provider 的 Electron 运行分开记录。正常关闭／重开和注入回执丢失不能证明强杀恢复，也不能证明外部工具副作用恰好执行一次。

## 影响

- 存储／scheduler 故障影响整个 backend 谱系，各访问会收到该共享故障。
- 原生祖先和已确认的未发布 fork 会占用存储，本功能不增加原生裁剪策略。
- 恢复保留工作需要可用的产品绑定及模型／host 配置，不会从复制文本猜测归属。
- 工作区复制保留当前文件，并可能拒绝并发文件变化；Fork 不是文件回滚。
