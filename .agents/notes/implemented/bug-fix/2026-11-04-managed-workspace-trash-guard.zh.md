# Agent Note: 允许将托管会话工作区内容移至回收站

Status: implemented

[English](2026-11-04-managed-workspace-trash-guard.md) | 中文

## 问题

`move_to_trash` 拒绝了应用托管的智能体会话工作区内的所有目标。这些工作区位于 `<userData>/Data/Agents/system/<date>/<sessionId>` 下，但防护逻辑保护了整个 `app.userdata`，在 Windows 上还保护了用户主目录下的整个 `AppData` 目录。这两个祖先目录各自都将普通会话内容归类为受保护的应用数据。

模型仅收到 `Tool execution failed`。诊断包保留了真实原因：`Refusing to move protected path to trash (a credential, configuration, or application-data directory)`。

## 决策

豁免资格来自可信的工作区身份。`agentMcpServers.ts` 将 `session.workspace.type` 经由 assistant-files 服务器上下文传入执行器；该类型绝不来自工具输入。`system` 工作区仅让其严格后代路径豁免于宽泛的应用数据容器保护，包括 `app.userdata` 和各平台用户主目录下的应用数据容器。

凭据目录、`cherry.home`、VCS 元数据、操作系统目录、卷根目录、符号链接检查及工作区范围校验均保留既有行为。工作区根目录仍被拒绝。详细失败信息仍写入日志，面向模型的失败文本保持不透明。

## 考虑过的替代方案

- 豁免传入的 `workspacePath` 内的所有目标：用户选择 `<userData>/Data` 作为工作区后，就能将 `cherrystudio.sqlite` 移至回收站。
- 从 `<date>/<sessionId>` 目录布局推断归属：`<sessionId>.archiving` 和 `<sessionId>.restoring` 是实际存在、由应用持有的同深度恢复兄弟目录，因此深度不能证明工作区归属。
- 向模型公开失败原因：当时被否决，因为共享失败包装器隐藏绝对路径和条目 id，且已有测试固定了这一契约；后来以脱敏形式采纳（见 [2026-11-05-assistant-files-toolchain](2026-11-05-assistant-files-toolchain.md)）。

## 影响

`system` 工作区内的普通文件和目录现在可以通过应用数据祖先目录的保护，进入操作系统回收站操作。强制审批和仅使用操作系统回收站的行为保持不变；没有永久删除的后备路径。受保护目标、工作区根目录及工作区外的路径仍由既有检查拒绝。Windows 应用数据内的 `user` 工作区仍被拒绝，即使其目录形似托管会话工作区；macOS 的 `~/Library` blanket 容器后来被收窄为敏感子目录，因此 `Application Support` 下的用户工作区被放行，而 Cherry Studio 自身数据仍受保护（见 [2026-11-05-assistant-files-toolchain](2026-11-05-assistant-files-toolchain.md)）。未传入可信类型的调用方不获得豁免。

智能体宿主工具（包括 `move_to_trash`）仅为具有 builtin-role 的智能体挂载。报告中的使用入口是内置助手。工具失败现在返回脱敏后的具体原因，而不是不透明的 `Tool execution failed`（见 [2026-11-05-assistant-files-toolchain](2026-11-05-assistant-files-toolchain.md)）。

## 验证

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/tools/__tests__/moveToTrash.test.ts src/main/ai/mcp/servers/__tests__/AssistantFileToolsServer.test.ts src/main/ai/runtime/claudeCode/__tests__/buildMcpServers.test.ts src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts --maxWorkers=1 --no-file-parallelism`：4 个文件 / 212 项测试通过。注入平台的防护用例覆盖托管内容和保留的保护边界；操作层的文件及目录 fixture 在模拟 Electron 回收站边界的情况下验证执行器接线。
- Regression — 在基线提交 `c4c46c97ef1c342b6accb4db63c79b53167ab46e` 的干净副本上对 `moveToTrash.managed-workspace.test.ts` 执行 RED 运行：1 个文件 / 2 项测试失败。Windows 和 Darwin 托管工作区探针均以 `expected 'a credential, configuration, or application-data directory' to be undefined` 失败，通过基线防护 API 复现误拒绝。

本轮未在真实智能体会话中验证实际的操作系统回收站 / Trash 操作。确定性的 Electron 尝试受阻于 Pi 将 MCP 服务器挂载为 `codemode`、宿主工具仅对 builtin-role 开放，以及内置助手运行厂商 CLI。定向测试不能证明真实会话审批或原生操作系统回收站行为。
