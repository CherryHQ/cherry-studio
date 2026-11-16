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

目标：每张图片在宿主中的成本是 O(1)，而不是 O(历史 × 变化次数 × 观察者数 × 调用次数)。模型看到的内容保持不变，不截断历史，不重发任务。P1 和 P3 作为独立的 stacked layer 交付，各自单独上线也有收益。P2 移到单独的提案。

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

### P2 — 移到单独的提案

产品回复行把一个 `parts` 数组整个存成 JSON，原生 source 按 offset 和 count 映射进去。这个存储单位迫使 Main 常驻回复正文以便重建整行，对整条消息做深比较才能找出变化，通过投影 IPC 整条重发；又因为没有持久化的、带序号的事件可供恢复，只能把观察帧留在内存里。根治需要把工具调用等内容存成按 ID 寻址的独立记录，并用带序号的事件日志做恢复。这是涉及数据迁移的 schema 和协议变更，因此单独提案。只在 root projection 常驻索引、把图片转成文件引用，都是绕着同一个存储单位做的，本提案不采用。

### P3 — 历史图片只校验一次

每次原生 Pi 模型调用都会经过内部网关，`prepareChatMessages` 会把历史中每张没有 `fileEntryId` 的图片做 base64 解码，再用 sharp 做一次严格的完整像素解码（[fileProcessor](../../../../src/main/ai/messages/fileProcessor.ts) 中的 `materializeNativeFilePart`）。这个判断只取决于图片内容和媒体类型，却在每次调用时重复。

- `materializeNativeFilePart` 按内容摘要和媒体类型缓存判断结果：有效、拒绝，或补边后的替换值。
- 重复出现的图片因此跳过 base64 解码和 sharp 解码，每次调用只剩计算摘要的开销。
- 缓存有上限，除了很小的补边结果外不保存图片内容，也不改变任何判断结果。

#24500 的载荷准入保持不变。

## 考虑过的替代方案

- 把 #24500 的上限作为最终状态：否决。剩下的每份副本仍然和历史一样大，单次变化的工作量仍是 O(历史)。上限只是给乘数封顶，单个超大帧或超大请求依然可以通过。
- `ThreadFeed` 继续复制，只把 Durable 改为增量：否决。每个观察者的副本和完整恢复快照仍然存在，而正是这些副本让慢观察者长期占着整份历史。
- 共享值但不冻结：否决。其他观察者或发布者对值的修改，会从立即报错变成悄无声息的数据损坏。
- 用每个观察者的合并机制（脏消息 ID + 有序事实队列）取代帧队列，并让 Durable 发布 upsert：暂缓。各帧共享值之后，一个积压帧只占指针而不是历史。合并还会改变投递次数、completion 顺序和恢复语义，而这些已经由 #24500 和回复归属工作验证过。
- 裁剪或降采样历史图片：否决，因为这会改变模型看到的上下文。
- 对历史图片使用 provider 文件 API（Anthropic、OpenAI、Gemini 的文件 ID）：暂缓。它能进一步缩小请求，但依赖 provider 支持，上传的生命周期和隐私问题也需要产品决策。
- 自定义 Pi `streamSimple`，把 Pi 上下文直接转成 Cherry 消息：暂不采用。它能去掉最多的副本，但会重新引入 [harness 边界](2026-10-17-agent-harness-boundaries.md) 决策已经删除的那类进程内专用模型协议，还需要重新实现 thinking 回放、工具配对、cache control 和重试错误形状。
- 把原生运行时移到 utility process：暂缓。它能限制 OOM 的影响范围，但不减少副本。P1 完成后观察流量会变得很小，届时评估这一项的成本会低得多。
- 进程内派发原生模型调用、不走回环 socket，并把 Pi 的请求对象直接交给网关、不再解析请求体：暂缓。它们省掉的副本在每次调用结束后就释放，只在多个子代理同时调用时抬高内存峰值；而进程内路径必须精确复刻网关的鉴权、错误信封和取消行为。如果 AC7 显示请求路径的内存峰值仍有问题，再重新评估。

## 验收标准

- AC1 — ThreadFeed 对每个发布值只存储并投递一份冻结副本：所有观察者收到同一批对象，修改已投递或已存储的值会抛错且不影响其他观察者，发布方之后的修改不会改变已发布的值。(verification: unit — `packages/agent-runtime` observation and immutable tests; owner: P1 implementer)
- AC2 — 停滞观察者的积压帧共享历史：对一份 2,000 条消息的历史重新发布 90 次快照，保留内存低于 16 MiB 且全部投递；两个共享同一张 9 MiB 图片的积压终态帧不会关闭观察；按条数溢出、`source-lost` 和基线优先的顺序保持不变。(verification: unit with heap measurement; owner: P1 implementer)
- AC3 — Durable 在每个原生窗口内对每个已提交 entry 只投影一次：未变化的消息在各 view 间保持对象身份；之后的工具结果或实时进度只复制受影响的消息，不改变更早的快照或已提交层；不延续上一份 entry 的 view 会重建。(verification: unit — Durable projection with native view shapes; owner: P1 implementer)
- AC4 — 观察事件、顺序、completion 捕获、恢复和回复归属保持不变：现有的运行时包测试，以及 Main 的 agent-session、runtime 和 messages 测试全部通过。(verification: unit — package suites and scoped Main tests; owner: P1 implementer)
- AC5 — Main 投影对未变化的来源直接复用上一次的 view，不再重新装饰；显式失效仍会重新装饰。停滞的 Claude 观察者在 2,000 条原生消息上积压 90 个关键帧时，保留内存低于 16 MiB；Pi 原生事实在发出后被修改时，仍按发出时的内容投影。(verification: unit — ThreadMessageProjection, Claude observation, Pi runtime projection; owner: P1 implementer)
- AC6 — 在多次原生模型调用中重复出现的历史图片，只在首次校验时做 base64 和 sharp 解码；有效、拒绝和补边的结果与不使用缓存时一致，缓存大小有上限。(verification: unit — fileProcessor tests; owner: P3 implementer)
- AC7 — 按 #24500 的负载形态（一个会话派发四个大量读取图片的 Durable 子任务），在开发版 Electron 中运行 30 分钟不发生 OOM；报告对照 #24500 基线，记录主进程堆、external 内存和模型调用次数。(verification: Electron; owner: final implementation integrator)
- AC8 — runtime README、observability 和网关参考文档以及本 note 三件套，描述的是实际交付的投递和校验语义；#24500 中被取代的每一项上限，要么移除，要么有 AC7 的证据说明保留理由。(verification: docs gate; owner: final implementation integrator)

## 风险

- 冻结会把对已投递值的原地修改变成运行时错误。运行时包测试以及 Main 的 agent-session、runtime 和 messages 测试都已通过，但未被测试覆盖的消费者路径仍可能出错；这类错误会停止该观察者并被上报。
- 非普通对象（日期、类型化数组、错误）无法冻结。它们从发布方复制一次，之后以未冻结的形式共享。
- Durable 增量投影依赖原生 view 对未变化的前缀复用 entry 对象。Pi Durable 1.5.2 是这样实现的；如果原生改为返回新对象，只会失去复用，因为身份检查随即触发重建。
- AC7 是开发版的实测，不等于 Windows 安装包的验收。原始 Windows 负载仍需单独验证。
- 校验缓存信任内容摘要：摘要碰撞会复用另一张图片的判断。使用密码学摘要，碰撞在实际中不会发生。
