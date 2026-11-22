# Agent Note: 内容压缩窗口

Status: implemented

[English](2026-11-17-content-compression-window.md) | 中文

## Problem

有限的 `maxMessages` 原先仅保留按消息条数计算的原始窗口，并跳过请求开始时的持久压缩。用户只能逐字发送更早的轮次，或丢失它们。Issue #19711 希望增加一个有边界的中间层，同时在新模式关闭时保持原有行为。

## Decision

持久 Chat 提供可选的全局 `chat.context_settings.compress_window` 和助手级 `contextSettings.compressWindow`。全局默认值为 `null`（关闭）。助手值缺省时继承全局设置；显式 `null` 关闭窗口；数字选择自定义窗口。

当 A = `maxMessages` 为正整数，且整数 B = `compressWindow` 大于 A 时，每条用户消息开始一轮，包含此后直到下一条用户消息之前的所有助手续接。当前用户消息算作最新一轮。最近 A 轮逐字保留，第 A+1 到 B 轮形成一个摘要，更早的轮次及其 `read_file` / `fs_read` 权限被排除。短历史不需要摘要。

`PersistentChatContextProvider` 使用现有摘要器和解析出的压缩模型。输入和输出受压缩模型声明的窗口约束，未声明时回退到请求模型声明的最小窗口。每次请求重新计算摘要，不缓存或持久化。源消息行和已有持久标记不变；旧标记可能包含已排除的内容，因此不复用。文件和已存储输出清单标识被摘要的附件。

压缩缺失或关闭、输入空间未知或不足、输出为空以及抛出错误时，记录警告并仅发送最近 A 轮，不提供成功摘要块。窗口关闭或配置无效时保留原有消息条数语义。

常规设置在溢出策略总开关之外提供窗口开关和总轮数输入。启用时使用一个大于 A 的有效窗口；UI 拒绝缺少 A 或 B 不大于 A 的配置。修改 A 不能使已启用的 B 失效。无效数字编辑保留在输入框中并显示错误，不进入持久化。助手编辑器独立于溢出覆盖设置提供自定义、关闭和跟随全局。窗口启用时，UI 将最近限制标为轮数，并说明每次请求额外的模型费用以及仅发送最近轮次的回退行为。

## Alternatives considered

- 仅调整预算触发点无法表达有边界的中间轮次范围。
- 本地规则提取成本更低，但不提供所选方案的模型摘要。
- 工具输出截断不能限制对话轮数。
- 并存的消息条数硬上限会使压缩区域含义不清，因此由 B 决定轮次窗口。
- 复用持久摘要可能重新引入 B 之前的内容；不缓存可避免分支变化后的陈旧结果。

## Consequences

每次请求总结中间区域会增加延迟和模型费用。摘要有损，摘要器本身也可能溢出。摘要预算和溢出处理仍由原有模块负责；`proposed/bug-fix/2026-11-13-chat-context-overflow.md` 记录了该独立决定。此模式默认关闭。后端和设置层可以分别评审，不能将仅后端实现当作完整功能。

## Verification

- AC1 — `compressionWindow.test.ts` 和 `PersistentChatContextProvider.compaction.test.ts`：用户消息起始的轮次边界、最近轮次原文、有边界的中间摘要以及更早消息的排除。
- AC2 — `ContextManagementSettings.test.tsx`、`compressionWindow.test.ts` 和请求/上下文解析测试：无效边界不持久化，修改或清空 A 不能使 B 失效，请求配置缺失或无效时保留原有行为。
- AC3 — `PersistentChatContextProvider.compaction.test.ts`：压缩不可用或关闭、输入空间不足或未知、空摘要以及抛出错误时，仅返回最近轮次且不带成功标记。
- AC4 — `PersistentChatContextProvider.compaction.test.ts`：撤销已排除的文件和已存储输出权限，同时保留实时窗口和摘要窗口的访问与标识能力。
- AC5 — `compressionWindow.sqlite.test.ts`：经过真实生产迁移的 SQLite 历史（含已有持久标记）在摘要成功和失败时均逐字节不变。
- AC6 — `ContextManagementSettings.test.tsx` 和 `EditDialogs.test.tsx`：真实控件、明确验证以及防抖自动保存的自定义/关闭/跟随全局 PATCH 边界；已检查英文亮色和中文暗色窄屏浏览器预览。

最终限定范围运行覆盖 21 个显式文件中的 411 个通过测试（main 229、shared 11、renderer 171）。预览使用持久化/主题/提供商夹具，不是原生 Electron 会话。未执行真实或付费模型调用、全项目本地类型检查或全项目本地 lint；更广范围 CI 及原生/提供商验收仍是独立评审边界。
