# 模型和供应商参数化配置实现方案

## 📋 项目概述

本文档描述了在 `@packages/catalog/` 下实现模型和供应商参数化配置的方案，目标是将现有的硬编码逻辑重构为元数据驱动的配置系统。

## 🎯 目标

### 主要目标
- 将硬编码的模型识别逻辑转换为 JSON 配置驱动
- 解决"同一模型在不同供应商下有差异"的问题
- 提供类型安全的配置系统（使用 Zod）
- 支持未来通过配置更新添加新模型

### 痛点解决
- **当前问题**：`src/renderer/src/config/models/` 下复杂的正则表达式和硬编码逻辑
- **期望状态**：配置以 JSON 形式存在，代码中使用 Zod Schema 验证
- **可维护性**：新模型发布时只需更新 JSON 配置，无需修改代码

## 🏗️ 架构设计

### 三层分离的元数据架构

```
1. Base Model Catalog (models/*.json)
   ├─ 模型基础信息（ID、能力、模态、限制、价格）
   └─ 官方/标准配置

2. Provider Catalog (providers/*.json)
   ├─ 供应商特性（端点支持、API 兼容性）
   └─ 认证和定价模型

3. Provider Model Overrides (overrides/*.json)
   ├─ 供应商对特定模型的覆盖
   └─ 解决"同一模型不同供应商差异"问题
```

### 简化后的文件结构

```
packages/catalog/
├── src/
│   ├── index.ts                   # 主导出文件
│   ├── schemas/                   # Schema 定义
│   │   ├── index.ts               # 统一导出
│   │   ├── model.schema.ts        # 模型配置 Schema + Zod
│   │   ├── provider.schema.ts     # 供应商配置 Schema + Zod
│   │   └── override.schema.ts     # 覆盖配置 Schema + Zod
│   ├── data/                      # 配置数据（单文件存储）
│   │   ├── models.json            # 所有模型配置
│   │   ├── providers.json         # 所有供应商配置
│   │   └── overrides.json         # 所有覆盖配置
│   ├── services/                  # 核心服务
│   │   ├── CatalogService.ts      # 统一的目录服务
│   │   └── ConfigLoader.ts        # 配置加载 + 验证
│   ├── utils/                     # 工具函数
│   │   ├── migrate.ts             # 迁移工具（从旧代码提取配置）
│   │   └── helpers.ts             # 辅助函数
│   └── __tests__/                 # 测试文件
│       ├── fixtures/              # 测试数据
│       ├── schemas.test.ts        # Schema 测试
│       └── catalog.test.ts        # 目录服务测试
├── scripts/
│   └── migrate.ts                 # 迁移脚本 CLI
└── package.json
```

## 📝 Schema 定义

### 1. 模型配置 Schema

