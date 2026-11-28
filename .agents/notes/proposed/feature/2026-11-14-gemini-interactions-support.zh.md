# Agent Note: 无状态 Gemini Interactions 与原生回放

Status: proposed

[English](2026-11-14-gemini-interactions-support.md) | 中文

## Problem

基线为 `f62d636d5b1e75378ae6ba848456cebd2e73a6b8`，已包含 PR #24517（Google SDK `3.0.146`、Hydrogen 和 Pi XHIGH）及 PR #24476（Carbon 和保存的用户推理默认值）。它们是已有前提，不是本提案的实现任务。Carbon 缺失的独立 search/URL 选择器属于单独恢复既有合同的机械修复，明确归类为 N/A；本 Spec 不授权或宣称该修复已完成。Carbon 有文档依据的内置工具/函数组合属于新 Interactions 端点合同，不是模型级全局开启。

Cherry 仍缺少显式 Interactions 路由及其请求方言。Google SDK 在源头已支持只有签名的 thought 和延迟签名；它们是保留要求，不是独立的解析器缺陷。当前混合摘要投影及内置调用/结果转换无法表达所有原生步骤。UI 折叠、普通编辑和原生智能体网关还可能丢失签名、有序内容、文件或步骤身份。

这是与现有[网关执行 owner](../../implemented/architecture/2026-11-09-gateway-sdk-forwarding.md)、[Pi 回放身份决策](../../implemented/bug-fix/2026-10-29-pi-google-replay-identity.md)和[用量归属决策](../../implemented/bug-fix/2026-10-30-agent-usage-ownership.md)并存的新协议决策。它扩展这些 owner 有限且明确支持的语义，不替换执行、身份或计费归属。此基线没有有效的 Interactions note。此前本地宽范围 Spec 仅为历史，不提供本次范围或批准。

## Proposal

### 范围与既有 owner

为普通聊天、Pi 和 Pi Durable 增加显式可选的 Interactions。保留所有旧路由行为，包括 generateContent、Vertex、中继、自定义 host 和 header、默认端点、图片/embedding 路径及 CLI 导出。本次不登记模型、不升级 SDK、不新建用户默认控件、迁移、全局 metadata codec/cache、平行 HTTP/SSE 客户端或 OpenAI 回退。托管智能体、后台执行、显式缓存及对外 `/interactions` 服务端仍不在范围内。

下列路径是基线 owner；拟新增字段和未来测试不代表当前已有实现。

