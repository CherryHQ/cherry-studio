# File Processing Data API 设计

## 概述

根据 [Data System 设计规范](../../../docs/en/references/data/README.md) 和 [Preference Schema Guide](../../../docs/en/references/data/preference-schema-guide.md)，本文档描述文件处理（File Processing）的数据存储设计。

本方案统一了现有的 OCR 和 Preprocess 功能，并提供从 Redux 到 Preference 系统的迁移策略。

## 设计决策

### 为什么使用 Preference 而不是 DataApi？

根据 Data System 设计规范：

| 评估维度 | File Processors | 结论 |
|---------|-----------------|------|
| 数据来源 | 用户配置 API Key/Host | **Preference** |
| 数据量 | 固定数量（~10个处理器） | **Preference** |
| 丢失影响 | 可重新配置 | **Preference** |
| 生命周期 | 永久保存直到用户修改 | **Preference** |

**结论**：File Processors 属于用户设置，应存储在 Preference 系统中。

### 关键设计决策

1. **模板与用户配置分离**：
   - 模板数据（处理器元信息）存储在 `src/renderer/src/config/fileProcessing.ts`
   - 用户配置（apiKey, apiHost 等）存储在 Preference 中
   - Preference 只存储用户修改的字段，不存储完整对象
2. **仅内置处理器**：不支持用户添加自定义处理器
3. **需要数据迁移**：从现有 Redux store (OCR + Preprocess) 迁移用户配置

---

## 现有数据结构分析

### 现有 OCR 配置 (Redux: `src/renderer/src/store/ocr.ts`)

```typescript
// 状态结构
interface OcrState {
  providers: OcrProvider[]
  imageProviderId: string  // 当前选中的图片 OCR 处理器
}

// 内置处理器: tesseract, system, paddleocr, ovocr
// 用户配置: api_key, api_host, langs 等
```

### 现有 Preprocess 配置 (Redux: `src/renderer/src/store/preprocess.ts`)

```typescript
// 状态结构
interface PreprocessState {
  providers: PreprocessProvider[]
  defaultProvider: string  // 默认文档处理器
}

// 内置处理器: mineru, doc2x, mistral, open-mineru
// 用户配置: apiKey, apiHost, model
```

---

## 新数据结构设计

### 核心设计：模板与用户配置分离

```
┌─────────────────────────────────────────────────────────────────┐
│  模板数据 (src/renderer/src/config/fileProcessing.ts)            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ FILE_PROCESSOR_TEMPLATES: FileProcessorTemplate[] = [       ││
│  │   { id: 'mineru', name: 'MinerU', type: 'api', ... }       ││
│  │   { id: 'tesseract', name: 'Tesseract', type: 'local' }    ││
│  │ ]                                                           ││
│  │ (只读，包含 id, name, type, features, inputs, outputs)      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────┐
│  用户配置 (Preference: feature.file_processing.processors)       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [                                                           ││
│  │   { id: 'mineru', apiKey: '***' },                         ││
│  │   { id: 'mineru', apiKey: '***', apiHost: 'http://...' }   ││
│  │ ]                                                           ││
│  │ (只存储用户修改的字段：id + apiKey/apiHost/modelId/options)  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  运行时合并 (useFileProcessors hook)                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 模板 + 用户配置 = 完整处理器配置                              ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Preference Keys

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `feature.file_processing.processors` | `FileProcessorUserConfig[]` | `[]` | 用户配置（仅存储修改的字段） |
| `feature.file_processing.default_document_processor` | `string \| null` | `null` | 知识库文档解析默认处理器 ID |
| `feature.file_processing.default_image_processor` | `string \| null` | `null` | 聊天图片理解默认处理器 ID |

### 类型定义 (preferenceTypes.ts)

```typescript
// ============================================
// File Processing Types
// ============================================

