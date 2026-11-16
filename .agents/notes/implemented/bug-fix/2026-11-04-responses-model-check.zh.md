# Agent Note: Responses 模型检测使用流式请求并等待完整终止结果

Status: implemented

[English](2026-11-04-responses-model-check.md) | 中文

## Problem

`AiService.checkModel()` 的文本分支发送非流式请求。因此，仅支持 `stream: true` 的 OpenAI Responses 兼容端点即使能够正常进行流式对话，也会在设置页的检测中失败。[Issue #22784](https://github.com/CherryHQ/cherry-studio/issues/22784) 报告了这一情况。

收到流或首个文本块不能证明模型检测成功：端点可能在返回部分输出后报错或断开连接。

## Decision

当模型解析后的端点为 `openai-responses` 时，文本检测使用流式请求。选择依据是包含模型覆盖配置的有效端点，而非提供商名称。其他端点的检测保留现有传输方式。

检测消费流直至结束，并且只有收到已识别的终止原因后才返回延迟。正常终止原因 `stop`、`length`、`content-filter` 和 `tool-calls` 均可接受；`error`、`other` 或缺少终止原因均使检测失败。流错误或中止同样会使检测失败，即使此前已经收到文本。正常完成后允许空文本，以保留原检测的约定。延迟衡量整个探测过程，而非首个 token 的到达时间。

现有请求路径保留调用方的 API 密钥覆盖值、超时和取消信号，以及工作期间的防休眠处理。探测的推理参数保持不变；独立的推理参数策略不属于本次修复范围。

## Alternatives considered

- 保留非流式 Responses 检测：对于仅接受流式 Responses 请求的端点，这会保留误报失败。
- 对所有文本端点都使用流式检测：没有证据表明其他传输需要修复，却会改变无关提供商的行为。
- 先尝试非流式请求，再用流式请求重试：有效端点已经能够确定传输方式，预先失败的请求只会增加调用次数及潜在计费。
- 收到首个输出块就判定成功：部分输出会掩盖后续失败和截断的流。

## Consequences

仅支持流式请求的 Responses 端点可以像其他可用模型路由一样通过检测。缓慢或不完整的流仍受现有超时限制。检测验证的是一次完整的小请求，不能证明长对话可靠性或该请求之外的提供商特有能力。

## Verification

- Regression — `pnpm test:main src/main/ai/__tests__/AiService.modelCheck.integration.test.ts`：9 项测试通过。真实 SDK 路径覆盖仅支持流式请求的 Responses 端点、模型端点选择、指定 API 密钥、HTTP 错误、部分文本后的失败、截断的流、超时、调用方取消，以及保持非流式的 Chat Completions 检测。修复前，仅支持流式请求的端点以 HTTP 400（`stream must be true`）拒绝探测。
- Regression — `pnpm test:renderer src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/useHealthCheck.test.tsx`：健康检测调用方的 26 项测试通过。
- Regression — `pnpm typecheck:node` 和 `pnpm i18n:check` 通过。

本次改动尚未验证真实提供商的接受情况及打包平台行为。
