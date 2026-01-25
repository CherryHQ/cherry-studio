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
   - 模板数据（处理器元信息）存储在 `packages/shared/data/presets/fileProcessing.ts`
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
│  模板数据 (packages/shared/data/presets/fileProcessing.ts)      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ PRESETS_FILE_PROCESSORS: FileProcessorTemplate[] = [        ││
│  │   { id: 'mineru', type: 'api', capabilities: [...] }      ││
│  │   { id: 'tesseract', type: 'builtin', capabilities: [...] } ││
│  │ ]                                                           ││
│  │ (只读，包含 id, type, capabilities)                         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────┐
│  用户配置 (Preference: feature.file_processing.overrides)        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ {                                                           ││
│  │   mineru: { apiKey: '***' },                                ││
│  │   doc2x: { apiKey: '***', capabilities: { ... } }           ││
│  │ }                                                           ││
│  │ (只存储用户修改的字段：apiKey/capabilities/options)          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  运行时合并 (ConfigurationService)                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Template + Override → FileProcessorMerged (DataApi 返回)      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Preference Keys

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `feature.file_processing.overrides` | `FileProcessorOverrides` | `{}` | 用户覆盖配置（仅存储修改的字段） |
| `feature.file_processing.default_markdown_conversion_processor` | `string \| null` | `null` | 文档转 Markdown 默认处理器 ID |
| `feature.file_processing.default_text_extraction_processor` | `string \| null` | `null` | 图片文字提取默认处理器 ID |

### 类型定义 (packages/shared/data/presets/fileProcessing.ts)

```typescript
// ============================================
// Template Types (presets)
// ============================================

/**
 * 处理器服务类型
 */
export type FileProcessorType = 'api' | 'builtin'

/**
 * Feature 类型
 */
export type FileProcessorFeature = 'text_extraction' | 'markdown_conversion'

/**
 * 输入类型（分类）
 */
export type FileProcessorInput = 'image' | 'document'

/**
 * 输出格式
 */
export type FileProcessorOutput = 'text' | 'markdown'

/**
 * 处理器元数据
 */
export type FileProcessorMetadata = {
  maxFileSizeMb?: number
  maxPageCount?: number
}

/**
 * Feature capability 定义
 */
export type FeatureCapability = {
  feature: FileProcessorFeature
  input: FileProcessorInput
  output: FileProcessorOutput
  apiHost?: string
  modelId?: string
}

/**
 * 处理器模板（只读元数据）
 * Display name 使用 i18n key: `processor.${id}.name`
 */
export type FileProcessorTemplate = {
  id: string
  type: FileProcessorType
  metadata?: FileProcessorMetadata
  capabilities: FeatureCapability[]
}

// ============================================
// Override Types (Preference)
// ============================================

/**
 * 处理器特定配置
 *
 * 使用通用 Record 类型，不预定义具体结构。
 * 各处理器的配置由 UI 组件根据 processor.id 自行解释。
 *
 * 已知的 options 字段：
 * - Tesseract: { langs: string[] }  // 启用的语言代码数组
 */
export type FileProcessorOptions = Record<string, unknown>

/**
 * Feature 级覆盖配置
 */
export type CapabilityOverride = {
  apiHost?: string
  modelId?: string
}

/**
 * 用户配置的处理器覆盖（存储在 Preference 中）
 */
export type FileProcessorOverride = {
  apiKey?: string
  capabilities?: Partial<Record<FileProcessorFeature, CapabilityOverride>>
  options?: FileProcessorOptions
}

export type FileProcessorOverrides = Record<string, FileProcessorOverride>

/**
 * 合并后的完整处理器配置 (template + user override)
 *
 * 统一用于 Renderer (UI 展示/编辑) 和 Main (执行)。
 */
export type FileProcessorMerged = {
  id: string
  type: FileProcessorType
  metadata?: FileProcessorMetadata
  capabilities: FeatureCapability[]
  apiKey?: string
  options?: FileProcessorOptions
}
```

### 模板类型定义 (packages/shared/data/presets/fileProcessing.ts)

