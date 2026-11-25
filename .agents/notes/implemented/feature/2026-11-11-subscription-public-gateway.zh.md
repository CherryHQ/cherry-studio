# Agent Note: 通过公共网关调用 CherryAI 订阅

Status: implemented

[English](2026-11-11-subscription-public-gateway.md) | 中文

## 问题

CherryAI 订阅模型可以通过内部网关调用，但单独的公共模型过滤规则会向外部客户端和 Code Mate 隐藏并拒绝这些模型。

## 决策

公共模型资格复用现有网关路由判断。已启用的订阅聊天模型出现在模型列表和 Code Mate 选择器中，并接受外部请求。现有 Cherry Cloud provider 检查当前模型订阅权限，使用已登录账号发送请求；服务端执行订阅额度限制。网关仍要求鉴权。

## 考虑过的替代方案

- 继续将订阅限制为内部调用：无法满足外部客户端使用的需求。
- 向客户端导出账号凭据：provider 已负责鉴权请求，无须导出。

## 影响

持有网关密钥的客户端可以消耗已登录账号的订阅额度。非聊天模型、未启用的服务商或模型以及托管默认模型保留现有限制。外部请求不会获得内部 Agent 用量归属或内部请求权限。

## 验证

- Regression — `src/main/features/apiGateway/utils/__tests__/models.test.ts`：订阅模型具备资格、可列出并解析；不支持的模型仍被排除。
- Regression — `src/main/ai/provider/__tests__/cherryCloud.test.ts`：托管鉴权、订阅权限失败及服务端额度响应保留现有行为。
- Regression — `src/renderer/pages/code/hooks/__tests__/useConfigMetadata.test.ts`：可以通过网关选择订阅模型。
