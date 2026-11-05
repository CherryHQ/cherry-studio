# Agent Note: MiniCPM-OCR 文件处理器

Status: proposed

[English](2026-11-05-minicpm-ocr-file-processor.md) | 中文

## Problem

当前文件处理只提供本地 OCR（tesseract、system、local PaddleOCR、OpenVINO）和远程文档服务（MinerU、Doc2x、Mistral、自托管 OpenMinerU），没有任何处理器能调用自托管的视觉语言 OCR 模型。MiniCPM-OCR 是 1.3B、Apache-2.0 的 OCR 模型，用户已经用 vLLM、SGLang、llama.cpp 或 Ollama 提供 OpenAI 兼容的 `/chat/completions` 端点，但 Cherry Studio 无法用它做图片 OCR——依赖都在用户自己那边，缺的只是客户端。

现有远程处理器都覆盖不了这种形态：Mistral 处理器绑定 Mistral SDK 的 `ocr.process` 请求体，文档处理器则期待任务/轮询协议。把它们指向 MiniCPM-OCR 服务会失败在协议层，而不是配置层。

## Proposal

新增 `minicpm` 远程文件处理器，第一层只实现 `image_to_text` 能力。

配置复用现有 capability 与 processor schema：`apiHost` 是 OpenAI 兼容的 base URL（例如 `http://127.0.0.1:8000/v1`）；`apiKeys` 可选，因为自托管服务通常不鉴权；`modelId` 可选，默认 `minicpm-ocr`。

处理器映射到现有契约：`minicpm` preset 声明 `image_to_text` 能力（含 `apiHost` 与可选 `modelId`），registry 条目使用 `runtime: 'remote'`、`isSupported: () => true`，把该能力路由到 `mode: 'background'` 的 handler。`prepare()` 解析 `apiHost`、`modelId` 和可选密钥；`execute(ctx)` 用 `ctx.signal` 发起 HTTP 请求、上报粗粒度进度并返回文本。错误使用主进程 i18n 命名空间（`t('file_processing.errors.*')`），不写进渲染进程语言包。

每张图片经现有图片预处理路径读取后，向 `{apiHost}/chat/completions` 发送 `{model, messages}`：`text` 部分为 `Text Recognition:`，`image_url` 部分为 base64 data URL，然后把 `choices[0].message.content` 作为 `{kind: 'text'}` 返回。请求不带 `max_tokens`，依赖服务端默认值，因为受支持的服务栈对可接受取值不一致。MiniCPM-OCR 会输出 Markdown 和换行，需原样保留。仅在配置了密钥时发送 `Bearer` 头。

失败必须对用户可见而不是静默：非 2xx、非 JSON 响应、缺少 `choices`/`content`、空文本分别抛出 i18n 错误；abort 信号取消请求并向上传递。缺少 `apiHost` 复用现有 capability 配置错误。

`document_to_markdown` 有意不在本层范围。MiniCPM-OCR 的准确率依赖版面检测和按块提示词（`Text Recognition:` / `Table Recognition:` / `Formula Recognition:`）；整页单提示词会丢失表格结构和阅读顺序，效果会明显差于现有文档服务。要交付扫描件 PDF，需要版面感知的 sidecar 返回 Markdown，或在客户端渲染页面后按块识别；两者都会引入新的协议契约，应各自单独提出 Spec。

本说明保持 `proposed`；本 PR 不声称已获得针对 Spec 当前提交的 Approval。

## Alternatives considered

- 复用 `mistral` 处理器并填自定义 `apiHost`：会把 Mistral SDK 的请求体发给 MiniCPM-OCR 服务，SDK 并不使用 OpenAI chat completions，失败在协议层而非配置层。
- 复用聊天 provider/model 配置：会把文件处理耦合到与 OCR 无关的聊天模型选择，并让只支持 OCR 的模型出现在聊天模型列表里。
- 在桌面端内置模型和推理运行时：至少增加上 GB 权重和 GPU/CPU 运行时，而现有处理器都依赖本地或远程服务。
- 同一层内同时交付 `document_to_markdown`：要么静默降低表格质量，要么被迫先定义 sidecar 契约，拖慢本身独立可用的图片路径。

## Acceptance criteria

- AC1 — `minicpm` preset 与 registry 条目使该处理器可在文件处理中选择为 `image_to_text`，选择经现有 preference schema 持久化，路由到它的图片能到达配置的端点 (verification: unit + renderer)
- AC2 — 请求为 `POST {apiHost}/chat/completions`，使用配置的模型（默认 `minicpm-ocr`），text 部分为 `Text Recognition:`，图片为 `image_url` base64 data URL，不带 `max_tokens` 字段，仅在配置密钥时带 `Authorization: Bearer` (verification: unit)
- AC3 — `choices[0].message.content` 原样返回为 `{kind: 'text'}`，Markdown 与换行不丢失；空白或空内容抛出可见错误而不是返回空文本 (verification: unit)
- AC4 — 非 2xx、非 JSON 响应、缺少 `choices`/`content` 与网络失败分别抛出主进程 i18n 错误，能拿到状态码时包含状态码；abort 会取消请求 (verification: unit)
- AC5 — 缺少 `apiHost` 时复用现有 capability 配置错误；缺少 API key 允许通过；`apiHost` 末尾斜杠不会产生重复路径 (verification: unit)
- AC6 — 现有处理器、preset 与 registry 契约不变，registry/preset 一致性测试在新增 preset 与条目后通过 (verification: unit)
- AC7 — 所有渲染进程语言都有真实的处理器名称与描述，新增错误文案位于主进程 i18n 的 `file_processing.errors.*`，OCR 设置文档给出 vLLM 与 Ollama 的配置方式并说明 `apiHost` 需包含 `/v1`，同时标注 SGLang 与 llama.cpp 在本层未验证 (verification: docs gate)
- AC8 — 单测与集成测试用本地 mock 的 OpenAI 兼容 HTTP 服务覆盖成功、鉴权头与失败分支 (verification: unit)
- AC9 — 在 `ok-to-test` 之后，于 CI 或维护者机器上用可用的 MiniCPM-OCR 端点上传图片，文本能端到端进入附件流程 (verification: Electron, owner: maintainer-assisted)

## Risks

- 整页提示词不保留表格与阅读顺序；需要扫描件 Markdown 的用户要等 `document_to_markdown` 层，或继续使用 MinerU/Doc2x。
- 不同服务对 `image_url` data URL、`max_tokens` 和提示词的要求不一致。本层只验证 vLLM 与 Ollama；SGLang 与 llama.cpp 形态相同但标注为未验证，文档不能暗示普遍兼容。
- 图片会离开应用发送到配置的端点，与现有远程处理器是同一隐私边界；文档必须写明。
- 自托管端点通常没有密钥，处理器不能调用"必需密钥"的 helper；确实需要密钥的部署应复用现有 `apiKeys` 轮换行为。
- `apiHost` 填错（缺少 `/v1`，或指向纯聊天模型）会表现为 HTTP 或解码错误；错误文案要指出端点形态，而不只是状态码。
