# Agent Note: Agent shell 命令的基础沙箱策略，首先用于 Cherry Support

Status: proposed

[English](2026-11-26-builtin-agent-sandbox.md) | 中文

## 问题

Cherry Support 运行在 Claude Code 运行时上，权限模式是 `acceptEdits`。它的技能通过 `lark-cli` 和 `gh` 提交反馈，但命令检测看不出脚本或直接调用 API 时会发出什么。因此，在 Full Access 以外的交互式轮次中，`src/main/ai/agents/builtin/builtinAgentGuardRules.ts` 中的 `support-bash` 规则对每次 Bash 或 PowerShell 调用都要求审批，读日志等本地诊断命令也一样。用户为了放行少数会把数据发出本机的命令，要先批准大量无害的命令。

以后其他 Agent 也会需要沙箱，包括 Assistant、用户自建的 Agent，可能还有 Pi 运行时。如果每个 Agent 都各写一份完整的沙箱配置，安全不变式就会被复制到每个 Agent 里，漏掉一处就重新打开一个缺口。例如没开严格模式时，Full Access 会静默放行白名单外的主机。

[保留根会话审批并标识子智能体请求](../../implemented/bug-fix/2026-11-12-agent-shell-approval-boundary.md) 认为系统沙箱是更大的边界改动，当时推迟了。本 Spec 接手这项推迟的工作：定义一份供所有 Agent 扩展的基础策略，并且只为 Cherry Support 启用。

## 提案

Cherry 定义一个与运行时无关的 `SandboxPolicy`，由三部分组成。

*Base（基础策略）。* 放在 `src/main/ai/toolApproval/`，与守卫规则和命令策略放在一起，因为三者共同定义工具执行边界。它包含所有启用沙箱的 Agent 共用的默认值和不变式：

- 只能写入会话工作区、Agent 数据目录和临时目录。
- 网络使用严格模式，白名单为空。
- 受已生效沙箱约束的 Bash 调用跳过逐次 shell 审批。其他工具策略和命令策略仍照常检查。Full Access 以外的模式仍需审批才能离开沙箱。
- 如果沙箱无法启动，或者无法确认生效配置满足解析后的策略，轮次在执行任何 shell 命令前失败。
- 只有 `darwin` 会得到策略；其他平台都得不到，继续沿用现有的审批行为。

*Overlay（扩展）。* 每个 Agent 声明自己的 overlay；没有 overlay 的 Agent 不启用沙箱。overlay 可以：

- 追加允许的域名和可写路径；
- 选择网络档位：只用白名单、白名单加 Cherry 预置清单，或者放行所有主机。“放行所有主机”只给用户自建的 Agent，并且必须由用户明确选择。

合并时列表字段取并集；任何一方拒绝的域名，即使 overlay 放行也仍然拒绝。overlay 不能：

- 在列表类档位下关闭严格模式；
- 让离开沙箱变成无需审批；
- 开启 `allowAppleEvents`、Unix socket 访问或嵌套用户命名空间；
- 让 `$HOME` 根目录或 shell 启动文件变为可写。

合并函数会忽略这些字段，保留基础策略的值。

*Adapter（适配器）。* 适配器把合并后的策略翻译成运行时参数。本 Spec 只实现 Claude Code 适配器，放在 `src/main/ai/runtime/claudeCode/`，由 `settingsBuilder.ts` 把结果作为 SDK 的 `sandbox` 选项传入。Pi 或 Pi Durable 适配器（例如基于 `@anthropic-ai/sandbox-runtime`）不在本次范围内。

内置 Agent 的 overlay 放在 `src/main/ai/agents/builtin/`，与 `builtinAgentGuardRules.ts` 放在一起。本 Spec 只提供一个：空的 Support overlay，也就是 Support 直接使用基础策略。Assistant 的 overlay（预置域名）和用户 Agent 的 overlay（存放在 Agent 配置中，配有 UI 开关和三个档位）留给后续的 Spec。

