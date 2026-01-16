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

## 关键文件索引

### Presets 系统

| 文件 | 说明 |
| --- | --- |
| `packages/catalog/src/schemas/model.ts` | 模型 Schema 定义 |
| `packages/catalog/src/schemas/provider.ts` | 提供商 Schema 定义 |
| `packages/catalog/data/models.json` | 规范模型定义 (2779 条) |
| `packages/catalog/data/providers.json` | 提供商配置 (51 条) |
| `packages/catalog/data/overrides.json` | 提供商映射 (3407 条) → 重命名为 provider-models.json |

### 运行时检测 (需重构)

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `src/renderer/src/config/models/reasoning.ts` | 777 | 推理模型检测 |
| `src/renderer/src/config/models/default.ts` | 1857 | 默认模型列表 |
| `src/renderer/src/config/models/vision.ts` | 264 | 视觉模型检测 |

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
