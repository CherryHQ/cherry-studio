# Agent Note: AI 执行失败的职责归属

Status: implemented

[English](2026-11-28-ai-execution-failure-ownership.md) | 中文

## Problem

普通聊天和 Work 经由不同的流协议进入同一错误界面。流中可能携带原始错误，也可能只有展示文本。渲染层目前会把响应流中原因未明的失败当作传输中断。持久化可能从同一个错误推导出另一种诊断。

## Decision

主进程 AI 层根据最可靠的可用证据确定终止失败的原因，并单独记录发生阶段。运行时适配器在能取得带类型的错误时保留原始错误。如果上游请求只剩文本，可通过严格识别请求级 HTTP 400 前缀来恢复状态码。资源诊断正文中的 HTTP 状态码不能作为请求状态码。

普通聊天和 Work 的事件将已确定的失败结果交给实时界面和持久化。显式标为未知的原因保留为未知。传输中断须有传输层证据或带类型的失败。渲染层负责本地化提示，运行时适配器负责重试，日志负责上报策略。

沿用现有 AI 错误分类，在需要时映射到带版本的 `ExecutionFailure` 格式。继续读取旧消息并保留其已有诊断能力。服务商专有解析留在 AI 域，跨进程格式独立于 SDK 错误类。

## Alternatives considered

- 在渲染层恢复 HTTP 400。这能修正一条标题，持久化和其他流调用方仍会各自分类。
- 把流式响应期间观察到的每次失败都当作传输中断。服务商拒绝请求或原因未知时，这仍会报成网络问题。

## Consequences

历史错误仍可根据已保存的详情分类。响应流中原因未知的错误显示通用提示，明确的传输诊断继续显示中断提示。即使带版本的失败格式将请求错误表示为 `invalid_input`，普通聊天和 Work 仍保留桌面错误分类。

## Verification

- AC1 — `AiStreamManager.test.ts` 验证终止路径中的请求级 HTTP 400、结构化状态优先级、安全详情，以及资源诊断正文中的状态码隔离。
- AC2 — `AiStreamManager.test.ts` 核对终止事件与持久化错误片段是否一致。`PiDurableRuntimeConnection.test.ts` 检查从原生归档回复恢复后的 HTTP 400。
- AC3 — `errorClassifier.test.ts` 和 `ErrorBlock.test.tsx` 覆盖原因未知时的通用提示及明确传输中断时的提示。