/**
 * 处理器特定配置
 *
 * 使用通用 Record 类型，不预定义具体结构。
 * 各处理器的配置由 UI 组件根据 processor.id 自行解释。
 *
 * 已知的 options 字段：
 * - Tesseract: { langs: string[] }  // 启用的语言代码数组
 *
 * 示例：
 * - { langs: ['chi_sim', 'eng'] }        // Tesseract 语言配置
 * - { quality: 'high', timeout: 30000 }  // 其他处理器配置
 */
export type FileProcessorOptions = Record<string, unknown>

/**
 * Feature 级别的用户配置
 *
 * 允许用户对特定 Feature 覆盖 API Host 和 Model ID。
 * 这是因为某些处理器（如 PaddleOCR）对不同功能有不同的 API 端点。
 */
export type FeatureUserConfig = {
  feature: 'text_extraction' | 'to_markdown'
  apiHost?: string  // 用户覆盖的 API Host
  modelId?: string  // 用户覆盖的 Model ID
}

/**
 * 用户配置的处理器数据（存储在 Preference 中）
 *
 * 设计原则：
 * - 只存储用户修改的字段
 * - id 是必须的，用于匹配模板
 * - apiKey 在处理器级别共享（所有 Feature 使用同一个 Key）
 * - apiHost/modelId 在 Feature 级别配置（通过 featureConfigs）
 * - 字段名使用 camelCase（与 TypeScript 惯例一致）
 */
export type FileProcessorUserConfig = {
  id: string                          // 处理器 ID，用于匹配模板
  apiKey?: string                     // API Key（处理器级共享）
  featureConfigs?: FeatureUserConfig[] // Feature 级配置
  options?: FileProcessorOptions      // 处理器特定配置（通用类型）
}
```

### 模板类型定义 (src/renderer/src/config/fileProcessing.ts)

```typescript
/**
 * 处理器服务类型
 */
export type FileProcessorType = 'api' | 'local'

/**
 * 处理器能力枚举
 */
export enum FileProcessorFeature {
  TEXT_EXTRACTION = 'text_extraction',     // 文字提取
  LAYOUT_ANALYSIS = 'layout_analysis',     // 版面分析
  TABLE_DETECTION = 'table_detection',     // 表格识别
  FORMULA_DETECTION = 'formula_detection', // 公式识别
  MULTIMODAL = 'multimodal'                // 多模态理解
}

/**
 * 支持的输入类型枚举
 */
export enum FileProcessorInput {
  IMAGE = 'image',       // jpg, png, webp, gif...
  DOCUMENT = 'document', // pdf, docx, pptx, xlsx, md, txt...
  AUDIO = 'audio',       // mp3, wav, m4a... (future)
  VIDEO = 'video'        // mp4, mov, webm... (future)
}

/**
 * 支持的输出格式枚举
 */
export enum FileProcessorOutput {
  TEXT = 'text',
  MARKDOWN = 'markdown'
}

/**
 * 处理器模板（只读元数据）
 */
export type FileProcessorTemplate = {
  id: string                          // 唯一标识
  name: string                        // 显示名称
  type: FileProcessorType             // 'api' | 'local'
  features: FileProcessorFeature[]    // 能力标签数组
  inputs: FileProcessorInput[]        // 支持的输入类型
  outputs: FileProcessorOutput[]      // 支持的输出格式
  defaultApiHost?: string             // 默认 API Host
  defaultModelId?: string             // 默认模型 ID
}

/**
 * 内置处理器模板
 */
