# WebSearch 数据迁移设计

## 数据分类概览

| 原 Redux 字段 | v2 系统 | 说明 |
|--------------|---------|------|
| `providers` | **Preference** | `websearch.providers` (聚合对象) |
| `searchWithTime` | **Preference** | `websearch.search_with_time` |
| `maxResults` | **Preference** | `websearch.max_results` |
| `excludeDomains` | **Preference** | `websearch.exclude_domains` |
| `compressionConfig` | **Preference** | `websearch.compression` (聚合对象) |
| `subscribeSources` | ❌ **移除** | 功能弃用，使用率低 |
| `defaultProvider` | ❌ **移除** | 已废弃 |
| `overwrite` | ❌ **移除** | 已废弃 |
| `providerConfig` | ❌ **移除** | 合并到 `websearch.providers` |

---

# WebSearch Preference 设计

## Preference Keys

### Provider 配置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `websearch.providers` | `WebSearchProviderConfigs` | `{}` | 所有 provider 的用户配置 |

#### WebSearchProviderConfigs 类型定义

```typescript
// Provider 配置（用户可修改的字段）
interface WebSearchProviderConfig {
  apiKey?: string
  apiHost?: string
  engines?: string[]
  usingBrowser?: boolean
  basicAuthUsername?: string
  basicAuthPassword?: string
}

// 所有 Provider 的配置集合
type WebSearchProviderConfigs = {
  [providerId: string]: WebSearchProviderConfig
}
```

#### 设计理由

采用 **Preference** 而非 DataApi（数据库），原因：

1. **固定列表** - 只有 9 个预设 provider（zhipu, tavily, searxng, exa, exa-mcp, bocha, local-google, local-bing, local-baidu），用户不能创建新的
2. **符合规范** - 根据 Data System 设计规范，"AI provider configs" 应使用 PreferenceService
3. **避免过度设计** - 数据库需要 schema、migration、handler、service 四层，对于固定配置来说过于复杂
4. **数据丢失影响低** - 用户可以重新配置 API key

#### 数据示例

```typescript
// websearch.providers 存储值
{
  tavily: {
    apiKey: 'tvly-xxxxx',
    apiHost: 'https://api.tavily.com'
  },
  searxng: {
    apiHost: 'https://my-searxng.example.com',
    engines: ['google', 'bing', 'duckduckgo'],
    basicAuthUsername: 'admin',
    basicAuthPassword: 'secret'
  },
  'local-google': {
    usingBrowser: true
  }
}
```

#### Provider 模板数据

Provider 的静态信息（id, name, type, 默认 apiHost）保留在代码中作为模板：

```typescript
// src/renderer/src/config/webSearchProviders.ts
export const WEB_SEARCH_PROVIDERS = [
  { id: 'tavily', name: 'Tavily', apiHost: 'https://api.tavily.com', ... },
  { id: 'searxng', name: 'Searxng', apiHost: '', ... },
  // ...
]
```

运行时合并：`模板数据 + Preference 配置 = 完整 Provider 对象`

### 基础设置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `websearch.search_with_time` | boolean | `true` | 搜索时添加时间信息 |
| `websearch.max_results` | number | `5` | 最大搜索结果数 |
| `websearch.exclude_domains` | string[] | `[]` | 排除的域名列表 |

### 压缩配置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `websearch.compression` | `WebSearchCompressionConfig \| null` | `null` | 压缩配置对象 |

#### WebSearchCompressionConfig 类型定义

```typescript
import type { ModelMeta } from '@shared/data/types/meta'

// Embedding 模型元信息（扩展 ModelMeta）
interface EmbeddingModelMeta extends ModelMeta {
  dimensions?: number
}

// 压缩配置对象
interface WebSearchCompressionConfig {
  // 压缩方式
  method: 'none' | 'cutoff' | 'rag'

  // Cutoff 相关（method = 'cutoff' 时使用）
  cutoffLimit?: number          // 截断限制值
  cutoffUnit?: 'char' | 'token' // 截断单位，默认 'char'

  // RAG 相关（method = 'rag' 时使用）
  documentCount?: number              // 每个结果的文档数量
  embeddingModelId?: string           // Embedding 模型 ID
  embeddingModelMeta?: EmbeddingModelMeta  // Embedding 模型元信息
  rerankModelId?: string              // Rerank 模型 ID
  rerankModelMeta?: ModelMeta         // Rerank 模型元信息
}
```

#### 设计理由

采用**聚合对象**而非拆分为多个 key，原因：

1. **逻辑耦合强** - `method` 是控制字段，决定其他字段是否生效：
   - `method = 'none'` → 其他字段全部无效
   - `method = 'cutoff'` → 只有 `cutoffLimit`, `cutoffUnit` 有效
   - `method = 'rag'` → 只有 embedding/rerank 相关字段有效

2. **现有代码模式** - Service 和 UI 都是整体操作 config 对象，不是单独操作某个字段

3. **避免状态不一致** - 拆分后 `method = 'none'` 时其他 key 仍有值，语义混乱

4. **项目已有先例** - `feature.selection.action_items` 存储复杂对象数组

## 设计原则

1. **Provider 配置聚合** - `providers` 作为逻辑单元，使用对象存储
2. **基础设置扁平化** - `search_with_time`, `max_results`, `exclude_domains` 使用扁平 key
3. **复杂配置聚合** - `compression` 作为逻辑单元，使用对象存储
4. **Model 引用模式** - `model_id` + `model_meta`，保留显示信息防止模型删除后丢失
5. **EmbeddingModelMeta** - 扩展 ModelMeta，包含 `dimensions` 属性
