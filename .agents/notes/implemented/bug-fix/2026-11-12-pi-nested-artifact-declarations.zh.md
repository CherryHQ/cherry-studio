# Agent Note: 保留 Pi 嵌套产物声明

Status: implemented

[English](2026-11-12-pi-nested-artifact-declarations.md) | 中文

## Problem

Pi codemode 脚本调用内置产物声明工具时，外层脚本输出可能只有回执。产物卡片需要声明的结构化参数。Pi 已在原生历史中保留有界的嵌套调用证据，但运行时投影丢弃了它。

## Decision

Pi 运行时适配器在外层工具结果中保留原生 `nestedCalls`，包括错误结果和文件历史。桌面消息装饰将成功的内置 `cherry-tools/report_artifacts` 声明转换为普通产物工具片段，使用原生调用标识和通过 schema 校验的参数。声明不要求输出载荷，因此投影输出为 null，不伪造工具回执。

只有成功且参数完整有效的记录符合条件。外层脚本随后失败不会撤销已经成功的声明。重复装饰不会复制调用标识。其他服务器和工具保持不变。

## Alternatives considered

- 解析控制台输出会丢失类型化参数，并将任意文本误当作执行证据。
- 直接向模型公开工具无法阻止 codemode 中的调用。
- 重建所有嵌套工具输出会伪造 Pi 有界记录中不存在的信息。

## Consequences

现有产物卡片和右侧面板对直接调用与嵌套调用使用同一声明契约。原生历史仍是事实来源；不增加数据库迁移或渲染端专用恢复机制。参数被省略的有界记录不能生成卡片。缺少原生证据的历史产品消息不会通过解析文本修复。本修复覆盖普通 Pi，不覆盖 Pi Durable。

## Verification

- Regression — `src/main/ai/runtime/pi/piNativeTools.test.ts`：真实 Pi、MCP 传输和 QuickJS 生成结构化内置产物声明；同名外部工具不会生成声明。
- Regression — `src/main/ai/runtime/pi/PiMessageMetadata.test.ts`：外层脚本失败后仍保留成功声明；排除失败、未完成、截断和无效声明；重复装饰不产生重复项。
- Regression — `packages/agent-runtime-pi/tests/runtime.test.ts`：嵌套调用参数和状态在实时观察、归档投影和原生文件重开后保留，包括外层错误场景。
