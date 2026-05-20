# T-003 Baseline Debug：v2 fresh install 创建 Topic 失败

**日期**：2026-05-20 晚
**状态**：✅ 诊断完成（修复在 [T-004](../T-004_修复DefaultAssistantSentinel/)）

## 文件

- [任务.md](./任务.md) — 任务 brief
- [诊断.md](./诊断.md) — 根因链路 + 三方案对比 + 推荐方案 B

## 一句话

renderer 端 `AssistantService.ts:77-89` 的 `getDefaultAssistant()` 仍合成 v1 sentinel `id: 'default'`，v2 后端按真实 UUID 校验 FK → 必失败。`rm` 数据库不能解，因为问题在 renderer Redux 初始 state 的硬编码。

## 后续

- 见 [../T-004_修复DefaultAssistantSentinel/](../T-004_修复DefaultAssistantSentinel/) 执行方案 B 的修复
- 该 issue 在 [../../问题与Debug记录.md](../../问题与Debug记录.md) 索引为 D-001
