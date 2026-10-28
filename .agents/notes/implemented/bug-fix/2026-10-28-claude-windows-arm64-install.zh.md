# Agent Note: 在 Windows ARM64 上选择已发布的 Claude 二进制文件

Status: implemented

[English](2026-10-28-claude-windows-arm64-install.md) | 中文

## 问题

Code Mate 通过内置 mise 2026.7.14 注册表安装 Claude。其 HTTP 配方只为 Windows x64 覆盖了 URL 和二进制文件名。Windows ARM64 回落到 `windows-arm64/claude`，该地址返回 404；官方清单发布的文件为 `win32-arm64/claude.exe`。

## 决策

在 Windows ARM64 上安装规范 `claude` 配方时，BinaryManager 使用 mise 原生的 `url` 和 `bin` 工具选项指定 `win32-arm64/claude.exe`。版本仍使用由 mise 解析的模板。注册表中的官方清单校验和验证保持启用。目录身份、版本发现、安装清单、卸载及所有其他平台保留现有配方。

## 考虑过的替代方案

- 升级所有内置 mise 二进制文件会改变每种工具和平台的安装器；本次修复仅补齐固定版本中缺失的平台映射。
- 将 Code Mate 安装替换为 Agent SDK 二进制文件会耦合两条分别归属不同模块的运行时路径，并改变其版本管理。
- 改写 E2E 断言或预装二进制文件会保留用户安装路径中的故障。

## 影响

覆盖选项重复了上游下载前缀；固定版本的 mise 注册表支持 Windows ARM64 后，需要重新审视该选项。原生下载和校验和处理仍由 mise 负责。

## 验证

- 回归 — `src/main/services/binaryManager/__tests__/claudeArm64Install.test.ts`：原配方无法满足已发布产物契约；latest 和显式版本均选择 ARM64 可执行文件，其他平台配方保持不变。