export const FILE_PROCESSOR_TEMPLATES: FileProcessorTemplate[] = [
  // === 图片处理器 (原 OCR) ===
  {
    id: 'tesseract',
    name: 'Tesseract',
    type: 'local',
    features: [FileProcessorFeature.TEXT_EXTRACTION],
    inputs: [FileProcessorInput.IMAGE],
    outputs: [FileProcessorOutput.TEXT]
  },
  {
    id: 'system',
    name: 'System OCR',
    type: 'local',
    features: [FileProcessorFeature.TEXT_EXTRACTION],
    inputs: [FileProcessorInput.IMAGE],
    outputs: [FileProcessorOutput.TEXT]
  },
  {
    id: 'paddleocr',
    name: 'PaddleOCR',
    type: 'api',
    features: [FileProcessorFeature.TEXT_EXTRACTION],
    inputs: [FileProcessorInput.IMAGE],
    outputs: [FileProcessorOutput.TEXT]
  },
  {
    id: 'ovocr',
    name: 'Intel OV OCR',
    type: 'local',
    features: [FileProcessorFeature.TEXT_EXTRACTION],
    inputs: [FileProcessorInput.IMAGE],
    outputs: [FileProcessorOutput.TEXT]
  },

  // === 文档处理器 (原 Preprocess) ===
  {
    id: 'mineru',
    name: 'MinerU',
    type: 'api',
    features: [
      FileProcessorFeature.TEXT_EXTRACTION,
      FileProcessorFeature.LAYOUT_ANALYSIS,
      FileProcessorFeature.TABLE_DETECTION,
      FileProcessorFeature.FORMULA_DETECTION
    ],
    inputs: [FileProcessorInput.DOCUMENT],
    outputs: [FileProcessorOutput.MARKDOWN],
    defaultApiHost: 'https://mineru.net'
  },
  {
    id: 'doc2x',
    name: 'Doc2x',
    type: 'api',
    features: [
      FileProcessorFeature.TEXT_EXTRACTION,
      FileProcessorFeature.LAYOUT_ANALYSIS,
      FileProcessorFeature.TABLE_DETECTION,
      FileProcessorFeature.FORMULA_DETECTION
    ],
    inputs: [FileProcessorInput.DOCUMENT],
    outputs: [FileProcessorOutput.MARKDOWN],
    defaultApiHost: 'https://v2.doc2x.noedgeai.com'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    type: 'api',
    features: [
      FileProcessorFeature.TEXT_EXTRACTION,
      FileProcessorFeature.MULTIMODAL
    ],
    inputs: [FileProcessorInput.IMAGE, FileProcessorInput.DOCUMENT],
    outputs: [FileProcessorOutput.TEXT, FileProcessorOutput.MARKDOWN],
    defaultApiHost: 'https://api.mistral.ai',
    defaultModelId: 'mistral-ocr-latest'
  },
  {
    id: 'open-mineru',
    name: 'Open MinerU',
    type: 'api',
    features: [
      FileProcessorFeature.TEXT_EXTRACTION,
      FileProcessorFeature.LAYOUT_ANALYSIS,
      FileProcessorFeature.TABLE_DETECTION,
      FileProcessorFeature.FORMULA_DETECTION
    ],
    inputs: [FileProcessorInput.DOCUMENT],
    outputs: [FileProcessorOutput.MARKDOWN]
  }
]
```

### Schema 定义 (preferenceSchemas.ts)

```typescript
export interface PreferenceSchemas {
  default: {
    // ... existing keys ...

    // File Processing
    'feature.file_processing.processors': PreferenceTypes.FileProcessorUserConfig[]
    'feature.file_processing.default_document_processor': string | null
    'feature.file_processing.default_image_processor': string | null
  }
}
```

### 默认值 (DefaultPreferences)

```typescript
export const DefaultPreferences: PreferenceSchemas = {
  default: {
    // ... existing defaults ...

    // 空数组，用户配置后才会有数据
    'feature.file_processing.processors': [],
    'feature.file_processing.default_document_processor': null,
    'feature.file_processing.default_image_processor': null
  }
}
```

---

## 使用示例

### 合并模板与用户配置

```typescript
import { usePreference } from '@data/hooks/usePreference'
import { FILE_PROCESSOR_TEMPLATES, FileProcessorTemplate, FeatureCapability } from '@renderer/config/fileProcessing'
import { FileProcessorUserConfig, FeatureUserConfig, FileProcessorOptions } from '@shared/data/preference/preferenceTypes'

/**
 * 合并后的完整处理器配置
 */
type FileProcessorMerged = FileProcessorTemplate & {
  apiKey?: string
  featureConfigs?: FeatureUserConfig[]
  options?: FileProcessorOptions
}

