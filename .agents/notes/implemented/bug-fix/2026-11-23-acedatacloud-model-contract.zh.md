# Agent Note: Ace Data Cloud 模型契约

Status: implemented

[English](2026-11-23-acedatacloud-model-contract.md) | 中文

## Problem

Ace Data Cloud 预设使用了仅适用于 OpenAI 服务的路径。通用模型列表混入聊天和媒体模型 ID，也没有声明每个模型使用的协议。按这些 ID 匹配其他提供商的目录，还可能带入不适用的价格、限制和工具能力。

## Decision

复用现有的提供商独立模型解析与端点类型。将已认证网关的模型 ID 与公开的聊天模型目录取交集，保留具备图像能力的聊天模型，并选择其声明的 Chat Completions、Responses 或 Messages 端点。Messages 传输把 SDK 选定的凭据改为 Bearer 认证，同时保留现有 fetch 传输和请求体。自定义主机保持原有配置行为。

通过可选的 `parameterSupport.tools.supported` 单独表示工具支持状态：`null` 表示未知，布尔值表示明确状态，缺少字段时保持现有行为。该状态保存于已有的 parameters JSON。自动导入同时保留已知的视觉、推理能力与未知的工具支持状态。用户编辑能力时写入明确布尔值。只有工具尝试的准入检查接受未知状态；已验证能力的展示仍读取能力列表。

## Alternatives considered

- 复制模型厂商目录，或把所有网关 ID 放进 Chat Completions：否决，因为名称不能证明接口兼容性或价格。
- 将缺失的工具元数据当作不支持，或宣称所有模型都支持工具：否决，因为前者会阻止用户已有的尝试，后者会宣称未经验证的能力。
- 新增数据库列或单独的模型目录：没有必要，已有 JSON 元数据与公开目录足以保存所需状态。

## Consequences

没有新增表或迁移文件。支持状态元数据不会变成出站请求的 `tools` 数组。用户已有的明确能力覆盖继续生效。新增的官方模型 ID 可在下次刷新模型时出现，无需发布代码。此集成要求公开目录包含端点元数据；元数据校验失败时沿用现有错误与重试流程。

## Verification

- Regression — 主进程提供商测试覆盖类型化模型发现、原生 Messages Bearer 认证、调用者工具及请求体隔离；真实 SQLite 测试覆盖未知支持状态的保存、视觉与推理能力的保留，以及用户明确启用或禁用。
- Regression — 渲染进程导入和共享能力测试覆盖已获取模型到创建 DTO 的边界，并确保未知状态不显示为已验证能力。
- Regression — 提供商注册表测试覆盖目录约束、端点契约和向前兼容性。没有执行付费的原生推理，也没有运行打包应用的 UI 验收。
