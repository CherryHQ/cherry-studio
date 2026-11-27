---
description: Local WebSocket client acceptance specification for remote protocol conformance, real Desktop execution, recovery, security, and weak-network budgets
sources:
  - src/main/features/apiGateway
  - src/main/ai/streamManager
  - tests/helpers/db
  - tests/helpers/http/server.ts
  - tests/__mocks__
  - vitest.config.ts
---

# Remote Agent Testing Specification

> **目标测试规范，测试工具与用例待实现。** 本文定义本地 WebSocket client 要测什么、如何判定
> 通过；不表示新协议已实现或已通过这些测试。规范依据是 [API 契约](./remote-agent-access.md)、
> [文件与函数设计](./remote-agent-implementation.md) 和 [S01–S13 时序图](./remote-agent-sequences.md)。
> 旧 `server.test.ts` 覆盖的是旧独立 listener/加密协议，不能算作新协议验收。

旧 PR #20717 的原型代码已备份并从工作树撤下；本文保留目标设计。`remoteAccess`、
`RemoteCommandService` 及原型新增的 owner 接口均需重新实现，不能视为现有基线能力。

## Acceptance topology

主验收工具是一个本地 **Node WebSocket client**，连接真实 socket，不需要先完成 Mobile UI：

```text
Local test client（独立连接、测试设备 key、持久化 cursor/command）
    │ ws://127.0.0.1:<临时端口>/v1/remote/connect
    │ 正式安全握手 + 加密 JSON-RPC；loopback 不豁免鉴权
    ▼
真实 API Gateway → RemoteAccessService → 真实 AiStreamManager
                          │                    │
                    journal / checkpoint   可控测试 runtime
                          │                    │
                          └──── 真实 SQLite ───┘
```

Gateway 使用生产 route、解析、授权、调度和生命周期代码，测试仅通过受控启动配置绑定
`127.0.0.1` 随机端口；不能手写一个只转发 handler 的测试 WS server 冒充 Gateway 验收。
本地 client 复用仓库已有 `ws` 客户端依赖和选定的安全库，导入同一个 packed remote-protocol
产物；不得导入 Desktop 的 `requestRouter/agentCommands/agentProjection` 来发送或验证消息。
需要修改报文的负例由测试 client 显式发送原始 JSON/bytes，不让 typed API 预先拦截。

外部 provider/runtime 可替换为按脚本输出的测试 driver，但 `AiStreamManager`、准入锁、执行
预留、审批所有者、持久化、RemoteAccessService 均运行真实代码。测试 driver 要走正式 runtime
注册接口并支持文本、工具、审批、取消、持久化失败与明确的暂停点；不得直接注入最终 wire
事件来替代执行链路。driver 的外部动作账本只作副作用证据，不充当回执数据库。

同一套 client 支持连接隔离的真实 Desktop 实例进行 smoke；只使用专用测试用户目录与测试
Agent，不接个人数据库或真实外部工具。配对批准、撤销与故障控制由测试进程的本地 fixture
调用可信 Desktop 接口，**不新增远程 approve/debug/reset 方法**。

## Test layers and coverage claims

| 层次 | 使用什么 | 能证明什么 |
|---|---|---|
| 包契约 | 纯函数、固定 JSON/Unicode/摘要向量、packed artifact | schema、编码、reducer、协议版本组合；不证明 WS 或执行链路 |
| 本地 WS 集成（主要门禁） | 真实 socket/Gateway/remote/stream owner/SQLite + 可控 runtime | 从报文到执行与恢复的完整 Desktop 契约 |
| 生命周期/进程重启 | 真实 ServiceContainer；可终止的 Desktop worker/隔离实例 | 启停顺序、资源清理、真实进程死亡后 durable admission 与 epoch 恢复 |
| 真实 runtime smoke | 同一 client + 实际支持的 runtime + 无害测试工具 | runtime 的输出/审批/取消映射；不以某一个 driver 通过代表全部 |
| 后续 Mobile/Relay 验收 | Expo/Metro 真机与真正 relay | 平台存储、后台恢复、安全库互通、隧道；本地 Node client 不替代它们 |

