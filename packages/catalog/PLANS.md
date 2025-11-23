# 模型和供应商参数化配置实现方案

## 📋 项目概述

本文档详细描述了在 `@packages/catalog/` 下实现模型和供应商参数化配置的完整方案，目标是将现有的硬编码逻辑重构为元数据驱动的适配器架构。

## 🎯 目标

### 主要目标
- 将硬编码的模型识别逻辑转换为 JSON 配置驱动
- 解决"同一模型在不同供应商下有差异"的问题
- 支持通过 JSON 文件在线更新新模型，无需发布代码
- 提供类型安全的配置系统（使用 JSON Schema + Zod）

### 痛点解决
- **当前问题**：`src/renderer/src/config/models/` 下复杂的正则表达式和硬编码逻辑
- **期望状态**：配置以 JSON 形式存在，代码中预定义 JSON Schema 解析
- **用户体验**：新模型发布时用户可自动获取更新配置

## 🏗️ 架构设计

### 三层分离的元数据架构

```
1. Base Model Catalog (models/*.json)
   ├─ 模型基础信息（ID、能力、模态、限制、价格）
   └─ 官方/标准配置

2. Provider Catalog (providers/*.json)
   ├─ 供应商特性（端点支持、内置工具、MCP支持）
   └─ API 兼容性配置

3. Provider Model Overrides (overrides/*.json)
   ├─ 供应商对特定模型的覆盖
   └─ 解决"同一模型不同供应商差异"问题
```

### 文件结构

```
packages/catalog/
├── schemas/                     # Schema 定义
│   ├── index.ts                # 统一导出
│   ├── model.schema.ts         # 模型配置 Schema + Zod
│   ├── provider.schema.ts      # 供应商配置 Schema + Zod
│   ├── override.schema.ts      # 覆盖配置 Schema + Zod
│   └── common.types.ts         # 通用类型定义
├── data/                       # 配置数据
│   ├── models/                 # 模型配置（按供应商分组）
│   │   ├── anthropic.json      # Anthropic 模型
│   │   ├── openai.json         # OpenAI 模型
│   │   ├── google.json         # Google 模型
│   │   ├── deepseek.json       # DeepSeek 模型
│   │   ├── qwen.json           # 通义千问模型
│   │   ├── doubao.json         # 豆包模型
│   │   ├── mistral.json        # Mistral 模型
│   │   ├── meta.json           # Meta 模型
│   │   └── community.json      # 社区模型
│   ├── providers/              # 供应商配置
│   │   ├── direct-providers.json   # 直接供应商 (anthropic, openai, google)
│   │   ├── cloud-platforms.json    # 云平台 (aws, gcp, azure)
│   │   ├── unified-gateways.json   # 统一网关 (openrouter, litellm)
│   │   ├── api-proxies.json        # API 代理 (new-api, one-api)
│   │   └── self-hosted.json        # 自托管 (ollama, lmstudio)
│   └── overrides/              # 供应商模型覆盖
│       ├── openrouter.json     # OpenRouter 特殊配置
│       ├── aws-bedrock.json    # AWS Bedrock 覆盖
│       ├── azure-openai.json   # Azure OpenAI 覆盖
│       └── custom.json         # 用户自定义覆盖
├── src/                        # 核心实现
│   ├── index.ts                # 主导出文件
│   ├── catalog/                # 目录服务
│   │   ├── ModelCatalog.ts     # 模型目录服务
│   │   ├── ProviderCatalog.ts  # 供应商目录服务
│   │   └── CatalogService.ts   # 统一目录服务
│   ├── loader/                 # 配置加载
│   │   ├── ConfigLoader.ts     # 配置文件加载器
│   │   ├── CacheManager.ts     # 缓存管理
│   │   └── UpdateManager.ts    # 在线更新管理
│   ├── validator/              # 验证器
│   │   ├── SchemaValidator.ts  # Schema 验证
│   │   └── ZodValidator.ts     # Zod 验证器
│   ├── matcher/                # 匹配逻辑
│   │   ├── ModelMatcher.ts     # 模型匹配
│   │   └── PatternMatcher.ts   # 模式匹配
│   ├── resolver/               # 配置解析
│   │   ├── ConfigResolver.ts   # 配置解析器
│   │   └── OverrideResolver.ts # 覆盖解析器
│   └── utils/                  # 工具函数
│       ├── migration.ts        # 从旧代码迁移
│       ├── compatibility.ts    # 兼容性检查
│       ├── helpers.ts          # 辅助函数
│       └── behaviors.ts        # 行为特征分析工具
├── tests/                      # 测试文件
│   ├── schemas/                # Schema 测试
│   ├── catalog/                # 目录服务测试
│   ├── integration/            # 集成测试
│   └── fixtures/               # 测试数据
├── docs/                       # 文档
│   ├── schema-guide.md         # Schema 使用指南
│   ├── migration-guide.md      # 迁移指南
│   └── contribution-guide.md   # 贡献指南
└── utils/                      # 构建工具
    ├── schema-generator.ts     # Schema 生成工具
    ├── validator-cli.ts        # 命令行验证工具
    └── migration-cli.ts        # 迁移命令行工具
```

## 📝 详细 Schema 定义

### 1. 模型配置 Schema

