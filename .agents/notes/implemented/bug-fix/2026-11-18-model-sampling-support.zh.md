# Agent Note：在请求覆盖值合并后执行模型参数限制

Status: implemented

[English](2026-11-18-model-sampling-support.md) | 中文

## 问题

目录缺少限制时，兼容适配器会发送模型不支持的参数。Kimi K3 的限制仅存在于部分提供商配置中，MiniMax M3 模型将官方 API 实际忽略的采样参数声明为可配置，Gemini 的惩罚参数覆盖值可能导致 HTTP 400。GLM 官方 API 要求 top-p 至少为 0.01，但运行时支持类型没有表示目录中的嵌套范围。

## 决策

Kimi K3 和 MiniMax M3/M3.1 Flash 的模型级限制由创建者声明维护。GLM 5 系列官方参数范围属于 ZhiPu 和 Z.AI 提供商配置，因为其他托管服务可能使用不同范围。GPT 5.6 Luna 根据已报告的拒绝情况省略 top-p。已下架模型不新增声明。

运行时支持信息保留目录和持久化数据中的 `range`，同时接受旧的平铺范围字段。未声明的范围保持未指定。最终请求过滤器将有限的 temperature/top-p 数值限制到已声明范围，并从标准参数、提供商命名空间和请求体透传中移除不支持的频率与存在惩罚参数，同时覆盖 camelCase 和 snake_case。即使模型没有目录元数据，Gemini 3/4 也省略惩罚参数。其他请求字段与嵌套应用数据保留原值。

## 考虑过的替代方案

- 依赖各 SDK：兼容适配器不共享原生 SDK 的过滤，请求体覆盖值也可能绕过过滤。
- 对所有推理模型禁用采样：部分在役模型支持采样，有些仅在指定思考模式下支持。
- 将 GLM 范围放到基础模型：托管部署可能与官方 API 不同。
- 拒绝超出范围的设置：在现有最终清理边界执行限幅，使持久化设置仍能使用。

## 影响

模型兼容性由目录源声明，并在覆盖值合并后执行。不需要数据库迁移或重写设置。接受但忽略的参数不会被描述为提供商错误。官方参考：[Kimi K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart)、[MiniMax](https://platform.minimax.io/docs/api-reference/text-chat-anthropic)、[Gemini](https://firebase.google.com/docs/ai-logic/model-parameters?platform=flutter)、[GLM](https://docs.z.ai/api-reference/llm/chat-completion)。

## 验证

- 回归 — 现有的定向目录、模型服务、请求构建、共享模型和参数过滤测试通过；不新增行为测试。未执行真实提供商请求。