```typescript
// packages/catalog/src/schemas/model.schema.ts

import * as z from 'zod'
import { EndpointTypeSchema } from './provider.schema'

// 模态类型
export const ModalitySchema = z.enum(['TEXT', 'VISION', 'AUDIO', 'VIDEO', 'VECTOR'])

// 能力类型
export const ModelCapabilityTypeSchema = z.enum([
  'FUNCTION_CALL',      // 函数调用
  'REASONING',          // 推理
  'IMAGE_RECOGNITION',  // 图像识别
  'IMAGE_GENERATION',   // 图像生成
  'AUDIO_RECOGNITION',  // 音频识别
  'AUDIO_GENERATION',   // 音频生成
  'EMBEDDING',          // 嵌入向量生成
  'RERANK',             // 文本重排序
  'AUDIO_TRANSCRIPT',   // 音频转录
  'VIDEO_RECOGNITION',  // 视频识别
  'VIDEO_GENERATION',   // 视频生成
  'STRUCTURED_OUTPUT',  // 结构化输出
  'FILE_INPUT',         // 文件输入支持
  'WEB_SEARCH',         // 内置网络搜索
  'CODE_EXECUTION',     // 代码执行
  'FILE_SEARCH',        // 文件搜索
  'COMPUTER_USE'        // 计算机使用
])

// 推理配置
export const ReasoningConfigSchema = z.object({
  supportedEfforts: z.array(z.enum(['low', 'medium', 'high'])),
  implementation: z.enum(['OPENAI_O1', 'ANTHROPIC_CLAUDE', 'DEEPSEEK_R1', 'GEMINI_THINKING']),
  reasoningMode: z.enum(['ALWAYS_ON', 'ON_DEMAND']),
  thinkingControl: z.object({
    enabled: z.boolean(),
    budget: z.object({
      min: z.number().optional(),
      max: z.number().optional()
    }).optional()
  }).optional()
})

// 参数支持配置
export const ParameterSupportSchema = z.object({
  temperature: z.object({
    supported: z.boolean(),
    min: z.number().min(0).max(2).optional(),
    max: z.number().min(0).max(2).optional(),
    default: z.number().min(0).max(2).optional()
  }).optional(),
  topP: z.object({
    supported: z.boolean(),
    min: z.number().min(0).max(1).optional(),
    max: z.number().min(0).max(1).optional(),
    default: z.number().min(0).max(1).optional()
  }).optional(),
  topK: z.object({
    supported: z.boolean(),
    min: z.number().positive().optional(),
    max: z.number().positive().optional()
  }).optional(),
  frequencyPenalty: z.boolean().optional(),
  presencePenalty: z.boolean().optional(),
  maxTokens: z.boolean().optional(),
  stopSequences: z.boolean().optional(),
  systemMessage: z.boolean().optional(),
  developerRole: z.boolean().optional()
})

// 定价配置
export const ModelPricingSchema = z.object({
  input: z.object({
    perMillionTokens: z.number(),
    currency: z.string().default('USD')
  }),
  output: z.object({
    perMillionTokens: z.number(),
    currency: z.string().default('USD')
  }),
  perImage: z.object({
    price: z.number(),
    currency: z.string().default('USD')
  }).optional(),
  perMinute: z.object({
    price: z.number(),
    currency: z.string().default('USD')
  }).optional()
})

// 模型配置 Schema
export const ModelConfigSchema = z.object({
  // 基础信息
  id: z.string(),
  name: z.string().optional(),
  ownedBy: z.string().optional(),
  description: z.string().optional(),

  // 能力（核心）
  capabilities: z.array(ModelCapabilityTypeSchema),

  // 模态
  inputModalities: z.array(ModalitySchema),
  outputModalities: z.array(ModalitySchema),

  // 限制
  contextWindow: z.number(),
  maxOutputTokens: z.number(),
  maxInputTokens: z.number().optional(),

  // 价格
  pricing: ModelPricingSchema.optional(),

  // 推理配置
  reasoning: ReasoningConfigSchema.optional(),

  // 参数支持
  parameters: ParameterSupportSchema.optional(),

  // 端点类型
  endpointTypes: z.array(EndpointTypeSchema).optional(),

  // 元数据
  releaseDate: z.string().optional(),
  deprecationDate: z.string().optional(),
  replacedBy: z.string().optional()
})

export type ModelConfig = z.infer<typeof ModelConfigSchema>
```

### 2. 供应商配置 Schema（简化版）

