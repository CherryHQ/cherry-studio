# Agent Note: 输入框历史召回

Status: implemented

[English](2026-10-28-composer-input-history-recall.md) | 中文

## Problem

当草稿为空、被全选或光标到达现有历史导航边界时，普通上/下方向键会召回之前发送的输入文本。用户需要选择这些按键是否拦截历史导航，同时不改变历史存储和文本内部的常规光标移动。

## Decision

`chat.input.history_recall` 有三个值：`arrow` 使用普通上/下方向键，`ctrl_arrow` 使用平台主修饰键加上/下方向键，`off` 放弃历史拦截。默认值保持为 `arrow`，以保留未更改设置的用户的现有行为。外观设置中的可搜索输入设置独立于发送、换行和引导快捷键的互斥规则。

两个输入界面都使用现有快捷键绑定表示组合键，以 `CommandOrControl` 表示平台主修饰键。`matchesComposerShortcut` 归一化方向键名称并要求绑定完全相等，拒绝额外的修饰键。只有组合键边界了解策略值；纯导航守卫接收必填布尔值。输入法组合状态、QuickPanel 可见性、选区和边界资格均保留现有规则。

运行时通过在现有布局副作用中更新的 ref 读取最新策略，因此更改设置可更新保留的键盘处理器，而无需重建编辑器。延迟加载的回退界面使用同一守卫，但保留现有的 textarea 边界谓词，不尝试进行 ProseMirror 视觉行测量。

## Alternatives considered

- 通过命令/快捷键系统处理历史：不采用，因为 [CommandProvider.tsx:140](../../../../src/renderer/components/command/CommandProvider.tsx) 会在可编辑目标获得焦点时跳过无修饰键快捷键，而 [useCommandContext.ts:6](../../../../src/renderer/hooks/command/useCommandContext.ts) 未声明输入框焦点上下文键。更改该系统会使此功能超出输入框历史的范围。
- 在本地解析修饰键标志：不采用，因为现有匹配器已负责平台归一化和精确组合键匹配。
- 更改默认值或承诺禁用时移动光标：不采用。现有用户保留普通方向键行为，而禁用仅表示放弃历史拦截；光标行为仍由编辑器和其他处理器负责。

## Consequences

历史存储和草稿恢复保持不变。用户可以避免普通方向键拦截，也可以完全禁用召回。只有成功导航历史时才阻止默认事件；运行时还保留现有的停止传播行为，而回退界面不添加该行为。两个界面保留各自不同的边界能力。

## Verification

- Regression — 定向 renderer 运行：6 个套件、289 项测试通过，0 项失败（输入框守卫、运行时、延迟加载回退、运行时未加载时的策略、设置行和设置搜索）。
- Regression — Renderer 输入匹配器套件：10 项测试通过，0 项失败。Shared 快捷键套件：32 项测试通过，0 项失败。
- Regression — 基线守卫探针：6 项对照通过，6 项预期失败（`expected true to be false`）。基线界面策略用例：6 项预期失败；名称过滤器跳过了 173 项无关测试。
- Regression — Renderer 和 E2E TypeScript 项目通过，0 项错误。`i18n-check.ts` 通过，共检查 96,476 条翻译。变更文件的 Oxlint、ESLint、格式检查及 `git diff --check` 通过；Electron 规格被 lint 配置忽略，由 TypeScript 和格式检查覆盖。ESLint 报告了 1 条文件被忽略的警告，0 项错误。
- Acceptance — 真实 Electron 运行 `tests/e2e/smoke/composerInputHistory.test.ts`（隔离 profile、英文界面）：默认召回、主修饰键召回、禁用模式、不重建编辑器的运行中切换，以及重启后的持久性均符合约定。