```typescript
// packages/catalog/schemas/model.schema.ts

import { EndpointTypeSchema } from './provider.schema'

// 模态类型 - 支持的输入输出模态
export const ModalitySchema = z.enum(['TEXT', 'VISION', 'AUDIO', 'VIDEO', 'VECTOR'])

// 能力类型 - 模型支持的具体能力
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

// 参数支持配置 - 替代硬编码的参数检查
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

// 模型定价配置
export const ModelPricingSchema = z.object({
  input: z.object({
    perMillionTokens: z.number(),
    currency: z.string().default('USD')
  }),
  output: z.object({
    perMillionTokens: z.number(),
    currency: z.string().default('USD')
  }),
  // 图像定价（可选）
  perImage: z.object({
    price: z.number(),
    currency: z.string().default('USD'),
    unit: z.enum(['image', 'pixel']).optional()
  }).optional(),
  // 音/视频定价（可选）
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

  // 端点类型（复用 Provider Schema 中的 EndpointTypeSchema）
  endpointTypes: z.array(EndpointTypeSchema).optional(),

  // 元数据
  releaseDate: z.string().optional(),
  deprecationDate: z.string().optional(),
  replacedBy: z.string().optional(),

  // 版本控制
  version: z.string().optional(),
  compatibility: z.object({
    minVersion: z.string().optional(),
    maxVersion: z.string().optional()
  }).optional()
})
```

### 2. 供应商配置 Schema

```typescript
// packages/catalog/schemas/provider.schema.ts

// 端点类型
export const EndpointTypeSchema = z.enum([
  'CHAT_COMPLETIONS',       // /chat/completions
  'COMPLETIONS',            // /completions
  'EMBEDDINGS',             // /embeddings
  'IMAGE_GENERATION',       // /images/generations
  'IMAGE_EDIT',             // /images/edits
  'AUDIO_SPEECH',           // /audio/speech (TTS)
  'AUDIO_TRANSCRIPTIONS',   // /audio/transcriptions (STT)
  'MESSAGES',               // /messages
  'RESPONSES',              // /responses
  'GENERATE_CONTENT',  // :generateContent
  'STREAM_GENERATE_CONTENT', // :streamGenerateContent
  'RERANK',                 // /rerank
  'MODERATIONS',            // /moderations
])

// 认证方式
export const AuthenticationSchema = z.enum([
  'API_KEY',           // 标准 API Key 认证
  'OAUTH',             // OAuth 2.0 认证
  'CLOUD_CREDENTIALS', // 云服务凭证 (AWS, GCP, Azure)
])

// 定价模型 - 实际影响 UI 和行为
export const PricingModelSchema = z.enum([
  'UNIFIED',       // 统一定价 (如 OpenRouter)
  'PER_MODEL',     // 按模型独立定价 (如 OpenAI 官方)
  'TRANSPARENT',   // 透明定价 (如 New-API)
  'USAGE_BASED',   // 基于使用量的动态定价
  'SUBSCRIPTION'   // 订阅制定价
])

// 模型路由策略 - 影响性能和可靠性
export const ModelRoutingSchema = z.enum([
  'INTELLIGENT',      // 智能路由，自动选择最优实例
  'DIRECT',          // 直接路由到指定模型
  'LOAD_BALANCED',   // 负载均衡到多个实例
  'GEO_ROUTED',      // 地理位置路由
  'COST_OPTIMIZED'   // 成本优化路由
])

// 服务端 MCP 支持
export const McpSupportSchema = z.object({
  supported: z.boolean().default(false),
  configuration: z.object({
    supportsUrlPassThrough: z.boolean().default(false),
    supportedServers: z.array(z.string()).optional(),
    maxConcurrentServers: z.number().optional()
  }).optional()
})

// API 兼容性配置
export const ApiCompatibilitySchema = z.object({
  supportsArrayContent: z.boolean().default(true),
  supportsStreamOptions: z.boolean().default(true),
  supportsDeveloperRole: z.boolean().default(false),
  supportsServiceTier: z.boolean().default(false),
  supportsThinkingControl: z.boolean().default(false),
  supportsApiVersion: z.boolean().default(false),
  supportsParallelTools: z.boolean().default(false),
  supportsMultimodal: z.boolean().default(false),
  maxFileUploadSize: z.number().optional(), // bytes
  supportedFileTypes: z.array(z.string()).optional()
})

// 行为特性配置 - 替代分类，描述实际行为
export const ProviderBehaviorsSchema = z.object({
  // 模型管理
  supportsCustomModels: z.boolean().default(false),        // 是否支持用户自定义模型
  providesModelMapping: z.boolean().default(false),       // 是否提供模型名称映射
  supportsModelVersioning: z.boolean().default(false),    // 是否支持模型版���控制

  // 可靠性和容错
  providesFallbackRouting: z.boolean().default(false),     // 是否提供降级路由
  hasAutoRetry: z.boolean().default(false),                // 是否有自动重试机制
  supportsHealthCheck: z.boolean().default(false),         // 是否支持健康检查

  // 监控和指标
  hasRealTimeMetrics: z.boolean().default(false),          // 是否有实时指标
  providesUsageAnalytics: z.boolean().default(false),      // 是否提供使用分析
  supportsWebhookEvents: z.boolean().default(false),       // 是否支持 Webhook 事件

  // 配置和管理
  requiresApiKeyValidation: z.boolean().default(true),     // 是否需要 API Key 验证
  supportsRateLimiting: z.boolean().default(false),        // 是否支持速率限制
  providesUsageLimits: z.boolean().default(false),         // 是否提供使用限制配置

  // 高级功能
  supportsStreaming: z.boolean().default(true),           // 是否支持流式响应
  supportsBatchProcessing: z.boolean().default(false),     // 是否支持批量处理
  supportsModelFineTuning: z.boolean().default(false)      // 是否提供模型微调
})

// 供应商配置 Schema
export const ProviderConfigSchema = z.object({
  // 基础信息
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),

  // 行为相关配置
  authentication: AuthenticationSchema,
  pricingModel: PricingModelSchema,
  modelRouting: ModelRoutingSchema,
  behaviors: ProviderBehaviorsSchema,

  // 功能支持
  supportedEndpoints: z.array(EndpointTypeSchema),
  mcpSupport: McpSupportSchema.optional(),
  apiCompatibility: ApiCompatibilitySchema.optional(),

  // 默认配置
  defaultApiHost: z.string().optional(),
  defaultRateLimit: z.number().optional(), // requests per minute

  // 模型匹配辅助
  modelIdPatterns: z.array(z.string()).optional(),
  aliasModelIds: z.record(z.string()).optional(), // 模型别名映射

  // 特殊配置
  specialConfig: z.record(z.string(), z.unknown()).optional(),

  // 元数据和链接
  documentation: z.string().url().optional(),
  statusPage: z.string().url().optional(),
  pricingPage: z.string().url().optional(),
  supportEmail: z.string().email().optional(),

  // 状态管理
  deprecated: z.boolean().default(false),
  deprecationDate: z.string().optional(),
  maintenanceMode: z.boolean().default(false),

  // 版本和兼容性
  minAppVersion: z.string().optional(), // 最低支持的应用版本
  maxAppVersion: z.string().optional(), // 最高支持的应用版本
  configVersion: z.string().default('1.0.0') // 配置文件版本
})
```