/**
 * 获取合并后的处理器列表
 */
function mergeProcessorConfigs(
  templates: FileProcessorTemplate[],
  userConfigs: FileProcessorUserConfig[]
): FileProcessorMerged[] {
  return templates.map(template => {
    const userConfig = userConfigs.find(c => c.id === template.id)
    return {
      ...template,
      apiKey: userConfig?.apiKey,
      featureConfigs: userConfig?.featureConfigs,
      options: userConfig?.options
    }
  })
}

/**
 * 获取特定 capability 的有效 API Host
 * 优先级：用户配置 > 模板默认值
 */
function getEffectiveApiHost(processor: FileProcessorMerged, capability: FeatureCapability): string | undefined {
  const featureConfig = processor.featureConfigs?.find(fc => fc.feature === capability.feature)
  if (featureConfig?.apiHost) {
    return featureConfig.apiHost
  }
  return capability.defaultApiHost
}

/**
 * 获取特定 capability 的有效 Model ID
 * 优先级：用户配置 > 模板默认值
 */
function getEffectiveModelId(processor: FileProcessorMerged, capability: FeatureCapability): string | undefined {
  const featureConfig = processor.featureConfigs?.find(fc => fc.feature === capability.feature)
  if (featureConfig?.modelId) {
    return featureConfig.modelId
  }
  return capability.defaultModelId
}

// Hook 使用示例
function useFileProcessors() {
  const [userConfigs] = usePreference('feature.file_processing.processors')

  const processors = useMemo(
    () => mergeProcessorConfigs(FILE_PROCESSOR_TEMPLATES, userConfigs),
    [userConfigs]
  )

  return processors
}
```

### 读取处理器配置

```typescript
const processors = useFileProcessors()
const [defaultDocProcessor] = usePreference('feature.file_processing.default_document_processor')

// 获取已配置 API Key 的处理器
const configuredProcessors = processors.filter(p => p.apiKey)

// 获取支持文档输入的处理器
const documentProcessors = processors.filter(p =>
  p.inputs.includes(FileProcessorInput.DOCUMENT)
)
```

### 更新处理器 API Key

```typescript
const [userConfigs, setUserConfigs] = usePreference('feature.file_processing.processors')

const updateProcessorApiKey = (processorId: string, apiKey: string) => {
  setUserConfigs(prev => {
    const existing = prev.find(c => c.id === processorId)
    if (existing) {
      // 更新现有配置
      return prev.map(c =>
        c.id === processorId ? { ...c, apiKey } : c
      )
    } else {
      // 添加新配置
      return [...prev, { id: processorId, apiKey }]
    }
  })
}

// 存储示例：用户为 mineru 配置了 API Key
// Preference 中存储: [{ id: 'mineru', apiKey: 'sk-xxx' }]
```

### 更新处理器 API Host（覆盖默认值）

```typescript
const updateProcessorApiHost = (processorId: string, feature: 'text_extraction' | 'to_markdown', apiHost: string) => {
  setUserConfigs(prev => {
    const existing = prev.find(c => c.id === processorId)
    if (existing) {
      // Update existing config
      const featureConfigs = [...(existing.featureConfigs || [])]
      const featureIndex = featureConfigs.findIndex(fc => fc.feature === feature)
      if (featureIndex >= 0) {
        featureConfigs[featureIndex] = { ...featureConfigs[featureIndex], apiHost }
      } else {
        featureConfigs.push({ feature, apiHost })
      }
      return prev.map(c =>
        c.id === processorId ? { ...c, featureConfigs } : c
      )
    } else {
      // Add new config
      return [...prev, { id: processorId, featureConfigs: [{ feature, apiHost }] }]
    }
  })
}

// 存储示例：用户修改了 mineru 的 API Host
// Preference 中存储:
// [{ id: 'mineru', apiKey: 'sk-xxx', featureConfigs: [{ feature: 'to_markdown', apiHost: 'https://custom.mineru.net' }] }]
```

### 设置默认处理器

```typescript
const [, setDefaultDocProcessor] = usePreference('feature.file_processing.default_document_processor')

