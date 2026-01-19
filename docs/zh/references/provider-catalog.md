# Model Provider Presets 架构文档

本文档介绍 Cherry Studio 的模型提供商预设系统架构、现状分析及目标设计。

> **重命名**: `packages/catalog/` → `packages/model-provider-presets/`

---

## 概述

Model Provider Presets 是一个元数据驱动的模型管理系统，旨在统一管理来自多个提供商的 AI 模型信息。

### 核心概念

| 概念 | 说明 |
| --- | --- |
| **Presets** | 只读模板，打包在应用中，支持 CDN 远程更新 |
| **models.json** | 规范模型定义（capabilities, pricing, context_window 等） |
| **provider-models.json** | 提供商-模型映射关系（原 overrides.json） |
| **用户数据** | 用户自定义的提供商/模型，写入 SQLite |

### 当前数据

| 数据文件 | 内容 | 数量 |
| --- | --- | --- |
| `data/models.json` | 规范模型定义 | 2,779 个模型 |
| `data/providers.json` | 提供商配置 | 51 个提供商 |
| `data/overrides.json` | 提供商-模型映射 | 3,407 条 |

---

## 架构现状

### 双系统并存

当前存在两套**完全独立**的模型能力检测系统：

```
┌─────────────────────────────────────┐
│   Presets (packages/catalog)        │
│   ─────────────────────────────────│
│   ✓ 2779 个模型（含能力标记）        │
│   ✓ 8 种推理实现类型                 │
│   ✓ 3407 条提供商映射               │
│   ✓ Zod Schema 验证                │
└─────────────────────────────────────┘
           ↓ (未连接)
           ↓ 数据未流通
┌─────────────────────────────────────┐
│   运行时检测 (config/models/)        │
│   ─────────────────────────────────│
│   ✗ 150+ 硬编码正则模式              │
│   ✗ 31 种硬编码推理类型              │
│   ✗ 30+ 检测函数                    │
│   ✗ 需要手动维护                    │
└─────────────────────────────────────┘
```

### Presets 核心限制

**当前架构不支持运行时更新**：

```
开发阶段              构建阶段         运行阶段
─────────            ─────────       ─────────
npm run sync:all     打包到 app      只读访问
     ↓                   ↓               ↓
models.json    →    app bundle   →   ConfigLoader
providers.json                        (fs.readFile)
overrides.json

[可更新]             [固化]          [不可更新]
```

**影响**: 新模型上线需要发布新版 Cherry Studio，用户必须更新应用。

---

## 模型能力类型

Presets 定义了 18 种模型能力类型：

| 能力类型 | 说明 |
| --- | --- |
| `FUNCTION_CALL` | 函数调用 |
| `REASONING` | 推理/思考 |
| `IMAGE_RECOGNITION` | 图像识别 |
| `IMAGE_GENERATION` | 图像生成 |
| `AUDIO_RECOGNITION` | 音频识别 |
| `AUDIO_GENERATION` | 音频生成 |
| `AUDIO_TRANSCRIPT` | 音频转写 |
| `VIDEO_RECOGNITION` | 视频识别 |
| `VIDEO_GENERATION` | 视频生成 |
| `STRUCTURED_OUTPUT` | 结构化输出 |
| `FILE_INPUT` | 文件输入 |
| `WEB_SEARCH` | 网页搜索 |
| `CODE_EXECUTION` | 代码执行 |
| `FILE_SEARCH` | 文件搜索 |
| `COMPUTER_USE` | 计算机操作 |
| `EMBEDDING` | 向量嵌入 |
| `RERANK` | 重排序 |

---

## 推理配置类型

### Presets Schema (8 种)

```typescript
Reasoning =
  | OpenAI Chat     // reasoning_effort: none|minimal|low|medium|high|xhigh
  | OpenAI Responses // reasoning + summary
  | Anthropic       // budgetTokens
  | Gemini          // thinking_config with budgets
  | OpenRouter      // effort + max_tokens
  | Qwen            // enable_thinking + budgetTokens
  | Doubao          // enabled|disabled|auto
  | DashScope       // enable_thinking + incremental_output
```

### 运行时配置 (31 种) - 需迁移

运行时在 `reasoning.ts` 中硬编码了 31 种模型类型，应迁移到 Presets。

---

## 已知缺陷

### Gap 1: 模型来源多样性

当前存在 **三种模型来源**，合并逻辑不明确：

| 来源 | 位置 | 存储 |
| --- | --- | --- |
| 内置模型 | `config/models/default.ts` | 硬编码 (1857 行) |
| 用户添加 | `AddModelPopup.tsx` | Redux → LocalStorage |
| 远程获取 | `fetchModels()` | 组件 state → Redux |

**注意**: 并非所有提供商都支持 `/v1/models` 接口，对于不支持的提供商依赖 Presets 内置列表。

