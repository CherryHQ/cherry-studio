# WebSearch Service 迁移计划

将 WebSearch Service 从 Renderer 进程迁移到 `src/main/services/webSearch` 目录。

## 目标

将搜索执行逻辑从 Renderer 进程迁移到 Main 进程，实现：
1. 搜索逻辑在 Main 进程运行
2. 通过 DataApi 暴露 `POST /websearch/search` 端点
3. Provider 实现移至 Main 进程
4. 完善连接测试功能

---

## 目录结构

```
src/main/services/webSearch/
├── index.ts                        # 服务导出
├── WebSearchService.ts             # 主编排服务 (singleton)
├── WebSearchExecutor.ts            # 搜索执行逻辑
├── WebSearchCompressor.ts          # 压缩策略 (RAG, cutoff)
├── types.ts                        # 服务内部类型
├── utils/
│   └── contentFetcher.ts           # 网页内容抓取工具
└── providers/
    ├── index.ts                    # Provider 工厂导出
    ├── BaseWebSearchProvider.ts    # 抽象基类
    ├── WebSearchProviderFactory.ts # 工厂模式
    ├── DefaultProvider.ts          # 默认 Provider
    ├── api/                        # API 类 Provider
    │   ├── TavilyProvider.ts
    │   ├── ZhipuProvider.ts
    │   ├── BochaProvider.ts
    │   ├── SearxngProvider.ts
    │   ├── ExaProvider.ts
    │   └── ExaMcpProvider.ts
    └── local/                      # 浏览器抓取类 Provider
        ├── LocalSearchProvider.ts  # Local 基类
        ├── LocalGoogleProvider.ts
        ├── LocalBingProvider.ts
        └── LocalBaiduProvider.ts
```

---

## 实施步骤

### 第一步：创建基础架构

1. **创建目录结构**
   - 创建 `src/main/services/webSearch/` 目录及子目录

2. **创建类型定义** (`types.ts`)
   - 定义服务内部类型
   - 定义 `WebSearchSettings` 接口

3. **创建基础 Provider 类** (`providers/BaseWebSearchProvider.ts`)
   - 从 Renderer 版本迁移，适配 Main 进程
   - 使用 `node-fetch` 或 Electron 的 `net` 模块
   - 移除 `cacheService` 依赖，使用服务内部状态管理 API Key 轮询

4. **创建 Provider 工厂** (`providers/WebSearchProviderFactory.ts`)
   - 从 Renderer 版本迁移

### 第二步：迁移 API Provider

按以下顺序迁移 `src/renderer/src/providers/WebSearchProvider/` 中的 API Provider：

| Provider | 文件 | 依赖 |
|----------|------|------|
| TavilyProvider | `api/TavilyProvider.ts` | `@agentic/tavily` |
| ZhipuProvider | `api/ZhipuProvider.ts` | 自定义 HTTP |
| BochaProvider | `api/BochaProvider.ts` | 自定义 HTTP |
| SearxngProvider | `api/SearxngProvider.ts` | 自定义 HTTP |
| ExaProvider | `api/ExaProvider.ts` | `exa-js` |
| ExaMcpProvider | `api/ExaMcpProvider.ts` | MCP 工具调用 |
| DefaultProvider | `DefaultProvider.ts` | 自定义 HTTP |

**迁移要点**：
- 替换 `window.fetch` 为 Node.js 的 `fetch` 或 `net.fetch`
- 替换 `WebSearchState` 类型为 `WebSearchSettings`
- 使用 `loggerService.withContext()` 记录日志

### 第三步：迁移 Local Provider

1. **创建内容抓取工具** (`utils/contentFetcher.ts`)
   - 使用 `@mozilla/readability` + `jsdom` 解析 HTML
   - 使用 `turndown` 转换为 Markdown
   - 支持 abort signal

2. **迁移 LocalSearchProvider 基类** (`providers/local/LocalSearchProvider.ts`)
   - 使用现有 `SearchService` 管理浏览器窗口
   - 适配 Main 进程环境

3. **迁移具体 Local Provider**
   - `LocalGoogleProvider.ts`
   - `LocalBingProvider.ts`
   - `LocalBaiduProvider.ts`

### 第四步：创建编排服务

1. **创建 WebSearchExecutor** (`WebSearchExecutor.ts`)
   ```typescript
   class WebSearchExecutor {
     async execute(
       provider: WebSearchProvider,
       questions: string[],
       settings: WebSearchSettings,
       signal?: AbortSignal
     ): Promise<WebSearchResult[]>
   }
   ```

2. **创建 WebSearchCompressor** (`WebSearchCompressor.ts`)
   ```typescript
   class WebSearchCompressor {
     async compress(
       questions: string[],
       results: WebSearchResult[],
       config: WebSearchCompressionConfig,
       requestId: string
     ): Promise<WebSearchResult[]>
   }
   ```
   - RAG 压缩：使用现有 `KnowledgeService`
   - Cutoff 压缩：使用 `tokenx` 库

