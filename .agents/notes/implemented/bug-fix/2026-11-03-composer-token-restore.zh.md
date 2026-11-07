# Agent Note：编辑器重建时从实时 token 恢复草稿芯片

Status: implemented

[English](2026-11-03-composer-token-restore.md) | 中文

## 问题

从 `{ text, tokens: draftTokens ?? [] }` 重建输入框编辑器内容时，依赖的 token 种子只在挂载时读取一次（`ChatComposer` 对草稿缓存的 `useState` 初始化器）。当编辑器事后被重建——例如从设置页返回聊天——`text` 是最新的而种子为空，知识库或 MCP 资源芯片折入正文的 `promptText` 就被物化成了普通文本。token 同步副作用随后又把芯片补回来，那句指令便以用户文本的形式留在草稿里，且每次重建都会复现。报告见 #23454。

## 决策

新增 `resolveComposerRestoreTokens(text, draftTokens, liveTokens)` 在重建时填补空缺：当种子为空时，凡 `promptText` 出现在 `text` 中的实时 token，都会按其出现位置恢复为序列化 token。种子非空时原样使用，消息编辑的恢复行为不变；没有 `promptText` 的 token（文件）不受影响。

## 备选方案

- 始终从实时 token 重建：不采用——消息编辑恢复时 `draftTokens` 才是权威来源，实时选择状态可能与持久化草稿不一致。
- 从 `text` 中剔除未被认领的提示词文本以治愈已损坏的草稿：不采用——那句话可能是用户有意输入的内容（比如引用本 bug），静默删除用户文本比留下一句可手动清空的多余文本更糟。

## 后果

修复前已损坏的草稿会保留那句多余文本，直到用户清空输入框；重建不再产生新的损坏。

## 验证

- 回归 — `pnpm test:renderer src/renderer/components/composer/__tests__/ComposerSurface.test.tsx -t "rebuilds a chip from the live token"`：渲染一个 `text` 中已折入知识库提示词、种子为空的重建编辑器，断言恢复的是芯片节点而非纯文本。
- `pnpm test:renderer` 运行 `ComposerSurface.test.tsx`、`composerDraft.test.ts`、`composerInputAdapter.test.ts`：214 个用例通过。
