# Agent Note: 完整图片请求地址按原样 POST

Status: implemented

[English](2026-11-28-full-image-request-url.md) | 中文

## Problem

自定义图片端点 Base URL 被当作基础 host 处理：`formatApiHost` 会追加 `/v1`（带点版本号如 `/v2.1/` 无法识别），而 `OpenAICompatibleImageModel` 会追加 `/images/generations`。讯飞星火 TTI 这类完整厂商路径 `https://maas-api.cn-huabei-1.xf-yun.com/v2.1/tti` 会被拼成 `.../v2.1/tti/v1/images/generations`（404）。粘贴完整的 OpenAI 路径 `.../v1/images/generations` 同样会被重复追加后缀。

## Decision

`src/shared/utils/api/format.ts` 中的 `isFullImageRequestUrl()` 基于解析后的 pathname 识别完整的图片请求地址：以 `/images/generations|edits` 结尾（检测时忽略可选 query），或为带点版本号且其后仅有一段路径的厂商地址（`/v2.1/tti`）。`.../v2.1/openai/v1`（点版本后还有两段）、`.../v2.1/openai`（网关标记）或以普通版本号结尾（`.../v2.1/v1`）仍视为普通 host。检测前会先去掉末尾 `#`。`normalizeFullImageRequestUrl()` 会原样保留 query（`.../generations?tenant=x`、`.../v2.1/tti?prefix=tenant/`）。`src/main/ai/provider/config.ts` 中的 `formatBaseURL()` 仅对明确配置的图片端点返回归一化结果，不再追加 `/v1`，因此图片栏留空而回退到 `.../v2.1/openai/v1` 这类对话 host 时仍保持 SDK 拼接；`buildOpenAICompatibleConfig()` 会按实际操作（`/images/edits` 与 `/images/generations`）在不同的生成/编辑完整地址之间路由，并通过 `HTTP_TRACE_FINAL_URL_SLOT` 记录实际发出的 URL，使开发者模式的 `http.url` 展示真实路径。`customProviderCreation.ts` 中的自定义服务商预览同样原样展示最终地址。`https://relay.example.com/custom#` 这类普通 host，以及 `.../multimodal-generation/generation#` 这类不符合规范的厂商路径，仍保持 `base + /images/...` 的原有行为，相关说明已在全部 renderer 语言包中更新。

## Alternatives considered

- 为 Spark TTI 实现原生 `header/parameter/payload` 映射的专属传输：能适配 TTI 原生接口，但涉及 preset/registry 等更大改动；本 issue 要求的是完整路径直发，故暂缓。
- 将所有以 `#` 结尾的图片 host 都视为完整地址：会破坏 NewAPI 测试覆盖的 `.../custom#` 基础行为。
- 全局扩展 `hasApiVersion` 以识别带点版本号：只能解决 `/v1` 误追加，无法解决 SDK `/images/...` 追加。

## Consequences

完整图片地址（生成与编辑，保留 query）将按输入原样 POST；普通 host 与 `.../v2.1/openai/v1` 这类网关地址行为不变。生成与编辑地址不同时按实际操作路由，`/images/edits` 会发往编辑完整地址。开发者模式追踪展示解析后的实际发出地址。TTI 仍收到 OpenAI 兼容请求体，若厂商要求原生 TTI 结构，会以正确的 URL 返回其自身的 schema 错误。NewAPI/AiHubMix 等网关传输不受影响。

## Verification

- Regression — `src/shared/utils/api/__tests__/api.test.ts`：`.../v2.1/tti`、`.../v2.1/tti#` 与 `.../v1/images/generations`（含 `?tenant=x` 变体）判定为完整地址；`.../custom#`、`.../gateway/v1`、`.../v2.1/openai/v1`、`.../v2.1/openai#` 与 `.../multimodal-generation/generation#` 不是；query 值保留末尾斜杠。
- Regression — `src/main/ai/provider/__tests__/config.test.ts`：完整图片地址解析为 `openai-compatible` 且 `baseURL` 精确一致（含 query），并安装改写 fetch；图片留空回退到网关对话地址与明确配置的 `.../v2.1/openai#` 仍使用 `customFetch`；不同生成/编辑完整地址按 `/images/edits` 与 `/images/generations` 路由。
- Regression — `src/renderer/pages/settings/ProviderSettings/ProviderList/__tests__/customProviderCreation.test.ts`：完整图片地址（含 query）预览原样展示；网关风格路径保持原有预览。
- Regression — `src/main/ai/observability/__tests__/httpTraceFetch.test.ts`：`HTTP_TRACE_FINAL_URL_SLOT` 将脱敏后的 `http.url` 改写为解析后的实际发出地址。