### Gap 2: 能力检测使用硬编码模式

当前使用 150+ 正则模式和 30+ 检测函数：

```typescript
// 当前
isOpenAIReasoningModel(model) || isGeminiReasoningModel(model) || ...

// 目标
model.capabilities.includes('REASONING')
```

### Gap 3: Model.capabilities 字段未使用

`Model` 类型已有 `capabilities` 字段，但 Presets 数据从未流入。

### Gap 4: 提供商特定逻辑硬编码

特殊提供商处理分散在代码中，应移至 Presets 配置。

### Gap 5: 版本/日期逻辑硬编码

模型版本变更硬编码在函数名中：`isDoubaoSeedAfter251015(model)`

### Gap 6: 模型日期格式不统一

模型 ID 中的日期有 8 种不同格式，缺少统一的日期提取工具。

### Gap 7: 数据存储架构分裂

| 存储位置 | 数据类型 |
| --- | --- |
| LocalStorage | 用户设置 + LLM 配置 (卸载后丢失) |
| SQLite | 业务数据 (持久化) |
| App Bundle | Presets (只读) |

### Gap 8: 无运行时更新机制

Presets 数据在构建时固化，运行时无法更新。

---

## 目标架构

### 数据分层

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Layer Architecture                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Presets (只读模板)              SQLite (用户数据)            │
│  ─────────────────              ─────────────────           │
│  model-provider-presets/        user_provider               │
│  ├── models.json                user_model                  │
│  ├── providers.json             user_model_override         │
│  └── provider-models.json                                   │
│                                                              │
│  [CDN 全量更新]                 [用户自定义持久化]            │
│  [不写数据库]                   [写数据库]                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 文件重命名

```
packages/catalog/              →    packages/model-provider-presets/
├── data/models.json                ├── data/models.json (保持)
├── data/providers.json             ├── data/providers.json (保持)
└── data/overrides.json             └── data/provider-models.json (重命名)
```

### 用户数据 Schema

```sql
-- 用户自定义提供商
CREATE TABLE user_provider (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_host TEXT NOT NULL,
  api_key TEXT,           -- 加密存储
  settings JSON,
  created_at INTEGER,
  updated_at INTEGER
);

-- 用户添加的模型
CREATE TABLE user_model (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT,
  settings JSON,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(provider_id, model_id)
);

-- 用户对预设模型的覆盖
CREATE TABLE user_model_override (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  override_data JSON,
  created_at INTEGER,
  updated_at INTEGER,
  PRIMARY KEY(provider_id, model_id)
);
```

### 唯一 ModelId 设计

```typescript
// 格式
type UniqueModelId = `${providerId}::${modelId}`

// 示例
'anthropic::claude-sonnet-4-20250514'
'openrouter::anthropic/claude-sonnet-4'
'user::my-custom-model'

// API
const model = getModelByUniqueId('anthropic::claude-sonnet-4-20250514')
sendMessage({ modelId: 'anthropic::claude-sonnet-4-20250514' })
```

### 运行时解析流程

```typescript
async function resolveModelConfig(uniqueModelId: UniqueModelId): Promise<ModelConfig> {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)

  // 1. 检查用户覆盖
  const userOverride = await db.getUserModelOverride(providerId, modelId)

  // 2. 检查用户自定义模型
  const userModel = await db.getUserModel(providerId, modelId)
  if (userModel) {
    return merge(userModel, userOverride)
  }

  // 3. 从预设加载
  const presetModel = presetsLoader.getModel(providerId, modelId)
  if (presetModel) {
    return merge(presetModel, userOverride)
  }

  throw new Error(`Model not found: ${uniqueModelId}`)
}
```

### 更新策略

```
CDN (primary)                 GitHub (fallback)
─────────────                ─────────────────
presets-v2.5.0.json          releases/presets-v2.5.0.json
     ↓                              ↓
后台检查 version.json         网络异常时降级
     ↓
全量下载 + 校验
     ↓
替换本地 presets 文件
     ↓
CacheService.invalidate('presets')

[用户数据不受影响]
[user_model_override 保持不变]
```

---

## 用户添加模型流程

### 当前流程

用户有**三种方式**添加模型：

#### 方式 1: 手动输入 (AddModelPopup)

```
用户点击 "添加模型"
     ↓
┌────────────────────────────────────────┐
│ AddModelPopup                          │
│ ├─ Model ID (必填，支持逗号分隔批量添加) │
│ ├─ Model Name (可选，默认 = ID大写)     │
│ └─ Group (可选，自动从ID推断)           │
└────────────────────────────────────────┘
     ↓
验证 (重复检测)
     ↓
enrichModel()
├─ supported_text_delta = !isNotSupportTextDeltaModel()
├─ name = name || id.toUpperCase()
└─ group = group || getDefaultGroupName(id)
     ↓
dispatch(addModel({ providerId, model }))
     ↓
Redux: state.llm.providers[providerId].models.push(model)
     ↓
LocalStorage 持久化
```

