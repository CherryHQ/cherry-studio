# Agent Note: 统一网络搜索与网页读取用量捕获

Status: proposed

[English](2026-10-18-web-search-usage.md) | 中文

## Problem

搜索和网页读取需要先建立统一用量契约，才能一致地计算费用。本方案同时覆盖 `web_search`、`web_fetch` 以及提供商原生 `serverTools`。第一阶段交付可观测用量、归属、持久化、兼容的读取 API，以及现有用量页面中的局部记录 Tab。提供商设置与消息底栏扩展、联网看板、价格编辑器、搜索分时倍率、余额扣减和额度对账留待后续工作。

本次核查基线为 `46ef0b8ce375eae15a62daefa5df2d0ca76f1eed`。现有活跃 Agent Note 中没有该决策的归属文档，因此新增架构 Spec。下表描述当前实现事实，不代表提案已经落地：

| 边界 | 当前行为 | 缺失信息 |
| --- | --- | --- |
| [可移植协议](../../../../packages/web-search/src/types.ts) | 提供商模块返回结果数组，客户端补充提供商和能力标识。 | 计量、请求标识和网页操作专属费用证据被丢弃。 |
| [桌面端执行](../../../../src/main/services/webSearch/WebSearchService.ts) | 输入并行分发，回退结果合并后再过滤和截断。[Jina](../../../../src/main/services/webSearch/providers/api/JinaProvider.ts) 还会在驱动内部重试备用域名。 | 最终结果无法还原每一次已完成调用。 |
| [原生工具路由](../../../../src/main/ai/provider/__tests__/serverToolDelivery.test.ts) | 工厂、提供商选项、请求体转换、隐式搜索和网关均可交付 `serverTools`。 | 能力声明不能确定计量格式。 |
| [语言模型捕获](../../../../src/main/ai/hooks/billingHook.ts) | 每次完成的 `doGenerate` 或 `doStream` 根据 Token 用量生成一条不可变记录。 | 捕获没有读取提供商元数据或已完成的原生工具结果。 |
| [运行时捕获](../../../../src/main/ai/runtime/types.ts) | 直连 Agent SDK 路由发出逐调用 Token 用量，网关路由使用提供商调用捕获。 | 运行时中立事件没有携带网页操作用量。 |
| [客户端工具](../../../../src/main/ai/tools/webLookup.ts) | AI SDK 与 [Cherry MCP](../../../../src/main/ai/mcp/servers/cherryBuiltinTools.ts) 共用搜索和读取实现。 | 当前传递取消信号，没有传递冻结的消息和来源归属上下文。 |

现有[用量记录契约](../../../../docs/references/ai/ai-usage-records.md) 仍定位为尽力而为的分析统计。一次本地工具成功、一次提供商搜索 query、一个 credit、一个页面和一笔费用是不同事实。引用数量、结果数量、工具是否可用以及配置的结果上限，都不能替代计费用量。

## Proposal

### 一个可移植契约

由 `@cherrystudio/web-search` 定义并导出 `WebSearchUsage`，应用在共享数据边界复用该类型。原生适配器放在 `src/main/ai/provider/` 并引用此契约；aiCore 不新增对 web-search 的依赖，也不新增应用专属计量注册表。

```ts
export type WebSearchUsage = Readonly<{
  operations: readonly Readonly<{
    operation: 'search' | 'fetch'
    calls?: number
    meters: readonly Readonly<{
      unit: 'request' | 'query' | 'credit' | 'token' | 'page'
      quantity: number
      source: 'provider' | 'observed'
    }>[]
  }>[]
  reportedCost?: Readonly<{
    amount: number
    currency: string
    kind: 'actual' | 'estimate'
  }>
}>
```

`calls` 表示已完成且可观测的操作执行次数。独立搜索请求通常可以提供一次调用；Gemini 的 query 元数据不能据此确定原生工具调用次数。`meters` 保留提供商的计费单位。`provider` 表示经过校验的响应字段；`observed` 表示按照已记录的端点专属规则映射的精确观测。观测到一个 HTTP 请求，不会自动生成一个可计费的 `request` 计量值。

缺失值表示未知，只有明确证据才能保留零值。某操作省略 `calls` 且 `meters` 为空，明确表示该操作用量不可获得。历史记录没有 `webUsage` 字段，表示当时不存在该捕获。只有完整观测证明没有网页操作时，才使用空 `operations` 数组；启用了工具却没有看到用量，不能证明用量为零。一次归一化调用内，每种操作和计量单位至多出现一次。

