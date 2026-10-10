---
description: Proposed business-driven tool access and approval design for Assistants and Claude Code, Pi, and DSH Agents, separating user choices from runtime availability
sources:
  - src/shared/ai/dshBuiltinTools.ts
  - src/shared/ai/agentRuntimeCapabilities.ts
  - src/main/ai/agents/builtin/builtinAgentCapabilities.ts
  - src/main/ai/runtime/agentMcpServers.ts
  - src/main/ai/runtime/dsh/compositionBuilder.ts
  - src/main/ai/runtime/dsh/DshRuntimeConnection.ts
  - src/main/ai/tools/adapters/aiSdk/builtin
  - src/main/ai/toolApproval/builtinToolPolicy.ts
  - packages/dsh-bridge/src/plugin.ts
  - packages/dsh-bridge/src/policy.ts
---

# Assistant / Agent 工具访问设计（提案）

> 记录日期：2026-09-29。现状核对基于工作区提交 `eb2a144bd01`。
> 本文记录业务方向、建议方案与待决问题，不代表功能已经实现。
> 范围是普通 Assistant 和已有 Claude Code / Pi / DSH Agent 的工具暴露与配置，不是接入第三方 Agent runtime。

## 1. 业务目标与已确认方向

用户应能回答：这个助手能做什么、我允许它做什么、执行前是否询问，以及为什么某项能力当前不能用。

- 完整展示工具能力；不能因为工具被标记为 internal，就让用户完全看不到其用途和约束。
- 同时支持访问开关与逐工具审批配置；有业务依赖的工具可以联动启停。
- 普通 Assistant 与 Agent 分别持有自己的工具策略。一个对象的“始终允许”不应悄悄改变其他对象。
- 设置页和审批卡片的持久化选择写入同一份对象级策略。
- 对允许配置的工具，用户可以显式选择自动批准，包括 Shell 和有副作用的工具；这不解除资源权限、角色边界、沙箱及硬性禁止。
- 保留各 runtime 的原生工具定义和执行机制，不新建一套替代 SDK 的执行注册表。

“完整展示”不等于“每个内部协议工具都有独立开关”，也不等于“所有 runtime 支持相同能力”。

## 2. 当前实现与实际缺口

| 当前来源 | 负责什么 | 本次要解决的缺口 |
|---|---|---|
| AI SDK `ToolEntry` 与 `applies(scope)` | 普通 Assistant 的工具定义、请求条件与延迟暴露 | 用户缺少完整、统一的能力视图 |
| `builtinAgentCapabilities.ts` | 内置 Agent 角色、开放/封闭环境、宿主工具及渠道边界 | 配置界面必须解释这些约束，不能用工具开关突破它们 |
| `agentMcpServers.ts` | 为已有 Agent runtimes 装配 Cherry / 用户 MCP servers | 传输 server 的划分不等于用户的业务分组 |
| `builtinToolPolicy.ts` | Cherry MCP 工具的默认审批语义 | 还不是完整的对象级访问和审批配置 |
| DSH composition + SDK 注册表 | 实际注册工具、schema、执行器和作用域 | Cherry 静态目录可能遗漏条件工具或子 agent 局部工具 |
| `agentRuntimeCapabilities.ts` | 设置界面中的 runtime 工具目录 | DSH 的 Cherry 工具仍从 Claude 用户可见工具子集派生 |

DSH 的 Cherry 静态目录列出 16 个原生工具；实际装配还包括仅在 continuable 子 agent 中注册的 `report`。没有启用技能时，composition 会关闭技能装配；Windows Shell 实际使用 `pwsh`，而设置标识保持 `bash`。

因此，不能把静态目录等同于每个会话的实际工具集合，也不能只查询当前主 agent 就声称发现了所有能力。

当前 DSH `report` 未进入 Cherry 静态审批目录。代码推导表明它在非 bypass 模式下可能落入 ask，再被 delegated 策略拒绝；这是待复现的现状问题，不是本文已修复的功能。

## 3. 配置、业务条件与执行限制分开

| 概念 | 回答的问题 | 所有者 | 是否保存为用户策略 |
|---|---|---|---|
| 访问开关 | 我是否允许此对象使用这项能力？ | Assistant / Agent | 是 |
| 审批偏好 | 调用时默认、询问还是自动批准？ | Assistant / Agent | 是 |
| 业务资源 | 绑定了哪些知识库、技能、MCP server？ | 已有资源绑定逻辑 | 保持现有数据，不复制进工具策略 |
| 作用范围 | 工具属于主 agent、子 agent，还是特定内置角色？ | 业务能力定义与 runtime | 否 |
| 当前可用性 | 当前请求/会话是否满足条件、装配是否成功？ | Main 请求构建与 runtime | 否，动态计算 |
| 执行限制 | 本次调用是否越权、违反计划模式或硬性规则？ | Main / runtime 执行入口 | 否，不由 UI 授权 |

`scope / availability` 只是描述上述事实的概念，不预设新增同名持久化字段，也不引入通用条件表达式或规则引擎。

