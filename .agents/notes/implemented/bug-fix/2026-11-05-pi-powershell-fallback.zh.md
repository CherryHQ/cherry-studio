# Agent Note: 未发现 Git Bash 时，Windows 上的 Pi 会话回退到 PowerShell

Status: implemented

[English](2026-11-05-pi-powershell-fallback.md) | 中文

## Problem

在没有安装 Git for Windows 的 Windows 主机上，work 模式的回合会失败，或者在用户不知情的情况下跑进 WSL。Cherry 内置的是 MinGit（`scripts/download-binaries.js`），那是只提供 `git` 的发行版，**没有 `bash.exe`**。pi 的 shell 解析（`src/main/utils/commandResolver.ts` 的 `findGitBash` / `autoDiscoverGitBash`）只看 `CLAUDE_CODE_GIT_BASH_PATH`、由系统 `git.exe` 推导出的 `bash.exe`（`git.exe` 来自 PATH，或 `Program Files`、`Program Files (x86)`、`%LOCALAPPDATA%\Programs` 之下），以及 `%ProgramFiles%\Git\bin\bash.exe`；内置目录只被追加到子进程 PATH，发现逻辑从不读取它。于是发现结果为空，pi 退到 PATH 上的 `bash.exe`——通常是 `C:\Windows\System32\bash.exe`，即 WSL 的 shim——回合要么在错误的环境里执行，要么直接报 "No bash shell found"。

## Decision

`src/main/ai/runtime/pi/piShell.ts` 的 `resolvePiShellSelection()` 是唯一的决策点。非 Windows 主机、合法的显式 `shellPath`、以及发现到的任意 Git Bash，仍然保留 `bash` 工具与对应路径。只有在 Windows 上且发现结果为空时，会话改为暴露 pi 原生的 `powershell` 工具：不挂载托管 bash 工具，也不设置 `shellPath` 与 `shellCommandPrefix`——这正是让 pi 不去碰 WSL shim 的关键。两个 Pi 运行时共用同一份选择（`PiRuntimeConnection` 与 `piDurable/durableDesktop`，后者安装 `tools.createPowerShellTool()`），`listAvailableTools` 只报告该主机实际会暴露的工具。

审批同等覆盖随同交付：共享 facts 路径对 `bash` 与 `powershell` 都读取 `command`，`detectDestructiveCommand` 与 `detectGlobalInstall` 增加 PowerShell 方言，仅供 bash 使用的 `rtkRewrite` 绝不作用于 PowerShell 命令。显式配置的 `shellPath` 缺失或不是 `bash.exe` 时，启动依旧以原来的错误失败——回退不能吞掉它，因为静默切换执行环境已在 #20322 与 #20304 被否决。

## Alternatives considered

- 为 Windows 内置完整的 Git Bash 或 PortableGit 能保证有 shell，但会引入 GPLv3 分发义务与显著的安装体积，负责人已否决。
- 只往 MinGit 目录里补一个 `bash.exe`，许可证问题相同，而对“这个 shell 环境完整且经过验证”的保证弱得多。
- 回退到发现逻辑或 PATH 上任意 `bash.exe`，会复现 #20304 报告的静默进入 WSL。
- 读取用户 `~/.pi/agent/settings.json` 的 `defaultTools` 让用户自行选择 PowerShell，但那份清单由 Cherry 通过内存 settings manager 控制，设置文件不是受支持的入口。
- 让编辑对话框的工具目录感知平台需要新增渲染层到主进程的 IPC 通道，本次刻意不引入。

## Consequences

在没有 Git for Windows 的 Windows 主机上，work 模式的回合现在运行在 Windows PowerShell 中（可用时优先 PowerShell 7），而不是 WSL 或报错。agent 编辑对话框仍然只有一个 shell 开关，因为这是同一项能力：禁用任意一个 shell 名称就同时禁用两者，实际跑哪一个由主进程决定、不在对话框里体现。在那些主机上，假定 bash 语义的 prompt 与 skill 需要 PowerShell 等价写法。装有 Git Bash 的主机不受影响。

## Verification

- Regression — 在 base 实现上的 RED：`piShellSelection.test.ts`、`piApprovalFacts.test.ts`、`destructiveCommand.test.ts`、`dependencyGuard.test.ts` 共 36 failed / 197 passed；改回修复版后同一组文件全部通过。
- Regression — `vitest --project main`：`piShellSelection`、`piApprovalFacts`、`PiRuntimeDriver`、`PiDurableRuntimeConnection`、`PiRuntimeConnection`、`PiRuntimeConnection.sdkContract`、`destructiveCommand`、`dependencyGuard`、`userDataSqliteGuard` — 0 failed。
- Regression — `vitest packages/agent-behavior/tests/core/approval/approval.test.ts`：`auto` 模式下破坏性 PowerShell 需要审批、良性 PowerShell 不需要 — 0 failed。
- Regression — `vitest --project renderer`：`toolResponse.test.ts` — 0 failed。
- Regression — `tsc --noEmit`（`tsconfig.node.json` 与 `tsconfig.web.json`）— exit 0。
- Regression — 改动文件的 ESLint、Oxlint `--deny-warnings`、Oxfmt `--check` — exit 0；`scripts/i18n-check.ts` — 98,786 条翻译。
- Not verified — 没有在真实 Windows 主机上执行 PowerShell；回退通过注入的 selection 与打桩的 durable 运行时验证。
