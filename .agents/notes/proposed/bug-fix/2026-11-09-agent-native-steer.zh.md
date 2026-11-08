# Agent Note: 智能体运行时的原生 steer 交付与回复归属

Status: proposed

[English](2026-11-09-agent-native-steer.md) | 中文

## 问题

在 `27a61a606566fd60800e466ebfd041f858b89f9e`，Claude 输入已经通过异步输入流进入正在运行的 Agent SDK Query。[原生所有者](../../../../packages/agent-runtime-claude-code/src/owner.ts)将 `steer` 映射为 `priority: 'next'`，将 `follow-up` 映射为 `priority: 'later'`。目标行为是原生立即 steer：通过 `priority: 'now'` 将新指令送入同一个 Query，再将其回复显示在 steer 用户消息之后。

已安装的 `@anthropic-ai/claude-agent-sdk@0.3.311` 在 `SDKUserMessage` 上声明了这三种优先级。这只能证明类型支持，不能证明运行时机已经通过验证。改变优先级可能产生 `aborted_streaming` 或 `aborted_tools` 中间结果。当前[控制投影](../../../../packages/agent-runtime-claude-code/src/control.ts)会把活跃的原生结果当作终态，[桌面 driver](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts)可能进一步将其转换为错误或 `turn-complete`。中间结果不能结束 steer 后的回复。

本文负责 Claude Code、Pi 和 Pi Durable 的原生 steer 交付及相应产品回复边界。Claude 需要修改优先级；Pi 和 Pi Durable 已经提交原生 steer，需要验证时序与归属，而不是虚构一个 `now` 标志。本文补充[运行时所有权方案](../simplification/2026-11-05-agent-runtime-boundary-ownership.md)和[内容协议](../simplification/2026-10-29-agent-runtime-content-protocol.md)；输入身份、回复所有权、观察排空、持久化和计费仍以它们的契约为准。本文是拟议行为变更，不代表运行时或 Electron 验证已经完成。

## 方案

### 1. 使用各运行时的原生 steer

共同产品契约是：将 steer 输入交给活跃的原生执行，保留其身份，并将对应回复显示在已放入上下文的用户输入之后。三种运行时都在发送时立即建立视觉边界；提交回执、原生 placement 和权威回复交接仍是不同事件。各原生 API 的调度保证不同：

| 运行时 | 现有提交 | 拟议改动及原生时机 |
| --- | --- | --- |
| Claude Code | 异步输入流进入运行中的 Query，当前为 `priority: 'next'` | 使用 `priority: 'now'`；验证 SDK 对活跃生成和工具的处理。 |
| Pi | `input.submit({ whenBusy: 'steer' })` 映射到原生 prompt 的 `streamingBehavior: 'steer'` | 保留原生 steer；验证在当前助手／工具轮之后、后续模型工作之前 placement。 |
| Pi Durable | `conversation.submit({ type: 'input', whenBusy: 'steer', ... })` | 保留原生 steer；验证当前工具轮之后的已提交 placement，或正常完成先发生时进入后续 run。 |

Pi 和 Pi Durable 1.4.0 的这些 API 没有暴露 Claude 的 `now` 优先级。本文不承诺它们能立即抢占 token 流或正在执行的工具。如果要求各运行时具有相同抢占延迟，应先明确上游 API／执行循环的改动，另行决策。不能用 Stop 后重放、第二套调度器或 renderer 单独改写归属来模拟。

在现有原生所有者内将 `steer` 映射为 `now`。保留 `follow-up` 的 `later`、现有 FIFO 分发、输入 UUID 关联和交付事实。分发确认不等于模型已经消费输入。

不增加 `interrupt()` 调用、不 abort Query，也不重新提交整段会话。立即输入对生成和前台工具的影响由 SDK 决定。首先保留当前 SDK 版本；只有可复现探针确认存在版本限制时才升级，并完成对应补丁审查，将依赖变更范围单独列出。

