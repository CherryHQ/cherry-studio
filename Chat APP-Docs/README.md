# Chat APP Vault — 入口

> Cherry Studio 聊天模块工程笔记 vault。本文件是总索引。

## 目录

```
Chat APP-Docs/
├── 01_Project/          ← 工程级风险、约束
├── 02_Architecture/     ← 源码地图、模块说明、契约（长期参考文档）
└── 03_Development/      ← 任务、日志、状态（滚动更新）
    └── tasks/           ← 每个 T-XXX 任务独立文件夹
```

## 快速入口

- **今天能做什么？** → [03_Development/当前状态.md](./03_Development/当前状态.md)
- **下一步该做什么？** → [03_Development/下一步.md](./03_Development/下一步.md)
- **代码在哪？** → [02_Architecture/源码地图.md](./02_Architecture/源码地图.md)
- **当前已知问题？** → [03_Development/问题与Debug记录.md](./03_Development/问题与Debug记录.md)
- **当前已知风险？** → [01_Project/风险与限制.md](./01_Project/风险与限制.md)
- **所有任务历史？** → [03_Development/tasks/](./03_Development/tasks/)

## 每个分区的 README

- [01_Project/README.md](./01_Project/README.md)
- [02_Architecture/README.md](./02_Architecture/README.md)
- [03_Development/README.md](./03_Development/README.md)
- [03_Development/tasks/README.md](./03_Development/tasks/README.md)

## 工作纪律（摘要 — 详见 `cherry-studio/CLAUDE.md`）

- v1（Redux / Dexie / ElectronStore）= **throwaway**，不修 v1 bug
- 新 UI 组件用 `@cherrystudio/ui`（Tailwind + Shadcn），禁用 antd / styled-components
- 路径走 `application.getPath()`；日志走 `loggerService.withContext()`
- 完成代码任务必须跑 `pnpm lint && pnpm test && pnpm format`
- 不手改 codegen 4 产物；不写 patch migration
- Conventional Commits + `--signoff`

## 时间线（按任务）

| 任务 | 主题 | 状态 | 入口 |
|---|---|---|---|
| T-001 | 建立聊天模块源码地图 | ✅ 完成 | [任务.md](./03_Development/tasks/T-001_源码地图/任务.md) |
| T-002 | 梳理 DataApi 端点 | ✅ 完成 | [任务.md](./03_Development/tasks/T-002_DataApi端点/任务.md) |
| T-003 | Baseline Debug：v2 fresh install Topic 创建失败诊断 | ✅ 诊断完成 | [任务.md](./03_Development/tasks/T-003_BaselineDebug/任务.md) |
| T-004 | 修复 default assistant sentinel（方案 B） | ✅ 已验证关闭（2026-05-21；D-001 closed） | [任务.md](./03_Development/tasks/T-004_修复DefaultAssistantSentinel/任务.md) |
| T-005A | 诊断 assistant message 写入 FK 失败（modelId 短 id） | ✅ 诊断完成 | [任务.md](./03_Development/tasks/T-005A_AssistantMessageFK/任务.md) |
| T-005B | 修 assistant message modelId FK（StreamingService 一处清洗） | ✅ 已验证关闭（commit `15ad2eb08`，2026-05-21；D-002 closed） | [任务.md](./03_Development/tasks/T-005B_修复ModelIdFK/任务.md) |
| T-006 | Text Anchor Branch UI 原型（含 A–F 子任务） | 🧠 设计 ✅；T-006B ✅ commit `d579fdcf2`；T-006C / T-006D-1 ✅ staged 未 commit；其余 ⏳ | [README.md](./03_Development/tasks/T-006_TextAnchorBranchUI/README.md) |
| T-007 | Ollama Provider 自动模型同步失败诊断 + 修复（D-003A / D-003B） | ✅ 已验证关闭（2026-05-21；D-003 closed） | [验证.md](./03_Development/tasks/T-007_OllamaProviderFix/验证.md) |
| T-008 | Chat Select Model 弹窗 v1/v2 数据断层（D-003C） | ✅ 诊断 + 评估 + T-008C 实施全部完成（2026-05-21） | [方案B评估.md](./03_Development/tasks/T-008_ChatPickerV1V2Gap/方案B评估.md) |
| T-008C | Chat 模型选择器迁 v2（方案 B 实施） | ✅ 已验证关闭（2026-05-21；fresh install 实测 Ollama + gemma4:e4b 通过） | [验证.md](./03_Development/tasks/T-008C_ChatPickerV2Migration/验证.md) |
| T-009 | 流式管线不回灌 Redux（D-004 + D-005 同源诊断） | 🩺 诊断完成；🔧 3 条修复路径待用户选 | [诊断.md](./03_Development/tasks/T-009_StreamingNotDispatchedToRedux/诊断.md) |
