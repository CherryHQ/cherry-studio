# Agent Note: 智能体请求的多图能力上限

Status: implemented

[English](2026-11-19-agent-multi-image-limits.md) | 中文

## 问题

包含多张图片的智能体请求在上游失败，报错 `At most 1 image(s) may be provided in one prompt`，且失败发生时付费请求已经发出。聊天路径可以容忍多图（原生视觉输入或 OCR 回退），但智能体轮次通过各运行时特有的通道转发附件——Pi 与 Pi-Durable 以绝对路径交由智能体用工具读取，Claude Code 以原生 Anthropic 图片块发送——缺少统一的图片定义、缺少按模型的上限，也缺少发送前校验。被拒绝轮次的重试行为未经验证。

## 决策

`src/shared/ai/agentImageLimits.ts` 提供统一的图片判定与保序计数，供消息体、运行时载荷与 composer 附件共用。`resolveMaxAgentImages` 读取生产级 `Model` 契约（`src/shared/data/types/model.ts` 的 `Model.maxAgentImages`）：显式声明的单模型上限优先；无声明的视觉模型不限量（受支持的模型按用户顺序收到全部图片）；非视觉模型沿用现有优雅回退（OCR 文本、路径引用、Read 守卫），不新增拦截。`ModelService.customRowToRuntimeModel` 与 `ProviderRegistryService.mergePresetModel` 防御性透传上限（未来目录/覆盖/DB 值可直接生效；当前尚无提供商声明），`enrichRowsFromRegistryTx` 为自定义模型继承目录上限。`assertAgentImageLimit` 抛出携带实际上限、数量与 `sent` 标记的 `AgentImageLimitError`；上游 `At most N image(s)` 解析器把提供商拒绝转换为同一错误形状，结果边界失败使用 `sent: true`。

校验发生在任何付费提供商请求之前、任何 DB 写入之前。`AgentChatContextProvider.validateDispatch` 按轮次模型校验图片数量，`prepareAgentSessionDispatch` 在忙碌分支 `saveMessage` 前与空闲分支 `persistDispatchTx` 前复查，因此超限提交不会留下已提交的用户消息或无流结算的待定助手消息；`enqueue`/`beginTurn` 竞态导致已提交时按最佳努力删除刚写入的行且以上限错误为准。渲染层 composer 在 `handleSendDraft` 直接拦截，并在 follow-up 出队执行的 `sendQueuedPayload` 中复查，避免排队期间更换模型造成漏检。主进程 `AgentSessionRuntimeService` 在 `beginTurn`、`enqueueUserMessage` 与 `admitTurn` 三处校验，覆盖 composer 发送、重试、follow-up、steer 以及各通道与远端输入，适用于全部运行时；`admitTurn` 按轮次捕获的 `turn.modelId` 校验（与存活轮次的 `connectionTarget` 一致），因此连接打开期间变更智能体默认模型不会错误重审正在打开的轮次。Claude Code 额外在构造原生图片块之前拦截（早于文件 IO 与 SDK 调用），归一化携带上游上限的 SDK 准入拒绝，并通过 `normalizeResultImageLimitFailure` 使用最近提交的图片数量归一化提供商 `result` 失败（已发送措辞）。被拒绝的发送前轮次保留草稿与历史，重试时附件与指令完整。四个文案（`agent.image_limit_exceeded`、`error.agent_image_limit_exceeded`、`error.agent_image_limit_exceeded_after_send`、`error.agent_image_limit_detail`）已在全部 18 个语言目录中翻译。

## 备选方案

- 静默丢弃或降采样多余图片：未经用户同意丢失数据；已拒绝。
- 按轮次自动拆分发送：破坏需要同屏对比与多截屏的语义；最终选择带上限提示的拦截。
- 在 provider-registry 新增聊天图片上限字段：目前没有提供商声明该元数据，兼容与版本成本更高；`Model.maxAgentImages` 契约加防御性透传即可保留扩展点，未来目录/DB 值可直接生效，无需改动调用处。
- 转换 Pi 轮次中工具读取图片的失败：Pi 通过工具懒加载读取图片，只有初始附件可做发送前校验，其余情况仍经已发送归一化展示实际上限而非原始透传文本。

## 影响

默认行为不变：没有声明上限时，各运行时按顺序转发全部附件图片。只有在声明了上限或上游拒绝指明上限时才关闭发送。发送前校验在 DB 写入之前执行，超限轮次不会留下孤立用户消息、待定助手消息或远端预留；结果边界使用已发送措辞（`sent: true`，`error.agent_image_limit_exceeded_after_send`）表明请求已经发出。非视觉模型的回退行为不受影响；绘画页 `maxInputImages` 仍是独立的图片生成配置。

## 验证

- Regression — `src/shared/ai/__tests__/agentImageLimits.test.ts`：单图、多图与超限输入；解析器默认值与 `Model` 契约声明值（`ModelSchema` 解析 `maxAgentImages`）；上游上限解析；已发送结果归一化（`sent: true`，`after_send` 文案）。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`：单图准入、建轮前拒绝且不创建记录、多图保序、入队拒绝且队列为空；生产契约拦截（schema 合法模型在 provider 调用前阻断）；打开期间变更默认模型时仍按打开轮次模型准入。
- Regression — `src/main/ai/streamManager/context/__tests__/AgentChatContextProvider.test.ts`：超限空闲分发不提交任何行且不到达 `beginTurn`；超限忙碌分发不保存用户行且不入队；`enqueue`/`beginTurn` 竞态在保存/持久化后拒绝时删除刚提交的行。
- Regression — `src/main/ai/runtime/__tests__/agentUserContent.test.ts`：Pi/Durable 按用户顺序转发全部图片与非图片附件。
- Regression — `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`：提供商结果上限归一化为类型化已发送 `AgentImageLimitError`；无关失败与未知数量直接透传。
- Regression — `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`：超限发送被拦截并提示上限且保留草稿；无声明上限时多图正常发送。
- Regression — `src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts`：纯文本准入路径不变。
- Regression — 全部改动文件 `npx oxlint --deny-warnings`；node 与 web 工程 `tsrs --noEmit`；`npx tsx scripts/i18n-check.ts`（124,546 条翻译 + 全部 18 目录的 `after_send` 新键）。
