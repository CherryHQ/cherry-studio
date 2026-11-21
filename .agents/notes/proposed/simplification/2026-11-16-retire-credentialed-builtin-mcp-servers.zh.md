# Agent Note: 退役需要第三方凭据的内置 MCP 服务器

Status: proposed

[English](2026-11-16-retire-credentialed-builtin-mcp-servers.md) | 中文

## 问题

内置 MCP 目录里有六个服务器，它们只有在用户拥有厂商账号时才能工作：

| 服务器 | 厂商 | 需要的凭据 | 原先的传输方式 |
|---|---|---|---|
| `@cherry/didi-mcp` | 滴滴 | `DIDI_API_KEY` | 进程内 |
| `@cherry/dify-knowledge` | Dify | `DIFY_KEY` 加上一个主机参数 | 进程内 |
| `@cherry/brave-search` | Brave Search | `BRAVE_API_KEY` | 进程内 |
| `@cherry/flomo` | flomo | 账号授权 | 远程 HTTP |
| `@cherry/qveris` | QVeris | OAuth 登录，或 `QVERIS_API_KEY` | 远程 HTTP |
| `@cherry/nowledge-mem` | Nowledge Mem | 本地运行着 Nowledge 应用 | 远程 HTTP |

这六个都要用户自备 Cherry 无法提供的凭据。一个「用户必须先去别家注册账号才能用」的市场条目，指向的是第三方的注册流程，而不是产品自身提供的能力。剩下的八个内置服务器——memory、sequentialthinking、fetch、filesystem、python、自动安装助手、browser 和 hub 聚合器——都不需要厂商账号。

这六个还带来实打实的代码量，以及一批只为它们存在的特判：

- `src/main/ai/mcp/servers/didiMcp.ts`、`difyKnowledge.ts` 和 `braveSearch.ts` 是三个进程内 MCP 服务器，各自把一家厂商的 REST API 包在 MCP 协议后面。
- `src/main/ai/mcp/servers/factory.ts` 里的 `resolveBuiltinExternalMcpServer` 在连接时改写三个远程服务器的端点和请求头，并把 `QVERIS_API_KEY` 转成 Bearer 头。
- `src/main/ai/mcp/connections/ExternalMcpConnection.ts` 里的 `prefersOAuth` 为内置的 QVeris 服务器开了特例，因为它的静态密钥只是兜底凭据，OAuth provider 必须保持挂载。
- `src/renderer/pages/settings/McpSettings/McpServerFields.tsx` 里的 `showsEnvEditor` 多了一个 `builtinRequiresEnv` 参数，好让远程服务器也能显示 env 输入框，而只有 QVeris 用得上。

退役不只是删预设。已安装的行会比服务它们的代码活得更久：

- 三个进程内服务器对应的行是 `type: 'inMemory'`。一旦 `hasInMemoryImplementation` 不再认这个名字，`mcpTransportKind` 就把这一行判成 `invalid`，运行时再也起不来。
- 三个远程服务器的行仍留着一个可用的端点，但会失去运行时给它补上的那些改写。QVeris 还会额外失去把 API key 转成请求头的那步，用户填进去的凭据就不再认证任何东西。
- `BuiltinMcpServerSeeder` 通过遍历 `PRESET_MCP_SERVERS` 来对齐已安装的行。这六个名字一旦离开该目录，seeder 就不再覆盖它们的行：仍在旧进程内传输方式上的行，永远不会被指到可用端点。

## 提案

删掉这六个内置服务器，以及只为它们存在的所有东西。剩下的八个厂商中立内置服务器保持不变。

预设、三个进程内实现及其测试一并删除。`resolveBuiltinExternalMcpServer` 随之删除，`createBuiltinMcpEndpoint` 只保留还有实现的名称。`prefersOAuth` 去掉 QVeris 特判，保留本来就覆盖其他所有服务器的规则：没有静态凭据的服务器走 OAuth 登录，带着凭据的服务器用自己的请求头认证。`showsEnvEditor` 去掉 `builtinRequiresEnv`，因为剩下的远程内置服务器都不读 env 字段。

退役内置服务器必须让已安装的行保持一致，因此新增 `RetiredBuiltinMcpServerSeeder` 处理它们。它在 `BuiltinMcpServerSeeder` 之后运行，通过「名称 + `installSource = 'builtin'`」识别退役行，所以用户自己在同名下添加的服务器不受影响。

这六行按「还能做什么」分成两类：

- **远程行**（flomo、QVeris、Nowledge Mem）留着用户仍能访问的远程端点。行以用户自有服务器的形式存活：`installSource` 变为 `manual`，端点和凭据原样保留。仍在旧进程内传输方式上的行改用远程端点，因为承载它的预设已经离开目录，`BuiltinMcpServerSeeder` 不再覆盖它。QVeris 把 `QVERIS_API_KEY` 从 env 移到承载它的 `Authorization` 头里，因为做这次转换的代码正是本次删掉的部分。
- **进程内行**（滴滴、Dify Knowledge、Brave Search）已经没有任何可用的传输方式。行连同它的 `agent_mcp_server` 和 `assistant_mcp_server` 关联一并删除，不让任何 Agent 或助手继续指向一个起不来的服务器。

