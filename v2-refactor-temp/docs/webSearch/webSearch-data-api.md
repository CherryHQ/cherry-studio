# WebSearch 数据迁移设计

> ✅ **迁移状态**: 已完成。Redux store (`store/websearch.ts`) 已删除，所有数据现在使用 Preference API。

## 数据分类概览

| 原 Redux 字段 | v2 系统 | 说明 |
|--------------|---------|------|
| `providers` | **Preference** | `chat.web_search.provider_overrides`（Provider 覆盖，仅存差异） |
| `searchWithTime` | **Preference** | `chat.web_search.search_with_time` |
| `maxResults` | **Preference** | `chat.web_search.max_results` |
| `excludeDomains` | **Preference** | `chat.web_search.exclude_domains` |
| `compressionConfig` | **Preference** | `chat.web_search.compression.*`（扁平 key） |
| `subscribeSources` | ❌ **移除** | 功能弃用，使用率低 |
| `defaultProvider` | ❌ **移除** | 已废弃 |
| `overwrite` | ❌ **移除** | 已废弃 |
| `providerConfig` | ❌ **移除** | 合并到 `chat.web_search.provider_overrides` |

---

# WebSearch Preference 设计

## Preference Keys

### Provider 覆盖配置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `chat.web_search.provider_overrides` | `WebSearchProviderOverrides` | `{}` | Provider 覆盖（仅存与预设不同的字段） |

#### WebSearchProvider 类型定义

```typescript
export interface WebSearchProviderPreset {
  id: string
  name: string
  type: 'api' | 'local' | 'mcp'
  usingBrowser: boolean
  defaultApiHost: string
}

export type WebSearchProviderOverride = Partial<{
  apiKey: string
  apiHost: string
  engines: string[]
  basicAuthUsername: string
  basicAuthPassword: string
}>

export type WebSearchProviderOverrides = Record<string, WebSearchProviderOverride>

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
```

#### 设计理由

采用 **Preference** 而非 DataApi（数据库），原因：

1. **固定列表** - provider 预设保存在 presets，用户不能新增
2. **符合规范** - 分层预设模式：预设 + 覆盖
3. **避免过度设计** - 数据库引入 schema、migration、handler、service 四层
4. **数据丢失影响低** - API key 可重新配置
5. **存储更轻** - 仅存覆盖字段，便于按 `id` 更新

#### 数据示例

```typescript
// chat.web_search.provider_overrides 存储值（示例）
{
  tavily: {
    apiHost: 'https://api.tavily.com',
    apiKey: 'tvly-xxxxx'
  },
  searxng: {
    apiHost: 'https://my-searxng.example.com',
    engines: ['google', 'bing'],
    basicAuthUsername: 'admin',
    basicAuthPassword: 'secret'
  },
  'local-google': {
    apiHost: 'https://www.google.com/search?q=%s'
  }
}
```

#### Provider 默认数据

默认 provider 预设位于 `packages/shared/data/presets/web-search-providers.ts`
（`PRESETS_WEB_SEARCH_PROVIDERS`）。Provider 的覆盖配置存放在
`chat.web_search.provider_overrides`。Provider 的站点链接配置保留在
`src/renderer/src/config/webSearch.ts`（`WEB_SEARCH_PROVIDER_WEBSITES`）。

### 基础设置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `chat.web_search.search_with_time` | boolean | `true` | 搜索时添加时间信息 |
| `chat.web_search.max_results` | number | `5` | 最大搜索结果数 |
| `chat.web_search.exclude_domains` | string[] | `[]` | 排除的域名列表 |

### 压缩配置

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `chat.web_search.compression.method` | `WebSearchCompressionMethod` | `none` | 压缩方式 |
| `chat.web_search.compression.cutoff_limit` | number \| null | `null` | Cutoff 限制 |
| `chat.web_search.compression.cutoff_unit` | `WebSearchCompressionCutoffUnit` | `char` | Cutoff 单位 |
| `chat.web_search.compression.rag_document_count` | number | `5` | RAG 文档数量 |
| `chat.web_search.compression.rag_embedding_model_id` | string \| null | `null` | Embedding 模型 ID |
| `chat.web_search.compression.rag_embedding_provider_id` | string \| null | `null` | Embedding 提供商 ID |
| `chat.web_search.compression.rag_embedding_dimensions` | number \| null | `null` | Embedding 维度 |
| `chat.web_search.compression.rag_rerank_model_id` | string \| null | `null` | Rerank 模型 ID |
| `chat.web_search.compression.rag_rerank_provider_id` | string \| null | `null` | Rerank 提供商 ID |

#### 设计理由

采用扁平 key，原因：

1. **usePreference 直接读写** - 适配现有 hooks 的逐字段更新方式
2. **避免大对象写入** - 单字段变更不触发整个对象覆盖
3. **状态清晰** - `method` 作为控制字段，UI 只更新相关字段

## 设计原则

1. **Provider 覆盖记录化** - 以 `WebSearchProviderOverrides` 存储差异，预设在 presets
2. **基础设置扁平化** - `search_with_time`, `max_results`, `exclude_domains`
3. **压缩设置扁平化** - `compression.*` 作为独立 key
4. **模型引用简化** - `*_model_id` + `*_provider_id` + `rag_embedding_dimensions`
