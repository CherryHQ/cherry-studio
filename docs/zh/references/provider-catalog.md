# Provider Catalog 架构文档

本文档介绍 Cherry Studio 的 Provider Catalog 系统架构、现状分析及已知缺陷。

---

## 概述

Provider Catalog (`packages/catalog/`) 是一个元数据驱动的模型管理系统，旨在统一管理来自多个提供商的 AI 模型信息。

### 核心数据

| 数据文件 | 内容 | 数量 |
| --- | --- | --- |
| `data/models.json` | 模型基础目录 | 2,779 个模型 |
| `data/providers.json` | 提供商配置 | 51 个提供商 |
| `data/overrides.json` | 提供商特定覆盖 | 3,407 条覆盖 |

---

## 架构现状

### 双系统并存

当前存在两套**完全独立**的模型能力检测系统：

```
┌─────────────────────────────────────┐
│   Catalog 系统 (packages/catalog)   │
│   ─────────────────────────────────│
│   ✓ 2779 个模型（含能力标记）        │
│   ✓ 8 种推理实现类型                 │
│   ✓ 3407 条提供商覆盖               │
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

### Catalog 已解决的问题

1. **统一模型发现**: 从 51+ 提供商聚合模型到单一来源
2. **提供商抽象**: 处理不同提供商的 API 格式和能力差异
3. **能力 Schema**: 18 种模型能力类型定义
4. **推理配置 Schema**: 8 种推理实现的类型定义
5. **开发时同步**: 支持通过脚本从提供商 API 导入模型（`npm run sync:all`）

### Catalog 核心限制

**当前架构不支持运行时更新 Catalog 数据**：

```
┌─────────────────────────────────────────────────────────────┐
│                  当前 Catalog 数据流                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  开发阶段                    构建阶段         运行阶段         │
│  ─────────                  ─────────       ─────────       │
│  npm run sync:all           打包到 app      只读访问         │
│       ↓                         ↓               ↓           │
│  models.json         →    app bundle    →   ConfigLoader    │
│  providers.json                              (fs.readFile)  │
│  overrides.json                                             │
│                                                              │
│  [可更新]                  [固化]           [不可更新]        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**影响**:
- 新模型上线（如 GPT-6）需要发布新版 Cherry Studio
- 用户必须更新应用才能看到新模型
- 无法像 Cursor 那样在线获取最新模型列表

---

## 模型能力类型

Catalog 定义了 18 种模型能力类型：

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

### Catalog Schema (8 种)

Catalog 使用 discriminated union 定义 8 种推理实现：

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

### 运行时配置 (31 种)

运行时在 `reasoning.ts` 中硬编码了 31 种模型类型：

```typescript
// src/renderer/src/config/models/reasoning.ts:31-62
export const MODEL_SUPPORTED_REASONING_EFFORT = {
  default: ['low', 'medium', 'high'],
  o: ['low', 'medium', 'high'],
  openai_deep_research: ['medium'],
  gpt5: ['minimal', 'low', 'medium', 'high'],
  gpt5_codex: ['low', 'medium', 'high'],
  gpt5_1: ['none', 'low', 'medium', 'high'],
  gpt5_1_codex: ['none', 'medium', 'high'],
  gpt5_1_codex_max: ['none', 'medium', 'high', 'xhigh'],
  gpt5_2: ['none', 'low', 'medium', 'high', 'xhigh'],
  gpt5pro: ['high'],
  gpt52pro: ['medium', 'high', 'xhigh'],
  gpt_oss: ['low', 'medium', 'high'],
  grok: ['low', 'high'],
  grok4_fast: ['auto'],
  gemini2_flash: ['low', 'medium', 'high', 'auto'],
  gemini2_pro: ['low', 'medium', 'high', 'auto'],
  gemini3_flash: ['minimal', 'low', 'medium', 'high'],
  gemini3_pro: ['low', 'high'],
  qwen: ['low', 'medium', 'high'],
  qwen_thinking: ['low', 'medium', 'high'],
  doubao: ['auto', 'high'],
  doubao_no_auto: ['high'],
  doubao_after_251015: ['minimal', 'low', 'medium', 'high'],
  hunyuan: ['auto'],
  mimo: ['auto'],
  zhipu: ['auto'],
  perplexity: ['low', 'medium', 'high'],
  deepseek_hybrid: ['auto'],
  // ...
}
```

