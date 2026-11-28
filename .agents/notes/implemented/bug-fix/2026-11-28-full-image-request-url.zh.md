# Agent Note: 完整图片请求地址按原样 POST

Status: implemented

[English](2026-11-28-full-image-request-url.md) | 中文

## Problem

自定义图片端点 Base URL 被当作基础 host 处理：`formatApiHost` 会追加 `/v1`（带点版本号如 `/v2.1/` 无法识别），而 `OpenAICompatibleImageModel` 会追加 `/images/generations`。讯飞星火 TTI 这类完整厂商路径 `https://maas-api.cn-huabei-1.xf-yun.com/v2.1/tti` 会被拼成 `.../v2.1/tti/v1/images/generations`（404）。粘贴完整的 OpenAI 路径 `.../v1/images/generations` 同样会被重复追加后缀。

## Decision

`src/shared/utils/api/format.ts` 中的 `isFullImageRequestUrl()` 用于识别完整的图片请求地址：路径以 `/images/generations|edits` 结尾，或为带点版本号且其后还有路径的厂商地址（`/v2.1/tti`）。检测前会先去掉末尾 `#`。`src/main/ai/provider/config.ts` 中的 `formatBaseURL()` 对完整地址直接返回归一化结果，不再追加 `/v1`；`buildOpenAICompatibleConfig()` 会安装 fetch 包装，将 OpenAI 请求体直接 POST 到完整地址，而非 SDK 拼接后的地址。`customProviderCreation.ts` 中的自定义服务商预览同样原样展示最终地址。`https://relay.example.com/custom#` 这类普通 host 仍保持 `base + /images/...` 的原有行为。

## Alternatives considered

- 为 Spark TTI 实现原生 `header/parameter/payload` 映射的专属传输：能适配 TTI 原生接口，但涉及 preset/registry 等更大改动；本 issue 要求的是完整路径直发，故暂缓。
- 将所有以 `#` 结尾的图片 host 都视为完整地址：会破坏 NewAPI 测试覆盖的 `.../custom#` 基础行为。
- 全局扩展 `hasApiVersion` 以识别带点版本号：只能解决 `/v1` 误追加，无法解决 SDK `/images/...` 追加。

## Consequences

完整图片地址（生成与编辑）将按输入原样 POST；普通 host 行为不变。TTI 仍收到 OpenAI 兼容请求体，若厂商要求原生 TTI 结构，会以正确的 URL 返回其自身的 schema 错误。NewAPI/AiHubMix 等网关传输不受影响。

## Verification

- Regression — `src/shared/utils/api/__tests__/api.test.ts`：`.../v2.1/tti`、`.../v2.1/tti#` 与 `.../v1/images/generations` 判定为完整地址；`.../custom#` 与 `.../gateway/v1` 不是。
- Regression — `src/main/ai/provider/__tests__/config.test.ts`：完整图片地址解析为 `openai-compatible` 且 `baseURL` 精确一致，并安装改写 fetch；`.../custom#` 仍使用 `customFetch`。
- Regression — `src/renderer/pages/settings/ProviderSettings/ProviderList/__tests__/customProviderCreation.test.ts`：完整图片地址预览原样展示。