```typescript
// packages/catalog/src/schemas/provider.schema.ts

import * as z from 'zod'

// 端点类型
export const EndpointTypeSchema = z.enum([
  'CHAT_COMPLETIONS',
  'COMPLETIONS',
  'EMBEDDINGS',
  'IMAGE_GENERATION',
  'AUDIO_SPEECH',
  'AUDIO_TRANSCRIPTIONS',
  'MESSAGES',
  'GENERATE_CONTENT',
  'RERANK',
  'MODERATIONS'
])

// 认证方式
export const AuthenticationSchema = z.enum([
  'API_KEY',
  'OAUTH',
  'CLOUD_CREDENTIALS'
])

// 定价模型
export const PricingModelSchema = z.enum([
  'UNIFIED',       // 统一定价 (如 OpenRouter)
  'PER_MODEL',     // 按模型独立定价 (如 OpenAI 官方)
  'TRANSPARENT',   // 透明定价 (如 New-API)
])

// 模型路由策略
export const ModelRoutingSchema = z.enum([
  'INTELLIGENT',      // 智能路由
  'DIRECT',          // 直接路由
  'LOAD_BALANCED',   // 负载均衡
])

// API 兼容性配置
export const ApiCompatibilitySchema = z.object({
  supportsArrayContent: z.boolean().default(true),
  supportsStreamOptions: z.boolean().default(true),
  supportsDeveloperRole: z.boolean().default(false),
  supportsThinkingControl: z.boolean().default(false),
  supportsParallelTools: z.boolean().default(false),
  supportsMultimodal: z.boolean().default(false),
  maxFileUploadSize: z.number().optional(),
  supportedFileTypes: z.array(z.string()).optional()
})

// 供应商能力（简化版 - 使用数组代替多个布尔字段）
export const ProviderCapabilitySchema = z.enum([
  'CUSTOM_MODELS',       // 支持自定义模型
  'MODEL_MAPPING',       // 提供模型映射
  'FALLBACK_ROUTING',    // 降级路由
  'AUTO_RETRY',          // 自动重试
  'REAL_TIME_METRICS',   // 实时指标
  'USAGE_ANALYTICS',     // 使用分析
  'STREAMING',           // 流式响应
  'BATCH_PROCESSING',    // 批量处理
  'RATE_LIMITING',       // 速率限制
])

// 供应商配置 Schema（简化版）
export const ProviderConfigSchema = z.object({
  // 基础信息
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),

  // 核心配置
  authentication: AuthenticationSchema,
  pricingModel: PricingModelSchema,
  modelRouting: ModelRoutingSchema,

  // 能力（使用数组替代多个布尔字段）
  capabilities: z.array(ProviderCapabilitySchema).default([]),

  // 功能支持
  supportedEndpoints: z.array(EndpointTypeSchema),
  apiCompatibility: ApiCompatibilitySchema.optional(),

  // 默认配置
  defaultApiHost: z.string().optional(),
  defaultRateLimit: z.number().optional(),

  // 模型匹配
  modelIdPatterns: z.array(z.string()).optional(),
  aliasModelIds: z.record(z.string()).optional(),

  // 元数据
  documentation: z.string().url().optional(),
  statusPage: z.string().url().optional(),

  // 状态
  deprecated: z.boolean().default(false)
})

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
```

### 3. 覆盖配置 Schema

```typescript
// packages/catalog/src/schemas/override.schema.ts

import * as z from 'zod'
import { ModelCapabilityTypeSchema, ModelPricingSchema, ParameterSupportSchema } from './model.schema'

export const ProviderModelOverrideSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),

  // 能力覆盖
  capabilities: z.object({
    add: z.array(ModelCapabilityTypeSchema).optional(),
    remove: z.array(ModelCapabilityTypeSchema).optional()
  }).optional(),

  // 限制覆盖
  limits: z.object({
    contextWindow: z.number().optional(),
    maxOutputTokens: z.number().optional()
  }).optional(),

  // 价格覆盖
  pricing: ModelPricingSchema.optional(),

  // 参数支持覆盖
  parameters: ParameterSupportSchema.optional(),

  // 禁用模型
  disabled: z.boolean().optional(),

  // 覆盖原因
  reason: z.string().optional()
})

export type ProviderModelOverride = z.infer<typeof ProviderModelOverrideSchema>
```

## 🔧 核心 API 设计

### 统一的目录服务

