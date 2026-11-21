# Agent Note: 面向 Jev 模型的 OpenRouter Decisions API 客户端

Status: proposed

[English](2026-11-06-openrouter-decisions-api.md) | 中文

## Problem

OpenRouter 通过 alpha 版 Decisions API（`POST /api/alpha/decisions`）提供 `typesafe/jev-1.13` 等 Jev 模型。该接口接收 `model`、`state` 和 `questions`，返回带类型的答案（`choice`、`noul`、`score`），而不是助手文本。对话式 chat-completion 流程无法承载该协议（#20806）。

## Proposal

- 新增主进程 `decisionsService`：使用 OpenRouter 提供商的 API 密钥和 base URL 的 origin 调用 Decisions 端点，校验响应，失败时抛出带类型的 `DecisionsError`。
- 新增共享的请求/答案 schema 和 `decisions.create` IpcApi 路由，供后续渲染进程界面调用。
- 非目标：任何界面、助手工具或聊天集成，待维护者确定呈现形式后再做。将 Jev 注册为提供商注册表中的非聊天模型，待确认注册表的模型类型处理方式后作为后续工作。
- 通过自定义参数传递 `response_format` 仍是普通结构化输出的通用方式。

## Alternatives considered

- 将 Jev 建模为带 `response_format` 的聊天模型：否决，Decisions 协议的端点和结果形态不同。
- 在渲染进程直接 fetch：否决，API 密钥保存在主进程。

## Acceptance criteria

- AC1 — Decisions 请求携带 ****** `model`、`state` 和 `questions` 发送到 `/api/alpha/decisions`（verification: unit）
- AC2 — 能解析 `choice`、`noul` 和 `score` 答案，并拒绝格式错误的答案（verification: unit）
- AC3 — HTTP 失败以携带状态码的 `DecisionsError` 呈现（verification: unit）
- AC4 — 可通过 IpcApi 调用 `decisions.create`（verification: unit）

## Risks

该端点为 alpha 版本，无法对照线上 OpenRouter 验证其 schema；答案 schema 对额外字段保持宽松，便于低成本调整。