setDefaultDocProcessor('mineru')
```

---

## 数据迁移策略

### 迁移来源

| 来源 | Redux Key | 目标 Preference Key |
|------|-----------|---------------------|
| OCR providers | `ocr.providers` | `feature.file_processing.processors` (提取用户配置) |
| OCR 默认图片处理器 | `ocr.imageProviderId` | `feature.file_processing.default_image_processor` |
| Preprocess providers | `preprocess.providers` | `feature.file_processing.processors` (提取用户配置) |
| Preprocess 默认处理器 | `preprocess.defaultProvider` | `feature.file_processing.default_document_processor` |

### 迁移映射

#### OCR Provider → FileProcessorUserConfig

```typescript
// 旧 OCR Provider
{
  id: 'tesseract',
  name: 'Tesseract OCR',
  capabilities: { image: true },
  config: {
    langs: { chi_sim: true, eng: true }
  }
}

// 新 FileProcessorUserConfig（只提取用户配置）
// langs 改为数组格式，更简洁
{
  id: 'tesseract',
  options: { langs: ['chi_sim', 'eng'] }
}
```

#### Preprocess Provider → FileProcessorUserConfig

```typescript
// 旧 Preprocess Provider
{
  id: 'mineru',
  name: 'MinerU',
  apiKey: 'user-api-key',
  apiHost: 'https://mineru.net'
}

// 新 FileProcessorUserConfig（只提取用户配置）
// 如果 apiHost 与模板默认值相同，则不存储
{
  id: 'mineru',
  apiKey: 'user-api-key'
}

// 如果 apiHost 与模板默认值不同，则存储在 featureConfigs 中
{
  id: 'mineru',
  apiKey: 'user-api-key',
  featureConfigs: [
    { feature: 'to_markdown', apiHost: 'https://custom.mineru.net' }
  ]
}
```

### 迁移实现

**文件**: `src/main/data/migrations/migrateFileProcessing.ts`

```typescript
import { preferenceService } from '@main/data/services/preferenceService'
import { FILE_PROCESSOR_TEMPLATES } from '@renderer/config/fileProcessing'
import type { FileProcessorUserConfig, FeatureUserConfig } from '@shared/data/preference/preferenceTypes'

interface LegacyOcrProvider {
  id: string
  config?: {
    api?: { apiKey: string; apiHost: string }
    langs?: Record<string, boolean>
  }
}

interface LegacyPreprocessProvider {
  id: string
  apiKey?: string
  apiHost?: string
  model?: string
}