#### 方式 2: 从提供商获取 (ManageModelsPopup)

```
用户点击 "管理模型"
     ↓
fetchModels(provider) → 调用 /v1/models API
     ↓
┌────────────────────────────────────────┐
│ ManageModelsPopup                      │
│ ├─ 合并: systemModels + fetchedModels │
│ ├─ 分组显示 (按 group 字段)            │
│ ├─ 筛选: All/Reasoning/Vision/...     │
│ └─ 搜索: 模糊匹配                      │
└────────────────────────────────────────┘
     ↓
用户勾选要添加的模型
     ↓
dispatch(addModel(...)) × N
```

#### 方式 3: NewApi 特殊处理

```
NewApiAddModelPopup
├─ Model ID
├─ Model Name
├─ Group
└─ Endpoint Type (必填: chat/embedding/image-generation/...)
```

### 模型数据结构

```typescript
type Model = {
  id: string                        // 模型标识符
  provider: string                  // 提供商ID
  name: string                      // 显示名称
  group: string                     // 分组 (如 "GPT-4", "Claude")

  // 可选字段
  owned_by?: string
  description?: string
  capabilities?: ModelCapability[]  // 能力标记 (当前未使用)
  type?: ModelType[]
  pricing?: ModelPricing
  endpoint_type?: EndpointType
  supported_text_delta?: boolean    // 是否支持流式
}
```

### 存储位置

```
Redux Store (store/llm.ts)
├─ state.llm.providers[]
│   └─ models[]
│       ├─ 用户添加的模型
│       └─ 从 API 获取的模型
│
└─ 持久化到 LocalStorage (redux-persist)
```

### 目标流程

重构后，用户添加的模型将存入 SQLite：

```
用户添加模型
     ↓
┌────────────────────────────────────────┐
│ AddModelPopup (保持不变)               │
│ ├─ Model ID                            │
│ ├─ Model Name                          │
│ └─ Group                               │
└────────────────────────────────────────┘
     ↓
检查 Presets 是否有此模型定义
├─ 有 → 创建 user_model_override (只存覆盖字段)
└─ 无 → 创建 user_model (完整定义)
     ↓
DataApi.createUserModel() 或 DataApi.createUserModelOverride()
     ↓
SQLite 持久化
     ↓
CacheService.invalidate('models')
```

### 模型合并优先级

```
resolveModelConfig(uniqueModelId)
     ↓
┌─────────────────────────────────────────────────────────────┐
│                     优先级 (高 → 低)                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. user_model_override    用户对预设模型的覆盖              │
│         ↓                                                   │
│  2. user_model             用户完全自定义的模型              │
│         ↓                                                   │
│  3. provider-models.json   提供商-模型映射                  │
│         ↓                                                   │
│  4. models.json            规范模型定义                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 关键文件

| 文件 | 说明 |
| --- | --- |
| `ModelList/AddModelPopup.tsx` | 手动添加模型弹窗 |
| `ModelList/ManageModelsPopup.tsx` | 从 API 获取并管理模型 |
| `ModelList/NewApiAddModelPopup.tsx` | NewApi 特殊处理 |
| `store/llm.ts` | Redux actions: addModel/removeModel/updateModel |
| `hooks/useProvider.ts` | React Hook 封装 |
| `services/ApiService.ts` | `fetchModels()` 远程获取 |

---

## 与 aiCore 集成

### aiCore 架构概述

`src/renderer/src/aiCore/` 是 Cherry Studio 的 AI 请求执行引擎，采用**双层架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                      aiCore 架构                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Modern Layer (index_new.ts)     Legacy Layer (legacy/)     │
│  ─────────────────────────       ──────────────────────     │
│  • AI SDK 实现                   • 原始提供商实现            │
│  • 插件架构                      • 中间件模式               │
│  • 流式处理                      • 图像生成 (降级使用)       │
│                                                              │
│  [主要路径]                      [兼容/降级路径]             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 当前请求流程

```
用户请求 (React Component)
     ↓
ModernAiProvider.completions(model, params, config)
     ↓
