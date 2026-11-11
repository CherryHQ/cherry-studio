# Agent Note: 在 Windows 上提供原生 PowerShell 工具

Status: implemented

[English](2026-11-10-pi-windows-powershell.md) | 中文

## Problem

Cherry 原先仅为 Pi 和 Pi Durable 注册 Bash，导致没有可用 Bash 安装的 Windows 智能体无法执行命令。两个锁定版本的 SDK 都已提供原生 PowerShell 工具，但仅注册工具会绕过此前只识别 `bash` 的保护规则。

## Decision

仅在 Windows 上注册原生 `powershell`。复用各 SDK 的可执行文件发现与回退：Pi 先查找 `pwsh.exe`，再查找 Windows PowerShell；Durable 仅在启动失败后，才从 `pwsh` 尝试 `powershell`。配置、历史和审批均保留工具的原生身份。

与 Bash 共用 `mergePiShellExecutionEnv`。该函数合并环境变量和二进制搜索路径，保留 PowerShell 专用变量与调用方自己的 mise 配置，不添加 shell 语法。Bash 的登录 PATH 前缀与 RTK 重写仍仅用于 Bash。

Pi Durable 在构造 `NodeExecutionEnv` 时合并完整环境。SDK 为每次 shell 调用创建空的环境覆盖对象。合并该空对象会生成仅含托管目录的 `Path`，替换继承的 `Path`，导致子进程可能找不到 PowerShell。Durable 的两个 shell 工具都继承为会话准备的环境。

将现有的禁用工具、全局安装和用户数据 SQLite 规则应用于 PowerShell。Auto 模式对识别到的破坏性命令请求审批，包括 PowerShell 的删除与内容清空命令。这种启发式检测不是完整的 PowerShell 解析器，也不是沙箱。

## Alternatives considered

- 要求安装 Git Bash 会保留 Windows 兼容性缺口。
- 将 Bash 源码交给 PowerShell 会改变命令语义，并可能在失败后重复执行副作用。
- 自定义 PowerShell 启动器会重复原生的可执行文件发现、输出处理和取消逻辑。

## Consequences

Windows 智能体无需 Bash 即可使用 PowerShell。其他平台不向模型提供该工具，历史工具渲染仍保留其身份。既有的显式 Bash `shellPath` 校验保持不变。本修复不添加后台执行或交互式 stdin 通道。

## Verification

- Regression — `src/shared/ai/__tests__/agentRuntimeCapabilities.test.ts`：仅 Windows 提供的目录项与禁用名称归一化。
- Regression — `src/main/ai/runtime/pi/piApprovalFacts.test.ts`：破坏性命令审批、受保护 SQLite、全局安装拦截及保持原样的 PowerShell 参数。
- Regression — `src/main/ai/runtime/pi/piShell.test.ts`：保留 PowerShell 环境、Windows PATH 大小写及调用方自己的 mise 状态。
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts` 与 `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`：模型可见工具、禁用工具、Windows 原生 Unicode 文件读写，以及 Durable 通过配置的 PATH 查找命令。
- Regression — `Windows Electron Work sessions`：屏蔽 Git Bash 发现路径后，两个运行时均执行了 PowerShell，并返回写入磁盘的 Unicode 文本。
