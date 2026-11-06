# Agent Note: Work 遵循模型声明的工具能力

Status: implemented

[English](2026-11-06-work-tool-capability.md) | 中文

## 问题

即使所选模型未声明函数调用支持，Work（智能体会话）请求仍可能携带工具定义到达提供商。Claude Code 的 Anthropic 直连路由绕过共享的 `buildAgentParams` 检查，因此能力列表不含 `function-call` 的模型仍会在该路由上收到原生/MCP 工具。Work 也没有提示来解释纯文本运行状态。提供商拒绝此类请求时（`code 20037`、`Function call is not supported for this model.`），错误显示为通用的 bad-request/unknown，且带状态码前缀的 JSON 消息丢失了提供商自己的描述。

## 决策

`agentSessionWarmup.ts` 将 `function-calling-unsupported` 纳入网关降级原因，通过 `isFunctionCallingModel` 分别检查已解析的 primary/plan/small 模型槽位。Work 输入区以信息提示显示 `code.model_tools_unavailable`，同时保持该轮可发送。

`tool_calling_unsupported` 是由 `isToolCallingUnsupportedErrorMessage` 识别的错误类别。安全的提供商消息提取逻辑从带状态码前缀的 JSON 封装中恢复提供商的描述。渲染进程为该类别提供前往提供商设置的入口，并在警告 toast 中提供 `Switch model` 操作。

## 考虑过的替代方案

- 阻止不支持工具的 Work 轮次：已否决，因为 Pi、Pi Durable 和网关已经支持纯文本运行；阻止这些轮次会造成回归。
- 在共享检查中统一按能力拦截：现有的 `buildAgentParams` 检查已对不支持工具的模型排除客户端工具，但它不覆盖 Claude Code 的直连路由。
- 清理助手自定义原始请求体中的 `tools` 参数：这是另一个真实的绕过路径，但仅涉及助手，不在本次变更范围内。
- 根据模型名称或厂商错误码推断能力：已否决，因为能力数据按模型显式声明，且用户可覆盖；单独的 `20037` 无法证明工具调用不受支持。

## 影响

任一已解析的 Claude 模型槽位不支持工具时，连接通过内部网关运行。所有已解析槽位都支持函数调用的连接，在满足其他条件时保留直连路由。输入区解释纯文本运行状态，提供商因能力不足而拒绝请求时显示具体诊断及提供商的描述。用户显式设置的能力差异仍然优先。独立的提供商原生服务端工具（联网搜索）策略保持不变。助手原始请求体中的 `tools` 参数仍是已知且未修复的绕过路径。

## 验证

- Regression — `src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts`：不支持工具的主模型使用网关，不支持工具的 plan/small 槽位记录 `function-calling-unsupported`，支持工具的模型选择保留直连路由，external-CLI 路由与模型固定行为保持不变。
- Regression — `src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`：现有共享检查对不支持工具的模型排除通过 `callOverrides` 传入的客户端工具，对支持工具的模型则保留该工具。
- Regression — `src/shared/utils/__tests__/errorCategory.test.ts`：明确拒绝函数/工具调用的描述归类为 `tool_calling_unsupported`；单独的厂商错误码、不支持的参数、格式错误的参数和 MCP 执行失败不归入该类别；结构化服务端状态优先。
- Regression — `src/shared/ai/__tests__/providerError.test.ts`：带状态码前缀的 JSON 显示提供商的描述，普通消息保持完整，恢复的详情遵守长度限制。
- Regression — `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`：不支持工具的模型显示提示，输入文本后发送仍可用；选择支持工具的模型后提示消失，发送仍可用。
- Regression — `src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`：普通错误中的带状态码前缀 JSON 显示能力诊断、提供商的描述和设置操作入口。