┌────────────────────────────────────────────────────────────┐
│ 1. Provider 解析                                            │
│    ├─ getActualProvider(model) → 从 Redux 获取 Provider     │
│    ├─ formatProviderApiHost() → 格式化 API URL              │
│    └─ providerToAiSdkConfig() → 转换为 AI SDK 配置          │
├────────────────────────────────────────────────────────────┤
│ 2. 能力检测 (硬编码)                                         │
│    ├─ isReasoningModel(model) → 150+ 正则检测               │
│    ├─ isWebSearchModel(model) → 提供商特定检测              │
│    └─ isGenerateImageModel(model) → 模式匹配                │
├────────────────────────────────────────────────────────────┤
│ 3. Middleware 构建                                          │
│    ├─ buildAiSdkMiddlewares() → 根据能力选择中间件          │
│    │   ├─ anthropicCacheMiddleware (Anthropic)             │
│    │   ├─ extractReasoningMiddleware (OpenAI)              │
│    │   ├─ qwenThinkingMiddleware (Qwen)                    │
│    │   └─ ...                                              │
│    └─ wrapLanguageModel() → 应用中间件到模型                │
├────────────────────────────────────────────────────────────┤
│ 4. Plugin 构建                                              │
│    ├─ telemetryPlugin (开发模式)                            │
│    ├─ webSearchPlugin (内置搜索)                            │
│    ├─ searchOrchestrationPlugin (搜索编排)                  │
│    └─ createPromptToolUsePlugin (工具调用)                  │
├────────────────────────────────────────────────────────────┤
│ 5. 参数准备                                                 │
│    ├─ buildStreamTextParams() → 构建 AI SDK 参数            │
│    │   ├─ 消息转换 (UI → SDK 格式)                          │
│    │   ├─ 工具设置                                         │
│    │   └─ 模型参数 (temperature, max_tokens)               │
├────────────────────────────────────────────────────────────┤
│ 6. 执行                                                     │
│    └─ executor.streamText() → AI SDK 执行                   │
├────────────────────────────────────────────────────────────┤
│ 7. 流转换                                                   │
│    └─ AiSdkToChunkAdapter → TextStreamPart → Chunk         │
└────────────────────────────────────────────────────────────┘
     ↓
CompletionsResult { getText(): string }
```

### 目标集成流程

重构后，Presets 将成为能力检测的**唯一数据源**：

```
用户请求 (React Component)
     ↓
ModernAiProvider.completions(uniqueModelId, params, config)
     ↓
