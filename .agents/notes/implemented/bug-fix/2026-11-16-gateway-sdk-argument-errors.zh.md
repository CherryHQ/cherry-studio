# Agent Note: SDK 参数校验失败属于网关请求错误

Status: implemented

[English](2026-11-16-gateway-sdk-argument-errors.md) | 中文

## 问题

Google SDK 会在调用 fetch 前拒绝无效的服务商选项。其 `AI_InvalidArgumentError` 不带 HTTP 状态，因此网关此前返回 500，将确定性的参数错误表示为服务端故障（#24572）。修复某个 SDK 选项枚举并不能解决其他无效参数的状态映射。

## 决策

对于没有 HTTP 状态、名称为 `AI_InvalidArgumentError` 的错误，网关在各生成协议中统一映射为 400。精确错误名能通过现有序列化边界，SDK 实例标记不能。显式 HTTP 状态仍然优先。独立的 `AI_TypeValidationError` 不适用此规则，因为它可能描述无效的上游响应。

新分支仅将选定的消息交给现有的有长度限制的服务商消息清理工具；没有安全消息时使用 `Invalid request parameters`。它不检查或公开参数值或原因。经过认证的内部请求保留现有的可信原因详情行为，公开响应仍排除诊断附加字段。

## 考虑过的替代方案

- 返回 500 会错误描述参数拒绝，并可能使客户端重试未改变的请求。
- 将所有校验错误映射为 400，会把上游响应格式错误归咎于调用者。
- 只测试错误实例会遗漏流边界实际传递的普通序列化错误对象。
- 直接转发原始参数错误消息可能暴露载荷或凭据；选择 HTTP 状态本身不会清理文本。

## 后果

响应提交前，生成请求返回 HTTP 400，并采用对应协议的请求错误词汇。SSE 提交后，HTTP 保持 200，由终止错误帧携带请求错误分类。本修复不改变 SDK 校验、模型支持的选项或客户端重试策略。测试不声称验证了真实上游服务或下游运行时的重试行为。

## 验证

- Regression — `src/main/features/apiGateway/__tests__/errors.http.test.ts`：真实 Google SDK 的无效选项调用不会触发 fetch；通过真实本地套接字，在四种协议、流提交前后验证原始及序列化错误。凭据和载荷消息得到清理，显式状态优先，独立响应校验保持区分，可信内部原因详情得以保留。
- Regression — `src/main/features/apiGateway/__tests__/proxyStream.stream.test.ts` 和 `src/main/ai/utils/__tests__/serializeError.test.ts`：受影响的流处理及序列化调用方保持现有行为。
