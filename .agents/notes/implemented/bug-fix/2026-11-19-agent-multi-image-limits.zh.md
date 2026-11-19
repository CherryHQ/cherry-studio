# Agent Note: 智能体请求的多图能力上限

Status: implemented

[English](2026-11-19-agent-multi-image-limits.md) | 中文

## 问题

包含多张图片的智能体请求在上游失败，报错 `At most 1 image(s) may be provided in one prompt`，且失败发生时付费请求已经发出。聊天路径可以容忍多图（原生视觉输入或 OCR 回退），但智能体轮次通过各运行时特有的通道转发附件——Pi 与 Pi-Durable 以绝对路径交由智能体用工具读取，Claude Code 以原生 Anthropic 图片块发送——缺少统一的图片定义、缺少按模型的上限，也缺少发送前校验。被拒绝轮次的重试行为未经验证。

## 决策

`src/shared/ai/agentImageLimits.ts` 提供统一的图片判定与保序计数，供消息体、运行时载荷与 composer 附件共用。`resolveMaxAgentImages` 按能力解析：显式声明的单模型上限优先；无声明的视觉模型不限量（受支持的模型按用户顺序收到全部图片）；非视觉模型沿用现有优雅回退（OCR 文本、路径引用、Read 守卫），不新增拦截。`assertAgentImageLimit` 抛出携带实际上限与数量的 `AgentImageLimitError`；上游 `At most N image(s)` 解析器把提供商拒绝转换为同一错误形状。

校验发生在任何付费提供商请求之前。渲染层 composer 在 `handleSendDraft` 直接拦截，并在 follow-up 出队执行的 `sendQueuedPayload` 中复查，避免排队期间更换模型造成漏检。主进程 `AgentSessionRuntimeService` 在 `beginTurn`、`enqueueUserMessage` 与 `admitTurn` 三处校验，覆盖 composer 发送、重试、follow-up、steer 以及各通道与远端输入，适用于全部运行时。Claude Code 额外在构造原生图片块之前拦截（早于文件 IO 与 SDK 调用），并归一化携带上游上限的 SDK 准入拒绝。被拒绝的轮次保留草稿与历史，重试时附件与指令完整。三个文案（`agent.image_limit_exceeded`、`error.agent_image_limit_exceeded`、`error.agent_image_limit_detail`）已在全部 18 个语言目录中翻译。

## 备选方案

- 静默丢弃或降采样多余图片：未经用户同意丢失数据；已拒绝。
- 按轮次自动拆分发送：破坏需要同屏对比与多截屏的语义；最终选择带上限提示的拦截。
- 在 provider-registry 新增聊天图片上限字段：目前没有提供商声明该元数据，兼容与版本成本更高；防御性按模型读取即可保留扩展点，无需改动目录。
- 转换 Pi 轮次中工具读取图片的失败：Pi 通过工具懒加载读取图片，只有初始附件可做发送前校验，其余情况仍展示提供商原始上限文本。

## 影响

默认行为不变：没有声明上限时，各运行时按顺序转发全部附件图片。只有在声明了上限或上游拒绝指明上限时才关闭发送。非视觉模型的回退行为不受影响；绘画页 `maxInputImages` 仍是独立的图片生成配置。

## 验证

- Regression — `src/shared/ai/__tests__/agentImageLimits.test.ts`：单图、多图与超限输入；解析器默认值与声明值；上游上限解析。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`：单图准入、建轮前拒绝且不创建记录、多图保序、入队拒绝且队列为空。
- Regression — `src/main/ai/runtime/__tests__/agentUserContent.test.ts`：Pi/Durable 按用户顺序转发全部图片与非图片附件。
- Regression — `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`：超限发送被拦截并提示上限且保留草稿；无声明上限时多图正常发送。
- Regression — `src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts`：纯文本准入路径不变。
- Regression — 全部改动文件 `npx oxlint --deny-warnings`；node 与 web 工程 `tsrs --noEmit`；`npx tsx scripts/i18n-check.ts`（124,546 条翻译）。