3. **创建 WebSearchService** (`WebSearchService.ts`)
   ```typescript
   class WebSearchService {
     private static instance: WebSearchService
     private abortControllers: Map<string, AbortController>

     static getInstance(): WebSearchService
     createAbortController(requestId: string): AbortController
     abort(requestId: string): void
     async processSearch(request: WebSearchRequestDto): Promise<WebSearchResponseDto>
   }
   ```

### 第五步：创建 API Schema 和 Handler

1. **创建 API Schema** (`packages/shared/data/api/schemas/websearch.ts`)
   ```typescript
   export interface WebSearchRequestDto {
     providerId: string
     questions: string[]
     links?: string[]
     requestId: string
     tracing?: {
       topicId?: string
       parentSpanId?: string
       modelName?: string
     }
   }

   export interface WebSearchResponseDto {
     query?: string
     results: WebSearchResult[]
   }

   export interface WebSearchSchemas {
     '/websearch/search': {
       POST: { body: WebSearchRequestDto; response: WebSearchResponseDto }
     }
     '/websearch/abort': {
       POST: { body: { requestId: string }; response: void }
     }
   }
   ```

2. **更新 Schema Index** (`packages/shared/data/api/schemas/index.ts`)
   - 添加 `WebSearchSchemas` 到 `ApiSchemas`

3. **创建 Handler** (`src/main/data/api/handlers/websearch.ts`)
   - 实现 `/websearch/search` POST handler
   - 实现 `/websearch/abort` POST handler
   - 从 Preference 读取搜索配置
   - 调用 `WebSearchService.processSearch()`

4. **注册 Handler** (`src/main/data/api/handlers/index.ts`)
   - 添加 `websearchHandlers`

### 第六步：Renderer 集成

1. **添加搜索 Hook** (`src/renderer/src/hooks/useWebSearch.ts`)
   ```typescript
   export function useWebSearchExecution() {
     const { trigger, isLoading, error } = useMutation('POST', '/websearch/search')

     const search = async (request: WebSearchRequestDto) => {
       return trigger({ body: request })
     }

     const abort = async (requestId: string) => {
       await dataApi.post('/websearch/abort', { requestId })
     }

     return { search, abort, isLoading, error }
   }
   ```

2. **更新调用点**
   - 修改使用 `WebSearchService` 的代码改为调用新 Hook

### 第七步：清理

待迁移完成并验证后：

| 删除文件 | 原因 |
|----------|------|
| `src/renderer/src/services/WebSearchService.ts` | 迁移到 Main |
| `src/renderer/src/providers/WebSearchProvider/` | 整个目录迁移到 Main |
| `src/renderer/src/store/websearch.ts` | Redux 废弃 |
| `src/renderer/src/hooks/useWebSearchProviders.ts` | 被 useWebSearch.ts 替代 |

---

## 关键实现细节

### 1. Abort Signal 跨进程处理

```
Renderer                          Main
   │                                │
   ├─ POST /websearch/search ──────►├─ createAbortController(requestId)
   │  { requestId: 'xxx' }          │
   │                                ├─ processSearch() 开始执行
   │                                │
   ├─ POST /websearch/abort ───────►├─ abort(requestId)
   │  { requestId: 'xxx' }          │  └─ controller.abort()
   │                                │
   │◄─ 搜索被中断，返回 ────────────┤
```

### 2. RAG 压缩集成

使用现有 `KnowledgeService` (`src/main/services/KnowledgeService.ts`)：
1. 创建临时知识库 `websearch-compression-{requestId}`
2. 添加搜索结果到知识库
3. 执行语义搜索
4. 在 `finally` 中删除临时知识库

### 3. Local Provider 与 SearchService 集成

Local Provider 使用现有 `SearchService` (`src/main/services/SearchService.ts`)：
```typescript
const html = await searchService.openUrlInSearchWindow(uid, url)
// 解析 HTML 提取搜索结果
await searchService.closeSearchWindow(uid)
```

---

## 修改的文件

| 文件 | 操作 |
|------|------|
| `packages/shared/data/api/schemas/websearch.ts` | 新建 |
| `packages/shared/data/api/schemas/index.ts` | 修改 - 添加 WebSearchSchemas |
| `src/main/services/webSearch/**` | 新建 - 整个目录 |
| `src/main/data/api/handlers/websearch.ts` | 新建 |
| `src/main/data/api/handlers/index.ts` | 修改 - 注册 handler |
| `src/renderer/src/hooks/useWebSearch.ts` | 修改 - 添加 search hook |

---

## 验证计划

1. **单元测试**
   - Provider 测试：模拟 API 响应
   - Compressor 测试：验证压缩逻辑
   - Service 测试：验证编排流程

2. **集成测试**
   - 通过 DataApi 执行完整搜索流程
   - 验证 abort 功能
   - 验证压缩配置生效

3. **手动验证**
   - 在 Chat 中触发网络搜索
   - 验证不同 Provider 工作正常
   - 验证搜索结果显示正确
   - 运行 `pnpm build:check`

---

## 依赖项

确保以下包在 Main 进程可用：
- `@agentic/tavily` - Tavily API 客户端
- `exa-js` - Exa API 客户端
- `jsdom` - HTML 解析 (Local Provider)
- `@mozilla/readability` - 内容提取
- `turndown` - HTML to Markdown
- `tokenx` - Token 计数 (cutoff 压缩)
