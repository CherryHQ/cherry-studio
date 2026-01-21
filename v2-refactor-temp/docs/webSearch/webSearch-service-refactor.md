# WebSearchService 重构方案 (SOLID 架构)

## 概述

遵循 SOLID 原则重构 WebSearchService，将其分解为职责单一、易于扩展和维护的模块。

## SOLID 原则应用

| 原则 | 应用方式 |
|------|----------|
| **S - 单一职责** | 每个类只有一个变更原因：压缩策略、状态管理、状态追踪各自独立 |
| **O - 开闭原则** | 通过 `registerStrategy()` 添加新压缩方法，无需修改现有代码 |
| **L - 里氏替换** | 所有 `ICompressionStrategy` 实现可互换使用 |
| **I - 接口隔离** | 小而专注的接口：`ICompressionStrategy`、`IRequestStateManager`、`ISearchStatusTracker` |
| **D - 依赖倒置** | `WebSearchOrchestrator` 依赖接口而非具体实现，通过构造函数注入依赖 |

## 目标文件结构

```
src/renderer/src/services/webSearch/
├── index.ts                          # 公共 API 导出
├── WebSearchService.ts               # 向后兼容的门面 (Facade)
├── WebSearchOrchestrator.ts          # 核心协调逻辑
├── RequestStateManager.ts            # 请求状态管理
├── SearchStatusTracker.ts            # 搜索状态追踪
├── interfaces/
│   ├── index.ts                      # 接口导出
│   ├── ICompressionStrategy.ts       # 压缩策略接口
│   ├── IRequestStateManager.ts       # 状态管理接口
│   └── ISearchStatusTracker.ts       # 状态追踪接口
├── compression/
│   ├── index.ts                      # 压缩模块导出 + 工厂
│   ├── CutoffCompressionStrategy.ts  # 截断压缩
│   ├── RagCompressionStrategy.ts     # RAG 压缩
│   └── NullCompressionStrategy.ts    # 无压缩 (默认)
└── providers/
    ├── index.ts                      # Provider 导出
    ├── BaseWebSearchProvider.ts      # 抽象基类
    ├── WebSearchProviderFactory.ts   # 工厂模式
    ├── WebSearchEngineProvider.ts    # 引擎包装器 (原 index.ts)
    ├── LocalSearchProvider.ts        # 本地搜索基类
    ├── TavilyProvider.ts
    ├── ExaProvider.ts
    ├── ExaMcpProvider.ts
    ├── SearxngProvider.ts
    ├── BochaProvider.ts
    ├── ZhipuProvider.ts
    ├── LocalGoogleProvider.ts
    ├── LocalBingProvider.ts
    ├── LocalBaiduProvider.ts
    └── DefaultProvider.ts
```

## 核心接口设计

### ICompressionStrategy (压缩策略接口)

```typescript
// src/renderer/src/services/webSearch/interfaces/ICompressionStrategy.ts

import type { WebSearchProviderResult } from '@renderer/types'

export interface CompressionContext {
  questions: string[]
  requestId: string
}

export interface ICompressionStrategy {
  readonly name: string
  compress(
    results: WebSearchProviderResult[],
    context: CompressionContext
  ): Promise<WebSearchProviderResult[]>
}
```

### IRequestStateManager (请求状态管理接口)

```typescript
// src/renderer/src/services/webSearch/interfaces/IRequestStateManager.ts

export interface RequestState {
  signal: AbortSignal | null
  isPaused: boolean
  createdAt: number
}

export interface IRequestStateManager {
  getRequestState(requestId: string): RequestState
  createAbortSignal(requestId: string): AbortController
  clearRequestState(requestId: string): void

  // Legacy compatibility
  readonly isPaused: boolean
  getSignal(): AbortSignal | null
}
```

### ISearchStatusTracker (搜索状态追踪接口)

```typescript
// src/renderer/src/services/webSearch/interfaces/ISearchStatusTracker.ts

import type { WebSearchStatus } from '@renderer/types'

export interface ISearchStatusTracker {
  setStatus(requestId: string, status: WebSearchStatus, delayMs?: number): Promise<void>
  clearStatus(requestId: string): void
}
```

