# Agent Note: 智能体请求的多图能力上限

Status: implemented

[English](2026-11-19-agent-multi-image-limits.md) | 中文

## 问题

包含多张图片的智能体请求在上游失败，报错 `At most 1 image(s) may be provided in one prompt`，且失败发生时付费请求已经发出。聊天路径可以容忍多图（原生视觉输入或 OCR 回退），但智能体轮次通过各运行时特有的通道转发附件——Pi 与 Pi-Durable 以绝对路径交由智能体用工具读取，Claude Code 以原生 Anthropic 图片块发送——缺少统一的图片定义、缺少按模型的上限，也缺少发送前校验。被拒绝轮次的重试行为未经验证。

## 决策

`src/shared/ai/agentImageLimits.ts` 提供统一的图片判定与保序计数，供消息体、运行时载荷与 composer 附件共用。`resolveMaxAgentImages` 读取生产级 `Model` 契约（`src/shared/data/types/model.ts` 的 `Model.maxAgentImages`）：显式声明的单模型上限优先；无声明的视觉模型不限量（捆绑的 provider-registry 0.8.0 目录未声明任何上限，因此捆绑数据下预检为无操作，仅当部署声明上限或上游拒绝指明上限时才拦截（受支持的模型收到全部图片；Pi/Durable 保持用户顺序，Claude 原生块因路由可能先发托管图片）；非视觉模型沿用现有优雅回退（OCR 文本、路径引用、Read 守卫），不新增拦截。`ProviderRegistryService.mergePresetModel` 与 `applyPresetAndOverride` 透传目录拥有的上限（`ModelConfig.maxAgentImages` 与 `ProviderModelOverride.limits.maxAgentImages`，兼容顶层别名），`enrichRowsFromRegistryTx` 为自定义模型继承目录上限；自定义行无目录值时仍不限量。`assertAgentImageLimit` 抛出携带实际上限、数量与 `sent` 标记的 `AgentImageLimitError`；上游 `At most N image(s)` 解析器把提供商拒绝转换为同一错误形状，仅 Claude Code 结果边界失败使用 `sent: true`——Pi/Pi-Durable 轮中工具读取失败沿用原有错误路径。

校验发生在任何付费提供商请求之前、任何 DB 写入之前。`AgentChatContextProvider.validateDispatch` 按轮次模型校验图片数量，`prepareAgentSessionDispatch` 在忙碌分支 `saveMessage` 前与空闲分支 `persistDispatchTx` 前复查，编辑路由在 fork 事务内复查使超限替换回滚并保留原始行；因此超限提交不会留下已提交的用户消息或无流结算的待定助手消息；`enqueue`/`beginTurn` 竞态导致已提交时按最佳努力删除刚写入的行且以上限错误为准。渲染层 composer 在 `handleSendDraft` 直接拦截，并在 follow-up 出队执行的 `sendQueuedPayload` 中复查（同时计数附件与预构建文件分片，覆盖 Resend），主侧拒绝经 IPC 保留类型化上限（AI_REQUEST_FAILED 携带 serializeError 数据，渲染层经 aiErrorDetail 恢复）并展示本地化上限提示且保留草稿；通道侧发送主进程目录的本地化上限文案（`channel.agent_image_limit_exceeded` / `channel.agent_image_limit_exceeded_after_send`，含 `{{limit}}`/`{{count}}`）而非通用处理错误或硬编码英文 `AgentImageLimitError.message`。主进程 `AgentSessionRuntimeService` 在 `beginTurn`、`enqueueUserMessage` 与 `admitTurn` 经 `assertRuntimeAgentImageLimit` 三处校验，覆盖 composer 发送、重试、follow-up、steer 以及各通道与远端输入，适用于全部运行时；`admitTurn` 按轮次捕获的 `turn.modelId` 校验（与存活轮次的 `connectionTarget` 一致），因此连接打开期间变更智能体默认模型不会错误重审正在打开的轮次。含历史回放的准入按运行时区分：Pi/Durable 按原始计数（`buildAgentUserContent` 转发全部 `file://` 路径，因此无存活 token 的工作区 PNG 回放仍拦截）；Claude 仅计数原生块候选（`countClaudeNativeImageParts`：已路由托管图片加可转为原生块的工作区外部图片，`canBeClaudeNativeImagePart` 判定；被路由丢弃的孤立托管历史放行，AVIF/HEIC 走路径回退不计数）。无 `fileEntryId` 的外部/工作区引用恒为已路由（`isRoutedAgentImagePart`），因此双工作区 PNG 回放在 `connection.send` 之前失败，草稿完整且不打开流。Claude Code 额外在构造原生图片块之前拦截（早于文件 IO 与 SDK 调用，经共享 `canBeClaudeNativeImagePart` 与门控计数一致），归一化携带上游上限的 SDK 准入拒绝，并通过 `consumePendingImageCount`（按提交顺序取首个超限，双图失败时保留未放置的五图 steer，原生 UUID 关联仍为 TODO；纯文本 steer 不会覆盖待定图片计数，回放块计入，已发送措辞）归一化提供商 `result` 失败。远端将类型化上限映射为 rejected/CONFLICT 并携带 limit/count，而非 interrupted/INTERNAL。被拒绝的发送前轮次保留草稿与历史，重试时附件与指令完整。渲染层文案（`agent.image_limit_exceeded`、`error.agent_image_limit_exceeded`、`error.agent_image_limit_exceeded_after_send`、`error.agent_image_limit_detail`）与主进程通道文案（`channel.agent_image_limit_exceeded`、`channel.agent_image_limit_exceeded_after_send`）已在全部 18 个语言目录中翻译，`serializeError` 保留 limit/count/runtime/sent 与 i18n 键以便跨 IPC 渲染。