对于 macOS 上的 Support，Claude Code 适配器除文件系统策略外，还设置以下选项：

```json
{
  "enabled": true,
  "failIfUnavailable": true,
  "autoAllowBashIfSandboxed": true,
  "allowUnsandboxedCommands": true,
  "network": { "strictAllowlist": true, "allowedDomains": [] }
}
```

Support 保留 `settingSources: []`，排除用户和工作区设置。对于 CLI 仍会应用的设置（包括受管设置），适配器必须保证它们不会放宽网络或文件系统访问，也不会把命令排除在沙箱之外。验证方式是用与 query 相同的选项调用 SDK 的 `resolveSettings()`，把生效设置中的 `sandbox` 配置，以及会并入沙箱白名单的 `WebFetch(domain:…)` 允许规则，与解析出的策略逐项比对。`resolveSettings()` 标记为 `@alpha`，且不会执行管理员配置的 `policyHelper`，因此依赖 `policyHelper` 的部署视为无法验证。两条审批守卫都以实际执行调用的连接上已验证的沙箱状态为准。连接复用时，这一状态仍须有效。如果运行时无法验证，就暂不启用沙箱，沿用现有的 shell 审批行为。启用沙箱后，检查失败会终止本轮，Full Access 也不例外。

沙箱生效后，需要联网的 Bash 命令（`gh`、`lark-cli`、`curl`）会在沙箱内失败，工具结果会写明被拒绝的主机。模型要继续，必须带上 `dangerouslyDisableSandbox: true` 显式申请出沙箱。基础守卫在 Full Access 以外的交互式轮次中逐次审批这类请求。审批理由会告诉用户，这条命令将在沙箱外运行并可以联网。

在无界面（headless）轮次或没有审批响应方时，`support-bash` 在所有权限模式下继续拒绝 Bash 和 PowerShell。交互式轮次中，只有受已生效沙箱约束的 Bash 调用可以跳过逐次审批。没有沙箱时（包括 Linux 和 Windows），Full Access 以外仍沿用现有的逐次 shell 审批。Full Access 通过 `skipInteractiveEffect` 跳过交互式 shell 和出沙箱审批。`builtin-destructive` 和 JSON 命令策略保持不变。

网络限制只适用于沙箱内的 Bash。其他工具（包括 Cherry 的 MCP 网页搜索和抓取工具）沿用各自的访问与审批策略。

探针证据（SDK 0.3.311，原生 CLI 2.1.311，macOS 26，用脚本化的 mock 模型驱动）：

- 在 `acceptEdits` 模式下，`ls`/`uname` 命令直接执行，没有调用 `canUseTool`。
- 沙箱里的 `curl` 和 Python `urllib` 都失败，返回 `<sandbox_violations> deny network-outbound … (host is not on the allow list)`，没有弹出审批。
- 带 `dangerouslyDisableSandbox: true` 的重试先到达 PreToolUse，`tool_input` 里带着这个标记，随后作为普通 Bash 审批到达 `canUseTool`。在 `bypassPermissions` 下，PreToolUse 返回 `ask` 同样会到达 `canUseTool`。
- 不开严格模式时，`bypassPermissions` 会静默放行白名单外的主机；开了严格模式后，该主机被拒绝。
- 写入 `$HOME` 返回 EPERM；写入 cwd、附加目录和 `$TMPDIR` 都成功。

## 已考虑的替代方案

