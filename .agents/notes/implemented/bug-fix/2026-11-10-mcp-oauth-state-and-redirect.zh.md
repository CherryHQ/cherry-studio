# Agent Note：保留 MCP OAuth state 并兼容 loopback 重定向

Status: implemented

[English](2026-11-10-mcp-oauth-state-and-redirect.md) | 中文

## 问题

MCP 授权依赖用于防御 CSRF 的 state 值和精确匹配的已注册重定向 URI。OAuth SDK 生成的授权 URL 可能省略可选的 state 参数，而部分 MCP 提供方允许列表配置的是 `localhost`，不是 `127.0.0.1`。

## 决定

打开授权 URL 前，MCP OAuth 提供方会要求存在已持久化的 state，并将该值写入 URL。若尚未持久化 state，则授权尝试会失败且不会打开浏览器。新客户端注册使用 `localhost`；已保存的客户端在授权请求和授权码交换时保留已注册的 loopback URI。缺少元数据的旧客户端保留原来的 `127.0.0.1` URI。选择按授权流程隔离，重建 provider 后处理回调时从绑定到 issuer 的已保存客户端重新读取。回调服务器仍绑定到 `127.0.0.1`。

## 备选方案

- 信任 SDK 生成的 URL 一定包含 state：不采用，因为 SDK 的 provider state hook 是可选的；缺少 state 会使授权服务器拒绝请求。
- 将 `127.0.0.1` 保留为已声明的重定向主机：不采用，因为仅允许 `localhost` 的提供方要求重定向 URI 精确匹配。

## 后果

- MCP 授权请求始终携带与回调验证所存储的 state 相同的值；不完整的请求会在打开浏览器前失败。
- 新注册声明 `localhost`，已有注册保留其精确 URI。本地回调监听器仍限制在 IPv4 loopback。

## 验证

- 回归 — `pnpm test:main src/main/ai/mcp/oauth/__tests__/provider.test.ts`：授权重定向包含已持久化的 state，缺少 state 时阻止启动浏览器，且新客户端元数据使用 `localhost`。SDK 协议回归还覆盖已保存的 IPv4 注册、无元数据的旧注册、已保存的 localhost 注册和新注册的授权及重启后的回调。并发 issuer 的选择保持隔离。测试拦截协议请求，不代表真实提供方或浏览器登录验证。
