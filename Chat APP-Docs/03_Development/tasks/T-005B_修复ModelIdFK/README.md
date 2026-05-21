# T-005B 修复 assistant message 写入时 modelId FK 失败

**日期**：2026-05-20 深夜（紧随 T-005A 诊断）
**阶段**：Phase 2 / Baseline Fix
**状态**：✅ **已验证关闭**（D-002 closed 2026-05-21）—— 代码 + 自动化校验完成 + 用户 2026-05-21 fresh install 实测 gemma4:e4b 正常流式回复、无 FK 报错

## 文件

- [任务.md](./任务.md) — 任务 brief
- [实施.md](./实施.md) — 修改前验证 + 实施步骤 + 校验
- [验证.md](./验证.md) — 自动化 / 手动验证清单
- [完成总结.md](./完成总结.md) — 结果 / 遗留 / 经验

## 一句话

`StreamingService.createAssistantMessage` 构造 `CreateMessageDto` 时，用 `isUniqueModelId` 校验：合法 UniqueModelId 透传，否则 `undefined`。解 [D-002](../../问题与Debug记录.md)。

## 关联

- 诊断 → [../T-005A_AssistantMessageFK/诊断.md](../T-005A_AssistantMessageFK/诊断.md)
- 同型 patch → [../T-004_修复DefaultAssistantSentinel/](../T-004_修复DefaultAssistantSentinel/)
- 长期解（方案 C 路线）：renderer 启动同步真实 user_model + 用 `createUniqueModelId(provider, id)` 替代散落的 v1 `Model.id` 透传