export async function migrateFileProcessingConfig(
  legacyOcr: { providers: LegacyOcrProvider[]; imageProviderId: string },
  legacyPreprocess: { providers: LegacyPreprocessProvider[]; defaultProvider: string }
) {
  const userConfigs: FileProcessorUserConfig[] = []

  // 1. 迁移 OCR 用户配置
  for (const ocrProvider of legacyOcr.providers) {
    const template = FILE_PROCESSOR_TEMPLATES.find(t => t.id === ocrProvider.id)
    if (!template) continue

    const userConfig: FileProcessorUserConfig = { id: ocrProvider.id }
    const featureConfigs: FeatureUserConfig[] = []
    let hasUserConfig = false

    // 提取 API 配置
    if (ocrProvider.config?.api?.apiKey) {
      userConfig.apiKey = ocrProvider.config.api.apiKey
      hasUserConfig = true
    }

    // apiHost 存储在 featureConfigs 中 (text_extraction feature)
    const defaultApiHost = template.capabilities.find(c => c.feature === 'text_extraction')?.defaultApiHost
    if (ocrProvider.config?.api?.apiHost && ocrProvider.config.api.apiHost !== defaultApiHost) {
      featureConfigs.push({
        feature: 'text_extraction',
        apiHost: ocrProvider.config.api.apiHost
      })
      hasUserConfig = true
    }

    // 提取语言配置（转换为数组格式）
    if (ocrProvider.config?.langs) {
      const enabledLangs = Object.entries(ocrProvider.config.langs)
        .filter(([, enabled]) => enabled)
        .map(([lang]) => lang)
      if (enabledLangs.length > 0) {
        userConfig.options = { langs: enabledLangs }
        hasUserConfig = true
      }
    }

    if (featureConfigs.length > 0) {
      userConfig.featureConfigs = featureConfigs
    }

    if (hasUserConfig) {
      userConfigs.push(userConfig)
    }
  }

  // 2. 迁移 Preprocess 用户配置
  for (const preprocProvider of legacyPreprocess.providers) {
    const template = FILE_PROCESSOR_TEMPLATES.find(t => t.id === preprocProvider.id)
    if (!template) continue

    // 检查是否已经有这个 ID 的配置（可能 OCR 和 Preprocess 有重叠）
    const existingIndex = userConfigs.findIndex(c => c.id === preprocProvider.id)
    const userConfig: FileProcessorUserConfig = existingIndex >= 0
      ? { ...userConfigs[existingIndex] }
      : { id: preprocProvider.id }
    const featureConfigs: FeatureUserConfig[] = [...(userConfig.featureConfigs || [])]
    let hasUserConfig = existingIndex >= 0

    // 提取 API 配置
    if (preprocProvider.apiKey) {
      userConfig.apiKey = preprocProvider.apiKey
      hasUserConfig = true
    }

    // apiHost/modelId 存储在 featureConfigs 中 (to_markdown feature)
    const toMarkdownCapability = template.capabilities.find(c => c.feature === 'to_markdown')
    const featureConfig: FeatureUserConfig = { feature: 'to_markdown' }
    let hasFeatureConfig = false

    if (preprocProvider.apiHost && preprocProvider.apiHost !== toMarkdownCapability?.defaultApiHost) {
      featureConfig.apiHost = preprocProvider.apiHost
      hasFeatureConfig = true
    }
    if (preprocProvider.model && preprocProvider.model !== toMarkdownCapability?.defaultModelId) {
      featureConfig.modelId = preprocProvider.model
      hasFeatureConfig = true
    }

    if (hasFeatureConfig) {
      const existingFeatureIndex = featureConfigs.findIndex(fc => fc.feature === 'to_markdown')
      if (existingFeatureIndex >= 0) {
        featureConfigs[existingFeatureIndex] = { ...featureConfigs[existingFeatureIndex], ...featureConfig }
      } else {
        featureConfigs.push(featureConfig)
      }
      hasUserConfig = true
    }

    if (featureConfigs.length > 0) {
      userConfig.featureConfigs = featureConfigs
    }

    if (hasUserConfig) {
      if (existingIndex >= 0) {
        userConfigs[existingIndex] = userConfig
      } else {
        userConfigs.push(userConfig)
      }
    }
  }

  // 3. 写入新 Preference
  if (userConfigs.length > 0) {
    await preferenceService.set('feature.file_processing.processors', userConfigs)
  }
  await preferenceService.set('feature.file_processing.default_image_processor', legacyOcr.imageProviderId)
  await preferenceService.set('feature.file_processing.default_document_processor', legacyPreprocess.defaultProvider)
}
```

---

## 实现步骤

### Step 1: 添加用户配置类型定义

**文件**: `packages/shared/data/preference/preferenceTypes.ts`

添加以下类型：
- `FileProcessorOptions` (通用 `Record<string, unknown>` 类型)
- `FeatureUserConfig` (Feature 级别配置)
- `FileProcessorUserConfig`

### Step 2: 创建模板配置文件

**文件**: `src/renderer/src/config/fileProcessing.ts`

添加以下内容：
- `FileProcessorType`
- `FileProcessorFeature` (enum)
- `FileProcessorInput` (enum)
- `FileProcessorOutput` (enum)
- `FileProcessorTemplate`
- `FILE_PROCESSOR_TEMPLATES` (内置处理器模板数组)

### Step 3: 更新 Schema Interface

**文件**: `packages/shared/data/preference/preferenceSchemas.ts`

在 `PreferenceSchemas.default` 中添加：
- `'feature.file_processing.processors': PreferenceTypes.FileProcessorUserConfig[]`
- `'feature.file_processing.default_document_processor': string | null`
- `'feature.file_processing.default_image_processor': string | null`

### Step 4: 添加默认值

**文件**: `packages/shared/data/preference/preferenceSchemas.ts`

在 `DefaultPreferences.default` 中添加：
```typescript
'feature.file_processing.processors': [],
'feature.file_processing.default_document_processor': null,
'feature.file_processing.default_image_processor': null
```

### Step 5: 实现迁移逻辑

**文件**: `src/main/data/migrations/migrateFileProcessing.ts`

实现从 Redux 到 Preference 的数据迁移，只提取用户配置的字段。

### Step 6: 创建 useFileProcessors Hook

**文件**: `src/renderer/src/hooks/useFileProcessors.ts`

实现模板与用户配置的合并逻辑。

---

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/shared/data/preference/preferenceTypes.ts` | 修改 | 添加 `FileProcessorOptions`, `FeatureUserConfig`, `FileProcessorUserConfig` |
| `packages/shared/data/preference/preferenceSchemas.ts` | 修改 | 添加 schema 和空数组默认值 |
| `src/renderer/src/config/fileProcessing.ts` | 新建 | 模板类型和内置处理器配置 |
| `src/renderer/src/hooks/useFileProcessors.ts` | 新建 | 合并模板与用户配置的 Hook |
| `src/main/data/migrations/migrateFileProcessing.ts` | 新建 | 数据迁移逻辑 |

