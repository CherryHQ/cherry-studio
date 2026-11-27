# Agent Note: 让 Assistant 反馈提交守卫改由命令解析器判断

Status: implemented

[English](2026-11-26-assistant-feedback-submission-guard.md) | 中文

## Problem

内置 Assistant 可以通过 `gh issue create` 或 `lark-cli base +form-submit`，以用户身份提交 Cherry Studio 反馈。`assistant-feedback` 守卫会对每次调用请求实时审批，并在 headless 轮次拒绝提交。它用两个正则匹配原始命令文本，而且只作用于 Claude Code 的 `Bash` 工具。同一条命令换一种写法就能跳过审批，例如：

- 选项写在子命令前（`gh -R repo issue create`）
- 别名 `gh issue new`
- `env`、`sudo`、`nohup`、`xargs` 等包装命令
- 嵌套 shell：`bash -c`、`$(…)`、循环和 heredoc
- 动态子命令
- 用 `gh api` 创建 issue
- 通过 `-c` 或 `-e` 交给解释器执行的代码
- Claude Code 的 `PowerShell` 工具

Support 角色的 `support-bash` 规则会对每次 shell 调用请求审批，但同样只匹配 `Bash`。

## Decision

守卫向共享命令策略查询一次调用实际执行哪些命令，再根据这些命令自行判断。`commandPolicy` barrel 导出 `resolveInvocationCommands`，返回所有解析出的命令，以及是否有部分未能解析。该导出不做策略判定。[守卫](../../../../src/main/ai/agents/builtin/assistantCommandSafety.ts) · [解析器](../../../../src/main/ai/toolApproval/commandPolicy/policyEvaluator.ts)

解析出的命令满足以下任一条件即视为提交：

- 可执行文件是 `gh` 或 `lark-cli`，且动作词出现在组名之后。由于选项的参数个数未知，两者之间的词只能是某个选项的值。动态词视为匹配任意内容。
- 是 `gh api`，使用写方法（显式指定，或由字段参数、`--input` 推断），目标是 `repos/*/*/issues` 端点、动态端点，或内容无法检查的 `graphql` mutation。
- 是非 shell 解释器，其内联代码中出现 `gh` 或 `lark-cli`。

可执行文件名比较时忽略大小写并去掉 `.exe`，因为 Windows 上的 Git Bash，以及以 `Bash` 身份进入守卫的 Pi PowerShell，都按这种方式解析。未解析的部分如果在原始文本中出现提交工具名，按需要审批处理；检查本身抛出异常时也需要审批。

守卫根据 Claude Code 的 `Bash` 和 `PowerShell` 两个工具名确定方言，`support-bash` 对两者都请求审批。[规则](../../../../src/main/ai/agents/builtin/builtinAgentGuardRules.ts)

## Alternatives considered

- 扩展正则：每种包装命令、选项顺序和嵌套形式都要再加一个模式。命令策略已经能在两种方言下解析这些形式。
- 像 Support 一样对 Assistant 的每次 shell 调用都请求审批：能覆盖所有形式，但 Assistant 经常执行 shell 命令，会频繁弹出审批。
- 像 Claude Code 和 Codex 那样使用带网络白名单的系统沙箱：它也能覆盖脚本文件，但按域名而不是按调用放行，无法替代对每次提交的审批。暂未采用。
- 把检测移入 JSON 命令策略：该策略只在 `auto` 模式下请求审批，而这个守卫需要在所有交互模式下请求审批，并在 headless 轮次拒绝。

## Consequences

- 该守卫仍是可用性守卫，不是安全边界。写进脚本文件的提交（`python3 submit.py`）或通过 `lark-cli api` 的提交检测不到。
- 失败即审批的路径会对一些并非提交的命令请求审批，例如打印 `gh` 一词的内联 Python，或在参数个数已知时本可排除的 `gh issue --flag value create` 形式。
- Assistant 守卫依赖命令策略的解析器。解析器对某种写法的解析方式变化时，这个守卫也会随之变化；共享测试同时覆盖两者。

## Verification

- Regression — `npx vitest run src/main/ai/agents/builtin/__tests__/assistantCommandSafety.test.ts`：覆盖上述提交写法，包括大写 `GH`/`GH.EXE`、PowerShell、`gh api` 和解释器内联代码。每个新用例在修复前都失败。`gh issue list --label create`、GET 方式的 `gh api`、issue 评论和只读 GraphQL 等读取操作仍然放行。
- Regression — `npx vitest run src/main/ai/runtime/claudeCode/__tests__/guardRules.test.ts`：`assistant-feedback` 对 `PowerShell` 工具请求审批；`support-bash` 对交互式 `PowerShell` 调用请求审批、对 headless 调用拒绝。两个 PowerShell 用例在规则修改前都失败。
- Regression — `npx vitest run src/main/ai/runtime/pi/piApprovalFacts.test.ts src/main/ai/toolApproval/commandPolicy/__tests__/policyEvaluator.test.ts`：Pi 调用方和共享求值器的行为不变。
