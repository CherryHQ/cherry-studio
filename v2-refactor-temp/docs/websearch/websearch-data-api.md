# WebSearch 数据迁移设计

## 数据分类概览

| 原 Redux 字段 | v2 系统 | 说明 |
|--------------|---------|------|
| `providers` | **DataApi** | `websearch_provider` 表 |
| `searchWithTime` | **Preference** | `websearch.search_with_time` |
| `maxResults` | **Preference** | `websearch.max_results` |
| `excludeDomains` | **Preference** | `websearch.exclude_domains` |
| `compressionConfig` | **Preference** | `websearch.compression` (聚合对象) |
| `subscribeSources` | ❌ **移除** | 功能弃用，使用率低 |
| `defaultProvider` | ❌ **移除** | 已废弃 |
| `overwrite` | ❌ **移除** | 已废弃 |
| `providerConfig` | ❌ **移除** | 合并到 provider 表字段 |

---

# WebSearch Provider 表设计

## 表结构: `websearch_provider`

存储网络搜索供应商配置。

### 字段定义

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | TEXT | ✅ | - | 主键，如 `'tavily'`, `'searxng'`, `'local-google'` |
| `name` | TEXT | ✅ | - | 显示名称 |
| `type` | TEXT | ✅ | - | 供应商类型：`'api'` \| `'local'` |
| `api_key` | TEXT | - | NULL | API 密钥（API 类型供应商使用） |
| `api_host` | TEXT | - | NULL | API 地址或 URL 模板（含 `%s` 占位符） |
| `engines` | TEXT | - | NULL | JSON 数组：搜索引擎列表（SearxNG 使用） |
| `using_browser` | INTEGER | - | 0 | 是否使用浏览器抓取（0/1） |
| `basic_auth_username` | TEXT | - | NULL | HTTP Basic Auth 用户名（SearxNG 使用） |
| `basic_auth_password` | TEXT | - | NULL | HTTP Basic Auth 密码（SearxNG 使用） |
| `created_at` | INTEGER | ✅ | - | 创建时间戳 |
| `updated_at` | INTEGER | ✅ | - | 更新时间戳 |

### SQL 定义

```sql
CREATE TABLE websearch_provider (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  api_key TEXT,
  api_host TEXT,
  engines TEXT,
  using_browser INTEGER DEFAULT 0,
  basic_auth_username TEXT,
  basic_auth_password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 设计说明

#### `type` 字段说明

| 值 | 说明 | `api_host` 用法 |
|----|------|-----------------|
| `'api'` | API 类供应商 | 作为 API 端点地址 |
| `'local'` | 本地浏览器抓取 | 作为 URL 模板，`%s` 替换为查询词 |


#### 运行时字段（不持久化）

以下字段用于链路追踪，在调用时传入，不存储到数据库：

- `topicId` - 话题 ID
- `parentSpanId` - 父 Span ID
- `modelName` - 模型名称

### 数据示例

```typescript
// API 类型 - Tavily
{
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  api_key: 'tvly-xxxxx',
  api_host: 'https://api.tavily.com',
  engines: null,
  using_browser: 0,
  basic_auth_username: null,
  basic_auth_password: null
}

// API 类型 - SearxNG（带 Basic Auth）
{
  id: 'searxng',
  name: 'Searxng',
  type: 'api',
  api_key: null,
  api_host: 'https://my-searxng.example.com',
  engines: '["google", "bing", "duckduckgo"]',
  using_browser: 0,
  basic_auth_username: 'admin',
  basic_auth_password: 'secret'
}

// Local 类型 - Google
{
  id: 'local-google',
  name: 'Google',
  type: 'local',
  api_key: null,
  api_host: 'https://www.google.com/search?q=%s',
  engines: null,
  using_browser: 1,
  basic_auth_username: null,
  basic_auth_password: null
}
```

---

# WebSearch Preference 设计

## Preference Keys

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

1. **基础设置扁平化** - `search_with_time`, `max_results`, `exclude_domains` 使用扁平 key
2. **复杂配置聚合** - `compression` 作为逻辑单元，使用对象存储
3. **Model 引用模式** - `model_id` + `model_meta`，保留显示信息防止模型删除后丢失
4. **EmbeddingModelMeta** - 扩展 ModelMeta，包含 `dimensions` 属性

---

# WebSearch Provider API Endpoints

## Endpoint List

| Path | Method | Description | Response Status |
|------|--------|-------------|-----------------|
| `/websearch-providers` | GET | List all providers with pagination | 200 |
| `/websearch-providers/:id` | GET | Get single provider by ID | 200 |
| `/websearch-providers/:id` | PATCH | Update provider configuration | 200 |
| `/websearch-providers/:id/test` | POST | Test provider connection | 200 |

## Schema Definition

### Entity Type

```typescript
export type WebSearchProviderType = 'api' | 'local'

export interface WebSearchProvider {
  id: string
  name: string
  type: WebSearchProviderType
  apiKey: string | null
  apiHost: string | null
  engines: string[] | null        // Parsed array (stored as JSON string in DB)
  usingBrowser: boolean           // Converted to boolean (stored as 0/1 in DB)
  basicAuthUsername: string | null
  basicAuthPassword: string | null
  createdAt: number               // Unix timestamp
  updatedAt: number
}
```

### Update DTO

```typescript
export interface UpdateWebSearchProviderDto {
  name?: string
  type?: WebSearchProviderType
  apiKey?: string | null
  apiHost?: string | null
  engines?: string[] | null
  usingBrowser?: boolean
  basicAuthUsername?: string | null
  basicAuthPassword?: string | null
}
```

### Test Response

```typescript
export interface TestProviderResponse {
  success: boolean
  message: string
  latencyMs?: number
}
```

## Data Transformation

| API Field | DB Field | Transformation |
|-----------|----------|----------------|
| `apiKey` | `api_key` | snake_case ↔ camelCase |
| `apiHost` | `api_host` | snake_case ↔ camelCase |
| `engines` | `engines` | string[] ↔ JSON string |
| `usingBrowser` | `using_browser` | boolean ↔ 0/1 |
| `basicAuthUsername` | `basic_auth_username` | snake_case ↔ camelCase |
| `basicAuthPassword` | `basic_auth_password` | snake_case ↔ camelCase |
| `createdAt` | `created_at` | Unix timestamp |
| `updatedAt` | `updated_at` | Unix timestamp |

## File Structure

| File | Description |
|------|-------------|
| `packages/shared/data/api/schemas/websearch-providers.ts` | API Schema definition |
| `src/main/data/db/schemas/websearchProvider.ts` | Drizzle table definition |
| `src/main/data/services/WebSearchProviderService.ts` | Service layer |
| `src/main/data/api/handlers/websearch-providers.ts` | Handler layer |