正式安全 profile 尚未选定时可以先验证包与进程内执行契约，但 WS 安全用例标记为 blocked，
不能用 plaintext/auth bypass 使“完整 WS 验收”变绿。缺少某个 runtime 环境写明未覆盖，不把
skip 当通过；只有经过完整验收的协议版本和 runtime 才能对外声明支持。

## Proposed test files and client functions

```text
src/main/services/remoteAccess/__tests__/
├── support/
│   ├── remoteTestClient.ts        # 实际 WS、安全库适配、RPC、事件记录
│   ├── remoteTestHarness.ts       # 正式组件组合、隔离 DB、配对/进程控制
│   ├── scriptedRuntime.ts         # 执行层测试 driver，非 Remote mock
│   ├── clientStore.ts             # 独立持久化 projection/cursor/pending command
│   └── faultControl.ts            # 有名屏障、受控断线、带宽/时钟控制
├── protocol.integration.test.ts  # RPC/版本/route/安全边界
├── execution.integration.test.ts # send/stream/approval/cancel 与 DB
├── recovery.integration.test.ts  # checkpoint/replay/response loss/client restart
├── lifecycle.integration.test.ts # container/停服/撤销/backup pause
├── crash.integration.test.ts     # worker 终止、同 DB 重新启动
└── flowControl.integration.test.ts # byte quota/慢端/控制请求
```

先作为测试文件旁的专用 support，不新增通用测试 SDK；多个真实消费者出现后再考虑移动。
包本身的纯契约测试留在 `packages/remote-protocol/tests`，fixtures 的期望结果独立编写。

```ts
interface RemoteTestClient {
  connect(url: string, identity: TestDeviceIdentity): Promise<void>
  hello(offer: ProtocolOffer): Promise<ProtocolSelection>
  authenticate(input: AuthenticateParams): Promise<void>
  request<M extends AgentMethod>(method: M, params: AgentParams<M>): Promise<AgentResult<M>>
  sendRawJson(value: unknown): Promise<void>
  sendPlaintextForTest(bytes: Uint8Array): Promise<void>
  nextNotification(method: string, deadlineMs: number): Promise<JsonRpcNotification>
  disconnect(mode: 'graceful' | 'abrupt'): Promise<void>
  dispose(): Promise<void>
}
```

`sendPlaintextForTest` 指把指定的明文字节交给**正常安全通道加密后发送**，用于 malformed JSON
负例；不是 plaintext 网络模式。故意损坏密文的用例在更低层 bytes 边界注入。通知必须从建连
开始入有界队列，`nextNotification` 先检查已有记录，不能因订阅回调安装晚而假性丢包。
client 的 reconnect/恢复由用例显式驱动，默认不自动重试，以免吞掉原始失败或生成新 commandId。

## Required scenario matrix

下表每行都必须有可执行断言；S 编号沿用时序图，T 编号用于额外协议/工程契约。

