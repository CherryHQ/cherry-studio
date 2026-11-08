# Agent Note: Cherry Cloud ownership 收敛

Status: proposed

[English](2026-11-08-cherry-cloud-ownership-convergence.md) | 中文

## 问题

订阅栈已合并至 `b22aae1dd46d2cacae5c35dba95412a4420e42ab`。登录、订阅点击、刷新、选择器销售项、排队发送和原生错误恢复存在重叠的协调路径。延迟回调可能重复结算一次登录，旧点击可能覆盖新点击，Chat 排队项可能按编辑器当前模型判断。

用户已授权按之前讨论的架构实施，并选择保持业务合同和外部协议、允许修复已确认缺陷。本说明记录该范围；proposed 状态不代表已获 GitHub Spec 审批，也不代表验收已完成。

## 方案

### 所有者与依赖

保留 `CherryCloudService` 作为主进程凭证、登录终局、账号代次、HTTP 事实、刷新发布和订阅操作的所有者。渲染进程只发送一个订阅命令。跨窗口的并发点击复用已有的进行中操作；首次获准的请求决定该操作结算前的门户归因和发送窗口。登出时释放该操作，使新账号无需等待旧浏览器调用；旧操作的迟到完成不能释放替代它的新操作。每次点击仍保留自己的 analytics 事件。主进程在打开受信任账户门户前立即校验当前账号作用域和受管发送窗口。关闭该发送窗口会阻止门户打开，但不取消其他调用者共享的登录。

使用已有 `Sequencer` 串行执行完整账户刷新，每个调用者获得自己的类型化结果。发布一份包含作用域、本地序号、各端点新鲜度和来源的收据。轻量 provider 授权独立于销售套餐刷新。通知仅在同连接、同作用域的刷新成功后推进 cursor。渲染 hooks 投影收据，不再重新请求独立镜像，也不按经过时间猜测通知来源。

通用模型选择器不感知 Cloud 套餐、登录和 analytics。Cloud 组合提供真实模型的展示和独立动作行。销售项不能被当作模型选择、置顶或发送。保留过滤、键盘导航、虚拟化以及 general/agent 差异。

Chat 按各排队 payload 的模型评估。排队的新 Agent turn 在启动时解析最新 Agent 配置；活动 turn 保留已捕获目标。deferred 项留在队列且不造成 drain 循环。未知或过期 availability 不能作为耗尽证据。已有 provider 权益检查和服务端额度判断仍具权威性。

可移植 Claude adapter 拥有已验证的 live/archive 原生拒绝事实。产品代码装饰事实，不从消息文字推断错误。通用 analytics 拥有 consent 和传输，Cloud formatter 拥有 Cloud 身份及事件属性。不引入全局订阅 manager、第二个会话所有者、持久 flow ledger 或新数据库表。

### 保留范围与有意修正

保留 PKCE/state/loopback 校验、请求签名、先持久化凭证再发布 session、token-refresh single flight、waiter 取消、本地优先登出、重试/idempotency 规则及 quota-refusal floors。保留 HTTP 方法、路径、query/body 字段与响应解析；公共套餐和账户套餐 DTO 仍保持区分。保留模型行身份、active/upcoming 语义、版本差异、六种订阅来源、flow 参数、consent 和粗粒度归因。

有意修正包括登录只结算一次、跨窗口只有一个进行中的订阅操作、阻止过期账号门户和收据、通知刷新失败可重试、按排队 payload 目标判断、区分 quota 与普通限流、动态 Free 过滤准确，以及套餐未知时不伪造未订阅。这些修正必须有代码反例和合同测试；不授权新增结账行为或 analytics 事件值。

### 验证边界

以上合并提交为不可变比较基线。验证可观察的业务和协议合同，不固定偶然调用或既存缺陷。对并发事件顺序进行有界穷举并检查明确不变量，使用受控调度与生成输入运行实际 TypeScript 路径。先证明故意破坏的真实代码变体会使检查失败，再恢复并重跑。在 PR 验证证据中记录覆盖文件、函数、边界和已验证提交。

离线端点 fixtures 和原生 SDK 测试不证明在线后端兼容。本地收据序号不是服务端事务版本。模型检查通过不证明未建模 JavaScript、操作系统浏览器行为或服务端实现。应与聚焦测试、类型检查及 Electron 证据一同报告这些限制。

## 考虑过的替代方案

- 将订阅、模型策略与运行时执行集中到一个 manager：会跨独立生命周期新增第二个所有者。保留已有所有者和窄合同。
- 为 status 监听和独立 SWR 请求继续添加 guards：仍保留重复终局和新鲜度 writer。显式表达操作终局和刷新收据。
- 要求包含缺陷的逐轨迹等价：会保留已知竞态。改为保留业务和外部合同，单独列明并验证修正。

## 验收标准

- AC1 — callback、取消、过期和关闭下，每个登录 waiter 都有唯一终局；浏览器打开竞态不能与已持久化的成功 session 矛盾。(verification: scheduled main-service tests; owner: main Cloud)
- AC2 — 跨窗口的并发订阅命令共享一次登录和门户操作；首次获准的请求决定门户归因，无效发送窗口和过期账号作用域阻止迟到副作用，关闭发送窗口不会取消共享登录。(verification: concurrent main-service and IPC boundary tests; owner: main Cloud)
- AC3 — 每次获准刷新独立结算，前次失败不丢弃后续请求，过期账号结果不能发布。收据明确新鲜度与来源。(verification: main-service concurrency and renderer projection tests; owner: main/renderer Cloud)
- AC4 — 通知 ready/live/catch-up 失败和取消仍可重试，不确认尚未处理的账号变化。(verification: offline SSE scripts; owner: Cloud notifications)
- AC5 — 通用选择器无 Cloud 策略导入；销售项是独立动作行，不参与模型选择和置顶，并保留键盘/过滤行为。(verification: dependency and selector consumer checks; owner: renderer selector)
- AC6 — Chat 队列按捕获目标给建议，Agent 启动遵循原有配置生命周期，deferred drain 仅在有意义变化时唤醒。未知事实不生成额度决定。(verification: queue and affected composer tests; owner: conversation runtimes)
- AC7 — 可信 quota、限流、认证和权益失败保持区分；原生 live 与冷恢复暴露等价且已验证的拒绝事实。(verification: error contract and actual SDK/local-endpoint tests; owner: runtime adapters/product decoration)
- AC8 — Cloud analytics 格式化移出通用传输，同时保留 consent、source/flow 合同及账号隔离；事件不宣称购买因果。(verification: analytics formatter/consent tests; owner: analytics/Cloud)
- AC9 — 保留的安全和 HTTP 合同通过聚焦前后检查；每项验证属性都能捕捉故意破坏的真实代码。记录边界和后端限制。(verification: focused test files and recorded baseline/mutation evidence; owner: implementation coordinator)
- AC10 — 删除本次迁移的旧协调路径及孤立 API，受影响调用者编译通过，双语文档符合最终实现。(verification: explicit scope, dependency scan, focused tests, type checks and documentation gates; owner: implementation coordinator)

## 风险

- 当前没有在线后端环境。私有 ready 帧和 analytics 假设必须明确；本地合同检查不能认证服务端部署行为。
- account、plans 和 models 是不同观察。读取失败保留过期事实，不伪造当前一致快照。
- 原生 archive 元数据必须先通过固定 SDK 的真实生产者与存储记录证明，再暴露可移植事实。
- UI 调用者范围较广，部分迁移不安全。此次修改内迁移各调用者并删除废弃路径；不扩大到无关行为和文件。
