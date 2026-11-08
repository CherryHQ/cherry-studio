# Agent Note: Fortytwo 内置服务商

Status: proposed

[English](2026-11-05-fortytwo-built-in-provider.md) | 中文

## Problem

Fortytwo 用户目前需要自定义 OpenAI 兼容连接。内置服务商应在普通聊天和 Pi Agent 请求中提供正确的模型能力、价格和来源标识。

## Proposal

添加仅限全球版的 Fortytwo 预设，通过 https://api.fortytwo.network/v1 使用 OpenAI 兼容 Chat Completions。将 qwen/qwen3.8-27b 映射到已有标准模型，配置服务商独有的限制和价格。支持文本和图片输入、工具、严格结构化输出，以及 `none`、`minimal`、`low`、`medium`、`high`、`xhigh` 和 `max` 七种 reasoning_effort 值。保留显式 `none` 和 `medium`；未设置时省略该参数，使 API 默认值仍为 `medium`。保留自定义服务商的隐私规则及显式请求头的优先级。

为目录生成器添加仅从源码生成指定服务商的模式，避免获取或重写无关模型与服务商记录。在 Pi 模型注入中复用已有的不含凭据的应用请求头辅助函数；保留密钥路由、网关与会话规则及字面请求头转义。添加官方浅色和深色图标及已有语言标签。不增加新运行时、存储结构、通用认证改造或后端日志变更，也不声明中国版可用。

模型目前声明上下文 262144、最大输出 235929 个 token；每百万 token 价格为输入 USD0.425、缓存输入 USD0.085、输出 USD2.55。当前价格文档说明缓存写入免费，因此本提案显式设置服务商缓存写入费率为零，而不继承标准模型费率。这修改了旧原型的未知/null 缓存写入处理，需要随本 Spec 一并批准；没有静默修改现有实现。来源：[模型契约](https://docs.fortytwo.network/docs/models)和[价格](https://docs.fortytwo.network/docs/pricing)。实施和发布前应重新核实这些外部事实。

## Alternatives considered

自定义连接已可使用，但没有易于发现的内置预设。完整目录刷新可能引入无关远程数据漂移。仅针对 Fortytwo 硬编码 Pi 请求头会重复已有内置和自定义服务商策略。修改共享标准模型会错误地将本服务商的价格或能力归属给其他服务商。

## Acceptance criteria

- AC1 — 全球版列出 Fortytwo、生产端点及唯一在售模型；其他版本和服务商保持原有行为 (verification: unit)
- AC2 — 解析后的元数据保留服务商限制、已知精确价格（包括文档声明的零缓存写入费率）及支持的输入输出和推理能力，不修改标准模型 (verification: unit)
- AC3 — 指定服务商生成模式具有确定性，拒绝不兼容或未知选项，不获取远程补充数据并保留标准模型及其他服务商数据 (verification: unit)
- AC4 — 普通和 Pi 请求为内置服务商携带 Cherry 来源请求头，尊重用户覆盖，并保留自定义服务商隐私、凭据、网关会话和转义约定 (verification: unit)
- AC5 — 官方浅色深色图标、语言标签及生成的消费端保持一致 (verification: renderer)
- AC6 — 真实隔离桌面会话展示流式聊天和推理、图片回答及 Pi 工具调用和结果，并提供发出请求的来源标识证据 (verification: Electron)
- AC7 — 在实施基线上通过必需的受影响检查，证据不含凭据，临时测试资源已清理，且不推断后端日志或发布版本验证成功 (verification: packaged artifact)

## Risks

目录和 Pi 运行时变化很快；旧原型及其检查不能证明变基后的实现。已有研究验证了桌面行为，但实施验收必须明确准确源码版本。复用 Pi 请求头会影响所有内置 Pi 服务商，因此需要自定义、网关和会话回归检查。仅源码生成模式属于共享工具，需要独立评审。实施 PR 前必须先获得上游对本 Spec 精确提交的批准；本提案不声明已获批准，也不豁免提交签名要求。
