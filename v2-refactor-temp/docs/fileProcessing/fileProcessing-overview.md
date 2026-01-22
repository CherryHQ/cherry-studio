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

### 表结构：`file_processors`

| 字段       | 类型        | 说明                                      |
| ---------- | ----------- | ----------------------------------------- |
| `id`       | string (PK) | 唯一标识，如 `'mineru'`, `'deepseek-ocr'` |
| `name`     | string      | 显示名称                                  |
| `type`     | enum        | `'api'` \| `'local'`                      |
| `features` | enum[]      | 能力标签数组                              |
| `inputs`   | enum[]      | 支持的输入类型                            |
| `outputs`  | enum[]      | 支持的输出格式                            |
| `api_key`  | string?     | API Key（用户配置）                       |
| `api_host` | string?     | API Host（用户配置）                      |
| `model_id` | string?     | 模型 ID（用户配置）                       |

---

## 枚举定义

### Feature（能力）

```typescript
type Feature =
  | "text_extraction" // 文字提取
  | "layout_analysis" // 版面分析
  | "table_detection" // 表格识别
  | "formula_detection" // 公式识别
  | "multimodal"; // 多模态理解（自然语言描述输入内容）
```

### Input（输入类型）

```typescript
type Input = "image" | "document" | "audio" | "video";
```

| 类型       | 说明 | 包含格式                          |
| ---------- | ---- | --------------------------------- |
| `image`    | 图片 | jpg, png, webp, gif...            |
| `document` | 文档 | pdf, docx, pptx, xlsx, md, txt... |
| `audio`    | 音频 | mp3, wav, m4a...（未来）          |
| `video`    | 视频 | mp4, mov, webm...（未来）         |

### Output（输出格式）

```typescript
type Output = "text" | "markdown";
```

### ProcessorType（服务类型）

```typescript
type ProcessorType = "api" | "local";
```

---

## 示例数据

### DeepSeek-OCR

```typescript
{
  id: 'deepseek-ocr',
  name: 'DeepSeek OCR',
  type: 'api',
  features: ['text_extraction', 'multimodal'],
  inputs: ['image', 'document'],
  outputs: ['text', 'markdown'],
  api_key: '***',
  api_host: 'https://api.deepseek.com',
  model_id: 'deepseek-ocr'
}
```

### MinerU

```typescript
{
  id: 'mineru',
  name: 'MinerU',
  type: 'api',
  features: ['text_extraction', 'layout_analysis', 'table_detection', 'formula_detection'],
  inputs: ['document'],
  outputs: ['markdown'],
  api_key: '***',
  api_host: 'https://mineru.net',
  model_id: null
}
```

### Tesseract

```typescript
{
  id: 'tesseract',
  name: 'Tesseract',
  type: 'local',
  features: ['text_extraction'],
  inputs: ['image'],
  outputs: ['text'],
  api_key: null,
  api_host: null,
  model_id: null
}
```

### 对比表

| Processor    | type  | features                                                             | inputs          | outputs        |
| ------------ | ----- | -------------------------------------------------------------------- | --------------- | -------------- |
| DeepSeek-OCR | api   | text_extraction, multimodal                                          | image, document | text, markdown |
| MinerU       | api   | text_extraction, layout_analysis, table_detection, formula_detection | document        | markdown       |
| Tesseract    | local | text_extraction                                                      | image           | text           |

### 本质区别对比

| 维度           | Tesseract              | DeepSeek-OCR                 | MinerU                     |
| -------------- | ---------------------- | ---------------------------- | -------------------------- |
| **技术原理**   | 传统 OCR 引擎          | LLM 多模态模型               | 专业文档解析引擎           |
| **核心定位**   | 图像文字识别           | 图像/文档理解与描述          | 文档结构精确还原           |
| **输出特点**   | 纯文本，无结构         | 文本/Markdown，语义完整      | Markdown，结构精确保留     |
| **结构保留**   | 无                     | 部分（语义级）               | 完整（版面级）             |
| **表格处理**   | 不支持                 | 支持（可能有损失）           | 精确还原                   |
| **公式处理**   | 不支持                 | 支持（可能有损失）           | 精确还原（LaTeX）          |
| **多模态理解** | 不支持                 | 支持（可用自然语言描述图像） | 不支持                     |
| **运行方式**   | 本地                   | API 调用                     | API 调用                   |
| **速度**       | 快                     | 中等                         | 较慢（精确解析耗时）       |
| **适用场景**   | 简单图片文字提取、翻译 | 聊天图片理解、快速文档提取   | 知识库、学术论文、技术文档 |

**总结**：

- **Tesseract**：轻量本地方案，只做"识别文字"，不理解内容
- **DeepSeek-OCR**：LLM 驱动，能"理解并描述"内容，但结构还原非精确
- **MinerU**：专业文档解析，"一模一样还原"文档结构，但不具备语义理解能力

---

## UI 设计方案

采用**场景优先 + 智能推荐**的设计：

```
┌─────────────────────────────────────────────────────────────────┐
│  设置 > 文件处理                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ 📚 知识库文档解析 ─────────────────────────────────────────┐│
│  │                                                             ││
│  │  当添加 PDF 到知识库时使用                                   ││
│  │                                                             ││
│  │  默认服务: [MinerU                              ▼]          ││
│  │            ├─ MinerU        精确 · 表格 · 公式 · 推荐       ││
│  │            ├─ Doc2x         精确 · 表格 · 公式              ││
│  │            ├─ DeepSeek-OCR  智能 · 快速                     ││
│  │            └─ 不使用预处理                                   ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─ 🖼️ 聊天图片理解 ───────────────────────────────────────────┐│
│  │                                                             ││
│  │  当在对话中上传图片时使用                                    ││
│  │                                                             ││
│  │  默认服务: [DeepSeek-OCR                        ▼]          ││
│  │            ├─ DeepSeek-OCR  多模态 · 描述 · 推荐            ││
│  │            ├─ Tesseract     纯文本 · 本地                   ││
│  │            └─ 系统 OCR      纯文本 · 本地                   ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─ 🔧 服务配置 ───────────────────────────────────────────────┐│
│  │                                                             ││
│  │  已配置 3 个服务，点击展开配置 API Key                       ││
│  │                                                     [展开 ▼]││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 下一步

1. 完善 TypeScript 类型定义
2. 设计统一服务接口 `FileProcessingService`
3. 迁移现有 OCR 和 Preprocess 实现
4. 实现 UI 设置页面
