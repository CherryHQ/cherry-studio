# Agent Note: QVeris 托管 MCP 的 OAuth 登录与 API Key 兜底

Status: implemented

[English](2026-11-13-qveris-oauth-sign-in.md) | 中文

## 问题

QVeris 内置 MCP 服务器（`https://mcp.qveris.ai/mcp`）最初要求先配置 `QVERIS_API_KEY` 才能启用：`McpServerService` 在缺少密钥时拒绝激活，渲染进程用弹窗拦截开关，`resolveBuiltinExternalMcpServer` 直接抛错。QVeris 托管 MCP 端点现已支持 MCP OAuth 登录（RFC 9728 受保护资源元数据 → `https://auth.qveris.ai`，动态客户端注册，PKCE 公有客户端），静态 API Key 不再是唯一凭证 —— 而且它也是更脆弱的一种。

## 决策

OAuth 是首选凭证；`QVERIS_API_KEY` 是兜底：

- **工厂**（`src/main/ai/mcp/servers/factory.ts`）：预设不再因缺少密钥而抛错。已配置的密钥作为兜底的 `Authorization: Bearer` 请求头附加；密钥为空时不添加该头，让服务器的 `401` 挑战驱动 OAuth。
- **连接**（`src/main/ai/mcp/connections/ExternalMcpConnection.ts`）：对内置 QVeris 服务器（`installSource === 'builtin'`），`prefersOAuth` 即使在存在 Bearer 头时也保持 OAuth provider 挂载。缓存的 OAuth 令牌通过 SDK 的 `_commonHeaders()` 覆盖静态头。
- **凭证隔离**：偏好 OAuth 时，兜底 Bearer 头会从 `requestInit.headers` 中剥离。否则 SDK 的 `createFetchWithInit` 会把它泄漏到 OAuth 发现、DCR 和 `POST /oauth/token` 请求上，QVeris 授权服务器会以 `401 invalid_client`（"HTTP Basic client authentication is required"）拒绝。兜底头只对发往 MCP 资源 URL 且尚未携带 OAuth `Authorization` 头的请求重新附加。
- **交互式登录**：`mcp.server.refresh_tools` 将调用方 `senderId` 经 `McpCatalogService.refreshTools` 传入 `McpRuntimeService.listToolsWithContext`，在设置里开启 QVeris 时可以打开登录浏览器，而不是落入后台调用方的非交互 `UnauthorizedError` 死路。
- **渲染进程**：移除 API Key 拦截与 `QVerisApiKeyGuide` 弹窗；缺少密钥不再阻塞激活。所有语言的内置服务器描述都以 OAuth 优先、API Key 其次。
- **服务器键**：`McpRuntimeService.getServerKey` 用 SHA-256 哈希连接配置（含 env/headers），API Key 不会以明文留在运行时 map 键里。

## 考虑过的替代方案

- 继续强制 `QVERIS_API_KEY`：不采用 —— OAuth 是服务方支持的登录方式，并避免长期静态密钥。
- 完全移除 API Key 支持：不采用 —— 对无法完成浏览器流程的用户，密钥仍是有效兜底，且 OAuth 令牌存在时本就优先。
- 把 Bearer 头留在 `requestInit`、在包装 fetch 中按请求剥离：不采用 —— SDK 的 OAuth fetch 链正是从 `requestInit` 构建的，泄漏发生在按端点剥离这一层；在构造时剥离更简单也更彻底。
- `prefersOAuth` 仅按名称匹配 QVeris：不采用 —— 手动创建的同名 `@cherry/qveris` 服务器应遵循通用的基于请求头的行为，而不是内置 OAuth 偏好。

## 影响

无密钥首次激活会打开浏览器进行 OAuth 登录；已配置密钥时立即以密钥认证，之后的 OAuth 登录会取代它。密钥被吊销时，交互上下文中的 `401` 会自动回落到 OAuth。令牌刷新与交换永不携带静态头。带 Authorization 头的手动服务器保持原有非 OAuth 路径不变。

## 验证

- Regression — `pnpm test:main src/main/ai/mcp/connections/__tests__/ExternalMcpConnection.test.ts`：覆盖 `prefersOAuth` 内置门控、OAuth 令牌优先于兜底密钥、干净的刷新，并断言发现/注册/令牌端点不收到任何 `Authorization` 头（包括 AS 侧对 `/oauth/token` 上任何 Bearer 头的 `401 invalid_client` 拒绝）。
- Regression — `pnpm test:main src/main/ai/mcp/servers/__tests__/factory.test.ts src/main/ai/mcp/__tests__/McpCatalogService.test.ts src/main/ai/mcp/__tests__/McpRuntimeService.test.ts src/main/ipc/handlers/__tests__/mcp.test.ts src/main/data/services/__tests__/McpServerService.test.ts`：工厂兜底头、`listToolsWithContext` 的 windowId 透传、无密钥哈希服务器键、IPC `senderId` 转发，以及无密钥激活。
- Regression — `pnpm test:renderer src/renderer/pages/settings/McpSettings/__tests__/McpSettings.test.tsx src/renderer/pages/settings/McpSettings/__tests__/McpServerCard.test.tsx src/renderer/pages/settings/McpSettings/__tests__/McpServerFields.test.tsx` 与 `pnpm test:shared src/shared/data/presets/__tests__/mcpServers.test.ts`：拦截移除与预设形状。
- Gates — `pnpm test:lint`、`pnpm typecheck`、`pnpm i18n:check`、`pnpm i18n:unused:check`、改动文件的 `oxfmt --check`、`pnpm docs:check`。