### 3. 覆盖配置 Schema

```typescript
// packages/catalog/schemas/override.schema.ts

import { EndpointTypeSchema } from './provider.schema'

export const ProviderModelOverrideSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),

  // 能力覆盖
  capabilities: z.object({
    add: z.array(ModelCapabilityTypeSchema).optional(),
    remove: z.array(ModelCapabilityTypeSchema).optional(),
    force: z.array(ModelCapabilityTypeSchema).optional() // 强制设置，忽略基础配置
  }).optional(),

  // 限制覆盖
  limits: z.object({
    contextWindow: z.number().optional(),
    maxOutputTokens: z.number().optional(),
    maxInputTokens: z.number().optional()
  }).optional(),

  // 价格覆盖
  pricing: ModelPricingSchema.optional(),

  // 推理配置覆盖
  reasoning: ReasoningConfigSchema.optional(),

  // 参数支持覆盖
  parameters: ParameterSupportSchema.optional(),

  // 端点类型覆盖
  endpointTypes: z.array(EndpointTypeSchema).optional(),

  // 禁用模型
  disabled: z.boolean().optional(),

  // 替换为其他模型
  replaceWith: z.string().optional(),

  // 覆盖原因和元数据
  reason: z.string().optional(),
  lastUpdated: z.string().optional(),
  updatedBy: z.string().optional()
})
```

## 🔧 核心 API 设计

### 主要接口

```typescript
// packages/catalog/src/index.ts

export interface ModelCapabilities {
  [key: string]: {
    supported: boolean
    config?: any
  }
}

export interface ModelFilters {
  capabilities?: ModelCapabilityType[]
  inputModalities?: Modality[]
  outputModalities?: Modality[]
  providers?: string[]
  minContextWindow?: number
  maxOutputTokens?: number
}

export class ModelCatalog {
  /**
   * 获取模型完整配置（应用供应商覆盖）
   */
  getModelConfig(modelId: string, providerId?: string): ModelConfig | null

  /**
   * 检查模型是否支持某个能力
   */
  hasCapability(
    modelId: string,
    capability: ModelCapabilityType,
    providerId?: string
  ): boolean

  /**
   * 获取模型的所有能力
   */
  getCapabilities(modelId: string, providerId?: string): ModelCapabilities

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
   * 批量匹配模型（用于列表渲染）
   */
  matchModels(pattern: string, filters?: ModelFilters): ModelConfig[]

  /**
   * 获取模型定价
   */
  getPricing(modelId: string, providerId?: string): ModelPricingSchema | null

  /**
   * 检查模型是否支持特定端点类型
   */
  supportsEndpoint(modelId: string, endpointType: string, providerId?: string): boolean
}

export interface ProviderFilter {
  // 行为特性筛选
  behaviors?: Partial<ProviderBehaviorsSchema>

  // 核心配置筛选
  authentication?: AuthenticationSchema
  pricingModel?: PricingModelSchema
  modelRouting?: ModelRoutingSchema

  // 功能支持筛选
  supportsEndpoint?: EndpointType

  // 状态筛选
  notDeprecated?: boolean
  notInMaintenance?: boolean

  // 支持的最小应用版本
  minAppVersion?: string
}

export class ProviderCatalog {
  /**
   * 获取供应商配置
   */
  getProviderConfig(providerId: string): ProviderConfig | null

  /**
   * 检查供应商是否支持某个端点
   */
  supportsEndpoint(providerId: string, endpoint: EndpointType): boolean

  /**
   * 获取 API 兼容性配置
   */
  getApiCompatibility(providerId: string): ApiCompatibility

  /**
   * 获取供应商的行为特性
   */
  getProviderBehaviors(providerId: string): ProviderBehaviorsSchema | null

  /**
   * 检查供应商是否具有特定行为特性
   */
  hasBehavior(providerId: string, behavior: keyof ProviderBehaviorsSchema): boolean

  /**
   * 根据行为特性查找供应商（替代分类查询）
   */
  findProviders(filter: ProviderFilter): ProviderConfig[]

  /**
   * 获取供应商的所有模型 ID 模式
   */
  getModelIdPatterns(providerId: string): string[]

  /**
   * 检查供应商是否支持服务端 MCP
   */
  supportsServerSideMcp(providerId: string): McpSupport

  /**
   * 获取按定价模型分组的供应商
   */
  getProvidersByPricingModel(pricingModel: PricingModelSchema): ProviderConfig[]

  /**
   * 获取按认证方式分组的供应商
   */
  getProvidersByAuthentication(authType: AuthenticationSchema): ProviderConfig[]

  /**
   * 获取支持特定端点的供应商
   */
  getProvidersByEndpoint(endpoint: EndpointType): ProviderConfig[]

  /**
   * 获取具有特定行为组合的供应商
   */
  getProvidersWithBehaviors(behaviors: Partial<ProviderBehaviorsSchema>): ProviderConfig[]
}

export class CatalogService {
  modelCatalog: ModelCatalog
  providerCatalog: ProviderCatalog

  /**
   * 根据现有 Model 类型获取增强配置
   */
  getEnhancedModel(model: Model): EnhancedModel | null

  /**
   * 批量处理模型列表
   */
  processModels(models: Model[]): EnhancedModel[]

  /**
   * 配置验证和修复
   */
  validateAndFixConfig(): ValidationResult

  /**
   * 获取配置更新
   */
  checkForUpdates(): Promise<UpdateInfo>

  /**
   * 应用配置更新
   */
  applyUpdate(update: ConfigUpdate): Promise<void>
}

// 统一导出
export const catalog = new CatalogService()

// 向后兼容的辅助函数
export const isFunctionCallingModel = (model: Model): boolean =>
  catalog.modelCatalog.hasCapability(model.id, 'FUNCTION_CALL', model.provider)

export const isReasoningModel = (model: Model): boolean =>
  catalog.modelCatalog.hasCapability(model.id, 'REASONING', model.provider)

export const isVisionModel = (model: Model): boolean =>
  catalog.modelCatalog.hasCapability(model.id, 'IMAGE_RECOGNITION', model.provider)
```