┌────────────────────────────────────────────────────────────┐
│ 1. 模型解析 (NEW)                                           │
│    ├─ parseUniqueModelId(uniqueModelId)                    │
│    │   → { providerId: 'anthropic', modelId: 'claude-4' }  │
│    └─ resolveModelConfig(uniqueModelId)                    │
│        ├─ 检查 user_model_override                         │
│        ├─ 检查 user_model                                  │
│        └─ 从 Presets 加载                                  │
├────────────────────────────────────────────────────────────┤
│ 2. 能力检测 (从 Presets 读取)                               │
│    const capabilities = modelConfig.capabilities           │
│    ├─ capabilities.includes('REASONING')                   │
│    ├─ capabilities.includes('WEB_SEARCH')                  │
│    ├─ capabilities.includes('IMAGE_GENERATION')            │
│    └─ capabilities.includes('FUNCTION_CALL')               │
├────────────────────────────────────────────────────────────┤
│ 3. 推理配置 (从 Presets 读取)                               │
│    const reasoning = modelConfig.reasoning                 │
│    ├─ reasoning.type → 'anthropic' | 'openai_chat' | ...   │
│    ├─ reasoning.supported_efforts → ['low', 'medium', ...] │
│    └─ reasoning.budget_tokens_range → [1024, 128000]       │
├────────────────────────────────────────────────────────────┤
│ 4. Middleware 构建 (基于 Presets 配置)                      │
│    buildAiSdkMiddlewares({                                 │
│      model: modelConfig,                                   │
│      reasoning: modelConfig.reasoning,                     │
│      capabilities: modelConfig.capabilities                │
│    })                                                      │
├────────────────────────────────────────────────────────────┤
│ 5-7. (保持不变)                                             │
└────────────────────────────────────────────────────────────┘
```

### 关键变更点

| 组件 | 当前 | 目标 |
| --- | --- | --- |
| **能力检测** | `isReasoningModel()` 等 150+ 函数 | `model.capabilities.includes()` |
| **推理配置** | `MODEL_SUPPORTED_REASONING_EFFORT` 硬编码 | `model.reasoning` 从 Presets |
| **模型参数** | `getActualProvider()` 查 Redux | `resolveModelConfig()` 合并 Presets + 用户覆盖 |
| **Provider 映射** | `STATIC_PROVIDER_MAPPING` 硬编码 | Presets `providers.json` |

### aiCore 核心文件

| 文件 | 说明 |
| --- | --- |
| `aiCore/index_new.ts` | 主入口，ModernAiProvider 类 |
| `aiCore/provider/factory.ts` | Provider 创建工厂 |
| `aiCore/provider/providerConfig.ts` | Provider 配置转换 (340+ 行) |
| `aiCore/middleware/AiSdkMiddlewareBuilder.ts` | 中间件构建器 |
| `aiCore/plugins/PluginBuilder.ts` | 插件构建器 |
| `aiCore/prepareParams/parameterBuilder.ts` | 参数准备 |
| `aiCore/chunk/AiSdkToChunkAdapter.ts` | 流转换适配器 |

### 重构后的数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    完整数据流                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [1] Presets 加载                                           │
│      PresetsLoader.init()                                   │
│      ├─ 读取 models.json → Map<modelId, ModelConfig>        │
│      ├─ 读取 providers.json → Map<providerId, Provider>     │
│      └─ 读取 provider-models.json → 映射关系                │
│                           ↓                                 │
│  [2] 用户数据加载                                            │
│      DataApi.getUserProviders()                             │
│      DataApi.getUserModels()                                │
│      DataApi.getUserModelOverrides()                        │
│                           ↓                                 │
│  [3] 模型解析                                               │
│      resolveModelConfig('anthropic::claude-sonnet-4')       │
│      ├─ merge(presetModel, userOverride)                   │
│      └─ 返回完整 ModelConfig                                │
│                           ↓                                 │
│  [4] aiCore 执行                                            │
│      ModernAiProvider.completions(modelConfig, ...)         │
│      ├─ 从 modelConfig.capabilities 读取能力                │
│      ├─ 从 modelConfig.reasoning 读取推理配置               │
│      ├─ 构建 middleware/plugins                            │
│      └─ 执行 AI 请求                                        │
│                           ↓                                 │
│  [5] 结果返回                                               │
│      CompletionsResult → UI                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 关键文件索引

### Presets 系统

| 文件 | 说明 |
| --- | --- |
| `packages/catalog/src/schemas/model.ts` | 模型 Schema 定义 |
| `packages/catalog/src/schemas/provider.ts` | 提供商 Schema 定义 |
| `packages/catalog/data/models.json` | 规范模型定义 (2779 条) |
| `packages/catalog/data/providers.json` | 提供商配置 (51 条) |
| `packages/catalog/data/overrides.json` | 提供商映射 → 重命名为 provider-models.json |

### aiCore 系统

| 文件 | 说明 |
| --- | --- |
| `aiCore/index_new.ts` | 主入口，ModernAiProvider 类 |
| `aiCore/provider/factory.ts` | Provider 创建工厂 |
| `aiCore/provider/providerConfig.ts` | Provider 配置转换 |
| `aiCore/middleware/AiSdkMiddlewareBuilder.ts` | 中间件构建器 |
| `aiCore/plugins/PluginBuilder.ts` | 插件构建器 |
| `aiCore/prepareParams/parameterBuilder.ts` | 参数准备 |
| `aiCore/chunk/AiSdkToChunkAdapter.ts` | 流转换适配器 |

### 运行时检测 (需重构)

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `src/renderer/src/config/models/reasoning.ts` | 777 | 推理模型检测 |
| `src/renderer/src/config/models/default.ts` | 1857 | 默认模型列表 |
| `src/renderer/src/config/models/vision.ts` | 264 | 视觉模型检测 |

---

## Schema 调整计划

### 概述

将双系统架构（Presets + 运行时正则检测）统一为基于 capabilities 的模型管理系统。

### 三种 Schema 类型对比

| 层级 | 位置 | 用途 | 数据来源 |
|------|------|------|----------|
| **Catalog Schema** | `packages/catalog/src/schemas/` | 验证 Presets JSON | 打包在应用中的模板数据 |
| **User Data Schema** | `src/main/data/db/schemas/` | 持久化用户数据 | 用户自定义/覆盖 |
| **Runtime Type** | `packages/shared/src/types/` | 应用运行时使用 | Presets + User Data 合并结果 |

```
┌─────────────────────────────────────────────────────────────┐
│                      数据流向                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Catalog JSON (Presets)          User SQLite (自定义)       │
│  ─────────────────────          ────────────────────        │
│  models.json (2779条)           user_model (用户添加)       │
│  providers.json (51条)          user_provider (用户创建)    │
│  provider-models.json           user_model_override (覆盖)  │
│                                                              │
│          ↓                              ↓                    │
│          └──────────────┬───────────────┘                   │
│                         ↓                                    │
│                  resolveModelConfig()                        │
│                         ↓                                    │
│                  RuntimeModel / RuntimeProvider              │
│                  (运行时统一类型)                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### 1. ModelSchema (Presets) 调整

**文件**: `packages/catalog/src/schemas/model.ts`

#### 新增字段