启动期间收到 steer 时，初始 prompt 的上下文必须保留。提出绕行方案前先用探针验证顺序。如果 SDK 对已接纳输入进行了重排，应先明确上游限制，再选择宿主侧门控；本文不预设延时或第二套输入调度器。

### 2. 在原生所有者内分类 Claude 中间结果

利用现有输入记录和原生请求身份，区分 steer 引起的片段结果、显式 Stop、真实失败和最终完成。仅凭 `aborted_streaming` 或 `aborted_tools` 不足以判断。判定中间结果时保留显式 interrupt 意图和原生关联；旧结果不能结清后继回复。

中间片段的内容、输入结果和调用用量恰好记录一次。同一个 Query 继续接收后续观察。对于已经确认为 steer 中间片段的结果，不发出产品最终完成、错误或已完成回复的 fork checkpoint。真实失败、显式 Stop 和连接丢失仍走既有结清路径。未知交付保持未知，不自动重发。

原生分类归 Claude runtime 包所有。Main 消费已有控制和输入事实，不再次解析 SDK result 帧。现有控制足够时直接复用，不增加第二个终态事实来源。

### 3. 保留 Pi 与 Durable 的原生接纳和完成语义

Pi 保留 `PiRuntimeConnection.redirect()` 及 runtime 包到 `streamingBehavior: 'steer'` 的映射。同步 `input-placed` 回调在下次提供商请求前预留产品归属；捕获的观察中 `placed` 事实驱动 `steer-boundary`。测试这两个时点，确保提前到达的用量或内容不会先于预留，同时 acknowledgment 或 `queued` 不会单独切换可见回复。原生 `followUp` 仍是独立的最终边界策略。

Pi Durable 保留现有 `conversation.submit` 路径，以及原生 entry metadata 中的逻辑输入 ID。`onInputPlaced` 同步预留归属；输入事实和前台完成来自同一份捕获的已提交 `ConversationView`。Main 在对应内容前消费这些事实。接纳与 placement 保持区分，不以状态轮询替代已提交观察，也不把原生 run 的 `done` 单独解释为产品成功。截断、失败／中止输入、未决输入及待回传后台结果保留既有分类。

两种运行时都必须按原生迟到输入行为，保证正常完成前后提交的 steer 仍得到一次回答。多个已放入上下文的输入可以共享回复。未知接纳与重连通过既有身份核对，不重新提交。Durable 重开必须恢复已接纳输入及其原生 placement／结果；正常关闭后的重开证据不代表进程被杀恢复或外部工具副作用恰好执行一次。

本次直接发送路径关注根线程 steer。受管子线程输入继续遵循既有 behavior 入口的接纳和续接规则，包括 Durable 不支持已完成前台子线程续接的限制。不能绕过 behavior 直接 prompt 子线程来伪造各运行时一致。继续观察运行中的子线程，并测试子线程尚在工作时对根线程 steer。

### 4. 立即切换视觉焦点，保留原生回复边界

三种运行时都提供独立于原生调度的视觉 `now`。直接发送 steer 时立即显示用户消息，将当前等待指示器锚定在其下方。A1 已显示的内容保留在原气泡中；只要它仍是前序活跃执行，就暂停其实时刷新。不新增区域、标签或展开／折叠控件。Main 继续接收 A1 的完整投影；原生交接使 A1 离开活跃集合后，同一气泡收敛到该投影。执行仍活跃时保留 Stop，不把焦点或自动滚动拉回 steer 上方。这是展示边界，不是成功完成，也不证明新指令已被消费。

视觉边界绑定既有用户消息与前驱 execution 身份。不创建第二份权威回复记录，不持久化第二份流式内容。临时保留的内容由既有消息投影派生，属于展示状态；在原生交接或分发被拒绝时释放。第二个窗口根据已接纳用户消息及其 execution 关联派生边界。重载根据已保存消息和当前 execution／输入事实恢复；未知 placement 保持可见的等待或未知状态，不用时间戳猜测。