## 📊 JSON 配置示例

### 模型配置示例

```json
// packages/catalog/data/models/anthropic.json
{
  "version": "2025.11.24",
  "models": [
    {
      "id": "claude-3-5-sonnet-20241022",
      "name": "Claude 3.5 Sonnet (October 2024)",
      "ownedBy": "anthropic",
      "description": "Most capable Claude 3.5 model, with improved performance on coding, math, and reasoning tasks.",

      "capabilities": [
        "FUNCTION_CALL",
        "REASONING",
        "IMAGE_RECOGNITION",
        "STRUCTURED_OUTPUT",
        "FILE_INPUT"
      ],

      "inputModalities": ["TEXT", "VISION"],
      "outputModalities": ["TEXT"],

      "contextWindow": 200000,
      "maxOutputTokens": 8192,

      "pricing": {
        "input": { "perMillionTokens": 3.0, "currency": "USD" },
        "output": { "perMillionTokens": 15.0, "currency": "USD" }
      },

      "reasoning": {
        "supportedEfforts": ["low", "medium", "high"],
        "implementation": "ANTHROPIC_CLAUDE",
        "reasoningMode": "ON_DEMAND"
      },

      "parameters": {
        "temperature": {
          "supported": true,
          "min": 0.0,
          "max": 1.0,
          "default": 1.0
        },
        "topP": {
          "supported": false
        },
        "maxTokens": {
          "supported": true
        }
      },

      "endpointTypes": ["MESSAGES"],
      "releaseDate": "2024-10-22"
    },
    {
      "id": "claude-3-5-haiku-20241022",
      "name": "Claude 3.5 Haiku (October 2024)",
      "ownedBy": "anthropic",
      "description": "Fast, lightweight Claude 3.5 model for cost-conscious applications.",

      "capabilities": [
        "FUNCTION_CALL",
        "IMAGE_RECOGNITION",
        "STRUCTURED_OUTPUT",
        "FILE_INPUT"
      ],

      "inputModalities": ["TEXT", "VISION"],
      "outputModalities": ["TEXT"],

      "contextWindow": 200000,
      "maxOutputTokens": 8192,

      "pricing": {
        "input": { "perMillionTokens": 0.8, "currency": "USD" },
        "output": { "perMillionTokens": 4.0, "currency": "USD" }
      },

      "parameters": {
        "temperature": {
          "supported": true,
          "min": 0.0,
          "max": 1.0,
          "default": 1.0
        }
      },

      "endpointTypes": ["MESSAGES"]
    }
  ]
}
```

### 供应商配置示例

```json
// packages/catalog/data/providers/direct-providers.json
{
  "version": "2025.11.24",
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "description": "Direct access to Anthropic Claude models",
      "authentication": "API_KEY",
      "pricingModel": "PER_MODEL",
      "modelRouting": "DIRECT",

      "behaviors": {
        "supportsCustomModels": false,
        "providesModelMapping": false,
        "providesFallbackRouting": false,
        "hasRealTimeMetrics": true,
        "supportsRateLimiting": true,
        "supportsStreaming": true,
        "supportsModelFineTuning": false
      },

      "supportedEndpoints": [
        "MESSAGES"
      ],

      "mcpSupport": {
        "supported": false
      },

      "apiCompatibility": {
        "supportsArrayContent": false,
        "supportsStreamOptions": true,
        "supportsDeveloperRole": false,
        "supportsServiceTier": false,
        "supportsThinkingControl": false,
        "supportsApiVersion": false,
        "supportsParallelTools": true,
        "supportsMultimodal": true,
        "maxFileUploadSize": 52428800,
        "supportedFileTypes": ["pdf", "txt", "csv", "docx", "html", "md", "jpeg", "png", "gif", "webp"]
      },

      "defaultApiHost": "https://api.anthropic.com",
      "defaultRateLimit": 5000,

      "modelIdPatterns": [
        "claude-.*",
        "claude.*"
      ],

      "documentation": "https://docs.anthropic.com/claude/reference",
      "statusPage": "https://status.anthropic.com/",
      "supportEmail": "support@anthropic.com"
    },
    {
      "id": "openai",
      "name": "OpenAI",
      "description": "Official OpenAI API access",
      "authentication": "API_KEY",
      "pricingModel": "PER_MODEL",
      "modelRouting": "DIRECT",

      "behaviors": {
        "supportsCustomModels": true,
        "providesModelMapping": false,
        "providesFallbackRouting": false,
        "hasRealTimeMetrics": true,
        "supportsRateLimiting": true,
        "supportsStreaming": true,
        "supportsModelFineTuning": true,
        "supportsBatchProcessing": true,
        "providesUsageAnalytics": true
      },

      "supportedEndpoints": [
        "CHAT_COMPLETIONS",
        "COMPLETIONS",
        "EMBEDDINGS",
        "IMAGE_GENERATION",
        "AUDIO_SPEECH",
        "AUDIO_TRANSCRIPTIONS",
        "MODERATIONS"
      ],

      "mcpSupport": {
        "supported": false
      },

      "apiCompatibility": {
        "supportsArrayContent": true,
        "supportsStreamOptions": true,
        "supportsDeveloperRole": true,
        "supportsServiceTier": true,
        "supportsThinkingControl": true,
        "supportsApiVersion": false,
        "supportsParallelTools": true,
        "supportsMultimodal": true
      },

      "defaultApiHost": "https://api.openai.com",
      "defaultRateLimit": 10000,

      "documentation": "https://platform.openai.com/docs/api-reference",
      "statusPage": "https://status.openai.com/",
      "pricingPage": "https://openai.com/pricing"
    }
  ]
}
```

