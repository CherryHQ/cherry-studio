# Agent Note: 工具调用说明自己的目的

Status: implemented

[English](2026-11-12-tool-call-intent.md) | 中文

## 问题

Pi 或 Pi Durable Agent 工作时，用户看到的是一串工具行，标题由渲染端根据参数猜出来。
`ToolHeader.getCommandActivity` 用正则表达式匹配 Bash 命令，于是 `cd ~/repo && grep -rn …` 显示为「切换文件夹」，
`ls` 显示为「查看文件列表」。这些行说的是运行了什么，而不是为什么运行。大多数模型会在每次调用前自己写一句简短的话
（「现在检查 CI 状态」）来补上这一点，但 DeepSeek 模型会一个接一个地调用工具而不写这句话，并把推理放在单独的思考块里。
使用它们时，用户无法知道 Agent 想达成什么，在长时间运行中失去信任。

## 决策

当 Pi 或 Pi Durable Agent 运行 DeepSeek 模型时，每次工具调用都带一个可选参数 `intent`：一句简短的话，用用户的语言
说明这次调用的目的。渲染端按其他模型的叙述文字那样显示它：工具行上方的一行文字。

1. **共享规则。** `@cherrystudio/agent-behavior` 导出参数名、系统提示词说明、`offersToolIntent(modelId)`（对 DeepSeek
   模型 ID 返回 true）以及 `createToolIntent()`：一个创建工具转换的工厂函数，转换接收工具和是否提供 `intent`。提供时，
   转换在尚未声明 `intent` 的对象 schema 中加入 `intent: { type: "string" }`，但不把它加入 `required`。无论是否提供，
   转换都会包装 `prepareArguments`，在工具自身的参数修复、schema 校验、审批闸门、钩子和执行之前移除该参数，因此切换模型后
   仍带着 `intent` 的调用也能正常运行。Pi 对副本做校验，所以模型原始的调用（含 `intent`）会保留在原生对话记录和产品消息中。
2. **Pi。** `pi-coding-agent` 补丁提供 `AgentSession.setToolTransform`，在 `_applyToolLoadout` 中应用；这里是内置、
   自定义、扩展、MCP 以及已激活的延迟工具成为声明集合与可执行集合的唯一入口。`createAgentRuntimeSession` 为根会话和
   子会话安装共享转换，只在 DeepSeek 模型下提供 `intent` 并把说明追加到系统提示词。
3. **Pi Durable。** `pi-durable` 补丁允许扩展声明 `wrapTools(tool, model)`，在 `resolveAgent` 中带着 Agent 的模型应用到
   每个组合后的工具。Cherry 的 `cherry.behavior` 扩展携带该转换和一个 `tool_intent` 提示词段落，该段落只在 DeepSeek
   Agent 下输出说明。
4. **渲染端。** `ToolBlockGroupContent` 把非空的 `intent` 显示为调用行上方的一行正文，`getToolGroupSemanticTitle` 在组
   运行中把它用作组标题。工具行保持猜出的标题。没有 intent 的调用和之前显示得一样。
5. **Agent 会话显示每一步。** Agent 消息列表设置 `expandToolSteps`，在回合进行中和结束后都默认展开嵌套的工具组和已完成
   的处理组。用户手动收起的组保持收起。普通聊天保持默认收起。
6. **折叠重复，去掉思考噪音。** 在同一串调用中，相邻、带 intent 且猜出的标题相同的调用折叠到这个标题下，默认收起。
   调用带 intent 的工具组不显示它们之间的思考块；模型推理时，组标题仍会显示正在思考。

这是一个软约定：忽略说明的模型、不是对象的 schema，以及在本次改动之前创建的会话中的调用，都和之前显示得一样。

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

## 后果

Pi 和 Pi Durable 中的 DeepSeek Agent 会用用户的语言说明每一步。在使用 DeepSeek V4.1 Flash 的实际会话中，每次调用都带有
intent（两次 PR 审阅分别为 18/18 和 36/36）。其他模型的 schema 和提示词没有任何变化。已有的 DeepSeek 会话会看到一次工具
声明变化，使其提示词缓存失效一次。每个请求都携带说明以及每个工具一个简短属性，历史记录携带每次调用的那句话。升级
`pi-coding-agent` 或 `pi-durable` 时需要把两处补丁一并迁移。

## 验证

- AC1 — `pnpm exec vitest run packages/agent-behavior/tests/orchestration/toolIntent.test.ts`：11 项测试通过，覆盖提供时的 schema、不改动的非对象 schema 与自带 `intent` 的 schema、无论是否提供都在工具自身修复前移除 intent，以及 `offersToolIntent` 对 DeepSeek 与其他模型 ID 的判断。
- AC2 — `pnpm exec vitest run packages/agent-runtime-pi/tests/session.test.ts`：DeepSeek 会话在每个工具和系统提示词中声明 `intent`，闸门与执行看到的参数不含它，对话记录保留它；其他模型的会话两者都不声明，带着它的调用仍能运行。
- AC3 — `pnpm exec vitest run packages/agent-runtime-pi-durable/tests/toolIntent.test.ts`：DeepSeek Agent 声明 `intent`，闸门、校验和执行都不含它，对话记录保留它；其他 Agent 两者都不声明，这样的调用仍无错误地运行。
- AC4 — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ToolBlockGroup.test.tsx`：intent 显示为紧挨其调用行上方的一行文字并作为组标题，没有 intent 的调用没有这行文字。
- AC5 — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx src/renderer/components/chat/messages/blocks/__tests__/ToolBlockGroup.test.tsx`：开启 `expandToolSteps` 时，运行中的回合列出每一步，结束的回合保持展开直到用户收起；默认展开的组被用户收起后保持收起。
- AC6 — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ToolBlockGroup.test.tsx src/renderer/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx`：相邻、带 intent 的同类调用折叠并收起在共同标题下，其他调用照常列出；调用带 intent 的组不显示思考块，不带 intent 的组保留思考块。
