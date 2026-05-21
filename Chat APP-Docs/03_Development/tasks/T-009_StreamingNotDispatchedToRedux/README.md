# T-009 流式数据未回灌 Redux（D-004 + D-005 同源诊断）

**关联 issue**：D-005（已 closed 2026-05-21）+ D-004（已 closed 2026-05-21，D-005 同源）
**状态**：✅ **已完成 + 已验证关闭** —— 修复实施 + 自动化全过 + 用户 fresh install 端到端实测通过（D-005 BeatLoader 消失 + 操作栏出现；D-004 wrapper 出现 + Ask/Open 可点击）
**记录日期**：2026-05-21
**重要更正**：诊断初版把根因写成"streaming 管线完全不 dispatch Redux"，实际**几乎所有写入点都已经 dispatch**（`StreamingService.{addBlock, updateBlock, updateMessage}` 都调 `store.dispatch`，注释明确写「TODO: temp fix, it will be removed after message refraction」）。真正的 bug 是 `newMessage.ts:275` 的 SUCCESS 状态转换被**注释掉**了。详见 [诊断.md §1.1](./诊断.md)。D-004 推测为 D-005 副作用 → 修完 D-005 实测确认成立。

## 文件

- [任务.md](./任务.md) — brief
- [诊断.md](./诊断.md) — 完整调用链 + 同源解释 + 3 条修复路径
- 本 README — 一句话产出 + 修复矩阵

## 一句话（修正版）

`newMessage.ts:275` 的 SUCCESS 状态转换被注释掉了 —— 流式块完成时 reducer 收到 status=SUCCESS 但**静默不更新 message.status**。结果 `message.status` 永远停在 PROCESSING，`isMessageProcessing(message)` 永远 true，`Blocks/index.tsx:253-265` 的 `PlaceholderBlock`（BeatLoader 3 个点）永远渲染、操作栏一直被遮蔽 —— 这就是 **D-005**。

D-004 的"assistant wrapper 不存在"现象按代码分析**应该**已经通过 `addBlock` 里的 `upsertOneBlock` + `upsertBlockReference` dispatch 拿到 Redux 渲染（MainTextBlock 应渲染），所以 D-004 可能是 D-005 引发的副作用（render gating 或 user 查询时机），也可能是用户当时跑 DOM 查询时机的偶然。修完 D-005 + fresh install 复测后再决定是否要单独追 D-004。

## 已实施修复（合并方案 A 思路，但比初评小得多）

净 **+24 / -2** 业务行，2 个文件：

| 文件 | 改动 | 作用 |
|---|---|---|
| [`src/renderer/src/store/newMessage.ts:275`](../../../src/renderer/src/store/newMessage.ts) | 取消注释 `changes.status = AssistantMessageStatus.SUCCESS` + 加 T-009 说明注释 | 流式块 SUCCESS 时把 message.status 转 SUCCESS → `isMessageProcessing` 返回 false → BeatLoader 消失 |
| [`src/renderer/src/services/messageStreaming/StreamingService.ts` finalize](../../../src/renderer/src/services/messageStreaming/StreamingService.ts) | 在 DataApi PATCH 成功之后追加 `store.dispatch(newMessagesActions.updateMessage({ updates: { status } }))` | 防御层：覆盖 upsertBlockReference 不会触发的边界情况（空块流、abort、多模型组），让 Redux message.status 永远跟 DataApi 同步 |

加上原本就在的 `addBlock` / `updateBlock` / `updateMessage` 三个 dispatch 入口 ≈ "桥 = 已完整"。所以原方案 A 评估的 30 行 → 实际 24 行（多数是注释）。

## 自动化校验（已通过）

| 项 | 命令 | 结果 |
|---|---|---|
| Format | `pnpm biome format --write <3 files>` | ✅ |
| oxlint | `pnpm oxlint <3 files>` | ✅ 0/0 |
| ESLint | `npx eslint <3 files>` | ✅ 静默 |
| Typecheck (web) | `pnpm typecheck:web` | ✅ 0 输出 |
| Vitest（聚焦 reducer 测试）| `vitest run --project renderer src/.../newMessage.upsertBlockReference.test.ts` | ✅ 6/6 |
| Vitest（回归 9 文件 / 74 用例：store + thunk + Blocks + SelectionContextMenu + chat picker） | 同上扩展 | ✅ 74/74 |

## 与 T-007 / T-008C 的关系

T-007 D-003B 修了 providers.json 数据 / T-008C D-003C 修了 Chat picker 数据源 / T-009 D-005 修 message 状态转换 —— 3 个看似不相关的 issue 都源自"v2 迁移半成品"留下的小坑，1-50 行级别就能定位修复。

## 不在范围

- 修 D-006（默认模型仍 CherryAI）/ D-007（regenerate 无反应）
- 修 streaming 中 useSmoothStream 的 reset 时机
- v2 渲染层完整迁移（独立大 task）
