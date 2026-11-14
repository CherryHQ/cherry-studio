# Agent Note: 允许用户配置 OCR 提供方、模型与选项

Status: proposed

[English](2026-11-14-ocr-provider-configuration.md) | 中文

解决 [issue #20286](https://github.com/CherryHQ/cherry-studio/issues/20286)。建立在 [FileProcessing 任务模型](../../implemented/architecture/2026-10-29-file-processing-task-model.md) 之上，后者负责 `image_to_text` 处理器的边界。

## Problem

设置 → OCR 已经可以选择 `image_to_text` 处理器，并通过 `useFileProcessingPreferences` 保存每个处理器的覆盖配置（`FileProcessorOverride`、`capabilities.image_to_text.modelId`）。对照 issue，仍有四处缺口：

- **模型选择范围窄。** 只有 PaddleOCR 暴露了模型字段，且选项硬编码在 `PaddleOcrModelSettings.tsx`（`PP-OCRv6`、`PP-OCRv5`）中。其他提供方的 `modelId`（例如 Mistral 的 `mistral-ocr-latest`）只能由预设设置。
- **没有重置。** 覆盖配置会一直保留，直到用户逐项修改；没有一个操作可以把某个处理器恢复为预设的提供方、模型和选项。
- **保存前不校验不受支持的组合。** API 地址已有校验，但保存前无人检查所选模型是否属于该提供方声明的模型、处理器是否支持所选选项，或所需的本地模型是否已安装。
- **适用范围没有说明，且有一个入口独立配置。** `image_to_text` 驱动聊天 `read_file` 的 OCR（`ocrImageToText.ts`）、翻译页的图片，以及知识库的图片导入。截图区域 OCR（`ScreenshotOverlayService.recognizeText` → `recognizeScreenshotText`、`OcrInferenceService`）使用自己的运行时，不读取 `image_to_text`。扫描版 PDF 页面走 `local-document` 的 OCR（`pdfPageOcr.ts`）。设置页没有说明哪个入口适用哪份配置。

现有用户没有覆盖配置，因此解析出的处理器是平台默认值（`resolveDefaultImageToTextProcessor`：macOS 和 Windows 为系统 OCR，其他平台为 Tesseract）。这一行为不得改变。

## Proposal

- **模型选择。** 对每个处理器，从其预设能力（`FILE_PROCESSOR_PRESET_MAP`）推导可选模型，而不是在各处理器的 UI 代码里写死。`PaddleOcrModelSettings` 保留为 PaddleOCR 对该列表的渲染。只声明一个模型的处理器以固定文本显示该模型。
- **选项支持。** 只有当所选处理器的预设声明了某个选项时才显示对应字段（Tesseract 与系统 OCR 为语言；PaddleOCR 与 Mistral 为模型；远程处理器为 API 地址）。不暴露任意的提供方参数。
- **保存前校验。** `setCapabilityField` 只在值通过 `src/shared/data/presets/fileProcessing.ts` 中的共享校验后调用。校验拒绝以下情况：`image_to_text` 的处理器不支持 `image` 输入；模型不在预设列表中；处理器未声明该选项；API 地址为空或无效；本地处理器所需的本地模型（`FILE_PROCESSOR_LOCAL_MODEL`）未安装。拒绝原因会以内联方式显示在字段旁，并给出修复方法（例如“请先在本地模型中下载本地 OCR 模型”）。
- **重置为默认。** 处理器面板上的“重置为默认”操作会删除该处理器的覆盖配置（`image_to_text` 的 `FileProcessorOverride` 及其能力条目），并恢复预设值。它同样要经过保存时的校验。
- **图片 OCR 的单一文档化来源。** 设置 → OCR 中的 `image_to_text` 是聊天图片 OCR、翻译页图片 OCR 和知识库图片导入的唯一配置。设置页与 `docs/website` 会说明每个入口使用哪份配置，包括截图区域 OCR 和扫描版 PDF 页面在别处配置。
- **兼容性。** 不做迁移。没有覆盖配置时，解析结果与之前完全一致，偏好存储的 schema 也不变。

不在范围内：同时控制截图 OCR 或 PDF OCR 的统一 OCR 页面；自由文本模型 ID；新的 OCR 引擎。

## Alternatives considered

- **为所有提供方提供自由文本模型字段。** 已否决：issue 要求拦截不受支持的组合，而自由文本无法与提供方声明的模型做比对。
- **遇到不受支持的组合时自动回退到默认处理器。** 已被提出者否决：用户应看到原因并修改设置，而不是被静默切换到另一个引擎。
- **让截图区域 OCR 经过 `image_to_text`。** 暂缓：截图 OCR 运行在原生 API 或本地 Paddle 工作进程上，有自己的延迟和可用性规则（`isScreenshotOcrAvailable`），这样做会改变超出本 issue 范围的截图行为。文档改为说明这一划分。
- **单独存储一份 OCR 配置对象。** 已否决：`FileProcessorOverride` 已经保存每个处理器的状态。第二份存储会重复数据，并破坏“单一配置来源”。

## Acceptance criteria

- AC1 — 设置 → OCR 允许用户从共享列表中选择任一 `image_to_text` 处理器并持久化；该选择用于聊天 `read_file` OCR、翻译页图片 OCR 和知识库图片导入。(verification: renderer)
- AC2 — 模型选择器只列出所选处理器预设声明的模型，显示的字段与该处理器声明的选项完全一致。(verification: renderer)
- AC3 — 不受支持的处理器、模型、选项、API 地址，或缺失的本地模型都会阻止保存，并以内联方式显示原因和修复方法；已存储的偏好保持不变。(verification: unit; renderer)
- AC4 — “重置为默认”会删除该处理器的覆盖配置并恢复预设值；之后解析出的配置与全新安装相同。(verification: unit; renderer)
- AC5 — 没有 `image_to_text` 覆盖配置的用户，在每个平台上解析出的处理器与本变更之前相同。(verification: unit)
- AC6 — 中英文用户文档说明聊天图片、翻译图片、知识库图片、截图 OCR 和扫描版 PDF 分别使用哪份配置。(verification: docs gate)

## Risks

- 预设模型列表可能与提供方 API 实际接受的模型不一致。已保存的模型若在之后的预设中被移除，会解析为预设默认值；选择器显示的是这个回退值，而不是过期的保存值。
- 本地处理器的模型之后被删除时，失败发生在运行时而非保存时。运行时错误必须指出缺失的模型。
- 截图 OCR 与 PDF OCR 仍在别处配置，用户可能仍期望一个页面控制全部。文档能缓解但无法消除这一点。
- 待审批的决定：本 Spec 是否保持截图区域 OCR 独立（当前提议），还是留给之后的 Spec 合并到 `image_to_text` 来源。