```typescript
// packages/catalog/src/services/CatalogService.ts

export interface ModelFilters {
  capabilities?: ModelCapabilityType[]
  inputModalities?: Modality[]
  providers?: string[]
  minContextWindow?: number
}

export interface ProviderFilter {
  capabilities?: ProviderCapability[]
  authentication?: AuthenticationSchema
  pricingModel?: PricingModelSchema
  notDeprecated?: boolean
}

export class CatalogService {
  private models: Map<string, ModelConfig>
  private providers: Map<string, ProviderConfig>
  private overrides: Map<string, ProviderModelOverride[]>

  // === 模型查询 ===

  /**
   * 获取模型配置（应用供应商覆盖）
   */
  getModel(modelId: string, providerId?: string): ModelConfig | null

  /**
   * 检查模型能力
   */
  hasCapability(modelId: string, capability: ModelCapabilityType, providerId?: string): boolean

  /**
   * 获取模型的推理配置
   */
  getReasoningConfig(modelId: string, providerId?: string): ReasoningConfig | null

  /**
   * 获取模型参数范围
   */
  getParameterRange(
    modelId: string,
    parameter: 'temperature' | 'topP' | 'topK',
    providerId?: string
  ): { min: number, max: number, default?: number } | null

  /**
   * 批量匹配模型
   */
  findModels(filters?: ModelFilters): ModelConfig[]

  // === 供应商查询 ===

  /**
   * 获取供应商配置
   */
  getProvider(providerId: string): ProviderConfig | null

  /**
   * 检查供应商能力
   */
  hasProviderCapability(providerId: string, capability: ProviderCapability): boolean

  /**
   * 检查端点支持
   */
  supportsEndpoint(providerId: string, endpoint: EndpointType): boolean

  /**
   * 查找供应商
   */
  findProviders(filter?: ProviderFilter): ProviderConfig[]

  // === 内部方法 ===

  /**
   * 应用覆盖配置
   */
  private applyOverrides(model: ModelConfig, providerId: string): ModelConfig
}

// 统一导出
export const catalog = new CatalogService()

// 向后兼容的辅助函数
export const isFunctionCallingModel = (model: Model): boolean =>
  catalog.hasCapability(model.id, 'FUNCTION_CALL', model.provider)

export const isReasoningModel = (model: Model): boolean =>
  catalog.hasCapability(model.id, 'REASONING', model.provider)

export const isVisionModel = (model: Model): boolean =>
  catalog.hasCapability(model.id, 'IMAGE_RECOGNITION', model.provider)
```

## 📊 JSON 配置示例

### 模型配置示例

```json
// packages/catalog/src/data/models.json
{
  "version": "2025.11.24",
  "models": [
    {
      "id": "claude-3-5-sonnet-20241022",
      "name": "Claude 3.5 Sonnet",
      "owned_by": "anthropic",
      "capabilities": [
        "FUNCTION_CALL",
        "REASONING",
        "IMAGE_RECOGNITION",
        "STRUCTURED_OUTPUT",
        "FILE_INPUT"
      ],
      "input_modalities": ["TEXT", "VISION"],
      "output_modalities": ["TEXT"],
      "context_window": 200000,
      "max_output_tokens": 8192,
      "pricing": {
        "input": { "per_million_tokens": 3.0, "currency": "USD" },
        "output": { "per_million_tokens": 15.0, "currency": "USD" }
      },
      "reasoning": {
        "type": "anthropic",
        "params": {
          "type": "enabled",
          "budgetTokens": 10000
        }
      },
      "parameters": {
        "temperature": {
          "supported": true,
          "min": 0.0,
          "max": 1.0,
          "default": 1.0
        }
      },
      "metadata": {}
    },
    {
      "id": "gpt-4-turbo",
      "name": "GPT-4 Turbo",
      "owned_by": "openai",
      "capabilities": [
        "FUNCTION_CALL",
        "IMAGE_RECOGNITION",
        "STRUCTURED_OUTPUT"
      ],
      "input_modalities": ["TEXT", "VISION"],
      "output_modalities": ["TEXT"],
      "context_window": 128000,
      "max_output_tokens": 4096,
      "pricing": {
        "input": { "per_million_tokens": 10.0, "currency": "USD" },
        "output": { "per_million_tokens": 30.0, "currency": "USD" }
      },
      "metadata": {}
    }
  ]
}
```

### 供应商配置示例

```json
// packages/catalog/src/data/providers.json
{
  "version": "2025.11.24",
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "authentication": "API_KEY",
      "pricing_model": "PER_MODEL",
      "model_routing": "DIRECT",
      "behaviors": {
        "supports_custom_models": false,
        "provides_model_mapping": false,
        "supports_streaming": true,
        "has_real_time_metrics": true,
        "supports_rate_limiting": true,
        "provides_usage_analytics": true,
        "requires_api_key_validation": true
      },
      "supported_endpoints": ["MESSAGES"],
      "api_compatibility": {
        "supports_stream_options": true,
        "supports_parallel_tools": true,
        "supports_multimodal": true
      },
      "default_api_host": "https://api.anthropic.com",
      "deprecated": false,
      "maintenance_mode": false,
      "config_version": "1.0.0",
      "special_config": {},
      "metadata": {}
    },
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "authentication": "API_KEY",
      "pricing_model": "UNIFIED",
      "model_routing": "INTELLIGENT",
      "behaviors": {
        "supports_custom_models": true,
        "provides_model_mapping": true,
        "provides_fallback_routing": true,
        "has_auto_retry": true,
        "supports_streaming": true,
        "has_real_time_metrics": true
      },
      "supported_endpoints": ["CHAT_COMPLETIONS"],
      "default_api_host": "https://openrouter.ai/api/v1",
      "deprecated": false,
      "maintenance_mode": false,
      "config_version": "1.0.0",
      "special_config": {},
      "metadata": {}
    }
  ]
}
```

