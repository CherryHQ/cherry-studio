# Agent Note: 将回归测试的 CLI 配置与开发者主目录隔离

Status: implemented

[English](2026-10-27-regression-home-isolation.md) | 中文

## 问题

隔离 Electron 的 `userData` 目录并不会隔离 `sys.home` 或共享的应用临时目录。Code Mate 在前者下写入 CLI 配置，因此本地回归测试可能替换开发者的 Claude 设置以及 Codex 配置和认证信息。缓存清理和数据重置还可能删除共享临时文件。恢复测试配置目录或停止 Electron 都无法撤销这些改动。

## 决策

源码和安装包启动都为每个回归测试配置目录提供独立的临时主目录。子进程环境覆盖 `HOME`、`USERPROFILE`、`CLAUDE_CONFIG_DIR` 和 `CODEX_HOME`。`TEMP`、`TMP` 和 `TMPDIR` 指向该主目录下已创建的目录。Windows 还会获得已创建的临时 `APPDATA` 和 `LOCALAPPDATA` 目录，使 Electron 能在启动时解析应用路径。控制器自身的环境保持不变，重启后继续使用该测试配置目录的临时主目录。

每次连接 UI 前，控制器都会验证进程与检查器的归属，并检查运行中应用的主目录、临时目录和 CLI 配置路径，以及 Windows AppData。路径超出测试配置目录的实例会被拒绝，包括本次修复前启动的实例。

## 考虑过的替代方案

- 只重定向 `userData` 仍会暴露 CLI 配置。
- 保存并恢复个人配置会允许清理前的破坏性写入，也无法保证运行中断后的恢复。
- 禁止 CLI 配置写入会绕过这些场景需要验证的产品行为。

## 影响

测试启动时不带个人 CLI 认证或配置。安装在个人主目录下的工具可能需要在临时测试环境中单独准备。环境隔离覆盖应用配置的主目录路径；它并非操作系统沙箱，无法限制场景或工具自行选择的任意绝对路径。复用其他进程环境的外部终端需要单独验证。

## 验证

- Regression — `scripts/e2e/regression/__tests__/launch.test.ts`：源码和安装包启动会替换继承的主目录和配置路径；Windows 应用数据目录已创建，控制器保留原有环境。
- Regression — `scripts/e2e/regression/__tests__/debugBridge.test.ts`：受控且已隔离的实例可以连接；个人主目录、临时目录、Windows AppData 和 CLI 配置路径会被拒绝。
- Regression — 本地 Windows Electron 检查确认 `sys.home`、`appData`、`sys.temp`、`app.temp`、`CODEX_HOME` 和 `CLAUDE_CONFIG_DIR` 均位于临时测试配置目录中；代码工具阶段运行后，受监测的个人配置文件 SHA-256 哈希保持不变。这不能证明 macOS 运行时验收通过，也不能恢复隔离前已被改写的文件。
