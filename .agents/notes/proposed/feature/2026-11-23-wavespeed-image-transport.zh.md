# Agent Note: Paintings 的 WaveSpeed 图像传输

Status: proposed

[English](2026-11-23-wavespeed-image-transport.md) | 中文

## 问题

WaveSpeed 已由 #25141（`b6d632a91b`）作为 OpenAI 兼容的聊天提供商注册在 `https://llm.wavespeed.ai/v1`；本说明以它为前提，AC5 依赖它新增的内置预设。但其图像模型不走 OpenAI `/images/*` 协议，而是位于另一个主机 `https://api.wavespeed.ai`：`POST /api/v3/<model id>` 创建预测，`GET /api/v3/predictions/<id>/result` 返回 `created`、`processing`、`completed` 或 `failed`。部分失败以 HTTP 200 返回，但响应信封中的 `code` 不是 200。没有专用传输时，Paintings 无法使用这些模型；而对提交请求做通用重试会创建并计费重复的预测。

## 提案

在 `src/main/ai/provider/custom/wavespeed/` 中新增 `wavespeed` 提供商扩展，沿用 PPIO 的结构：聊天通过 OpenAI 兼容 SDK 访问聊天 `baseURL`（嵌入不在本次范围内）；图像生成使用提交/轮询传输，其源默认为 `https://api.wavespeed.ai`（`imageBaseURL`），与聊天主机无关。将该预设注册到 `IMAGE_EXTENSION_PRESETS`、扩展列表和启用轮询的图像传输注册表中，使图像任务经由现有的图像生成作业运行（单次尝试，无作业级重试）。

由于 `/v1/models` 只列出聊天模型，注册表以提供商覆盖项声明 WaveSpeed 提供的图像模型，并设置 `supplementModelsFromRegistry`。Seedream 5.5 映射到规范模型 `doubao-seedream-5-5`，带完整的 `imageGeneration` 块：`generate` 路由到 `/api/v3/bytedance/seedream-v5.5`，`edit` 路由到 `/api/v3/bytedance/seedream-v5.5/edit`（最多十张参考图）。两种模式都声明 `aspectRatio`（API 接受的十五种比例，两种模式都不设默认值：API 本身对生成默认 `1:1`，编辑则根据输入图推断比例。注册表默认值会在选择模型时写入草稿，添加参考图后又被发送给编辑接口，因此只发送用户自己选择的比例）、`imageResolution`（`1K`、`1.5K`、`2K`）、`outputFormat`（`png`、`jpeg`）和 `background`（`auto`、`transparent`、`opaque`）。由于规范模型 ID 相同，现有的 Seedream 5.5 校验门禁继续生效。

传输只根据规范值构造请求体：`prompt`、`images`（仅在有输入文件时，以 data URL 形式）、`aspect_ratio`、`resolution`（小写的档位）、`output_format` 和 `background`，其余参数一律丢弃。提交只发送一次，从不重试。轮询每两秒一次，总预算十分钟，对瞬时轮询失败（HTTP 5xx、429、网络错误）进行有限次数重试。`completed` 返回 `outputs`；`failed`、`cancelled`、`timeout` 和 `deleted` 以供应商的 `error` 文本结束。HTTP 401 映射为令牌错误；其他 HTTP 4xx 以及信封 `code` 不为 200 时映射为携带供应商 `message` 的远端错误。

令牌错误必须能穿过图像作业。作业只保留抛出错误的消息，`ai.image.generate` 再以不带状态码的 `AI_REQUEST_FAILED` 错误返回，否则 `runPainting` 只会显示远端错误。因此图像作业处理器把 `transport.submit` 或 `transport.poll` 抛出的 `PaintingGenerateError` 编码为 `PaintingGenerateError:<code>:<message>`，`runPainting` 和 `normalizePaintingGenerateError` 只解码这一前缀。供应商文本永远不会被当作错误码：消息为 `REQ_ERROR_TOKEN` 的 HTTP 422 仍是带该文本的远端错误；传输抛出的普通错误若文本恰好以该前缀开头（例如 TokenHub 的 `err_msg`），会被重新编码为带原文本的远端错误。这也修复了 TokenHub 和 DMXAPI 传输的同一路径。

## 备选方案

- 从聊天主机推导图像源——两个主机不同（`llm.` 与 `api.`），且用户修改聊天代理地址会悄然改变计费图像请求的去向；PPIO 也以同样方式固定图像源。
- 只用一个 `generate` 模式，附带文件时追加 `/edit`——把路由藏进代码；按模式的 `vendorTransport` 已经在注册表数据中承载端点，DashScope 和 AiHubMix 均如此。
- WaveSpeed 的同步模式——在整个生成期间保持单个请求，而作业系统已负责轮询、取消和重启行为。
- 先通过 WaveSpeed 的媒体上传端点上传参考图——每张图多一次请求；预测端点接受 base64 data URL 作为图像输入。
- 使用独立模型 ID 而非 `doubao-seedream-5-5`——会重复规范元数据，并绕过共享的 Seedream 5.5 校验。

## 验收标准

- AC1 — WaveSpeed 提供商在 Paintings 中列出 Seedream 5.5，提供宽高比、分辨率档位、输出格式和背景控件，并接受最多十张参考图 (verification: unit)
- AC2 — 生成请求以 Bearer 密钥和仅映射后的字段，向图像源的 `/api/v3/bytedance/seedream-v5.5` 提交一次；带参考图时，编辑端点以 `images` 接收它们 (verification: unit)
- AC3 — 轮询在 `completed` 时返回输出 URL，在终止失败时以供应商错误结束，重试瞬时轮询失败，且从不重复提交请求 (verification: unit)
- AC4 — HTTP 401 穿过图像作业和 `ai.image.generate` 后，在 Paintings 中呈现令牌错误；其他 HTTP 4xx 响应和非 200 的信封代码呈现携带供应商消息的远端错误 (verification: unit)
- AC5 — 聊天请求保持聊天主机，图像请求使用图像源 (verification: unit)
- AC6 — 桌面会话可根据提示词生成 Seedream 5.5 图像，并可基于参考图生成编辑后的图像 (verification: Electron)
- AC7 — 草稿只有模型默认值时添加参考图，编辑请求不带 `aspect_ratio`；用户选择的比例在两种模式下都会发送 (verification: unit)

## 来源

- [REST API](https://wavespeed.ai/docs/rest-api)：以 `POST /api/v3/<model id>` 提交、`GET /api/v3/predictions/<id>/result` 读取结果，响应信封与状态
- [错误、重试与超时](https://wavespeed.ai/docs/errors-retries-timeouts)：提交从不重试；轮询遇到 429、5xx 和网络错误时重试
- [Seedream 5.5](https://wavespeed.ai/models/bytedance/seedream-v5.5) 与 [Seedream 5.5 Edit](https://wavespeed.ai/models/bytedance/seedream-v5.5/edit) 模型页：参数、枚举与默认值（生成的 `aspect_ratio` 默认 `1:1`）

## 风险

WaveSpeed 的接口契约由外部维护；发布前须重新核对端点路径、状态值和模型参数。每次提交都会计费，因此今后任何围绕提交的重试都属于回归。编辑路径依赖 API 接受 `images` 的 data URL；若不再接受，须先上传输入。只有当其他 WaveSpeed 模型的参数符合传输的字段映射时，才能以注册表覆盖项的形式添加。