## 依赖关系图

```
                    ┌─────────────────────────────┐
                    │     WebSearchService        │  ← 向后兼容门面
                    │   (Singleton export)        │
                    └─────────────┬───────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │   WebSearchOrchestrator     │  ← 核心协调逻辑
                    └──┬──────┬──────┬──────┬────┘
                       │      │      │      │
          ┌────────────┘      │      │      └────────────┐
          ▼                   ▼      ▼                   ▼
┌─────────────────┐  ┌──────────────┐  ┌─────────────────────────┐
│ RequestState    │  │ SearchStatus │  │ CompressionStrategy     │
│ Manager         │  │ Tracker      │  │ Factory                 │
└─────────────────┘  └──────────────┘  └───────────┬─────────────┘
                                                    │
                           ┌────────────────────────┼────────────────────┐
                           ▼                        ▼                    ▼
                 ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
                 │ Cutoff          │   │ RAG             │   │ Null            │
                 │ Strategy        │   │ Strategy        │   │ Strategy        │
                 └─────────────────┘   └─────────────────┘   └─────────────────┘
```

## 类实现详解

### 1. CompressionStrategyFactory (压缩策略工厂)

```typescript
// src/renderer/src/services/webSearch/compression/index.ts

import { preferenceService } from '@data/PreferenceService'

import type { ICompressionStrategy } from '../interfaces'
import { CutoffCompressionStrategy } from './CutoffCompressionStrategy'
import { NullCompressionStrategy } from './NullCompressionStrategy'
import { RagCompressionStrategy } from './RagCompressionStrategy'

export class CompressionStrategyFactory {
  private strategies: Map<string, ICompressionStrategy>

  constructor() {
    this.strategies = new Map([
      ['cutoff', new CutoffCompressionStrategy()],
      ['rag', new RagCompressionStrategy()],
      ['none', new NullCompressionStrategy()]
    ])
  }

  async getStrategy(): Promise<ICompressionStrategy> {
    const method = await preferenceService.get('chat.websearch.compression.method')
    return this.strategies.get(method || 'none') ?? this.strategies.get('none')!
  }

  // 开闭原则：支持注册新策略
  registerStrategy(name: string, strategy: ICompressionStrategy): void {
    this.strategies.set(name, strategy)
  }
}

export { CutoffCompressionStrategy } from './CutoffCompressionStrategy'
export { NullCompressionStrategy } from './NullCompressionStrategy'
export { RagCompressionStrategy } from './RagCompressionStrategy'
```

### 2. CutoffCompressionStrategy (截断压缩策略)

```typescript
// src/renderer/src/services/webSearch/compression/CutoffCompressionStrategy.ts

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type { WebSearchProviderResult } from '@renderer/types'
import { sliceByTokens } from 'tokenx'

import type { CompressionContext, ICompressionStrategy } from '../interfaces'

const logger = loggerService.withContext('CutoffCompressionStrategy')

export class CutoffCompressionStrategy implements ICompressionStrategy {
  readonly name = 'cutoff'

  async compress(
    results: WebSearchProviderResult[],
    _context: CompressionContext
  ): Promise<WebSearchProviderResult[]> {
    const cutoffLimit = await preferenceService.get('chat.websearch.compression.cutoff_limit')
    const cutoffUnit = await preferenceService.get('chat.websearch.compression.cutoff_unit')

    if (!cutoffLimit) {
      logger.warn('Cutoff limit is not set, skipping compression')
      return results
    }

    const perResultLimit = Math.max(1, Math.floor(cutoffLimit / results.length))

    return results.map((result) => {
      if (cutoffUnit === 'token') {
        const slicedContent = sliceByTokens(result.content, 0, perResultLimit)
        return {
          ...result,
          content: slicedContent.length < result.content.length ? slicedContent + '...' : slicedContent
        }
      } else {
        return {
          ...result,
          content:
            result.content.length > perResultLimit ? result.content.slice(0, perResultLimit) + '...' : result.content
        }
      }
    })
  }
}
```

