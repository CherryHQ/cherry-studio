# Agent Note: StepFun 文搜图

Status: proposed

[English](2026-11-13-stepfun-text-to-image-search.md) | 中文

## 问题

StepFun 网页搜索已作为 `searchKeywords` 提供方接入（`packages/web-search/src/providers/stepfun.ts`，目录项位于 `packages/web-search/src/catalog.ts:37`）。StepFun 还提供文搜图接口 `POST https://api.stepfun.com/step_plan/v1/search-image`，Cherry Studio 目前无法调用。该路径不在 `/v1` 下，仅通过 Step Plan 渠道提供，并按调用计费。共享能力联合类型 `WEB_SEARCH_CAPABILITIES = ['searchKeywords', 'fetchUrls']`（`src/shared/data/preference/preferenceTypes.ts:313`）没有图片能力，因此设置界面无处暴露该功能。

## 提案

- 在 `WEB_SEARCH_CAPABILITIES` 及其派生的 Zod 能力 schema 中加入 `searchImages`（`src/shared/data/presets/webSearchProviders.ts`）。仅包含既有能力的已存偏好值保持有效。
- 在协议目录（`packages/web-search/src/catalog.ts`）和预设（`src/shared/data/presets/webSearchProviders.ts:116`，当前为 `['searchKeywords']`）中为 StepFun 同时声明 `searchImages`。其端点基于 `apiHost` 的 origin 解析，使用 `/step_plan/v1/search-image` 路径；关键词搜索保持 `/v1/search`。
- 在同一协议模块（`packages/web-search/src/providers/stepfun.ts`）中实现图片调用。发送 `query` 与 `topk`，`topk` 以文档化的上限截断。将 `data.result.search_results` 映射为图片结果，包含原图 URL（`contentUrl`）、替代文本描述（`snippet`）、尺寸、`hostPageUrl` 与 `hostname`。`data.result.block` 为 `true` 时返回空列表。`code` 非 0 时抛出携带 `msg` 的提供方错误。
- 仅对声明了该能力的提供方，在 `src/renderer/pages/settings/WebSearchSettings/` 中展示图片搜索，其元数据位于 `src/renderer/utils/webSearchProviderMeta.ts`。复用现有 StepFun 图标，不新增图标。

## 考虑过的替代方案

- 用 `searchKeywords` 处理图片查询：否决。响应结构、端点路径与计费均不同，调用会悄悄返回错误类型的结果。
- 注册独立的 "StepFun Image" 提供方：否决。同一账号的 API key 配置会被重复，且同一提供方身份会被拆成两个条目。
- 暂缓文搜图，仅交付关键词搜索：即当前状态。若能力模型变更未获批准，则保留此为回退方案。

## 验收标准

- AC1 — `searchImages` 是合法的共享能力；StepFun 的目录与预设同时声明 `searchKeywords` 与 `searchImages`；其他提供方的能力集合不变。（验证：unit — 能力 schema 与目录测试）
- AC2 — 图片调用向已配置 origin 的 `/step_plan/v1/search-image` 路径发送请求，使用 Bearer 认证、`query`，且 `topk` 不超过文档化上限。（验证：unit — `packages/web-search/src/__tests__/stepfun.test.ts` 中的请求结构测试）
- AC3 — `code` 为 0 时，将 `data.result.search_results` 映射为包含 URL、描述、尺寸与来源页面的图片结果；`data.result.block: true` 时返回空列表且不报错。（验证：unit）
- AC4 — `code` 非 0 时，以包含 `msg` 的提供方错误形式呈现。（验证：unit）
- AC5 — 设置界面仅对声明了 `searchImages` 的提供方（即 StepFun）展示图片搜索。（验证：renderer）
- AC6 — 关键词搜索行为不变，包括 `/v1/search` 端点与 `n` 上限 20；既有 `stepfun.test.ts` 用例全部通过。（验证：unit）

## 风险

- 返回的图片归原网站所有，接口不做版权或商用审查。UI 与结果使用方不得暗示可以再利用这些图片。
- 每次图片调用都在 Step Plan 渠道计费。使用普通 StepFun key 的用户可能收到认证或权限错误；这些必须作为提供方错误展示，而不能显示为空结果。
- 修改共享能力联合类型会影响已存偏好的校验。已有值必须仍可解析，由 AC1 覆盖。
- `apiHost` 路径规范化目前会将路径改写为 `/v1/search`（`packages/web-search/src/providers/stepfun.ts`）。新增第二条路径不得改变关键词搜索的 URL，由 AC6 覆盖。
