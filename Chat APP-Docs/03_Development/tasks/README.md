# tasks/ — 工程包目录

每个 `T-XXX_*` 文件夹是一项独立工程，自包含：

- `任务.md` —— brief：任务输入、约束、交付物、完成标准
- `拆解.md`（可选）—— 子任务清单、执行策略
- `实施.md`（可选）—— step-by-step 记录、采集的数据
- `验证.md`（可选）—— 跑了什么、跑出什么、是否符合预期
- `诊断.md`（debug 任务专用）—— 根因 + 修复方案
- `完成总结.md`（可选）—— 结果 + 经验教训

## 当前任务清单

| ID | 主题 | 入口 | 状态 |
|---|---|---|---|
| T-001 | 建立聊天模块源码地图 | [T-001_源码地图/](./T-001_源码地图/) | ✅ 已完成（2026-05-19） |
| T-002 | 梳理 DataApi 端点 | [T-002_DataApi端点/](./T-002_DataApi端点/) | ✅ 已完成（2026-05-20 上午） |
| T-003 | Baseline Debug：v2 fresh install Topic 创建失败诊断 | [T-003_BaselineDebug/](./T-003_BaselineDebug/) | ✅ 诊断完成（2026-05-20 晚） |
| T-004 | 修复 default assistant sentinel（方案 B） | [T-004_修复DefaultAssistantSentinel/](./T-004_修复DefaultAssistantSentinel/) | ✅ 已验证关闭（2026-05-21；D-001 closed） |
| T-005A | 诊断 assistant message 写入 FK 失败（modelId 短 id） | [T-005A_AssistantMessageFK/](./T-005A_AssistantMessageFK/) | ✅ 诊断完成 |
| T-005B | 修 assistant message modelId FK（StreamingService 一处清洗） | [T-005B_修复ModelIdFK/](./T-005B_修复ModelIdFK/) | ✅ 已验证关闭（commit `15ad2eb08`，2026-05-21；D-002 closed） |
| T-006 | Text Anchor Branch UI 原型（设计 + 6 子任务） | [T-006_TextAnchorBranchUI/](./T-006_TextAnchorBranchUI/) | 🧠 设计完成；🔧 T-006B ✅ commit `d579fdcf2`；T-006C / T-006D-1 ✅ staged 未 commit；T-006D-2 / T-006A / T-006E / T-006F ⏳ |
| T-007 | Ollama Provider 自动模型同步失败诊断 + 修复（D-003A / D-003B） | [T-007_OllamaProviderFix/](./T-007_OllamaProviderFix/) | ✅ 已验证关闭（2026-05-21；与 T-008C 一起手测通过；D-003 closed） |
| T-008 | Chat Select Model 弹窗 v1/v2 数据断层（D-003C） | [T-008_ChatPickerV1V2Gap/](./T-008_ChatPickerV1V2Gap/) | ✅ 诊断 + T-008B 评估 + T-008C 实施全部完成（2026-05-21） |
| T-008C | Chat 模型选择器迁 v2（方案 B 实施） | [T-008C_ChatPickerV2Migration/](./T-008C_ChatPickerV2Migration/) | ✅ 已验证关闭（2026-05-21；fresh install 实测 Ollama + gemma4:e4b 通过） |
| T-009 | 流式管线不回灌 Redux（D-004 + D-005 同源诊断） | [T-009_StreamingNotDispatchedToRedux/](./T-009_StreamingNotDispatchedToRedux/) | 🩺 诊断完成；🔧 方案 A（cache→Redux 桥）/ B（渲染层切 cache）/ C（完成时单次 dispatch）待用户选 |

## 命名约定

- 文件夹：`T-XXX_主题名`，主题用 kebab 风格但允许中文（`T-003_BaselineDebug` 或 `T-004_修复DefaultAssistantSentinel`）
- ID 单调递增，跨日跨主题不重置
- 每个任务文件夹至少有 `任务.md`

## 何时新建任务

- 多步实施类工作（如代码修复、UI 重构、迁移）→ 是
- 单次问答 / 信息查询 → 否，不创建
- 跨多日的探索 → 是，每个里程碑单独命名