---

## 已知缺陷

### Gap 0: 模型来源多样性问题

当前存在 **三种模型来源**，彼此独立，合并逻辑不明确：

#### 来源 1: 内置模型 (SYSTEM_MODELS)

**位置**: `src/renderer/src/config/models/default.ts`

```typescript
export const SYSTEM_MODELS: Record<SystemProviderId | 'defaultModel', Model[]> = {
  openai: [
    { id: 'gpt-5.1', provider: 'openai', name: 'GPT 5.1', group: 'GPT 5.1' },
    // ... 60+ 提供商，共 326+ 模型
  ]
}
```

| 特性 | 描述 |
| --- | --- |
| 存储位置 | 硬编码在 TypeScript |
| 代码行数 | 1,857 行 |
| 更新方式 | 需要代码修改 + 重新部署 |
| 优点 | 离线可用，启动即有 |
| 缺点 | 无法动态更新，维护成本高 |

#### 来源 2: 用户添加的模型

**位置**:
- UI: `AddModelPopup.tsx`, `NewApiAddModelPopup.tsx`
- 存储: Redux store (`store/llm.ts`)

```typescript
// 用户输入
const model: Model = {
  id: 'user-model-id',        // 手动输入（支持逗号分隔批量添加）
  name: 'Custom Model Name',   // 可选，默认 = id.toUpperCase()
  group: 'Custom Group',       // 可选，自动从 id 推断
  provider: 'my-provider-id'
}

// 存储方式
dispatch(addModel({ providerId: id, model }))
// → state.llm.providers[].models[]
```

| 特性 | 描述 |
| --- | --- |
| 存储位置 | Redux → LocalStorage (v2 将迁移到 SQLite) |
| 作用域 | 按提供商存储 |
| 去重逻辑 | `uniqBy(models.concat(newModel), 'id')` |

#### 来源 3: 远程获取的模型

**位置**: `src/renderer/src/services/ApiService.ts`

```typescript
export async function fetchModels(provider: Provider): Promise<Model[]> {
  const AI = new AiProviderNew(providerWithRotatedKey)
  return await AI.models()  // 调用提供商 /v1/models API
}
```

**触发方式**: 用户在 `ManageModelsPopup` 中手动点击刷新

| 特性 | 描述 |
| --- | --- |
| 数据来源 | 提供商 API (`/v1/models`) |
| 触发方式 | 用户手动点击刷新按钮 |
| 临时展示 | 获取后在组件 state 中展示供用户选择 |
| 最终存储 | 用户选择后通过 `addModel` 存入 Redux → LocalStorage |
| 迁移计划 | v2 将迁移到 SQLite (DataApi) |

**注意**: 并非所有提供商都支持 `/v1/models` 接口。对于不支持的提供商：
- 用户只能手动输入模型 ID
- 依赖 Catalog 内置的模型列表
- 这不是一个需要解决的 gap，而是提供商 API 的限制

#### 模型合并逻辑

```typescript
// ManageModelsPopup.tsx:78
const systemModels = SYSTEM_MODELS[provider.id] || []
const allModels = uniqBy([...systemModels, ...listModels, ...models], 'id')
//                        ↑ 内置模型     ↑ 远程获取   ↑ 用户添加
```

**合并问题**:

| 问题 | 描述 |
| --- | --- |
| 优先级不明确 | 相同 id 时，哪个来源优先？ |
| 能力冲突 | 内置模型的能力标记 vs 远程获取的能力 |
| 数据不一致 | 内置模型可能过时 |
| 价格冲突 | 多个来源的价格信息可能不同 |

#### Catalog 可以如何解决