次数和整数计量值必须是有限、安全、非负整数；credits 可以是有限非负小数。可选计量字段不合法时，省略该字段并记录日志，不影响原本成功的搜索或模型响应。其余可独立确认的有效事实仍须保留。

`reportedCost` 是可选证据，范围为本次网页调用，或模型调用中明确标识的网页操作小计，绝不能放入整个模型响应的费用。金额没有可靠币种时视为不可获得。提供商的估算值保持 `estimate`；例如 Exa 将 `costDollars` 定义为估算费用，不能标为实际账单扣款。一次搜索请求如果包含内容提取，其组合金额只归属一次，不虚构第二笔 fetch 费用或费用拆分。

本阶段记录费用证据，不新增搜索价格计算，也不改变现有金额合计。后续价格计算变更必须定义完整性，并避免向已包含网页费用的模型总金额再次叠加网页小计。网页 API 按 Token 计费的用量保留在其计量值中，不增加模型 Token 用量、上下文大小或生成 TPS。

### 在提供商边界暴露用量

将 `WebSearchProviderModule.execute` 改为返回 `{ results, usage, providerRequestId? }`，`WebSearchResultSet` 保留这些字段。提供商在结果截取、黑名单过滤或内容截断之前解析用量。这会改变可移植包的提供商模块 API，需要遵循该包正常的发布兼容流程。

原生模型调用在非流式结果和流式终结片段的 `providerMetadata.cherry.webUsage` 暴露同一契约。现有语言模型用量中间件同时负责归一化和记录创建，并保持原有内容、元数据和片段顺序；不修改 `usage.raw` 或 AI SDK 的 Token 用量类型，也不增加另一个独立持久化的观察者。

归一化器接收实际解析出的端点家族、提供商预设、真实服务身份、原始 usage、提供商元数据，以及已完成且由提供商执行的工具证据。在调用边界选定适配器。复制的提供商保留用户配置的身份，解析使用其预设规则。网关只按照所选端点实际交付的响应格式处理；请求形状类似 OpenAI，并不能授权采用 OpenAI 的计费假设。

流式工具证据仅归属当前调用，按提供商 tool-call/item ID 去重。只接受已确定为提供商执行的工具；`web_search` 这个协议名也被 Cherry 客户端工具使用。重复累计计数按所属协议替换或对齐同一份快照，不能当成增量求和。不同已完成模型步骤仍然分别记录。

### 适配覆盖与证据

每个已启用提供商/能力组合、每个已声明的原生网页工具，都必须有基于 fixture 的适配器，或明确的用量不可获得结果。在现有原生工具交付覆盖思路上增加计量覆盖，避免新增能力悄然漏记。原始响应有某个字段，并不能证明 SDK 会保留它；必须检查并测试实际安装且已打补丁的 SDK 边界。

| 独立提供商 | 首期适配 |
| --- | --- |
| Tavily | 请求 `include_usage: true`，保留 `usage.credits` 和 `request_id`。请求完成后即使没有结果，也提供 `calls = 1`。 |
| Exa | 保留 `requestId` 和估算金额 `costDollars.total`；带内联内容的搜索仍是一次网页调用，不虚构 credit/query 计数。 |
| Jina、Firecrawl | 支持的响应格式提供 Token/credit 证据时，校验后保留。在字段及其范围获得 fixture 和权威来源之前，暴露已完成调用，并将计量值标为不可获得。 |
| Zhipu、Bocha、Querit、Parallel、Serply、DeepSeek、Crawl4AI | 暴露已完成调用，以及有文档且经 fixture 验证的计量值。缺失的金额和计费单位证据保持未知。 |
| SearXNG、Exa MCP | 暴露已完成且可观测的操作。没有 usage 字段或使用自托管端点，不能据此认定价格为零。 |
| 桌面端 DuckDuckGo 与本地 Fetch | 暴露本地操作次数，提供商计费计量值不可获得；本地内容提取不视为远程提供商请求。 |