### 3. RagCompressionStrategy (RAG 压缩策略)

```typescript
// src/renderer/src/services/webSearch/compression/RagCompressionStrategy.ts

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { getModel } from '@renderer/hooks/useModel'
import { getKnowledgeBaseParams, getKnowledgeSourceUrl, searchKnowledgeBase } from '@renderer/services/KnowledgeService'
import type { KnowledgeBase, KnowledgeItem, KnowledgeReference, Model, WebSearchProviderResult } from '@renderer/types'
import { removeSpecialCharactersForFileName, uuid } from '@renderer/utils'
import { consolidateReferencesByUrl, selectReferences } from '@renderer/utils/websearch'

import type { CompressionContext, ICompressionStrategy } from '../interfaces'

const logger = loggerService.withContext('RagCompressionStrategy')

export class RagCompressionStrategy implements ICompressionStrategy {
  readonly name = 'rag'

  async compress(
    results: WebSearchProviderResult[],
    context: CompressionContext
  ): Promise<WebSearchProviderResult[]> {
    const { questions, requestId } = context

    // 获取 RAG 配置
    const [embeddingModelId, embeddingProviderId, embeddingDimensions, documentCount, rerankModelId, rerankProviderId] =
      await Promise.all([
        preferenceService.get('chat.websearch.compression.rag_embedding_model_id'),
        preferenceService.get('chat.websearch.compression.rag_embedding_provider_id'),
        preferenceService.get('chat.websearch.compression.rag_embedding_dimensions'),
        preferenceService.get('chat.websearch.compression.rag_document_count'),
        preferenceService.get('chat.websearch.compression.rag_rerank_model_id'),
        preferenceService.get('chat.websearch.compression.rag_rerank_provider_id')
      ])

    const embeddingModel =
      embeddingModelId && embeddingProviderId ? getModel(embeddingModelId, embeddingProviderId) : undefined
    const rerankModel = rerankModelId && rerankProviderId ? getModel(rerankModelId, rerankProviderId) : undefined

    if (!embeddingModel) {
      throw new Error('Embedding model is required for RAG compression')
    }

    const totalDocumentCount = Math.max(0, results.length) * (documentCount ?? DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT)
    const searchBase = await this.ensureSearchBase(
      embeddingModel,
      embeddingDimensions,
      rerankModel,
      totalDocumentCount,
      requestId
    )

    try {
      // 1. 重置知识库
      const baseParams = getKnowledgeBaseParams(searchBase)
      await window.api.knowledgeBase.reset(baseParams)

      // 2. 添加搜索结果到知识库
      for (const result of results) {
        const item: KnowledgeItem & { sourceUrl?: string } = {
          id: uuid(),
          type: 'note',
          content: result.content,
          sourceUrl: result.url,
          created_at: Date.now(),
          updated_at: Date.now(),
          processingStatus: 'pending'
        }
        await window.api.knowledgeBase.add({ base: getKnowledgeBaseParams(searchBase), item })
      }

      // 3. 查询知识库
      const references = await this.querySearchBase(questions, searchBase)

      // 4. 选择引用
      const selectedReferences = selectReferences(results, references, totalDocumentCount)

      logger.verbose('With RAG, the number of search results:', {
        raw: results.length,
        retrieved: references.length,
        selected: selectedReferences.length
      })

      // 5. 合并结果
      return consolidateReferencesByUrl(results, selectedReferences)
    } finally {
      await this.cleanupSearchBase(searchBase)
    }
  }

  private async ensureSearchBase(
    embeddingModel: Model,
    embeddingDimensions: number | null | undefined,
    rerankModel: Model | undefined,
    documentCount: number,
    requestId: string
  ): Promise<KnowledgeBase> {
    const baseId = `websearch-compression-${requestId}`
    const searchBase: KnowledgeBase = {
      id: baseId,
      name: `WebSearch-RAG-${requestId}`,
      model: embeddingModel,
      rerankModel: rerankModel,
      dimensions: embeddingDimensions ?? undefined,
      documentCount,
      items: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      version: 1
    }

    const baseParams = getKnowledgeBaseParams(searchBase)
    await window.api.knowledgeBase.create(baseParams)
    return searchBase
  }

  private async cleanupSearchBase(searchBase: KnowledgeBase): Promise<void> {
    try {
      await window.api.knowledgeBase.delete(removeSpecialCharactersForFileName(searchBase.id))
      logger.debug(`Cleaned up search base: ${searchBase.id}`)
    } catch (error) {
      logger.warn(`Failed to cleanup search base ${searchBase.id}:`, error as Error)
    }
  }

  private async querySearchBase(questions: string[], searchBase: KnowledgeBase): Promise<KnowledgeReference[]> {
    const searchPromises = questions.map((question) => searchKnowledgeBase(question, searchBase))
    const allResults = await Promise.all(searchPromises)
    const flatResults = allResults.flat().sort((a, b) => b.score - a.score)

    logger.debug(`Found ${flatResults.length} result(s) in search base related to question(s): `, questions)

    const seen = new Set<string>()
    const uniqueResults = flatResults.filter((item) => {
      if (seen.has(item.pageContent)) return false
      seen.add(item.pageContent)
      return true
    })

    logger.debug(`Found ${uniqueResults.length} unique result(s) from search base after sorting and deduplication`)

    return await Promise.all(
      uniqueResults.map(async (result, index) => ({
        id: index + 1,
        content: result.pageContent,
        sourceUrl: await getKnowledgeSourceUrl(result),
        type: 'url' as const
      }))
    )
  }
}
```