### 统一网关示例

```json
// packages/catalog/data/providers/unified-gateways.json
{
  "version": "2025.11.24",
  "providers": [
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "description": "Unified access to multiple AI models with intelligent routing",

      "authentication": "API_KEY",
      "pricingModel": "UNIFIED",
      "modelRouting": "INTELLIGENT",

      "behaviors": {
        "supportsCustomModels": true,
        "providesModelMapping": true,
        "providesFallbackRouting": true,
        "hasAutoRetry": true,
        "hasRealTimeMetrics": true,
        "providesUsageAnalytics": true,
        "supportsWebhookEvents": true,
        "supportsRateLimiting": true,
        "supportsStreaming": true
      },

      "supportedEndpoints": [
        "CHAT_COMPLETIONS",
        "EMBEDDINGS"
      ],

      "mcpSupport": {
        "supported": false
      },

      "apiCompatibility": {
        "supportsArrayContent": true,
        "supportsStreamOptions": true,
        "supportsDeveloperRole": true,
        "supportsServiceTier": true,
        "supportsThinkingControl": false,
        "supportsApiVersion": false,
        "supportsParallelTools": true,
        "supportsMultimodal": true
      },

      "defaultApiHost": "https://openrouter.ai/api/v1",
      "defaultRateLimit": 300,

      "modelIdPatterns": [
        ".*",
        "anthropic/.*",
        "openai/.*",
        "google/.*",
        "meta/.*"
      ],

      "aliasModelIds": {
        "claude-3-5-sonnet": "anthropic/claude-3.5-sonnet",
        "gpt-4": "openai/gpt-4-turbo"
      },

      "documentation": "https://openrouter.ai/docs",
      "statusPage": "https://status.openrouter.ai/",
      "pricingPage": "https://openrouter.ai/pricing"
    }
  ]
}
```

### 覆盖配置示例

```json
// packages/catalog/data/overrides/openrouter.json
{
  "version": "2025.11.24",
  "overrides": [
    {
      "providerId": "openrouter",
      "modelId": "anthropic/claude-3.5-sonnet",

      "overrides": {
        "pricing": {
          "input": { "perMillionTokens": 4.5, "currency": "USD" },
          "output": { "perMillionTokens": 22.5, "currency": "USD" }
        },

        "capabilities": {
          "add": ["WEB_SEARCH"],
          "remove": []
        }
      },

      "reason": "OpenRouter applies markup and adds web search capability",
      "lastUpdated": "2025-11-24",
      "updatedBy": "catalog-maintainer"
    },
    {
      "providerId": "openrouter",
      "modelId": "openai/gpt-4-turbo",

      "overrides": {
        "parameters": {
          "temperature": {
            "supported": true,
            "min": 0.0,
            "max": 2.0
          }
        }
      },

      "reason": "OpenRouter extends temperature range beyond OpenAI limits",
      "lastUpdated": "2025-11-24"
    }
  ]
}
```

## 🔄 迁移策略

### Phase 1: 基础架构实现 (1-2 days)

**目标**：建立核心架构和类型系统

**任务**：
1. **Schema 定义**
   ```bash
   # 创建基础文件结构
   mkdir -p packages/catalog/{schemas,data,src,catalog,loader,validator,matcher,resolver,utils}

   # 实现 Schema + Zod 验证
   touch packages/catalog/schemas/{model,provider,override}.schema.ts
   ```

2. **配置加载器**
   ```typescript
   // packages/catalog/src/loader/ConfigLoader.ts
   export class ConfigLoader {
     async loadModels(): Promise<ModelConfig[]>
     async loadProviders(): Promise<ProviderConfig[]>
     async loadOverrides(): Promise<ProviderModelOverride[]>
   }
   ```

3. **验证器**
   ```typescript
   // packages/catalog/src/validator/SchemaValidator.ts
   export class SchemaValidator {
     validateModel(config: any): ModelConfig
     validateProvider(config: any): ProviderConfig
     validateOverride(config: any): ProviderModelOverride
   }
   ```

**验收标准**：
- [x] 所有 Schema 定义完成，通过 Zod 验证
- [x] 配置加载器可以读取 JSON 文件并返回类型安全的数据
- [x] 单元测试覆盖率达到 90%

### Phase 2: 数据迁移 (2-3 days)

**目标**：从现有硬编码逻辑生成 JSON 配置

**任务**：
1. **迁移工具开发**
   ```typescript
   // packages/catalog/utils/migration.ts
   export class MigrationTool {
     generateModelConfigs(): Promise<ModelConfig[]>
     generateProviderConfigs(): Promise<ProviderConfig[]>
     validateMigration(): Promise<MigrationReport>
   }
   ```

2. **自动迁移脚本**
   ```bash
   # 运行迁移脚本
   yarn catalog:migrate

   # 生成迁移报告
   yarn catalog:migration-report
   ```

3. **手动审核和调整**
   - 审核自动生成的配置文件
   - 调整不准确的模型能力定义
   - 补充缺失的价格和限制信息

**验收标准**：
- [ ] 90% 的现有模型配置能够正确迁移
- [ ] 迁移后的配置与原逻辑行为一致
- [ ] 迁移报告显示成功率和差异

