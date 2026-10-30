# Agent Note: 内置 ask_expert 工具与 Agent 级专家模型

Status: proposed

[English](2026-10-30-ask-expert.md) | 中文

## 问题

一个 Agent 全程只用一个模型。多数回合里，便宜、快的执行模型是正确默认；但少数决策——确定方案、跳出重复失败、宣布任务完成——值得让更强的模型复核一次。为了这份判断力而全程运行强模型，是用昂贵的方式买它；而对没有第二模型档位的供应商来说，用户根本买不到。

Cherry Studio 此前依赖 Anthropic 的服务端 advisor 工具实现这件事。该工具只服务 Anthropic 一方模型，且其 beta 标识已过期：携带它的请求现在会被 HTTP 400 拒绝（issue #16135）。其他供应商的用户没有等价能力，Agent 也没有一处可以指定“更强的那个模型”。

## 提案

在进程内 `cherry-tools` MCP 服务中新增内置工具 `ask_expert`，并在 Agent 上新增 `expertModel` 设置。

- `expertModel` 是 Agent 行上一个可空的 `UniqueModelId` 列，在 Agent 编辑弹窗中与主模型并列。留空即禁用专家咨询；不设全局回退，因此除非 Agent 明确指定，绝不会花掉一个模型。
- 工具接收一个自包含问题：`objective`、`context`、`output_format`、`trigger`、`question_type`、`attempts`、`boundaries`。专家没有工具、没有记忆，也无法追问，因此参数契约强制调用方一次性给全回答所需的一切。
- 调用通过 `AiService.generateText` 对 `expertModel` 发起单轮、无工具请求。结果以 `VERDICT / ADVICE / RISKS` 的候选答案形式返回，并附带明确的“采纳前必须验证”尾注；工具从不把专家输出当作事实。
- 每个会话最多 8 次调用，上下文字符上限 120,000，以约束开销与请求体大小。未配置的 Agent 会收到可操作的配置错误，而不是静默空转。
- 工具以“咨询专家”出现在 Agent 工具目录中，并自动批准：它是只读的，唯一副作用是所配置模型的 token 消耗。

工具随 `cherry-tools` 分发，而三种 Agent 运行时（Claude Agent、Pi、DeepSeek Harness）都会挂载它，因此一份实现服务全部运行时。AI-SDK 聊天路径不是 Agent 运行时，本次刻意不改。

## 考虑过的替代方案

- **继续使用 Anthropic 服务端 advisor 工具。** 它只适用于 Anthropic 一方模型，客户端无法选择其他供应商的模型，而且 beta 头已经下线（#16135）。
- **复用 `planModel` 或 `smallModel`。** 这两个字段固定的是 Claude Code 路由里的 `sonnet` / `haiku` 别名。付费的、供应商无关的咨询是另一个概念，而且只有一种运行时暴露这两个字段。
- **在设置里放一个全局专家模型。** 点击更少，但每个 Agent 都会静默共享并消耗那个模型。Agent 级字段与现有模型档位一致，并让开销保持显式选择。
- **完整移植 Python 版 `ask-expert` 服务（去重、缓存、标定日志、`audit_artifact`）。** 更忠实，但其中的状态、留存与审计契约是另一套设计。本提案只保留咨询契约；其余部分可在用量证明有必要后作为后续工作落地。
- **把专家做成会用工具的子代理。** 那会让工具循环与延迟翻倍。这里的价值来自只看到提炼后问题的模型给出的第二意见，而不是又一个执行者。
- **每次调用都要求批准。** 工具没有副作用；把每次咨询都变成审批弹窗，只会训练用户闭眼点过。开销由会话预算与 Agent 级显式选择共同约束。

## 验收标准

- AC1 — Agent 弹窗提供专家模型选择器；设置、修改、清空都能经由 Agent API 与 `agent.expert_model` 列往返（verification: unit | renderer）。
- AC2 — `ask_expert` 已注册进 `cherry-tools`，且在 Agent 工具目录中作为面向用户的编排工具恰好出现一次（verification: unit）。
- AC3 — 配置了 `expertModel` 时，调用恰好到达该模型，单轮、无工具，并返回答案与模型、调用计数尾注（verification: unit）。
- AC4 — 未配置 `expertModel` 时，工具返回可操作的配置错误，且绝不调用供应商（verification: unit）。
- AC5 — 同一会话的第 9 次调用以 `max_uses_exceeded` 拒绝；超过 120,000 字符的上下文在调用供应商之前被拒绝（verification: unit）。
- AC6 — 迁移追加一个可空的 `expert_model` 列，带 `user_model` 外键，并通过迁移链检查（verification: unit）。

## 风险

- **开销。** 已配置的 Agent 现在会消耗专家模型的 token。会话预算、上下文上限与“无全局默认”共同限制了暴露面，但高频 Agent 每个会话仍可调用专家 8 次。
- **没有自动对话记录。** 与 Anthropic 的服务端 advisor 不同，客户端工具看不到对话。因此工具描述必须教会调用方把问题写成自包含的；偷懒的调用方只会得到浅答案。
- **预算作用域。** 计数器位于每个会话的 `cherry-tools` 服务实例上，重连会话会重置。跨重连的持久台账需要单独存储决策，不在本次范围内。
- **模型质量下限。** 没有任何机制阻止 Agent 把一个更弱的模型配成专家。契约称其为“更强的复核者”，但跨供应商并不强制能力排序。
- **自动批准。** 跳过审批提示是一个刻意取舍：无副作用、开销有界、显式选择。如果维护者希望为成本透明保留提示，策略条目改一行即可。