```
┌─────────────────────────────────────┐
│   Catalog (唯一数据源)               │
│   ─────────────────────────────────│
│   models.json    → 基础模型定义      │
│   providers.json → 提供商配置        │
│   overrides.json → 覆盖层           │
│     ├── provider 覆盖 (自动生成)    │
│     └── user 覆盖 (priority: 100+)  │
└─────────────────────────────────────┘
           ↓
    v2: 启动时导入到 SQLite (model_catalog 表)
           ↓
    运行时按优先级合并:
    user override > provider override > base model
```

---

### Gap 1: 推理控制未集成

| 维度 | Catalog | 运行时 |
| --- | --- | --- |
| 推理类型数量 | 8 种 | 31 种 |
| 努力等级选项 | `ReasoningSchema` | `MODEL_SUPPORTED_REASONING_EFFORT` |
| Token 限制 | `thinking_token_limits` 字段 | `THINKING_TOKEN_MAP` (23+ 正则) |
| 数据来源 | JSON + Zod 验证 | 硬编码在 TypeScript |

**影响文件:**
- `src/renderer/src/config/models/reasoning.ts:31-94` - 硬编码努力等级映射
- `src/renderer/src/config/models/reasoning.ts:700-745` - 硬编码 Token 限制

### Gap 2: 能力检测使用硬编码模式

当前使用 150+ 正则模式和 30+ 检测函数：

```typescript
// 当前实现
isOpenAIReasoningModel(model) ||
isGeminiReasoningModel(model) ||
isClaudeReasoningModel(model) || ...

// 理想实现
model.capabilities.includes('REASONING')
```

**涉及文件:**
- `reasoning.ts` - 777 行，6 个正则，15+ 检测函数
- `vision.ts` - 264 行，4 个正则，60+ 模式
- `tooluse.ts` - 90 行，35+ 模式
- `websearch.ts` - 194 行，提供商特定列表

### Gap 3: Model.capabilities 字段未使用

`Model` 类型已有 `capabilities` 字段，但未从 Catalog 填充：

```typescript
// src/renderer/src/types/index.ts
type Model = {
  capabilities?: ModelCapability[]  // 存在但未使用
}

// isUserSelectedModelType() 检查此字段
// 但 Catalog 数据从未流入
```

### Gap 4: 提供商特定逻辑硬编码

特殊提供商处理分散在代码中：

```typescript
// reasoning.ts:253-274 - DeepSeek 硬编码提供商白名单
[
  'openrouter', 'dashscope', 'modelscope', 'doubao',
  'silicon', 'nvidia', 'ppio', 'hunyuan', 'tencent-cloud-ti',
  'deepseek', 'cherryin', 'new-api', 'aihubmix', 'sophnet', 'dmxapi'
]
```

### Gap 5: 版本/日期逻辑硬编码在函数名

模型版本变更硬编码在函数名中：

```typescript
isDoubaoSeedAfter251015(model)  // 日期在函数名中！
isDoubaoSeed18Model(model)       // 版本在函数名中！
```

**应改为:** 使用 Catalog 的 `release_date`、`deprecation_date` 字段

### Gap 6: 模型日期格式不统一

模型 ID 中的日期/版本有 **8 种不同格式**：

| 提供商 | 格式 | 示例 |
| --- | --- | --- |
| OpenAI | `-YYYY-MM-DD` | `gpt-4o-2024-08-06` |
| Claude (Direct) | `-YYYYMMDD` | `claude-3-5-sonnet-20240620` |
| Claude (Vertex AI) | `@YYYYMMDD` | `claude-sonnet-4@20250514` |
| Claude (Bedrock) | `-YYYYMMDD-v1:0` | `anthropic.claude-sonnet-4-20250514-v1:0` |
| Doubao | `-YYMMDD` | `doubao-seed-1-6-251015` |
| Qwen (完整) | `-YYYY-MM-DD` | `qwen-plus-2025-04-28` |
| Qwen (简短) | `-YYMM` | `qwen3-30b-a3b-thinking-2507` |
| Kimi | `-MMDD` | `kimi-k2-0905` |