| 边界 | 既有 owner 与拟承担职责 |
| --- | --- |
| 端点与 SDK 构造 | `packages/provider-registry/src/schemas/enums.ts`，该包内 `src/schemas/provider-models.ts`、`src/registry-utils.ts`、`src/providers/gemini.ts`；`src/main/ai/provider/endpoint.ts`、`config.ts`；`packages/aiCore/src/core/providers/core/initialization.ts`：增量端点/variant、校验与 `provider.interactions(modelId)` |
| 参数与预留 | Registry `src/reasoningProfiles.ts`、`src/schemas/reasoningWire.ts`；`packages/aiCore/src/core/options/types.ts`；`src/main/ai/utils/reasoningSerializers.ts`、`modelParameters.ts`；`src/main/ai/runtime/aiSdk/params/buildAgentParams.ts`、`customParamsFetch.ts`；`src/main/ai/contextBuild/resolveOutputReservation.ts`：方言、来源及最终请求准入 |
| 端点工具共存 | `packages/provider-registry/src/creators/types.ts`，该包内 `src/creators/google.ts`、`src/patterns/serverToolConstraints.ts`、`scripts/generate-catalog.ts`；`src/shared/utils/provider.ts`：在预测和最终路由决策前，为既有上游生成能力查询扩展端点上下文 |
| SDK 回放与消息整形 | `patches/@ai-sdk__google@3.0.146.patch`，SDK `src/interactions/parse-google-interactions-outputs.ts`、`build-google-interactions-stream-transform.ts`、`convert-to-google-interactions-input.ts`；`src/main/ai/messages/messageRules.ts`：有损整形前的完整步骤归属 |
| 编辑与存储 | `src/renderer/components/composer/variants/ChatComposer.tsx`，同级 `chat/messageEditingDraft.ts`；`src/renderer/components/chat/messages/blocks/reasoningEditing.ts`；`src/shared/data/types/uiParts.ts`；`src/renderer/pages/home/hooks/useChatWriteActions.ts`；`src/main/data/services/MessageService.ts`：擦除前失效标记与既有 parts JSON 持久化 |
| 原生网关与投影 | `src/shared/ai/piModelCompatibility.ts`；`src/main/ai/runtime/pi/gatewayModelBinding.ts`、`PiMessageMetadata.ts`；`src/main/features/apiGateway/proxyStream.ts`、`adapters/interfaces.ts`、`adapters/converters/GeminiMessageConverter.ts`、`adapters/stream/AiSdkToGeminiSse.ts`；既有 Pi patch；`packages/agent-runtime-pi/src/runtimeProjection.ts`、`packages/agent-runtime-pi-durable/src/content.ts`：协议上下文与原生载体恢复 |
| 目录准入与发布 | `packages/provider-registry/src/catalog.ts`、`src/registry-loader.ts`、`scripts/generate-catalog.ts`；`src/main/data/services/ProviderRegistryService.ts`、`utils/registryDataPaths.ts`；`src/main/services/ProviderRegistryUpdaterService.ts`；`scripts/publishRegistryCatalog.js`：本地增量合并、流隔离与原子的旧流投影 |
| 配置界面 | `src/renderer/pages/settings/ProviderSettings/` 下既有 `ProviderEditorDrawer`、`ProviderCustomHeaderDrawer`、`ModelPurpose` 和 `EditModelDrawer` owner：协议选择、既有保存默认值控件及翻译文案 |

### 显式路由与请求合同

新增端点 `google-interactions` 和 SDK variant `google-interactions`，使用 `adapterFamily: 'google'`、既有 Google factory/tool factories 及 `provider.interactions(modelId)`。复用既有 URL formatter 处理 `v1beta`、包含 `models/` 的模型前缀、自定义 base 和 `#` 路径规则。预设在读取时增量合并端点，保留已存用户 URL/方言值和旧默认端点；无需数据库迁移。只有显式选择新端点才改变协议。

扩展封闭推理 profile/target 词汇和类型化选项，支持 `providerOptions.google.thinkingLevel` 与 `thinkingSummaries`。SDK 将其序列化为 `generation_config.thinking_level` 与 `generation_config.thinking_summaries`。摘要只接受 `auto | none`，启用推理时使用 `auto`；绝不泄漏 `concise`、`detailed`、`thinkingConfig` 或旧 budget 字段。Carbon 保留 `low/medium/high`，Hydrogen 保留 `low/medium/high/xhigh`；不承诺关闭任一模型的推理。跨模型 Carbon `xhigh` 沿用既有规则投影为 `high`。

先解析 composer 显式档位；missing/default 选择再继承保存的 `userDefaultReasoningEffort`；否则省略端点选项。目录默认值是能力/展示数据，绝不是保存的用户意图。保留 PR #24476 的严格 patch DTO、null-clear API、运行时来源及创建/编辑/重载行为。保留提供商特定的导入默认值，包括 OpenRouter Hydrogen `medium`。复用当前控件；新增 clear-to-inherit UI 不在范围内。

普通请求发送 `store: false` 和客户端拥有的完整历史。拒绝 `store: true`、后台执行和前序 interaction 续接（`previousInteractionId` / `previous_interaction_id`）；不通过切换协议接受它们。助手设置、自定义参数、原始 body patch 和调用覆盖全部合并后，执行共享上下文预留及普通 Interactions 思考加输出 `65,536` 上限。它是一个合计预留，不是两个可独立相加的额度。接受 `65,536`，在 HTTP 发出前拒绝 `65,537`。模型级 `contextWindow` 和 `maxOutputTokens` 保持 `1,048,576`；既有 generateContent 大输出请求（包括 `131,072` 和 Argon continuation）保留原行为。

