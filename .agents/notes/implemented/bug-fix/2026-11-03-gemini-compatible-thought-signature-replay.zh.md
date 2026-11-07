# Agent Note: 在兼容接口回放时保留 Gemini 签名

Status: implemented

[English](2026-11-03-gemini-compatible-thought-signature-replay.md) | 中文

## 问题

通用兼容 SDK 将工具签名保存在配置的提供商命名空间，但序列化器读取规范 Google 或兼容 wire 命名空间。回放时真实签名可能被跳过验证的哨兵值替代。

## 决策

通用兼容适配器的 Gemini 3/4 chat completions 回放依次选择规范签名、wire 签名和配置命名空间签名。最后一种投影到 wire 字段，再由原有逻辑补充哨兵值，同时保留其他 wire 字段。无效签名字段仅从副本中移除，避免遮挡兜底；调用之间不共享签名。

## 考虑过的替代方案

写入规范 Google 字段会使 SDK 替换整个 `extra_content` 对象；扫描其他命名空间可能回放外来签名，因此均不采用。独立的 [Pi 身份决策](2026-10-29-pi-google-replay-identity.md)仍然有效。

## 影响

原始命名空间和其他选项保持不变。本决策不建立跨模型签名身份，也不改变原生 Google 和 Pi 回放。

## 验证

- AC1 — `geminiThoughtSignatureReplay.test.ts`：保存在连接命名空间的真实签名会进入最终请求体的 `tool_calls[].extra_content.google.thought_signature`，而不是哨兵值。
- AC2 — 同一文件：投影按请求经注册链执行且不保留请求级状态，后续步骤读到同一批已存签名。
- AC3 — 题述四个模型 ID 在没有真实签名时按最终请求体回落到哨兵值。
- AC4 — 真实规范签名优先并原样写出。
- AC5 — `extra_content` 带同级字段时真实 wire 签名仍保留。
- AC6 — 规范值为哨兵或非字符串时真实 wire 签名仍保留。
- AC7 — 投影值进入 wire，同时 `extra_content` 与 `google` 的同级字段保持不变。
- AC8 — 只有外部 provider 命名空间带签名时不采用它，走兜底。
- AC9 — 空串、空白、非字符串与哨兵值回落到兜底而不进入请求体。
- AC10 — 无效的规范值与 wire 值都不能遮挡兜底。
- AC11 — 每个工具调用保留自己的签名，ID 与工具结果一一对应。
- AC12 — 深度冻结的输入不被改写，重复请求不继承先前的签名。
- AC13 — 非 Gemini 模型与非 chat completions 端点不会得到该投影字段。
- AC14 — text 与 reasoning 的签名不会被搬到工具调用上。
- AC15 — `internalFeatures.test.ts` 断言激活条件、在旧 skip feature 之前的顺序，以及真实的 `sdkConfig.providerOptionsKey` 命名空间。
- Regression — 对四个 feature/params 文件加 `piGoogleReplay.test.ts` 跑 `node node_modules/vitest/vitest.mjs run --project main`：5 个文件、202 项测试通过；Pi 与原生 Google 的 foreign/unsigned 边界保持不变。