## 备选方案

后续加固（PR #24918 评论）：`isManualCompactParts` 按 `\n` 连接全部文本后对修剪结果匹配 `^\/compact`，并带 `systemReminder`/`hasDelivery` 守卫，与 `buildAgentUserContent` 一致（`Compare these` + `/compact` 分片与带投递前缀的 `/compact` 按普通轮次拦截，真正的 `/compact` 仍走压缩）；编辑分发先只校验新分片，历史校验延后到事务内保留前缀检查（初检 tip 包含被替换消息，纯文本删除工作区 PNG 可通过）；Claude composer 门控只计原生块候选（`countClaudeNativeImageAttachments` / `countClaudeNativeFileParts` 经 `canBeClaudeNativeImagePart`，无 MIME 时已知非原生扩展同样不计数，PNG+TIFF 可通过单图原生上限）；`consumePendingImageCount` 无关失败按 FIFO（`shift`，与 turn-complete 一致）结算，保留等待中的 steer 零值供下次上限使用；无上限模型直接返回并跳过历史扫描（有限上限不存在时两次检查均为无操作，零 SQLite 路径读取）。

- 静默丢弃或降采样多余图片：未经用户同意丢失数据；已拒绝。
- 按轮次自动拆分发送：破坏需要同屏对比与多截屏的语义；最终选择带上限提示的拦截。
- 在 provider-registry 新增聊天图片上限字段：已实现为目录拥有的 `ModelConfig.maxAgentImages` 与 `ProviderModelOverride.limits.maxAgentImages`（无 user_model 列、无 DB 迁移）；既有预置行下次读取即继承。
- 转换 Pi 轮次中工具读取图片的失败：Pi 通过工具懒加载读取图片，只有初始附件可做发送前校验；Pi/Durable 工具读取失败沿用原有错误路径，不经 Claude 专用的已发送归一化。

## 影响

默认行为不变：没有声明上限时，Pi/Durable 按用户顺序转发全部附件图片，Claude 转发全部受支持图片（原生路由可能将托管图片排在前面）。只有在声明了上限或上游拒绝指明上限时才关闭发送。发送前校验在 DB 写入之前执行（编辑路由在事务内复查；编辑初检只查新分片，事务内查保留前缀），超限轮次不会留下孤立用户消息、待定助手消息或远端预留；无上限空闲发送跳过历史扫描（零路径读取）；远端将类型化上限映射为 rejected/CONFLICT；结果边界使用已发送措辞（`sent: true`，`error.agent_image_limit_exceeded_after_send`，仅 Claude）表明请求已经发出，FIFO 结算保留未放置 steer。非视觉模型的回退行为不受影响；绘画页 `maxInputImages` 仍是独立的图片生成配置。渲染层与主进程共用同一 `AGENT_IMAGE_EXTS` 计数定义（共享 `imageExts` 外加 AVIF/HEIC/HEIF/TIFF），两侧在创建托管副本前计数一致；Claude composer 门控进一步只计原生块候选（无 MIME 时 TIFF/AVIF/HEIC/BMP 同样不计数，未知扩展延后到物化）；共享路由表保持不变，因此非视觉 AVIF/HEIC 仍走本地路径回退，不会误入 OCR。手动 `/compact` 与驱动的连接后提示谓词一致（含投递前缀时按普通轮次拦截）。

