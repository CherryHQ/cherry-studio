# Agent Note：内置 filesystem MCP 使用所有配置根目录

Status: implemented

[English](2026-11-17-filesystem-multiple-roots.md) | 中文

## 问题

内置 filesystem MCP 接受多个配置路径，却只把第一个参数当作工作区。这导致工具无法访问后续已授权的根目录，而且可访问范围会随参数顺序变化。

## 决定

所有非空配置路径参数都会成为授权根目录。设置 `WORKSPACE_ROOT` 时仍由它作为唯一覆盖根目录；没有配置根目录时，服务仍使用现有的 MCP 工作区回退值。路径校验会规范化目标和根目录。相对路径和默认目录列表始终限制在规范化后的第一个根目录内，发现的子路径也不例外；绝对路径请求可匹配任意配置根目录。子路径校验保留原始请求的根目录范围，防止相对路径搜索通过符号链接发现其他配置根目录中的内容。文件操作输出使用校验时选中的规范化根目录，返回相对于该根目录的路径。

## 备选方案

- 继续只使用第一个参数：这会保留现有问题，也不符合多个路径配置的预期。
- 配置多个路径时把文件系统根目录作为工作区：这会让访问范围超出用户配置的路径。

## 后果

工具可以访问所有明确配置的根目录，且不受参数顺序影响。相对工具路径和默认目录列表仍使用第一个配置根目录；绝对路径可以指向任意配置根目录。

## 验证

- 回归 — `pnpm exec vitest run --project main src/main/ai/mcp/servers/filesystem/__tests__/filesystem.test.ts src/main/ai/mcp/servers/filesystem/__tests__/grep.test.ts src/main/utils/file/__tests__/path.test.ts`：显式绝对路径请求可访问多个根目录；相对路径的跨根目录读取和修改会被拒绝，目标保持不变；符号链接根目录的输出仍为根目录相对路径。真实 ripgrep 和明确标注的输出 fixture 覆盖默认与相对路径 glob 搜索，结果不包含跨根目录符号链接中的文件。
- 回归 — `pnpm typecheck:node`：Node 项目类型检查通过。