---

## 设计优势

### 模板与用户配置分离的优势

1. **存储空间优化**：Preference 只存储用户修改的字段，不存储冗余的模板数据
2. **模板升级友好**：更新模板（如修改默认 API Host）不会影响用户已有配置
3. **数据结构清晰**：模板数据和用户数据职责分明
4. **迁移简化**：只需要提取用户配置的字段
5. **Feature 级配置灵活**：apiHost/modelId 在 Feature 级别配置，支持同一处理器不同功能使用不同端点

### 存储示例

```typescript
// 用户只配置了 mineru 的 API Key
// Preference 存储:
{
  'feature.file_processing.processors': [
    { id: 'mineru', apiKey: 'sk-xxx' }
  ],
  'feature.file_processing.default_document_processor': 'mineru',
  'feature.file_processing.default_image_processor': 'tesseract'
}

// 用户配置了 mineru 的 API Key 并修改了 API Host
// Preference 存储:
{
  'feature.file_processing.processors': [
    {
      id: 'mineru',
      apiKey: 'sk-xxx',
      featureConfigs: [
        { feature: 'to_markdown', apiHost: 'https://custom.mineru.net' }
      ]
    }
  ],
  'feature.file_processing.default_document_processor': 'mineru',
  'feature.file_processing.default_image_processor': 'tesseract'
}

// 用户配置了 Tesseract 的语言选择
// Preference 存储:
{
  'feature.file_processing.processors': [
    { id: 'tesseract', options: { langs: ['chi_sim', 'chi_tra', 'eng'] } }
  ],
  'feature.file_processing.default_document_processor': null,
  'feature.file_processing.default_image_processor': 'tesseract'
}

// 用户同时配置了多个处理器
// Preference 存储:
{
  'feature.file_processing.processors': [
    { id: 'mineru', apiKey: 'sk-xxx' },
    { id: 'tesseract', options: { langs: ['chi_sim', 'eng'] } }
  ],
  'feature.file_processing.default_document_processor': 'mineru',
  'feature.file_processing.default_image_processor': 'tesseract'
}
```

---

## UI 设计

### 整体布局