### 4. NullCompressionStrategy (无压缩策略)

```typescript
// src/renderer/src/services/webSearch/compression/NullCompressionStrategy.ts

import type { WebSearchProviderResult } from '@renderer/types'

import type { CompressionContext, ICompressionStrategy } from '../interfaces'

export class NullCompressionStrategy implements ICompressionStrategy {
  readonly name = 'none'

  async compress(
    results: WebSearchProviderResult[],
    _context: CompressionContext
  ): Promise<WebSearchProviderResult[]> {
    return results
  }
}
```

### 5. RequestStateManager (请求状态管理器)

```typescript
// src/renderer/src/services/webSearch/RequestStateManager.ts

import { addAbortController } from '@renderer/utils/abortController'

import type { IRequestStateManager, RequestState } from './interfaces'

export class RequestStateManager implements IRequestStateManager {
  private requestStates = new Map<string, RequestState>()
  private signal: AbortSignal | null = null
  isPaused = false

  getRequestState(requestId: string): RequestState {
    let state = this.requestStates.get(requestId)
    if (!state) {
      state = { signal: null, isPaused: false, createdAt: Date.now() }
      this.requestStates.set(requestId, state)
    }
    return state
  }

  createAbortSignal(requestId: string): AbortController {
    const controller = new AbortController()
    this.signal = controller.signal

    const state = this.getRequestState(requestId)
    state.signal = controller.signal

    addAbortController(requestId, () => {
      this.isPaused = true
      state.isPaused = true
      this.signal = null
      this.requestStates.delete(requestId)
      controller.abort()
    })

    return controller
  }

  clearRequestState(requestId: string): void {
    this.requestStates.delete(requestId)
  }

  getSignal(): AbortSignal | null {
    return this.signal
  }
}
```

### 6. SearchStatusTracker (搜索状态追踪器)

```typescript
// src/renderer/src/services/webSearch/SearchStatusTracker.ts

import { cacheService } from '@data/CacheService'
import type { WebSearchStatus } from '@renderer/types'

import type { ISearchStatusTracker } from './interfaces'

export class SearchStatusTracker implements ISearchStatusTracker {
  async setStatus(requestId: string, status: WebSearchStatus, delayMs?: number): Promise<void> {
    const activeSearches = cacheService.get('chat.websearch.active_searches') ?? {}
    activeSearches[requestId] = status
    cacheService.set('chat.websearch.active_searches', activeSearches)

    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  clearStatus(requestId: string): void {
    const activeSearches = cacheService.get('chat.websearch.active_searches') ?? {}
    delete activeSearches[requestId]
    cacheService.set('chat.websearch.active_searches', activeSearches)
  }
}
```