在这些既有 parameter/fetch owner 省略不支持的 `safetySettings`、`cachedContent`/`cached_content` 及 Gemini 4 采样键，包括已知原始 `generation_config`/`generationConfig` 容器内的键。不递归擦除应用 metadata，不改变既有 Gemini 4 sampling early return。不为原生路由附加 OpenAI-compatible 跳过签名中间件。

### Carbon 工具共存的端点范围

第一方 Carbon model/search 页面确认独立 search 和 URL 支持。[tool-combination](https://aistudio.google.com/docs/tool-combination) 和 [function-calling](https://aistudio.google.com/docs/function-calling) 示例说明 Interactions 中的内置工具加函数组合。Cloud generateContent 限制不能证明 Developer API generateContent 也有相同禁令。不宣称旧 Carbon mixing 已新开启，也不宣称已证实所有 API 都禁止。

既有 `ServerToolConfig.endpointTypes` 及生成的模型资格已经按端点限定独立服务端工具的可用性；新 bundled 端点复用该机制。它们无法表达共存：`Creator.serverToolFunctionMixing` 和 `supportsServerToolFunctionMixing(rawModelId)` 是模型级全局能力。最小上游改进是在既有 creator/generator/query owner 中增加仅生成时使用的 `Creator.serverToolFunctionMixingByEndpoint?: Partial<Record<EndpointType, string[]>>`。只在 `google-interactions` 下声明 Carbon，与既有生成约束一起编译为按端点索引的精确 normalized ID；旧全局声明/集合保持不变。这是 bundled 能力数据，不是新的模型/override 远程字段或发布版本。

将既有 registry 查询扩展为 `supportsServerToolFunctionMixing(rawModelId: string, endpointType?: EndpointType): boolean`：接受原全局集合或显式端点的生成集合；省略/未知端点不增加支持。保留当前保留尺寸的模型 normalization。在 `src/shared/utils/provider.ts`，`resolveWebToolRoutes` 使用既有 `options.endpointType` 经 `resolveServerToolEndpoint` 获得上下文；为 `finalizeWebToolRoutes(routes, model, provider, hasFunctionTools, endpointType?)` 增加相同上下文。`buildAgentParams` 将已解析的 `resolvedEndpoint.endpointType` 传给 finalization。Renderer 预测和实际请求路由因此查询同一个上游能力结果；不在下游调用处加入 Carbon 特例或新回退。

测试必须证明 Carbon 独立工具仍有资格，内置工具/函数组合只有在显式 Interactions 下才能通过两个路由阶段；省略端点、generateContent、Vertex、中继和所有旧全局标志均保持原结果。真实 SDK loopback 的 Interactions 请求必须同时包含原生工具与保留原始 ID 的函数；旧请求 fixture 保持不变。此源码接口改进随端点支持提请人工批准，不由单独机械任务实现。

### 原生步骤权威回放

扩展既有 SDK parser、stream assembler 和 input converter。每个已完成原生步骤拥有完整 JSON 对象，包括未知字段、有序混合 summary/content、签名、ID、调用关联及错误字段。以下为拟采用的 metadata 结构；`NativeStep` 指完整 JSON 对象。

```ts
providerMetadata.google.interactionsReplay = {
  version: 1, turnKey: string, index: number, step: NativeStep
}
providerMetadata.google.interactionsReplayRef = { turnKey: string, index: number }
```

每次调用分配一次独立于服务端 ID 的 `turnKey` 并持久化。thought 的 reasoning 部分拥有其记录；模型输出由首个 text 拥有，无 text 时由首个 file 拥有。内置调用与结果分别在 `callProviderMetadata` 和 `resultProviderMetadata` 拥有记录，即使 UI 将它们折叠在一起。其他展示部分引用 owner；没有展示投影的步骤使用受保护的空 text 载体。

流式组装保留各原生 index 的 start payload、有序 delta、混合 summary 对象及延迟 metadata。在 `step.stop` 通过 end metadata、最终工具事件或缓冲文件完成归属。延迟签名更新同一 owner，不新建步骤。按调用/index 顺序回放完整记录，绝不按工具完成或展示顺序回放。不完整记录不能伪装为成功回放。

整形前由 `messageRules` 保留 owner/reference 分组。输入转换仅在与原始类型匹配的 assistant 槽位认可权威：reasoning/thought、text-or-file/model output、ID 匹配的 tool-call/native call，或具有 provider-executed 上下文且 call ID 匹配的 assistant tool-result/native built-in result。每个 raw step 只发一次，只消费其 assistant 展示引用。重复的有效 owner 和没有解释的 assistant owner 缺失均无效。

AI `6.0.185` 会将 call metadata 复制到本地 role-tool result。这些继承 metadata 仅表示关联，不参与 owner、重复 owner 和缺失引用检查。不消费真实本地结果，不复用调用签名。将当前结果恰好一次序列化为新的 `user_input.content[].function_result`，保留原始 `toolCallId`。provider-executed 内置工具保留独立原生结果记录。同名并行调用的真实函数 ID 必须完整保留。

### 编辑、重载与分支保留

在 `ChatComposer` 中，于 reasoning replacement 或 `replaceEditedMessageParts` 擦除 metadata 之前捕获原始回放分组。扩展既有 `messageEditingDraft` owner，包括 no-span 和 early-return 分支：从可编辑文本排除 metadata-only 载体，在逻辑槽位保留未修改隐藏分组，重建前比较文本、附件和 anchor。专门的 reasoning 编辑采用同一策略。

已改变或删除的分组移除旧 raw owner。同时为 `CherryTextMeta` 和 `CherryTextMetaSchema` 增加 `interactionsReplayEdits`；在一个受保护的空 TextUIPart 的 `providerMetadata.cherry.interactionsReplayEdits` 存放以下条目。

```ts
{ turnKey: string, index: number, state: 'invalid-signed' | 'regenerate' }
```

任何受影响的签名步骤都留下 `invalid-signed`，即使它的最后一个 reasoning、file 或内置工具载体被删除。`messageRules` 在 normalization/网络访问前检查，并可见地要求从有效的编辑前分支重新生成；绝不伪造签名或静默恢复旧内容。改变的无签名分组留下带当前投影的 `regenerate` 槽位；有效删除没有投影。合并文本区段占用首个受影响槽位，其余留空。未修改隐藏槽位保留原始记录。

既有编辑写入 PATCH 包含所有 edited parts；`MessageDataSchema` 接受 parts，`MessageService` 将其保存到 JSON `message.data`。无需新列，在重载、后续编辑和分支复制中保留标记。只在出站转换时剥离标记，无签名槽位在其 index 位置发送当前内容。成功重新生成以新 `turnKey` 替换分组。旧 `<think>` 编辑行为保持。

### Pi 与 Durable 原生传输

将新端点显式绑定到既有原生 Gemini 内部 envelope，并将已解析协议经 `proxyStream` 传给 converter 和 SSE adapter。使用原生 `Part.partMetadata.cherryInteractions` 承载回放 record/reference 或 `{edit: entries}`。在狭窄的既有 Pi patch 内扩展类型化 `googleInteractions` content 字段、parser 保留与 replay 处理。在 `google-shared.convertMessages` 中，于 `transformMessages`、空内容、签名/模型身份或 ID normalization 丢弃字段之前读取它们。保留 XHIGH、custom fetch 和既有身份规则。

原生内置调用/结果及无投影步骤使用不可执行的空 text 载体传输，绝不成为 Pi 可执行 `toolCall` 条目。真实本地函数调用仍可执行，保留原始 `functionCall.id`/`functionResponse.id`，包括 Cherry 前缀模型 ID 场景。

对于仅含文件的模型输出，`AiSdkToGeminiSse` 在流式和 unary accumulation 中都将唯一权威转移到一个 `{text: '', partMetadata: {cherryInteractions: record}}` 载体。file 既不是第二个 owner，也不是 Pi file Part。引用使用同类 text 载体。Pi 在 TextContent 中保存完整 raw file payload。`GeminiMessageConverter` 在 ingress 消费传输 text、重建文件，恰好恢复一个首文件 owner 及同组引用。Pi `runtimeProjection`、Durable `content` 和 `PiMessageMetadata` 恢复相同展示分组。

原生 start/end/result chunk 保留边界；延迟 metadata 更新对应 index 的 owner。原生 branch writer 将受保护编辑 sentinel 转成带 `googleInteractions: {edit: entries}` 的不可执行 TextContent，返回为 `partMetadata.cherryInteractions: {edit: entries}`。Ingress 在 `messageRules` 前恢复 CherryTextMeta。Pi JSON 消息及 Durable `model: [message]` 在持久化、重启与分支操作中保留记录和 sentinel；产品展示消息绝不取代原生历史。

对新端点显式拒绝不兼容的其他入站/出站协议组合。不经过有损 Anthropic/OpenAI 转换，不伪造签名，不增加全局 codec/cache。旧端点上所有已有组合保留原行为。网关工具没有 executor；Cherry 保留上游凭证及既有单次 SDK 执行和计费 owner。

### 取消、错误与保留约束

前台取消必须中止上游请求，并将聊天/Pi/Durable 回合归档为 cancelled。非 2xx 和中途流错误保持可见错误，绝不能作为成功完成。通过既有网关/提供商账本按请求时归属恰好一次持久化实际已产生的可观测用量；延迟原生关联不得增加费用。不因取消/错误伪造零用量或重复计费。

保留 Google patch 既有八处新增行为：public/internal CJS 和 ESM 中的 model-path 处理（四处）、public CJS/ESM 中的 image predict path（两处）、public CJS/ESM 中的 Gemini/nano-banana 识别（两处）。保留 Pi XHIGH/custom fetch、SDK 解析及既有 generateContent continuation/用量行为。

### Bundled 交付与未来发布

Bundled 增量阶段可以离线交付端点/profile 支持，同时远程 `models.json` 与 `provider-models.json` 保持既有 v4 语义和 `2.1.11` floor。Providers 仍随应用捆绑；`ProviderRegistryService` 在读取时合并预设端点键并保留用户值。旧 reader 可过滤未知端点列表成员而保留模型，但未知端点配置/推理合同 record key、format discriminator 或 wire target 可能导致整个 provider/override 被拒绝。Schema 解析本身不证明运行时支持。

发布新的远程 wire 语义需要 v5 流，以及 release owner 指定的首个兼容 Desktop release `R`，该版本必须包含完整 interpreter/routing 合同。通过 `compat:baseline` 仅生成新的 v5 validator；冻结 v1-v4 validator 和 floor 不变。基线应用 `2.2.2` 不是已证明兼容的 floor。不编造生产版本，不为此 Spec 无端提升应用版本。版本 `R` 和发布时机是外部决策；本次没有发布授权。

本地 publisher 修正属于实现任务 4/8，不受 `R` 尚未指定阻塞。扩展 `scripts/publishRegistryCatalog.js`，在冻结校验前投影每个旧流候选：移除新端点列表成员、端点配置键与推理合同键，包括其嵌套的新 profile/target。保留已识别端点的顺序/默认值及既有 generateContent 操作、支持项和默认值。绝不通过删除既有模型或 override 达成准入，也不使用 loose validation 已过滤行后的解析结果充当保留证明。

比较每个既有流上次发布的快照与已投影候选。保留模型 ID 多重集、API ID 和 override 身份 `(providerId, modelId, sorted modelVariants)`，以及此前可用的旧请求语义。保留合同中不支持的 target 阻止准入，除非投影可证明恢复了精确旧合同。缺少比较证据或无法证明保留时，原子拒绝整个发布调用。

写入前在内存中暂存所有流的文件/manifest；失败不写任何目标字节，返回失败且不列成功项。复用既有序列化、版本戳及 manifest hash。历史 reader fixture 必须检查 v1-v4 解析后的身份/合同，而不只是 void frozen-validator 成功：增量键不丢行、嵌套新 target 不泄漏、缺失旧行或不兼容的保留 target 导致所有目标不变并失败、v4 保留 `2.1.11` floor、v5 字节完整。Manifest/updater/cache fixture 证明 v4 拒绝 v5、降级忽略 v5 cache、符合条件的 v5 仅激活完整快照。

目录生成继续由 creator/provider 源码和既有 generator 负责；不手改生成 JSON，不新建平行 registry。任务 8 通过正常包发布 owner 提供 registry feature Changeset，不重复上游模型 Changeset。

## Alternatives considered

- 改变既有 Google 默认路由：拒绝，因为已存连接、Vertex 和中继必须保持原协议。
- 只增加签名别名或从可见文本重建步骤：拒绝，因为混合摘要、原生内置工具、文件及顺序无法从投影恢复。
- 重做 HTTP transport 或使用 OpenAI 回退：拒绝，因为它重复凭证、流、取消和用量 owner，并丢失原生语义。
- 编辑后恢复旧签名文本或丢弃空载体：拒绝，因为它丢弃用户意图或隐藏失效签名链。
- 将共享模型输出上限降为前台限制，或启用后台/store 续接：拒绝，因为模型级长输出与普通 Interactions 是不同合同；后台需要单独决策。
- 将新键发布到 v4 并信任 loose validation：拒绝，因为未知 record key/target 可能丢弃此前可用的 override。仅有 v5 流无法修复旧流发布；还需校验前投影和原子保留证据。

## Acceptance criteria

- AC1 — 通过基线复用与单独机械选择器修复，Carbon 三档/默认 medium、Hydrogen 四档/默认 high、独立官方 search/URL 声明、旧全局 mixing 标志、提供商特定默认值及模型级 `1,048,576` 上下文/输出均保持正确；不重复模型/SDK/默认控件工作。 (verification: unit; owner: tasks 3/5, provider-registry and Google wire fixtures)
- AC2 — 只有显式选择 Interactions 才使用增量 Google variant 调用 SDK Interactions 路由，URL/模型格式、`thinkingLevel`、`thinkingSummaries: auto | none` 和 `store: false` 正确；带端点上下文的上游解析允许有文档依据的 Carbon 内置工具/函数组合，不改变旧 generateContent/Vertex/全局标志；旧方言、不支持的采样/缓存及禁止的服务端状态覆盖无法到达 HTTP。 (verification: unit and Electron; owner: tasks 4/5/7, real SDK loopback and saved configuration)
- AC3 — 两轮聊天、Pi 和 Durable 回放在真实原生持久化/重启/重载/分支后，恰好一次保留有序完整原生步骤、混合摘要、内置调用/结果、同名不同 ID 的函数、本地结果、只有签名及延迟 metadata；仅文件 owner 和编辑 sentinel 传输不丢，失效签名编辑可见地要求重新生成，有效无签名编辑发送当前内容。 (verification: unit and Electron; owner: tasks 2/5/6, SDK/gateway/native storage fixtures)
- AC4 — Composer 显式档位覆盖保存的用户默认值；missing/default 继承保存意图，null-clear 恢复省略，不把目录默认值当用户意图；保存/重载保留 OpenRouter medium、自定义 host/header、旧端点/默认值、Vertex/中继及 CLI 行为。 (verification: unit and Electron; owner: tasks 4/5/7, serializer/service/configuration fixtures)
- AC5 — 全部覆盖后，普通 Interactions 接受思考/输出合计 `65,536`，在发出请求前拒绝 `65,537`，同时保留共享窗口及旧大输出/续接路由；取消中止上游并归档 cancelled，错误不归档成功，实际已产生用量恰好归属一次，不伪造零费用或重复计费。 (verification: unit and Electron; owner: tasks 2/5/6, real SDK loopback, archive and usage fixtures)
- AC6 — 当前 Spec head 在协议实现前获得明确人工 Approval；配对文档与最终 AC 证据一致；区分 bundled/本地工作与 v5 发布，旧流投影原子保留历史 reader 身份/合同，冻结流不变，发布等待 release owner 的 `R` 和授权。 (verification: docs gate and unit; owner: tasks 1/4/8 and final compliance review)

### 未来验证归属

这些检查描述实现验收；本次 proposed Spec 编写并未运行它们。真实 SDK 到 loopback 的请求必须检查最终 body 及两轮 raw replay，不能用 mock 调用次数或付费提供商承诺代替。新增 Interactions fixture 将与既有 Google provider 测试相邻。

| 覆盖 | 需扩展或以显式文件过滤运行的既有测试 |
| --- | --- |
| 模型与旧 SDK 行为 | `packages/provider-registry/src/__tests__/gemini4.test.ts`、`google-catalog.test.ts`、`catalog-source-sync.test.ts`；`src/main/ai/provider/__tests__/gemini4.test.ts`、`googleImageModel.test.ts` |
| 端点工具共存 | `src/shared/utils/__tests__/provider.serverTools.test.ts`；既有 registry server-tool constraint 和 source-sync 测试；`src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`；真实 Interactions 及不变的 generateContent/Vertex wire fixture |
| 路由与最终参数 | `src/main/ai/provider/__tests__/endpoint.test.ts`、`config.test.ts`；`src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`；`src/main/ai/utils/__tests__/reasoningSerializers.test.ts`、`modelParameters.test.ts`；`packages/aiCore/src/core/providers/__tests__/types.test.ts`，该包内 `src/core/runtime/__tests__/executor-resolveModel.test.ts` |
| 编辑与持久化 | `src/renderer/components/composer/variants/chat/__tests__/messageEditingDraft.test.ts`；`src/renderer/components/composer/__tests__/composerInputAdapter.test.ts`；`src/main/data/services/__tests__/ProviderRegistryService.test.ts`；通过 `setupTestDatabase()` 使用生产迁移的真实消息重载/分支及原生 session/重启 fixture |
| 智能体传输 | `src/main/ai/runtime/pi/gatewayModelBinding.test.ts`、`gatewayIntegration.test.ts`、`piGoogleReasoning.test.ts`；`src/main/features/apiGateway/adapters/__tests__/GeminiMessageConverter.test.ts`、`AiSdkToGeminiSse.test.ts`、`AnthropicMessageConverter.test.ts`、`AiSdkToAnthropicSse.test.ts`；真实 Pi 和 Durable loopback 执行 |
| 目录安全 | `packages/provider-registry/src/__tests__/forward-compatibility.test.ts`、`provider-reasoning-contracts.test.ts`；`scripts/__tests__/publishRegistryCatalog.test.ts`，以及历史 reader 和 manifest/updater/cache 覆盖 |
| 配置与文档 | 既有 provider editor/custom-provider/model-purpose/default-effort renderer 测试；tracked Electron loopback 在 desktop/mobile 宽度保存/重开；`pnpm docs:affected --base f62d636d5b1e75378ae6ba848456cebd2e73a6b8`、配对文档、限定格式与 docs gate |

## Risks

原生记录增大消息存储；投影不得重复权威或执行内置工具。流交错、最终 metadata 和仅文件输出需要穿过真实 SDK/原生存储的测试，不能只断言 metadata 名称。编辑必须在擦除前标记失效，并在每个 normalization 边界保留它。

协议准入必须可见地拒绝不支持组合，且不改变旧路由。取消可能发生在真实用量产生后；准确归属不承诺与提供商发票对账。即使 validator 成功，目录发布仍可能静默删除可用行。运行时实现及历史 reader 证据仍是必需；本 proposed note 不是自我批准、live-provider 验收声明或发布授权。
