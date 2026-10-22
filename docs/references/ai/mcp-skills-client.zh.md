---
description: MCP Skills 发现、按需校验读取、工具审批及 Claude Code/Pi 集成
sources:
  - src/main/ai/skills/McpSkillService.ts
  - src/main/ai/skills/mcpSkillContent.ts
  - src/main/ai/mcp/connections/ClientMcpConnection.ts
  - src/main/ai/mcp/servers/skills.ts
  - src/main/data/services/AgentSessionMessageService.ts
  - src/renderer/hooks/useMcpSkills.ts
  - src/renderer/components/composer/variants/AgentComposer.tsx
  - src/shared/types/mcpSkills.ts
---

# MCP Skills 客户端

[English](mcp-skills-client.md) | 中文

Cherry 在 Claude Code 和 Pi Agent 会话中使用 [MCP Skills 扩展](https://skills.extensions.modelcontextprotocol.io/specification/stable/skills)。服务必须在现代协议中声明 `io.modelcontextprotocol/skills` 和 resources 能力。旧协议和未声明扩展的服务保持原有行为。目前不支持动态技能清单；普通 Assistant 对话以及向外部 MCP 客户端提供 Cherry 技能不属于此功能。

## 使用流程

1. 为 Agent 选择已启用的 MCP 服务，然后打开会话输入框中的 **Skills**。远端条目与本地技能一起展示，并显示服务标签和 URI。
2. 选择条目会将使用请求填入输入框，不会安装或加载文件。
3. 模型调用 `load_mcp_skill`，按会话权限模式处理常规工具审批；Full Access 可以跳过加载审批。不再使用独立 consent 弹窗或执行复选框。
4. 加载一次返回元数据、完整文件清单和校验通过的 `SKILL.md`。辅助文件仅在需要时读取。拒绝加载工具不会获取技能文件。

名称仅用于展示。稳定标识为 `(serverId, skillUri)`，即使多个服务提供相同 URI，或者同一服务在不同路径下提供同名技能，也保持独立。初始提示词不必包含技能名称和描述。模型调用 `list_mcp_skills` 发现技能，或用已知服务 ID 和 URI 直接调用 `load_mcp_skill`；目录不完整不影响按 URI 查询。

## 职责归属

| 所有者 | 契约 |
|---|---|
| `ClientMcpConnection` | 通过 SDK 的公开扩展请求 API，按能力声明调用并处理 `skills/list`、`skills/get` 和可选的 `resources/directory/read` 分页。 |
| `McpRuntimeService` / `McpCatalogService` | 复用既有连接、超时、取消、当前服务配置和元数据投影。元数据每次重新获取。 |
| `McpSkillService` | 会话持有的清单、来源、完整性校验、仅在内存中的内容缓存、来源限制及工具守卫。 |
| `AgentSessionRuntimeService` | 打开和关闭技能会话，在返回内容前持久化加载来源，并通过现有 Tool Approval 注册表展示工具审批。 |
| 输入框 / IpcApi | 仅在选择面板打开时发现元数据，关闭后取消请求，并为失败来源显示明确的错误条目。 |

宿主提供 `list_mcp_skills`、`load_mcp_skill` 和 `read_mcp_skill_file`。两种运行时使用同一服务。Pi 直接暴露内置 skills 服务，使辅助文件读取不必执行 code mode 脚本。加载结果包含完整清单和辅助文件路径，不另设目录工具。远端目录不会进入本地技能库或原生技能发现。

## 完整性与权限

清单准入会校验名称、根目录、资源范围和唯一性，最多包含 512 个文件（包括 `SKILL.md`），总大小不超过 16 MiB。每个获取的文件都必须匹配持有清单中的字节数和 SHA-256。入口文件的 YAML 必须与所有声明的 frontmatter 字段一致，包括未知字段。内容通过原始 MCP 连接读取，绝不会直接通过 HTTP 或文件系统解析远端 URI。

加载的指令仍是不可信的工具结果上下文。Frontmatter 不能安装 hook 或授予工具权限。加载不会授予执行权限。远端技能生效时，Bash、automation、code mode 和本地技能激活等宿主执行工具在普通权限模式下需要逐次批准。Full Access 自动放行技能加载、执行、嵌套激活和跨来源读取，不显示批准或拒绝提示；完整性和来源校验仍然生效。这有意放宽了 MCP Skills 规范中关于明确批准的要求。标准审批卡片显示工具及其参数，不额外显示技能说明；批准不会复用于下一次调用。普通读取、搜索和远端工具保持原有策略，其他工具限制仍然适用。

作为辅助文件读取的嵌套 `SKILL.md` 只是普通 Markdown。激活嵌套技能需要单独加载，并在 Full Access 以外的模式下取得明确工具批准。已加载技能的会话通过通用资源接口读取时，也受相同的清单校验约束。在 Full Access 以外的模式下，读取另一服务的资源必须通过工具审批逐次明确批准并标明两个来源，即使两个服务的技能都已加载。

## 失效与恢复

宿主会保守地在整个会话期间持有每份已加载清单。清单变更或文件完整性校验失败会使持有的条目失效；必须新建会话才能加载替代版本，避免混合新旧指令。服务移除、停用、连接或认证配置变更、取消选择、请求取消和会话关闭都会拒绝过期操作及授权。首次加载在尚未读取指令时就将审批绑定到目标配置；配置变更会取消待审批请求，必须重新取得批准。批准后，运行时通过更新后的工具输入将宿主的一次性凭据传给内置加载处理器。凭据将会话、服务、URI、原始配置和取消信号绑定到调用完成；新的批准不能使旧调用重新生效。凭据在执行前消费，其校验记录仅保存在内存中，Full Access 无需此凭据。宿主资源审批取消时，会先结束消息历史中的待审批状态并发布更新，再恢复等待中的读取，因此卡片不再可操作。

向运行时提供已加载指令之前，宿主将其来源、清单及原始连接和认证配置的 SHA-256 指纹保存在消息私有字段 `data.mcpSkills` 中，不保存原始配置密钥。失效状态会持久化到该技能的每份留存记录。恢复或分叉保留这些事实，并拒绝已变更的来源，即使配置是在会话关闭期间变更的。重开会话或重启服务不能清除失效状态，Full Access 也不例外。公开读取省略该元数据，公开写入不能伪造或擦除它。由于原生历史可能仍保留指令，不允许单独删除承载来源事实的消息；删除会话会移除其历史。正常持久化和原生分叉保留该字段。这只修改现有 JSON 载荷类型，不改变 SQLite 表结构，也不保存可复用批准或远端文件内容。恢复和分叉会话保留执行审批约束，不会仅因恢复而弹窗。需要批准的操作在没有交互响应者时会被拒绝。

## 验证

`tests/helpers/mcpSkills.ts` 中的共享服务支持真实 SDK 协议测试及使用数据库的宿主测试，覆盖分页、旧协议兼容、按需读取、完整性边界、来源冲突、嵌套激活、两种运行时守卫、恢复和取消。经过审阅后可按需运行的场景 `tests/e2e/ondemand/specs/mcp-skills.ts` 使用本地 MCP 服务和脚本化 Anthropic 响应，在 Electron 中验证两种运行时，包括选择面板、加载审批、辅助文件结果，普通模式下的执行批准和拒绝流程、服务器重配置后取消首次加载审批，以及 Full Access 下无需审批的加载和执行。本地脚本化验收与远端 CI 或真实服务商验收分别记录。
