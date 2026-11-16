# Agent Note: 让图片字节不再经过 Agent 观察与模型请求链路

Status: proposed

[English](2026-11-16-agent-image-byte-paths.md) | 中文

## 问题

[#24500](https://github.com/CherryHQ/cherry-studio/pull/24500) 诊断了图片密集的 Durable 会话中主进程 V8 OOM 的成因，并为几个放大点加了上限：SDK 遥测载荷、每个观察者 16 MiB 的积压预算、只复制容器的历史拷贝，以及 64 MiB 的原生载荷准入。这些上限约束的是"同时能存在几份副本"，没有改变"每一份副本都和整个历史一样大"这一点。本次审查基于 `origin/main` 的 `6b4081181414` 和 #24500 head 的 `bd60450b797d`。

以下三个结构性问题仍然存在。

**观察链路每次变化都重新发布整个历史。**

- Durable 收到每一个原生 view 值都会调用 `DurableProjection.update`，包括只在内存中、尚未落盘的进度预览（[runtime](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) 的 attach 回调）。每次调用都会从全部活动 entry 新建一个 `ContentProjection`，为每张图片重新生成 data URL，再发布一份完整 `snapshot`（[projection](../../../../packages/agent-runtime-pi-durable/src/projection.ts)、[content](../../../../packages/agent-runtime-pi-durable/src/content.ts)）。`input`、`beginAdmission`、`endAdmission` 只改输入状态，走的也是同一条路径。Pi 和 ACP 已经在发布 `message.upsert`；[运行时契约](2026-10-17-agent-runtime-contract.md) 规定的也是"首帧快照、之后增量"，只有 Durable 在常态下每次都发全量快照。
- [`ThreadFeed`](../../../../packages/agent-runtime/src/observation.ts) 对每个发布的事件复制一次，再为每个观察者各复制一次，并为每个观察者维护帧队列。标记为关键的帧还要额外捕获一份完整的恢复快照；溢出恢复时，用保留的快照和当前快照替换队列。#24500 按条数和估算字节数限制这个积压，关键帧超出预算时以 `source-lost` 关闭观察。它的估算对每一帧都把共享的图片字符串重复计算一次。因此在图片密集的会话中，慢观察者只要积压两个终态帧就会被以 `source-lost` 关闭，Durable turn 随之失败，尽管这两帧在内存中共享同一张图片。
- Main 会归约每个快照里的每一条消息。[ThreadMessageProjection](../../../../src/main/ai/agentSession/ThreadMessageProjection.ts) 对每条消息都做投影、装饰和深比较；[RootMessageProjection](../../../../src/main/ai/agentSession/RootMessageProjection.ts) 先深比较累积的 parts，再把整条产品回复重新发布给实时 controller 或 `replaceMessageParts`。

单次变化的成本是 O(历史)；变化次数随历史增长；慢观察者会把保留的历史再成倍放大。

**Main 持有并重发整份产品内容。** 工具输出保留原生的 `{ type: 'image', data }` 块，并内嵌存进 `agent_session_message` 的 JSON `data` 列。内嵌存储早于 agent runtime：之前的 Claude 和 Pi stream adapter 也是这样写入工具输出图片的。当时它不在热路径上，因为 Main 只按需读取行、不持有它们，而 DataApi 读取时至今仍会把大工具输出换成延迟引用交给 renderer。桌面切换（[#22856](https://github.com/CherryHQ/cherry-studio/pull/22856)）引入的两个结构，把整份内容放上了热路径：

- 一行产品回复由多个原生 source 消息的 parts 和 Cherry 追加的 parts（如 task event）拼成。root checkpoint 只记录每个 source 的 offset 和 count，`replaceMessageParts` 整行替换。为了在某个 source 或 extra 变化时重建整行，[RootMessageProjection](../../../../src/main/ai/agentSession/RootMessageProjection.ts) 在构造时读取 context root 映射里的每一行，并保留它接收的每个 source 的 parts。会话的 runtime entry 存活期间，这些内容都不会释放。需要重建的晚到变化有后台结果、task event、审批撤销和 Claude 全量刷新，它们其实都只需要找到所属回复，再重写那一行。
- [MessageProjection](../../../../src/main/ai/messages/MessageProjection.ts) 对除文本增长以外的任何变化，都通过 `ai.projection.changed` 发送整条消息。已经含有图片的回复，每新增一个工具 part 或变化一次状态，都会把这些图片重发一遍。

**每次原生模型调用都在同一进程内绕一圈 HTTP，并重新校验每一张图片。** 原生 Pi provider 把请求发往 `127.0.0.1` 上的内部网关监听端口（[binding](../../../../src/main/ai/runtime/pi/gatewayModelBinding.ts)）。一次调用依次经过：

1. Pi 序列化 wire 请求。
2. fetch 把请求编码后写入 socket。
3. 网关缓冲并解析请求体。
4. 方言转换器为每张图片新建一个 data URL。
5. `prepareChatMessages` 把历史中每张没有 `fileEntryId` 的图片 base64 解码成 `Buffer`，再用 sharp 做一次严格的完整像素解码（[fileProcessor](../../../../src/main/ai/messages/fileProcessor.ts) 中的 `materializeNativeFilePart`）。
6. AI SDK 再次序列化 provider 请求。

模型真正需要的只有一份 provider 请求。其余副本和每次调用都重复的像素解码，都是因为一个进程内调用被做成了远程请求的形状。

## 提案

目标：每张图片在宿主中的成本是 O(1)，而不是 O(历史 × 变化次数 × 观察者数 × 调用次数)。模型看到的内容保持不变，不截断历史，不重发任务。三个阶段作为独立的 stacked layer 交付，每个阶段单独上线也有收益。

### P1 — 观察共享冻结值，复用未变化的消息

投递语义保持不变：每个观察者按顺序接收帧，在发布时捕获元数据，按条数溢出并保留关键帧，Durable 仍发布快照。改变的是，每一帧不再携带一份自己的历史副本。

1. **`ThreadFeed` 共享冻结值，不再复制。** `@cherrystudio/agent-runtime` 新增 `immutable()` 辅助函数：把发布方的容器复制一次并冻结副本；它此前冻结过的值直接复用，字符串始终共享。
   - 存储的快照、`state`、`message(id)`、捕获的元数据和每个观察者收到的投递，都是同一批冻结对象。
   - 发布方自己的对象永远不会被冻结，adapter 可以继续修改原生状态或工作状态。
   - 修改已投递值的消费者会在修改处直接报错，现有的观察者故障隔离继续生效。
   - 从 `snapshot` 或 adapter 自己的 `immutable()` 缓存中重新发布未变化的消息，会保持其对象身份。一个积压的快照帧因此只占 O(消息数) 个指针，而不是每个消息容器的一份副本。
   - 删除 #24500 的字节预算。各帧已共享历史，而正是它按帧估算的方式导致图片密集的观察者被关闭。
2. **Durable 复用已提交的投影。** 原生 view 追加的是同一批 `EntryRecord` 对象，压缩则替换前缀。
   - 投影缓存已提交层，只投影在相同前缀之后追加的 entry；其他任何 view 都重建一次。
   - `ContentProjection` 改为 copy-on-write。每次追加后冻结已提交的消息。之后的工具结果、嵌套调用或实时进度只复制它所修改的那条消息；实时覆盖层作用在 fork 上，永远不会进入已提交层。
   - 每张图片的 data URL 在每个已提交 entry 中只构建一次，而不是每个 view 构建一次。
   - Durable 继续发布快照，未变化的消息在快照中保持对象身份。
3. **Main 跳过未变化来源的工作。** 当消息的源对象未变化且没有被显式失效时，`ThreadMessageProjection` 直接复用上一次的 view，既不装饰也不比较。由于引用共享，Main 中其余的深比较遇到第一个相同引用就会返回。

4. **Claude Code 和 Pi adapter 只捕获一次。**
   - `ClaudeFeed` 对每个批次和每条原生消息只冻结一次。它保留的原生消息表、每个观察者的投递和每个恢复基线都共享这些值，因此为停滞观察者保留的关键帧只占指针，而不是全部原生历史的容器副本。
   - Pi 用 `immutable()` 代替 `structuredClone` 捕获非增量原生事件、已完成的工具参数、上下文重建和后台结果。这样既保持"在发出时捕获"的保证，又不会为每个事件序列化图片数据。

P1 不改变任何观察事件、顺序规则或投递次数。它部分取代 #24500 的观察保留决策：删除字节预算及其 fail-closed 路径。

### P2 — Main 只常驻索引、不持有产品内容，并只发送变化的 part

1. **root projection 只常驻索引。**
   - 对每条产品回复，它只保留 source 范围、每个工具调用的所属回复和审批状态。晚到的变化通过这个索引找到所属回复。
   - 尚未持久化的实时回复，其 parts 仍像现在一样留在内存中。它们就是 P1 中共享的观察值。
   - 回复持久化后，projection 释放它的 parts。构造 projection 时读取行只用于建立索引。
2. **晚到的变化按需读取所属行。** 在一个 `withWriteTx` 事务中，Main 读取所属行，替换发生变化的 source 范围或 extra，再写回该行。Claude 刷新只读取它要比较的行，并且只重写 parts 确实变化的行。
3. **投影更新只携带变化的 part。**
   - `MessageProjection` 为每个变化的 part 发布一个 part patch，同时带上该消息的 part 数量和消息顺序。未变化的 part（包括图片）不再重发。
   - 文本增长仍使用 append patch。角色或 metadata 变化以及新消息仍发送整条消息。
   - renderer 和 child view 的消费方把 part patch 应用到各自的 view。
4. **保持不变的部分。** 持久化行的格式、本改动前后写入的行以及模型上下文都保持不变，不做数据迁移。

### P3 — 原生模型调用留在进程内，每张图片只校验一次

1. **进程内调用方不经过 socket。** Pi binding 注入一个 `fetch`，在进程内直接派发给内部网关的请求处理，携带相同的 headers、凭据、signal 和 wire body。
   - 以下职责的归属保持不变：鉴权、凭据范围、仅限内部的控制项、用量捕获、response ID 关联、trace 上下文、错误信封（包括首个 chunk 之前的状态码映射）、启动屏障和取消。
   - 外部监听方继续走 HTTP：Claude Code 子进程、PDF 翻译、代码 CLI、已配对设备和外部客户端。
2. **能拿到请求对象时不再二次解析。** Pi 在序列化之前通过 `onPayload` 暴露 provider 请求对象。binding 按每次调用的 key 登记这个对象，进程内派发把它直接交给网关核心，不再解析序列化后的请求体。拿不到对象时，照现在的方式解析请求体。Pi 自身的序列化仍然保留，因为那一步归 Pi 的 provider SDK 所有。
3. **同一内容的图片只校验一次。** `materializeNativeFilePart` 按内容哈希、字节长度和媒体类型缓存校验结论（有效、拒绝或补边后的替换图），历史中重复出现的图片因此跳过 base64 解码和 sharp 像素解码。缓存有上限，只保存结论和很小的补边结果。
4. **wire 方言仍是契约。** 网关继续接收 Pi 的原生方言，继续负责 provider 执行。thinking 签名、cache control、工具调用身份和重试分类因此沿用现有经过测试的路径。本提案不引入绕过方言的自定义进程内 `streamSimple`（见替代方案）。

P3 完成后，用实测数据重新评估 #24500 的载荷准入。除非 AC11 的证据表明并发工作集已经不需要它，否则保留。

## 考虑过的替代方案

- 把 #24500 的上限作为最终状态：否决。剩下的每份副本仍然和历史一样大，单次变化的工作量仍是 O(历史)。上限只是给乘数封顶，单个超大帧或超大请求依然可以通过。
- `ThreadFeed` 继续复制，只把 Durable 改为增量：否决。每个观察者的副本和完整恢复快照仍然存在，而正是这些副本让慢观察者长期占着整份历史。
- 共享值但不冻结：否决。其他观察者或发布者对值的修改，会从立即报错变成悄无声息的数据损坏。
- 用每个观察者的合并机制（脏消息 ID + 有序事实队列）取代帧队列，并让 Durable 发布 upsert：暂缓。各帧共享值之后，一个积压帧只占指针而不是历史。合并还会改变投递次数、completion 顺序和恢复语义，而这些已经由 #24500 和回复归属工作验证过。
- 在 Main 边界把运行时图片转成 FileManager `fileEntryId` 引用：暂缓。它能缩小 Main 持有和重发的内容，但根因是 Main 持有整份内容、更新单位是整条消息。它还需要抗碰撞的内容查找、引用 role 迁移，以及对未持久化实时 view 的保留。已经内嵌图片的旧行如果不迁移，会被 Claude 刷新比较零散地改写，或者每次重新打开会话都创建再清理 entry。有了 P2 之后，剩下的是行大小、数据库大小和 renderer 内存；如果 AC11 的证据表明它们重要，再重新评估。
- 裁剪或降采样历史图片：否决，因为这会改变模型看到的上下文。
- 对历史图片使用 provider 文件 API（Anthropic、OpenAI、Gemini 的文件 ID）：暂缓。它能进一步缩小请求，但依赖 provider 支持，上传的生命周期和隐私问题也需要产品决策。
- 自定义 Pi `streamSimple`，把 Pi 上下文直接转成 Cherry 消息：暂不采用。它能去掉最多的副本，但会重新引入 [harness 边界](2026-10-17-agent-harness-boundaries.md) 决策已经删除的那类进程内专用模型协议，还需要重新实现 thinking 回放、工具配对、cache control 和重试错误形状。
- 把原生运行时移到 utility process：暂缓。它能限制 OOM 的影响范围，但不减少副本。P1、P2 完成后观察流量会变得很小，届时评估这一项的成本会低得多。

## 验收标准

- AC1 — ThreadFeed 对每个发布值只存储并投递一份冻结副本：所有观察者收到同一批对象，修改已投递或已存储的值会抛错且不影响其他观察者，发布方之后的修改不会改变已发布的值。(verification: unit — `packages/agent-runtime` observation and immutable tests; owner: P1 implementer)
- AC2 — 停滞观察者的积压帧共享历史：对一份 2,000 条消息的历史重新发布 90 次快照，保留内存低于 16 MiB 且全部投递；两个共享同一张 9 MiB 图片的积压终态帧不会关闭观察；按条数溢出、`source-lost` 和基线优先的顺序保持不变。(verification: unit with heap measurement; owner: P1 implementer)
- AC3 — Durable 在每个原生窗口内对每个已提交 entry 只投影一次：未变化的消息在各 view 间保持对象身份；之后的工具结果或实时进度只复制受影响的消息，不改变更早的快照或已提交层；不延续上一份 entry 的 view 会重建。(verification: unit — Durable projection with native view shapes; owner: P1 implementer)
- AC4 — 观察事件、顺序、completion 捕获、恢复和回复归属保持不变：现有的运行时包测试，以及 Main 的 agent-session、runtime 和 messages 测试全部通过。(verification: unit — package suites and scoped Main tests; owner: P1 implementer)
- AC5 — Main 投影对未变化的来源直接复用上一次的 view，不再重新装饰；显式失效仍会重新装饰。停滞的 Claude 观察者在 2,000 条原生消息上积压 90 个关键帧时，保留内存低于 16 MiB；Pi 原生事实在发出后被修改时，仍按发出时的内容投影。(verification: unit — ThreadMessageProjection, Claude observation, Pi runtime projection; owner: P1 implementer)
- AC6 — 会话 context 打开后，Main 不持有已持久化回复的内容：root projection 只保留 source 范围、工具调用所属回复和审批状态，回复持久化后释放其 parts。(verification: unit — RootMessageProjection with `setupTestDatabase`; owner: P2 implementer)
- AC7 — 晚到的后台结果、task event、审批撤销或 Claude 刷新，在一个写事务中按需读取所属行，写入的行内容与之前一致；刷新只重写 parts 确实变化的行。(verification: unit and database — AgentSessionRuntimeService and RootMessageProjection with `setupTestDatabase`; owner: P2 implementer)
- AC8 — 投影更新只携带变化的 part：新增或修改一个 part 不会重发未变化的 part（包括图片），renderer 和 child view 最终得到的消息与整条消息更新时一致。(verification: unit — MessageProjection and renderer projection consumers; owner: P2 implementer)
- AC9 — 进程内原生模型调用不打开 socket；鉴权、内部控制项、用量与 response ID 归属、trace、错误信封、取消和 HTTP 413 等现有网关契约在进程内路径上依然成立；外部调用方继续走 HTTP。(verification: unit — gateway and binding integration tests; owner: P3 implementer)
- AC10 — 能拿到请求对象的原生调用，网关侧不再解析序列化后的请求体；历史中重复出现的图片在首次校验后跳过 base64 和 sharp 解码，补边结果保持一致。(verification: unit — binding and fileProcessor tests; owner: P3 implementer)
- AC11 — 按 #24500 的负载形态（一个会话派发四个大量读取图片的 Durable 子任务），在开发版 Electron 中运行 30 分钟不发生 OOM；报告对照 #24500 基线，记录主进程堆、external 内存和模型调用次数。(verification: Electron; owner: final implementation integrator)
- AC12 — runtime README、observability 和网关参考文档以及本 note 三件套，描述的是实际交付的投递、持久化和传输语义；#24500 中被取代的每一项上限，要么移除，要么有 AC11 的证据说明保留理由。(verification: docs gate; owner: final implementation integrator)

## 风险

- 冻结会把对已投递值的原地修改变成运行时错误。运行时包测试以及 Main 的 agent-session、runtime 和 messages 测试都已通过，但未被测试覆盖的消费者路径仍可能出错；这类错误会停止该观察者并被上报。
- 非普通对象（日期、类型化数组、错误）无法冻结。它们从发布方复制一次，之后以未冻结的形式共享。
- Durable 增量投影依赖原生 view 对未变化的前缀复用 entry 对象。Pi Durable 1.5.2 是这样实现的；如果原生改为返回新对象，只会失去复用，因为身份检查随即触发重建。
- 按需读取把一次行解析移进了每个晚到的变化。一条含有大量内嵌图片的已持久化回复，每收到一个 task event 或后台结果都要付出这次解析。AC11 会测量这一点，它也是重新考虑暂缓的文件引用方案的依据。
- part patch 改变了投影 IPC 协议。Main 和 renderer 一起发布，但每个投影消费方（包括 topic 和 child view）都必须能应用它。
- P3 的进程内派发必须复现 Elysia 错误处理器现在产生的错误信封，否则会改变 Pi 的重试分类。Anthropic 的 `fetch` 注入目前在仓库里没有测试。
- AC11 是开发版的实测，不等于 Windows 安装包的验收。原始 Windows 负载仍需单独验证。
