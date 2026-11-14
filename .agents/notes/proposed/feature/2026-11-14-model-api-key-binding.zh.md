# Agent Note: 按模型绑定 API key

Status: proposed

[English](2026-11-14-model-api-key-binding.md) | 中文

## Problem

Issue CherryHQ/cherry-studio#21074 要求在多 key 提供方中为模型指定 API key。PR #21114 已实现持久化的 `user_model.api_key_id`，并在聊天、智能体网关请求及受支持的集成中传递绑定。本说明记录已实现的契约，供人工审阅；并不声称 Spec 已获批准，也不授权合并。

## Proposal

- 模型未绑定时保留提供方的自动 key 选择。绑定只能引用属于该提供方的 key；空 ID 或其他提供方的 key ID 会被拒绝。
- 提供方有多个 key 时显示模型 key 选择器。有名称的 key 保留其标签；未命名的 key 使用本地化的未命名标签加上从一开始的位置序号。渲染选择器不需要请求包含密钥的记录。
- 遵守已启用的绑定，在 HTTP 401/429 时不切换到其他 key。本次审阅跟进不改变禁用或已删除 key 的现有处理方式。
- 在聊天配置、智能体网关请求、Ollama 探测、重试、OpenClaw、Antigravity、DeepSeek Harness 及 CLI 配置草稿中保留绑定。角色模型的绑定不同时，拒绝直接写入 Claude CLI 配置，包括上下文模型已绑定而角色模型未绑定的情况。OpenClaw schema 无法表达按模型 API key 时，拒绝同步。
- 迁移 `0038_great_rafael_vega` 添加可空列，不改变已有模型行的其他字段。已添加该列的早期未发布实验版本不属于受支持的升级路径。

## Alternatives considered

- 仅在提供方层面选择 key 无法满足按模型路由。
- 原始 key UUID 难以辨认；仅为标签而获取包含密钥的记录会增加不必要的暴露。本地化序号标签可避免该请求。
- 静默切换到其他 key 会破坏所要求的绑定。无法保留绑定的集成格式应报错，而非静默丢弃绑定。

## Acceptance criteria

- AC1 — 多 key 提供方显示模型选择器，持久化所选绑定，并为未绑定模型保留自动选择（verification: renderer; service unit）
- AC2 — 未命名或仅含空白的标签使用不同的本地化序号标签，而非原始 key ID，且不获取包含密钥的记录（verification: renderer）
- AC3 — 拒绝空 ID 或其他提供方的 key ID，并保留有效绑定（verification: service unit）
- AC4 — 受支持的运行时路径遵守绑定 key 路由，且在 401/429 时不切换 key；无法表达绑定的 Claude/OpenClaw 配置明确报错（verification: runtime unit; integration）
- AC5 — 从 0038 之前的 schema 运行生产迁移，保留已有模型并添加 `api_key_id: null`（verification: migration unit）

## Risks

- 所选凭据可能失效或被删除；绑定语义不得因此静默使用其他已启用的 key。
- 序号标签无需暴露密钥即可区分未命名 key，但它基于列表位置，重新排序后可能变化。
- 当前 head 的真实提供方认证，以及从本 PR 早期未发布实验迁移的升级，仍未验证。渲染进程重载后的持久化不等于线上认证测试。