这六个服务器在十七个语言包里的描述随它们一起删除。

不在范围内：

- 这六家厂商自己的 MCP 服务器，用户仍然可以自行添加。市场页和添加服务器对话框不变。
- 剩下的八个内置服务器，以及包含它们的 `hub` 聚合器。
- `@cherry/mcp-auto-install` 助手，它按需安装第三方 MCP 服务器，是通往这六家厂商服务器的受支持路径。

## 考虑过的替代方案

- 保留这六个，向每家厂商争取一个 Cherry 可以不凭用户凭据就直接提供的托管端点：目前没有厂商提供这样的端点，而且答案仍然是让用户去厂商官网注册。
- 保留这六个，但把它们移出市场页视图：目录是运行时读取的，`factory.ts` 和 `ExternalMcpConnection.ts` 里的特判会留下来，这六个仍然是唯一需要凭据的内置服务器。
- 六个的行全部删除，而不是把远程那三个转成用户自有：三个能用的服务器会从用户安装里消失，连配置一起带走。用户仍能访问的远程端点不需要重新添加。
- 为远程那三个保留 `resolveBuiltinExternalMcpServer`，只删进程内的：这个函数的存在意义是为内置行改写端点，而远程行不再内置了。改写就会作用在不再是内置的行上，这正是本次退役要消除的混乱。
- 把 QVeris 的 `QVERIS_API_KEY` 转换留在运行时，而不是搬进行里：那样就得为一家不再是内置的服务器，在连接层继续留一个厂商分支。
- 退役远程行时保留 `installSource = 'builtin'`：设置页仍会把它们当作内置展示，而内置筛选里会列出目录已经不包含的服务器。

## 验收标准

- AC1 — `BuiltinMcpServerNames` 和 `PRESET_MCP_SERVERS` 中不含 `@cherry/didi-mcp`、`@cherry/dify-knowledge`、`@cherry/brave-search`、`@cherry/flomo`、`@cherry/qveris` 或 `@cherry/nowledge-mem`，市场页只提供不需要厂商凭据的内置服务器。 (verification: unit + review)
- AC2 — `src/main/ai/mcp/servers` 中没有为已删除服务器留下的实现，`createBuiltinMcpEndpoint` 和 `hasInMemoryImplementation` 只对留下的服务器作答。 (verification: unit)
- AC3 — 没有代码路径在连接时改写内置服务器的端点、请求头或凭据；不带静态凭据的远程服务器走 OAuth 登录，带着请求头的服务器用自己的请求头认证。 (verification: unit)
- AC4 — 远程退役内置服务器的已安装行仍能以用户自有服务器的形式工作：端点、凭据和 Agent、助手关联都保留，且不再被当作内置服务器展示。 (verification: unit)
- AC5 — QVeris 的行在退役后仍能认证：配置好的 API key 以 Bearer 头的形式送达服务器。 (verification: unit)
- AC6 — 仍在旧进程内传输方式上的远程行被指到远程端点，已经在用自己的端点的行保持原端点。 (verification: unit)
- AC7 — 进程内退役内置服务器的已安装行及其 Agent、助手关联被删除，不留任何指向起不来的服务器的引用。 (verification: unit)
- AC8 — 用户自有的服务器不会被 seeder 退役，即使名字与退役的内置服务器相同。 (verification: unit)
- AC9 — 十七个语言包里没有已删除服务器的描述，i18n 未使用键检查报告为零。 (verification: unit)

## 风险

- 依赖内置滴滴、Dify Knowledge、Brave Search 服务器的用户更新后会失去这一行。他们的厂商凭据仍在厂商那边，厂商自己的 MCP 服务器仍可手动添加，但一键安装的路没有了。这正是退役内置服务器的预期结果，也正因如此，这次移除需要公告而不是悄悄进行。
- 三个远程服务器能否继续工作，取决于厂商端点是否继续可用。行变成了普通的用户自有服务器，厂商端点出问题时由用户自己观察，而不再由 Cherry 维护的内置来兜底。
- QVeris 的 API key 从 env 字段挪到了请求头字段。设置页会把这个请求头显示在它所认证的端点旁边，但习惯在 env 里找密钥的用户不会在那里找到它。seeder 负责搬运，凭据不会丢。
- `RetiredBuiltinMcpServerSeeder` 靠名称识别退役行，因为承载它们的预设已经离开目录。日后若有内置服务器重用这六个名字之一，也会被这个 seeder 退役。这六个名字归 Cherry 所有，重新引入时会带新名字。
- seeder 只在更新后的首次启动时执行一次。装了更新之后又恢复旧数据库的用户，仍会留着解析不了的行。恢复旧数据库本来就会恢复旧 schema，下次播种时 seeder 会为它重跑。
