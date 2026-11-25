# Agent Note：Gemini Chat Completions 的工具混合枚举

Status: implemented

[English](2026-11-24-gemini-chat-tool-enums.md) | 中文

## 问题

Gemini 工具参数使用 `enum: ["auto", 1]` 时，CherryIN 的 Chat Completions 端点返回 HTTP 400。Google 的 Chat Completions 端点接受同一份声明。即使模型和协议相同，自定义中转支持的 schema 也可能不同。

## 决策

如果原始模型 ID 能识别为 Gemini，出站 Chat Completions 请求的工具 schema 就复用现有的枚举归一化。MCP 仍按原始 schema 校验工具实参。

## 考虑过的替代方案

只为 CherryIN 增加规则会漏掉自定义中转。对所有 Chat Completions 请求应用 Gemini 规则会放宽无关模型的工具约束。

## 后果

可识别的 Gemini 模型在不同中转上都会应用枚举转换。无法识别的模型别名不命中此规则。归一化可能放宽出站声明的约束，例如数值分支通过描述列出允许值时。

## 验证

- Regression — `toolSchemaCompatibility.test.ts` 验证 OpenAI-compatible 和 New API adapter 发出兼容的混合枚举、保留合法的整数枚举，并保留 MCP 的原始校验。
- Live HTTP — CherryIN 上的 Gemini 4 Argon 拒绝原始枚举，接受归一化后的声明。Google 官方 Chat Completions 端点两种都接受。
