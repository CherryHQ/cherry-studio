# Agent Note：允许将用户自定义的本地可执行文件用作 Code CLI 运行时

Status: proposed

[English](2026-11-17-custom-code-cli-executable.md) | 中文

## Problem

Code CLI 运行时是封闭集合。`src/shared/types/codeCli.ts` 中的 `CodeCli` 枚举内置工具，`src/shared/data/presets/codeCliTools.ts` 中的 `CODE_CLI_TOOL_PRESETS` 硬编码每个可执行文件及其安装方式，而 `CodeCliService.requirePreset`（`src/main/services/codeCli/CodeCliService.ts:146-148`）会拒绝预设映射之外的任何可执行文件。用户已有的本地包装运行时（例如 `oh-my-pi`）无法被选用，而把每个包装器都加为内置预设并不可扩展（issue #19966）。

## Proposal

允许 Agent 将用户注册的本地可执行文件用作其 Code CLI 运行时。注册信息按 Agent 存储在 `agentTable`（`src/main/data/db/schemas/agent.ts`）的 `configuration` JSON 列中，不新增数据表，也不改变内置预设：

- `custom_cli.executable`：可执行文件的绝对路径，保存前校验。
- `custom_cli.args`：字符串数组，以参数向量形式传给进程。不经过 shell，因此引号不会被重新解析。

校验在主进程中执行：保存 Agent 时校验一次，每次启动前再校验一次。校验内容包括路径为绝对路径、是普通文件、可执行（POSIX 上为 `X_OK`；Windows 上扩展名必须是操作系统可直接启动的 `.exe` 或 `.com`）。本版本拒绝批处理包装器（`.cmd`、`.bat`）和脚本，因为启动它们需要 `cmd.exe` 解析参数。失败时返回类型化错误码（`missing`、`not_file`、`not_executable`、`unsupported_extension`），渲染进程将其映射为已翻译、可操作的提示。

启动复用 `CodeCliService` 现有的 Code CLI 启动路径：在内置预设查找之后，替换为已校验的绝对路径和已存储的参数向量。内置 `pi` 路径与托管安装行为保持不变；自定义条目从不触发 mise 安装。

Agent 创建与编辑对话框在 Code CLI 运行时选项下新增“自定义可执行文件”，提供路径选择、参数输入框，以及显示解析后绝对路径与校验状态的提示行。提示行只展示路径和校验状态，不展示环境变量。

## Alternatives considered

- 可在多个 Agent 间复用的全局自定义 CLI 条目：可以让多个 Agent 共享一条注册，但需要新的持久化列表、独立生命周期和迁移面。按 Agent 存储则把改动限制在现有 Agent 配置内。
- 单个参数字符串并使用 Windows 感知的引号解析：输入方便，但会重复 shell 引号规则，并让 `C:\Program Files\...` 和 `%` 的处理成为正确性风险。结构化列表可避免二者。
- 接受 `.cmd` 和 `.bat` 包装器：许多 npm 安装的 CLI 在 Windows 上只提供批处理垫片。支持它们需要 `cmd.exe` 参数转义，本提案不处理；它们会以 `unsupported_extension` 提示被拒绝。
- 自动信任 `PATH` 上发现的任何可执行文件：与 issue 的非目标相悖。注册必须是用户的明确操作。
- 在外部终端窗口中启动自定义可执行文件：对 CLI 用户来说熟悉，但 Agent 会失去 Code CLI 运行时在进程内驱动的 stdout/stderr 流、退出状态和会话生命周期。运行时必须持有子进程；终端会将其带出进程外。

## Acceptance criteria

- AC1 — 保存带自定义可执行文件的 Agent 会在其 `configuration` 中存储绝对路径和参数数组；重启 Cherry Studio 后两者保持不变。(verification: unit)
- AC2 — 路径缺失、不是文件、不可执行或为批处理包装器时，保存和启动都被阻止并返回对应错误码，且启动从不派生进程。(verification: unit)
- AC3 — 含空格、引号和反斜杠的参数，以及位于含空格路径下的可执行文件，都以存储的原始字符串传给子进程。(verification: unit)
- AC4 — 配置后移动或删除可执行文件，下一次启动以 `missing` 失败，且不会回退到任何其他二进制。(verification: unit)
- AC5 — 包括 `pi` 在内的内置预设保持原有的可执行文件解析和托管安装行为；现有 `CodeCliService` 测试无需修改即可通过。(verification: unit)
- AC6 — Agent 对话框显示解析后的路径和校验状态，使用 `@cherrystudio/ui` 组件；新增的用户可见字符串在 `en-us.json` 中定义并已同步翻译。(verification: renderer and docs gate)

## Risks

存储任意可执行文件路径并运行它，意味着 Cherry Studio 会运行用户注册的任何程序。显式注册步骤与每次启动前的校验是唯一防护；本提案不对进程做沙箱隔离。配置后移动可执行文件在 Windows 上很常见（更新会改变安装路径），因此 `missing` 错误路径必须给出明确的可操作提示，避免用户误以为 Agent 已损坏。拒绝批处理包装器会排除部分 npm 安装的 CLI；若存在底层 `.exe`，用户需指向它。