```typescript
// 1. 支持的推理努力级别 (替代 reasoning.ts 中 65 行硬编码)
supported_reasoning_efforts: z.array(
  z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'auto'])
).optional()

// 2. 默认推理努力级别
default_reasoning_effort: z.enum([
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'auto'
]).optional()

// 3. 流式输出支持 (替代 supported_text_delta)
supports_streaming: z.boolean().default(true)

// 4. 模型标签 (UI 筛选用)
tags: z.array(z.string()).optional()  // ['free', 'preview', 'deprecated']

// 5. 思考 Token 限制范围 (替代 THINKING_TOKEN_MAP 23 正则)
thinking_token_limits: z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  default: z.number().optional()
}).optional()
```

#### 关于 reasoning.type

**无需新增字段**。现有 `reasoning.type` 已定义 9 种 discriminated union：

| reasoning.type | 说明 |
|----------------|------|
| `openai-chat` | OpenAI Chat API (reasoning_effort) |
| `openai-responses` | OpenAI Responses API (effort + summary) |
| `anthropic` | Anthropic (budgetTokens) |
| `gemini` | Gemini (thinking_config / thinking_level) |
| `openrouter` | OpenRouter (effort / max_tokens) |
| `qwen` | Qwen (enable_thinking + thinking_budget) |
| `doubao` | Doubao (enabled/disabled/auto) |
| `dashscope` | DashScope (enable_thinking + incremental_output) |
| `self-hosted` | 自托管 (chat_template_kwargs) |

运行时 `reasoning.ts` 中 31 种硬编码类型本质是将模型 ID 模式匹配到这 9 种 API 配置类型。重构后：
- **不需要 `thinking_model_type` 字段**
- 直接使用 `reasoning.type` 字段
- 模型 → reasoning.type 的映射通过 Presets 数据完成，不再硬编码

---

### 2. ProviderSchema (Presets) 调整

**文件**: `packages/catalog/src/schemas/provider.ts`

#### 新增字段

```typescript
// 1. Provider 类型 (用于 aiCore 路由)
provider_type: z.enum([
  'openai', 'openai-response', 'anthropic', 'gemini',
  'azure-openai', 'vertexai', 'mistral', 'aws-bedrock',
  'vertex-anthropic', 'new-api', 'gateway', 'ollama'
]).optional()

// 2. Service Tier 支持 (OpenAI/Groq)
service_tier_support: z.object({
  supported: z.boolean().default(false),
  options: z.array(z.enum([
    'auto', 'default', 'flex', 'priority', 'on_demand'
  ])).optional()
}).optional()

// 3. Anthropic 缓存控制
cache_control_support: z.object({
  supported: z.boolean().default(false),
  default_token_threshold: z.number().optional(),
  default_cache_system_message: z.boolean().optional(),
  default_cache_last_n_messages: z.number().optional()
}).optional()

// 4. 默认速率限制
default_rate_limit: z.number().optional()

// 5. 额外 Headers 模板
extra_headers_template: z.record(z.string(), z.string()).optional()
```

#### 重命名字段

```typescript
// api_compatibility → api_features (语义更清晰)
api_features: z.object({
  supports_array_content: z.boolean().default(true),
  supports_stream_options: z.boolean().default(true),
  supports_developer_role: z.boolean().default(true),
  supports_service_tier: z.boolean().default(false),
  supports_thinking_control: z.boolean().default(true),
  supports_api_version: z.boolean().default(true),
  supports_verbosity: z.boolean().default(true)  // 新增
}).optional()
```

---

### 3. OverrideSchema → ProviderModelsSchema

**文件**: `packages/catalog/src/schemas/override.ts` → `provider-models.ts`

#### 重命名与重构

```typescript
// 主 Schema：提供商-模型映射
export const ProviderModelMappingSchema = z.object({
  // 复合键
  provider_id: ProviderIdSchema,
  model_id: ModelIdSchema,

  // 可用性
  enabled: z.boolean().default(true),

  // 提供商特定 Model ID (如与规范 ID 不同)
  provider_model_id: z.string().optional(),

  // 覆盖项
  capabilities_override: CapabilityOverrideSchema.optional(),
  limits_override: LimitsOverrideSchema.optional(),
  pricing_override: PricingOverrideSchema.optional(),
  reasoning_override: ReasoningOverrideSchema.optional(),  // 覆盖 reasoning.type 等

  // 端点类型覆盖
  endpoint_type_override: z.enum([
    'openai', 'openai-response', 'anthropic', 'gemini',
    'image-generation', 'jina-rerank'
  ]).optional(),

  // 废弃
  deprecated: z.boolean().default(false),
  replace_with: ModelIdSchema.optional(),

  // 排序
  priority: z.number().default(0)
})

// 容器 Schema
export const ProviderModelsListSchema = z.object({
  version: VersionSchema,
  mappings: z.array(ProviderModelMappingSchema)
})
```

#### 文件重命名

```
data/overrides.json → data/provider-models.json
```

---

