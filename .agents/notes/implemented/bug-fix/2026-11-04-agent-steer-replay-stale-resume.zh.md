# Agent Note: Agent 会话引导卡死、重放缺口与过期 resume 恢复

Status: implemented

[English](2026-11-04-agent-steer-replay-stale-resume.md) | 中文

## Problem

长 Agent 会话（Claude Code runtime）在重放环溢出时卡死：`reasoning-delta` / `tool-input-delta` 在缺少 `*-start` 的情况下到达，日志出现 `attach: replay has gaps due to buffer overflow`，实时视图停滞且无错误卡（issue #23421）。在任务运行中使用引导（Steer）会让卡死显现。重启后历史显示「发生错误」，继续发送报 `No conversation found with session ID`，会话无法继续。关闭时 `AgentSessionRuntimeService stop timed out`，`closeQuery` / 子进程退出 / 未完成的连接超出了 5s 预算。

## Decision

- 附着重放修复位于 Main 侧 `AiStreamManager.attach` 经 `buildCompactReplay` 实现，按 execution 隔离。它为孤立的 `tool-input-delta` / `tool-input-available` / `tool-output-*` / `tool-approval-request` 合成缺失的 `tool-input-start`，保留存活的 `toolName` / `dynamic` / 元数据，使静态部件保持 `tool-<name>` 身份而不停留在 `unknown-tool`，并在后续 `tool-input-available` 到达时做一次性回填。该修复使原始 `ai.stream.attach` 重放可被真实 `readUIMessageStream` 解析；桌面视图不在渲染侧做修复。
- 桌面视图消费 Main 侧消息投影（`ai.projection.attach` → `MessageProjectionService` → `ExecutionStreamOverlayService` → `useExecutionOverlay`），直接渲染 Main 侧 `pipeStreamLoop` 累积器产出的 `CherryUIMessage` 快照。覆盖层不解析数据块，也不跟踪降级 turn；Main 侧 tee 累积的持久化仍是权威。
- 关闭在 4s 内收敛整体拆卸（`onStop` 与 `onDestroy` 均适用），包含可能等待原生关闭的 `forks.cancel()`，关闭预算超时不再污染 `failedClosures`，关闭连接在该预算内收敛（关闭中单连接 2.5s）。在途连接经 `connectionAttempts` 串行化，并在同一竞速内由 `closeEntry` 等待，关闭中按 1.5s 上限等待而非直接丢弃；关闭开始前已在等待的关闭同样在关闭开始后适用 1.5s 上限，而不会把无界等待同时带入 stop 与 destroy；迟到连接依据 `entry.closing` 自行关闭，迟到工作保留其所有权。
- 过期 resume 清除内存 token、按失败会话作用域清理的持久化 `runtimeResumeToken` / `nativeSessionId` 绑定、匹配的在途 `closingSessions.resumeToken`，以及 `failedClosureResumeTokens` 中的过期 token 映射，同时保留 `failedClosures` 的所有权以维持编辑门禁与归档重试；祖先链读取（`getLastRuntimeResumeToken` / `getPersistedNativeSessionId`）仅在与连接或解析错误中的失败身份一致时才被信任，因此祖先回退（例如 edit + `/clear` 轮换后）不会误删健康兄弟分支；在失败分支头写入分支级重置边界，阻断向健康祖先的回退，使该分支重建新连接，而健康兄弟分支保持不变。冷启动确认缺失归档（`Claude Code open: native-storage-missing`，或类型化 `{ operation: 'open', code: 'native-storage-missing' }`）走同一作用域清理并写入未知 id 边界；原生 `open` 保留确认缺失与 `native-storage-unavailable` 的区分而不合并 refresh 失败，仅提及该 token 的实时 SDK 文本不会清理绑定。瞬时的 `native-storage-unavailable` 保留绑定。编辑/分支分组跳过被过期清理清空 token 但保留 checkpoint 的历史行，使恢复后的后缀仍可编辑；完全清空前缀的分叉（或选中 checkpoint 无原生覆盖）以 `unsupported_checkpoint` 失败而非发布无上下文子会话，首个拷贝绑定锚定在拷贝后的重置行（可见侧）以保证子会话可解析原生上下文。匹配逻辑收敛于共享 `staleResume.ts`；过期 turn 直接报错且不在该路径投递 `data-conversation-reset` 分隔符（渲染器在存在时仍会渲染），下一个 turn 重新建连。
- 连续引导累积（`[...prev, ...inputs]`）而非覆盖已 armed 的边界。

## Alternatives considered

- 在环中 pin `*-start`（永不淘汰）：拒绝，因其淘汰中间 delta、破坏文本连续性与 `replayFrom` 保证；合成保留尾部。
- 仅调大 `maxBufferChunks`：拒绝，无界 Agent turn（每步/每工具新 id）会超过任何固定环。
- 过期后手动重试：拒绝，每个后续 turn 都会同样失败，会话死亡。

## Consequences

被淘汰前缀的原始重放现在可通过真实 `readUIMessageStream` 解析；`tool-input-available` 存活时静态工具部件保留名称，原始消费者仅在存活名称/动态回填到达前看到短暂的 `unknown-tool` 占位符。桌面投影视图直接渲染 Main 快照，无需重载即可恢复。关闭在 Lifecycle 预算内收敛。CLI 侧会话消失后，下一个 turn 重新建连而非永远失败。

## Verification

- Regression — `pnpm vitest run src/main/ai/streamManager/__tests__/buildCompactReplay.test.ts src/main/ai/streamManager/__tests__/AiStreamManager.test.ts`：覆盖孤立 tool-start 合成与 patch-once 行为。
- Regression — `pnpm vitest run src/main/ai/runtime/claudeCode/__tests__/claudeContext.test.ts`：过期重置轮换、恢复后代分支分叉与重置边界编辑轮换。
- Regression — `pnpm vitest run src/main/data/services/__tests__/AgentSessionMessageService.test.ts -t "stale scoped invalidation"`：作用域化 token/原生清理保留健康兄弟分支。
- Regression — `pnpm vitest run src/main/ai/runtime/__tests__/staleResume.test.ts`：SDK 文案、包装的 `errors`/`cause`、普通载荷与反例，另含确认缺失（`Claude Code open:` / 类型化 open 结果）与瞬时存储的区分，以及实时 SDK 误报的拒绝。
- Regression — `pnpm vitest run src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.pause.test.ts src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.subagentWake.test.ts`：关闭、过期清理与引导路径。
- `pnpm typecheck:web`、`pnpm typecheck:node`、`oxlint`、`oxfmt --check` 通过。