```
┌─────────────────────────────────────────────────────────────────┐
│  设置 > 文件处理                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ 📚 知识库文档解析 ───────────────────────────────────────────┐│
│  │  默认服务: [MinerU ▼]                                        ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─ 🖼️ 聊天图片理解 ────────────────────────────────────────────┐│
│  │  默认服务: [Tesseract ▼]                                     ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─ 🔧 服务配置 ────────────────────────────────────────────────┐│
│  │                                                     [展开 ▼] ││
│  │  ┌─────────────────────────────────────────────────────────┐ ││
│  │  │ ▼ Tesseract                                    [本地]   │ ││
│  │  │   ┌───────────────────────────────────────────────────┐ │ ││
│  │  │   │ 识别语言  [🇨🇳 中文简体] [🇨🇳 中文繁体] [+2]  [▼] │ │ ││
│  │  │   │           ⓘ 选择需要识别的语言，语言越少速度越快    │ │ ││
│  │  │   └───────────────────────────────────────────────────┘ │ ││
│  │  └─────────────────────────────────────────────────────────┘ ││
│  │                                                              ││
│  │  ┌─────────────────────────────────────────────────────────┐ ││
│  │  │ ▶ MinerU                                       [API]    │ ││
│  │  │   API Key: ●●●●●●●●                           [已配置]  │ ││
│  │  └─────────────────────────────────────────────────────────┘ ││
│  │                                                              ││
│  │  ┌─────────────────────────────────────────────────────────┐ ││
│  │  │ ▶ Doc2x                                        [API]    │ ││
│  │  │   API Key: 未配置                              [配置]   │ ││
│  │  └─────────────────────────────────────────────────────────┘ ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 处理器配置组件

根据处理器类型和 ID 动态渲染不同的配置项：

```tsx
function ProcessorConfigItem({ processor }: { processor: FileProcessorMerged }) {
  return (
    <div className="processor-config">
      <div className="processor-header">
        <span>{processor.name}</span>
        <Badge>{processor.type}</Badge>
      </div>

      {/* 通用配置：API 类型显示 API Key 输入 */}
      {processor.type === 'api' && (
        <ApiKeyInput processorId={processor.id} />
      )}

      {/* 处理器特有配置：通过 options 存在性判断 */}
      {processor.options?.langs && (
        <TesseractLangSelect
          value={processor.options.langs as string[]}
          onChange={...}
        />
      )}

      {/* 或者通过 processor.id 判断（更明确） */}
      {processor.id === 'tesseract' && (
        <TesseractLangSelect ... />
      )}
    </div>
  )
}
```

### 更新 Tesseract 语言配置

```typescript
const [userConfigs, setUserConfigs] = usePreference('feature.file_processing.processors')

const updateTesseractLangs = (langs: string[]) => {
  setUserConfigs(prev => {
    const existing = prev.find(c => c.id === 'tesseract')
    if (existing) {
      return prev.map(c =>
        c.id === 'tesseract'
          ? { ...c, options: { ...c.options, langs } }
          : c
      )
    } else {
      return [...prev, { id: 'tesseract', options: { langs } }]
    }
  })
}

// 存储示例：用户修改了 Tesseract 语言配置
// Preference 中存储: [{ id: 'tesseract', options: { langs: ['chi_sim', 'eng'] } }]
```

### Tesseract 语言配置组件

```
┌─────────────────────────────────────────────────────────────────┐
│ Tesseract                                              [本地]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  识别语言                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ [🇨🇳 中文简体 ×] [🇹🇼 中文繁体 ×] [🇬🇧 英语 ×]    [▼] │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ⓘ 选择需要识别的语言。语言越多，初始化越慢，准确性可能下降。     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**设计原则**：
- 处理器特有配置通过 `options` 字段存储
- UI 组件根据 `processor.id` 决定渲染哪些特有配置
- `options` 使用通用 `Record<string, unknown>` 类型，无需预定义所有配置结构
- 添加新处理器时，只需在 UI 中添加条件渲染，无需修改类型定义

---

## 验证方案

1. **类型检查**: 运行 `pnpm lint` 确保类型正确
2. **迁移测试**: 验证从旧配置到新配置的迁移正确性
3. **功能测试**: 验证处理器配置的读写和同步功能
4. **回归测试**: 确保现有 OCR/Preprocess 功能正常工作
