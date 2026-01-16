# Knowledge 服务层架构

本文档描述知识库系统的服务层架构，包括各核心服务的职责、接口和协作关系。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DataApi Layer (处理器)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│   KnowledgeHandlers (knowledges.ts)                                          │
│   ├── KnowledgeBaseService (知识库 CRUD)                                     │
│   └── KnowledgeItemService (知识项 CRUD + 入队)                              │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────────────┐
│                      Service Layer (服务层)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    KnowledgeOrchestrator                             │   │
│   │                    (协调层 - 状态管理)                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                             │
│                                ▼                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    KnowledgeProcessor                                │   │
│   │                    (处理层 - 业务流程)                                │   │
│   │                    OCR → Read → Embed                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                             │
│                                ▼                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    KnowledgeQueueManager                             │   │
│   │                    (调度层 - 并发控制)                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                             │
│                                ▼                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    KnowledgeServiceV2                                │   │
│   │                    (存储层 - 向量操作)                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 核心服务

### 1. KnowledgeServiceV2 (存储层)

**文件**: `src/main/services/knowledge/KnowledgeServiceV2.ts`

**职责**: 管理向量存储，提供低级别的向量操作接口。

**特性**:
- 使用 LibSQLVectorStore 作为向量数据库后端
- Store 缓存管理，避免重复创建连接
- 支持向量搜索和 BM25 混合搜索

#### 接口

```typescript
class KnowledgeServiceV2 {
  // ============================================================================
  // 生命周期管理
  // ============================================================================

  /** 创建/初始化知识库 */
  create(base: KnowledgeBase): Promise<void>

  /** 重置知识库（清空所有数据） */
  reset(base: KnowledgeBase): Promise<void>

  /** 删除知识库 */
  delete(id: string): Promise<void>

  // ============================================================================
  // 内容管理
  // ============================================================================

  /** 添加已嵌入的节点到知识库 */
  addNodes(options: { base: ResolvedKnowledgeBase; nodes: BaseNode[] }): Promise<void>

  /** 移除知识项的所有向量 */
  remove(options: { base: KnowledgeBase; item: KnowledgeItem }): Promise<void>

  // ============================================================================
  // 搜索与检索
  // ============================================================================

  /** 搜索知识库 */
  search(options: SearchOptions): Promise<KnowledgeSearchResult[]>

  /** 重排序搜索结果 */
  rerank(options: RerankOptions): Promise<KnowledgeSearchResult[]>
}
```

#### cleanupStoreCache 的必要性

如果移除 `cleanupStoreCache`（仅删除文件而不清理缓存中的 store），在删除/重建知识库时可能出现以下问题：

- **删除失败**：libsql 客户端仍持有文件句柄，导致 `rm` 失败或留下残留文件
- **旧连接继续工作**：缓存中的旧 store 仍被复用，继续指向已删除或即将被重建的库
- **重建后读到旧状态**：新库同名但旧连接未释放，查询/写入仍走旧连接
- **资源泄漏**：长期运行进程里，未清理的 store 累积占用内存/句柄

> 小结：`cleanupStoreCache` 是删除流程中的内存清理步骤，用于避免"文件已删但连接仍占用"的常见问题。

---

### 2. KnowledgeOrchestrator (协调层)

**文件**: `src/main/services/knowledge/KnowledgeOrchestrator.ts`

**职责**: 协调知识项的处理流程，管理状态转换和进度追踪。

**特性**:
- Job Token 机制防止重复入队
- 状态回调通知
- 与 KnowledgeQueueManager 集成

#### 接口

