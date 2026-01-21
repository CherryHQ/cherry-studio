# WebSearch 数据迁移设计

> ✅ **迁移状态**: 已完成。Redux store (`store/websearch.ts`) 已删除，所有数据现在使用 Preference API。

## 数据分类概览

| 原 Redux 字段 | v2 系统 | 说明 |
|--------------|---------|------|
| `providers` | **Preference** | `chat.websearch.providers`（Provider 列表） |
| `searchWithTime` | **Preference** | `chat.websearch.search_with_time` |
| `maxResults` | **Preference** | `chat.websearch.max_results` |
| `excludeDomains` | **Preference** | `chat.websearch.exclude_domains` |
| `compressionConfig` | **Preference** | `chat.websearch.compression.*`（扁平 key） |
| `subscribeSources` | ❌ **移除** | 功能弃用，使用率低 |
| `defaultProvider` | ❌ **移除** | 已废弃 |
| `overwrite` | ❌ **移除** | 已废弃 |
| `providerConfig` | ❌ **移除** | 合并到 `chat.websearch.providers` |

---

# WebSearch Preference 设计

## Preference Keys

### Provider 配置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `chat.websearch.providers` | `WebSearchProviders` | 内置列表 | 所有 provider 配置（完整对象列表） |

#### WebSearchProvider 类型定义

```typescript
export interface WebSearchProvider {
  id: string
  name: string
  type: 'api' | 'local' | 'mcp'
  apiKey: string
  apiHost: string
  engines: string[]
  usingBrowser: boolean
  basicAuthUsername: string
  basicAuthPassword: string
}

export type WebSearchProviders = WebSearchProvider[]
```

#### 设计理由

采用 **Preference** 而非 DataApi（数据库），原因：

1. **固定列表** - 仅预设 provider，用户不能新增
2. **符合规范** - 根据 Data System 设计规范，provider 配置使用 PreferenceService
3. **避免过度设计** - 数据库引入 schema、migration、handler、service 四层
4. **数据丢失影响低** - API key 可重新配置
5. **UI 易用** - 以列表形式存储，便于排序和按 `id` 更新

#### 数据示例

```typescript
// chat.websearch.providers 存储值（示例）
[
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    apiHost: 'https://api.tavily.com',
    apiKey: 'tvly-xxxxx',
    engines: [],
    usingBrowser: false,
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  {
    id: 'searxng',
    name: 'Searxng',
    type: 'api',
    apiHost: 'https://my-searxng.example.com',
    apiKey: '',
    engines: ['google', 'bing'],
    usingBrowser: false,
    basicAuthUsername: 'admin',
    basicAuthPassword: 'secret'
  },
  {
    id: 'local-google',
    name: 'Google',
    type: 'local',
    apiHost: 'https://www.google.com/search?q=%s',
    apiKey: '',
    engines: [],
    usingBrowser: true,
    basicAuthUsername: '',
    basicAuthPassword: ''
  }
]
```

#### Provider 默认数据

默认 provider 列表位于 `packages/shared/data/preference/preferenceSchemas.ts` 中的
`chat.websearch.providers`。Provider 的站点链接配置保留在
`src/renderer/src/config/webSearch.ts`（`WEB_SEARCH_PROVIDER_WEBSITES`）。

### 基础设置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `chat.websearch.search_with_time` | boolean | `true` | 搜索时添加时间信息 |
| `chat.websearch.max_results` | number | `5` | 最大搜索结果数 |
| `chat.websearch.exclude_domains` | string[] | `[]` | 排除的域名列表 |

### 压缩配置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `chat.websearch.compression.method` | `WebSearchCompressionMethod` | `none` | 压缩方式 |
| `chat.websearch.compression.cutoff_limit` | number \| null | `null` | Cutoff 限制 |
| `chat.websearch.compression.cutoff_unit` | `WebSearchCompressionCutoffUnit` | `char` | Cutoff 单位 |
| `chat.websearch.compression.rag_document_count` | number | `5` | RAG 文档数量 |
| `chat.websearch.compression.rag_embedding_model_id` | string \| null | `null` | Embedding 模型 ID |
| `chat.websearch.compression.rag_embedding_provider_id` | string \| null | `null` | Embedding 提供商 ID |
| `chat.websearch.compression.rag_embedding_dimensions` | number \| null | `null` | Embedding 维度 |
| `chat.websearch.compression.rag_rerank_model_id` | string \| null | `null` | Rerank 模型 ID |
| `chat.websearch.compression.rag_rerank_provider_id` | string \| null | `null` | Rerank 提供商 ID |

#### 设计理由

采用扁平 key，原因：

1. **usePreference 直接读写** - 适配现有 hooks 的逐字段更新方式
2. **避免大对象写入** - 单字段变更不触发整个对象覆盖
3. **状态清晰** - `method` 作为控制字段，UI 只更新相关字段

## 设计原则

1. **Provider 配置列表化** - 以 `WebSearchProviders` 存储完整对象
2. **基础设置扁平化** - `search_with_time`, `max_results`, `exclude_domains`
3. **压缩设置扁平化** - `compression.*` 作为独立 key
4. **模型引用简化** - `*_model_id` + `*_provider_id` + `rag_embedding_dimensions`