前两项适配的依据为 [Tavily 响应契约](https://docs.tavily.com/documentation/api-reference/endpoint/search) 和 [Exa 响应契约](https://exa.ai/docs/reference/search)。其余更丰富的计量映射需要在实现时补齐各自的来源与 fixture，本 Spec 不声称它们存在未确认的字段。

| 原生路由 | 计量边界与解释 |
| --- | --- |
| Anthropic Messages | 在字段得到保留时，归一化 `usage.raw.server_tool_use.web_search_requests` 与 `web_fetch_requests`。已完成服务端工具块可以提供执行观测证据，但不能作为第二份计数再次相加。 |
| OpenAI Responses | 对已完成的 `web_search_call` 结果去重。SDK 输出的 `action.type` 为 `search`、`openPage`、`findInPage`；搜索与网页读取分别归一化，页内文本查找不算另一次 fetch。只有已记录的端点专属规则才能生成计费计量值。 |
| Gemini 与 Vertex 上的 Gemini | 从实际元数据命名空间读取 `groundingMetadata.webSearchQueries` 与 `urlContextMetadata`。记录去重后的非空 query 观测和成功 URL 读取；原生调用次数未知时保持未知。不同模型可能按 query 或 grounded request 计费，不能仅根据 Gemini 品牌推断。 |
| xAI Responses | 只统计可识别的已完成网页操作。`num_server_side_tools_used` 包含其他工具，不能直接当作网页搜索用量；`x_search` 与网页搜索保持区分。 |
| Perplexity | 响应提供时保留 `providerMetadata.perplexity.usage.numSearchQueries`，缺失则保持未知。请求/模型费用不能自动当成搜索专属费用。 |
| Kimi / Moonshot | 声明为服务端路由，但 [formula fiber](../../../../src/main/ai/provider/custom/moonshotProvider.ts) 实际由宿主执行。在 `runFormulaFiber` 捕获，不在语言模型中间件或 Cherry `WebSearchService` 中捕获。 |
| Zhipu、DashScope、Doubao、DeepSeek、Poe | 使用提供商和端点对应的响应契约。启用原生搜索或收到引用不能确定用量次数；在 fixture 证明之前明确归类为计量不可获得。 |
| Bedrock、Azure、Vertex Anthropic、CherryIN、New API、AIHubMix、OpenRouter | 仅在实际交付的响应保留所需证据时复用解析器，否则记录网页用量不可获得。OpenRouter 的整个响应上报费用仍归现有模型调用所有者。 |

[Claude 搜索](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) 和[读取](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) 契约分别提供计数；在文档定义的直连 API 条款下，读取没有单独工具费用。[OpenAI 网页搜索指南](https://developers.openai.com/api/docs/guides/tools-web-search) 区分搜索、打开页面和查找页内文本。[Gemini grounding 契约](https://ai.google.dev/gemini-api/docs/google-search) 区分 query 计费和旧模型的 prompt 计费。这些事实说明需要分别保留观测与计量；本 Spec 不固定任何价格。

### 捕获所有者与归属

| 路径 | 唯一持久化捕获所有者 | 记录粒度 |
| --- | --- | --- |
| 独立搜索/读取 | `RemoteWebSearchProvider.executeRemote`，以及对应的本地驱动边界 | 每次实际完成执行各一条，在宿主重试、回退或响应合并之前记录。 |
| 经 AI SDK 由提供商执行的原生工具 | 现有 `billingHook` 语言模型中间件 | 在已有语言模型调用行上记录 `webUsage`，不新增模型请求。 |
| 宿主执行的 Kimi formula | Formula 执行边界 | 独立搜索行关联所属消息，语言模型调用只保留自身用量。 |
| 直连/外部 Claude Agent SDK | 驱动现有 pending-invocation 收集器和运行时 `usage` 事件 | 为事件增加 `webUsage`，随所属模型调用一起持久化一次。 |
| 网关 Agent 流量 | 提供商调用中间件 | SDK/运行时用量只作为对齐视图，不重复持久化。 |
| Cherry MCP 与 Pi 客户端工具 | 底层 Cherry 网页操作所有者 | 桥接层传递归属，不再单独插入第二条用量记录。 |

每次独立操作实际执行前生成 `web-search:<uuid>`。同一归一化捕获的重放沿用该 ID；实际发生新的网络尝试时，即使 tool-call ID 相同，也使用新 ID。另行保留提供商请求 ID。原生用量使用已有模型调用 ID。不得按 query、URL、结果或父消息合并不同请求。

工具入口从所属 dispatch 冻结 `messageRef` 和 `source`，经 AI SDK `RequestContext`、`webLookup`、`WebSearchService` 和 formula 执行器显式传递。MCP 连接必须在工具开始时向宿主取得本次调用专属上下文；在长生命周期 server 创建时只冻结一次消息，会导致后续轮次归属错误。已经执行的工具跨 steer 或续接边界后仍归原消息。设置检查和无状态调用显式使用 null 消息引用。

发送请求前冻结选中的提供商、端点和凭证回执；回退时为实际提供服务的提供商/Key 新建捕获。搜索 Key 当前是没有稳定 ID 的字符串数组；除非选择所有者能提供现成的稳定非敏感身份，否则使用未知凭证归属。不虚构模型 Key ID，不持久化明文 Key，也不在本阶段引入搜索 Key 迁移。

独立调用完成后，在后处理前记录，包括成功但没有结果的搜索。若已确认上游完成且计量值有效，但本地结果校验失败，只将 `completedInvocation: { usage, providerRequestId? }` 附到类型化 `WebSearchError`，由同一所有者在重新抛错前记录。没有完成证据的超时、取消或提供商失败，不生成成功用量事实，也不能确定消耗为零。某个输入取消整个外层调用时，已经完成的其他并行输入仍须保留。

原生收集随现有已完成模型调用提交。单次插入前对齐重复终结快照；迟到且冲突的重放保留第一条记录并输出完整性告警。模型调用未完成就取消时，不虚构成功语言模型记录。因此第一阶段无法保证保留那些原生工具已完成、但所属模型调用未完整结束的工作量；更早已完成的步骤仍会保留。SDK 内部重试或自动续接若隐藏了各次网页证据，同样不属于可观测覆盖范围；应明确限制，不从最终引用反推次数。

### 持久化与读取契约

为 `ai_usage_record` 增加可空 `webUsage` JSON、可空 `providerRequestId`，以及独立 `web-search` / `web-fetch` modality。新增 invocation 行中只有这两种独立类型允许 `modelId` 为 null；language/image/embedding/rerank 调用及历史聚合保留各自既有身份约束和例外。独立记录存储 `providerId = web-search:<configured-provider-id>`，包括宿主执行的 formula；显示名称仍为冻结的提供商名称。读取范围保留该命名空间，避免 `web-search:deepseek` 与语言模型提供商 `deepseek` 冲突。原生用量保留模型提供商身份。

保留只插入、按 request-ID 去重、快照冻结以及写入失败不阻断业务的既有语义。追加向前迁移；旧行保留 `webUsage = null`，不从历史消息内容回填。沿用消息投影所有权：运行时结束逻辑不写用量，也不补造记录。

通过已有只读用量记录 DataApi 按记录粒度暴露 `webUsage`。历史 null 值仍表示未捕获，不能据此确定存在用量未知的搜索/读取操作。不混加 credit/token/page/query 单位，不跨提供商合计 credits。独立网页记录不增加模型请求数、模型价格未知数、上下文 Token 用量或 TPS；原生网页操作不增加第二份请求数。兼容读取范围在下文定义，不新增独立账目或联网聚合端点。

用量记录不持久化 query、URL、结果文本、原始请求头或未经筛选的提供商元数据。捕获失败通过 `loggerService` 记录，不使搜索或模型响应失败。面向模型的结果仍然是搜索/网页内容；用量元数据供应用消费者使用。

### 兼容现有用量消费者

保留 `ai_usage_record` 这个唯一持久化事实源，读取时区分两种范围。现有模型导向指标不能只靠渲染进程加 Tab 来泛化：[AiUsageRecordService](../../../../src/main/data/services/AiUsageRecordService.ts) 当前会累加所有匹配行的请求数及未定价记录，消息投影也是如此。启用独立网页记录写入前，先扩展这个上游边界。

| 读取入口 | 范围及兼容规则 |
| --- | --- |
| 现有 AI 记录 | 为列表查询增加可选 `scope: 'ai' | 'web'`，默认 `ai`。AI 范围包含已有 language/embedding/image/rerank 记录，包括模型身份未知的历史聚合。原生网页元数据仍附在所属语言模型行上。 |
| 网页记录 | `scope: 'web'` 返回独立网页行，以及 `webUsage.operations` 非空的已有模型行。保留原行 ID 和调用粒度。次数未知或明确为零仍可入选；历史 null 和已确认空操作不虚构网页活动。 |
| 统计及时间线 | 保持现有 AI 范围，包括币种金额、分组排名、剩余项、活跃日和同期比较。本阶段不新增联网看板聚合 API。 |
| 消息用量投影 | 现有请求数、未定价请求数、模型 Tokens、金额和性能仅从 AI 行计算。网页事实可通过列表查询及现有消息筛选读取；运行时结束逻辑不新增第二个写入所有者。 |

列表范围必须在排序、游标分页和总数统计之前生效，并进入读取缓存标识。网页范围只接受 `createdAt` 排序，原 AI 排序保持不变。不先取一页混合记录再在渲染进程过滤。同一原生模型行可以在两种读取范围中作为同一事实的两个视图出现，绝不插入两次。同一行包含搜索与读取时只出现一次，保留两种操作及其组合金额证据。

独立行保持 `requestCount = 1`，提供商计量仅放在 `webUsage` 中。模型 Token、定价及金额字段保持 null，即使网页提供商返回了估算金额也如此。网页金额、币种及类型保留在 `webUsage.reportedCost`，不复制进已有模型费用账目，也不虚构零价模型请求。扩展 schema 约束时，保留历史记录既有的身份例外。

### 最小记录 UI

统一存储和归属，对语义不同的列使用局部 Tab。仅在现有 [UsageSettings](../../../../src/renderer/pages/settings/UsageSettings/UsageSettings.tsx) 的记录区域增加“AI 调用 / 联网操作”。页面概览、热力图、分布图及其 AI 核算口径保持原位。提供商上报摘要、新消息底栏控件、联网汇总卡片和新价格配置均属后续范围。

| 记录 Tab | 展示 | 查询与状态 |
| --- | --- | --- |
| AI 调用，初始选中 | 复用 [UsageEntriesTable](../../../../src/renderer/pages/settings/UsageSettings/UsageEntriesTable.tsx)，保留模型/来源/日期/Tokens/费用/TTFT/TPS 各列。 | 默认 AI 范围，保留现有持久化排序键及全部 `settings.usage.*` 选项。 |
| 联网操作 | 使用已有共享表格原语，展示冻结的提供商/归属、操作、可观测次数、提供商计量、金额证据、来源和时间；不引入模型 Token 或性能占位列。 | 显式网页范围，复用时间窗口及每页 25 条分页，初始按时间倒序。网页排序和游标为组件局部状态，不覆盖 AI 排序偏好。 |

Tab 只切换记录内容及其总数，不切换整页指标、图表、币种、分组或分析周期。网页表按捕获币种展示各笔金额；模型币种选择器不换算或隐藏网页金额证据。网页首期只按时间排序，不新增提供商/操作筛选，也不新增联网费用合计。

[useUsageData](../../../../src/renderer/pages/settings/UsageSettings/useUsageData.ts) 继续读取现有 AI 聚合。独立挂载/获取当前记录范围，切换范围时重置游标，避免另一 Tab 的旧行闪现在当前列下；同一范围内刷新或排序时保留已有行。切回 AI 时保留整页选项及原 AI 排序偏好。重新进入页面时初始选中 AI，无需新增持久化 Tab 偏好。

当前分析区在 AI `hasUsage` 为 false 时会隐藏记录。记录区域可见性须脱离该条件：数据库只有网页记录时，仍展示两个 Tab 并能打开网页记录。保留原有 AI 空概览和分析行为，允许 AI Tab 为空而联网 Tab 有记录。

原生行标注“模型调用”，在次级文字中保留所属模型，不把整个模型费用当作网页金额。独立行标注“独立调用”。多操作行内分别展示搜索与读取，组合金额只在记录层展示一次。配置删除后仍可读冻结的提供商/来源名称。首期不新增消息跳转或详情弹窗流程。

明确零值保留单位；缺失次数/计量显示“未提供”，原生独立网页金额缺失显示“未单列”；估价显式显示“估算”，本地提供商计费显示“不适用”。缺失证据不能标为“免费”。次数未知不能抹去已知 query/credit 证据。沿用微小正数金额下限展示。每个 Tab 独立处理加载、空记录和刷新错误；网页读取失败不使已有 AI 指标空白。读取用量不触发搜索或网页读取。

遵循 [DESIGN.md](../../../../DESIGN.md) 及 better-ui 对既有组件和密度的优先要求。使用 `@cherrystudio/ui` Tabs/Table 原语、语义 Token、i18next 文案和现有数字/时间格式化。保留现有响应式内容列及表格溢出行为；Tab 控件和网页表在键盘、400px 及深浅主题下可用。估价及不可获得值使用可见文字，不新增页面专属动画或另一套设计系统。

### Spec 获批后的实现切片

1. 可移植契约与提供商适配：修改提供商返回封装，保留计量值，定义已完成调用的错误证据，并用 fixture 覆盖所有独立提供商/能力。在 `packages/web-search/src/__tests__/` 下使用显式文件路径验证。
2. 原生归一化：补充 generate/stream 元数据，并扩展直连 Agent SDK 调用事件。以明确的主进程测试文件覆盖各协议快照、item-ID 去重、复制提供商、网关，以及 Kimi 的真实执行所有者。
3. 持久化捕获与兼容读取：追加 schema 迁移，向客户端工具/MCP 传递调用级归属，增加列表范围，并隔离现有 AI 聚合/消息投影。在启用独立记录写入前，通过 `setupTestDatabase()` 验证插入、去重、范围分页、旧读取结果等价，以及有历史行时的向前迁移。
4. 记录 Tab：保留现有用量页面，只增加局部 AI/网页记录切换。使用显式 renderer 路径验证 `UsageSettings.test.tsx`、`UsageEntriesTable.test.tsx`、`useUsageData.test.ts`、受影响分析测试及新增网页表测试。在受跟踪的 Electron 实例中人工验证 Tab、键盘、400px 布局和深浅主题。

最终实现层更新所属用量参考文档和包 README，添加所需包发布元数据；只有所有验收标准都有实际证据后，才将本双语 Spec 转为 implemented。下述计划测试尚未作为实现验证执行。

## Alternatives considered

- 在渲染进程统计工具或引用次数：无法观测原生循环、提供商计量、后处理失败或实际服务凭证。
- 向 `usage.raw` 塞字段，或让客户端/原生路径各维护一套用量类型：会污染不透明的提供商数据，并迫使每个消费者理解提供商格式。
- 把所有声明的 `serverTools` 当作服务端执行：会漏掉 Kimi 的宿主网络调用，并重复统计语言模型/工具生命周期事件。
- 现在新建独立用量表或通用计费操作框架：在网页专属契约得到验证前，引入第二个消息投影所有者或更宽泛的抽象。
- 把原生工具保存成额外语言模型请求：会增加请求数，并可能把已包含的小计再次叠加到提供商总金额。
- 将所有操作塞入已有模型列，或用整页 AI/网页切换替代现有页面：前者会因混合单位及模型身份缺失而误导，后者无必要地扩大看板范围。共享事实配合局部记录 Tab 可以保留两类核算含义。
- 仅在渲染进程过滤网页行：上游总数、分页、分组排名、时间线和消息投影仍会被混入。
- 承诺账单级完整捕获，或将不支持的提供商虚构为零：无法覆盖隐藏重试、账号级额度或未完整结束的原生调用。

## Acceptance criteria

- AC1 — 搜索和读取在可移植结果、AI SDK 终结元数据、运行时用量事件及只读用量记录 API 中暴露相同的可序列化契约，面向模型的工具输出保持不变。 (verification: unit; owner: web-search, billingHook, runtime-contract and DataApi tests)
- AC2 — 当前每个独立提供商/能力以及声明的原生网页工具路由都有基于 fixture 的适配器或显式未知用量用例，新增未分类路由会使覆盖检查失败。 (verification: unit; owner: protocol and provider delivery/metering coverage tests)
- AC3 — 上报零值、缺失用量、非法计数、小数 credits 和已确认未使用工具可区分；不支持的计量不会使原本成功的调用失败。 (verification: unit; owner: shared usage schema and adapter tests)
- AC4 — 流式和非流式 fixture 保留 Tavily credits、Exa 估算费用、Anthropic 搜索/读取计数、OpenAI 动作类型、Gemini query/URL 证据及 Perplexity query 计数的不同含义。 (verification: unit; owner: provider usage adapter tests)
- AC5 — 重复工具事件和累计原生快照不会重复增加用量，第二个已完成模型步骤会增加其自身用量，与原生协议同名的客户端工具不会进入原生捕获。 (verification: unit; owner: billingHook and runtime-driver tests)
- AC6 — 多输入、Jina 域名重试、提供商回退、成功空结果和后处理失败，均将有完成证据的每次独立执行按实际提供商身份恰好保留一次。 (verification: unit; owner: WebSearchService and provider-driver tests)
- AC7 — 跨 steer 边界执行的工具保留原消息/来源归属；后续 MCP 调用使用后续轮次归属；设置和无状态调用不虚构消息关联。 (verification: unit; owner: webLookup, builtin MCP and Agent runtime tests)
- AC8 — Kimi formula 调用只有一次独立搜索捕获；网关 Agent 请求只有一次提供商调用捕获，没有重复 SDK 记录。 (verification: unit; owner: moonshotProvider and Agent usage ownership tests)
- AC9 — 变更前已有数据的数据库向前迁移后，全部原有用量行保持不变；新独立调用允许没有模型，并与同名模型提供商身份隔离。 (verification: unit; owner: setupTestDatabase migration and AiUsageRecordService tests)
- AC10 — 记录重放幂等，原生用量不增加模型请求数，独立网页用量不改变模型 Tokens/TPS 或模型价格未知数；网页证据保留提供商和单位边界。 (verification: unit; owner: AiUsageRecordService, message projection and usage API tests)
- AC11 — 没有完成证据的取消或超时不会变成零用量或成功调用；此前已完成工作仍然保留，用量持久化失败不改变实际搜索/模型结果。 (verification: unit; owner: protocol, billingHook and usage-record failure tests)
- AC12 — 用量记录不暴露明文 Key、query、URL、结果或无限制的提供商元数据；中英文 Note、受影响参考文档、包文档及发布元数据通过适用检查。 (verification: unit and docs gate; owner: serialization/security fixtures and implementation author)
- AC13 — 列表省略范围时保留现有 AI 记录及历史身份缺口；网页范围包含独立与原生证据，排除未捕获/已确认空活动，并保留原记录 ID。范围在游标分页和总数统计前生效。 (verification: unit; owner: usage query-schema and setupTestDatabase service tests)
- AC14 — 相同历史 AI 行加入独立网页行后，现有统计、时间线币种金额/排名/剩余项、活跃日输入及消息 AI 投影，与仅含 AI 行的基线相同。网页估价保持为网页证据，不改变模型金额字段。 (verification: unit; owner: AiUsageRecordService aggregate and message projection compatibility tests)
- AC15 — 记录区域 Tab 初始选中 AI，保留所有整页选项及 AI 排序。切换网页只改变记录，隔离查询/游标/缓存状态，不在网页列下闪现 AI 行，并在 AI 用量为空时仍可访问。 (verification: renderer; owner: UsageSettings, UsageEntriesTable and useUsageData tests)
- AC16 — 网页表保留搜索/读取、原生/独立归属、多操作记录粒度、提供商单位、零/未知区别、估价币种、本地计费适用性和微小正数金额。每个范围独立处理加载/空记录/刷新状态，不影响 AI 指标。 (verification: renderer; owner: web records table and scoped list consumer tests)
- AC17 — 局部记录 Tab 和网页表通过共享 UI 原语及 i18next 支持键盘、较长翻译、400px 和深浅主题；现有 AI 概览、热力图、分析及表格行为保持完整。 (verification: Electron; owner: tracked Electron verification report)

## Risks

提供商返回值变更需要协调可移植包的消费者。SDK 响应 schema 可能丢弃提供商字段，工具事件也可能缺少状态或动作细节。此类缺口需要带 fixture 的最小 SDK/上游改进，不能据此从引用推算计费用量，或拦截所有 HTTP/SSE 响应体。本 Spec 本身不授权修改 SDK 补丁。

当前安装的 Google 适配器可能合并内部续接，却只保留最后一份 grounding 元数据。在 `doStream`/`doGenerate` 处的中间件无法保证逐次网络搜索的完整性。直连/外部运行时也可能只暴露聚合用量；必须保持其所有权粒度，并明确不可获得的维度。

独立网页记录会改变现有模型导向聚合、筛选器和消息投影的假设。启用这些记录前，测试必须证明各类统计已正确隔离。历史行保持未知，尽力而为的分析统计不能替代提供商账单。

按照 [Agent Note 流程](../../README.md)，实现前必须取得对当前 Spec PR head 的人工批准。捕获边界、未知值语义或验收标准发生实质变化时，需要重新批准。
