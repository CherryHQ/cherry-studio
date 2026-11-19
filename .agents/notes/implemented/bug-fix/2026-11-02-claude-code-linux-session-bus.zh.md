# Agent Note：Claude Code 缺少 Linux 会话总线时快速失败

Status: implemented

[English](2026-11-02-claude-code-linux-session-bus.md) | 中文

## 问题

当 Claude Code 最终 Linux 子进程环境中没有 `DBUS_SESSION_BUS_ADDRESS` 时，打包版 `zypak` 可能启动失败并关闭 Agent 传输。重复启动无法恢复缺失的桌面会话配置，之前只会显示笼统的传输错误。

## 决策

如果 Linux 上最终会话总线地址缺失或为空，则拒绝构建 Claude Code 环境。保留现有的桌面进程和登录 shell 地址来源，但不自行拼造地址。错误携带应用自有的翻译键，提示用户在启动 Cherry Studio 的桌面环境中配置地址并重启；此错误会在 SDK 查询生成子进程之前抛出。

## 考虑过的替代方案

- 根据 `XDG_RUNTIME_DIR` 猜测总线套接字 — 不采用，因为地址由桌面会话管理，猜测的端点可能不正确。
- 让 `zypak` 启动失败并报告传输关闭 — 不采用，因为这会重复启动失败的子进程，且没有提供配置指引。

## 后果

缺少地址时，每次显式请求都会立即失败，但不会启动 Claude Code，因此重复请求不会生成重复的失败子进程。此环境检查无法发现非空地址所指向的总线不可达；仍需在打包版 Linux 环境中验证。

## 验证

- 回归 — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`：保留父进程和登录 shell 提供的地址；缺少地址时返回可操作的配置错误，环境构建失败时不会启动 warm 或 cold 查询。
- 渲染器 — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`：错误标题和恢复指引正常显示，且不会触发 AI 诊断。
- 未在此沙盒中运行打包版 Linux 桌面验证。