| ID | 操作或故障 | 必须断言的结果 |
|---|---|---|
| S01 配对 | claim 重试、第二设备抢同邀请、本地批准/拒绝、邀请到期 | 相同 key 得同 pending claim；其他 key 不能领取批准结果；批准前不能调用 Agent；无远程批准方法 |
| S02 版本兼容 | 相同协议/不同应用 release；新 Mobile/旧 Desktop 与旧 Mobile/新 Desktop；无交集；未 offer 的选择 | 选最大公共完整版本；旧版连接保持旧语义；无交集 `UPGRADE_REQUIRED`；客户端拒绝未 offer 的选择；hello 不含 capabilities/domain 版本矩阵 |
| S03 初次同步 | listener 挂接/回放/状态读取前后持续追加；分页 checkpoint 安装后 activate | 基线加后缀等于独立期望内容，连续无缺口；激活响应先于该订阅首个事件；未激活不发事件 |
| S03a checkpoint 损坏 | 缺页/重页/乱页/错误 digest、过期或缺失 live baseline | 整体安装失败，旧 projection/cursor 不变；服务端过期返回明确错误；重新 prepare 不拼接旧页面 |
| S03b 既有订阅接入 | 完整/被淘汰 buffer；snapshot 与 replay 重叠；空闲会话开跑、下一次 execution、终结落盘延迟 | 不丢第一条 chunk、不重复旧内容；回放不足必须识别并恢复完整基线或显式失败；观察跨执行继续生效；snapshot 不能替代增量；成功 terminal 在持久化之后 |
| S04 正常执行 | 同步后 send；输出中文/emoji/多 part、reasoning、工具输入/输出、替换/删除 | 正确 UTF-8 offset、stable IDs、revisions、摘要与最终内容；完成事件不重复发送累计全文 |
| S04a 完成边界 | 暂停最终落盘，随后成功或失败 | EOF 只进 finalizing；成功时先 durable history 再 terminal；落盘失败不得发布 completed |
| S04b 实时与历史边界 | 两端消费完成事件后，一端保留历史缓存、一端卸载；随后更新历史并滚动重读 | durable history 与执行终态前不释放实时基线；历史更新仅使缓存失效并按需重读，不发旧 ID 的 created 或 message/part 增量；两端读取同一历史版本时内容一致；普通历史读取不触发 checkpoint |
| S05 回执丢失 | admission 已提交、响应到达前断线；新 RPC id 重试同 commandId/body | DB 中一个预留、一个用户消息/执行；外部启动不重复；get/retry 返回原身份与状态 |
| S05a 幂等冲突 | 同 ID 改 text/前置条件；重复已拒绝命令；查询先返回 NOT_FOUND | 改 body 为 `IDEMPOTENCY_CONFLICT`；拒绝终态不复活；NOT_FOUND 后仍用原 ID，至多一次准入 |
| S06 断线续传 | 接收后未提交断线；提交后 ACK 前断线；重复前缀/缺口 | 仅从持久化 cursor 恢复；重复不重复追加；缺口不推进 cursor；新连接不重放旧密文 |
| S07 日志失效 | 淘汰 suffix、错误 epoch、cursor 高于 H；Desktop 重启 | 明确 checkpoint/reset；同 session/protocolVersion 连续运行跨 execution 不换 epoch，重启/日志重建换 epoch；不重跑 Agent 补文本 |
| S07a 本地基线丢失 | 游标与服务端日志仍在，但客户端当前执行的投影不完整 | 不推进缺失基线之后的 cursor/ACK；关闭旧订阅，不带 cursor 重新订阅并恢复 checkpoint；不读取历史旧版本补 append，不用 upsert 掩盖缺口；基线完整的对照端仍可增量续传 |
| S08 client 崩溃 | 在本地投影事务中、提交后分别杀掉 client worker 并重开 store | projection/cursor 同时旧或同时新；不存在“新 cursor+旧内容”；pending command 身份仍可核对 |
| S09 审批竞争 | 本地与远程同时答复；旧 revision、执行 ID、input digest | 仅一个有效决定；错误前置条件不触发工具；启用 Agent 访问的设备可读完整详情；未启用的设备不能读取或决策，禁止自动批准 |
| S10 取消竞争 | 当前执行完成同时取消；旧执行取消时新执行已开始 | 不误取消新执行；原 command 结果稳定；连接断开不会自动取消执行 |
| S11 授权 | token 过期/refresh、离线后 key 重新认证、关闭 Agent 访问、重新批准生成新代次 | 到期停止业务输出；grace 受限；同 approved key 可取新 token；撤销 key/授权代次拒绝且不再写出队列内容；新代次不接受旧 token 或自动续发旧 pending command |
| S12 慢客户端 | 一端停止 ACK，另一端正常；equal/behind/ahead/wrong-epoch ACK | equal 幂等、behind/ahead/wrong epoch 不释放信用；慢端额度有界或 reset；健康端与执行继续 |
| S13 隧道中断 | 本地透明转发器断开后恢复，Desktop 没重启 | 重新握手/认证并恢复；日志保留时不换 epoch。此项仅证明隧道中断语义，不宣称 Go relay 已验收 |
| T01 RPC 标准 | string/number/null id；无 id；无效 JSON/envelope/method/params | 正确标准错误与原 id；notification 无响应、request-only notification 无副作用；晚回包不串到新请求 |
| T02 Batch | 空数组、无效成员、纯通知、混合请求；含 activate；超 entry/aggregate bytes | 标准 batch 结果；无顺序/原子性假定；激活事件在整批响应后；超预算执行前拒绝，DB 无业务写入 |
| T03 设备授权边界 | 旧 provider token/API key、伪造 deviceId、其他设备/代次的 command/page；content 与 session 不匹配 | provider 配对不启用 Agent；旧或撤销代次不能认证；其他主体的 handle/错误资源关联返回 `NOT_FOUND`；启用设备可访问全部 API 暴露的 Agent 会话，含之后新建的会话 |
| T04 内容与历史 | 长文本/大 tool output、内容 revision 变化、历史翻页中更新 | 显式 ContentRef/分块可还原完整内容；错误 revision 明确失败；不把截断数据当完整值；无任意路径读取 |
| T05 安全报文 | 错误桌面 pin、错误设备证明、改握手版本、损坏/重放密文、超大记录 | 握手/认证或解密失败，未调用业务且无写入；不回泄漏信息的内部错误 |
| T06 生命周期 | listener 重启/端口变更、连接关闭、backup pause/drain、停服 | 身份不因端口改变；清理 socket/timer/observer/pin；已准入工作交给执行 owner；不会在关闭后发事件 |
| T07 数据迁移/恢复 | 带真实旧数据迁移、设备授权字段/receipt 回滚、DB 写入失败 | 追加迁移保留业务数据；回执与预留同成同败；恢复前撤销旧 authority，旧动作不复活 |
| T08 多连接/并发 | 同 ID 并发、两个不同 ID 抢同 idle revision、订阅数超限、旧连接迟到回调 | 同 ID 一个准入；同 session 一个新执行；额度正确；旧 generation 不推进新连接；本地入口不能绕过预留 |
| T09 容器 | 真实 container 启动、ready 前连接、停服后接入 | 不形成 Gateway↔Remote 依赖环；未 ready 拒绝；非 conditional 服务使用正确解析接口 |
| T10 包边界 | packed artifact 在 Node 和 Expo 消费；所有声明的版本组合 | 无深层导入/Node-only API 泄漏；方法类型与 runtime schema 一致；未测试组合不 advertise |
| T11 授权状态存储 | 既有设备默认未批准；启用、重复启用、关闭、再批准、更换 key | 状态保存在 paired-device；重复启用/refresh 不换 grantId，关闭后再批准/key 变更生成新代次；关闭 Agent 访问不影响 provider 配对；无独立 grant 表或权限列表 |
| T12 共用基础设施 | 同次配对批准配置传输与 Agent，或只批准其中一项；通过直接连接与中继访问 | 配对成功后立即可用，无第二次授权；共用设备身份、认证与加密连接，未批准的业务能力被拒绝；配置和凭证只在加密业务通道内传输，中继不转发旧 HTTP 导出路由；配置传输不依赖 Agent 会话或订阅 |

