---
description: Agent 会话中按需发现 MCP Skills、校验文件读取并复用普通工具审批
sources:
  - src/main/ai/skills/mcpSkillContent.ts
  - src/main/ai/mcp/connections/ClientMcpConnection.ts
  - src/main/ai/mcp/servers/skills.ts
  - src/renderer/hooks/useMcpSkills.ts
  - src/renderer/components/composer/variants/AgentComposer.tsx
  - src/shared/types/mcpSkills.ts
  - src/shared/ai/tools/mcpSourcePolicy.ts
  - src/renderer/pages/settings/McpSettings/McpSkill.tsx
---

# MCP Skills 客户端

[English](mcp-skills-client.md) | 中文

Cherry 在 Claude Code 和 Pi Agent 会话中，通过工具发现并读取 [MCP Skills](https://skills.extensions.modelcontextprotocol.io/specification/stable/skills)。服务必须在现代协议中声明 `io.modelcontextprotocol/skills` 与 resources 能力。旧版和未声明能力的服务保持原有行为。动态清单、普通 Assistant 聊天及向外部客户端提供本地技能不在范围内。

## 使用流程

1. 为 Agent 选择启用的 MCP 服务，然后打开输入框中的 **Skills**。远端条目与本地技能一起展示，并标明服务和 URI。服务重名时，选择器描述会在开头显示服务 ID。
2. 选择条目只插入使用请求，不安装或读取文件。
3. 模型用服务 ID 和技能 URI 调用 `load_mcp_skill`。加载遵守 MCP Server 设置中该 Skill 的读取权限，默认每次审批；Full Access 跳过提示。拒绝工具不读取文件。
4. 加载返回当前元数据、完整清单和已验证的 `SKILL.md`。附件仅在通过 `read_mcp_skill_file` 请求时获取。

模型可通过 `list_mcp_skills` 发现名称和描述，无需把它们放进初始提示。已知 URI 可以跳过发现直接加载。身份为 `(serverId, skillUri)`，不同来源的相同名称或 URI 不会相互覆盖。

## 职责

| 模块 | 约定 |
|---|---|
| `ClientMcpConnection` | 复用官方 SDK 能力检测、直接查询和 core Schema；宿主分页拒绝循环游标和重复 URI。 |
| `McpRuntimeService` / `McpCatalogService` | 现有连接、元数据、超时、取消和当前配置检查。 |
| 内置 skills 服务 | 单次请求内的服务选择检查、当前清单获取和内容校验。 |
| Tool Approval | 通过普通审批路径执行服务持有的读取权限；不增加加载后的执行策略。 |
| 输入框 / IpcApi | 选择器打开时只发现元数据，关闭时取消，失败来源显示独立错误行。 |

两个运行时使用相同的三个工具。Pi 直接暴露内置 skills 服务。远端目录不会进入本地技能库或原生技能加载器。静态清单提供文件目录，无需额外目录工具。

## 读取与完整性

`read_mcp_skill_file` 接受 `server_id`、`skill_uri` 和 `resource_uri`。无需预先加载：每次调用都获取当前清单和所请求的字节。重复加载或读取即可观察远端更新，无需重新打开会话。不保留 Skill 会话管理器、激活状态、版本固定、内容缓存或激活持久化。会话标识仅作为普通 MCP 交互上下文。

清单接收检查名称、根目录、资源范围、唯一性、包含 `SKILL.md` 在内最多 512 个文件，以及总大小不超过 16 MiB。获取文件前，工具检查根目录和当前清单成员身份。响应必须只包含请求的单个资源，其字节长度与 SHA-256 符合声明。入口文件 YAML 必须与所有声明的 frontmatter 字段一致，包括未知字段。读取始终通过选中的来源 MCP 连接，不直接访问 HTTP 或文件系统。

校验仅约束单次调用。不同读取可以返回不同的有效版本；发现或其他读取不会取消先前调用，也不会撤回先前文本。普通请求取消与服务选择检查继续生效。不拦截通用资源读取。

## 权限与限制

指令和嵌套 `SKILL.md` 都是普通的不可信工具结果上下文。Frontmatter 不能安装 hooks 或授予权限。加载不会改变后续执行、cron、委派、本地技能或跨来源资源策略。列表使用普通只读工具策略。在**设置 → MCP Server → Skills** 中，每个 Skill 与 MCP 工具共用“已启用”和“自动批准”开关。启用后默认每次审批；开启自动批准则自动允许读取，关闭已启用则禁用读取。此等级同时作用于加载和附件读取。Full Access 跳过提示，但遵守明确禁用。普通发现隐藏禁用条目，服务设置仍显示它们以便重新启用。权限按准确的 Skill URI 保存在 MCP Server 上，不引入 Skill 会话状态。

本范围明确不实现扩展的 acting-window 激活及特殊执行、跨来源审批模型，不声称完整符合宿主策略。原生历史可能保留旧工具结果，重新读取不会重写历史。不保存消息来源信息、历史协调状态、可复用授权或 Skill 加载的一次性凭据。

## 验证

`tests/helpers/mcpSkills.ts` 为协议和工具测试提供真实 MCP 服务。定向测试覆盖分页、旧版兼容、无需加载的附件按需读取、当前版本读取、二进制附件、资源范围、清单成员身份、字节与 frontmatter 校验，以及来源独立失败。现有运行时和审批测试覆盖普通策略。按需 Electron 场景在两个运行时中检查选择器、加载审批、附件结果和普通执行策略。该场景的实际运行与真实提供商验收均独立于单元测试和构建。