### Phase 3: 核心服务实现 (1-2 days)

**目标**：实现配置查询和解析 API

**任务**：
1. **目录服务**
   ```typescript
   // packages/catalog/src/catalog/ModelCatalog.ts
   export class ModelCatalog {
     getModelConfig(modelId: string, providerId?: string): ModelConfig | null
     hasCapability(modelId: string, capability: ModelCapabilityType): boolean
     // ... 其他方法
   }
   ```

2. **配置解析器**
   ```typescript
   // packages/catalog/src/resolver/ConfigResolver.ts
   export class ConfigResolver {
     resolveModelOverrides(model: ModelConfig, providerId: string): ModelConfig
     applyOverrides(base: ModelConfig, overrides: ProviderModelOverride[]): ModelConfig
   }
   ```

3. **匹配器**
   ```typescript
   // packages/catalog/src/matcher/ModelMatcher.ts
   export class ModelMatcher {
     matchModels(pattern: string, filters?: ModelFilters): ModelConfig[]
     findCompatibleModels(capabilities: ModelCapabilityType[]): ModelConfig[]
   }
   ```

**验收标准**：
- [ ] 所有 API 方法正常工作
- [ ] 配置覆盖逻辑正确应用
- [ ] 模式匹配和过滤功能完善

### Phase 4: 集成重构 (2-3 days)

**目标**：替换现有硬编码逻辑

**任务**：
1. **向后兼容层**
   ```typescript
   // packages/catalog/src/compatibility/BackwardCompat.ts
   // 保持现有函数签名，内部使用新配置系统
   export const isFunctionCallingModel = (model: Model): boolean => {
     return catalog.modelCatalog.hasCapability(model.id, 'FUNCTION_CALL', model.provider)
   }
   ```

2. **逐步替换**
   - 替换 `src/renderer/src/config/models/` 中的函数
   - 更新调用点使用新的配置 API
   - 保持测试通过

3. **性能优化**
   - 实现配置缓存
   - 懒加载大型配置文件
   - 优化查询性能

**验收标准**：
- [ ] 所有现有测试通过
- [ ] 新配置系统与旧系统行为一致
- [ ] 性能不低于原有实现

### Phase 5: 在线更新机制 (1-2 days)

**目标**：支持配置的在线更新

**任务**：
1. **更新管理器**
   ```typescript
   // packages/catalog/src/loader/UpdateManager.ts
   export class UpdateManager {
     checkForUpdates(): Promise<UpdateInfo>
     downloadLatestCatalog(): Promise<void>
     applyPatch(patch: ConfigPatch): Promise<void>
     rollback(): Promise<void>
   }
   ```

2. **版本控制**
   ```json
   {
     "version": "2025.11.24",
     "models": { ... },
     "providers": { ... },
     "overrides": { ... }
   }
   ```

3. **增量更新**
   - 支持 JSON Patch 格式
   - 验证更新完整性
   - 支持回滚机制

**验收标准**：
- [ ] 可以检查和下载配置更新
- [ ] 增量更新正常工作
- [ ] 更新失败时可以回滚

## 🧪 测试策略

### 测试覆盖范围

1. **Schema 测试**
   ```typescript
   // packages/catalog/tests/schemas/model.schema.test.ts
   describe('ModelConfig Schema', () => {
     it('should validate correct model config', () => {
       const validConfig = { /* valid config */ }
       expect(() => ModelConfigSchema.parse(validConfig)).not.toThrow()
     })

     it('should reject invalid model config', () => {
       const invalidConfig = { /* invalid config */ }
       expect(() => ModelConfigSchema.parse(invalidConfig)).toThrow()
     })
   })
   ```

2. **目录服务测试**
   ```typescript
   // packages/catalog/tests/catalog/ModelCatalog.test.ts
   describe('ModelCatalog', () => {
     it('should return model config with overrides applied', () => {
       const config = modelCatalog.getModelConfig('claude-3-5-sonnet', 'openrouter')
       expect(config?.pricing).toEqual(expectedPricing)
     })

     it('should correctly check model capabilities', () => {
       expect(modelCatalog.hasCapability('gpt-4', 'FUNCTION_CALL')).toBe(true)
     })
   })
   ```

3. **集成测试**
   ```typescript
   // packages/catalog/tests/integration/config-loading.test.ts
   describe('Configuration Loading', () => {
     it('should load and validate all configuration files', async () => {
       const catalog = new CatalogService()
       await catalog.initialize()
       expect(catalog.isHealthy()).toBe(true)
     })
   })
   ```

4. **兼容性测试**
   ```typescript
   // packages/catalog/tests/compatibility/backward-compat.test.ts
   describe('Backward Compatibility', () => {
     it('should produce same results as legacy functions', () => {
       const legacyResult = isFunctionCallingModelLegacy(testModel)
       const newResult = isFunctionCallingModel(testModel)
       expect(newResult).toBe(legacyResult)
     })
   })
   ```

### 测试数据

```json
// packages/catalog/tests/fixtures/sample-configs.json
{
  "models": [
    {
      "id": "test-model",
      "capabilities": ["FUNCTION_CALL", "REASONING"],
      "contextWindow": 100000,
      "pricing": {
        "input": { "perMillionTokens": 1.0 },
        "output": { "perMillionTokens": 2.0 }
      }
    }
  ],
  "providers": [
    {
      "id": "test-provider",
      "name": "Test Provider",
      "supportedEndpoints": ["CHAT_COMPLETIONS"]
    }
  ],
  "overrides": [
    {
      "providerId": "test-provider",
      "modelId": "test-model",
      "overrides": {
        "capabilities": { "add": ["WEB_SEARCH"] }
      }
    }
  ]
}
```

## 📖 使用指南

### 基本用法

