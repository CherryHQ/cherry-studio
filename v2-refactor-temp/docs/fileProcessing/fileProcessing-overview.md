# File Processing Service - 概念设计文档

## 背景

当前系统中 OCR 与 Preprocess 分别服务不同场景：

- **OCR**：以"图片文字识别"为主，提供多种引擎能力，更多聚焦通用图像 OCR
- **Preprocess**：以"知识库文档预处理"为主，主要处理 PDF（含扫描件），并将结果转化为可检索的文本/Markdown

随着功能演进，两者都属于"对文件进行内容提取与解析"的范畴，存在能力重叠与边界模糊。

## 目标

1. 统一 OCR 与 Preprocess 的概念边界，形成"文件处理能力"的统一表达与能力层
2. 将 Preprocess 从知识库业务中抽离，成为可被各业务调用的服务
3. 为未来扩展（多业务复用、更多文件类型、更多处理能力）建立清晰边界

---

## 核心设计

### 设计原则

- **不按 OCR/Preprocess 分类**：现代 LLM-based 服务（如 DeepSeek-OCR）已模糊边界
- **按能力维度描述**：用 Feature 描述"能做什么"，用 Input/Output 描述"处理什么"
- **统一服务入口**：`process(file, options)` → `ProcessingResult`

---

## 数据结构

采用 **Template + User Config** 分离设计：
- **Template**（只读）：处理器元数据，定义能力边界
- **User Config**（Preference 存储）：用户修改的配置

### Template 结构：`FileProcessorTemplate`

| 字段           | 类型                  | 说明                           |
| -------------- | --------------------- | ------------------------------ |
| `id`           | string                | 唯一标识，也用于 i18n key      |
| `type`         | `'api' \| 'builtin'`  | 服务类型                       |
| `metadata`     | `FileProcessorMetadata?` | 处理器元数据（大小/页数限制）  |
| `capabilities` | `FeatureCapability[]` | 能力定义数组                   |

> **i18n**: 处理器显示名称通过 `processor.${id}.name` 获取，Template 不存储 name 字段

### 能力结构：`FeatureCapability`

将能力（Feature）与输入/输出类型绑定，支持 Feature 级别的 API 配置：

| 字段       | 类型                                   | 说明                              |
| ---------- | -------------------------------------- | --------------------------------- |
| `feature`  | `'text_extraction' \| 'markdown_conversion'` | 能力类型                          |
| `input`    | `'image' \| 'document'`                | 输入类型                          |
| `output`   | `'text' \| 'markdown'`                 | 输出类型                          |
| `apiHost`  | `string?`                              | 模板默认 API Host（可被用户覆盖） |
| `modelId`  | `string?`                              | 模板默认 Model ID（可被用户覆盖） |

### 模板元数据：`FileProcessorMetadata`

用于描述处理器的文件限制条件（主要针对文档类）。

| 字段            | 类型       | 说明                     |
| --------------- | ---------- | ------------------------ |
| `maxFileSizeMb` | `number?`  | 单文件大小上限（MB）     |
| `maxPageCount`  | `number?`  | 单文件页数上限（页数）   |

### 用户配置结构：`FileProcessorOverride`

存储在 Preference 系统中，仅保存用户修改的字段：

Preference Key: `feature.file_processing.overrides`，类型为 `FileProcessorOverrides`（`Record<string, FileProcessorOverride>`）。

| 字段            | 类型                                                           | 说明                              |
| --------------- | -------------------------------------------------------------- | --------------------------------- |
| `apiKey`        | `string?`                                                      | API Key（处理器级共享）           |
| `capabilities`  | `Partial<Record<FileProcessorFeature, CapabilityOverride>>?`   | Feature 级覆盖配置                |
| `options`       | `Record<string, unknown>?`                                     | 处理器特定配置                    |

### Feature 覆盖配置：`CapabilityOverride`

允许用户对特定 Feature 覆盖 API Host 和 Model ID：

| 字段       | 类型                                   | 说明                              |
| ---------- | -------------------------------------- | --------------------------------- |
| `apiHost`  | `string?`                              | 用户覆盖的 API Host               |
| `modelId`  | `string?`                              | 用户覆盖的 Model ID               |

---

## 类型定义

> **注意**：使用 TypeScript 字面量联合类型而非 enum，保持与代码一致

### Feature（能力）

```typescript
type FileProcessorFeature = 'text_extraction' | 'markdown_conversion'
```

| 类型              | 说明                                    |
| ----------------- | --------------------------------------- |
| `text_extraction` | 文字提取（继承 OCR 功能）               |
| `markdown_conversion` | 转换为 Markdown（继承文档预处理功能）   |

**设计说明**：简化为两个核心能力，不再细分 `layout_analysis`、`table_detection`、`formula_detection`、`multimodal` 等具体实现细节。这些能力细节由具体 processor 内部实现。

## 示例数据

### 用户配置示例（UserConfig）

```typescript
// overrides 以处理器 id 为 key
{
  mineru: { apiKey: '***' }
}

// 用户为 PaddleOCR 配置了不同 Feature 的 API Host
{
  paddleocr: {
    apiKey: '***',
    capabilities: {
      text_extraction: { apiHost: 'https://my-paddleocr-server.com' },
      markdown_conversion: { apiHost: 'https://my-markdown-server.com' }
    }
  }
}
```

### 处理器对比表

| Processor     | type    | capabilities 概要                                      |
| ------------- | ------- | ------------------------------------------------------ |
| Tesseract     | builtin | text_extraction (image → text)                         |
| System OCR    | builtin | text_extraction (image → text)                         |
| PaddleOCR     | api     | text_extraction (image → text) / markdown_conversion (document → markdown) |
| Intel OV OCR  | builtin | text_extraction (image → text)                         |
| MinerU        | api     | markdown_conversion (document → markdown)                |
| Doc2x         | api     | markdown_conversion (document → markdown)                |
| Mistral       | api     | markdown_conversion (document → markdown)                |
| Open MinerU   | api     | markdown_conversion (document → markdown)                |

### 本质区别对比

| 维度           | Tesseract              | Mistral                      | MinerU                     |
| -------------- | ---------------------- | ---------------------------- | -------------------------- |
| **技术原理**   | 传统 OCR 引擎          | LLM 多模态模型               | 专业文档解析引擎           |
| **核心定位**   | 图像文字识别           | 图像/文档理解与描述          | 文档结构精确还原           |
| **输出特点**   | 纯文本，无结构         | 文本/Markdown，语义完整      | Markdown，结构精确保留     |
| **结构保留**   | 无                     | 部分（语义级）               | 完整（版面级）             |
| **表格处理**   | 不支持                 | 支持（可能有损失）           | 精确还原                   |
| **公式处理**   | 不支持                 | 支持（可能有损失）           | 精确还原（LaTeX）          |
| **运行方式**   | 内置                   | API 调用                     | API 调用                   |
| **速度**       | 快                     | 中等                         | 较慢（精确解析耗时）       |
| **适用场景**   | 简单图片文字提取、翻译 | 聊天图片理解、快速文档提取   | 知识库、学术论文、技术文档 |

**总结**：

- **Tesseract**：轻量内置方案，只做"识别文字"，不理解内容
- **Mistral**：LLM 驱动，能"理解并描述"内容，但结构还原非精确
- **MinerU**：专业文档解析，"一模一样还原"文档结构，但不具备语义理解能力

---
