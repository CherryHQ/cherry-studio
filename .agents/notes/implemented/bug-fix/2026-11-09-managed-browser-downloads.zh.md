# Agent Note: 将托管 Browser MCP 下载保存到文件系统工作区

Status: implemented

[English](2026-11-09-managed-browser-downloads.md) | 中文

## Problem

托管 Browser MCP 下载沿用 Electron 的操作系统默认保存位置。默认文件系统 MCP 仅限访问 `feature.mcp.workspace`，因此无法打开这些下载文件。

## Decision

托管 Browser MCP 下载使用建议的文件名保存到 `feature.mcp.workspace`。借用的 guest 下载仍沿用 Electron 的常规保存流程。

## Alternatives considered

- 允许文件系统 MCP 读取任意操作系统下载路径：这会削弱其工作区边界。
- 重定向所有 guest 下载：这会改变用户拥有的浏览器行为。

## Consequences

- 默认文件系统 MCP 可通过文件名访问托管 Browser MCP 下载；自定义文件系统工作区不会自动获得访问权限。
- 托管 Browser MCP 下载不再使用操作系统默认下载位置。借用的 guest 下载保持不变。

## Verification

- Regression — `pnpm test:main src/main/features/browser/__tests__/downloads.test.ts`：托管下载保存到文件系统工作区，借用下载则不会重定向。