```typescript
interface ProcessItemOptions {
  base: KnowledgeBase
  item: KnowledgeItem
  onStatusChange?: (status: ItemStatus, error: string | null) => Promise<void>
}

class KnowledgeOrchestrator {
  /** 处理知识项（入队） */
  process(options: ProcessItemOptions): Promise<void>

  /** 取消处理 */
  cancel(itemId: string): void

  /** 清除进度 */
  clearProgress(itemId: string): void

  /** 移除知识项的向量 */
  removeVectors(base: KnowledgeBase, item: KnowledgeItem): Promise<void>

  /** 检查是否在队列中 */
  isQueued(itemId: string): boolean

  /** 检查是否正在处理 */
  isProcessing(itemId: string): boolean

  /** 获取进度 */
  getProgress(itemId: string): number | undefined

  /** 获取队列状态 */
  getQueueStatus(): QueueStatus
}
```

#### Job Token 机制

Orchestrator 使用 `jobTokens: Map<itemId, createdAt>` 来：
1. 防止同一 item 重复入队
2. 确保状态更新只来自当前有效的 job
3. 在 job 被取消或新 job 入队时，旧 job 的回调不会生效

---

### 3. KnowledgeProcessor (处理层)

**文件**: `src/main/services/knowledge/KnowledgeProcessor.ts`

**职责**: 封装完整的处理管道，包括 OCR、内容读取和向量嵌入。

**处理管道**:

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│   OCR   │ ──► │  Read   │ ──► │  Embed  │
│  (ocr)  │     │ (read)  │     │ (embed) │
└─────────┘     └─────────┘     └─────────┘
     │               │               │
     ▼               ▼               ▼
 文档预处理      内容读取分块     向量嵌入存储
```

#### 接口

```typescript
interface ProcessOptions {
  base: KnowledgeBase
  item: KnowledgeItem
  userId?: string
  signal?: AbortSignal
  runStage: KnowledgeStageRunner
  onStageChange?: (stage: KnowledgeStage) => void
  onProgress?: (progress: number) => void
}

interface DirectProcessOptions {
  base: KnowledgeBase
  item: KnowledgeItem
  userId?: string
  signal?: AbortSignal
}

class KnowledgeProcessor {
  /** 通过队列处理知识项 */
  process(options: ProcessOptions): Promise<void>

  /** 直接处理（不经过队列管理） */
  processDirect(options: DirectProcessOptions): Promise<void>
}
```

#### 阶段说明

| 阶段 | 状态值 | 描述 |
|------|--------|------|
| OCR | `ocr` | 文档预处理（PDF 解析、图像识别等） |
| Read | `read` | 内容读取与分块 |
| Embed | `embed` | 向量嵌入与存储 |

---

### 4. KnowledgeQueueManager (调度层)

**文件**: `src/main/services/knowledge/queue/KnowledgeQueueManager.ts`

**职责**: 管理任务队列，提供多级并发控制。

详细文档见 [knowledge-queue.md](./knowledge-queue.md)

#### 核心特性

- **公平调度**：按 baseId 轮询，防止单个知识库占满资源
- **三级并发池**：OCR、IO、Embedding 各自独立控制
- **进度追踪**：TTL 机制，300ms 节流更新
- **取消支持**：AbortSignal 中止进行中的任务

#### 默认配置

```typescript
const DEFAULT_SCHEDULER_CONFIG = {
  globalConcurrency: 4,      // 全局并发上限
  perBaseConcurrency: 2,     // 每库并发上限
  ocrConcurrency: 2,         // OCR 并发池
  ioConcurrency: 3,          // IO 并发池
  embeddingConcurrency: 3    // Embedding 并发池
}
```

---

### 5. KnowledgeProviderAdapter (Provider 解析)

**文件**: `src/main/services/knowledge/KnowledgeProviderAdapter.ts`

**职责**: 将知识库配置解析为 API 客户端参数。

**特性**:
- Model ID 解析（格式：`providerId:modelId`）
- Provider 特定的 BaseURL 处理
- 单例模式

#### 接口

```typescript
type ResolvedKnowledgeBase = KnowledgeBase & {
  dimensions?: number
  embedApiClient: ApiClient
  rerankApiClient?: ApiClient
  documentCount?: number
}

class KnowledgeProviderAdapter {
  static getInstance(): KnowledgeProviderAdapter

