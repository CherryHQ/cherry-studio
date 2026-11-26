# Agent Note: 恢复时延后加载超限的 Claude 子会话归档

Status: implemented

[English](2026-11-26-claude-child-archive-deferral.md) | 中文

## 问题

恢复时会预先读入累计的所有子 Agent 记录，并在 Electron 主进程中保留归一化后的历史。内嵌图片增大了历史体积，导致主进程堆膨胀到数 GB。问题报告中的 54 份子会话记录共约 534 MB，包含 1,758 张内嵌图片。应用每次重启都会以 `0xE0000008` 退出。[Issue #25038](https://github.com/CherryHQ/cherry-studio/issues/25038)

## 决策

恢复根会话时，每个子会话最多加载 24 MiB，所有预加载的子会话合计最多 32 MiB。定向刷新仅读取指定子会话，预算为 64 MiB。worker 在读取正文前检查记录文件大小，对获准加载的历史按磁盘大小与消息及对账条目序列化后的总大小两者中的较大值计入预算。[归档读取与预算](../../../../packages/agent-runtime-claude-code/src/archive.ts)

延后加载以单个子会话为原子单位。worker 在发送任何条目或消息前检查整个子会话。如果超出预算，或任一序列化记录超过 16 MiB 传输上限，worker 就发送该子会话的延后加载标记及可用的伴随文件元数据。根会话历史和符合条件的同级子会话仍可恢复。在同一运行时所有者的生命周期内，每个线程因刷新而延后加载历史时，只记录一次汇总警告。[归档 worker](../../../../packages/agent-runtime-claude-code/src/archiveWorker.mjs) · [归档所有者](../../../../packages/agent-runtime-claude-code/src/owner.ts)

## 考虑过的替代方案

- 只限制传输帧的字节数。单帧虽小，主进程仍会累积所有获准加载的消息。
- 只读超限子会话开头的一部分。部分记录可能漏掉撤回信息或其他对账依据，因此 worker 延后加载整个子会话。

## 后果

延后加载的子会话保留已持久化的消息行和原生记录。如果记录符合定向刷新预算和单条记录上限，调用该子会话句柄的 `archive()` 即可加载原生历史。桌面端子会话面板通过 `archive({ refresh: false })` 读取，尚未发起定向刷新。目前重新打开延后加载的子会话时，只会显示已保存的消息行。[桌面端运行时驱动](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts)

子会话预算限制根会话恢复时加载的历史量。根会话记录继续沿用原有的 worker 传输和复制流程。[归档传输说明](2026-11-14-claude-archive-transfer.md)

## 验证

- 回归 — `pnpm test:agent-runtime-claude-code packages/agent-runtime-claude-code/tests` 通过 135 项测试，覆盖预加载预算、定向刷新、单条记录超限时的原子延后加载，以及警告去重。
- 回归 — `pnpm test:main src/main/ai/agentSession/__tests__/ChildThreadProjection.test.ts src/main/ai/runtime/claudeCode/__tests__/desktopRuntime.integration.test.ts` 通过 80 项测试，覆盖延后加载时保留已保存的消息行、恢复后清除诊断，以及桌面端运行时集成。
- 回归 — `pnpm test:main src/main/ai/agentSession/__tests__/ChildThreadProjection.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts` 通过 72 项测试，覆盖子会话投影和原生分叉测试。
- 回归 — 使用约 534 MB 的测试数据时，主进程堆在 `HEAD` 上增长约 527.6 MB，修复后增长约 29.7 MB。54 个子会话中有 51 个延后加载，根会话历史完整。使用 1.9 GB 的测试数据时，`HEAD` 上保留约 1.91 GB，修复后约 154 KB。此次验证未覆盖 Windows 打包应用的启动。
