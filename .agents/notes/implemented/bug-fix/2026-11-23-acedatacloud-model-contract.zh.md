# Agent Note: Ace Data Cloud 模型契约

Status: implemented

[English](2026-11-23-acedatacloud-model-contract.md) | 中文

## Problem

Ace Data Cloud 预设使用了仅适用于 OpenAI 服务的路径。通用模型列表混入聊天和媒体模型 ID，也没有声明每个模型使用的协议。按这些 ID 匹配其他提供商的目录，还可能带入不适用的价格、限制和工具能力。

## Decision

复用现有的提供商独立模型解析与端点类型。将已认证网关的模型 ID 与公开的聊天模型目录取交集，保留具备图像能力的聊天模型，并选择其声明的 Chat Completions、Responses 或 Messages 端点。Messages 传输把 SDK 选定的凭据改为 Bearer 认证，同时保留现有 fetch 传输和请求体。自定义主机保持原有配置行为。

沿用现有工具能力检查和模型更新行为。公开目录没有声明工具能力时，导入的模型默认不启用函数调用，用户可在模型设置中开启。未声明端点的模型使用提供商配置的聊天端点。

## Alternatives considered

- 复制模型厂商目录，或把所有网关 ID 放进 Chat Completions：否决，因为名称不能证明接口兼容性或价格。
- 公开目录省略工具元数据时允许尝试工具。这会让普通聊天在模型未声明能力时附带工具。
- 为每个未声明端点的模型写入默认端点。这可能盖过用户配置的自定义主机。

## Consequences

工具是否可用由现有模型设置控制。新增的官方模型 ID 可在下次刷新时出现。元数据校验失败时沿用现有错误和重试流程。

## Verification

- Regression — 主进程提供商测试覆盖带协议的模型发现、原生 Messages Bearer 认证，以及自定义 Responses 主机的模型发现和端点选择。
- Regression — SQLite 测试覆盖端点未声明的模型、端点回退，以及编辑其视觉能力后工具仍未启用。
- Regression — 提供商注册表测试覆盖目录约束、端点契约和向前兼容性。没有执行付费的原生推理，也没有运行打包应用的 UI 验收。
