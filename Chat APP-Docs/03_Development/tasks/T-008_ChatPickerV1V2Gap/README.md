# T-008 Chat Select Model 弹窗 v1/v2 数据断层（D-003C）

**关联 issue**：D-003（已 closed 2026-05-21）
**状态**：✅ **已完成** —— D-003C 诊断 + T-008B 评估 + T-008C 实施全部完成；用户 fresh install 端到端手测通过（Chat picker 能选 Ollama + gemma4:e4b 正常回复）
**记录日期**：2026-05-21

## 文件

- [任务.md](./任务.md) — brief：输入、约束
- [诊断.md](./诊断.md) — v1 / v2 数据源对照 + 调用链 + 两条修复路径
- [方案B评估.md](./方案B评估.md) — 方案 B 最小实现可行性细评（T-008B，2026-05-21）：**~1 文件 / ~50 行 src + ~50 行测试**；推荐直接走 B、跳过 A

## 一句话

T-007 D-003B 修了"Ollama 模型能进 v2 DataApi `user_model` 表"，所以 **v2-aligned 的 Provider 设置页能看到模型**。但聊天界面的 `SelectChatModelPopup` 仍在用 **v1 Redux `state.llm.providers`**，那是一份与 v2 DataApi 没有桥接的独立数据源 —— 自动同步只写 v2、不写 v1，所以 Ollama 模型永远不会出现在 Chat 选择器里。CherryAI 的 Qwen 能看到是因为它**硬编码**写死在 v1 Redux selector 里（`CHERRYAI_PROVIDER`）。

## 修复路径（两选一，本次不实施）

| 方案 | 描述 | 改动大小 | 风险 | 适用场景 |
|---|---|---|---|---|
| **A. v2→v1 桥** | 在 `useProviderModelSync.syncProviderModels` 成功后，把 created models 反过来 dispatch v1 `addProvider({ enabled: true })` + 逐个 `addModel`，并把 v1 Redux Ollama `enabled` 翻成 true | 小（~30 行 hook 改动） | 双写脏数据风险；v1 路径继续呼吸 | 想立即解锁 T-006 Ollama 测试，**继续推进 v2 迁移再删 v1** |
| **B. Chat 弹窗迁 v2** | 把 `SelectChatModelPopup` 的 `useProviders`/`provider.models` 全部换成 `useProviders`（v2 plural）+ `useModels()` —— 仓库里已经有现成的 `@renderer/components/ModelSelector/*`（同 hook 集合）可参考 | 中（~100–200 行，含 type 桥接） | 影响 Chat 主链路；可能要同步迁 `useDefaultModel` / `setDefaultModel` | 想一次性消解，**接受顺手扩 scope** |

## 不在范围（本次诊断）

- 实际实施 A 或 B
- 让 v1 Redux `state.llm.providers.ollama.enabled` 默认为 `true`（看着小，但下游 v1 picker 也会显示一个空 models 行，问题没解）
- 把 CherryAI 从硬编码移到 v2（清理项）
- D-003 终结（关 issue 等 A 或 B 落地）