**缺失功能:**
1. 日期提取工具：`extractModelDate(id) → Date`
2. 日期比较工具：`isModelAfter(model, date) → boolean`
3. 版本解析工具：`getModelVersion(model) → { base, version, date }`

### Gap 7: 数据存储架构分裂

当前数据存储在 **三个不同位置**：

| 存储位置 | 技术 | 数据类型 | 路径 |
| --- | --- | --- | --- |
| **LocalStorage** | Redux + redux-persist | 用户设置 + LLM配置 | `localStorage['persist:cherry-studio']` |
| **SQLite 数据库** | Drizzle ORM | 业务数据 | `userData/cherrystudio.db` |
| **应用包内 JSON** | 静态文件 | Catalog 元数据 | `packages/catalog/data/*.json` |

#### 详细分解

**LocalStorage (Redux Persist)**:
- `llm.providers[]` - 提供商配置 + 用户添加的模型
- `llm.defaultModel` - 默认模型选择
- `settings.*` - 用户设置
- `assistants.*` - 助手配置

**SQLite 数据库**:
- `topic` - 对话主题
- `message` - 聊天消息 (含 `modelMeta` 软引用)
- `group` - 分组
- `tag` / `entity_tag` - 标签
- `preference` - 偏好设置
- `app_state` - 应用状态

**应用包内 JSON (Catalog)**:
- `models.json` (2779 models, 1.9MB)
- `providers.json` (51 providers, 54KB)
- `overrides.json` (3407 overrides, 544KB)
- 编译时打包，只读，更新需发版

#### 数据分裂问题

```
┌─────────────────────────────────────────────────────────────┐
│  Provider/Model 数据存储现状                                 │
├─────────────────────────────────────────────────────────────┤
│  LocalStorage (Redux)          SQLite           App Bundle   │
│  ─────────────────────        ──────────       ───────────  │
│  • llm.providers[]            • topic          • models.json │
│  • 用户添加的模型              • message        • providers.  │
│  • 运行时修改                  • modelMeta      • overrides.  │
│                               (软引用快照)                   │
│                                                              │
│  ❌ 卸载后丢失                 ✅ 持久化        ❌ 只读       │
│  ❌ 无法查询                   ✅ 可查询        ❌ 无法查询   │
│  ❌ 无版本控制                 ✅ 有版本        ❌ 打包时固定 │
└─────────────────────────────────────────────────────────────┘
```

### Gap 8: 缺少 Catalog 数据库表和 Data API

**现有数据库表** (`src/main/data/db/schemas/`):

| Schema | 表名 | 用途 |
| --- | --- | --- |
| `appState.ts` | `app_state` | 应用状态键值存储 |
| `preference.ts` | `preference` | 用户偏好设置 |
| `group.ts` | `group` | 多态分组 |
| `topic.ts` | `topic` | 对话主题 |
| `message.ts` | `message` | 聊天消息 + FTS5 |
| `tagging.ts` | `tag`, `entity_tag` | 多对多标签 |

**缺失**: 没有 `provider`、`model` 或 `catalog` 相关表！

#### 建议的 Catalog Schema

```typescript
// model_catalog 表
{
  id: uuidPrimaryKeyOrdered(),  // 时间排序 UUID (2779+ 模型)
  model_id: text().notNull().unique(),
  provider_id: text().notNull(),
  data: text({ mode: 'json' }).$type<ModelConfig>(),
  capabilities: text({ mode: 'json' }).$type<string[]>(),
  version: text(),
  ...createUpdateTimestamps
}
INDEX(model_id)
INDEX(provider_id, updatedAt)

// provider_catalog 表
{
  id: uuidPrimaryKey(),
  provider_id: text().notNull().unique(),
  data: text({ mode: 'json' }).$type<ProviderConfig>(),
  version: text(),
  last_synced: integer(),
  ...createUpdateTimestamps
}

// model_override 表
{
  id: uuidPrimaryKey(),
  provider_id: text().notNull(),
  model_id: text().notNull(),
  source: text().notNull(),  // 'system' | 'user' | 'sync'
  override_data: text({ mode: 'json' }).$type<ProviderModelOverride>(),
  priority: integer().default(0),
  ...createUpdateTimestamps
}
PRIMARY KEY(provider_id, model_id, source)
```

