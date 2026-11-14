# Agent Note: 知识库图片 OCR

Status: proposed

[English](2026-11-10-knowledge-image-ocr.md) | 中文

## Problem

知识库文件来源会拒绝图片文件（JPG、PNG、BMP、GIF、WEBP），即 #18442 中报告的问题。图片没有文本层。目前只有 PDF 会经过文档处理器。如果只把图片扩展名加入可接受列表，原始图片字节会被当作文本读取，索引到的将是二进制数据。

## Proposal

在文件选择器、拖放和目录导入中接受 `.jpg`、`.jpeg`、`.png`、`.bmp`、`.gif` 和 `.webp` 作为知识库文件来源。

每张图片使用 `image_to_text` 能力识别，处理器取自 `feature.file_processing.default_image_to_text`；未设置时回退到平台默认值（Windows 和 macOS 为 `system`，其他平台为 `tesseract`）。识别出的文本写入该条目的处理后 Markdown，即 `<name>.md`，处理方式与 PDF 相同，索引时只读取该产物。原始图片从不会被当作文本读取。

图片的路由不依赖 `base.fileProcessorId`。若某个知识库的处理器只支持文档（例如 MinerU），其图片仍使用全局 OCR 设置进行识别。若识别结果没有文本，该条目以现有的“未提取到可索引文本”信息失败。上传提示中列出新增格式。

## Alternatives considered

- 多模态嵌入：需要支持图片输入的嵌入模型，以及新的向量路径。当前默认模型（例如 `BAAI/bge-m3`）无法做到。超出本次范围。
- 对图片使用 `base.fileProcessorId`：对只支持文档的处理器和未配置处理器的知识库会失败，并把图片行为绑定到 PDF 设置上。
- 允许扩展名并将字节当作文本读取：会索引二进制乱码。
- 视觉 LLM 生成描述：需要选择模型、承担单图成本，并需要单独审批。超出本次范围。

## Acceptance criteria

- AC1 — 文件选择器、拖放和目录导入接受这六种图片扩展名，上传提示中列出这些格式。（verification: renderer）
- AC2 — 图片条目使用默认 `image_to_text` 处理器识别，且不依赖 `base.fileProcessorId`，并从 `<name>.md` 建立索引。原始二进制永远不会交给文本读取器。（verification: unit）
- AC3 — OCR 失败或结果为空时，条目以现有的无文本信息标记为失败。取消、删除和重新索引沿用 PDF 处理路径。（verification: unit）
- AC4 — PDF 和 Office 的路由保持不变：`knowledgeFileProcessingExts` 仍然控制文档处理，现有测试通过。（verification: unit）
- AC5 — 处理后的 `<name>.md` 与同级文件冲突时，由现有的保留路径检查处理。（verification: unit）
- AC6 — 在 Windows 上使用默认处理器，索引一张已知文本内容的示例 PNG，并且该文本可以被检索到。（verification: Electron）

## Risks

截图、手写文字和低分辨率图片的识别质量差异较大。Windows 的 `system` OCR 需要已安装语言包，其他平台的 `tesseract` 需要其二进制文件和语言数据。没有文字的图片会使条目失败。远程 OCR 处理器在批量目录导入时会增加延迟和费用。输出路径复用 PDF 的处理机制，该机制的任何缺口也会影响图片。

## Verification

实现方负责 AC1 至 AC5 的单元测试和渲染测试，并在 PR 中记录门禁结果。维护者负责在验收前完成 AC6 的 Electron 检查。在该检查完成之前，本说明保持 proposed 状态。