设置页没有会话上下文时，应显示“需要附件”“仅对子 agent 生效”等条件说明，不能断言当前不可用。进入具体会话后，再根据真实上下文给出状态。

## 4. 按 Cherry 业务设计能力，而不是按 SDK 包名分组

以下为建议的分组规则；精确成员及不可独立关闭项仍须在实现前确认。

| 业务能力 | 相关工具/机制 | 建议的配置与联动 | 条件与边界 |
|---|---|---|---|
| 本地文件与 Shell | DSH `read/read_image/edit/write/bash`，其他 runtime 的对应工具 | 同一区域展示，但读、写、Shell 可分别配置；不因同一个 SDK 包而强制联动 | 工作区、平台、沙箱和路径权限继续生效；附件读取不等于任意本地文件读取 |
| 子 agent 协作 | DSH `subagent/subagent_fork/send_message/interrupt_agent/list_agents/report` | 以协作能力组控制；展开解释成员和作用范围，避免允许启动却无法通信或汇报 | `report` 仍只装配到适用子 agent，不给主 agent 注册一个空实现 |
| 目标管理 | DSH `get_goal/create_goal/update_goal` 及 goal continuation | 按完整目标工作流评估联动，而非三个无关开关 | 关闭工具是否同时停止已激活的 goal continuation，必须单独定义 |
| 已安装技能使用 | 已绑定技能、DSH `skill` 及技能提示词装配 | 沿用已有技能选择；工具开关不能替代技能绑定 | 无技能时可显示“已允许，需启用技能”；不能仅禁用 `skill` 就承诺所有 runtime 都不再加载技能内容 |
| 技能市场与环境安装 | `search_skills/install_skill/install_mcp_server` | 与已安装技能使用分开；搜索、安装具有不同审批语义 | 服从 Agent 的 open/sealed 环境边界；不能因无已安装技能而禁用市场搜索 |
| 知识库 | `kb_list/kb_search/kb_read/kb_manage` | 阅读链路整体可用，管理能力单独控制 | 普通 Assistant 的请求资源范围与内置 Agent 的 allKnowledgeBases 能力不同；开关不能扩大知识库范围 |
| 联网与图像生成 | `web_search/web_fetch/generate_image` | 保留现有功能入口，最终收敛到一致的访问意图，不能产生两个互相矛盾的开关 | 客户端工具与 provider 服务端搜索不是同一执行路径；图像生成还需要可用的绘图模型 |
| 会话附件和工具输出读取 | `read_file/fs_read` | 展示其用途及与附件、输出卸载的关系；是否独立关闭需验证完整读取流程 | 禁用读取时不得继续产生模型无法取回的卸载结果；没有附件是条件不足，不是用户关闭 |
| MCP 资源读取与工具发现 | resource list/read、搜索/描述/调用类 meta-tools | 作为对应资源/延迟暴露链路的配套能力，不拆成容易破坏流程的开关 | 元工具不能绕过目标工具的访问和审批策略 |
| Cherry 宿主操作 | `assistant`、`assistant-files` 中的导航、诊断、设置、附件操作等 | 对适用角色列出完整能力及限制；不等于所有普通 Agent 都获得宿主权限 | 内置角色、runtime 支持和渠道会话限制保持原有所有权 |
| 记忆、定时任务、通知、会话协作 | `memory/cron/notify/session_*` 等 | 按业务用途分组，不因都在 `cherry-tools` server 就共用一个不可拆的开关 | 关闭工具访问不等于删除记忆、取消已有定时任务、解绑渠道或终止其他会话 |
| 用户 MCP server | server 原始工具集合 | 按 server 展示并支持逐工具配置；第三方没有声明的业务依赖不猜测 | 不替用户连接、启用或授权 server；连接失败和目录未知不能显示为用户关闭 |

计划模式和询问用户属于交互流程：展示它们，不以“自动批准”伪造用户回答或绕过计划审核。能否关闭计划流程及如何退出已进入的计划状态，列为待决项。

## 5. namespace、联动组与 MCP server 的关系

- namespace 表达工具来源或业务归属，用于目录组织；不自动赋予权限。
- 联动组只表达已确认的业务依赖，例如启动子 agent 后必须能够汇报。分组内审批不必相同。
- MCP server 是装配与传输边界。`cherry-tools` 内含多个业务能力，不应被迫共用一个开关；子 agent 协作也可能跨多个 SDK 包。
- 不为满足 UI 分组而立即拆分 Claude Code 的 MCP servers。先把同一业务策略投影到 Claude、Pi 和 DSH；只有生命周期或权限边界确有需要时再调整 server 划分。
- 展示名、namespace 和 runtime wire name 都不能替代稳定身份。MCP 身份应绑定稳定 server 身份与原始 tool name；适配器负责映射 runtime 名称，不能通过字符串前缀授予自动批准。

## 6. 最小数据与运行时职责

### 用户策略

沿用讨论方向：Assistant 和 Agent 各自保存版本化 `toolPolicy`，包含关闭的联动组、关闭的独立工具、逐工具审批覆盖。字段名与数据库 schema 尚未定稿。

