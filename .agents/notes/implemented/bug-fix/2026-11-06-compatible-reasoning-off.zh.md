# Agent Note: 兼容端点的推理关闭回退策略

Status: implemented

[English](2026-11-06-compatible-reasoning-off.md) | 中文

## 问题

全局回退为兼容端点提供关闭选项，但未知服务可能拒绝由此产生的推理强度。一个提供 Qwen3.8-27B 的服务拒绝了 `none`。

## 决策

从全局回退线路中移除关闭选项。明确的端点和模型线路仍然具有权威性，包括支持关闭选项的契约。

## 考虑过的替代方案

收窄规范 Qwen 条目会在缺乏证据时将一个服务的拒绝视为模型固有能力限制，并且无法修复未匹配的别名。

## 后果

使用回退路径的用户失去界面中的关闭选项。服务可能按默认设置进行推理，也可能增加健康检查延迟。显式自定义参数仍可使用并会透传。

## 验证

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/utils/__tests__/reasoningCompatibility.test.ts`: 使用拒绝无效值的服务夹具检查注册表投影和 SDK 请求序列化。