steer 下方的等待行不是虚构的助手回复。原生 placement 经既有状态机建立 A2 后，在同一位置用 A2 的实际流替换等待行，不移动会话锚点。连续发送保持顺序，一次原生响应可以回答多个输入。分发被拒绝时核对 optimistic 行，移除其等待指示器并恢复此前的活跃展示。未知交付保留可恢复状态，不自动重放。Stop 后结清等待展示，迟到数据不能重新激活它。

继续根据原生请求成员关系（包括 `status: requesting`）派生 `input-boundary`，先交付边界，再发布对应回复的内容和用量。[运行时服务](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts)解析输入 ID，[现有 reducer](../../../../src/main/ai/agentSession/agentSessionRuntimeState.ts)负责权威的 A1 到 A2 交接：

1. 原生 placement 之前，内容仍归已有证据确定的原回复；仅送入 steer 不足以确定新响应。
2. 输入边界到达时，结清 A1 的交付，并在 steer 用户消息之后预留 A2，沿用既有回复身份和持久化屏障。
3. A2 挂接期间缓冲其内容，随后交给 A2 的流。A1 的迟到工具结果和用量保留已记录的归属。

多个输入可能共享一次原生响应。保留这种原生 placement，不为每次点击制造空助手消息。新输入、原生 placement、产品回复完成和后台资源生命周期仍是不同事实。

Renderer 按消息和执行身份消费消息投影，负责上述视觉等待与临时暂停刷新行为。Main 在原生边界前继续接收旧 delta，并以 A1 归属持久化。仅发送消息不能改变输出归属或数据库终态。界面文案使用 i18next，组件遵循仓库设计系统。

### 5. 遵循原生工具与 Stop 行为

立即输入可能按 SDK 行为取消前台工具，也可能让工作继续。投影应反映已观察到的结果，不能将取消标成成功，也不能让已经结束的工具持续转圈。后台子线程的观察、结果归属，以及仍有工作属于产品回复时的 Stop 入口继续保留。

不为规避原生取消而静默将所有前台子智能体转到后台。如果真实验收确认需要该策略，应将它对工具和子线程生命周期的影响作为独立产品决策记录。steer 交接期间 Stop 仍优先：排队的宿主启动或迟到回调都不能重新打开已停止回复。

### 6. 按顺序实施与验证

1. 使用固定版本的三种运行时和受控慢速流／工具记录基线；Claude 再以 `now` 重复，Pi／Pi Durable 则记录现有原生 steer 的 placement 时机。记录送入的 UUID、请求成员、结果原因、输入边界、回复内容、工具结果和用量。分别与各运行时的真实提供商会话对照；受控提供商证据不代表真实模型遵循指令。分别报告入队、placement 和后继首段内容，不宣称各运行时在同一时点抢占。
2. 修改 Claude 优先级，并只调整轨迹证明必要的原生结果／控制或 Pi／Pi Durable 接纳处理。将观察到的事件序列和失败情况补入既有 runtime 测试。
3. 使用生产 SQLite migration 验证既有 Main 交接：前驱持久化尚未完成、后继 chunk 提前到达、连续 steer、显式 Stop 和旧回调。只修复已复现的归属缺陷。
4. 实现共享视觉边界以及拒绝／Stop 时的状态核对，再在隔离 Electron 中分别对 Claude、Pi 和 Pi Durable 使用真实提供商验收。人为延迟原生 placement 验证视觉交接，与 placement 后首段内容分别记录。检查可见顺序以及保存的消息／用量，覆盖第二个观察窗口和重开会话。在实现层更新 Claude 包 README 的优先级契约，以及语义上受影响的参考文档。

相关既有测试归属是 `packages/agent-runtime-claude-code/tests/runtime.test.ts`、`packages/agent-runtime-claude-code/tests/projection.test.ts`、`src/main/ai/agentSession/__tests__/agentSessionRuntimeState.test.ts` 和 `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.handoff.test.ts`。Pi 还包括 `packages/agent-runtime-pi/tests/runtime.test.ts`；Durable 还包括 `packages/agent-runtime-pi-durable/tests/runtime.test.ts` 和 `packages/agent-runtime-pi-durable/tests/runMetadata.test.ts`。driver 代码变化时包含受影响的 driver 测试。对改动所有者及受影响消费者使用明确文件过滤。分别记录探针、聚焦测试、Electron、真实提供商和 CI 结果。