```typescript
import { catalog } from '@cherrystudio/catalog'

// 检查模型能力
const canCallFunctions = catalog.modelCatalog.hasCapability('gpt-4', 'FUNCTION_CALL')
const canReason = catalog.modelCatalog.hasCapability('o1-preview', 'REASONING')

// 获取模型配置
const modelConfig = catalog.modelCatalog.getModelConfig('claude-3-5-sonnet', 'openrouter')

// 批量匹配模型
const visionModels = catalog.modelCatalog.matchModels('', {
  capabilities: ['IMAGE_RECOGNITION'],
  providers: ['anthropic', 'openai']
})

// 获取供应商信息
const providerInfo = catalog.providerCatalog.getProviderConfig('openrouter')
```

### 高级用法

```typescript
// 获取推理配置
const reasoningConfig = catalog.modelCatalog.getReasoningConfig('o1-preview')
console.log(reasoningConfig?.supportedEfforts) // ['low', 'medium', 'high']

// 获取参数范围
const tempRange = catalog.modelCatalog.getParameterRange('gpt-4', 'temperature')
console.log(tempRange) // { min: 0, max: 2, default: 1 }

// 获取定价信息
const pricing = catalog.modelCatalog.getPricing('claude-3-5-sonnet', 'openrouter')

// 检查端点支持
const supportsChat = catalog.modelCatalog.supportsEndpoint('gpt-4', 'OPENAI')

// 基于行为的供应商查询（替代分类查询）
const providersWithFallbackRouting = catalog.providerCatalog.findProviders({
  behaviors: { providesFallbackRouting: true }
})
// 返回: [openrouter, litellm, ...]

const providersWithUnifiedPricing = catalog.providerCatalog.findProviders({
  pricingModel: 'UNIFIED'
})
// 返回: [openrouter, litellm, ...]

const providersSupportingCustomModels = catalog.providerCatalog.findProviders({
  behaviors: { supportsCustomModels: true }
})
// 返回: [openai, openrouter, ...]

// 复合行为查询
const reliableProviders = catalog.providerCatalog.findProviders({
  behaviors: {
    providesFallbackRouting: true,
    hasRealTimeMetrics: true,
    supportsRateLimiting: true
  },
  pricingModel: 'UNIFIED'
})
// 返回: 具备所有这些特性的供应商

// 获取供应商的详细行为信息
const openrouterBehaviors = catalog.providerCatalog.getProviderBehaviors('openrouter')
console.log(openrouterBehaviors.providesFallbackRouting) // true
console.log(openrouterBehaviors.hasAutoRetry) // true
```

### 配置扩展

```typescript
// 添加自定义覆盖
await catalog.applyOverride({
  providerId: 'custom-provider',
  modelId: 'custom-model',
  overrides: {
    capabilities: { add: ['CUSTOM_CAPABILITY'] },
    pricing: { input: { perMillionTokens: 5.0 } }
  }
})
```

## 📝 维护指南

### 添加新模型

1. **确定模型归属**
   ```bash
   # 如果是已知供应商的模型，编辑对应文件
   vim packages/catalog/data/models/openai.json

   # 如果是新供应商，创建新文件
   vim packages/catalog/data/models/newprovider.json
   ```

2. **添加模型配置**
   ```json
   {
     "id": "new-model-v1",
     "name": "New Model v1",
     "capabilities": ["FUNCTION_CALL", "REASONING"],
     "contextWindow": 200000,
     "maxOutputTokens": 4096,
     "pricing": {
       "input": { "perMillionTokens": 2.0 },
       "output": { "perMillionTokens": 6.0 }
     }
   }
   ```

3. **验证配置**
   ```bash
   yarn catalog:validate
   yarn catalog:test
   ```

4. **提交 PR**
   ```bash
   git add packages/catalog/data/models/
   git commit -m "feat: add New Model v1 to catalog"
   git push origin feat/add-new-model
   ```

### 添加新供应商

1. **创建供应商配置**
   ```bash
   vim packages/catalog/data/providers/newprovider.json
   ```

2. **添加供应商信息**
   ```json
    {
      "id": "newprovider",
      "name": "New Provider",
     "supportedEndpoints": ["CHAT_COMPLETIONS"],
     "apiCompatibility": {
       "supportsArrayContent": true,
       "supportsStreamOptions": true
     }
   }
   ```

3. **添加模型覆盖**（如果需要）
   ```bash
   vim packages/catalog/data/overrides/newprovider.json
   ```

### 配置更新流程

1. **本地开发**
   ```bash
   # 修改配置文件
   vim packages/catalog/data/models/anthropic.json

   # 验证更改
   yarn catalog:validate

   # 运行测试
   yarn catalog:test
   ```

2. **发布更新**
   ```bash
   # 更新版本号
   vim packages/catalog/data/models/anthropic.json # 更新 version 字段

   # 生成变更日志
   yarn catalog:changelog

   # 提交更改
   git add packages/catalog/
   git commit -m "feat: update Anthropic models to 2025.11.24"
   ```

3. **在线更新**（用户端）
   ```typescript
   // 检查更新
   const updateInfo = await catalog.checkForUpdates()

   if (updateInfo.hasUpdates) {
     // 应用更新
     await catalog.applyUpdate(updateInfo.update)
   }
   ```

## 🎨 UI 分组展示示例

### 基于行为的动态分组

