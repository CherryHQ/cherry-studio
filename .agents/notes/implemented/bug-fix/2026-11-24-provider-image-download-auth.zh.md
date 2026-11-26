# Agent Note：为同源提供商图片下载添加鉴权

Status: implemented

[English](2026-11-24-provider-image-download-auth.md) | 中文

## 问题

在 [#25250](https://github.com/CherryHQ/cherry-studio/issues/25250) 中，OpenAI 兼容提供商返回图片 URL，而非 `b64_json`。下载没有显式携带提供商的 API key，需要提供商鉴权的图床因此返回 HTTP 401。AI SDK 丢弃下载失败的图片，用户看到的是通用的“没有生成图片”，而非下载失败提示。

## 决策

对于 OpenAI 兼容生图，仅当下载目标的 origin 与已解析的提供商端点 origin 相同时，携带生图请求实际使用的 API key。使用 `credentials: 'omit'` 和手动重定向，每跳都通过 `sanitizeRemoteUrl` 校验，并保留最多 20 跳重定向的限制。仅在 HTTP 301/302/303/307/308 时跟随 Location；其他响应（包括带 Location 的 401/403）直接返回，不跟随。跨 origin 重定向会永久移除后续各跳的 Bearer 令牌，即使后续跳回提供商的 origin 也不恢复。

当下载失败导致没有生成图片时，使用既有的 `paintings.image_download_failed` 文案，并在可用时附上下载 host 与 HTTP 状态。不暴露 API key 或响应正文。通过 `addAbortSignal` 将取消绑定到成功响应的流，并在收到 `aborted` 事件时销毁该流，使正文读取能够结束。取消不会被转换成下载失败错误，也不会使图片落盘。

## 考虑过的替代方案

- 为所有图片下载携带 key：这会将提供商凭据泄漏给第三方 CDN。
- 传入 `configuredApiHost` 放行私网下载：这改变了既有安全策略的适用范围，需要另行处理。
- 只依赖 `b64_json`：提供商行为不受客户端控制。OpenAI 兼容 SDK 默认请求此格式，但部分模型前缀会省略该字段，显式配置也可覆盖。

## 影响

- 本地或 LAN 提供商的同源图片 URL 仍会被 SSRF 守卫拦下，即使配置的端点与其匹配。
- ppio、dashscope、modelscope 等自定义 transport 的 job 路径仍在下载时不显式携带提供商凭据；这些路径的鉴权需要另行处理。
- 多张图片下载失败时，错误只保留一条 host 与 HTTP 状态详情。

## 验证

- 回归 — 收窄重定向状态码判定并新增一条回归测试后，`node node_modules/vitest/vitest.mjs run --project main src/main/ai/__tests__/AiService.test.ts` 输出 `Test Files 1 passed (1)` / `Tests 130 passed (130)`；`node node_modules/vitest/vitest.mjs run --project main src/main/utils/__tests__/downloadAsBase64.test.ts` 输出 `Test Files 1 passed (1)` / `Tests 9 passed (9)`。新增用例在加守卫前失败、守卫后通过。该测试证明 HTTP 401 带 Location 时不发出第二个请求，错误含 `HTTP 401`，且不落盘；收窄判定前，该用例反而返回已落盘的 SVG 登录页图片。
- 回归 — `pnpm run typecheck`（CI 入口，等同于 `pnpm check --all --group types`）通过，退出码为 0。
- 回归 — 既有、与本改动无关的问题：直接运行 `tsc -p tsconfig.node.json --composite false` 会在未改动的 `src/main/ai/agentSession/AgentSessionRuntimeService.ts:1308` 报 TS2322；在把两个产品文件恢复到分支起点的对照检出中同样复现了该错误。这是既有问题，不在本 PR 范围内。
- 回归 — `npx oxlint --deny-warnings src/main/utils/downloadAsBase64.ts src/main/ai/AiService.ts src/main/ai/__tests__/AiService.test.ts tests/main.setup.ts` 通过；`npx oxfmt --check src/main/utils/downloadAsBase64.ts src/main/ai/AiService.ts src/main/ai/__tests__/AiService.test.ts tests/main.setup.ts` 的全部 4 个文件通过。
- 回归 — 针对重定向状态码判定的改动，`npx oxlint --deny-warnings src/main/utils/downloadAsBase64.ts src/main/ai/__tests__/AiService.test.ts` 通过；`npx oxfmt --check src/main/utils/downloadAsBase64.ts src/main/ai/__tests__/AiService.test.ts` 的两个文件均通过。
- 回归 — 针对回环服务器运行的独立 Electron 45.2.2 探针确认：匿名 GET 需要 key 的路由返回 401，带 `Authorization: Bearer` 返回 200，`redirect: 'manual'` 只抛 302 事件、不自动跟随，且正文读取中 abort 能在约 1ms 内结束，无 uncaught 错误。