  /** 构建解析后的知识库参数 */
  buildBaseParams(
    base: KnowledgeBase,
    field: 'embeddingModelId' | 'rerankModelId'
  ): Promise<ResolvedKnowledgeBase>
}
```

#### Provider 特殊处理

| Provider | BaseURL 处理 |
|----------|-------------|
| Gemini | 追加 `/openai` |
| Azure OpenAI | 追加 `/v1` |
| Ollama | 移除 `/api` 后缀 |

> **TODO**: 当前依赖 Redux 获取 Provider 配置，待 DataApi 迁移后改用 DataApi。

---

### 6. ReaderRegistry (内容读取器)

**文件**: `src/main/services/knowledge/readers/index.ts`

**职责**: 提供不同内容类型的读取器注册和查找。

#### 支持的 Reader

| 类型 | Reader | 描述 |
|------|--------|------|
| `file` | FileReader | 本地文件（PDF、DOCX、CSV 等） |
| `directory` | DirectoryReader | 本地目录 |
| `url` | UrlReader | 网页 URL |
| `sitemap` | SitemapReader | Sitemap URL |
| `note` | NoteReader | 文本笔记 |

#### 接口

```typescript
interface ContentReader {
  readonly type: KnowledgeItemType
  read(context: ReaderContext): Promise<ReaderResult>
}

interface ReaderContext {
  base: ResolvedKnowledgeBase
  item: KnowledgeItem
  userId?: string
}

interface ReaderResult {
  nodes: BaseNode[]
}

class ReaderRegistry {
  register(reader: ContentReader): void
  get(type: KnowledgeItemType): ContentReader | undefined
  has(type: KnowledgeItemType): boolean
  getTypes(): KnowledgeItemType[]
}
```

#### FileReader 支持的格式

| 扩展名 | Reader | 内容类型 |
|--------|--------|----------|
| `.pdf` | PDFReader | text |
| `.csv` | CSVReader | text |
| `.docx` | DocxReader | text |
| `.html/.htm` | HTMLReader | text |
| `.json` | JSONReader | text |
| `.md` | MarkdownReader | markdown |
| `.epub` | EpubReader | text |
| 其他 | TextFileReader | text |

---

## 服务协作流程

### 知识项处理流程

```
DataApi Handler
  │
  │ 1. 创建 KnowledgeItem 记录 (status=pending)
  │
  ▼
KnowledgeOrchestrator.process()
  │
  │ 2. 检查是否已在队列
  │ 3. 创建 Job Token
  │
  ▼
KnowledgeQueueManager.enqueue()
  │
  │ 4. 加入 baseQueue
  │ 5. 轮询调度
  │
  ▼
KnowledgeProcessor.process()
  │
  │ 6. OCR 阶段 (ocrPool)
  │    └─ onStageChange('ocr')
  │
  │ 7. Read 阶段 (ioPool)
  │    └─ Reader.read() → nodes
  │    └─ onStageChange('read')
  │
  │ 8. Embed 阶段 (embeddingPool)
  │    └─ embedNodes() → embeddedNodes
  │    └─ KnowledgeServiceV2.addNodes()
  │    └─ onStageChange('embed')
  │
  ▼
KnowledgeOrchestrator
  │
  │ 9. onStatusChange('completed')
  │ 10. 清理 Job Token
  │
  ▼
完成
```

### 搜索流程

```
DataApi Handler (/knowledge-bases/:id/search)
  │
  ▼
KnowledgeServiceV2.search()
  │
  │ 1. 解析 Provider (KnowledgeProviderAdapter)
  │ 2. 嵌入查询 (Embeddings)
  │ 3. 向量搜索 (LibSQLVectorStore)
  │ 4. 重排序 (可选, Reranker)
  │
  ▼
返回 KnowledgeSearchResult[]
```

---

## 相关文档

- [Knowledge 队列系统设计](./knowledge-queue.md)
- [Knowledge DataApi 设计](./knowledge-data-api.md)
- [Knowledge V2 总体设计](./knowledge-v2.md)