- 每个 Agent 各写一份完整的沙箱配置，不共用基础策略：不变式会被复制到每个 Agent 里，只要有一个 Agent 漏开严格模式，Full Access 下就会静默放行白名单外的主机。
- 做成插件式的扩展框架，或者现在就实现 Pi 适配器：目前还没有第二个使用方。在 Assistant 或 Pi 运行时真正需要沙箱之前，基础策略、合并函数和一个适配器已经够用。
- 继续对 Support 的每次 Bash 调用都要求审批：安全，但用户想减少的正是这些弹窗。其他产品引入沙箱也正是为了减少弹窗，Cursor 报告 agent 中途停下的次数减少了 40%。
- 严格白名单里放入反馈提交用的主机（`github.com`、飞书）并自动放行沙箱命令：沙箱里的脚本可以不经任何审批向这些主机提交内容，等于重新打开了逐次审批规则堵住的缺口。Claude Code 文档也警告，放行 `github.com` 可能被利用 domain fronting 外传数据；而且 `lark-cli` 会访问哪些主机还没有验证。
- 白名单为空、不开严格模式、按主机弹窗：在 Full Access 下，未列出的主机会被静默放行；而且 `SandboxNetworkAccess` 请求带的 toolUseID 对不上任何 tool part，Cherry 需要为它新做一个审批界面。
- `excludedCommands: ["gh *"]`（Claude Code 文档给出的 Go TLS 失败解决办法）：被排除的 `gh` 会走常规工具权限流程，在沙箱外运行。这与 Bash 命令必须显式申请才能出沙箱的要求冲突。
- 用 `enableWeakerNetworkIsolation` 让 `gh` 能在沙箱内运行：显式申请出沙箱已能满足这个需求，而这个选项会让所有沙箱命令都能访问 `trustd`。
- 为内置会话设置 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`：曾作为独立的第一层在 [#25513](https://github.com/CherryHQ/cherry-studio/pull/25513) 提出，已关闭。它隐藏的变量价值很低：所有 Cherry 管理的模型路线放进 CLI 环境的，都只是内部网关凭据，这个凭据只存在内存中、绑定当前会话、只在 `127.0.0.1` 上可用；外部 CLI 登录路线则不放任何凭据。上游服务商的 Key 存在 Cherry 的数据库里，没有沙箱的 Bash 本来就能读到。清理还会删掉 `CLAUDE_CONFIG_DIR`，而 `npx skills` 正是靠它决定全局安装目录，结果 Assistant 安装的技能会落到用户自己的 `~/.claude`。它还会删掉用户登录 shell 里看起来像凭据的变量；在 Linux 上，它会把 Bash 移进独立的 PID 命名空间。以后某个启用沙箱的 Agent 如果需要隐藏这些变量，可以用 `sandbox.credentials.envVars` deny 只删除它们。
- 现在就给 Assistant 开沙箱：它是通用 Agent，会用到 `npx skills`、安装依赖、访问网页。在它的 overlay 加上预置清单之前，基础策略的空白名单会让它无法工作。
- Linux 和 Windows：需要 bubblewrap/socat，或者以管理员权限运行 `claude sandbox install`，对桌面用户来说都不是零配置。这两个平台沿用现有的 shell 审批行为。
- 像 Claude Cowork 那样把整个 Claude Code 进程放进虚拟机或 `sandbox-runtime`：这样也能覆盖 hooks 和 MCP，但改动大得多，还会带来额外的打包成本。

## 验收标准

- AC1 — 在 macOS 上，处于 Default 或 `acceptEdits` 模式的交互式 Support 会话，可以在沙箱内执行一条符合其他策略的本地 Bash 命令，且不显示审批卡。 (verification: Electron, owner: Support 集成实施者)
- AC2 — 在 macOS 上，沙箱里的 Support Bash 命令无法通过 `curl` 或 Python `urllib` 访问任何网络主机。工具结果写明被拒绝的主机，且不显示网络审批卡。 (verification: 单元测试和 macOS 原生测试, owner: Claude Code 运行时实施者)
- AC3 — 在 macOS 上，带 `dangerouslyDisableSandbox: true` 的 Support Bash 调用在 Default 和 `acceptEdits` 模式下显示现有的 Bash 审批卡，即使同一命令之前批准过也会再次显示。审批理由说明该命令将在沙箱外运行。被拒绝的调用不会执行。 (verification: 单元测试和 Electron, owner: Support 集成实施者)
- AC4 — 在 macOS 上，在任何权限模式下，沙箱里的 Support 命令都无法写入会话工作区、Agent 数据目录和临时目录以外的位置。 (verification: macOS 原生测试, owner: Claude Code 运行时实施者)
- AC5 — Support 在无界面轮次或没有审批响应方时拒绝 Bash 和 PowerShell，Full Access 也不例外。有响应方时，Full Access 跳过出沙箱审批卡，但留在沙箱内的 Bash 调用仍无法联网。 (verification: 单元测试和 macOS 原生测试, owner: Claude Code 运行时实施者)
- AC6 — 在 Linux 和 Windows 上，Support 会话不带沙箱配置。有审批响应方时，平台提供的 Bash 和 PowerShell 调用在 Full Access 以外仍需逐次审批。 (verification: 单元测试, owner: Claude Code 运行时实施者)
- AC7 — 没有 overlay 的 Agent（Assistant、Doctor 和用户自建 Agent）不带沙箱配置。 (verification: 单元测试, owner: Claude Code 运行时实施者)
- AC8 — 在 macOS 上，Support 能在 `acceptEdits` 模式下用真实模型完整提交一次反馈。沙箱拒绝联网后，模型显式申请出沙箱，且不会原样重复同一条沙箱命令。每次需要联网的 Bash 调用只需批准一次。 (verification: Electron, owner: Support 集成实施者)
- AC9 — 如果 overlay 试图关闭严格模式、让离开沙箱无需审批、开启 Apple Events、Unix socket 或嵌套用户命名空间，或者让 `$HOME` 根目录或 shell 启动文件可写，合并后的策略仍保留基础策略的值。 (verification: 单元测试, owner: 沙箱策略实施者)
- AC10 — overlay 追加的域名和可写路径会与基础策略的值一起出现在 Claude Code 沙箱配置中。任何一方拒绝的域名仍然被拒绝。 (verification: 单元测试, owner: 沙箱策略实施者)
- AC11 — 在 macOS 上为 Support 启用沙箱后，如果启动失败，或无法验证生效配置会强制执行解析后的策略，本轮会在执行任何 shell 命令前显示错误。Full Access 和复用连接也必须满足此条件。沙箱未启用时，Support 在 Full Access 以外沿用现有的逐次 shell 审批。 (verification: 单元测试、macOS 原生测试和 Electron, owner: Claude Code 运行时实施者)

## 风险

- 模型行为：模型可能原样重试被拒绝的命令。Cursor 报告过这种失败模式，并通过修改工具结果和工具描述解决。沙箱上线前，AC8 必须用真实模型跑通；如果跑不通，就保持沙箱关闭，不额外加重试机制。
- 沙箱内的 Bash 仍可读取 `~/.ssh` 等文件，并将其复制到工作区。Bash 要联网必须出沙箱。其他工具和模型请求不受这一网络边界约束。限制文件读取不在本次范围内。
- 有审批响应方的交互式轮次中，Full Access 允许直接出沙箱，不显示审批卡。无界面或没有响应方时的拒绝规则仍然适用，沙箱启动失败仍会终止轮次。
- 合并函数如果有 bug，会在毫无提示的情况下放宽沙箱。AC9 和 AC10 直接测试合并函数，以后新增的 overlay 也在这里补充各自的用例。
- Seatbelt（`sandbox-exec`）已被 Apple 标记为弃用，macOS 升级也曾经弄坏过其他产品的沙箱配置。基础策略规定沙箱无法启动时本轮失败，问题会明确暴露出来。darwin native test 能发现 SDK 升级带来的行为变化。
- Pi 和 Pi Durable 不使用 Claude Agent SDK，沙箱覆盖不到它们。与运行时无关的策略让以后的 Pi 适配器可以复用基础策略和 overlay；在适配器出现之前，内置 Agent 一旦改用 Pi 运行时就会失去沙箱。
