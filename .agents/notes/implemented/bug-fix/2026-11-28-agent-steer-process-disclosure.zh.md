# Agent Note: 智能体插话后按过程组收尾折叠

Status: implemented

[English](2026-11-28-agent-steer-process-disclosure.md) | 中文

## Problem

插话前后的显示分段共用活跃 Run 的来源 ID，导致插话前的过程组继续渲染为进行中。即使新输入已经落位，工具已结束的过程组也要等整个 Run 结束才折叠。

## Decision

沿用[智能体时间线 Spec](../../proposed/architecture/2026-11-19-agent-session-timeline-and-context-transfer.md)中的归属。时间线标记分段是否位于其 Run 的最近一次已落位输入之前。对于这些较早的分段，共享渲染器在组内各 part 收尾且焦点离开后，应用现有的已完成折叠策略。两条布局路径都用归一后的工具状态识别待审批、执行中的工具和初步结果。

## Alternatives considered

以最后一个可见分段作为活动边界，会让旧组一直展开到新输出到达。插话落位时结束旧段的实时订阅，则会中断仍归旧段所有的工具更新。

## Consequences

已完成的组可以在下一段回复开始前折叠。执行中的 part 保留原订阅和原位置。手动展开状态使用分段和过程组的标识。正文仍然在组外显示，暂停后重新打开 Run 时也可见。

## Verification

- Regression — `src/renderer/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx`: 排队的输入不改变组的活动状态。插话落位后，已收尾的组会折叠，另一组收到初步结果时仍保持活跃，收到最终结果后仍保留工具上的键盘焦点。
- Regression — `macOS Electron, Pi Durable and a local mock provider`: 上一段的过程组在插话后开始输出前折叠。停止并重新打开 Run 后，插话前后的正文都保留。
