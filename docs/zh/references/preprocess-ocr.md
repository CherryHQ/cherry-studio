# 预处理与 OCR 架构说明

本文说明 PreprocessProvider 与 OcrProvider 在业务上的作用及其架构分层，便于维护与扩展。

## 背景与业务作用

### PreprocessProvider

PreprocessProvider 服务于知识库导入流程，主要面向“扫描版/图片型 PDF”的预处理。
核心目标是将 PDF 解析为可检索的文本或 Markdown，并在本地缓存结果以避免重复处理。

### OcrProvider

OcrProvider 提供通用 OCR 能力，面向图片识别与设置页的 OCR 配置。
它支持主进程内置 OCR（Tesseract/System/PaddleOCR/OV OCR），并允许渲染进程走 API 型 OCR 客户端。

## PreprocessProvider 架构

### 入口与业务流程

在知识库导入流程中，文件进入预处理步骤：

1. 仅对 PDF 且配置了 preprocess provider 时触发预处理。
2. 先检查是否已有缓存（Data/Files/{file.id} 目录）。
3. 调用具体 provider 执行解析，生成 Markdown 或文本。
4. 通过 IPC 通知 UI 进度与完成事件。

关键入口：

- `src/main/services/KnowledgeService.ts`
- `src/main/knowledge/preprocess/PreprocessingService.ts`

### 核心分层

1) Facade

- `PreprocessProvider` 作为统一入口，内部通过工厂创建具体 provider，并暴露：
  - `parseFile`
  - `checkQuota`
  - `checkIfAlreadyProcessed`

文件：`src/main/knowledge/preprocess/PreprocessProvider.ts`

2) 抽象基类

- `BasePreprocessProvider` 提供通用能力：
  - 统一临时存储目录（`getTempDir()/preprocess`）
  - 缓存检测（检查 `Data/Files/{file.id}` 是否为目录）
  - PDF 页数读取与基本校验
  - 进度上报（`file-preprocess-progress`）

文件：`src/main/knowledge/preprocess/BasePreprocessProvider.ts`

3) 工厂与具体实现

- 工厂按 `provider.id` 选择实现：
  - doc2x
  - mistral
  - mineru
  - open-mineru
  - default

文件：`src/main/knowledge/preprocess/PreprocessProviderFactory.ts`

具体实现概览：

- Doc2x：预上传 -> 上传 -> 轮询 -> 导出 -> 下载解压，输出 .md
  - `src/main/knowledge/preprocess/Doc2xPreprocessProvider.ts`
- MinerU：批量上传 -> 轮询 -> 下载解压，输出 .md，并提供 quota
  - `src/main/knowledge/preprocess/MineruPreprocessProvider.ts`
- Open-MinerU：自托管接口上传并直接返回 zip
  - `src/main/knowledge/preprocess/OpenMineruPreprocessProvider.ts`
- Mistral：Mistral OCR SDK，解析后本地生成 markdown 与图片资源
  - `src/main/knowledge/preprocess/MistralPreprocessProvider.ts`

### 事件与缓存

- 预处理进度事件：`file-preprocess-progress`
- 预处理完成事件：`file-preprocess-finished`
- 缓存规则：若 `Data/Files/{file.id}` 为目录，则认为已预处理，直接复用

相关逻辑：

- `src/main/knowledge/preprocess/BasePreprocessProvider.ts`
- `src/main/services/KnowledgeService.ts`

## OcrProvider 架构

### 主进程 OCR 服务

- `OcrService` 在主进程维护 providerId -> handler 的注册表，并提供统一 OCR 调度。
- 内置 OCR 在启动时注册：Tesseract/System/PaddleOCR/OV OCR。

文件：`src/main/services/ocr/OcrService.ts`

### IPC 暴露

渲染进程通过 preload 的 `window.api.ocr` 调用主进程 OCR：

- `ocr(file, provider)`
- `listProviders()`

文件：`src/preload/index.ts`

### 渲染进程 OCR 入口

渲染进程的 `OcrService` 负责选择执行路径：

- 若 provider 为 API 型（含 apiKey/apiHost），走渲染进程 API client。
- 否则通过 IPC 调用主进程内置 OCR。

文件：`src/renderer/src/services/ocr/OcrService.ts`

### API Client 体系

- `OcrBaseApiClient` 提供 API Host 与 apiKey 轮换逻辑。
- `OcrApiClientFactory` 创建具体 API client（目前示例实现）。

文件：

- `src/renderer/src/services/ocr/clients/OcrBaseApiClient.ts`
- `src/renderer/src/services/ocr/clients/OcrApiClientFactory.ts`
- `src/renderer/src/services/ocr/clients/OcrExampleApiClient.ts`

### 状态与配置

- OCR provider 列表与默认 image provider 存储在 Redux：`ocr` slice。
- `useOcrProviders` / `useOcrProvider` 负责添加/删除 provider、更新配置、UI 展示名称与 Logo。

文件：

- `src/renderer/src/store/ocr.ts`
- `src/renderer/src/hooks/useOcrProvider.tsx`

## 关键差异

- PreprocessProvider 是“知识库导入的 PDF 预处理层”，关注 PDF -> 文本/Markdown 与缓存复用。
- OcrProvider 是“通用 OCR 能力层”，支持本地/系统 OCR 与可扩展 API OCR。

## 关键文件索引

- 预处理入口：`src/main/services/KnowledgeService.ts`
- 预处理服务：`src/main/knowledge/preprocess/PreprocessingService.ts`
- 预处理 Facade：`src/main/knowledge/preprocess/PreprocessProvider.ts`
- 预处理基类：`src/main/knowledge/preprocess/BasePreprocessProvider.ts`
- 预处理工厂：`src/main/knowledge/preprocess/PreprocessProviderFactory.ts`
- 预处理实现：
  - `src/main/knowledge/preprocess/Doc2xPreprocessProvider.ts`
  - `src/main/knowledge/preprocess/MineruPreprocessProvider.ts`
  - `src/main/knowledge/preprocess/OpenMineruPreprocessProvider.ts`
  - `src/main/knowledge/preprocess/MistralPreprocessProvider.ts`
- OCR 主进程服务：`src/main/services/ocr/OcrService.ts`
- OCR IPC：`src/preload/index.ts`
- OCR 渲染入口：`src/renderer/src/services/ocr/OcrService.ts`
- OCR API client：`src/renderer/src/services/ocr/clients/OcrBaseApiClient.ts`
- OCR 状态与 hooks：
  - `src/renderer/src/store/ocr.ts`
  - `src/renderer/src/hooks/useOcrProvider.tsx`