### 4. 用户数据 Schema (SQLite)

#### 字段设计原则

**Catalog Schema** (Presets):
- 完整元数据 (capabilities, pricing, reasoning, parameters, modalities...)
- 用于验证 JSON 文件格式
- **只读**，不允许用户修改

**User Data Schema** (SQLite):
- 仅存储**用户自定义部分**
- `user_provider`: 用户创建的全新提供商 (不在 Presets 中)
- `user_model`: 用户添加的全新模型 (不在 Presets 中)
- `user_model_override`: 对 Presets 模型的部分覆盖 (仅存储差异)

**Runtime Type**:
- 合并后的最终类型
- aiCore 和 UI 组件使用此类型
- 包含来源追踪 (`source: 'preset' | 'user' | 'api'`)

#### user_provider 表

**文件**: `src/main/data/db/schemas/userProvider.ts` (新建)

```typescript
export const userProviderTable = sqliteTable('user_provider', {
  id: uuidPrimaryKey(),

  // 核心标识
  name: text().notNull(),
  type: text().notNull().default('openai'),

  // 连接设置
  apiHost: text().notNull(),
  apiKey: text(),  // 加密存储
  apiVersion: text(),

  // 功能选项 (JSON)
  apiOptions: text({ mode: 'json' }).$type<ProviderApiOptions>(),

  // 提供商特定设置 (JSON)
  settings: text({ mode: 'json' }),

  // 状态
  enabled: integer({ mode: 'boolean' }).default(true),

  ...createUpdateTimestamps
})
```

#### user_model 表

**文件**: `src/main/data/db/schemas/userModel.ts` (新建)

```typescript
export const userModelTable = sqliteTable('user_model', {
  // 使用 UniqueModelId 作为主键
  id: text().primaryKey(),  // 格式: providerId::modelId

  // 分解字段 (便于查询)
  providerId: text().notNull(),
  modelId: text().notNull(),

  // 显示
  displayName: text(),
  group: text(),
  description: text(),

  // 能力 (JSON 数组)
  capabilities: text({ mode: 'json' }).$type<string[]>(),

  // 配置 (JSON)
  config: text({ mode: 'json' }).$type<Partial<ModelConfig>>(),

  // 路由
  endpointType: text(),

  // 流式支持
  supportsStreaming: integer({ mode: 'boolean' }).default(true),

  ...createUpdateTimestamps
})
```

#### user_model_override 表

**文件**: `src/main/data/db/schemas/userModelOverride.ts` (新建)

```typescript
export const userModelOverrideTable = sqliteTable(
  'user_model_override',
  {
    // 复合主键
    providerId: text().notNull(),
    modelId: text().notNull(),

    // 能力覆盖
    capabilitiesAdd: text({ mode: 'json' }).$type<string[]>(),
    capabilitiesRemove: text({ mode: 'json' }).$type<string[]>(),

    // 显示覆盖
    displayName: text(),
    group: text(),

    // 配置覆盖 (JSON)
    configOverride: text({ mode: 'json' }),

    // 隐藏
    hidden: integer({ mode: 'boolean' }).default(false),

    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.providerId, t.modelId] })]
)
```

---

### 5. 运行时类型调整

#### RuntimeModel 类型

**文件**: `packages/shared/src/types/model.ts` (新建)

```typescript
// UniqueModelId 格式
export type UniqueModelId = `${string}::${string}`

export type RuntimeModel = {
  // 核心标识
  uniqueId: UniqueModelId
  id: string
  provider: string
  name: string
  group: string

  // 元数据
  owned_by?: string
  description?: string

  // 能力 (从 Presets 填充)
  capabilities: ModelCapabilityType[]

  // 推理配置 (从 Presets reasoning 字段填充)
  reasoning?: Reasoning  // 包含 type: 'openai-chat' | 'anthropic' | ... 9 种
  supportedReasoningEfforts?: readonly string[]
  thinkingTokenLimits?: { min?: number; max?: number; default?: number }

  // Token 限制
  contextWindow?: number
  maxOutputTokens?: number
  maxInputTokens?: number

  // 定价
  pricing?: RuntimeModelPricing

  // 路由
  endpointType?: RuntimeEndpointType
  supportedEndpointTypes?: RuntimeEndpointType[]

  // 流式
  supportsStreaming: boolean

  // 来源追踪
  source: 'preset' | 'user' | 'api'

  // 标签
  tags?: string[]
}
```

#### RuntimeProvider 类型

**文件**: `packages/shared/src/types/provider.ts` (新建)