```typescript
/**
 * 处理器模板（只读元数据）
 */
export type FileProcessorTemplate = {
  id: string
  type: 'api' | 'builtin'
  capabilities: FeatureCapability[]
}

/**
 * 内置处理器模板
 */
export const PRESETS_FILE_PROCESSORS: FileProcessorTemplate[] = [
  // === 图片处理器 (原 OCR) ===
  {
    id: 'tesseract',
    type: 'builtin',
    capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
  },
  {
    id: 'system',
    type: 'builtin',
    capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
  },
  {
    id: 'paddleocr',
    type: 'api',
    capabilities: [
      { feature: 'text_extraction', input: 'image', output: 'text', apiHost: '' }
    ]
  },
  {
    id: 'ovocr',
    type: 'builtin',
    capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }]
  },

  // === 文档处理器 (原 Preprocess) ===
  {
    id: 'mineru',
    type: 'api',
    metadata: {
      maxFileSizeMb: 200,
      maxPageCount: 600
    },
    capabilities: [
      {
        feature: 'markdown_conversion',
        input: 'document',
        output: 'markdown',
        apiHost: 'https://mineru.net'
      }
    ]
  },
  {
    id: 'doc2x',
    type: 'api',
    metadata: {
      maxFileSizeMb: 300,
      maxPageCount: 1000
    },
    capabilities: [
      {
        feature: 'markdown_conversion',
        input: 'document',
        output: 'markdown',
        apiHost: 'https://v2.doc2x.noedgeai.com'
      }
    ]
  },
  {
    id: 'mistral',
    type: 'api',
    metadata: {
      maxFileSizeMb: 50,
      maxPageCount: 1000
    },
    capabilities: [
      {
        feature: 'markdown_conversion',
        input: 'document',
        output: 'markdown',
        apiHost: 'https://api.mistral.ai',
        modelId: 'mistral-ocr-latest'
      }
    ]
  },
  {
    id: 'open-mineru',
    type: 'api',
    metadata: {
      maxFileSizeMb: 200,
      maxPageCount: 600
    },
    capabilities: [
      {
        feature: 'markdown_conversion',
        input: 'document',
        output: 'markdown',
        apiHost: 'http://127.0.0.1:8000'
      }
    ]
  }
]
```

### Schema 定义 (preferenceSchemas.ts)

```typescript
import type { FileProcessorOverrides } from '@shared/data/presets/fileProcessing'

export interface PreferenceSchemas {
  default: {
    // ... existing keys ...

    // File Processing
    'feature.file_processing.overrides': FileProcessorOverrides
    'feature.file_processing.default_markdown_conversion_processor': string | null
    'feature.file_processing.default_text_extraction_processor': string | null
  }
}
```

### 默认值 (DefaultPreferences)

```typescript
export const DefaultPreferences: PreferenceSchemas = {
  default: {
    // ... existing defaults ...

    // 空对象，用户配置后才会有数据
    'feature.file_processing.overrides': {},
    'feature.file_processing.default_markdown_conversion_processor': null,
    'feature.file_processing.default_text_extraction_processor': null
  }
}
```

---

## 使用示例

### 获取处理器列表（已合并配置）

```typescript
import { useFileProcessors } from '@renderer/hooks/useFileProcessors'

const { processors, isLoading } = useFileProcessors({ feature: 'markdown_conversion' })
```

> `processors` 为 `FileProcessorMerged[]`，由后端 `ConfigurationService` 合并模板与用户覆盖配置后返回。
> 合并后的 `capabilities` 已包含有效的 `apiHost`/`modelId`。

### 获取单个处理器并更新配置

```typescript
import { useFileProcessor } from '@renderer/hooks/useFileProcessors'

const { processor, updateProcessor } = useFileProcessor('mineru')

// 更新 API Key
updateProcessor({ apiKey: 'sk-xxx' })

// 覆盖指定 Feature 的 API Host
updateProcessor({
  capabilities: {
    markdown_conversion: { apiHost: 'https://custom.mineru.net' }
  }
})
```

### 读取处理器配置

```typescript
const capability = processor?.capabilities.find((cap) => cap.feature === 'markdown_conversion')
const apiHost = capability?.apiHost
const modelId = capability?.modelId
```

### 设置默认处理器