### 7. WebSearchOrchestrator (核心协调器)

```typescript
// src/renderer/src/services/webSearch/WebSearchOrchestrator.ts

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import type { WebSearchProviderResponse, WebSearchProviderResult } from '@renderer/types'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { ExtractResults } from '@renderer/utils/extract'
import { fetchWebContents } from '@renderer/utils/fetch'
import dayjs from 'dayjs'

import type { CompressionStrategyFactory } from './compression'
import type { IRequestStateManager, ISearchStatusTracker } from './interfaces'
import WebSearchEngineProvider from './providers/WebSearchEngineProvider'

const logger = loggerService.withContext('WebSearchOrchestrator')

export class WebSearchOrchestrator {
  constructor(
    private readonly requestStateManager: IRequestStateManager,
    private readonly statusTracker: ISearchStatusTracker,
    private readonly compressionFactory: CompressionStrategyFactory
  ) {}

  async processWebsearch(
    webSearchProvider: WebSearchProvider,
    extractResults: ExtractResults,
    requestId: string
  ): Promise<WebSearchProviderResponse> {
    await this.statusTracker.setStatus(requestId, { phase: 'default' })

    if (!extractResults.websearch?.question || extractResults.websearch.question.length === 0) {
      logger.info('No valid question found in extractResults.websearch')
      return { results: [] }
    }

    const signal = this.requestStateManager.getRequestState(requestId).signal || this.requestStateManager.getSignal()
    const questions = extractResults.websearch.question
    const links = extractResults.websearch.links

    // Span tracing
    const span = webSearchProvider.topicId
      ? await addSpan({
          topicId: webSearchProvider.topicId,
          name: 'WebSearch',
          inputs: { question: questions, provider: webSearchProvider.id },
          tag: 'Web',
          parentSpanId: webSearchProvider.parentSpanId,
          modelName: webSearchProvider.modelName
        })
      : undefined

    // Handle summarize case
    if (questions[0] === 'summarize' && links && links.length > 0) {
      const contents = await fetchWebContents(links, undefined, undefined, { signal })
      if (webSearchProvider.topicId) {
        endSpan({ topicId: webSearchProvider.topicId, outputs: contents, modelName: webSearchProvider.modelName, span })
      }
      return { query: 'summaries', results: contents }
    }

    // Execute searches
    const searchWithTime = await preferenceService.get('chat.websearch.search_with_time')
    const webSearchEngine = new WebSearchEngineProvider(webSearchProvider, span?.spanContext().spanId)

    const searchPromises = questions.map(async (q) => {
      const formattedQuery = searchWithTime ? `today is ${dayjs().format('YYYY-MM-DD')} \r\n ${q}` : q
      return await webSearchEngine.search(formattedQuery, { signal })
    })

    const searchResults = await Promise.allSettled(searchPromises)

    // Aggregate results
    const successfulSearchCount = searchResults.filter((r) => r.status === 'fulfilled').length
    logger.verbose(`Successful search count: ${successfulSearchCount}`)

    if (successfulSearchCount > 1) {
      await this.statusTracker.setStatus(requestId, { phase: 'fetch_complete', countAfter: successfulSearchCount }, 1000)
    }

    let finalResults: WebSearchProviderResult[] = []
    searchResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.results) {
        finalResults.push(...result.value.results)
      }
      if (result.status === 'rejected') {
        throw result.reason
      }
    })

    logger.verbose(`FulFilled search result count: ${finalResults.length}`)

    if (finalResults.length === 0) {
      await this.statusTracker.setStatus(requestId, { phase: 'default' })
      if (webSearchProvider.topicId) {
        endSpan({ topicId: webSearchProvider.topicId, outputs: finalResults, modelName: webSearchProvider.modelName, span })
      }
      return { query: questions.join(' | '), results: [] }
    }

    // Apply compression
    const compressionMethod = await preferenceService.get('chat.websearch.compression.method')

    if (compressionMethod && compressionMethod !== 'none') {
      const strategy = await this.compressionFactory.getStrategy()
      const originalCount = finalResults.length

      if (strategy.name === 'rag') {
        await this.statusTracker.setStatus(requestId, { phase: 'rag' }, 500)
        try {
          finalResults = await strategy.compress(finalResults, { questions, requestId })
          await this.statusTracker.setStatus(
            requestId,
            { phase: 'rag_complete', countBefore: originalCount, countAfter: finalResults.length },
            1000
          )
        } catch (error) {
          logger.warn('RAG compression failed:', error as Error)
          window.toast.error({
            timeout: 10000,
            title: `${i18n.t('settings.tool.websearch.compression.error.rag_failed')}: ${(error as Error).message}`
          })
          finalResults = []
          await this.statusTracker.setStatus(requestId, { phase: 'rag_failed' }, 1000)
        }
      } else if (strategy.name === 'cutoff') {
        await this.statusTracker.setStatus(requestId, { phase: 'cutoff' }, 500)
        finalResults = await strategy.compress(finalResults, { questions, requestId })
      }
    }

    await this.statusTracker.setStatus(requestId, { phase: 'default' })

    if (webSearchProvider.topicId) {
      endSpan({ topicId: webSearchProvider.topicId, outputs: finalResults, modelName: webSearchProvider.modelName, span })
    }

    return { query: questions.join(' | '), results: finalResults }
  }
}
```

