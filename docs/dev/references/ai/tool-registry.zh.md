---
description: 统一的 aiSdk ToolEntry 注册表，涵盖内置 web/kb 工具、MCP 同步、元工具和延迟暴露
sources:
  - src/main/ai/tools/adapters/aiSdk
  - src/main/ai/tools/adapters/claudeCode/agentTools.ts
---

# 工具注册表

[English](tool-registry.md) | 中文

## 模型

```ts
interface ToolEntry {
  name: string         // wire-name, what the LLM emits in tool_calls
  namespace: string    // ownership key (web, kb, mcp:<serverId>, meta) — never shown to the model
  namespaceLabel?: string // what `tool_search` groups by and shows; defaults to `namespace`
  description: string  // one-line summary for `tool_search`
  defer: 'never' | 'always' | 'auto'
  tool: Tool           // AI SDK Tool (schema + execute + needsApproval + toModelOutput)
  applies?(scope): boolean
}
```

`registry`（`src/main/ai/tools/adapters/aiSdk/registry.ts`）是进程级单例。
`AiService.onInit()` 调用唯一的 `registerBuiltinTools()` 入口；请求准备阶段再通过
`buildAgentParams` 读取注册表。Agent 会话运行时构建自己的原生工具接口。例如，
`tools/adapters/claudeCode/agentTools.ts` 合并 Claude 描述符和 MCP 工具，
不使用这个 AI SDK `ToolRegistry`。

测试使用独立的 `new ToolRegistry()`，避免污染单例。

## 线上名称约定

双下划线用作分段分隔符，因此段内的单个 `_` 不会产生歧义：

| 来源 | 名称模式 | 示例 |
|---|---|---|
| 内置 | 固定线上名称（`<namespace>_<verb>`） | `web_search`、`kb_search` |
| MCP（AI SDK） | `mcp__<server-slug>__<tool-slug>_<identity-digest>` | `mcp__gmail__sendMessage_a1b2c3d4e5f60718293a` |
| 元工具 | `tool_<verb>` | `tool_search`、`tool_invoke`、`tool_inspect`（`tool_exec` 已定义但未注入，见下文） |

内置线上名称位于 `@shared/ai/builtinTools`，使用单下划线，例如 `web_search`，
不采用 MCP 的 `__` 分段约定。AI SDK MCP 摘要由稳定服务器 ID 和原始协议工具名生成。
可读名称通过 `tiny-pinyin` 将汉字转为拼音，使 CJK 名称仍有可辨识的分段；
假名和韩文不会被转写，会退回到 `server` / `tool` 加摘要。
Claude Code 保留自己独立的运行时命名约定。

## 内置工具

`src/main/ai/tools/adapters/aiSdk/builtin/` 当前注册 **11 个**条目：

| 命名空间 | 工具 | 当前启用条件 |
|---|---|---|
| `web` | `web_search`、`web_fetch` | 已选择客户端 web 路由 |
| `kb` | `kb_list`、`kb_search`、`kb_read`、`kb_manage` | 至少有一个请求范围内的知识库 |
| `file` | `read_file` | 存在第一方对话附件 |
| `fs` | `fs_read` | 可以读回已持久化或卸载的工具输出 |
| `mcp_resource` | `mcp_resource_list`、`mcp_resource_read` | 至少有一个请求范围内的 MCP 资源服务器 |
| `image` | `generate_image` | 助手已启用且已配置绘图模型 |

注册由 `builtin/registerBuiltinTools.ts` 中的 `registerBuiltinTools` 完成。
每个工具的 `applies` 谓词根据当前请求范围决定是否启用，而不限于助手设置。

## MCP 工具

`src/main/ai/tools/adapters/aiSdk/mcp/`：

