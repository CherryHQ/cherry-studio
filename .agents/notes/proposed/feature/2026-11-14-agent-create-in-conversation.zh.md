# Agent Note: 在对话中创建和编辑智能体

Status: proposed

[English](2026-11-14-agent-create-in-conversation.md) | 中文

## 问题

内置的 Cherry Assistant 有一个 `create_agent` 工具（`src/main/ai/mcp/servers/assistant.ts`）。只有带宿主工具的内置智能体才会挂载它，见 `src/main/ai/agents/builtin/builtinAgentCapabilities.ts`。这个工具有四处不足：

- 它只能设置名称、描述、指令和模型。
- 它创建的是 `claude-code` 智能体，而不是现在所有创建路径都使用的 Pi Durable 运行时。
- 在对话中完全无法修改智能体的配置。唯一的例外是智能体自己的 `mcp__cherry-tools__config` 操作：状态、改名、频道和 `complete_bootstrap`。
- 创建后，对话里只显示一行结果（`CreateAgentToolInline`）：一个通用的机器人图标、名称和一个跳转到对话的按钮。它不显示智能体的头像和描述，也不显示设置了什么。

[以用途为起点的创建流程](2026-11-12-resource-auto-create.md)让创建向导和自动创建覆盖了智能体的全部字段，Cherry Assistant 的工具没有跟上。

## 提案

### 扩展 `create_agent`

`create_agent` 创建 Pi Durable 智能体，字段和安全规则与创建向导、自动创建相同：

- 字段：emoji 头像、名称、描述、指令、模型、权限模式、技能、知识库、MCP 服务、禁用的内置工具、回复语言和心跳。
- 模型默认使用默认模型。
- 权限模式永远不会是 `bypassPermissions`。
- 不在已安装目录中的技能、知识库和 MCP 服务 ID 会被拒绝。

它复用主进程的创建路径（`src/main/ai/agents/createAgent.ts` 中的 `createAgent`）和创建命令构造函数 `buildCreateAgentCommand`。构造函数从 `src/renderer/utils/resourceCatalog/resourceCreate.ts` 移到 `src/shared/`，让向导、自动创建和这个工具构造出同样的命令。

频道不在范围内：二维码登录需要界面。

### 新增 `update_agent`

`update_agent` 接收一个智能体 ID 和上述字段中的一部分。每次调用都要经过工具审批。审批时显示每个要改的字段从当前值 → 新值。

有两类改动完全不能通过这个工具完成：把权限模式提升到 `bypassPermissions`，以及修改环境变量。这些由用户在编辑弹框里修改。

`update_agent` 拒绝修改内置智能体。

### 新增 `list_agents`

`list_agents` 只读。它返回每个智能体的 ID、名称、emoji、描述和模型，让助手能把“那个智能体”解析成 ID。

### 智能体身份卡片

创建、修改或自我修改成功后，工具结果在对话中显示为一张卡片。它在现有的内联结果注册表中替换 `CreateAgentToolInline`。

- 卡片显示头像、名称和描述，以及设置或修改了什么的简短摘要。
- 点击卡片或其中的 **打开对话** 按钮，会打开该智能体的对话。
- **调整设置** 会在设置页打开[分页式编辑弹框](2026-11-12-resource-edit-pages.md)。

### 列表刷新

新智能体通过现有的 DataApi 变更通知立即出现在智能体列表中，不需要重新加载。

### 范围

不只是内置的 Cherry Assistant，每个智能体都能修改自己的配置，也能创建新的智能体，新智能体出现在对话列表中：

- 每个用户创建的智能体和 Cherry Assistant 都获得 `create_agent` 和 `list_agents`。Cherry Support 和 Doctor 不获得：支持类能力有意不允许创建智能体，Doctor 在后台无界面运行。`create_agent` 每次调用都要审批，校验规则与上文相同。`list_agents` 只读。
- 每个用户创建的智能体都能通过已有的 `mcp__cherry-tools__config` 工具修改自己的字段。新的自我修改覆盖 emoji 头像、描述、指令、模型、权限模式、技能、知识库、MCP 服务、禁用的内置工具、回复语言和心跳。它每次调用都要审批，并显示每个改动字段从当前值 → 新值。它永远不会设置 `bypassPermissions` 或环境变量。内置智能体只保留原有的 `config` 操作，所有自我修改字段都会被拒绝。
- `rename` 和 `complete_bootstrap` 操作保持不变。
- Cherry Assistant 还保留 `update_agent`，用于修改其他非内置智能体。
- 自我修改的身份卡片隐藏 **打开对话**，因为用户已经在这个对话里。它保留 **调整设置**。
- 普通助手仍然什么都不加。

## 备选方案

- **只让 Cherry Assistant 有 `create_agent`。** 没有采用：每次调用都要审批，且经过同样的校验，所以让每个智能体都有它，也不会出现用户事先没看到的改动。
- **自我修改不经审批直接生效。** 没有采用：智能体可能改写自己的提示词和权限模式，用户必须先看到每一处改动。
- **`update_agent` 不经审批直接生效。** 没有采用：这个工具可以改写另一个智能体的提示词和能力，用户必须先看到每一处改动。
- **从对话中打开渲染进程的创建向导。** 没有采用：完整的弹框会打断对话，而卡片加上调整设置已经覆盖了编辑。

## 验收标准

- AC1 — `create_agent` 创建一个带有全部所给字段的 Pi Durable 智能体，拒绝未安装的技能、知识库和 MCP 服务 ID 以及 `bypassPermissions` 模式，未指定模型时使用默认模型；非内置智能体也能调用它，新智能体会出现在智能体列表中 (verification: main service test and renderer; owner: implementer)
- AC2 — `update_agent` 每次调用都请求审批，审批列出每个改动字段的当前值和新值，该工具无法设置 `bypassPermissions` 或环境变量，并拒绝修改内置智能体 (verification: main service test and renderer; owner: implementer)
- AC3 — `list_agents` 返回每个现存智能体的 ID、名称、emoji、描述和模型 (verification: main service test; owner: implementer)
- AC4 — 创建或修改成功后，对话中显示身份卡片，点击卡片会打开该智能体的对话，调整设置会在设置页打开编辑弹框 (verification: renderer; owner: implementer)
- AC5 — 在对话中创建的智能体无需重新加载就出现在智能体列表中 (verification: renderer; owner: implementer)
- AC6 — 所有新增界面文案在全部渲染进程语言包中都有翻译，没有占位符 (verification: docs gate; owner: implementer)
- AC7 — 在运行中的应用里，让 Cherry Assistant 创建一个智能体后显示卡片，新智能体出现在智能体列表中，并能从卡片打开 (verification: Electron; owner: implementer)
- AC8 — 普通智能体通过 `mcp__cherry-tools__config` 的自我修改每次调用都请求审批，显示每个改动字段从当前值 → 新值，拒绝 `bypassPermissions`、环境变量以及内置智能体的任何自我修改，改动会出现在编辑弹框中 (verification: main service test and renderer; owner: implementer)

## 风险

- 模型可能选出不理想的配置。所有设置之后都能修改，而且只能选择已安装的资源。
- `update_agent` 可以修改另一个智能体的提示词。每次调用都需要审批。
- 智能体可以修改自己的提示词或权限模式。每次调用都需要审批，而且权限模式永远不会是 `bypassPermissions`。
- 任何智能体都能创建，可能导致智能体越来越多。每次创建都需要审批，用户也可以删除智能体。
- 每次修改都要审批，可能导致审批疲劳，用户不看内容就点通过。