### 覆盖配置示例

```json
// packages/catalog/src/data/overrides.json
{
  "version": "2025.11.24",
  "overrides": [
    {
      "provider_id": "openrouter",
      "model_id": "claude-3-5-sonnet-20241022",
      "pricing": {
        "input": { "per_million_tokens": 4.5, "currency": "USD" },
        "output": { "per_million_tokens": 22.5, "currency": "USD" }
      },
      "capabilities": {
        "add": ["WEB_SEARCH"]
      },
      "reason": "OpenRouter applies markup and adds web search",
      "priority": 0
    },
    {
      "provider_id": "openrouter",
      "model_id": "gpt-4-turbo",
      "limits": {
        "context_window": 128000,
        "max_output_tokens": 16384
      },
      "reason": "OpenRouter extends output token limit",
      "priority": 0
    }
  ]
}
```

## 🔄 实现计划

### Phase 1: 基础架构 (2-3 days)

**目标**：建立核心架构和类型系统

**任务**：
1. **Schema 定义**
   - 实现 `model.schema.ts`、`provider.schema.ts`、`override.schema.ts`
   - 所有 Schema 使用 Zod 验证
   - 导出 TypeScript 类型

2. **配置加载器**
   ```typescript
   // packages/catalog/src/services/ConfigLoader.ts
   export class ConfigLoader {
     loadModels(): ModelConfig[]
     loadProviders(): ProviderConfig[]
     loadOverrides(): ProviderModelOverride[]
     validate(): boolean
   }
   ```

3. **目录服务**
   ```typescript
   // packages/catalog/src/services/CatalogService.ts
   export class CatalogService {
     // 实现所有查询 API
   }
   ```

**验收标准**：
- ✅ 所有 Schema 定义完成，通过 Zod 验证
- ✅ ConfigLoader 可以加载和验证 JSON 文件
- ✅ CatalogService 基础 API 实现
- ✅ 单元测试覆盖核心功能

### Phase 2: 数据迁移 (1-2 days)

**目标**：从现有硬编码逻辑生成 JSON 配置

**任务**：
1. **迁移工具**
   ```typescript
   // packages/catalog/src/utils/migrate.ts
   export class MigrationTool {
     // 从 src/renderer/src/config/models/ 提取模型配置
     extractModelConfigs(): ModelConfig[]

     // 提取供应商配置
     extractProviderConfigs(): ProviderConfig[]

     // 写入 JSON 文件
     writeConfigs(models: ModelConfig[], providers: ProviderConfig[]): void

     // 简单验证
     validate(): boolean
   }
   ```

2. **迁移脚本**
   ```bash
   # 运行迁移
   yarn catalog:migrate
   ```

3. **手动审核**
   - 检查生成的配置文件
   - 补充缺失的价格和限制信息
   - 调整不准确的能力定义

**验收标准**：
- ✅ 迁移工具能够提取现有配置
- ✅ 生成的配置通过 Schema 验证
- ✅ 手动审核完成，配置准确

### Phase 3: 集成替换 (2-3 days)

**目标**：替换现有硬编码逻辑

**任务**：
1. **向后兼容层**
   ```typescript
   // packages/catalog/src/index.ts
   export const isFunctionCallingModel = (model: Model): boolean =>
     catalog.hasCapability(model.id, 'FUNCTION_CALL', model.provider)
   ```

2. **逐步替换**
   - 替换 `src/renderer/src/config/models/` 中的函数
   - 更新所有调用点
   - 确保测试通过

3. **集成测试**
   - 端到端测试
   - 性能测试
   - 兼容性测试

