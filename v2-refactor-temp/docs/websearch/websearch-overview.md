# WebSearch V2 架构概览

## 实施计划

### 阶段 1: 数据层迁移 (Redux → Preference/DataApi) - 进行中

> Service 保持在 Renderer 进程，仅迁移数据源

| 任务 | 状态 | 说明 |
|------|------|------|
| Hooks 迁移 | ✅ | `useWebSearch.ts` 已完成（DataApi + Preference） |
| UI 组件迁移 (Settings) | ✅ | Settings 页面已改用新 hooks，详见 [UI 迁移文档](./websearch-ui-migration.md) |
| UI 组件迁移 (其他) | ⏳ | 仍依赖旧 hooks 的组件，见下方列表 |
| Service 类型兼容 | ✅ | `WebSearchService.checkSearch` 已适配（使用类型断言） |
| 移除 WebSearchProviderId | ✅ | 已改用 `id: string`，旧类型标记为 `@deprecated` |
| 删除废弃文件 | ⏳ | `AddSubscribePopup.tsx` ✅, `useWebSearchProviders.ts` ⏳ |
| **验证点** | ✅ | `pnpm build:check` 通过 |

**待迁移组件**（仍使用旧 `useWebSearchProviders.ts`）：

| 文件 | 使用的 Hook | 迁移状态 |
|------|------------|----------|
| `pages/settings/WebSearchSettings/CompressionSettings/RagSettings.tsx` | `useWebSearchSettings` | ⏳ 类型结构不同 |
| `components/Popups/ApiKeyListPopup/list.tsx` | `useWebSearchProvider` | ⏳ 类型不兼容 |

**已迁移组件**：

| 文件 | 原 Hook | 新 Hook |
|------|---------|---------|
| `pages/settings/WebSearchSettings/CompressionSettings/index.tsx` | `useWebSearchSettings` | ✅ `useWebSearch` |
| `pages/settings/WebSearchSettings/CompressionSettings/CutoffSettings.tsx` | `useWebSearchSettings` | ✅ `useWebSearch` |
| `pages/home/Inputbar/tools/components/WebSearchQuickPanelManager.tsx` | `useWebSearchProviders` | ✅ `useWebSearch` |

**类型迁移说明**：

`WebSearchProviderId` 类型已从代码中移除，改用 `id: string`。以下导出标记为 `@deprecated`，仅为 ApiKeyListPopup 保持向后兼容：

```typescript
// @deprecated - 仅为向后兼容保留
export const WebSearchProviderIds = { ... } as const
export type WebSearchProviderId = keyof typeof WebSearchProviderIds
export const isWebSearchProviderId = (id: string): id is WebSearchProviderId => { ... }
```

待 ApiKeyListPopup 迁移完成后可彻底删除。

### 阶段 2: 清理

| 任务 | 说明 |
|------|------|
| 删除 Redux store | `src/renderer/src/store/websearch.ts` |
| 删除旧 hooks | `src/renderer/src/hooks/useWebSearchProviders.ts` |
| 删除废弃 UI 组件 | `src/renderer/src/pages/settings/WebSearchSettings/AddSubscribePopup.tsx` |
| 删除废弃类型 | `WebSearchProviderIds`, `WebSearchProviderId`, `isWebSearchProviderId` (待 ApiKeyListPopup 迁移后) |

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
│  └─ usePreference('websearch.*')   → 配置      │
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
| 供应商配置 | Preference | `websearch.providers` |
| 搜索设置 | Preference | `websearch.*` |
| 搜索状态 | Cache | `chat.websearch.active_searches` |

## Preference Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `websearch.search_with_time` | boolean | true | 添加时间信息 |
| `websearch.max_results` | number | 5 | 最大结果数 |
| `websearch.exclude_domains` | string[] | [] | 排除域名 |
| `websearch.compression` | object | null | 压缩配置 |

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
    ├─ preferenceTypes.ts           # WebSearchCompressionConfig, WebSearchProviderConfigs
    └─ preferenceSchemas.ts         # websearch.* keys
```

## 相关文档

- [WebSearch UI 迁移](./websearch-ui-migration.md) - UI 组件迁移详情
- [WebSearch Data API](./websearch-data-api.md) - Preference 设计详情
- [Preference Overview](../data/preference-overview.md) - Preference 系统
