# Agent Note: Claude Code 的 acceptEdits 把 Bash 审批交给 SDK

Status: implemented

[English](2026-11-16-claude-accept-edits-bash-approval.md) | 中文

## 问题

在 `acceptEdits` 模式下，Claude Code 的 `canUseTool` 判定会自动放行第一个词是 `mkdir`、`touch`、`mv` 或 `cp` 的任何 Bash 调用。SDK 只有在自身规则判定需要用户决定时才调用 `canUseTool`，所以这个检查把 SDK 升级上来的确认变成了静默放行：`mkdir x && rm -rf ~` 不弹确认就执行。Pi runtime 的 `acceptEdits` 规则只自动放行编辑类工具，所以它的 shell 调用总会弹出确认。

## 决策

Cherry 的工具策略在 `acceptEdits` 下不预先放行 Bash。该模式下文件系统命令的自动放行由 SDK 负责：它在调用回调前解析复合命令，把路径限制在工作目录和附加目录内，并检查符号链接和受保护路径。到达 `canUseTool` 的 Bash 调用一律走审批。策略快照的 `resolve()` 不接收工具输入，因此任何审批决定都不依赖命令文本。

## 考虑过的替代方案

- 按 `&&`、`;`、`|` 拆分命令并逐段检查，等于重写一遍 SDK 的解析器，而且路径、符号链接和命令替换的处理更弱。
- 改用破坏性命令检测仍会自动放行列表之外的有害写法；那个检测只是可用性提示，不是安全边界。

## 影响

SDK 在 `acceptEdits` 下自动放行的命令不会到达回调，仍然无需确认直接执行。SDK 升级上来的命令现在一律弹出确认；没有响应方时沿用现有的无人值守拒绝。

## 验证

- Regression — `src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts`：在 `acceptEdits` 下使用真实策略快照，`mkdir x && rm -rf ~` 会等待审批而不是直接放行；该测试在按首词放行的判定上失败。
- Regression — 本地探针通过 native fixture 以 `acceptEdits` 驱动 SDK 0.3.311 CLI：`mkdir sub` 执行时未调用 `canUseTool`，`mkdir y && rm -rf ../outside` 调用了它，拒绝后外部目录保持完好。
