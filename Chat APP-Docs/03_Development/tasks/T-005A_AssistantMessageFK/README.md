# T-005A 诊断 assistant message 写入时 SQLite FK 失败

**日期**：2026-05-20 深夜（T-004 之后）
**阶段**：Phase 2 / Baseline Debug（继 T-003/T-004）
**状态**：✅ 诊断完成；🔧 修复待执行（最小方案 = 一处 DTO 清洗）

## 文件

- [任务.md](./任务.md) — 任务 brief
- [诊断.md](./诊断.md) — 根因链路 + 修复方案

## 一句话

`messageThunk.ts` 把 v1 `assistant.model.id`（短字符串如 `'qwen'`）当 v2 UniqueModelId 透传给 `POST /topics/:topicId/messages`；v2 message 表 `modelId` FK 指向 `user_model(id)`，要求 `"providerId::modelId"` 格式 + 行存在。**`'qwen'` 不含 `::`、user_model 表也无 seeder → 必触 FK 失败**。

## 与 T-004 的关系

同类型 bug：「v1 sentinel / 短 id 直接发给 v2 FK 校验」。
- T-004 修了 `assistantId: 'default'` → null
- T-005A 是 `modelId: 'qwen'`（短 id）→ undefined / null

## 关联

- 索引：[D-002](../../问题与Debug记录.md)
- 主线 v2 切换：见 [../../下一步.md](../../下一步.md)
- 类比：[../T-004_修复DefaultAssistantSentinel/](../T-004_修复DefaultAssistantSentinel/)