#### 建议的 Data API 端点

```typescript
// packages/shared/data/api/schemas/catalog.ts
export interface CatalogSchemas {
  '/catalog/providers': {
    GET: { query?: OffsetPaginationParams; response: OffsetPaginationResponse<Provider> }
  }
  '/catalog/providers/:id/sync': {
    POST: { params: { id: string }; response: SyncResult }
  }
  '/catalog/models': {
    GET: {
      query?: OffsetPaginationParams & {
        providerId?: string
        capabilities?: string[]
        search?: string
      }
      response: OffsetPaginationResponse<Model>
    }
  }
  '/catalog/overrides': {
    GET: { query?: { providerId?: string; modelId?: string }; response: Override[] }
    POST: { body: CreateOverrideDto; response: Override }
  }
}
```

#### 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│  Provider/Model 数据目标架构                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  App Bundle (只读)     →    SQLite (持久化)                  │
│  ─────────────────          ─────────────────                │
│  models.json               model_catalog                     │
│  providers.json            provider_catalog                  │
│  overrides.json            model_override                    │
│                                                              │
│  [首次启动: 导入]           [运行时: 读写]                   │
│  [版本更新: 合并]           [用户修改: override]             │
│                                                              │
│                             ↓                                │
│                      Data API 访问                           │
│                   useQuery('/catalog/models')                │
│                   useMutation(createOverride)                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Gap 9: 无运行时 Catalog 更新机制

#### 问题

Catalog 数据在**构建时固化**到应用包中，运行时无法更新：

```
┌─────────────────────────────────────────────────────────────┐
│                  当前: 构建时固化                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  packages/catalog/data/     →    electron-builder           │
│  ├── models.json                 打包到 app.asar            │
│  ├── providers.json                    ↓                    │
│  └── overrides.json            /Resources/app.asar          │
│                                  (只读, 签名保护)            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 当前同步机制

`packages/catalog/` 的同步功能仅用于**开发阶段**：

| 命令 | 用途 | 运行环境 |
| --- | --- | --- |
| `npm run sync:all` | 从所有提供商同步模型 | 开发机器 |
| `npm run import:openrouter` | 从 OpenRouter 导入 | 开发机器 |
| `npm run import:aihubmix` | 从 AIHubMix 导入 | 开发机器 |

同步后需要：提交代码 → 发布新版本 → 用户更新应用

#### 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                  目标: 运行时可更新                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  远程 CDN                    本地 SQLite                     │
│  ─────────                  ───────────                     │
│  catalog-v2.3.0.json        model_catalog                   │
│  (版本化, 增量更新)          provider_catalog                │
│       ↓                     model_override                  │
│  后台检查更新                     ↑                          │
│       ↓                          │                          │
│  下载 + 合并   ──────────────────→│                          │
│                                                              │
│  [用户无感更新]              [保留用户自定义]                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 实现方案选项

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| **A: CDN 托管** | 简单, 可版本回滚 | 需要 CDN 成本, 离线时降级 |
| **B: GitHub Release** | 免费, 透明 | 中国大陆访问慢 |
| **C: 自建 API** | 灵活, 可增量 | 维护成本高 |

**建议**: 方案 A + B 混合 (CDN 主, GitHub 备)

#### 更新策略

```typescript
// 启动时检查更新
async function checkCatalogUpdate() {
  const local = await db.getCatalogVersion()
  const remote = await fetch(CDN_URL + '/catalog/version.json')

  if (remote.version > local.version) {
    // 后台下载增量更新
    const delta = await fetch(CDN_URL + `/catalog/delta-${local.version}-${remote.version}.json`)
    await db.applyCatalogDelta(delta)
  }
}

