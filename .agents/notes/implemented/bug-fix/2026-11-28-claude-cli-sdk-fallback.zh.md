# Agent Note: 检测不到 Claude CLI 时复用 SDK 下载的可执行文件

Status: implemented

[English](2026-11-28-claude-cli-sdk-fallback.md) | 中文

## 问题

即使 Cherry Studio 已为内置的 Claude Agent SDK 下载了可用的 CLI，本地 Claude Code 仍可能被检测为未安装。此时从 Code CLI 入口启动 Claude 可能会再次尝试安装。

## 决策

将 SDK 下载的可执行文件作为 Claude Code 自动检测的最后回退。下载服务验证可执行文件是否对应应用固定的 SDK 版本和当前平台。显式配置的可执行文件和已检测到的安装优先。下载就绪后，智能体服务会重新检测。

## 考虑过的替代方案

- 首次启动时单独安装 CLI。这样会增加一次下载，并修改用户的系统环境。
- 每次启动都优先使用 SDK 下载的副本。这样会绕过用户已经配置或安装的 CLI。

## 影响

本地 Claude 会话、模型查询、登录和终端都能使用 SDK 下载的可执行文件。下载服务继续管理该文件及其更新。智能体服务只为单独安装的 CLI 提供卸载入口。

## 验证

- Regression — `launch.test.ts` 和 `CodeCliService.test.ts` 覆盖检测不到 CLI 时的回退、显式配置和已有安装的优先级，以及使用下载路径启动终端。
- 在没有系统 Claude CLI 的隔离 macOS Electron 配置中，真实下载完成后，智能体服务的状态自动从未安装变为已安装。下载的 CLI 报告版本为 2.1.311，并返回五个模型。
