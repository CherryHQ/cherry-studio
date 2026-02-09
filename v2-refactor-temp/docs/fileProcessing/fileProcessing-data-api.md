# File Processing Data API 设计

本文档描述文件处理（File Processing）的数据存储设计，统一了现有的 OCR 和 Preprocess 功能。

## 架构概览

```
Template (Preset) + User Override (Preference) → Merged Config (Runtime)
```

- **Template**: 处理器元信息，存储在 `packages/shared/data/presets/file-processing.ts`
- **Override**: 用户配置（apiKeys, apiHost 等），存储在 Preference
- **Merged**: 运行时合并，由 ConfigurationService 返回

### 为什么使用 Preference？

根据 [Data System 设计规范](../../../docs/en/references/data/README.md)：
- 数据来源：用户配置
- 数据量：固定数量（~10个处理器）
- 丢失影响：可重新配置

## Preference Keys

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `feature.file_processing.overrides` | `FileProcessorOverrides` | `{}` | 用户覆盖配置 |
| `feature.file_processing.default_markdown_conversion_processor` | `string \| null` | `null` | 文档转 Markdown 默认处理器 |
| `feature.file_processing.default_text_extraction_processor` | `string \| null` | `null` | 图片文字提取默认处理器 |

## 类型定义

位置: `packages/shared/data/presets/file-processing.ts`

```typescript
// ============================================
// Template Types (只读元数据)
// ============================================

export type FileProcessorType = 'api' | 'builtin'
export type FileProcessorFeature = 'text_extraction' | 'markdown_conversion'
export type FileProcessorInput = 'image' | 'document'
export type FileProcessorOutput = 'text' | 'markdown'

export type FileProcessorMetadata = Record<string, never>

export type FeatureCapability = {
  feature: FileProcessorFeature
  input: FileProcessorInput
  output: FileProcessorOutput
  apiHost?: string
  modelId?: string
}

// 注意：capabilities 仅表示潜在支持范围，实际支持由具体 processor 校验；
// 不支持的输入应抛出错误并由前端提示。

export type FileProcessorTemplate = {
  id: string
  type: FileProcessorType
  metadata?: FileProcessorMetadata
  capabilities: FeatureCapability[]
}

// ============================================
// Override Types (用户配置)
// ============================================

export type FileProcessorOptions = Record<string, unknown>

export type CapabilityOverride = {
  apiHost?: string
  modelId?: string
}

export type FileProcessorOverride = {
  apiKeys?: string[]
  capabilities?: Partial<Record<FileProcessorFeature, CapabilityOverride>>
  options?: FileProcessorOptions
}

export type FileProcessorOverrides = Record<string, FileProcessorOverride>

// ============================================
// Merged Type (运行时)
// ============================================

export type FileProcessorMerged = {
  id: string
  type: FileProcessorType
  metadata?: FileProcessorMetadata
  capabilities: FeatureCapability[]
  apiKeys?: string[]
  options?: FileProcessorOptions
}
```

## 使用示例

### 获取处理器列表

```typescript
import { useFileProcessors } from '@renderer/hooks/useFileProcessing'

const { processors, isLoading } = useFileProcessors({ feature: 'markdown_conversion' })
// processors: FileProcessorMerged[]
```

### 更新处理器配置

```typescript
import { useFileProcessor } from '@renderer/hooks/useFileProcessing'

const { processor, updateProcessor } = useFileProcessor('mineru')

// 更新 API Keys
updateProcessor({ apiKeys: ['sk-xxx'] })

// 覆盖 API Host
updateProcessor({
  capabilities: {
    markdown_conversion: { apiHost: 'https://custom.mineru.net' }
  }
})
```

### 设置默认处理器

```typescript
const [defaultProcessor, setDefaultProcessor] = usePreference(
  'feature.file_processing.default_markdown_conversion_processor'
)
setDefaultProcessor('mineru')
```

## 数据迁移

### 迁移映射

| 来源 | 目标 |
|------|------|
| `ocr.providers` | `feature.file_processing.overrides` |
| `ocr.imageProviderId` | `feature.file_processing.default_text_extraction_processor` |
| `preprocess.providers` | `feature.file_processing.overrides` |
| `preprocess.defaultProvider` | `feature.file_processing.default_markdown_conversion_processor` |

### 迁移文件

- `src/main/data/migration/v2/migrators/transformers/PreferenceTransformers.ts`
- `src/main/data/migration/v2/migrators/mappings/ComplexPreferenceMappings.ts`

## 设计要点

1. **模板与配置分离**: Preference 只存储用户修改的字段，不存储冗余模板数据
2. **模板升级友好**: 更新模板不影响用户已有配置
3. **Feature 级配置**: apiHost/modelId 支持按 Feature 分别配置
4. **仅内置处理器**: 不支持用户添加自定义处理器
