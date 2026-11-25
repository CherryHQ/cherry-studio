# Agent Note: 为 New API 对话模型选择可用的 API 密钥

Status: implemented

[English](2026-11-24-model-group-key-failover.md) | 中文

## 问题

同一提供商的不同 API 密钥可能支持不同的模型。轮询有时会将对话请求发给所属分组不支持所选模型的密钥。网关会明确返回 HTTP 404，说明该分组不支持模型，而现有的 401/429 密钥切换逻辑不会介入，导致回复失败。

## 决策

对于标准的 New API Chat Completions，查询每把已启用密钥的模型列表，只在列有所请求模型的密钥之间轮询。逐密钥模型列表缓存在主进程。列表无法确定可用密钥时，保留原有轮询逻辑。对明确的分组 404 沿用同模型切换密钥逻辑，以处理过时或不完整的列表。

## 考虑过的替代方案

- 对所有 HTTP 404 都切换密钥，会向不存在的路由重复发送请求，并掩盖配置错误。
- 如果模型列表已经能提前找到可用密钥，等首次生成失败再切换会浪费一次对话请求。

## 后果

首次查询最多等待两秒。后续请求可在一分钟内复用列表。显式指定密钥、自定义请求头或使用其他端点时跳过查询。无关的 404 不会触发密钥切换，用尽密钥后仍会显示错误。

## 验证

- Regression — `createRetryableWrap.apiKeyFailover.test.ts`：分组 404 用例在修复前失败，修复后能继续流式生成原模型的回复；普通 404 仍会传递给调用方。
- Regression — `createRetryableWrap.test.ts` 和 `createRetryableWrap.apiKeyFailover.test.ts`：使用测试响应的 29 项 Vitest 定向测试通过。
- Regression — `config.test.ts` 和 `ProviderService.apiKeys.test.ts`：163 项测试通过，覆盖初始密钥选择、复用缓存和保留显式指定的密钥。