T12 依据[共用基础设施决策](../api-gateway/remote-agent-access.md#shared-infrastructure-for-configuration-transfer-and-agent-access)。
统一配对与配置传输契约尚待补齐；在此之前不能以 Agent-only 配对测试通过代表统一方案已验收。

## Released-version compatibility

版本组合按 [API 兼容表](./remote-agent-access.md#protocol-version-compatibility) 验证。首版只测
真实存在的 v1；v2 用例在 v2 开始实现时加入，不为不存在的协议创建空实现。至少覆盖不同
应用 release 使用同一协议，及未来新旧两端双向组合。旧端必须使用保留的发布产物或旧版
packed package/fixtures，不能只让最新代码发送 `protocolVersion: 1` 冒充旧客户端。

断言 hello 的公共版本、所有实际输出的方法/事件/结果仍属选定版本，并重跑该版本完整
send→stream→reconnect→approve/cancel 契约。无交集在业务前停止、不进入自动重试；协议
切换重新 checkpoint，不复用旧投影 cursor、不自动转换重发 pending command。若新版本
仍声明支持旧版，旧版全套验收就是必过门禁；移除支持要记录受影响的已发布两端版本。

## Crash and race protocol

崩溃测试必须区别 `throw`、socket 断开、服务重启和**进程被杀**。抛异常证明不了 OS 进程死亡
时内存消失与 SQLite 恢复。至少覆盖下面这些有名屏障，每个用独立用例执行：

| 屏障 | 重启/释放后允许的结果 |
|---|---|
| DB transaction commit 之前 | 无 command/业务预留半成品；原 ID 可重新提交 |
| commit 之后、activation 标记之前 | 存在同一 reservation；仅可接管已证明未激活的 intent，重检当前 authority |
| `activating` 已持久化、外部调用之前/之后 | 不确定路径标记 interrupted；不自动重做可能已发生的工具动作 |
| 外部完成、receipt settle 之前 | 根据持久化执行事实核对原结果；证据不足 interrupted，不二次执行 |
| listener 挂接/回放/读取状态期间，以及 checkpoint 固定与首次增量之间 | 初始内容与后缀完整且不重叠，或显式 reset/失败；不能静默漏掉事件 |
| activation 响应已写出、pump 前 | 成功后正常事件，或授权/保留失效时 reset/close；不能有缺口后继续原流 |
| 本地投影事务 commit 前/后、ACK 前 | cursor 与投影原子；重连重复事件不重复改变内容 |

屏障只存在于测试 composition/可控 driver 或内部依赖注入，不开放网络 debug API、不依赖
随机 sleep 恰巧撞中时机。审批/发送竞争明确安排两端抵达同一裁决点，再释放；不能仅用
`Promise.all` 启动两个可能并未相遇的操作就声称覆盖竞争。

进程测试在**同一个 it** 中保留同一隔离数据库，销毁并重启 worker；客户端持久化另用独立
文件，不能复用 Desktop DB 或内存对象。测试 DB 从 `setupTestDatabase()` 与生产 migrations
建立；现有 harness 如不能安全移交路径、关闭/重开连接，需要先扩展它，不能用手写建表替代。
父子进程的 DB 连接与 truncate/cleanup 时机必须明确；多个用例不得并发共享 harness。

## Fault injection and weak-network measurements

[WebSocket](https://www.rfc-editor.org/rfc/rfc6455) 建立在 TCP 上，不能把同一健康连接内任意
乱序/丢弃消息称作普通弱网。网络层测延迟、限速、暂停读写、半开和连接终止；应用事件的
重复/缺口/乱序在解密后的接收边界或 reducer fixtures 注入，验证协议防御，并注明故障层。
密文重放是安全负例，不应期待它像正常重连续传一样成功。

丢失回执用 admission 提交后的屏障关闭 socket，或让 client 接收后丢弃并立即断线；不能
在带记录计数器的加密流里删掉一条密文后继续假装合法通道。client 不 ACK 未持久化的内容。
慢端分别测试“不 ACK”和“停止 socket 读取”：前者测应用信用，后者测真实输出缓冲。

建议首轮可复现的网络参数如下，它们是**本项目的测试输入，不是网络行业标准或性能承诺**：

| Profile | 测试输入 |
|---|---|
| local | 无额外延迟/限速，固定 runtime 输出脚本 |
| slow | 每方向 150 ms 延迟，下行 64 KiB/s，上行 16 KiB/s |
| unstable | slow 参数；按固定 seed 加入 0–100 ms 抖动，每经过 64 个应用事件断线一次，共 3 次 |
| stalled | 完全停止 ACK 或 socket 读取，直到超过所协商窗口/保留边界 |

带宽整形保持字节顺序；checkpoint/history 等请求与控制请求同时压测。不全局 fake timers
驱动真实 socket；TTL/租约用注入 clock + 显式 sweep/屏障，网络等待使用带 deadline 的真实事件。

报告至少记录：上/下行明文字节、密文与 WS framing 字节（是否计 TCP/TLS 另注明）、event 数、
首次文本延迟、恢复至 H 的耗时、cancel 回执及真正终止耗时、队列/journal/pin 字节峰值。
分开报告 loopback 与整形网络，固定相同输出脚本、chunk 大小、seed、压缩配置和起止区间。

硬断言是协商额度不超限、正确恢复或明确 reset、零重复副作用、健康订阅不被慢端阻塞。
预算精确值引用 API 文档/hello，不能在测试里维护另一组常量；同时验证 hello 不超过客户端
支持上限。检查应用队列与底层缓冲，不能只看队列“转移后变小”。RSS 与延迟作为测量结果，
不能把运行机器噪声当精确内存门禁。

增量传输还应做独立放大用例：固定 chunk 大小，输出 N 与 2N（例如 4096/8192 个 chunk），
关闭压缩，只统计正常流式区间的应用字节，排除初始 checkpoint/握手。预期字节随新增内容
近似线性；初始门禁建议 `B(2N) / B(N) ≤ 2.2`，并断言 `part.completed` 不携带累计全文。
这是待实施时固定的回归预算，调整需给出同 fixture 的测量理由；不能仅凭“看到 append”通过。
性能 SLO 的绝对毫秒值另待真实平台测量确认，不在文档中虚构已达到的数字。

## Assertion and isolation rules

1. 每个 test 写清能抓住的实际缺陷；断言外部结果与 durable state，而非仅 `toHaveBeenCalled`
   或把现有输出生成 snapshot。内容/摘要/offset 的预期值不能通过被测 reducer 再算一遍。
2. 集成用例同时观察 wire trace、client projection、Desktop DB、测试 runtime 副作用账本。
   只有需要时才查看内部预算计数器，不能用内部计数器代替真实流量和数据断言。
3. 用生产 migrations 与真实文件 DB；遵循 [Database Testing](../testing/database-testing.md)，
   不 mock Drizzle、事务或 `RemoteCommandService`。已有统一基础设施 mock 只能提供测试装配，
   被验收的真实组件不能被全局 mock 悄悄替换。容器用例单独使用真实 ServiceContainer 验证。
4. 所有 connect/request/event/close 等待有 deadline；超时立即失败并输出最后状态和未决 ID。
   “不该有事件”用屏障后的受控观察窗口，并检查没有持久化副作用；单纯短暂等不到不构成证据。
5. 每例独立端口、设备、授权代次、DB 与 client store；同一 harness 内不 `test.concurrent`。
   teardown 关闭客户端/worker/server、释放观察和 pin、停止 timer，检查无活跃连接/未决请求。
6. 默认 CI 无外网模型依赖、无个人凭证、无任意 shell/file 工具；错误日志不含 private key、
   token、邀请 secret 或审批敏感输入。测试工件使用 synthetic 内容并保留可复现 seed。
7. 测试故障不添加生产行为开关或协议方法。加密校验不手写算法，使用选定实现与已知负例；
   同一端库互通不能独自证明安全性或 Expo 兼容性。

## Running and release evidence

用例实现后，按已有仓库脚本执行，以下文件名是目标文件，**目前尚不存在**：

```sh
pnpm test:main src/main/services/remoteAccess/__tests__/protocol.integration.test.ts src/main/services/remoteAccess/__tests__/execution.integration.test.ts
pnpm test:main src/main/services/remoteAccess/__tests__/recovery.integration.test.ts src/main/services/remoteAccess/__tests__/crash.integration.test.ts
pnpm test:main src/main/services/remoteAccess/__tests__/lifecycle.integration.test.ts src/main/services/remoteAccess/__tests__/flowControl.integration.test.ts
```

不使用 `pnpm test <path>`。代码变更运行 `pnpm lint` 加相关 tests；docs-only 运行
`pnpm docs:index`（索引变化时）和 `pnpm docs:check`。包测试/packed consumer 的命令在包建立后
写进其 README 并接入 CI，不能把不存在的 `test:remote` 脚本写成今天可用的命令。

每次验收提供：commit SHA、包 artifact/hash、Node/OS/数据库迁移版本、Mobile/Desktop release、crypto/protocol/runtime
版本、服务端 limits、场景 ID、seed、通过/失败/blocked/skipped、网络参数、流量/耗时统计及失败
trace。报告区分本地自动化结果、真实 Desktop smoke、Expo/Relay 未覆盖项和远程 CI 状态。

实现阶段的门禁是对应切片矩阵全通过；发布一个 advertised protocolVersion/runtime 时，其适用用例、
安全 profile 验证、真实 runtime 和 Expo packed-artifact/真机验收不得 blocked 或 skipped。
Relay 未交付时 S13 只做透明转发故障测试，标明 Go relay 未覆盖，不阻塞仅 direct 模式的范围。