- 保存用户意图，不保存“当前没附件”“MCP 断线”“只有子 agent 可用”等临时事实。
- 联动组控制的成员不再保存相互冲突的独立开关；组内仍可存在不同审批偏好。
- “恢复默认”移除覆盖，不能复制一份当时计算出的权限集合。
- 暂时不支持的 runtime 能力保留用户选择并说明原因，切换 runtime 不静默删除配置。
- 对象级策略通过已有 SQLite / DataApi 路径保存；运行时目录和状态查询不因此变成 DataApi 业务数据。

### 目录与执行

Cherry 维护业务名称、用途、分组、默认策略及 runtime 绑定；SDK / MCP 继续提供真实 schema 和执行器。存在运行时注册表时用它核对实际装配，但配置页不能为了列工具而启动一个 Agent 会话。

Main 根据对象配置、角色、资源绑定、会话上下文和实际装配计算有效状态；renderer 只展示事实和提交选择。DSH 的 `schemas(agent)` 能描述特定作用域，不能代替完整的产品能力目录；SDK 的可见性过滤也不能替代执行时拒绝。

建议执行优先级：

1. 角色、资源、装配及硬性安全约束不满足时，不因用户勾选而放行。
2. 用户关闭的能力在实际执行入口被拒绝，包括 meta-tool 转发和子 agent 调用。
3. 对允许执行的调用应用逐工具审批覆盖；未覆盖时沿用默认策略与会话权限模式。
4. 仍需人类交互但无 responder 的调用，明确拒绝，不自动批准。

审批偏好只是决定是否询问，不改变参数验证、路径范围和业务权限。现有 `session_create/session_send` 的不可 bypass 审批与“显式逐工具自动批准”目标存在差异；需要明确迁移与测试，不能把现状和目标混写成已经一致。

配置保存与 runtime 已应用是不同状态。必须保留活跃会话的禁用更新路径；需要重建才能启用的能力，应明确显示尚未生效，而不是保存后立即声称可用。

## 7. 尚需决策与验证

1. **联动组边界**：逐项确认哪些工具强制联动，哪些只是同一区域展示；不把上表直接当成最终 manifest。
2. **运行中关闭**：关闭子 agent 或目标组时，如何停止新工作、处理已有子任务、保留必要收尾能力；不能简单禁用 `report` 后让任务失联。已有 cron 等业务实体默认不随工具开关销毁。
3. **跨 runtime 身份**：哪些原生工具语义足够等价可共享配置；名字相似但资源范围不同的工具不能强行合并。
4. **旧数据迁移**：Agent `disabledTools`、Assistant 功能开关、MCP server 审批偏好迁往对象级策略时如何保持既有意图；未定义映射前不得增加双写。
5. **内部配套能力**：输出读取、工具发现、计划退出哪些只能随能力组配置，哪些可独立配置，需用真实调用流程验证。
6. **目录完整性**：补齐 DSH 子 agent 局部工具检查；复现 `report` 的审批风险，再决定修复，不把静态推导当运行证据。

## 8. 验收场景（实现时使用，当前未执行）

- DSH 未启用技能时，配置保留“允许使用”，会话说明缺少技能；启用技能后恢复，不要求重设访问开关。市场搜索不受该条件误伤。
- 主 agent 的工具集合不出现 `report`；适用子 agent 能正常汇报，配置页可找到它与协作能力的关系。
- 关闭任一业务工具后，直接调用、Pi 转发/代码执行入口及 DSH 子 agent 都不能绕过；被禁止的名称不误伤同名但不同来源的 MCP 工具。
- 一个 Assistant 的“始终允许”只更新该对象；另一 Assistant/Agent 不因此失去审批。持久化失败时不能显示已成功保存。
- 没有附件、未绑定知识库、缺少绘图模型、MCP 目录未知分别显示准确原因；不自动添加资源、安装依赖或改写用户选择。
- 普通 Agent 不能通过打开宿主工具获得内置角色权限；sealed Agent 不能通过开关开放用户环境。
- 切换 Claude / Pi / DSH、切换平台或重命名 MCP server 后，配置不会因 wire name 变化而丢失或错授；不支持的能力明确说明。
- 活跃会话收到禁用后后续调用被拦截；等待重建的启用明确标识。运行中的子 agent、goal 和计划流程按确认后的生命周期规则收尾。
- 升级后的真实目录与业务描述能互相核对，SDK 新增或子 agent 专用工具不会再次成为用户不可见的遗漏。

## 相关文档

- [Tool Registry](./tool-registry.md)：普通 Assistant 当前注册与延迟暴露。
- [Tool Approval](./tool-approval.md)：当前审批流与 MCP 持久化行为。
- [Agent Session Runtime](./agent-session-runtime.md)：现有 runtime 边界。
- [历史 Claude 工具目录设计](../../../v2-refactor-temp/docs/ai/declarative-tool-registry.md)：其中“internal 隐藏”和“移除逐工具审批”是历史方向，不能作为本文目标方案的依据。