## 验证

- Regression — `src/shared/ai/__tests__/agentImageLimits.test.ts`：单图、多图与超限输入；解析器默认值与 `Model` 契约声明值（`ModelSchema` 解析 `maxAgentImages`）；上游上限解析；已发送结果归一化（`sent: true`，`after_send` 文案）。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`：单图准入、建轮前拒绝且不创建记录、多图保序、入队拒绝且队列为空；生产契约拦截（schema 合法模型在 provider 调用前阻断）；打开期间变更默认模型时仍按打开轮次模型准入。
- Regression — `src/main/ai/streamManager/context/__tests__/AgentChatContextProvider.test.ts`：超限空闲分发不提交任何行且不到达 `beginTurn`；超限忙碌分发不保存用户行且不入队；`enqueue`/`beginTurn` 竞态在保存/持久化后拒绝时删除刚提交的行。
- Regression — `src/main/ai/runtime/__tests__/agentUserContent.test.ts`：Pi/Durable 按用户顺序转发全部图片与非图片附件。
- Regression — `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`：提供商结果上限归一化为类型化已发送 `AgentImageLimitError`；无关失败与未知数量直接透传。
- Regression — `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`：超限发送被拦截并提示上限且保留草稿；无声明上限时多图正常发送。
- Regression — `src/shared/ai/__tests__/agentImageLimits.test.ts`：路由计数忽略孤立托管历史，纯文本续发通过而路由超限被拦截；无存活 token 的工作区 PNG 计为已路由。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`：含历史的路由门控放行孤立历史并拦截路由历史；工作区 PNG 回放对 Pi/Pi-Durable/Claude 在分发前拦截，孤立托管历史仅对 Claude 放行。
- Regression — `src/shared/ai/__tests__/agentImageLimits.test.ts`：Claude 原生计数包含工作区 PNG，排除 AVIF（路径回退）与孤立托管历史；`assertRuntimeAgentImageLimit` 区分 Pi 原始计数与 Claude 原生计数。
- Regression — `src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`：`consumePendingImageCount` 报告最早超限并保留未放置 steer；无关失败按 FIFO（`shift`）结算并为下次上限保留 steer 零值（inv_514fd05454a94c72）。
- Regression — `src/shared/ai/__tests__/agentImageLimits.test.ts`：连接后提示的 `/compact` 谓词含投递/systemReminder 守卫（`Compare these` + `/compact` 分片与带投递前缀的 `/compact` 拦截，真正的 `/compact` 放行；inv_a799a7c78eb893f7）；无 MIME 时 TIFF/AVIF/BMP 不计入 Claude 原生，未知 `.jpe` 延后计数，PNG+TIFF 可通过单图原生上限（inv_129fa9c831baabe0）。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`：Pi/Pi-Durable 对分片与带投递前缀的 `/compact` 按普通轮次拒绝（inv_a799a7c78eb893f7）。
- Regression — `src/main/ai/streamManager/context/__tests__/AgentChatContextProvider.test.ts`：分片/投递 `/compact` 拦截而真正 `/compact` 放行（inv_a799a7c78eb893f7）；删除工作区 PNG 的纯文本编辑经新分片初检 + 保留前缀事务检查通过（inv_e5b3b1538d5182fc）；无上限空闲发送跳过历史扫描（零 `readAgentSessionPath` 调用；inv_c23ccc3159f3a2b9）。
- Regression — `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`：Claude PNG+TIFF 通过单图原生上限（inv_129fa9c831baabe0）。
- Regression — `src/main/ipc/handlers/__tests__/ai.test.ts`：`ai.stream.open` 经 `AI_REQUEST_FAILED` 与 `aiErrorDetail` 保留 limit/count。
- Regression — `src/main/ai/channels/__tests__/ChannelMessageHandler.test.ts`：通道准入发送主目录本地化上限文案并携带 limit/count（含 zh-CN 非英文断言）。
- Regression — `src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts`：纯文本准入路径不变。
- Regression — 全部改动文件 `npx oxlint --deny-warnings`；node 与 web 工程 `tsrs --noEmit`；`npx tsx scripts/i18n-check.ts`（125,158 条翻译 + 全部 18 主目录的 `channel.agent_image_limit_exceeded(_after_send)` 新键）。