普通 Chat 的 AI SDK step 边界续答、原生执行循环／调度器重设计、schema 和通用 renderer transport 不属于本次改动。默认实现范围是 Claude 优先级／结果处理，加上共享即时视觉边界，以及 Pi／Pi Durable 已复现的 steer 缺陷；通过的原生路径需要验收证据，不需要推测性重写。

### 7. UI 实现证据

共享智能体 renderer 在分发返回前加入临时 steer 用户行，将其核对为服务端预留的持久化身份，并在分发被拒绝时移除。前序活跃消息在同一气泡内保留已显示内容，不增加额外区域或控件；原生交接时释放临时视图，恢复完整投影。等待行位于新输入下方，后继行到达或执行停止时消失。原生提交策略和结果分类尚未改变。

聚焦 renderer 测试覆盖内容保留、拒绝恢复、交接释放、跨话题重置、即时显示用户行、接纳行去重及受影响的列表／parts／provider 消费者。受控 Electron 验证提供延迟 placement 的 renderer 状态，不执行原生提供商。简化 UI 的证据单独记录在已忽略的 `.context/cherry-electron-dev/steer-simple-evidence.json` 及对应截图。这是 AC12 的部分证据，不代表各运行时原生、工具、多窗口或持久化验收完成。Spec 继续保持 proposed。


后续真实提供商 Electron 会话通过 Claude Agent SDK、Pi 和 Pi Durable 使用 DeepSeek Flash。Pi 和 Pi Durable 在运行中的工具返回后遵从已放置的 steer，普通排队消息随后依次执行。三个运行时均完成了压缩期间提交输入的手动压缩场景；在这些场景内未观察到显式 interrupt 或连接替换。这不验证 Claude `now`、自动压缩或原生 SDK 内部的取消行为。一个 Claude 工具场景继续执行旧计划，没有遵从 steer。Pi 在第一条 steer 仍等待时接纳了另一条 steer，因此尚未实现只允许一条待接续 steer 的准入规则。

renderer 还将仅包含压缩锚点的助手行呈现为带文字的独立分隔行。空的 paused 行使用居中的中断分隔行；包含实际回答、推理或工具内容的行保留消息外框。这些改动基于现有 parts／status 展示，不引入新的 timeline 或持久化事件存储。已在 Electron 检查历史刷新和真实 Pi Stop 场景。

当前等待提示由 pending topic 的最后一个可见行是用户消息这一条件推导，并不是权威的输入准入或原生 placement 事实。由 Main 统一处理压缩、待接续 steer 和跨 session 投递的准入仍属于后续工作；本草稿不声称 renderer 推导已覆盖所有这些路径。

## 考虑过的替代方案

- 要求统一的 `now` 标志：Pi 和 Pi Durable 的原生调度契约不同，这会虚构能力，或要求尚未批准的上游执行循环改动。
- 保留 Claude `next`：维持当前等待行为，无法满足立即 steer 意图。
- 显式 Stop 后重新请求：对运行中 Query 已支持的操作额外引入取消和重发语义。
- 只改优先级：可能把中间 aborted 片段解释为最终失败或完成；是否还需修复结果处理，必须由原生轨迹证明。
- 发送时立即把旧 delta 改归 A2：推测 placement，并把旧输出分配给新输入。即时视觉焦点与临时暂停刷新可以在不改变内容归属的前提下提供反馈。
- 等待原生 placement 后才响应界面：没有必要将界面反馈绑定到运行时的模型／工具调度延迟。
- 忽略所有 aborted 结果：掩盖显式 Stop 和无关失败，可能让会话一直等待。

## 验收标准

