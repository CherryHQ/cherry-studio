# Agent Note: 被拒绝的请求体被诊断为 AI 内容无效

Status: implemented

[English](2026-10-25-request-body-parse-classification.md) | 中文

## 问题

`src/shared/utils/errorCategory.ts` 中的 `classifyErrorCategory` 会在拼接后的 message/response-body/data 文本里匹配裸子串 `failed to parse`，并返回 `parse`。`parse` 是响应侧诊断：渲染层把它映射为 `error.diagnosis.parse`——"AI 返回的内容格式无效，请重试或更换模型"。

因此上游拒绝请求体时也会落进这个分类。#22164 用 `openai:gpt-5.6-sol` 报告了这一点：底层错误是 `Failed to parse request body`，聊天区块却告诉用户 AI 返回了无效内容。这个故障还被错误地横向归因：用户被引导去为一个请求侧失败更换模型，同时 `bad_request` 的恢复动作（服务商设置）也丢失了，因为 `parse` 没有 `navTarget`。

该措辞来自上游。`Failed to parse request body` 在 `src/` 与 `packages/` 中零命中，说明它由服务商或网关拒绝请求体产生，并且它总是伴随 HTTP 400 出现——而 400 状态码对任何其他原因都已经被分类器路由到 `bad_request`。

## 决策

当 `failed to parse` 指向请求时，把它排除在响应解析分支之外，使其落入既有的终止分支 `return status === 400 ? 'bad_request' : 'unknown'`：

```ts
const requestParseFailure = msg.includes('failed to parse') && msg.includes('request')
...
(!requestParseFailure && msg.includes('failed to parse')) ||
```

对其他所有措辞，该关键词保持宽松。若改为用响应名词列表来限定，会回归一条真实消息：`@ai-sdk/gateway` 抛出 `Failed to parse video SSE event`，应用通过 `createGatewayWithImageModel` 会走到它，那样它会变成 `unknown`。因此要拦的是请求侧而不是响应侧——响应侧词汇是开放集，请求侧不是。

## 备选方案

- 完全删除 `failed to parse` 短语：不采用，因为使用它的响应侧失败（尤其是 gateway provider 的 `Failed to parse video SSE event`）会落入 `unknown`，丢失既有的 parse 诊断。
- 用响应名词列表限定该关键词（`response`/`output`/`stream`/`json`/…）：同样不采用，原因相同——列表之外的响应侧措辞会静默变成 `unknown`。
- 特判精确字符串 `Failed to parse request body`：不采用，因为上游措辞会变（`We could not parse the JSON body of your request.`、`request failed to parse`），而分类器刻意按信号分类，而非按上游原文匹配。
- 改为在渲染层的 `classifyError` 中处理：不采用，因为 `classifyErrorCategory` 是主进程（`processExitDiagnostics`、连通性 doctor 检查、`serializeNestedProviderError`）也依赖的唯一共享来源；只在渲染层修复会让这些路径继续出错。

## 后果

被拒绝的请求体现在报告"服务商请求失败（HTTP 400）"，并带有服务商设置的恢复动作；服务商自己的原文仍保留在错误详情中。真正的响应解析失败不受影响。`classifyErrorCategory` 仍从自由文本分类，没有结构化的请求/响应判别字段，因此同时提到请求与响应解析的消息依然有歧义；此时请求侧优先，这是更安全的默认值，因为重试无法修复被拒绝的请求体。

## 验证

- 回归 — `pnpm test:shared src/shared/utils/__tests__/errorCategory.test.ts`：54 项测试通过。新增：四种请求体拒绝措辞分类为 `bad_request`（直接、JSON 包裹、上游措辞、词序颠倒）；五种响应侧解析失败（含 gateway 的 `Failed to parse video SSE event`）仍分类为 `parse`；同一短语在无状态码时仍为 `unknown`。
- 回归 — `pnpm test:renderer src/renderer/utils/__tests__/errorClassifier.test.ts src/renderer/components/ErrorDetailModal/__tests__/isDiagnosticReportEligible.test.ts src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`：150 项测试通过，含新增的端到端用例，断言带 `Failed to parse request body` 的 400 得到 `error.diagnosis.bad_request` 与 `navTarget` `/settings/provider?id=openai`——即 issue 中的用户可见症状。
- 回归 — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/processExitDiagnostics.test.ts src/main/services/diagnostics/scan/__tests__/rules.fixtures.test.ts src/main/services/diagnostics/doctor/checks/__tests__/connectivity.test.ts src/main/ai/utils/__tests__/serializeError.test.ts`：79 项测试通过，覆盖共享该分类阶梯的主进程分类器。
- `oxlint`、`eslint` 与 `oxfmt --check` 在三个改动文件上通过；`tsc --noEmit` 在它们之中未报错。
