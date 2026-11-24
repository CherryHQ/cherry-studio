# Agent Note: StepFun 文搜图

Status: implemented

[English](2026-11-13-stepfun-text-to-image-search.md) | 中文

## 问题

StepFun 网页搜索已作为 `searchKeywords` 提供商可用（`packages/web-search/src/providers/stepfun.ts`，目录条目位于 `packages/web-search/src/catalog.ts`）。StepFun 还提供文搜图 API `POST https://api.stepfun.com/step_plan/v1/search-image`，而 Cherry Studio 无法调用它。该路径不在 `/v1` 之下，仅通过 Step Plan 通道提供，并按调用次数计费。共享能力枚举 `WEB_SEARCH_CAPABILITIES = ['searchKeywords', 'fetchUrls']`（`src/shared/data/preference/preferenceTypes.ts`）没有图像能力，设置界面无处暴露它。

## 决策

`searchImages` 端到端加入共享能力枚举：web-search 协议类型（`WebSearchCapability`、`WebSearchSearchImagesCall` 变体、`WebSearchImageResult` 与 `WebSearchImageResultSet`）、`WEB_SEARCH_CAPABILITIES`、预设能力 schema 以及按能力划分的覆盖 schema。StepFun 在协议目录和 `DESKTOP_REMOTE_CAPABILITIES` 中同时声明 `searchKeywords` 与 `searchImages`；其他提供商的能力集合不变。`WEB_SEARCH_FALLBACK_PROVIDER_IDS_BY_CAPABILITY` 增加空的 `searchImages` 条目，使该能力没有跨提供商回退。

图像调用位于现有的 StepFun 协议模块中。其端点从配置的 `apiHost` 源（origin）解析，固定使用 `/step_plan/v1/search-image` 路径；关键词搜索保持 `/v1/search` 重写和 20 的 `n` 上限不变。请求发送 `query` 与 `topk`，其中 `topk` 为 `min(maxResults, 50)`：StepFun 文档将 `topk` 记为返回图片数量上限但未给出数值最大值，因此模块防御性地将其限制为 50 并在代码中记录该选择。`code` 为 0 时，将 `data.result.search_results` 映射为携带 `contentUrl`、可作为 alt 文本的 `snippet`、`width`、`height`、`hostPageUrl` 与 `hostname` 的图像结果；`data.result.block: true` 返回空列表且不报错。非零 `code` 抛出提供商错误，其消息携带 `msg`，`providerCode` 携带数值状态码，使鉴权或计费失败表现为错误而不是空结果。

`WebSearchClient.execute` 返回 `WebSearchResultSet | WebSearchImageResultSet`，按调用能力区分。桌面运行时调度尚未接入图像搜索：`RemoteWebSearchProvider` 以 `capability_unsupported` 拒绝 `searchImages`，保持现有关键词与抓取路径完全不变。设置界面由声明的提供商能力驱动，因此图像搜索区块只对声明 `searchImages` 的提供商（目前仅 StepFun）显示，并复用现有 StepFun 图标与提供商元数据。图像搜索尚无聊天调度消费者，因此该区块没有持久化的默认提供商；它仅配置凭据与主机，其连接检查复用关键词探测。

## 备选方案

- 复用 `searchKeywords` 处理图像查询：拒绝。响应结构、端点路径与计费方式不同，调用会静默返回错误的结果类型。
- 注册独立的“StepFun 图像”提供商：拒绝。这会为同一账户重复配置 API 密钥，并将一个提供商身份拆成两个条目。
- 推迟图像搜索、只交付关键词搜索：本次迭代拒绝。能力模型变更落在数据驱动的设置界面之后，未声明 `searchImages` 的提供商不受影响。

## 影响

拓宽的能力枚举涉及持久化偏好校验：覆盖 schema 增加可选的 `searchImages` 条目，既有存储值仍可原样解析。图像结果尚未被聊天工具调度消费；渲染层仅暴露配置，后续阶段必须接入 `web_search.search_images` IPC 路径并决定图像结果在会话中的呈现方式。`topk` 上限 50 是本地防御性边界，并非 StepFun 文档的限制；若 StepFun 公布最大值则需重新评估。每次图像调用均通过 Step Plan 通道计费，且返回图片版权归原站点所有——API 不做版权或商用审查，因此消费方不得暗示可自由重用。

## 验证

- AC1 — `src/shared/data/presets/__tests__/webSearchProviders.test.ts` 与 `src/shared/utils/__tests__/webSearch.test.ts`（23 个测试）通过：能力 schema 包含 `searchImages`，StepFun 预设声明两种能力，其他提供商不变；`packages/web-search/src/__tests__/stepfun.test.ts` 中的 StepFun 目录测试断言能力恰为 `['searchKeywords', 'searchImages']`。
- AC2 — `packages/web-search/src/__tests__/stepfun.test.ts`（28 个测试）中的请求形状测试断言 POST 指向配置源上的 `/step_plan/v1/search-image`（默认、代理与带前缀主机），携带 bearer 认证、`query`，以及上限为 50 的 `topk`。
- AC3 — 映射测试断言 `contentUrl`、`snippet`、尺寸、`hostPageUrl` 与 `hostname` 连同 `sourceInput` 进入图像结果，缺失的可选字段被容忍，`block: true` 返回空列表。
- AC4 — 非零 `code` 以 `kind: 'provider'` 拒绝，消息为 `msg` 文本，数值状态码进入 `providerCode`。
- AC5 — `src/renderer/utils/__tests__/webSearchProviderMeta.test.ts`（5 个测试）断言图像搜索区块仅列出 StepFun，未声明 `searchImages` 的提供商不产生条目。
- AC6 — `stepfun.test.ts` 中的关键词搜索用例与 `protocols.test.ts` 中 130 个跨提供商用例保持不变地通过，包括 `/v1/search` 重写与 20 的 `n` 上限。包级、node 与 web 的 `tsrs` 类型检查全部通过。