```typescript
// UI 组件：供应商选择器
export const ProviderSelector = () => {
  const [providers] = useState(catalog.getAllProviders())

  // 基于行为特性的动态分组（替代固定分类）
  const providerGroups = useMemo(() => {
    return {
      '🏢 官方供应商': providers.filter(p =>
        p.pricingModel === 'PER_MODEL' &&
        p.modelRouting === 'DIRECT'
      ),

      '🌐 统一平台': providers.filter(p =>
        p.pricingModel === 'UNIFIED' &&
        p.behaviors.providesFallbackRouting
      ),

      '☁️ ���服务': providers.filter(p =>
        p.authentication === 'CLOUD_CREDENTIALS'
      ),

      '🔗 API 网关': providers.filter(p =>
        p.behaviors.providesModelMapping &&
        p.behaviors.supportsCustomModels
      ),

      '🏠 自托管': providers.filter(p =>
        p.pricingModel === 'TRANSPARENT'
      ),

      '⚡ 高可靠性': providers.filter(p =>
        p.behaviors.providesFallbackRouting &&
        p.behaviors.hasAutoRetry &&
        p.behaviors.hasRealTimeMetrics
      ),

      '💰 ��本优化': providers.filter(p =>
        p.modelRouting === 'COST_OPTIMIZED' ||
        p.pricingModel === 'UNIFIED'
      )
    }
  }, [providers])

  return (
    <div>
      {Object.entries(providerGroups).map(([groupName, groupProviders]) => (
        <ProviderGroup
          key={groupName}
          title={groupName}
          providers={groupProviders}
        />
      ))}
    </div>
  )
}
```

### 特性标签展示

```typescript
// 供应商卡片组件
export const ProviderCard = ({ provider }: { provider: ProviderConfig }) => {
  const features = []

  // 根据行为特性动态生成标签
  if (provider.behaviors.providesFallbackRouting) {
    features.push('🔄 自动降级')
  }
  if (provider.behaviors.hasRealTimeMetrics) {
    features.push('📊 实时监控')
  }
  if (provider.pricingModel === 'UNIFIED') {
    features.push('💵 统一定价')
  }
  if (provider.behaviors.supportsCustomModels) {
    features.push('🎛️ 自定义模型')
  }
  if (provider.behaviors.providesUsageAnalytics) {
    features.push('📈 使用分析')
  }

  return (
    <Card>
      <h3>{provider.name}</h3>
      <div className="features">
        {features.map(feature => (
          <Tag key={feature}>{feature}</Tag>
        ))}
      </div>
    </Card>
  )
}
```

### 智能推荐逻辑

```typescript
// 基于用户需求的供应商推荐
export const getRecommendedProviders = (requirements: {
  budgetConscious?: boolean
  needsReliability?: boolean
  requiresCustomModels?: boolean
  prefersUnifiedPricing?: boolean
}) => {
  const filters: ProviderFilter = {
    notDeprecated: true,
    notInMaintenance: true
  }

  if (requirements.budgetConscious) {
    filters.pricingModel = 'UNIFIED'
    filters.behaviors = {
      ...filters.behaviors,
      supportsRateLimiting: true
    }
  }

  if (requirements.needsReliability) {
    filters.behaviors = {
      ...filters.behaviors,
      providesFallbackRouting: true,
      hasAutoRetry: true,
      hasRealTimeMetrics: true
    }
  }

  if (requirements.requiresCustomModels) {
    filters.behaviors = {
      ...filters.behaviors,
      supportsCustomModels: true
    }
  }

  return catalog.providerCatalog.findProviders(filters)
}
```

## 🔧 开发工具

### 命令行工具

```json
// package.json scripts
{
  "scripts": {
    "catalog:validate": "node utils/validate-cli.js",
    "catalog:migrate": "node utils/migration-cli.js",
    "catalog:test": "vitest run packages/catalog/tests",
    "catalog:build": "tsdown",
    "catalog:dev": "tsdown --watch",
    "catalog:changelog": "node utils/changelog-cli.js",
    "catalog:analyze": "node utils/behavior-analyzer.js"
  }
}
```

### VS Code 扩展推荐

1. **JSON Schema 支持**
   ```json
   // .vscode/settings.json
   {
     "json.schemas": [
       {
         "fileMatch": ["packages/catalog/data/models/*.json"],
         "schema": "./packages/catalog/schemas/model.schema.json"
       },
       {
         "fileMatch": ["packages/catalog/data/providers/*.json"],
         "schema": "./packages/catalog/schemas/provider.schema.json"
       }
     ]
   }
   ```

2. **自动验证**
   ```json
   {
     "editor.codeActionsOnSave": {
       "source.fixAll.eslint": true
     }
   }
   ```

3. **行为分析工具**
   ```bash
   # 分析供应商行为分布
   yarn catalog:analyze --type behavior-distribution

   # 检查配置完整性
   yarn catalog:analyze --type completeness-check

   # 生成行为报告
   yarn catalog:analyze --type behavior-report --output markdown
   ```

## 📚 附录

### 迁移对照表

| 旧函数 | 新 API | 说明 |
|--------|--------|------|
| `isFunctionCallingModel(model)` | `catalog.modelCatalog.hasCapability(model.id, 'FUNCTION_CALL', model.provider)` | 检查函数调用能力 |
| `isReasoningModel(model)` | `catalog.modelCatalog.hasCapability(model.id, 'REASONING', model.provider)` | 检查推理能力 |
| `isVisionModel(model)` | `catalog.modelCatalog.hasCapability(model.id, 'IMAGE_RECOGNITION', model.provider)` | 检查视觉能力 |
| `isEmbeddingModel(model)` | `catalog.modelCatalog.hasCapability(model.id, 'EMBEDDING', model.provider)` | 检查嵌入能力 |
| `getThinkModelType(model)` | `catalog.modelCatalog.getReasoningConfig(model.id, model.provider)` | 获取推理配置 |

### 版本兼容性

| 配置版本 | 应用版本 | 说明 |
|----------|----------|------|
| 1.0.0 | v2.0.0 | 初始版本 |
| 1.1.0 | v2.1.0 | 添加视频模态支持 |
| 1.2.0 | v2.2.0 | 增强推理配置 |

### 性能指标

- **配置加载时间**：< 100ms
- **模型查询时间**：< 1ms
- **内存使用**：< 50MB
- **缓存命中率**：> 95%

---

这个方案提供了一个完整的、可扩展的、类型安全的模型和供应商配置系统，能够解决现有硬编码逻辑的问题，并为未来的扩展提供良好的基础。
