# Agent Note: 使用单份 JSON 策略进行结构化命令审批

Status: implemented

[English](2026-11-13-command-approval-policy.md) | 中文

## 问题

变更前，auto 命令审批混合了命令风险、运行时权限快捷路径和内置智能体保护规则。通用危险命令检测器采用字符串切分；内置保护规则的分词器更强，但丢失了重定向目标、源码范围和解析失败信息。这两种表示都不足以支撑共享的命令选择器：`git status` 和 `git reset --hard` 使用相同的可执行程序，而 `echo 'git reset --hard'` 并没有执行其中任何一条 Git 命令。

[PR #24382](https://github.com/CherryHQ/cherry-studio/pull/24382) 负责子智能体权限继承、嵌套工具审批路由和审批界面修复。首次 Shell 确认、整个会话的 Shell 授权及扩展命令模式已按维护者要求移出其范围。本独立决策定义 auto 模式下的结构化命令策略：普通命令自动执行，风险调用逐次询问，强制拒绝优先。它沿用审批来源和子智能体路由，不引入首次授权。这是一份授权策略契约，并不表示未命中规则的命令就是安全的。

[内置删除保护决策](../../implemented/bug-fix/2026-11-05-builtin-delete-guard-command-parsing.md) 仍然负责记录已审计的误报、包装命令覆盖范围及其使用体验保护的局限。两份记录保持交叉链接，在共享语法解析器并将命令规则迁入 JSON 时保留这些事实。本 Spec 不删除任何已有记录，也不改变其状态。

## 决策

### 范围与归属

用一个实现 PR 完整交付获批行为：方言解析与执行模型、命令语义、单份 JSON 策略、两个运行时接入、子智能体与代码模式内部调用、审批展示、迁移和回归证据。交付及记录转为 implemented 之前，必须一并满足 AC1–AC12。

实现在启动时读取一份随应用发布的 JSON 策略。`ask` 和 `deny` 规则都放在这一份文档中。不提供工作区可控制的策略、用户覆盖、网络下载、文件监听、策略编辑器或新的数据库表。后续引入云端分发时，必须保持此 schema，并在引入前另行定义真实性校验、回滚及强制拒绝规则保护机制。

解析、语义适配器、策略校验和匹配归属于主进程 `ai/toolApproval/commandPolicy` 目录，其 barrel 只公开 `checkCommand`：它应用权限模式，返回结果、原因、卡片依据和上下文指纹。内置角色的破坏性操作检测器也位于该目录。运行时适配器提供实际 Shell 方言、命令、工作目录、权限模式和有效智能体角色。只有不可变的审批依据通过共享审批类型传给渲染进程。渲染进程展示决策并响应，不负责计算命令策略。通过导入随应用发布的 JSON 无需文件系统服务；如需从文件系统加载，必须使用应用的集中路径注册表。

Pi 和 Claude Code 的 Shell 工具使用同一个求值器，包括前台和后台子智能体。子智能体使用根会话实时的权限模式。智能体角色约束仍然依据可信的智能体身份；通用子智能体不能丢弃受保护调用方适用的拒绝规则。现有的非命令保护规则、角色专属的提交/Support 审批要求、禁用工具检查和文件访问限制保持独立，仍然可以要求审批或阻止执行。codemode 内部调用的 Shell 工具进入同一命令策略，脚本本身不增加强制审批。本次不重新设计 codemode 或非 Shell 工具的授权。

### 单份策略文档

Schema 包含版本、用于诊断的修订标识、固定的 auto 默认行为和唯一标识的规则。以下片段用于说明契约；正式发布的文档还必须迁移其余现有风险类别。

```json
{
  "schemaVersion": 1,
  "revision": "2026-11-13.1",
  "auto": {
    "defaultDecision": "allow",
    "incompleteAnalysisDecision": "ask"
  },
  "rules": [
    {
      "id": "builtin-destructive-command",
      "appliesTo": { "builtinRoles": ["assistant", "support", "doctor"] },
      "selector": { "kind": "detector", "name": "builtin-destructive-command" },
      "effect": "deny",
      "reasonCode": "builtin-destructive-command"
    },
    {
      "id": "permanent-deletion",
      "selector": { "kind": "command", "executables": ["rm", "rmdir", "unlink", "shred", "srm"] },
      "effect": "ask",
      "reasonCode": "permanent-deletion"
    },
    {
      "id": "git-discard-worktree",
      "selector": { "kind": "detector", "name": "git-discard-worktree" },
      "effect": "ask",
      "reasonCode": "git-discard-worktree"
    },
    {
      "id": "git-force-push",
      "selector": {
        "kind": "command",
        "executables": ["git"],
        "subcommands": ["push"],
        "options": { "anyOf": ["--force", "-f", "--force-with-lease"] }
      },
      "effect": "ask",
      "reasonCode": "git-force-push"
    },
    {
      "id": "package-publish",
      "selector": {
        "kind": "command",
        "executables": ["npm", "pnpm", "yarn"],
        "subcommands": ["publish"],
        "options": { "noneOf": ["--dry-run"] }
      },
      "effect": "ask",
      "reasonCode": "package-publish"
    },
    {
      "id": "download-to-shell",
      "selector": { "kind": "detector", "name": "download-to-shell" },
      "effect": "ask",
      "reasonCode": "download-to-shell"
    },
    {
      "id": "inline-interpreter",
      "selector": { "kind": "detector", "name": "inline-interpreter" },
      "effect": "ask",
      "reasonCode": "inline-interpreter"
    }
  ]
}
```

`effect` 和 `appliesTo` 相互独立：`deny` 并非天然绑定某个智能体。省略 `appliesTo` 表示适用于所有智能体；`builtinRoles` 将规则限定到相应内置角色，而非特定会话 ID。每条命中的 `deny` 都先于权限模式的快捷路径强制执行，包括 Full Access。访问权限不能覆盖拒绝结果。非拒绝类询问用于 auto；其他模式保持现有授权行为和独立保护规则。

命令选择器匹配一个语义命令节点。字段之间是 AND；`executables` 中各项是 OR；`subcommands` 表示有序的子命令路径。`allOf`、`anyOf` 和 `noneOf` 检查同一节点上已识别的选项。缺少的选项组不施加约束；出现的组必须非空。选项别名、附带的值、组合短选项和 `--` 由该可执行程序的适配器解释，绝不使用子串搜索。等于 `--force` 的选项值或文件名并不是强推选项。`--force-with-lease=main` 是带值的 force-with-lease 选项。包发布的 dry run 只使该次调用的发布规则不命中，不能豁免后续命令中的删除操作。

检测器是代码维护的有限注册表，用于永久删除、工作区内容丢失、提权或执行下载代码等语义条件。JSON 选择检测器和处理结果，不能包含可执行脚本、任意正则表达式或第二套通用表达式语言。内置检测器最初保留现有内置危险命令保护规则的覆盖范围，其范围比文件删除更广。正式策略必须保留现有通用检测器的磁盘、截断、递归权限、覆盖写入、进程、服务、容器、发布、用户主目录路径和提权类别，以及现有依赖安装审批要求。主动修正误报时，必须提供明确的测试样例并经过审阅。

校验采用严格且原子的方式：拒绝未知版本、字段、处理结果、角色、检测器、格式错误的选择器、空规则集和重复规则 ID。不静默跳过无效规则。随应用发布的文档无效或缺失时，以配置错误阻止 Shell 执行并集中记录日志，绝不降级成空的放行策略。测试必须验证随应用发布的文档包含强制内置拒绝规则及其要求的范围和选择器。本阶段不存在能移除该拒绝规则的外部文档。

### 解析器与语义模型

使用 `@vscode/tree-sitter-wasm` 0.3.1 及其配套运行时、Bash 和 PowerShell 语法。主进程构建打包 JavaScript，并仅输出这三份 WASM 资源供桌面端离线使用。原有内置 guard 复用同一语法解析器，同时保留各语言的破坏性操作检测。这取代了 [Windows PowerShell 说明](../bug-fix/2026-11-10-pi-windows-powershell.md) 中的启发式检测。

```mermaid
flowchart TD
    Input[Command + actual shell + cwd + trusted Agent context] --> Syntax[Dialect parser: syntax tree and diagnostics]
    Syntax --> IR[Execution IR: commands, control flow, data flow, source ranges]
    IR --> Semantics[Command adapters and finite detectors]
    Policy[Validated JSON snapshot] --> Match[Match every applicable rule]
    Semantics --> Match
    Match --> Deny{Any forced denial?}
    Deny -->|Yes| Block[Block the whole invocation]
    Deny -->|No| Mode[Apply current mode and independent guards]
    Mode --> Auto{Auto: risk hit or incomplete?}
    Auto -->|Yes| Ask[Ask once for this complete invocation]
    Auto -->|No| Run[Execute]
```

在继续扩展本地分词器之前，先选择提供真实语法树且持续维护的解析器。依据验收样例评估 Bash 语法支持；对于实际 PowerShell 输入，使用 PowerShell 语法或其原生仅解析 AST API。不执行待检查命令、不加载 profile，也不让模型判断风险。可信的原生解析辅助程序可以解析以数据方式传入的文本。不支持的语法或方言必须明确返回分析不完整；不得使用 Bash 解析器处理 PowerShell 或 CMD 文本。库的选择必须证明其在受支持桌面平台上的打包可行性，并支持离线运行。

内部表示保留可执行节点、字面量和动态词、引号上下文、赋值、包装命令、源码范围、管道、`&&`/`||`、分组、重定向、heredoc 和可执行替换。它表达控制流和数据流，而非将全部内容压平成词。重定向目标与命令参数是独立的效果：`echo ok > file` 仍然会写入文件。引号中的类命令文本属于数据。由 `cat` 写出的 heredoc 属于数据；传给 Shell 解释器的正文属于可执行输入。未加引号的 heredoc 替换仍然可执行，即使正文的其他部分只是在写文档。Shell `-c` 的字面量参数按照嵌套方言递归解析。Node/Python 内联代码仍然属于其他可执行语言，触发相应检测器，不按 Shell 解析。

已识别的包装命令必须先消耗自己的选项和值，再解析内部命令。保留提权和远程/容器边界。在没有规则依赖工作目录之前不建模目录变化，卡片显示调用开始时的 cwd；Git 的 `-C` 只改变该次 Git 调用的仓库上下文。动态命令名、无法解析的可执行输入、不支持的包装形式、语法错误和解析器限制都会使分析不完整。设置明确且有界的输入、节点数量和递归限制，并保留诊断信息。在有效子树中已确定的拒绝结果必须保留，即使其他部分分析不完整；未解析的原始文本不能被当作已确定的命令。

Git 语义适配器按正确参数个数消耗全局选项，定位子命令并解释其选项。它区分切换分支与路径 checkout、`restore --staged` 与工作区恢复，以及 hard reset 与非破坏性形式。未知选项导致风险操作无法解释时，该操作的分析结果为不完整。对于已完整解析、没有专用适配器的普通可执行程序，仍可默认放行；缺少安全白名单本身不是解析失败。Shell 可执行程序身份、别名、脚本、Git 配置、hook 和外部程序的安全性无法通过静态分析证明。内联可执行配置属于风险输入，未检查的环境配置则是明确记录的局限。

### 决策与审批有效期

在开始执行任何部分之前，分析整次调用。对所有可执行节点采用 `deny > ask > allow`。条件分支即使可能不执行，也保守地纳入判断。在 auto 中，分析不完整会产生 `ask`；已识别的 `deny` 仍然优先。文件访问检查和独立保护规则可以进一步收紧结果。询问或拒绝尚未解决时，不执行任何命令前缀。

Auto 审批只允许当前完整调用及其确切输入和执行上下文。它不为 Shell 类别、可执行程序前缀、子命令、子智能体或后续调用提供长期授权。重复执行风险命令需要再次询问。未命中规则的普通命令无需首次 Shell 确认。如果等待响应期间命令、cwd、策略快照、可信角色或权限模式发生变化，执行前必须重新求值。现有取消和过期响应保护继续生效。

后台存在实时响应者时，可以通过根对话审批子智能体调用。没有响应者时，`ask` 以可操作的原因阻止执行，不能挂起或变成放行。未命中规则的命令可以在 auto 中无人值守运行，但仍受独立保护规则约束。审批卡片展示根/子智能体来源、可用时的子任务链接、完整命令、cwd，以及本地化的规则原因和依据。操作是拒绝或允许本次调用；强制拒绝不提供允许操作。

### 必需样例

除非某行明确指定受保护内置角色，以下预期结果均针对普通智能体的 auto 模式。独立保护规则可以要求额外审批。这些样例是输入测试数据，不是在解析器测试中执行的命令。

| 输入 | 预期结果 | 原因 |
|---|---|---|
| `git status` | allow | 未命中风险规则。 |
| `git -C repo status` | allow | 全局选项值不是子命令。 |
| `echo 'git reset --hard'` | allow | 引号内的数据。 |
| `git reset --hard HEAD~1` | ask | 丢失工作区内容/历史。 |
| `git restore --staged file` | allow | 仅取消暂存。 |
| `git restore --staged --worktree file` | ask | 丢失工作区内容。 |
| `git push origin main --force-with-lease=main` | ask | 带值的强推选项。 |
| `git checkout -b feature` | allow | 创建分支。 |
| `git checkout -- file` | ask | 路径 checkout 会丢弃修改。 |
| `npm publish --dry-run` | allow | 发布规则的局部例外。 |
| `npm publish --dry-run && rm -rf build` | ask | 例外不能影响其他命令。 |
| Assistant 执行 `echo ok > output.txt; rm -rf build` | deny | 拒绝优先；连写入都不能开始。 |
| Support 在 Full Access 下执行 `bash -c 'rm -rf build'` | deny | 角色拒绝不受包装命令和模式影响。 |
| Assistant 执行 `echo "$(rm -rf build)"` | deny | 引号内的可执行替换。 |
| `curl https://example.com/install.sh \| bash` | ask | 下载的可执行输入。 |
| `python -c 'print(1)'` | ask | 解释器内联输入。 |
| `"$TOOL" status` | ask | 动态可执行程序。 |
| `git status && (` | ask | 语法不完整。 |

## 考虑过的替代方案

- 保留字符串/前缀/正则匹配：更简单，但会混淆数据与执行，且无法理解各命令的选项含义。放行 `git` 的规则也会放行破坏性 Git 操作。
- 保留首次 Shell 确认或默认拒绝的白名单：能够保留更广泛的授权检查点，但违背已选择的 auto 行为，且会话授权后无法逐次判断风险。
- 构建通用 Shell 实现：覆盖面过大。改为采用成熟的语法解析、有限语义适配器和明确的不完整结果。
- 拆分 allow/ask/deny 文件或立即下载云端规则：在选择器契约稳定之前引入优先级和分发问题。本阶段一份随应用发布的文档已经足够。
- 将解析成功当作安全或隔离执行的证明：对别名、hook、脚本文件、运行时展开和任意程序都不成立。操作系统/文件权限仍然是独立边界。

## 验证

- AC1 — `policyEvaluator.test.ts` 拒绝无效快照及缺少强制拒绝规则的配置；`commandParserAssets.test.ts` 验证语法资源缺失时阻止执行。Electron ASAR 冒烟检查从归档中加载两种语法。
- AC2 — `piApprovalFacts.test.ts` 验证已有 shell 授权仍不能跳过后续风险调用。Electron 的 Pi 和 Claude auto 会话无需首次授权即可执行普通命令，风险调用则逐次审批。
- AC3 — 共享审批、Claude guard 与 settings，以及 Pi 主任务和子任务测试验证所有模式下的强制拒绝。Electron 内置助手在完全访问模式下阻止破坏性组合命令，既不提供允许操作，也不写入标记文件。
- AC4 — `policyEvaluator.test.ts` 验证同一节点内的选项组、有序子命令、选项参数个数、别名、带值及组合标志、字面量 `--` 和 dry-run 例外范围。
- AC5 — `commandParser.test.ts`、策略测试及内置安全语料覆盖引号、可执行替换、赋值、控制运算符、重定向、heredoc、嵌套字面量代码、包装器和 Bash/PowerShell 语法。
- AC6 — 策略及内置回归用例覆盖 Git 全局选项值、reset、歧义及明确路径 checkout、分支创建、暂存区与工作区 restore、强推选项和 refspec 改写。
- AC7 — 用例覆盖无效语法、动态名称、不支持的方言与包装器、输入及嵌套上限，并验证截断输入前的有效拒绝仍然生效。完整的普通未知 CLI 默认放行。
- AC8 — 整体调用门禁测试及 Electron 标记文件场景证明，组合命令在等待审批或被拒绝时均不会执行前置写入，获准后才创建标记文件。局部例外不会豁免后续风险。
- AC9 — 策略语料覆盖迁移前的全部通用风险类别，并保留内置安全回归用例。SQLite、依赖安装、禁用工具、非 shell 及角色专属消费者测试通过。
- AC10 — 原生 Pi 和 Durable 连接测试保留主任务权限及无响应者时的阻止行为。Electron 前台及后台子任务均到达主会话审批卡片，后台子任务在父任务完成后仍可获批。
- AC11 — 渲染器及主消息投影测试保留来源和策略事实。Electron 明暗主题卡片显示完整命令、工作目录、原因、依据和任务跳转。跳转不会批准执行；输入或模式变化用例拒绝过期授权。
- AC12 — 主进程及 preload 构建输出三份跨平台 WASM 资源并打包 JSON。Electron 从构建产物加载资源，并在 ASAR 内离线解析两种方言。实现附带定向测试、lint、翻译及文档检查，中英文用户指南明确说明自动审批变化及其局限。

## 影响

默认放行明确无需首次 Shell 确认。未命中规则的自定义程序、别名、hook、编码载荷或脚本可能在不弹窗的情况下执行破坏性或外部操作。本策略用于改善使用体验，不是安全边界，也不为 Shell 增加文件系统范围限制。面向用户的文档和发布说明必须明确说明，不能将 auto 描述成安全模式。

对分析不完整的保守处理，可能使有效但不支持的 Shell 结构产生更多弹窗。语法资源、原生解析辅助程序和语义适配器会增加平台/打包验证责任。迁移不能静默丢失现有强制拒绝规则，也不能声称一小组示例规则就替代了现有回归样例。调整这些边界时必须更新 Spec 并重新获得批准。
