# WebSearch V2 架构概览

## 实施计划

### 阶段 1: 数据层迁移 (Redux → Preference) ✅ 已完成

> Service 保持在 Renderer 进程，仅迁移数据源

| 任务 | 状态 | 说明 |
|------|------|------|
| Hooks 迁移 | ✅ | `useWebSearch.ts` 已完成（Preference） |
| UI 组件迁移 (Settings) | ✅ | Settings 页面已改用新 hooks，详见 [UI 迁移文档](./websearch-ui-migration.md) |
| UI 组件迁移 (其他) | ✅ | 所有组件已迁移 |
| Service 类型兼容 | ✅ | `WebSearchService` 已统一使用共享 Preference 类型 |
| 移除 WebSearchProviderId | ✅ | 已改用 `id: string`，旧类型标记为 `@deprecated` |
| 删除废弃文件 | ✅ | `AddSubscribePopup.tsx` ✅, `useWebSearchProviders.ts` ✅ |
| **验证点** | ✅ | `pnpm build:check` 通过 |

**已迁移组件**：

| 文件 | 原 Hook | 新 Hook |
|------|---------|---------|
| `pages/settings/WebSearchSettings/CompressionSettings/index.tsx` | `useWebSearchSettings` | ✅ `useWebSearch` |
| `pages/settings/WebSearchSettings/CompressionSettings/CutoffSettings.tsx` | `useWebSearchSettings` | ✅ `useWebSearch` |
| `pages/settings/WebSearchSettings/CompressionSettings/RagSettings.tsx` | `useWebSearchSettings` | ✅ `useWebSearch` |
| `pages/home/Inputbar/tools/components/WebSearchQuickPanelManager.tsx` | `useWebSearchProviders` | ✅ `useWebSearch` |
| `components/Popups/ApiKeyListPopup/list.tsx` | `useWebSearchProvider` | ✅ `useWebSearch` |
| `pages/settings/ProviderSettings/ProviderSetting.tsx` | Redux `updateWebSearchProvider` | ✅ `useWebSearchProviders` |
| `aiCore/prepareParams/parameterBuilder.ts` | Redux `store.getState()` | ✅ `preferenceService` |

**类型迁移说明**：

- `WebSearchProviderId` 类型已从代码中移除，改用 `id: string`
- `CherryWebSearchConfig` 已迁移至 `types/webSearch.ts` 中的 `WebSearchConfig`

### 阶段 2: 清理 ✅ 已完成

| 任务 | 状态 | 说明 |
|------|------|------|
| 删除 Redux store | ✅ | `src/renderer/src/store/websearch.ts` 已删除 |
| 从 store/index.ts 移除 reducer | ✅ | `websearch` reducer 已从 rootReducer 移除 |
| 删除 migrate.ts 中 websearch 逻辑 | ✅ | 所有 `state.websearch` 相关迁移代码已删除 |
| 删除旧 hooks | ✅ | `src/renderer/src/hooks/useWebSearchProviders.ts` |
| 删除废弃 UI 组件 | ✅ | `src/renderer/src/pages/settings/WebSearchSettings/AddSubscribePopup.tsx` |
| 删除废弃类型 | ✅ | `WebSearchProviderIds`, `WebSearchProviderId`, `isWebSearchProviderId` (标记为 @deprecated) |

### 实施原则

1. **增量迁移** - 每阶段有独立验证点，出问题易定位
2. **保持简单** - Service 保留在 Renderer 进程，仅迁移数据存储

---

## 架构设计

### 设计原则

1. **Renderer Process** - 搜索服务保留在 Renderer 进程
2. **配置统一存储** - 所有配置使用 Preference，无数据库
3. **简化架构** - 移除不必要的 IPC 和 DataApi 层

### 架构图

```
┌─ Renderer ──────────────────────────────────────┐
│ UI                                              │
│  └─ usePreference('chat.web_search.*') → 配置   │
│                                                 │
│ Service                                         │
│  └─ WebSearchService                            │
│         ├─ API Providers (Tavily, Exa...)      │
│         ├─ Local Providers (浏览器抓取)        │
│         └─ Compression (RAG/Cutoff)            │
└─────────────────────────────────────────────────┘
```

## 数据系统分类

| 数据类型 | 系统 | Key |
|----------|------|-----|
| 供应商配置 | Preference | `chat.web_search.provider_overrides` |
| 搜索设置 | Preference | `chat.web_search.*` |
| 搜索状态 | Cache | `chat.web_search.active_searches` |

## Preference Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `chat.web_search.search_with_time` | boolean | true | 添加时间信息 |
| `chat.web_search.max_results` | number | 5 | 最大结果数 |
| `chat.web_search.exclude_domains` | string[] | [] | 排除域名 |
| `chat.web_search.compression.method` | `WebSearchCompressionMethod` | `none` | 压缩方式 |
| `chat.web_search.compression.cutoff_limit` | number \| null | null | 截断限制 |
| `chat.web_search.compression.cutoff_unit` | `WebSearchCompressionCutoffUnit` | `char` | 截断单位 |
| `chat.web_search.compression.rag_document_count` | number | 1 | RAG 文档数量 |
| `chat.web_search.compression.rag_embedding_model_id` | string \| null | null | Embedding 模型 ID |
| `chat.web_search.compression.rag_embedding_provider_id` | string \| null | null | Embedding 提供商 ID |
| `chat.web_search.compression.rag_embedding_dimensions` | number \| null | null | Embedding 维度 |
| `chat.web_search.compression.rag_rerank_model_id` | string \| null | null | Rerank 模型 ID |
| `chat.web_search.compression.rag_rerank_provider_id` | string \| null | null | Rerank 提供商 ID |

## 与 v1 对比

| 方面 | v1 (Redux) | v2 (Preference) |
|------|-----------|-----------------|
| 状态管理 | Redux store | Preference |
| 搜索执行 | Renderer 进程 | Renderer 进程 |
| 供应商存储 | Redux persist | Preference (SQLite) |
| 配置存储 | Redux persist | Preference (SQLite) |
| 跨窗口同步 | 手动处理 | 自动 |

## 文件结构

### Renderer Process

```
src/renderer/src/
├─ hooks/
│   └─ useWebSearch.ts              # 搜索 hooks（providers/settings）
├─ services/
│   └─ WebSearchService.ts          # 搜索服务
├─ providers/WebSearchProvider/     # Provider 实现
└─ pages/settings/WebSearchSettings/
    ├─ BasicSettings.tsx            # 基础设置 (usePreference)
    ├─ BlacklistSettings.tsx        # 排除域名 (usePreference)
    ├─ CompressionSettings/         # 压缩设置 (usePreference)
    └─ WebSearchProviderSetting.tsx # 供应商设置 (usePreference)
```

### Shared

```
packages/shared/data/
└─ preference/
    ├─ preferenceTypes.ts           # WebSearchProvider, WebSearchProviderOverrides, WebSearchCompression*
    └─ preferenceSchemas.ts         # chat.web_search.* keys & defaults
```

## 相关文档

- [WebSearch UI 迁移](./websearch-ui-migration.md) - UI 组件迁移详情
- [WebSearch Data API](./websearch-data-api.md) - Preference 设计详情
- [Preference Overview](../data/preference-overview.md) - Preference 系统
