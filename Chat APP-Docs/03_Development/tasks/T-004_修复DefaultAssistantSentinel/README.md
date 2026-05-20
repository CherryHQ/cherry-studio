# T-004 修复 default assistant sentinel（方案 B）

**日期**：2026-05-20 晚
**状态**：✅ 代码修复完成 + 自动化校验通过；⏳ 待用户手动验证 baseline 解除

## 文件

- [任务.md](./任务.md) — 任务 brief + 完成标准
- [实施.md](./实施.md) — 修改前验证 + 实施步骤 + 校验结果
- [验证.md](./验证.md) — 自动化 / 手动验证计划
- [完成总结.md](./完成总结.md) — 结果 / 遗留 / 经验

## 一句话

`src/renderer/src/services/AssistantService.ts:172-181` `mapLegacyTopicToDto` 在 `topic.assistantId === 'default'` 时返回 `null`，让 v2 FK 通过，把 topic 创建从 fresh install 黑屏中解出来。

## 关联

- 关闭 [D-001](../../问题与Debug记录.md)
- 诊断详见 [../T-003_BaselineDebug/诊断.md](../T-003_BaselineDebug/诊断.md)
- 长期正解：方案 C（renderer 启动合成真实 UUID）—— 留待后续任务