- AC1 — 在受控活跃流中 steer，以 `now` 进入同一原生 Query，并能在原生成完成前改变回复；真实 Claude 验收确认新指令得到遵循。(verification: 原生 SDK 探针与 Electron — 实现者)
- AC2 — 已关联的 steer 中间 aborted 结果不会阻断后续回复交付，真实错误和显式 Stop 仍产生可观察的终态。(verification: runtime 回归测试与原生 SDK 探针 — 实现者)
- AC3 — steer 后的内容显示在对应用户消息之后，没有丢字或重复；前回复的迟到内容和用量不迁入 A2，包括 A1 持久化被阻塞的情况。(verification: Main SQLite 交接测试与 Electron — 实现者)
- AC4 — 快速连续 steer 保留原生输入顺序和响应成员关系，不重复提交、不制造空回复；普通 follow-up 仍以 `later` 等待。(verification: runtime 回归测试与原生 SDK 探针 — 实现者)
- AC5 — 启动阶段的 steer 保留初始 prompt 上下文，被拒绝或未知的提交可以恢复且不自动重放。(verification: 原生 SDK 探针与 Main 回归测试 — 实现者)
- AC6 — 前台工具或子线程工作期间 steer，显示实际原生工具结果，保留继续运行的子线程结果归属，不遗留活跃指示器。(verification: 原生 SDK 探针与真实 Claude Electron 验收 — 实现者)
- AC7 — 交接期间 Stop 阻止回复重新打开；旧回调或连接丢失事件不能修改后继连接。(verification: Main 交接与 reducer 测试 — 实现者)
- AC8 — 两个观察窗口及重开的会话对已保存消息顺序、工具状态和用量保持一致，每次调用只计费一次。(verification: Electron 与 SQLite 检查 — 实现者)

- AC9 — Pi 原生 steer 在支持的边界、后续模型工作之前 placement，其回复进入 A2，不自动 interrupt、不重复输入，也不因 acknowledgment 提前切换；原生 follow-up 保持独立。(verification: Pi runtime 测试、原生探针与真实提供商 Electron 验收 — 实现者)
- AC10 — Pi Durable 已接纳 steer 经历正常完成竞态和正常关闭后重开仍保留，得到一次回答，并保持捕获的 placement／完成及用量；截断和取消仍可见。(verification: Durable runtime／run-metadata 测试、原生探针与 SQLite／Electron 检查 — 实现者)
- AC11 — Claude、Pi 和 Pi Durable 分别通过 AC3 及 AC5 至 AC8，记录各运行时的 placement 和工具行为；一种运行时通过不能替代另一种。(verification: 各运行时验收矩阵 — 实现者)

- AC12 — 三种运行时在发送 steer 后立即显示用户行及其下方等待指示器；即使 placement 被阻塞，前驱新文本也不再作为当前回答显示或将滚动拉回上方，已有内容和工具卡片保留在原气泡中，原生交接结束临时保留后，同一气泡收敛到完整投影。拒绝、连续发送、Stop、第二窗口及重载均能核对视觉边界，不改变原生归属、不重放输入。(verification: 聚焦 renderer 测试及各运行时延迟 placement 的 Electron 验收 — 实现者)

## 风险

Claude SDK 类型支持和 Pi／Pi Durable 原生 steer API 都不能证明事件顺序、指令遵循或前台工具行为。Pi／Pi Durable 可能等待较长的原生模型／工具轮；这是明确的能力限制，不是 renderer 缺陷的证据。判定只改优先级是否足够之前，必须执行原生探针。轨迹不足以确定因果时，应分别报告网关／模型行为与 SDK 调度。

中间结果可能与显式 Stop、原生 placement、最终持久化和连接替换竞态。分类必须保留输入／请求身份和既有 generation 隔离；经过的时间和最新可见消息都不足以作为证据。

此前运行时所有权方案记录过 Claude steer 回复归属通过、指令遵循未通过的情况。本次必须重新证明这两个性质。文档检查和合成回放不能完成真实 Claude 或 Electron 验收。