```typescript
const [defaultMarkdownProcessor, setDefaultMarkdownProcessor] = usePreference(
  'feature.file_processing.default_markdown_conversion_processor'
)
const [defaultTextProcessor, setDefaultTextProcessor] = usePreference(
  'feature.file_processing.default_text_extraction_processor'
)

setDefaultMarkdownProcessor('mineru')
setDefaultTextProcessor('tesseract')
```

---

## 数据迁移策略

### 迁移来源

| 来源 | Redux Key | 目标 Preference Key |
|------|-----------|---------------------|
| OCR providers | `ocr.providers` | `feature.file_processing.overrides` (提取用户配置) |
| OCR 默认图片处理器 | `ocr.imageProviderId` | `feature.file_processing.default_text_extraction_processor` |
| Preprocess providers | `preprocess.providers` | `feature.file_processing.overrides` (提取用户配置) |
| Preprocess 默认处理器 | `preprocess.defaultProvider` | `feature.file_processing.default_markdown_conversion_processor` |

### 迁移映射

#### OCR Provider → FileProcessorOverride

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

// 新 FileProcessorOverride（只提取用户配置）
// langs 改为数组格式，更简洁
{
  tesseract: {
    options: { langs: ['chi_sim', 'eng'] }
  }
}
```

#### Preprocess Provider → FileProcessorOverride

```typescript
// 旧 Preprocess Provider
{
  id: 'mineru',
  name: 'MinerU',
  apiKey: 'user-api-key',
  apiHost: 'https://mineru.net'
}

// 新 FileProcessorOverride（只提取用户配置）
// 如果 apiHost 与模板默认值相同，则不存储
{
  mineru: {
    apiKey: 'user-api-key'
  }
}

// 如果 apiHost 与模板默认值不同，则存储在 capabilities 中
{
  mineru: {
    apiKey: 'user-api-key',
    capabilities: {
      markdown_conversion: { apiHost: 'https://custom.mineru.net' }
    }
  }
}
```

### 迁移实现

**文件**:
- `src/main/data/migration/v2/migrators/transformers/PreferenceTransformers.ts`
- `src/main/data/migration/v2/migrators/mappings/ComplexPreferenceMappings.ts`

```typescript
export function transformFileProcessingConfig(sources: Record<string, unknown>): TransformResult {
  const ocrProviders = sources.ocrProviders as LegacyOcrProvider[] | undefined
  const ocrImageProviderId = sources.ocrImageProviderId as string | undefined
  const preprocessProviders = sources.preprocessProviders as LegacyPreprocessProvider[] | undefined
  const preprocessDefaultProvider = sources.preprocessDefaultProvider as string | undefined

  const overrides: FileProcessorOverrides = {}

  if (Array.isArray(ocrProviders)) {
    for (const provider of ocrProviders) {
      const override = extractOcrUserConfig(provider)
      if (override) {
        overrides[provider.id] = mergeOverrides(overrides[provider.id], override)
      }
    }
  }

  if (Array.isArray(preprocessProviders)) {
    for (const provider of preprocessProviders) {
      const override = extractPreprocessUserConfig(provider)
      if (override) {
        overrides[provider.id] = mergeOverrides(overrides[provider.id], override)
      }
    }
  }

  const hasOverrides = Object.keys(overrides).length > 0
  return {
    'feature.file_processing.overrides': hasOverrides ? overrides : undefined,
    'feature.file_processing.default_text_extraction_processor': isNonEmptyString(ocrImageProviderId)
      ? ocrImageProviderId
      : undefined,
    'feature.file_processing.default_markdown_conversion_processor': isNonEmptyString(preprocessDefaultProvider)
      ? preprocessDefaultProvider
      : undefined
  }
}
```

---

## 实现步骤

### Step 1: 添加用户配置类型定义

**文件**: `packages/shared/data/presets/fileProcessing.ts`

添加以下类型：
- `FileProcessorMetadata` (文件限制元数据)
- `FileProcessorOptions` (通用 `Record<string, unknown>` 类型)
- `CapabilityOverride` (Feature 级覆盖配置)
- `FileProcessorOverride` / `FileProcessorMerged`

### Step 2: 创建模板配置文件

**文件**: `packages/shared/data/presets/fileProcessing.ts`

添加以下内容：
- `FileProcessorType`
- `FileProcessorFeature` (string union)
- `FileProcessorInput` (string union)
- `FileProcessorOutput` (string union)
- `FeatureCapability`
- `FileProcessorTemplate`
- `PRESETS_FILE_PROCESSORS` (内置处理器模板数组)

### Step 3: 更新 Schema Interface

**文件**: `packages/shared/data/preference/preferenceSchemas.ts`

在 `PreferenceSchemas.default` 中添加：
- `'feature.file_processing.overrides': FileProcessorOverrides`
- `'feature.file_processing.default_markdown_conversion_processor': string | null`
- `'feature.file_processing.default_text_extraction_processor': string | null`

### Step 4: 添加默认值

**文件**: `packages/shared/data/preference/preferenceSchemas.ts`

在 `DefaultPreferences.default` 中添加：
```typescript
'feature.file_processing.overrides': {},
'feature.file_processing.default_markdown_conversion_processor': null,
'feature.file_processing.default_text_extraction_processor': null
```

### Step 5: 实现迁移逻辑

**文件**: `src/main/data/migration/v2/migrators/transformers/PreferenceTransformers.ts`

映射注册：`src/main/data/migration/v2/migrators/mappings/ComplexPreferenceMappings.ts`

实现从 Redux 到 Preference 的数据迁移，只提取用户配置的字段。

### Step 6: 创建 useFileProcessors Hook

**文件**: `src/renderer/src/hooks/useFileProcessors.ts`

通过 DataApi 获取合并后的配置，更新时调用 `/file-processing/processors/:id`。

---

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/shared/data/presets/fileProcessing.ts` | 修改 | 模板类型、内置处理器配置、override 类型、FileProcessorMerged |
| `packages/shared/data/preference/preferenceSchemas.ts` | 修改 | 添加 schema 和默认值 |
| `src/renderer/src/hooks/useFileProcessors.ts` | 修改 | DataApi 拉取合并后的配置 |
| `src/main/data/migration/v2/migrators/transformers/PreferenceTransformers.ts` | 修改 | 数据迁移逻辑 |
| `src/main/data/migration/v2/migrators/mappings/ComplexPreferenceMappings.ts` | 修改 | 注册迁移映射 |

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
  'feature.file_processing.overrides': {
    mineru: { apiKey: 'sk-xxx' }
  },
  'feature.file_processing.default_markdown_conversion_processor': 'mineru',
  'feature.file_processing.default_text_extraction_processor': 'tesseract'
}

