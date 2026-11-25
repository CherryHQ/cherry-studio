# Agent Note: MCP 探测连接关闭后的旧版握手回退

Status: implemented

[English](2026-11-19-mcp-probe-closed-legacy-fallback.md) | 中文

## 问题

SDK 使用 `EraNegotiationFailed` 标识失败的 `server/discover` 探测，包括未收到 HTTP 响应的网络故障。Cherry Studio 还要求 HTTP 状态码 ≥ 500 才重试旧版握手。关闭探测连接的网关不会提供状态码，例如 Electron 报告的 `net::ERR_EMPTY_RESPONSE`，因此无法进入回退流程，导致原本兼容的自托管 Streamable HTTP MCP 服务器无法连接。身份验证失败和探测超时使用不同的 SDK 错误码。

## 决策

将错误码为 `EraNegotiationFailed` 的普通 `SdkError` 视为支持旧版回退的依据。对于 `SdkHttpError` 子类，继续要求 HTTP 状态码 ≥ 500。使用同一个 URL 传输候选，以旧版协商模式重试一次，发送 `initialize`。如果组合后的连接信号已中止，则跳过重试；这同时涵盖调用方取消和现有的连接超时。如果旧版握手也失败，则重新抛出原始探测错误。重试日志包含错误消息，并在有 HTTP 状态码时记录该状态码。

## 考虑过的替代方案

- 为个别 Chromium 或网络错误码设置白名单，依赖于 Electron 和 Node/undici 对同一故障的不同报告方式。
- 额外手动执行一次 `fetch` 探测会重复 SDK 的协商逻辑，并增加一次往返请求。
- 对 HTTP 4xx 重试会把身份验证或授权失败转化为协议猜测。

## 后果

仅支持旧版协议、且网关关闭 `server/discover` 连接的服务器可以通过 `initialize` 连接。无法访问的服务器会多进行一次 `initialize` 尝试，但仍受现有连接超时限制。探测和连接的超时语义保持不变。身份验证和授权失败不会触发旧版回退。两次尝试均失败时，由于重新抛出的是原始探测错误，故障分类和用户可见的诊断保持不变。

## 验证

- Regression — `connects and lists tools as legacy when server/discover closes without an HTTP response`：`net::ERR_EMPTY_RESPONSE` 触发一次旧版握手，连接满足 `era === 'legacy'`，并可获取 `mx_quote` 工具。
- Regression — `returns the original closed-probe error after exactly one failed legacy handshake`：`initialize` 返回 HTTP 502 时，保留普通 SDK 探测错误、其 `EraNegotiationFailed` 错误码，以及连接关闭的消息和原因链。
- Regression — `does not retry as legacy when the caller aborts an in-flight probe`：探测期间取消操作不会发送 `initialize` 请求。
- Regression — `retries a network failure as legacy once and returns the original probe error`：第二次网络故障不会替换原始探测诊断，旧版尝试次数限定为一次。
- Regression — `keeps a real refused TCP connection local during the %s handshake`：两种情况均在一次旧版尝试后保留原因链中的 `ECONNREFUSED`，并将故障分类为 environment/expected/transport_unavailable。
- Regression — `recognizes a non-HTTP SDK probe failure as legacy probe evidence` 和 `rejects bare network errors and SDK timeouts as legacy probe evidence`：只有 SDK 的协商失败判定符合条件。
- Regression — `connects and lists tools when a legacy server rejects server/discover with HTTP 500`、`connects as legacy when server/discover returns an HTML 5xx body` 和 `connects as legacy when server/discover returns a bare empty 5xx body`：继续覆盖现有的 HTTP 5xx 兼容行为。
- Regression — `keeps HTTP 401 as an authentication failure`、`rejects %s as legacy probe evidence` 和 `keeps a modern server on the modern connection path`：身份验证、授权、HTTP 状态码排除条件和新版协商均保留原有契约。
- Regression — `pnpm test:main src/main/ai/mcp/connections/__tests__/ExternalMcpConnection.test.ts src/main/ai/mcp/__tests__/failureFacts.test.ts`：2 个文件中的 48 项测试通过。
- Regression — `pnpm exec oxfmt --check src/main/ai/mcp/connections/ExternalMcpConnection.ts src/main/ai/mcp/connections/__tests__/ExternalMcpConnection.test.ts`：执行限定文件范围的格式写入命令后，两个文件均通过格式检查。
