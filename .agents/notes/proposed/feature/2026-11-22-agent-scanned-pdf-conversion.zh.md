# Agent Note: 使用默认文档处理器转换扫描 PDF

Status: proposed

[English](2026-11-22-agent-scanned-pdf-conversion.md) | 中文

## 问题

智能体的 `to_markdown` 使用 AnyDoc 在本地转换文件。扫描 PDF 可能返回 `needsOcr`，混合 PDF 如果有页面缺少文字层，可能只得到部分内容。Cherry Studio 已允许用户选择默认文档处理器。需要 OCR 的 PDF 应支持通过选定的处理器转换。

## 提案

普通文档以及每页都有文字层的 PDF 交给 AnyDoc。如果 PDF 中至少有一页没有文字层，或 AnyDoc 返回 `needsOcr`，则将整份 PDF 交给用户在「文档处理」中选定的默认处理器。通过现有 `FileProcessingService` 任务接口选择处理器、执行、取消和获取结果。**OCR** 设置用于图片识别。文档处理器未配置或不可用时，提示用户如何配置。其他转换错误直接提示。

本地与远程文档处理均使用现有默认选项。选择远程处理器时，直接将文档交给该服务。设置页说明知识库和智能体都会使用这项选择。

只处理通过工具现有工作区、智能体数据目录和会话附件检查的文件。等待所选任务的结果，并按工具现有格式返回私有 Markdown 文件回执。取消工具时同步取消转换任务。

## 考虑过的替代方案

- 直接调用本地 PaddleOCR：绕过用户的处理器选择和共享任务流程。
- 另行请求授权或逐次确认：在现有处理器选择之外增加操作。
- 所有转换都走默认文档处理器：会增加 AnyDoc 可以在本地转换的文档的耗时，并可能产生费用。

## 验收标准

- AC1 — 普通文档及每页都有文字层的 PDF 无需配置文档处理器即可在本地转换。(verification: unit; owner: Agent integration)
- AC2 — 扫描或混合 PDF 按当前文档处理器偏好处理整份文件。处理器未配置或不可用时，提示用户下一步操作。(verification: unit and Electron; owner: File Processing integration)
- AC3 — 选用远程默认处理器后，连续转换的 PDF 都使用同一项现有处理器设置。(verification: unit and Electron; owner: Agent integration)
- AC4 — 转换成功后返回现有的私有 Markdown 文件回执。取消工具会取消转换任务，未授权路径无法交给任一处理器。(verification: unit; owner: Agent integration)

## 风险

远程默认处理器会接收符合条件的智能体文件。使用受控服务端在 Electron 内验证连续转换。