- `resolveAssistantMcpToolIds`：助手启用的 MCP 服务器和逐工具禁用列表生成工具 ID 集合。
- `mcpTools.syncMcpToolsToRegistry({ selectedToolIds })`：通过
  `McpCatalogService.listTools` 扫描活跃服务器的纯缓存目录，匹配完整工具 ID，
  仅将精确选中的工具注册为 `ToolEntry`，其 `tool.execute` 通过 MCP 传输执行。
  一旦所有选中 ID 都已匹配就提前停止扫描。所有权使用稳定的
  `namespace: mcp:<serverId>`，从不取决于显示名称；`tool_search` 使用
  `namespaceLabel: mcp:<serverName>` 分组并显示给模型。
  因为读取的是最近一次有效缓存快照，临时目录故障不会移除仍活跃服务器的旧条目。

同步是幂等的，旧条目会在下一次同步中被覆盖。

助手和 Agent 工具目录在面向模型的发现过程中应用 MCP Apps 可见性。
MCP 运行时在执行前也会在来源连接上检查同一可见性，包括通过延迟工具发起的调用。
来源目录保留仅供 App 使用的条目，以供设置界面和 App 访问。

成功的助手 MCP 工具结果可以携带主机签发的 App 引用。
已保存的结果进入视图时，桌面主机会重新检查话题的 MCP 选择和服务器工具声明。
已声明的外部来源得到确认后，App 才会内联渲染。
超大结果会在渲染器投影中保留 App 标记；主机在启动 App 前恢复已卸载的结果。
如果话题或助手失去来源访问权，主机会释放待启动和已挂载的 App。

### 读取工具目录不会阻塞 MCP

`McpCatalogService` 将工具目录分为**读取**接口和**写入/刷新**路径：

- **`listTools(serverId)`** 只读取共享的 `mcp.tools.<serverId>` 缓存，
  **绝不连接**上游 MCP 服务器。构建 Agent/聊天工具接口的所有热路径都使用它：
  Claude Code SDK 桥接器 `createMcpBridgeServer`、`buildMcpToolMetadata`、
  Agent 工具策略 `agentTools.listMcpDescriptors` 和上述两个 AI SDK 适配器。
  因此失效或缓慢的服务器不会阻塞 Agent/聊天启动（问题 #16242）。
- **`refreshTools(serverId)`**（以及私有的 `listToolsForServer`）是连接、列举并写入缓存的实时路径。
  它完全由后台预热程序驱动：`onReady` 时的 `prewarmActiveServerTools`、
  `onToolListChanged` 刷新、渲染器通过 `useAgentTools` 发起的按需 `refreshTools`、
  服务器启用开关和 `restartServer`。

`listTools` 首次发现从未预热的服务器时，也会触发一次非阻塞的 `refreshTools`。
缓存 `undefined` 与已预热但为空的 `[]` 不同，因此无界面或定时启动可以自行预热，
而不会反复探测失效服务器。

取舍是工具可用性具有**最终一致性**。会话启动时缓存仍冷的服务器不会为该会话提供工具，
而是在下一个会话出现。Claude Agent SDK 在每个会话开始时快照工具列表，因此无法在会话中途实时更新。

## 元工具

`src/main/ai/tools/adapters/aiSdk/meta/` 定义四个工具，
让模型以先搜索、后调用的方式使用注册表。仅前三个会被注入：

| 工具 | 是否注入 | 用途 |
|---|---|---|
| `tool_search` | 是 | 按命名空间和查询浏览延迟工具池，返回简短描述 |
| `tool_inspect` | 是 | 输出某个工具的 JSDoc 桩，提供正确调用所需的信息 |
| `tool_invoke` | 是 | 按名称和 JSON 参数调用注册表中的工具 |
| `tool_exec` | **否** | 沙箱 JS 执行，将完整注册表作为全局 API（`meta/exec/runtime.ts`、`meta/exec/worker.ts`），已定义但有意不注入 |

只有请求确实延迟了工具时，`applyDeferExposition` 才会把前三个工具加入工具集，见下文。

## 延迟暴露

`src/main/ai/tools/adapters/aiSdk/exposition/`：

