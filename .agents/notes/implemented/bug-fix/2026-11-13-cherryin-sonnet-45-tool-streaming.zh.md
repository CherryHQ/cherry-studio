# Agent Note：CherryIN Sonnet 4.5 工具流式传输

Status: implemented

[English](2026-11-13-cherryin-sonnet-45-tool-streaming.md) | 中文

## 问题

CherryIN 的 Claude Sonnet 4.5 Bedrock 路由会拒绝带有 `eager_input_streaming` 的工具定义，并返回 HTTP 400。Anthropic SDK 默认在流式请求中发送该字段，也会处理调用方对单个工具的显式开启选项。

## 决策

CherryIN Anthropic 适配器在模型和单工具两层为 Sonnet 4.5 关闭工具输入细粒度流式传输。适配器保留工具 schema，对流式和非流式调用采用同一处理方式。

## 考虑过的替代方案

在内部网关入口移除字段后，出站 SDK 仍会重新添加。对全部 CherryIN 模型关闭则会改变上游接受该字段的模型的行为。

## 后果

CherryIN 的 Sonnet 4.5 使用缓冲式工具输入。CherryIN 的其他模型和其他服务商保留各自的流式行为。

## 验证

- Regression — `cherryin-provider.test.ts`：检查 Sonnet 4.5 默认和显式开启时的出站字段，验证工具 schema 得以保留，并检查 Sonnet 4.6 仍发送该字段。
- Regression — Windows 桌面端 Work 会话：Pi Durable 会话中的真实 CherryIN Sonnet 4.5 请求正常完成，未出现此前的校验错误。
