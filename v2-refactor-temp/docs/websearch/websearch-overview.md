# WebSearch V2 架构概览

## 实施计划

### 阶段 1: 数据层迁移 (Redux → Preference/DataApi)

> Service 保持在 Renderer 进程，仅迁移数据源

| 任务 | 说明 |
|------|------|
| Hooks 迁移 | `useWebSearchProviders.ts` 改用 Preference/DataApi |
| UI 组件迁移 | Settings 页面改用 `usePreference` |
| Service 配置读取 | 从 Redux 改为 Preference（Service 仍在 Renderer） |
| **验证点** | 搜索流程完整可用 ✅ |

### 阶段 2: Service 迁移到 Main Process

> 将搜索逻辑从 Renderer 迁移到 Main

| 任务 | 说明 |
|------|------|
| 创建 Main 端 Service | `src/main/services/WebSearchService.ts` |
| 迁移 Provider 实现 | 各搜索供应商实现移到 Main |
| 添加 Search Handler | `POST /websearch/search` 端点 |
| Renderer 改为调用 DataApi | `useMutation('/websearch/search')` |
| **验证点** | 搜索流程通过 DataApi 完整可用 ✅ |

### 阶段 3: 清理

| 任务 | 说明 |
|------|------|
| 删除 Renderer 端旧 Service | `src/renderer/src/services/WebSearchService.ts` |
| 删除 Redux store | `src/renderer/src/store/websearch.ts` |
| 删除旧 Provider 实现 | `src/renderer/src/providers/WebSearchProvider/` |

### 实施原则

1. **增量迁移** - 每阶段有独立验证点，出问题易定位
2. **风险分散** - 数据层和逻辑层分开迁移，可随时暂停
3. **可独立交付** - 阶段 1 完成后即可合并，不阻塞后续工作

---

## 架构设计

### 设计原则

1. **Main Process Centric** - 搜索服务运行在 Main 进程
2. **统一 DataApi** - 所有操作通过 DataApi 暴露，无额外 IPC
3. **配置与数据分离** - 设置用 Preference，业务数据用 DataApi

### 架构图

```
┌─ Renderer ──────────────────────────────────────┐
│ UI                                              │
│  ├─ usePreference('websearch.*')   → 配置      │
│  ├─ useQuery('/websearch-providers') → 供应商   │
│  └─ useMutation('/websearch/search') → 搜索    │
└─────────────────────┬───────────────────────────┘
                      │ DataApi (内部 IPC)
┌─ Main ──────────────┴───────────────────────────┐
│ DataApi Handlers                                │
│  ├─ GET  /websearch-providers                   │
│  ├─ PATCH /websearch-providers/:id              │
│  ├─ POST /websearch-providers/:id/test          │
│  └─ POST /websearch/search          ← 核心搜索  │
│              ↓                                  │
│      WebSearchService                           │
│         ├─ API Providers (Tavily, Exa...)      │
│         ├─ Local Providers (浏览器抓取)        │
│         └─ Compression (RAG/Cutoff)            │
└─────────────────────────────────────────────────┘
```

## 数据系统分类

| 数据类型 | 系统 | 端点/Key |
|----------|------|----------|
| 供应商配置 | DataApi | `/websearch-providers` |
| 搜索设置 | Preference | `websearch.*` |
| 搜索执行 | DataApi | `/websearch/search` |
| 搜索状态 | Cache | `chat.websearch.active_searches` |

## API 端点总览

| Path | Method | Description |
|------|--------|-------------|
| `/websearch-providers` | GET | 列出所有供应商 |
| `/websearch-providers/:id` | GET | 获取单个供应商 |
| `/websearch-providers/:id` | PATCH | 更新供应商配置 |
| `/websearch-providers/:id/test` | POST | 测试供应商连接 |
| `/websearch/search` | POST | 执行搜索 |

## Preference Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `websearch.search_with_time` | boolean | true | 添加时间信息 |
| `websearch.max_results` | number | 5 | 最大结果数 |
| `websearch.exclude_domains` | string[] | [] | 排除域名 |
| `websearch.compression` | object | null | 压缩配置 |

## 与 v1 对比

| 方面 | v1 (Redux) | v2 (DataApi) |
|------|-----------|--------------|
| 状态管理 | Redux store | Preference + DataApi |
| 搜索执行 | Renderer 进程 | Main 进程 |
| 供应商存储 | Redux persist | SQLite |
| 配置存储 | Redux persist | Preference (SQLite) |
| 跨窗口同步 | 手动处理 | 自动 |
| API Server | 需要 IPC 转发 | 直接复用 |

## 文件结构

### Main Process

```
src/main/
├─ services/
│   └─ WebSearchService.ts          # 搜索服务
│   └─ websearch/
│       └─ providers/               # Provider 实现
├─ data/
│   ├─ db/schemas/
│   │   └─ websearchProvider.ts     # 数据库 schema
│   ├─ services/
│   │   └─ WebSearchProviderService.ts  # Provider CRUD
│   └─ api/handlers/
│       ├─ websearch-providers.ts   # Provider handlers
│       └─ websearch.ts             # Search handler
```

### Renderer Process

```
src/renderer/src/
├─ hooks/
│   └─ useWebSearch.ts              # 搜索 hooks
├─ pages/settings/WebSearchSettings/
│   ├─ BasicSettings.tsx            # 基础设置 (usePreference)
│   ├─ BlacklistSettings.tsx        # 排除域名 (usePreference)
│   ├─ CompressionSettings/         # 压缩设置 (usePreference)
│   └─ WebSearchProviderSetting.tsx # 供应商设置 (DataApi)
```

### Shared

```
packages/shared/data/
├─ api/schemas/
│   ├─ websearch-providers.ts       # Provider API schema
│   └─ websearch.ts                 # Search API schema
└─ preference/
    ├─ preferenceTypes.ts           # WebSearchCompressionConfig
    └─ preferenceSchemas.ts         # websearch.* keys
```

## 相关文档

- [WebSearch Data API](./websearch-data-api.md) - 详细 API 设计
- [Preference Overview](../data/preference-overview.md) - Preference 系统
- [DataApi Overview](../data/data-api-overview.md) - DataApi 系统