### 8. WebSearchService (向后兼容门面)

```typescript
// src/renderer/src/services/webSearch/WebSearchService.ts

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type { WebSearchProviderResponse } from '@renderer/types'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { ExtractResults } from '@renderer/utils/extract'

import { CompressionStrategyFactory } from './compression'
import { RequestStateManager } from './RequestStateManager'
import { SearchStatusTracker } from './SearchStatusTracker'
import { WebSearchOrchestrator } from './WebSearchOrchestrator'
import WebSearchEngineProvider from './providers/WebSearchEngineProvider'

const logger = loggerService.withContext('WebSearchService')

class WebSearchService {
  private orchestrator: WebSearchOrchestrator
  private requestStateManager: RequestStateManager

  constructor() {
    this.requestStateManager = new RequestStateManager()
    const statusTracker = new SearchStatusTracker()
    const compressionFactory = new CompressionStrategyFactory()

    this.orchestrator = new WebSearchOrchestrator(
      this.requestStateManager,
      statusTracker,
      compressionFactory
    )
  }

  // Legacy compatibility
  get isPaused() {
    return this.requestStateManager.isPaused
  }

  createAbortSignal(requestId: string) {
    return this.requestStateManager.createAbortSignal(requestId)
  }

  public async getWebSearchProvider(providerId?: string): Promise<WebSearchProvider | undefined> {
    const providers = await preferenceService.get('chat.websearch.providers')
    logger.debug('providers', providers)
    return providers.find((p) => p.id === providerId)
  }

  public async search(
    provider: WebSearchProvider,
    query: string,
    httpOptions?: RequestInit,
    spanId?: string
  ): Promise<WebSearchProviderResponse> {
    const webSearchEngine = new WebSearchEngineProvider(provider, spanId)
    return await webSearchEngine.search(query, httpOptions)
  }

  public async checkSearch(provider: WebSearchProvider): Promise<{ valid: boolean; error?: any }> {
    try {
      const response = await this.search(provider, 'test query')
      logger.debug('Search response:', response)
      return { valid: response.results !== undefined, error: undefined }
    } catch (error) {
      return { valid: false, error }
    }
  }

  public async processWebsearch(
    webSearchProvider: WebSearchProvider,
    extractResults: ExtractResults,
    requestId: string
  ): Promise<WebSearchProviderResponse> {
    return this.orchestrator.processWebsearch(webSearchProvider, extractResults, requestId)
  }
}

export default new WebSearchService()
```

## 实现步骤

### Phase 1: 创建接口层
1. 创建 `webSearch/interfaces/` 目录
2. 创建 `ICompressionStrategy.ts`
3. 创建 `IRequestStateManager.ts`
4. 创建 `ISearchStatusTracker.ts`
5. 创建 `interfaces/index.ts` 导出所有接口

