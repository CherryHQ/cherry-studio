# Agent Note: 智能体与助手的一键自动创建

Status: proposed

[English](2026-11-12-resource-auto-create.md) | 中文

## 问题

创建智能体或助手目前只能走分步的 `ResourceCreateWizard`（`src/renderer/components/resourceCatalog/dialogs/create/ResourceCreateWizard.tsx`）。助手有三步（基础信息 → 系统提示词 → 知识库），智能体最多四步（基础信息 → 系统提示词 → 技能 → 知识库）。用户要自己选头像、起名、写或生成提示词，再手动勾选技能和知识库。唯一的生成辅助是 `PromptPolishActions`，它只能根据名称生成系统提示词。没有任何能力能把一句用途变成一整套配置。创建时也完全无法选择 MCP 服务：`buildCreateAgentCommand` 和 `buildCreateAssistantDto`（`src/renderer/utils/resourceCatalog/resourceCreate.ts`）从不发送 MCP。

这一流程的设计原型已经定下一个入口页：头像、名称、用途、模型，然后选择 **自动创建**（全部配好）或 **手动创建**（进入现有向导，并带入已填内容）。

## 提案

### 在现有向导前加一个入口页

`ResourceCreateWizard` 打开时先显示新的入口页，助手和智能体共用。入口页包含：

- emoji 头像，使用现有的 `EmojiAvatarPicker`；
- 名称，自动创建时可以不填；
- 用途文本框，绑定到现有的 `description` 字段；
- 模型选择器，过滤规则与基础信息步骤相同。

底部按钮是：取消、**手动创建**、**自动创建**。

- **手动创建** 切到现有步骤的第 1 步。头像、名称、模型和用途（作为描述）共用同一个表单，所以会自动带入。
- 填好用途并选好模型后，**自动创建** 才可点。它会生成一套配置，合并进表单，再调用调用方现有的 `onSubmit`。因此五个调用方仍然只有一条创建路径，自身无需改动。
- 如果调用方预置了 `initialValues.prompt`（例如已经配好的模板），向导直接打开步骤页。

### creator skill：一次生成并校验

`src/renderer/utils/resourceCatalog/autoConfigure.ts` 负责三部分。

- **creator 系统提示词。** 要求模型只返回一个 JSON 对象，字段包括：
  - `name`、`emoji`、`description`、`prompt`、`knowledgeBaseIds`、`mcpServerIds`；
  - 智能体另有 `skillIds` 和 `permissionMode`；
  - 助手另有 `enableWebSearch`。
- **输入构造。** 发送用途、可选的名称，以及实际已安装资源的精简目录：
  - 非内置技能（仅智能体）；
  - 知识库；
  - MCP 服务；
  - 当前运行时允许的权限模式。
- **校验解析。** 依次：
  - 去掉代码块标记，截取出 JSON 对象；
  - 用 zod 校验；
  - 丢弃不在所给目录里的 ID；
  - emoji 只接受单个且不是旗帜的 emoji，否则用该类型的默认头像；
  - 权限模式只接受运行时允许且不是 `bypassPermissions` 的值，否则用运行时的创建默认值；
  - 名称或提示词为空时不返回结果。

生成调用 `fetchGenerate`，使用默认模型，与 `PromptPolishActions` 相同。用户选的模型只赋给新建的资源。超时 60 秒，关闭弹框时取消请求。用户自己选的头像或输入的名称优先于生成结果。失败时弹框显示错误，不创建任何东西，「手动创建」仍然可用。

### 创建数据

创建值新增两个字段：`mcpServerIds`，以及助手专用的 `enableWebSearch`。两者默认分别为空和关闭，所以手动路径不受影响。

- 智能体的运行时支持 MCP 时，发送 `mcps`。
- 助手发送 `mcpServerIds`。选了 MCP 服务或打开了网络搜索时，同时发送对应的 `settings`。

这条流程里头像只用 emoji。上传图片仍可在编辑弹框里使用。

## 考虑过的替代方案

- **智能体在运行时自己配置自己。** 做法是内置一个 `SKILL.md`，给 `mcp__cherry-tools__config` 增加头像、提示词、技能等操作，再开一个首个会话让智能体配置自己。没有采用，因为助手没有智能体运行时，同一流程要维护两套机制。这种方式也更慢，并且会扩大一个无需审批即可执行的工具。
- **Cherry 助手的 `create_agent`。** 它只接受 `name`、`description`、`instructions`、`model`，只有内置 Cherry 助手可用，也不能创建助手。
- **通过 `ai.text.generate` 做结构化输出。** 比从文本里解析 JSON 更可靠。但这条 IPC 路由没有输出 schema 选项，属于上游改动，留待单独决定。文本 JSON 加 zod 校验在所有提供商上都能用。
- **用用户选的模型生成。** 仅限智能体的模型不一定支持 `ai.text.generate`，所以改用默认模型，与润色提示词一致。

## 验收标准

- AC1 — 为智能体或助手打开新建弹框时显示入口页，包含头像、名称、用途、模型、手动创建和自动创建，且在填好用途并选好模型之前自动创建不可点 (verification: renderer; owner: implementer)
- AC2 — 点手动创建会打开现有的第一步，已填的头像、名称、模型以及作为描述的用途都已带入 (verification: renderer; owner: implementer)
- AC3 — 模型返回有效结果时，自动创建只调用一次 `onSubmit`，带上生成的名称、emoji、描述和提示词；用户自己输入的名称或选的头像会保留，不被生成结果覆盖 (verification: renderer; owner: implementer)
- AC4 — 生成的技能、知识库、MCP ID 如果不在已安装目录里，不会进入创建数据；生成的权限模式永远不是 `bypassPermissions` (verification: unit; owner: implementer)
- AC5 — 旗帜、多字符或非 emoji 的头像值会回退为该类型的默认 emoji (verification: unit; owner: implementer)
- AC6 — 输出无法解析、名称或提示词为空、生成出错或超时时，显示错误、不创建任何资源，手动创建仍可用 (verification: renderer; owner: implementer)
- AC7 — 运行时支持 MCP 时，选中的 MCP 服务以 `mcps` 写入新建的智能体；对新建的助手，以 `mcpServerIds` 写入并带上使用这些服务的设置；选中的网络搜索写入助手设置 (verification: unit; owner: implementer)
- AC8 — 在运行中的应用里，根据用途自动创建一个智能体和一个助手后，它们的编辑弹框显示生成的 emoji、名称、提示词和选中的能力 (verification: Electron; owner: implementer)
- AC9 — 所有新增界面文案在全部渲染进程语言包中都有翻译，没有占位符 (verification: docs gate; owner: implementer)

## 风险

- 模型质量参差不齐。较弱的模型可能返回普通文字或格式不对的 JSON。解析器会拒绝这类结果，用户点一下就能改用手动创建。
- 生成时会把已安装技能、知识库、MCP 服务的名称和描述发给默认模型的提供商。这与任何列出这些资源的对话是同样的暴露面，只是现在发生在创建时。
- 自动创建可能启用用户没有逐个查看过的 MCP 服务和技能。它们仅限于用户已经安装的资源，且创建后都可以修改。
- 每次自动创建多一次模型调用，会增加延迟（通常几秒）和 token 消耗。