- `shouldDefer(entries, contextWindow)` 返回要延迟的名称集合。
  除简单阈值外，还有两个条件：
  - **MIN_AUTO_DEFER_COUNT**：自动延迟池必须足够大，先搜索再调用才比直接内联合算。
  - **META_TOOLS_OVERHEAD_TOKENS**：估算节省量必须超过元工具本身的静态提示词开销。
      否则，小工具集和小上下文模型可能触发延迟，却反而增加 token 消耗。

- `applyDeferExposition(tools, registry, contextWindow)` 从 `tools` 移除延迟名称，
  注入 `tool_search` / `tool_inspect` / `tool_invoke`，并返回系统提示词
  `<DEFERRED_TOOLS>` 部分需要列举的条目，让模型知道有哪些命名空间。

**需要审批的工具绝不延迟。** 强制提示的 MCP 工具以 `defer: 'never'` 注册。
`mcp/mcpTools.ts` 读取一次 `isMcpToolForcePromptBySource`，同时决定 `defer`
和 `needsApproval`，使工具保留在内联集合中并触发 SDK 原生审批。
如果延迟，它就不在 SDK 工具集中，审批门禁不会触发，只能通过没有审批卡的
`tool_invoke` 访问。运行时还有后备检查：`tool_invoke` / `tool_exec`
在执行时调用 `isApprovalGated`，拒绝需审批工具，包括 `registry.getByName(any-name)`
路径，并引导模型改为直接内联调用。参见[工具审批](./tool-approval.md)。

`applyDeferExposition` **不会注入** `tool_exec`，也不存在 `metaTools.exec` 标志。
注入位置 `applyDeferExposition.ts:50-53` 有意将其排除，因为其
`worker_threads` + `new Function` 沙箱以完整 Node 权限运行模型生成的代码，
相较于渲染器原有权限限制会产生提权风险。
只有出现明确需要后，才计划通过显式 Preference 键重新启用。

这一说明仅适用于 AI SDK 注册表。Pi Agent 运行时在自己的会话工具中使用
Pi 1.0 原生的 `codemode`、`tool_search` 和 MCP 扩展，
参见 [Pi 代码模式](./agent-session-runtime.md#pi-code-mode)。

## `applies` 与工具调用修复

- `applies(scope: ToolApplyScope)` 是 `registry.selectActive` 使用的逐条目谓词。
  异常会被捕获、记录警告，并视为不活跃。
- `createAiRepair(...)`（`tools/adapters/aiSdk/repair.ts`）通过
  `experimental_repairToolCall` 传给 AI SDK。模型输出**格式错误的参数**
  （`InvalidToolInputError`）时，修复函数有一次额外 LLM 调用的修复机会。
  MCP 协议名称别名只在完整请求目录中解析，包括延迟工具。
  唯一的直接匹配还必须属于内联集合。未知、歧义和直接调用延迟工具的情况
  各自返回带恢复提示的诊断，不会猜测选择服务器。
- `createMcpAliasMiddleware(...)` 在 SDK 创建 UI 部件、审批记录或保存历史之前，
  规范化流式开始事件和最终调用的名称。它也将已解析的线上名称写入
  `tool_invoke` 输入，使请求缓存失效后的后续轮次仍使用同一 MCP 格式化器和
  App 启动身份。启动时仍会执行来源授权和 App 声明检查。
- 此别名路径属于 AI SDK 聊天运行时。原生 Agent 运行时使用各自的工具接口，
  不在本修复范围内。

## 延伸阅读

- 代码：`src/main/ai/tools/adapters/aiSdk/`（Claude Code 适配器：
  `src/main/ai/tools/adapters/claudeCode/`）
- 测试：`tools/adapters/aiSdk/__tests__/`、
  `tools/adapters/aiSdk/builtin/__tests__/`、
  `tools/adapters/aiSdk/exposition/__tests__/`、
  `tools/adapters/aiSdk/mcp/__tests__/`、
  `tools/adapters/aiSdk/meta/__tests__/`
- 延迟原因和门槛：`tools/adapters/aiSdk/exposition/shouldDefer.ts` 的头部注释及测试
- 审批流程：[工具审批](./tool-approval.md)
