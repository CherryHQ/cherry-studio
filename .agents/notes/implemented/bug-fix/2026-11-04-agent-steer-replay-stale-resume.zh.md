# Agent Note: Agent 会话引导卡死、重放缺口与过期 resume 恢复

Status: implemented

[English](2026-11-04-agent-steer-replay-stale-resume.md) | 中文

## Problem

长 Agent 会话（Claude Code runtime）在重放环溢出时卡死：`reasoning-delta` / `tool-input-delta` 在缺少 `*-start` 的情况下到达，日志出现 `attach: replay has gaps due to buffer overflow`，实时视图停滞且无错误卡（issue #23421）。在任务运行中使用引导（Steer）会让卡死显现。重启后历史显示「发生错误」，继续发送报 `No conversation found with session ID`，会话无法继续。关闭时 `AgentSessionRuntimeService stop timed out`，`closeQuery` / 子进程退出 / 未完成的连接超出了 5s 预算。

## Decision

- 重放修复为孤立的 `tool-input-delta` / `tool-input-available` / `tool-output-*` / `tool-approval-request` 合成缺失的 `tool-input-start`，按 execution 隔离。当存活的 `tool-input-available` 带有真实名称时，回填占位符，使静态部件保持 `tool-<name>` 身份而不 permanently 停留在 `unknown-tool`。
- `TopicStreamSubscription` 的实时修复在重放窗口内镜像上述合成；必须先于实时 delta 的 start 立即以 `unknown-tool` 合成（已记录的降级视图——重载后经重放补丁恢复）。
- 覆盖层节流 `readUIMessageStream error` 告警并标记降级 turn，但不将其判为失败；Main 侧 tee 累积的持久化仍是权威。
- 关闭时 `closeAll` 限时 4s（`onStop` 与 `onDestroy` 均适用），关闭预算超时不再污染 `failedClosures`，在途连接以 1.5s 为限等待而非直接丢弃。
- 过期 resume 清除内存 token、按失败会话作用域清理的持久化 `runtimeResumeToken` / `nativeSessionId` 绑定、匹配的在途 `closingSessions.resumeToken`，以及 `failedClosureResumeTokens` 中的过期 token 映射，同时保留 `failedClosures` 的所有权以维持编辑门禁与归档重试；在失败分支头写入分支级重置边界，阻断向健康祖先的回退，使该分支重建新连接，而健康兄弟分支保持不变。匹配逻辑收敛于共享 `staleResume.ts`，驱动在报错前先投递 `data-conversation-reset`。
- 连续引导累积（`[...prev, ...inputs]`）而非覆盖已 armed 的边界。

## Alternatives considered

- 在环中 pin `*-start`（永不淘汰）：拒绝，因其淘汰中间 delta、破坏文本连续性与 `replayFrom` 保证；合成保留尾部。
- 仅调大 `maxBufferChunks`：拒绝，无界 Agent turn（每步/每工具新 id）会超过任何固定环。
- 过期后手动重试：拒绝，每个后续 turn 都会同样失败，会话死亡。

## Consequences

被淘汰前缀的重放现在可通过真实 `readUIMessageStream` 解析；`tool-input-available` 存活时静态工具部件保留名称。关闭在 Lifecycle 预算内收敛。CLI 侧会话消失后，下一个 turn 重新建连而非永远失败。缺口期间的实时视图可能短暂显示 `unknown-tool`，重载后恢复。

## Verification

- Regression — `pnpm vitest run src/main/ai/streamManager/__tests__/buildCompactReplay.test.ts src/main/ai/streamManager/__tests__/AiStreamManager.test.ts`：覆盖孤立 tool-start 合成与 patch-once 行为。
- Regression — `pnpm vitest run src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts`：过期 token 投递 `data-conversation-reset`；`tool_use` 重复不投递。
- Regression — `pnpm vitest run src/main/ai/runtime/__tests__/staleResume.test.ts`：SDK 文案、包装的 `errors`/`cause`、普通载荷与反例。
- Regression — `pnpm vitest run src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.pause.test.ts src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.subagentWake.test.ts`：关闭、过期清理与引导路径。
- `pnpm typecheck:web`、`pnpm typecheck:node`、`oxlint`、`oxfmt --check` 通过。
