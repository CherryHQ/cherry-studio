# Agent Note: 在 Pi 连接身份变化后保留 Google 签名

Status: implemented

[English](2026-10-29-pi-google-replay-identity.md) | 中文

## 问题

Cherry 使用包含会话和连接代次的 provider 与 API 名称注册每个 Pi 连接。原生 Google 适配器却将助手消息标记为 `google-generative-ai`。Pi 回放历史时会比较 provider、API 和模型，因此调度用的 API 别名使同模型的工具回复被视为外来历史，导致 `thoughtSignature` 被删除。重连还会改变 provider 命名空间。这解释了 [#22810](https://github.com/CherryHQ/cherry-studio/issues/22810) 跟踪的原生 Google 工具续跑故障，即使原始签名仍然保存在原生会话文件中也会发生。

## 决定

[Google 流调用边界](../../../../src/main/ai/runtime/pi/piGoogleReplay.ts) 向 Pi 的 Google 适配器传入原生 API 身份。仅在回放时，当原生 API 和模型一致，且 provider 严格由当前配置的提供商 ID、会话 UUID 和连接代次 UUID 组成时，将先前 Cherry 连接的 provider 映射到当前连接。持久化历史保持不变。

注册表保留按连接隔离的 provider/API 名称和凭据查找方式。其他协议保留现有的流实现。真实签名、工具 ID、调用顺序和并行调用分组仍由 Pi 管理；该边界既不生成签名，也不放宽跨模型检查。

## 考虑过的替代方案

- 移除隔离的 API/provider 注册：拒绝，因为并发连接及替换连接不能相互覆盖流绑定。
- 禁用 Pi 的外来历史过滤，或重标记所有助手消息：拒绝，因为其他提供商或模型的签名必须继续被视为外来历史。
- 插入跳过校验的签名：拒绝，因为这些原生回复已有可以保留的真实签名。
- 改写已保存会话：没有必要；连接身份属于回放投影，不需要迁移原始回复。

## 影响

采用上述 UUID 命名格式的既有 Cherry Google 历史可以恢复，无需编辑文件。匹配仅限同一配置的提供商 ID、原生 API 和模型。未知的 provider 格式与真正的外来历史仍按 Pi 原有方式处理；该改动不解决任意跨提供商历史导入，也不处理 OpenAI 兼容接口中的 Gemini 签名问题。

## 验证

- Regression — `pnpm test:main src/main/ai/runtime/pi/piGoogleReplay.test.ts`：原生 Google 请求序列化保留并行和连续调用签名、带签名的文本，以及跨连接代次的序列化历史；外来身份保持不变，无签名调用也不会被伪造签名。
- Regression — `pnpm test:main src/main/ai/runtime/pi/modelInjection.test.ts`：生产路径的流构建逻辑在调度别名下保留工具签名，并保持其他协议的流不变。
- Regression — `pnpm test:main src/main/ai/runtime/pi/PiRuntimeConnection.test.ts src/main/ai/runtime/pi/PiRuntimeConnection.sdkContract.test.ts src/main/ai/runtime/pi/piGoogleReasoning.test.ts`：继续覆盖连接隔离、现有会话行为及 Google 推理配置。
