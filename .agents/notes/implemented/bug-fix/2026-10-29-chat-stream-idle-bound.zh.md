# Agent Note: 延长聊天流的解析块空闲时限

Status: implemented

[English](2026-10-29-chat-stream-idle-bound.md) | 中文

## 问题

`AiStreamManager` 使用 `withIdleTimeout()` 包装聊天执行，每收到一个解析后的 UI 块就重置计时器。此前默认值为 `DEFAULT_TIMEOUT`（30 分钟）。提供商的 SSE 注释心跳不会成为块，因此静默推理阶段达到该时限时，即使注释仍在持续到达，流也会中止。

这一时限无法完整解释 [Issue #23011](https://github.com/CherryHQ/cherry-studio/issues/23011) 报告的 19–30 分钟时间范围：30 分钟的时限无法导致第 19 分钟的中止，更早发生的中止原因仍未明确。

## 决策

`CHAT_STREAM_IDLE_TIMEOUT_MS` 为聊天执行提供专用的 120 分钟默认时限。`DEFAULT_TIMEOUT` 对其他使用方仍保持 30 分钟。显式的 `requestOptions.timeout` 仍优先生效，包括网关的 20 分钟覆盖值。省略 `idleTimeoutMs` 时，`streamPrompt()` 继承执行层的默认时限；其请求构造逻辑不变。可配置性和自动重试仍由 [Issue #16659](https://github.com/CherryHQ/cherry-studio/issues/16659) 处理。

## 考虑过的替代方案

- 直接修改 `DEFAULT_TIMEOUT`：否决，因为提供商传输和 Claude Code 运行时环境也使用该值。
- 通过心跳重置计时器：否决，因为解析器在包装器的解析块边界之下就丢弃了 SSE 注释。
- 移除或暂停计时器：否决，因为已经失效但仍保持打开的流最终仍必须失败。
- 使用 60 分钟：否决，因为其余量小于代码库已接受的两小时审批等待时限。

## 影响

直接聊天轮次以及 translate 和 miniApp 使用的内部提示词流都继承更长的时限。因此，已经失效但仍保持打开的内部流会在两小时后回收，而非 30 分钟后。时限仍然有限；心跳处理和审批计时不变。

## 验证

- Regression — `AiStreamManager.test.ts`：没有超时覆盖值的直接聊天轮次在 30 分钟和 120 分钟减 1 ms 时仍保持存活，到 120 分钟时因空闲 `TimeoutError` 中止，并且恰好结算一次为 paused，没有 done 或 error 终态。
- Regression — `AiStreamManager.test.ts`：未提供 `idleTimeoutMs` 的内部提示词流在 30 分钟时仍保持存活，超过 120 分钟后因空闲 `TimeoutError` 中止，结算为 paused 而非完成。
- Regression — 仅将更新后的管理器测试文件复制到干净的 `0f95a597ab43d9209bcfe8c6593ae194ddc6183c` 基线，两个新增测试均在 30 分钟存活断言处失败；随后恢复基线。
- Regression — 管理器（137 项）、`withIdleTimeout`（8 项）、网关流代理（91 项）、翻译服务（18 项）和 miniApp AI（42 项）测试套件全部通过，同时对变更文件的 Oxlint、ESLint、Oxfmt、node TypeScript 检查与全部文档检查也通过。
