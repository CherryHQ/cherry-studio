# Agent Note: 内容压缩窗口

Status: proposed

[English](2026-11-17-content-compression-window.md) | 中文

## Problem

Chat 上下文目前是全有或全无。`maxMessages`（`applyMaxMessagesWindow`，`src/main/data/services/MessageService.ts:130`）只保留最近 N 条消息，更早的全部丢弃。设置后，`PersistentChatContextProvider` 直接发送原始窗口，并完全跳过压缩（`src/main/ai/streamManager/context/PersistentChatContextProvider.ts:958-962`）。预算压缩仅在未设置 `maxMessages` 时运行，且只有估算值超过 `compress.thresholdPercent`（默认 80%）时才触发。想保留更早轮次作为上下文的用户，只能逐字发送所有轮次（长对话或推理密集场景下成本很高），或者丢失它们。Issue #19711 希望在两者之间增加一个中间层。

## Proposal

新增 Chat 持久化设置 `compressWindow`（轮数 B，未设置即关闭）。它是全局偏好，并可在助手级别覆盖，沿用现有 `chat.context_settings` 的分层规则。

设置 `compressWindow` 后，它在该请求中替代 `maxMessages` 作为历史发送上限。以对话轮次计（一条用户消息加上回答它的助手回合），A = `maxMessages`：

1. 第 1..A 轮逐字发送。
2. 第 A+1..B 轮替换为一个压缩块，由解析出的压缩模型生成（`compress.modelId`，未设置时回退到请求模型），复用现有摘要路径 `summarizeModelMessages`。
3. 第 B 轮之前的更早轮次不发送，并撤销对它们的 `read_file` / `fs_read` 访问，与 `retainedForWindow` 对 `maxMessages` 的处理一致。

校验：B 必须大于 A。B ≤ A，或设置了 `compressWindow` 但未设置 `maxMessages`，会在设置界面中以明确提示拒绝。请求时视为关闭，沿用现有 `maxMessages` 行为。

压缩失败必须显式处理。压缩模型不可用或摘要失败时，请求只发送 A 轮窗口，并记录失败日志。绝不能在压缩区缺少轮次的情况下，仍将其作为已压缩的内容发送。

原始消息行不修改，只改变下发的上下文。

待审批的开放问题：压缩区摘要是按边界持久缓存，还是每次请求重新计算；设置界面与后端是否在同一层交付，还是放到后续层。

## Alternatives considered

- 保留 `maxMessages` 并调整 `thresholdPercent`：无法表达“摘要中间轮次、丢弃其余”，也无法解决 Issue 中的成本问题，因为压缩只在接近预算时触发。
- 压缩区使用本地规则提取：成本更低但质量较差；Issue 首选的策略是压缩模型，因此此方案暂缓。
- 仅截断工具输出：减小工具结果体积，但不限制轮数。
- 压缩窗口与硬性 `maxMessages` 上限并存：会形成两个相互竞争的上限，并使 B 区含义模糊；所选设计让 B 定义窗口。

## Acceptance criteria

- AC1 — 当 `maxMessages` = A 且 `compressWindow` = B > A 时，请求包含最近 A 轮原文、第 A+1..B 轮的一个压缩块，且不包含第 B 轮之前的任何内容。（verification: unit）
- AC2 — `compressWindow` 未设置、B ≤ A，或设置了 `compressWindow` 但未设置 `maxMessages` 时，保持现有 `maxMessages` 行为，且设置界面拒绝无效配置。（verification: unit）
- AC3 — 压缩模型不可用或摘要失败时，请求只发送 A 轮窗口，不会把任何压缩块呈现为成功。（verification: unit）
- AC4 — 第 B 轮之前的轮次撤销 `read_file` / `fs_read` 访问，窗口内的附件仍可访问。（verification: unit）
- AC5 — 使用压缩窗口发送请求后，原始消息行保持不变，并通过真实 SQLite 验证。（verification: unit）
- AC6 — 设置界面提供压缩窗口开关和轮数输入框，并显示 AC2 所述的校验提示。（verification: renderer）

## Risks

除非摘要被缓存，否则每次请求都要摘要 B−A 轮，会增加延迟和成本；缓存决策见上方开放问题。摘要质量取决于所选压缩模型，即使每轮都有所体现，摘要本质上仍是有损的。压缩区的摘要请求本身可能超限；它们沿用摘要器预算。相关：`proposed/bug-fix/2026-11-13-chat-context-overflow.md` 负责超限恢复和摘要器预算；本 Spec 复用该摘要器，不改变其恢复语义。
