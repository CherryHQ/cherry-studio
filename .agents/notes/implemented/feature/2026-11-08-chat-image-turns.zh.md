# Agent Note: 在聊天中生成图片

Status: implemented

[English](2026-11-08-chat-image-turns.md) | 中文

## 问题

Cherry Studio V1.9.13 允许用户在普通聊天中选择图片模型，并从已生成的图片继续编辑。V2 删除了这一交互，尽管聊天传输、文件片段、对话分支和持久化已经能够表示图片。用户因此无法在同一个对话中请求、修改和分支图片任务，专用图片模型也只能留在独立工作流里。

## 决定

在所有聊天模型选择器与助手模型选择器中列出已启用的图片生成模型。支持聊天协议的模型继续使用现有对话协议并发布原生文件片段。专用图片 API 即使被 catalog 错误标注为同时输出文本，也仍走图片传输。专用图片模型只在聊天回合中围绕现有生图服务做一层轻量分流，不另建聊天栈。

同一模型若同时出现在提供商聊天目录与图片目录中，则两个端点都保留：聊天走聊天协议，绘图工作流走图片端点，共享谓词也据此将它判定为可聊天，而不是仅图片。

每次专用图片回合在所选模式要求提示词时，使用最后一条用户消息中的非空文本。用户在该消息中附带的图片作为参考：模型声明 edit 模式时按编辑提交；仅声明 generate 模式的模型则在生成模式中携带参考图——部分 registry 条目（seedream、混元生图、vidu）的生成模式本身就接受参考图，且没有 edit 模式。两者都未声明的模型会返回能力错误。消息没有附图时，只有支持编辑的模型才自动使用当前分支最近一张助手图片。仅支持生成的模型在后续纯文本回合重新生成图片。模型能力来自 registry 声明的 generate/edit 模式与该模式的最大输入图片数。自动编辑输入只从当前分支读取，因此切换分支不会误用兄弟分支中的图片。

按请求意图解析服务端点。Chat 意图选择声明顺序中的第一个聊天协议，不按模型名重排 New API 文本协议。Image 意图优先选择声明图片生成能力的端点。OpenRouter 图片聊天请求同时请求文本和图片模态。New API 的 OpenAI 兼容聊天响应在适配器边界归一化：JSON 和 SSE 里的 data-image Markdown 转成 OpenAI 兼容的 `images` 字段，并在传输分块及 SSE 内容增量之间重新拼装。OpenRouter 与 OpenAI 兼容 SDK 适配器在下一条指令之前，将助手生成的图片作为用户图片输入回传，同时保留助手文本与推理内容。

原生内联图片输出在消息最终写入前保存到 FileManager，再由消息引用对应文件。临时聊天保留自动清理文件，直到删除或成功转为正式聊天；转换时先登记持久消息文件引用，再释放临时保留。图片调用的用量归属保留来源聊天消息和来源信息。图片回合沿用当前取消机制；失败或没有任何图片时返回流错误，不保存成功的空助手消息。

正式聊天复用现有的多模型并行执行；临时聊天仍只使用第一个模型。专用图片 API 接收当前用户提示词与选中的参考图片，而非完整文本历史或系统提示词。逐回合图片参数面板与独立聊天界面仍不在本次改动范围内。

## 备选方案

- 完整恢复 v1 图片模型路径会重复 V2 已统一的消息、持久化和流所有权。
- 只恢复 Gemini 与 OpenRouter 图片聊天模型，会让 OpenAI Images、Flux、Seedream 等专用模型仍无法从聊天使用。
- 在图片专用适配器中重写聊天循环，会使取消、分支和持久化与普通聊天行为不一致。
- 只把 New API Markdown 当作展示内容，会暴露 base64 文本，也无法让后续回合读取文件。
- 自动跨所有分支选择最近助手图片，会让切换分支后的请求修改错误上下文。

## 后果

图片回合复用 `generateImage` 和既有的 `messages` 流源，因此取消、持久化、投影与用量归属仍走普通聊天路径。从聊天发起的图片请求不经过 `ai.image.generate` IPC 边界，携带的是 registry 默认参数而非用户编辑值。生成的图片采用 `delete_when_unreferenced`：正式聊天通过 `chat_message_file_ref` 持有，临时聊天在删除时同步关闭会话并释放运行时保留，再由现有 FileManager GC 回收无引用图片；删除会话不保证立即擦除磁盘文件。若某个模型的目录条目声明了文本输出却只提供 `/images`，应在 registry creator 中修正数据；共享谓词不对模型 id 做特判。

provider catalog 可能声明图片能力，却只提供 generate 或 edit；界面仍需允许选择模型，图片回合在请求动作不受支持时返回清晰的能力错误。New API 中转可能改变图片编码方式，因此归一化只处理 data-image Markdown，不改变普通链接或其他响应协议。本轮结构化图片参数使用 registry 默认值；需要自定义参数的用户仍可使用专用图片工作流。

“仅图片”判定现在服务于两类不同的选择器。聊天输入框与消息重生成选择器接受专用图片模型；用于文本任务的设置（默认模型、快捷助手、翻译、上下文压缩、API 网关）仍排除专用图片 API。Gemini 图片聊天模型这类带文本输出的图片模型仍是普通聊天模型，继续可选，这是有意为之：它们能回答文本。

## 验证

- AC1 — 所有已启用图片生成模型都出现在聊天模型选择器中，embedding、rerank 等非聊天模型仍被排除。`src/shared/utils/__tests__/model.test.ts` 覆盖谓词组合，`ChatComposer.test.tsx` 与 `homeMessageListAdapter.test.tsx` 覆盖选择器。
- AC2 — 文本加图片的聊天模型走聊天协议并启用原生图片输出。`capabilities.test.ts` 覆盖启用条件，`config.test.ts` 覆盖 OpenRouter `modalities`，`options.test.ts` 覆盖 OpenAI 系列分支。
- AC3 — 专用图片模型按 registry 选择 generate 或 edit，并只从当前分支最近一张助手图片继续编辑。`imageTurn.test.ts` 覆盖提示词、编辑输入、生成模式参考图、分支选择与免提示模式，`AiService.test.ts` 覆盖路由与文件输出。
- AC4 — Chat 与 Image 意图为 Gemini 原生、New API、OpenRouter 和标准图片服务选择正确端点，且不改变 wire model id。`endpoint.test.ts` 与 `imageGenerationJobHandler.test.ts` 覆盖解析。
- AC5 — New API 的 JSON 与 SSE 响应把 Markdown data image 转成 SDK 文件片段。`newApiDataImage.test.ts` 覆盖归一化；`imageChatHistory.test.ts` 检查图文及纯图片回复的下一轮 wire 请求。
- AC6 — 内联生成图片成为带稳定引用的受管理文件，持久聊天与临时聊天都能保存，删除临时聊天时释放图片，供现有 GC 回收。`relocateInlineImages.test.ts`、`TemporaryChatService.test.ts` 与 `FileManager.retention.test.ts` 覆盖持久化、转正与删除。
- AC7 — 停止图片回合会取消服务请求且不报错，服务未返回图片时产生终止流错误。`AiService.test.ts` 覆盖两条路径。