// 保留用户自定义
// user override (priority: 100+) 不会被远程更新覆盖
```

---

## 关键文件索引

### Catalog 系统

| 文件 | 说明 |
| --- | --- |
| `packages/catalog/src/schemas/model.ts` | 模型 Schema 定义 |
| `packages/catalog/src/schemas/provider.ts` | 提供商 Schema 定义 |
| `packages/catalog/data/models.json` | 模型数据 (2779 条) |
| `packages/catalog/data/providers.json` | 提供商数据 (51 条) |
| `packages/catalog/data/overrides.json` | 覆盖数据 (3407 条) |

### 模型来源相关

| 文件 | 说明 |
| --- | --- |
| `src/renderer/src/config/models/default.ts` | 内置模型定义 (1857 行) |
| `src/renderer/src/store/llm.ts` | Redux 状态管理 (已标记废弃) |
| `src/renderer/src/services/ApiService.ts` | `fetchModels()` 远程获取 |
| `src/renderer/src/hooks/useProvider.ts` | `addModel/removeModel/updateModel` |
| `src/renderer/src/pages/settings/ProviderSettings/ModelList/AddModelPopup.tsx` | 用户添加模型 UI |
| `src/renderer/src/pages/settings/ProviderSettings/ModelList/ManageModelsPopup.tsx` | 模型管理 + 合并逻辑 |

### 运行时检测 (需重构)

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `src/renderer/src/config/models/reasoning.ts` | 777 | 推理模型检测 |
| `src/renderer/src/config/models/default.ts` | 1857 | 默认模型列表 |
| `src/renderer/src/config/models/vision.ts` | 264 | 视觉模型检测 |
| `src/renderer/src/config/models/tooluse.ts` | 90 | 工具调用检测 |
| `src/renderer/src/config/models/websearch.ts` | 194 | 网页搜索检测 |
| `src/renderer/src/config/models/logo.ts` | 322 | Logo 映射 |

### 集成点 (已就绪但未使用)

| 文件 | 说明 |
| --- | --- |
| `src/renderer/src/types/index.ts` | `Model.capabilities` 字段定义 |
| `src/renderer/src/utils/model.ts` | `isUserSelectedModelType()` 函数 |

---

## 修复优先级

| 优先级 | 任务 | 阻塞性 | 说明 |
| --- | --- | --- | --- |
| **高** | 模型来源统一 | 是 | 三种来源冲突 |
| **高** | Catalog 数据库 Schema | 是 | 启用 Data API |
| **高** | 日期提取工具 | 是 | 阻塞版本检测 |
| **高** | Catalog → 运行时集成层 | 是 | 阻塞能力迁移 |
| **中** | Data API 端点 | 否 | 启用 useQuery/useMutation |
| **中** | 推理类型合并 | 否 | 31 种 → 8 种 |
| **中** | 提供商逻辑迁移 | 否 | 移至 Catalog 覆盖系统 |
| **中** | 运行时 Catalog 更新 (Gap 9) | 否 | CDN/GitHub 远程同步，用户无需更新应用 |
| **低** | 用户覆盖持久化 | 否 | 存储为 override 而非 Redux |
| **低** | Logo/默认模型清理 | 否 | 使用 Catalog 数据 |

### 目标数据层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Layer Architecture                   │
├─────────────────────────────────────────────────────────────┤
│  CacheService     │ PreferenceService │ DataApiService       │
│  ───────────────  │ ─────────────────│ ─────────────────    │
│  • 模型查找缓存   │ • 用户设置        │ • model_catalog      │
│  • 搜索结果       │ • UI 偏好         │ • provider_catalog   │
│                   │                  │ • model_override     │
│                   │                  │ • (现有表)           │
└─────────────────────────────────────────────────────────────┘
                              ↑
                    Catalog JSON (首次启动导入)
                    packages/catalog/data/
```

---

## 相关文档

- [Catalog README](../../../packages/catalog/README.md)
- [Catalog PLANS](../../../packages/catalog/PLANS.md)
- [数据管理参考](./data/README.md)
