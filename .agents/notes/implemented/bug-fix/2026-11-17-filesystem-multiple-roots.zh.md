# Agent Note：内置 filesystem MCP 使用所有配置根目录

Status: implemented

[English](2026-11-17-filesystem-multiple-roots.md) | 中文

## 问题

内置 filesystem MCP 接受多个配置路径，却只把第一个参数当作工作区。这导致工具无法访问后续已授权的根目录，而且可访问范围会随参数顺序变化。

## 决定

所有非空配置路径参数都会成为授权根目录。设置 `WORKSPACE_ROOT` 时仍由它作为唯一覆盖根目录；没有配置根目录时，服务仍使用现有的 MCP 工作区回退值。路径校验会先规范化目标，再逐个检查目标是否位于某个根目录内，继续阻止路径穿越和符号链接逃逸。

## 备选方案

- 继续只使用第一个参数：这会保留现有问题，也不符合多个路径配置的预期。
- 配置多个路径时把文件系统根目录作为工作区：这会让访问范围超出用户配置的路径。

## 后果

工具可以访问所有明确配置的根目录，且不受参数顺序影响。相对工具路径和默认目录列表仍使用第一个配置根目录；显式指定的路径可以指向任意配置根目录。

## 验证

- 回归 — `pnpm test:main src/main/ai/mcp/servers/filesystem/__tests__/filesystem.test.ts`：多个根目录可用于 `ls`、`read`、`write`、`glob` 和 `grep`；配置根目录不受顺序影响；路径穿越和符号链接逃逸仍被拒绝。
- 回归 — `tsc --noEmit -p tsconfig.json`：TypeScript 编译通过。