### Phase 2: 提取压缩策略
1. 创建 `webSearch/compression/` 目录
2. `CutoffCompressionStrategy.ts` - 从 `compressWithCutoff()` 提取
3. `RagCompressionStrategy.ts` - 从以下方法提取:
   - `ensureSearchBase()`
   - `cleanupSearchBase()`
   - `querySearchBase()`
   - `compressWithSearchBase()`
4. `NullCompressionStrategy.ts` - 无操作实现
5. `compression/index.ts` - 工厂函数 + 策略注册

### Phase 3: 提取状态管理
1. `RequestStateManager.ts` - 从以下提取:
   - `requestStates` Map
   - `getRequestState()`
   - `createAbortSignal()`
2. `SearchStatusTracker.ts` - 从 `setWebSearchStatus()` 提取

### Phase 4: 移动 Provider 文件
将 `providers/WebSearchProvider/` 下所有文件移动到 `services/webSearch/providers/`:
- `BaseWebSearchProvider.ts`
- `WebSearchProviderFactory.ts`
- `index.ts` → 重命名为 `WebSearchEngineProvider.ts`
- 所有具体 Provider 实现

### Phase 5: 创建 Orchestrator
1. 创建 `WebSearchOrchestrator.ts`:
   - 注入 `IRequestStateManager`
   - 注入 `ISearchStatusTracker`
   - 注入 `CompressionStrategyFactory`
   - 实现 `processWebsearch()` 协调逻辑

### Phase 6: 重构主服务
1. 重构 `WebSearchService.ts`:
   - 组装所有依赖
   - 委托给 `WebSearchOrchestrator`
   - 保持公共 API 不变
2. 创建 `webSearch/index.ts` 公共导出

### Phase 7: 更新外部引用
更新所有导入路径:
- `src/renderer/src/aiCore/tools/WebSearchTool.ts`
- `src/renderer/src/pages/settings/WebSearchSettings/`

### Phase 8: 清理
1. 删除旧的 `providers/WebSearchProvider/` 目录
2. 运行 `pnpm build:check`

## 实现注意点

1. `CompressionStrategyFactory.getStrategy()` 当配置值无效时记录 warning，并回退到 `none`
2. `CutoffCompressionStrategy` 在 `results.length === 0` 时直接返回，避免除零
3. `RequestStateManager` 的 `isPaused/getSignal` 并发语义与旧实现保持一致
4. `Promise.allSettled` 对 rejected 的处理需确认是否允许部分成功继续
5. abort 回调中清理 `SearchStatusTracker` 状态，避免残留
6. 不设置 RAG knowledge 上限

## 扩展点示例

### 添加新的压缩方法 (无需修改现有代码)

```typescript
// 1. 创建新策略
class LLMCompressionStrategy implements ICompressionStrategy {
  readonly name = 'llm'
  async compress(results, context) {
    // LLM 摘要逻辑
  }
}

// 2. 注册策略 (在应用启动时)
compressionFactory.registerStrategy('llm', new LLMCompressionStrategy())

// 3. 更新 Preference schema 添加 'llm' 选项 (UI 层面)
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `WebSearchService.ts` | 向后兼容门面，组装依赖 |
| `WebSearchOrchestrator.ts` | 核心协调：搜索流程、状态管理、压缩调用 |
| `RequestStateManager.ts` | 管理请求的 AbortController 和状态 |
| `SearchStatusTracker.ts` | 通过 CacheService 追踪搜索进度 |
| `CompressionStrategyFactory` | 根据配置返回对应压缩策略 |
| `RagCompressionStrategy.ts` | RAG 压缩：知识库创建、查询、清理 |
| `CutoffCompressionStrategy.ts` | 截断压缩：按 token 或字符截断 |

## 验证

1. `pnpm lint` - 检查导入错误
2. `pnpm test` - 确保无回归
3. `pnpm build:check` - 完整验证
4. 手动测试：验证 Web 搜索功能正常工作
