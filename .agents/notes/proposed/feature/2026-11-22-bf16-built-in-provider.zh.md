# Agent Note: bf16.ai 内置服务商

Status: proposed

[English](2026-11-22-bf16-built-in-provider.md) | 中文

## Problem

bf16.ai 用户目前需要手动配置自定义 OpenAI 兼容连接。在服务商注册表中增加内置预设，可让用户开箱即用地获得准确的 1M 上下文上限、多模态能力、工具调用元数据及官方品牌图标。

## Proposal

新增内置 `bf16`（`bf16.ai`）预设，使用 `https://api.bf16.ai/v1` 的 OpenAI 兼容 Chat Completions 端点（`GET https://api.bf16.ai/v1/models` 返回标准 OpenAI 模型列表，支持动态拉取）及 API Key 认证（`BF16_API_KEY`）。注册五个公开的 1M 上下文免审查模型（`zai-org/glm-5.3-uncensored`、`deepseek/deepseek-v4.1-flash-uncensored`、`deepseek/deepseek-v4.1-flash-uncensored-fast`、`zai-org/glm-5.3-flash-uncensored`、`moonshotai/kimi-k3.1-pro-uncensored`），并补充官方浅色/深色 SVG 图标与多语言标签。

五个模型均支持 1,048,576 上下文窗口、隐式提示词缓存、工具调用、结构化输出及推理强度控制（DeepSeek V4.1 Flash 系列支持 `none|low|high|max`；GLM-5.3 与 Kimi K3.1 Pro 系列支持 `low|high|max`）。其中 `deepseek/deepseek-v4.1-flash-uncensored`、`deepseek/deepseek-v4.1-flash-uncensored-fast`、`zai-org/glm-5.3-flash-uncensored` 与 `moonshotai/kimi-k3.1-pro-uncensored` 支持多模态图片输入（`text+image->text`）。当前公开的每百万 Token 美元定价（输入 / 缓存命中 / 输出）为：DeepSeek V4.1 Flash Uncensored `0.26 / 0.045 / 1.00`、DeepSeek V4.1 Flash Uncensored Fast `0.28 / 0.055 / 1.12`、GLM-5.3 Flash Uncensored `0.30 / 0.065 / 1.12`、GLM-5.3 Uncensored `1.35 / 0.25 / 4.20`、Kimi K3.1 Pro Uncensored `2.90 / 0.45 / 9.90`。来源：[模型目录](https://api.bf16.ai/v1/models)、[文档](https://bf16.ai/docs)和[定价](https://bf16.ai/pricing)。本提案不新增运行时传输层、不修改存储结构，也不改动共享标准模型定义。

## Alternatives considered

自定义 OpenAI 兼容连接目前已可用，并可从 `GET /v1/models` 拉取模型 ID，但用户仍需手动填写 Base URL，且无法开箱获得预置的 1M 上下文限制、多模态视觉标记、推理强度档位、每百万 Token 定价元数据与官方品牌图标。修改共享标准原厂模型则会将 bf16.ai 的定价与免审查版本错误归属给原厂服务商。

## Acceptance criteria

- AC1 — 服务商注册表列出 `bf16`（`bf16.ai`），配置 `https://api.bf16.ai/v1` 及动态模型拉取支持，同时保持其他服务商行为不变 (verification: unit)
- AC2 — 默认模型元数据保留 1,048,576 上下文限制、多模态视觉标记、工具调用能力与公开每百万 Token 美元定价，且不修改标准原厂模型 (verification: unit)
- AC3 — 官方单色/浅色/深色 SVG 图标、`packages/ui/src/components/icons/loader.ts` 中的批量服务商图标目录加载器与按图标查询加载器，以及全部语言包通过图标与 i18n 注册表测试 (verification: unit)
- AC4 — 隔离桌面会话与请求级序列化检查验证模型列表拉取、带推理内容的流式对话、外发 `reasoning_effort` 参数（包括 DeepSeek 的 `none` 与 `max`，以及 GLM-5.3/Kimi 的 `low`/`high`/`max`）、视觉输入及对 `https://api.bf16.ai/v1` 的工具调用，且不泄露凭据 (verification: renderer)
- AC5 — 合并前在实施分支通过所有受影响的 provider-registry、图标与渲染端测试检查 (verification: unit)

## Risks

服务商价格与在售模型可能随时间调整，因此在提交实施 PR 前必须对照 `https://api.bf16.ai/v1/models` 再次核验实时费率与模型 ID。实施 PR 前需先获得上游对本提案的认可；本提案不声明已获批准，也不豁免 DCO 提交签名要求。
