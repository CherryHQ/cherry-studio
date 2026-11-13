# Agent Note: 工具调用说明自己的目的

Status: proposed

[English](2026-11-12-tool-call-intent.md) | 中文

## 问题

Pi 或 Pi Durable Agent 工作时，用户看到的是一串工具行，标题由渲染端根据参数猜出来。
`ToolHeader.getCommandActivity` 用正则表达式匹配 Bash 命令，于是 `cd ~/repo && grep -rn …` 显示为「切换文件夹」，
`ls` 显示为「查看文件列表」。这些行说的是运行了什么，而不是为什么运行。大多数模型会在每次调用前自己写一句简短的话
（「现在检查 CI 状态」）来补上这一点，但 DeepSeek 模型会一个接一个地调用工具而不写这句话，并把推理放在单独的思考块里。
使用它们时，用户无法知道 Agent 想达成什么，在长时间运行中失去信任。

## 提案

当 Pi 或 Pi Durable Agent 运行 DeepSeek 模型时，每次工具调用都带一个可选参数 `intent`：一句简短的话，用用户的语言
说明这次调用的目的。渲染端按其他模型的叙述文字那样显示它：工具行上方的一行文字。

1. **共享规则。** `@cherrystudio/agent-behavior` 导出参数名、系统提示词说明、`offersToolIntent(modelId)`（对 DeepSeek
   模型 ID 返回 true），以及一个创建工具转换的工厂函数，转换接收工具和是否提供 `intent`。提供时，转换在尚未声明
   `intent` 的对象 schema 中加入 `intent: { type: "string" }`，但不把它加入 `required`。无论是否提供，转换都会包装
   `prepareArguments`，在工具自身的参数修复、schema 校验、审批闸门、钩子和执行之前移除该参数，因此切换模型后仍带着
   `intent` 的调用也能正常运行。Pi 对参数的副本做校验，所以模型原始的调用（含 `intent`）会保留在原生对话记录和产品消息中。
2. **Pi。** 现有的 `pi-coding-agent` 补丁为 `AgentSession` 增加一个在 `_applyToolLoadout` 中应用的工具转换；这里是
   内置、自定义、扩展、MCP 以及已激活的延迟工具成为声明集合与可执行集合的唯一入口。`createAgentRuntimeSession`
   为根会话和子会话安装共享转换，只在 DeepSeek 模型下提供 `intent` 并把说明追加到系统提示词。
3. **Pi Durable。** 现有的 `pi-durable` 补丁允许扩展声明 `wrapTools(tool, model)`，在 `resolveAgent` 中带着 Agent 的
   模型应用到每个组合后的工具，因此提供给模型的工具、可调用工具、记录在对话中的工具声明以及实际执行的工具都会经过转换。
   Cherry 安装一个扩展，携带该转换和一个提示词段落，该段落只在 DeepSeek Agent 下输出说明。
4. **渲染端。** 工具组把非空的 `intent` 显示为调用行上方的一行正文，并在运行中作为组标题。工具行本身保持现在猜出的
   标题。没有 intent 的调用和现在显示得完全一样。
5. **Agent 会话显示每一步。** Agent 消息列表默认展开嵌套的工具组和已完成的处理组，在回合进行中和结束后都是如此，
   这样每一步不用点击就能看到。用户手动收起的组保持收起。普通聊天保持现在默认收起的行为。
6. **折叠重复，去掉思考噪音。** 在同一串调用中，相邻、带 intent 且做同一类事（猜出的标题相同，例如分几次读同一个 diff）
   的调用折叠到这个标题下，默认收起；展开后显示每条 intent 和工具行。调用带 intent 的工具组不显示它们之间的思考块；
   模型推理时，组标题仍会显示正在思考。

这是一个软约定：忽略说明的模型、不是对象的 schema，以及在本次改动之前创建的会话中的调用，都和现在显示得完全一样。

## 考虑过的替代方案

- **向所有模型提供 `intent`。** 已经会在调用之间写叙述的模型会把同一件事说两遍。否决；只向 DeepSeek 模型提供。
- **只包装 Cherry 注册的工具。** 需要为每个 Pi 内置工具提供替代版本，而且仍然覆盖不到 Pi 扩展自己注册的工具
  （工具搜索、codemode）。因覆盖不完整而否决。
- **在网关中把 `intent` 加到发给提供商的请求里。** 网关面对多种线上格式，而 Pi 按注册的 schema 校验工具参数，其内置
  工具会拒绝未知属性。否决。
- **在 `tool_call` / `beforeTool` 钩子中移除 `intent`。** 这些钩子在 schema 校验之后运行，对 `additionalProperties: false`
  的 schema 会校验失败。否决。
- **让 DeepSeek 在助手正文中叙述。** 这段文字和它所解释的调用之间没有稳定的对应关系，并行调用还会共用同一段话。否决。
- **在第三方补丁里写死 `intent`。** 规则会留在第三方 `dist` 代码中无法测试，并在两个引擎中重复。补丁只开放通用的
  转换，规则留在带测试的 Cherry 代码里。

## 验收标准

- AC1 — 共享转换只在提供时为对象 schema 加入可选的 `intent` 字符串，不改动非对象 schema、已有的 `intent` 属性和 `required`，并且无论是否提供，都在原有 `prepareArguments` 运行之前从参数中移除 `intent`；`offersToolIntent` 只对 DeepSeek 模型 ID 返回 true（verification: unit）
- AC2 — 在使用 DeepSeek 模型的 Pi 会话中，声明的工具包含 `intent`，提供了它的调用在执行时参数中不再包含它，而对话记录中的工具调用仍包含它；使用其他模型时，工具和系统提示词都不提到它（verification: unit）
- AC3 — 在使用 DeepSeek 模型的 Pi Durable Agent 中，提供给模型的工具和可调用工具包含 `intent`，提供了它的调用在执行和校验时不含它；使用其他模型时，工具和系统提示词都不提到它，且这样的调用仍能运行（verification: unit）
- AC4 — 参数包含 `intent` 的工具调用在其行上方显示为一行文字，并在运行中作为组标题，而该行保持猜出的标题；其他调用和现在显示得一样（verification: renderer）
- AC5 — 在 Agent 会话中，工具组和已完成的处理组在回合进行中和结束后都默认展开，用户收起的组保持收起（verification: renderer）
- AC6 — 相邻、带 intent 的同类调用折叠到共同的标题下并默认收起，其他调用照常列出；调用带 intent 的组不显示思考块，不带 intent 的组保留思考块（verification: renderer）

## 风险

- 已有的 DeepSeek 会话会看到一次工具声明变化，使其提示词缓存失效一次。
- 每个请求都携带说明，以及每个工具一个简短属性；历史记录携带每次调用的那句话。
- 升级 `pi-coding-agent` 或 `pi-durable` 时需要把两处补丁一并迁移。
