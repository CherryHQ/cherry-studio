# Agent Note: 将智能体压缩交还原生运行时

Status: proposed

[English](2026-11-12-native-agent-compaction.md) | 中文

## Problem

Pi 和 Pi Durable 负责压缩边界，但共享行为要求 Cherry 宿主生成每一份摘要。宿主将原生消息整体序列化为 JSON，可能发出超出窗口的摘要请求。Pi 的原生摘要器会限制工具结果摘录并省略思考内容。两个运行时都已提供原生摘要器，并通过 Cherry 网关路由模型调用。

本提案获批准后将部分取代[与 harness 无关的行为包说明](../architecture/2026-10-18-agent-behavior-package.md)中关于摘要生成和必须接受摘要的决定。产品仍需要请求限制、goal 和子运行归属、持久用量记录以及压缩生命周期事实。

## Proposal

让每个运行时使用自己的原生压缩和摘要生成。共享行为负责产品层的压缩准入决定并观察结果，但不构造摘要提示词或选择压缩范围。适配器在原生工作开始前捕获 goal 和子运行归属，并将实际模型请求及报告的用量关联到该归属。通过现有请求限制统计每次实际请求，包括重试和分段摘要。原生用量与网关计费是不同事实；不得重复创建计费记录，也不得编造缺失的用量。

Pi 和 Durable 暴露的原生事实不同。分别使用各自的事件、存储和模型接口实现同一共享行为契约。如果固定版本的 SDK 无法提供必要的请求或原子记账事实，应先改进上游接入或依赖，再宣称契约成立；不得伪造归属、重放副作用或静默绕过预算。

保留会话身份、原生历史、取消、手动和自动压缩、用户可见结果及失败、goal 归属、子运行用量归属，以及重新打开和分叉恢复。所有调用方迁移后删除被替换的宿主摘要器和过时的接受路径。Claude Code 的原生压缩保持独立。

Token 估算变更、工具批次整体预算和新的压缩插件不属于本次变更。外部扩展另行研究，报告兼容性与证据，不在生产环境启用。

## Alternatives considered

- 保留共享 JSON 摘要器并模仿上游序列化：这仍会保留重复的压缩逻辑，并可能再次偏离上游。
- 直接关闭共享钩子而不提供替代：这可能绕过请求限制，并丢失持久的 goal 或子运行用量归属。
- 用独立代理持有的对话记录替换原生历史：这会引入第二个会话与恢复状态事实源。

## Acceptance criteria

- AC1 — Pi 和 Pi Durable 的自动及手动压缩使用各自的原生摘要生成；Cherry 不构造替代摘要提示词，也不重放序列化的原生消息来生成摘要。 (verification: native runtime contract — implementation owner)
- AC2 — 每次原生摘要模型请求，包括分段摘要和重试，均受正确的根会话或子会话请求限制约束，并关联到压缩开始时捕获的归属。 (verification: native runtime contract — implementation owner)
- AC3 — 报告的摘要用量在完成、中断、重启和分叉后恰好一次计入正确的 goal 和子运行；缺失的原生用量保持未知，网关计费不重复。 (verification: native runtime and real SQLite — implementation owner)
- AC4 — 自动和手动压缩在重新打开后保留取消、失败和无变化结果、压缩后的模型上下文、留存的产品历史与原生会话身份。 (verification: native runtime and Main consumers — implementation owner)
- AC5 — DeepSeek 官方对照在当前 Pi 和原生 Pi 路径上执行相同的长上下文工具突增场景，分别记录请求与信息保留，并报告仍存在的溢出，不宣称 24 小时保证。 (verification: real provider — implementation owner)
- AC6 — Cherry 的行为契约和参考文档描述原生摘要归属、当前记账义务及过时宿主摘要器的移除。 (verification: docs gate — implementation owner)

## Risks

原生压缩可能发出多个模型请求，也可能在适配器需要时无法提供逐请求用量。Durable 后台压缩可能在发起它的运行结束后才完成；恢复必须保留其原始归属。原生摘要截断可能丢失细节，因此上下文回溯和产品历史必须保持独立可用。原生阈值估算仍可能漏掉突增，本提案不宣称能阻止所有上下文溢出。
