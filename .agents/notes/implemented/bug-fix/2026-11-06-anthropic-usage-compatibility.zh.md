# Agent Note: Anthropic 用量兼容

Status: implemented

[English](2026-11-06-anthropic-usage-compatibility.md) | 中文

## 问题

Anthropic provider 要求用量元数据齐全才接纳本来可用的正文。首帧输入计数、结束帧输出计数、整个用量对象或分段计数缺失，都会导致响应被拒绝。流式首事件处理器还把本地 schema 错误包装成 HTTP 500，造成误导的服务器错误展示和瞬态错误重试。LongCat 暴露了这个边界缺陷，但修复不是模型专属策略。

## 决策

现有 `patches/@ai-sdk__anthropic.patch` 允许流式与非流式响应的用量对象及输入／输出计数缺失或为 null。在 schema 边界将缺失对象规范化为空元数据对象。已提供但类型错误的计数仍然校验失败；正文与工具身份保留已有要求。不添加 provider／模型白名单或 runtime 兜底。

缺失的输入／输出总量保持 unknown，执行分段缺少该计数时也一样。后续报告的累计计数替换先前值，后续缺失的计数不会擦除已知值。明确的零仍为零。缓存桶保留现有协议默认值，advisor 分段仍不计入执行总量，fallback 回复保留顶层计量。派生总量和正文 token 数不会对缺失值进行算术运算。原始扩展元数据保留。

首事件处理器保留 `TypeValidationError`，不再制造 HTTP 500。原生过载事件仍产生可重试的 529 响应。公共／内部 ESM 和 CJS bundle 同步修复；源码及分段元数据声明体现可缺失计数。依赖保持 3.0.125，现有签名和输出上限补丁继续保留。

## 考虑过的替代方案

- LongCat 专属分支或只将首帧一个字段设为可选，会在其他模型、非流式回复、结束事件和归并时留下同一问题。
- 用零替代缺失计数，会把不可用的用量表现为已测量，并可能少算不完整分段。
- 禁用响应校验，会失去对正文、工具身份及错误类型值的保护。

## 影响

Provider 可以在计费元数据不完整时交付正文。消费者仍须区分 unknown 与已测量的零。此补丁没有解决其他 provider 的校验策略，也没有覆盖 Anthropic 的每个可选元数据字段。[Issue #23715](https://github.com/CherryHQ/cherry-studio/issues/23715) 跟踪跨 provider 审计、错误传播及与既有 Responses 工作的收敛。

## 验证

- Regression — `src/main/ai/provider/__tests__/anthropicUsageCompatibilityPatch.test.ts`：72 个用例通过四个生产 SDK 入口覆盖缺失／null／部分用量、延迟计数、分段求和、原始扩展、无效工具身份、校验错误及原生过载；补丁前 56 项失败，补丁后全部通过。
- Regression — 明确选择的八个 provider、规范化与 Gateway 测试文件通过 248 项测试，包含既有签名／输出上限行为及 Anthropic 流转换；该数字包含 72 项补丁用例。
- Regression — 重启后的 Electron 实例通过 Anthropic 端点使用 Pi Durable 和 LongCat-2.5，读取提示词中没有的本地随机文件值，显示并保存回复，记录两条用量。证据位于 `.context/cherry-electron-dev/anthropic-usage-live.json` 和 `electron-acceptance-usage-patch.log`；这不证明其他 provider 的真实调用覆盖。