**验收标准**：
- ✅ 所有现有测试通过
- ✅ 新配置系统与旧系统行为一致
- ✅ 性能不低于原有实现

### 延迟实现 ⏸️

以下功能在初期版本不实现，等待实际需求：

- ⏸️ **在线配置更新**：等到有用户需求再实现
- ⏸️ **复杂缓存机制**：等出现性能问题再优化
- ⏸️ **配置版本控制**：简化为文件级别的版本号

## 🧪 测试策略

### 测试覆盖

1. **Schema 测试**
   ```typescript
   describe('ModelConfig Schema', () => {
     it('validates correct config', () => {
       expect(() => ModelConfigSchema.parse(validConfig)).not.toThrow()
     })

     it('rejects invalid config', () => {
       expect(() => ModelConfigSchema.parse(invalidConfig)).toThrow()
     })
   })
   ```

2. **服务测试**
   ```typescript
   describe('CatalogService', () => {
     it('returns model with overrides applied', () => {
       const model = catalog.getModel('claude-3-5-sonnet', 'openrouter')
       expect(model?.pricing).toEqual(expectedPricing)
     })

     it('checks capabilities correctly', () => {
       expect(catalog.hasCapability('gpt-4', 'FUNCTION_CALL')).toBe(true)
     })
   })
   ```

3. **兼容性测试**
   ```typescript
   describe('Backward Compatibility', () => {
     it('produces same results as legacy', () => {
       expect(isFunctionCallingModel(testModel)).toBe(legacyResult)
     })
   })
   ```

## 📖 使用指南

### 基本用法

```typescript
import { catalog } from '@cherrystudio/catalog'

// 检查模型能力
const canCallFunctions = catalog.hasCapability('gpt-4', 'FUNCTION_CALL')
const canReason = catalog.hasCapability('o1-preview', 'REASONING')

// 获取模型配置
const modelConfig = catalog.getModel('claude-3-5-sonnet', 'openrouter')

// 查找模型
const visionModels = catalog.findModels({
  capabilities: ['IMAGE_RECOGNITION'],
  providers: ['anthropic', 'openai']
})

// 检查供应商能力
const hasMapping = catalog.hasProviderCapability('openrouter', 'MODEL_MAPPING')
```

### 供应商查询

```typescript
// 查找具有特定能力的供应商
const providersWithFallback = catalog.findProviders({
  capabilities: ['FALLBACK_ROUTING', 'AUTO_RETRY']
})

// 查找统一定价的供应商
const unifiedPricingProviders = catalog.findProviders({
  pricingModel: 'UNIFIED'
})
```

## 📝 维护指南

### 添加新模型

1. 编辑对应的模型配置文件
2. 添加模型信息
3. 运行验证：`yarn catalog:validate`
4. 提交 PR

### 添加新供应商

1. 编辑 `providers.json`
2. 添加供应商配置
3. 如需覆盖，添加到 `overrides.json`
4. 验证并提交

## 🔧 开发工具

### 命令行

```json
{
  "scripts": {
    "catalog:validate": "tsx scripts/validate.ts",
    "catalog:migrate": "tsx scripts/migrate.ts",
    "catalog:test": "vitest run",
    "catalog:build": "tsdown"
  }
}
```

## 📚 迁移对照表

| 旧函数 | 新 API |
|--------|--------|
| `isFunctionCallingModel(model)` | `catalog.hasCapability(model.id, 'FUNCTION_CALL', model.provider)` |
| `isReasoningModel(model)` | `catalog.hasCapability(model.id, 'REASONING', model.provider)` |
| `isVisionModel(model)` | `catalog.hasCapability(model.id, 'IMAGE_RECOGNITION', model.provider)` |
| `getThinkModelType(model)` | `catalog.getReasoningConfig(model.id, model.provider)` |

## 📊 预期成果

### 时间估算
- Phase 1: 2-3 天
- Phase 2: 1-2 天
- Phase 3: 2-3 天
- **总计**: 5-8 天

### 性能目标
- 配置加载时间: < 100ms
- 模型查询时间: < 1ms
- 内存使用: < 50MB

---

这个简化方案专注于核心功能，避免过度设计，遵循"保持简洁"的原则，为未来扩展留有空间。
