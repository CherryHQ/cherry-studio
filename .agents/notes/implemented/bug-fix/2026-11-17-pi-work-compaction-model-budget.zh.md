# Agent Note：Pi Work 压缩预算跟随所选模型

Status: implemented

[English](2026-11-17-pi-work-compaction-model-budget.md) | 中文

## Problem

Pi Work 对所有模型使用 Pi 默认的压缩设置：`reserveTokens: 16384`、`keepRecentTokens: 20000`。在 49,152 token 的自定义模型上，触发线停在 32,768 token，仅保留尾部就可能接近 40,960 token 的输入空间，因此压缩之后仍可能出现上下文溢出的 400 错误。Pi 默认的摘要器还会把整段旧内容一次性序列化进同一个请求，且没有输入预算，摘要请求本身也可能超出同一窗口。这就是 issue #20963 报告的根因。

## Decision

Pi Work 的压缩设置由所选模型推导。`reserveTokens` 等于输出预留加上 10% 的估算余量，并且被限制为触发线至少保留窗口的 20%（`MIN_INPUT_ROOM_RATIO`）。`keepRecentTokens` 为窗口的 20%。这些计算位于 `src/main/ai/runtime/pi/piCompactionSettings.ts`，由 `PiRuntimeConnection` 以 `compaction` 形式传入。

Pi Work 通过 `compaction.summarize` 提供宿主摘要器 `src/main/ai/runtime/pi/piCompactionSummarizer.ts`。它使用绑定的模型运行时和网关用量请求头发出摘要请求，输入上限为模型输入空间的 80%。超出上限时，它保留初始消息和能放下的最新消息，并告诉摘要器省略了多少更早的消息。只有 pi-ai 的 `isContextOverflow` 识别为溢出时，才会以一半预算重试一次；其他失败原样抛出，压缩取消，并保留原始 provider 错误。

`packages/agent-runtime-pi` 中的 `PiSessionOptions.compaction` 现在接受 `summarize`，包的入口导出 `CompactionSummarizer` 与 `CompactionSummaryRequest`。这是宿主接管摘要的唯一途径。

## Alternatives considered

- 打补丁修改 `pi-coding-agent` 以限制 `serializeConversation`。这样能保留 Pi 原生摘要器，但每次升级 Pi 都要维护 pnpm 补丁，也无法复用 Cherry 的逐请求用量捕获。因此选择宿主摘要器。
- 使用 Pi 的 `modelOverrides` 设置 reserve 与 keep-recent。未采用：需要把每个模型的键写入设置，且摘要请求仍然没有上限。
- 只限制 reserve，摘要器保持原生。未采用：问题中第二种失败模式，即摘要请求溢出，依然存在。

## Consequences

- Pi Work 的压缩摘要改由宿主摘要器生成。其用量通过 `ApiGatewayService.captureAgentSessionUsage` 记到根智能体会话。子智能体会话的摘要使用根模型，并归属根会话。
- 重试一次后仍溢出的摘要请求会使压缩失败；对话保持不变，并报告 provider 错误。
- 没有声明 `contextWindow` 的模型，这些预算使用 `DEFAULT_AGENT_CONTEXT_WINDOW`（256K），与智能体运行时已有的回退相同。若真实窗口较小且未声明，仍可能溢出。

## Verification

- Regression — `src/main/ai/runtime/pi/piCompactionSettings.test.ts`：49K 模型的输出预留与触发线之间保持至少输出预留的空间，保留尾部低于触发线；小窗口的触发线至少保留窗口的 20%。
- Regression — `src/main/ai/runtime/pi/piCompactionSummarizer.test.ts`：超长转录保留初始消息与最新请求，并披露被省略的消息；真实溢出以更小的提示重试一次；非溢出失败不重试。
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`（`compacts through the Pi facet without replaying history or creating a second user input`）：历史超过保留预算时，手动 `/compact` 完成且没有 error 事件。