// 用户配置了 mineru 的 API Key 并修改了 API Host
// Preference 存储:
{
  'feature.file_processing.overrides': {
    mineru: {
      apiKey: 'sk-xxx',
      capabilities: {
        markdown_conversion: { apiHost: 'https://custom.mineru.net' }
      }
    }
  },
  'feature.file_processing.default_markdown_conversion_processor': 'mineru',
  'feature.file_processing.default_text_extraction_processor': 'tesseract'
}

// 用户配置了 Tesseract 的语言选择
// Preference 存储:
{
  'feature.file_processing.overrides': {
    tesseract: { options: { langs: ['chi_sim', 'chi_tra', 'eng'] } }
  },
  'feature.file_processing.default_markdown_conversion_processor': null,
  'feature.file_processing.default_text_extraction_processor': 'tesseract'
}

// 用户同时配置了多个处理器
// Preference 存储:
{
  'feature.file_processing.overrides': {
    mineru: { apiKey: 'sk-xxx' },
    tesseract: { options: { langs: ['chi_sim', 'eng'] } }
  },
  'feature.file_processing.default_markdown_conversion_processor': 'mineru',
  'feature.file_processing.default_text_extraction_processor': 'tesseract'
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
        <span>{t(`processor.${processor.id}.name`)}</span>
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
const { processor, updateProcessor } = useFileProcessor('tesseract')

const updateTesseractLangs = (langs: string[]) => {
  updateProcessor({
    options: {
      ...processor?.options,
      langs
    }
  })
}

// 存储示例：用户修改了 Tesseract 语言配置
// Preference 中存储: { tesseract: { options: { langs: ['chi_sim', 'eng'] } } }
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