```typescript
export type RuntimeProvider = {
  // 核心标识
  id: string
  name: string
  type: RuntimeProviderType

  // 连接
  apiHost: string
  apiKey?: string
  apiVersion?: string

  // 模型列表
  models: RuntimeModel[]

  // 状态
  enabled: boolean
  isSystem: boolean
  isAuthed: boolean

  // API 选项 (从 Presets + 用户合并)
  apiOptions: ResolvedApiOptions

  // OpenAI/Groq 特定
  serviceTier?: RuntimeServiceTier
  verbosity?: RuntimeVerbosity

  // 速率限制
  rateLimit?: number

  // Anthropic 缓存
  anthropicCacheControl?: AnthropicCacheControlSettings

  // 额外 Headers
  extraHeaders?: Record<string, string>

  // 来源追踪
  source: 'preset' | 'user'
}

export type RuntimeProviderType =
  | 'openai' | 'openai-response' | 'anthropic' | 'gemini'
  | 'azure-openai' | 'vertexai' | 'mistral' | 'aws-bedrock'
  | 'vertex-anthropic' | 'new-api' | 'gateway' | 'ollama'
```

---

### 6. 共享类型包

#### 包结构

```
packages/shared/
├── package.json
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── index.ts
│   │   ├── model.ts        # RuntimeModel, UniqueModelId
│   │   ├── provider.ts     # RuntimeProvider
│   │   └── capability.ts   # 重导出 catalog 类型
│   └── utils/
│       ├── uniqueModelId.ts  # 解析/格式化工具
│       └── mergeConfig.ts    # 配置合并工具
```

#### UniqueModelId 工具函数

```typescript
// packages/shared/src/utils/uniqueModelId.ts

const SEPARATOR = '::'

export function formatUniqueModelId(
  providerId: string,
  modelId: string
): UniqueModelId {
  return `${providerId}${SEPARATOR}${modelId}` as UniqueModelId
}

export function parseUniqueModelId(
  uniqueId: UniqueModelId
): { providerId: string; modelId: string } {
  const idx = uniqueId.indexOf(SEPARATOR)
  if (idx === -1) throw new Error(`Invalid UniqueModelId: ${uniqueId}`)
  return {
    providerId: uniqueId.slice(0, idx),
    modelId: uniqueId.slice(idx + SEPARATOR.length)
  }
}

export function isUniqueModelId(value: string): value is UniqueModelId {
  return value.includes(SEPARATOR)
}
```

---

### 7. 关键变更对照

| 组件 | 当前 | 目标 |
|------|------|------|
| 推理类型 | 31 种硬编码 (reasoning.ts) | `reasoning.type` (9 种 discriminated union) |
| 推理努力 | `MODEL_SUPPORTED_REASONING_EFFORT` | `supported_reasoning_efforts` 字段 |
| Token 限制 | `THINKING_TOKEN_MAP` (23 正则) | `thinking_token_limits` 字段 |
| 流式支持 | `supported_text_delta` | `supports_streaming` |
| 能力检测 | 150+ 正则函数 | `capabilities.includes()` |
| Provider 类型 | 运行时推断 | `provider_type` 字段 |
| 模型标识 | `provider` + `id` 分离 | `UniqueModelId` (`providerId::modelId`) |

---

### 8. 关键文件索引

| 文件 | 操作 | 优先级 |
|------|------|--------|
| `packages/catalog/src/schemas/model.ts` | 新增 5 个字段 + 说明 reasoning.type | 高 |
| `packages/catalog/src/schemas/provider.ts` | 新增 5 个字段，重命名 1 个 | 高 |
| `packages/catalog/src/schemas/override.ts` | 重命名为 provider-models.ts，重构 | 高 |
| `packages/catalog/data/overrides.json` | 重命名为 provider-models.json | 高 |
| `src/main/data/db/schemas/userProvider.ts` | 新建 | 高 |
| `src/main/data/db/schemas/userModel.ts` | 新建 | 高 |
| `src/main/data/db/schemas/userModelOverride.ts` | 新建 | 高 |
| `packages/shared/` | 新建包 | 中 |
| `src/renderer/src/types/index.ts` | 更新 Model 类型 | 中 |
| `src/renderer/src/types/provider.ts` | 更新 Provider 类型 | 中 |

---

## 修复优先级

| 优先级 | 任务 | 说明 |
| --- | --- | --- |
| **高** | 重命名 catalog → model-provider-presets | 明确职责边界 |
| **高** | 唯一 ModelId 设计 | `providerId::modelId` 格式 |
| **高** | 用户数据 Schema | user_provider, user_model, user_model_override |
| **中** | Presets → 运行时集成 | 加载到 CacheService，替代硬编码检测 |
| **中** | 运行时更新机制 | CDN 全量更新 |
| **低** | 用户覆盖 Data API | useQuery/useMutation |

---

## 相关文档

- [Catalog README](../../../packages/catalog/README.md)
- [Catalog PLANS](../../../packages/catalog/PLANS.md)
- [数据管理参考](./data/README.md)
