# File Processing Backend Architecture

本文档描述 File Processing Provider 后端架构设计。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         IPC Layer                               │
└─────────────────────────┬───────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FileProcessingService                          │
│  - startProcess(dto) → { requestId, status }                    │
│  - getResult(requestId) → { status, progress, result?, error? } │
│  - cancel(requestId)                                            │
└─────────┬───────────────────────────────┬───────────────────────┘
          │                               │
          ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│  ProcessorRegistry  │         │ ConfigurationService │
│  - register/get     │         │  - getConfiguration │
│  - getAll           │         │  - updateConfig     │
└─────────┬───────────┘         └──────────┬──────────┘
          │                                │
          ▼                                ▼
┌─────────────────────┐         ┌─────────────────────┐
│   IFileProcessor    │         │  PreferenceService  │
│   ├─ ITextExtractor │         └─────────────────────┘
│   └─ IMarkdownConverter
└─────────┬───────────┘
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  BaseFileProcessor → BaseTextExtractor / BaseMarkdownConverter  │
├─────────────────────────────────────────────────────────────────┤
│  Builtin:                    │  API:                            │
│  - TesseractProcessor        │  - MineruProcessor               │
│  - SystemOcrProcessor        │  - Doc2xProcessor                │
│  - OvOcrProcessor            │  - MistralProcessor              │
│                              │  - OpenMineruProcessor           │
│                              │  - PaddleProcessor               │
└─────────────────────────────────────────────────────────────────┘
```

## 数据流

```
A. 启动处理 POST /file-processing/requests
   1. FileProcessingService.startProcess(dto)
   2. ConfigurationService.getConfiguration(processorId) → FileProcessorMerged
   3. ProcessorRegistry.get(processorId) → IFileProcessor
   4. 创建任务记录 (pending) + 异步调度
   5. 返回 { requestId, status: 'pending' }

B. 查询结果 GET /file-processing/requests/:requestId
   1. FileProcessingService.getResult(requestId)
   2. 同步处理器: 返回内存状态 / 异步处理器: 调用 getStatus()
   3. 返回 { status, progress, result?, error? }
   4. completed/failed 状态 TTL 5 分钟后清理
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/file-processing/processors` | GET | 获取可用处理器列表 |
| `/file-processing/requests` | POST | 启动处理任务 |
| `/file-processing/requests/:requestId` | GET | 查询处理状态/结果 |

## 类型定义

位置: `src/main/services/fileProcessing/types.ts`

```typescript
type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface ProcessingError {
  code: string    // 'cancelled' 表示取消
  message: string
}

interface ProcessingResult {
  text?: string
  markdown?: string
  outputPath?: string
  metadata?: Record<string, unknown>  // 异步处理器返回 providerTaskId
}

interface ProcessStartResponse {
  requestId: string
  status: ProcessingStatus
}

interface ProcessResultResponse {
  requestId: string
  status: ProcessingStatus
  progress: number  // 0-100
  result?: ProcessingResult
  error?: ProcessingError
}

interface ProcessingContext {
  requestId: string
  signal?: AbortSignal
}
```

## 接口定义

位置: `src/main/services/fileProcessing/interfaces.ts`

```typescript
interface IFileProcessor {
  readonly id: string
  readonly template: FileProcessorTemplate
  isAvailable(): Promise<boolean>
}

interface ITextExtractor extends IFileProcessor {
  extractText(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext): Promise<ProcessingResult>
}

interface IMarkdownConverter extends IFileProcessor {
  convertToMarkdown(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext): Promise<ProcessingResult>
}

interface IProcessStatusProvider extends IFileProcessor {
  getStatus(providerTaskId: string, config: FileProcessorMerged): Promise<ProcessResultResponse>
}

// 类型守卫
const isTextExtractor = (p: IFileProcessor): p is ITextExtractor =>
  'extractText' in p && typeof p.extractText === 'function'

const isMarkdownConverter = (p: IFileProcessor): p is IMarkdownConverter =>
  'convertToMarkdown' in p && typeof p.convertToMarkdown === 'function'

const isProcessStatusProvider = (p: IFileProcessor): p is IProcessStatusProvider =>
  'getStatus' in p && typeof (p as IProcessStatusProvider).getStatus === 'function'
```

## 核心类

| 类 | 职责 |
|---|------|
| `BaseFileProcessor` | 抽象基类：取消检查、文件校验、配置访问 |
| `BaseTextExtractor` | 文字提取基类：API Host 获取 |
| `BaseMarkdownConverter` | Markdown 转换基类：临时目录、文档限制检查 |
| `ProcessorRegistry` | 处理器注册/获取/查询 |
| `ConfigurationService` | 模板 + 用户覆盖 → FileProcessorMerged |
| `FileProcessingService` | 主服务：启动/查询/取消任务，TTL 清理 |

## 文件结构

```
src/main/services/fileProcessing/
├── index.ts                          # 导出 + 注册引导
├── FileProcessingService.ts          # 主服务
├── types.ts                          # 后端类型
├── interfaces.ts                     # 接口定义
├── base/
│   ├── BaseFileProcessor.ts
│   ├── BaseTextExtractor.ts
│   └── BaseMarkdownConverter.ts
├── registry/
│   └── ProcessorRegistry.ts
├── config/
│   └── ConfigurationService.ts
├── providers/
│   ├── builtin/                      # TesseractProcessor, SystemOcrProcessor, OvOcrProcessor
│   └── api/                          # MineruProcessor, Doc2xProcessor, MistralProcessor, OpenMineruProcessor, PaddleProcessor
└── __tests__/
```

## 新增 Provider 指南

添加新 Provider 只需三步，**无需修改现有代码**：

### 1. 创建 Provider 类

```typescript
// 文字提取: 继承 BaseTextExtractor
class NewOcrProcessor extends BaseTextExtractor {
  async extractText(input, config, context): Promise<ProcessingResult> { ... }
}

// Markdown 转换: 继承 BaseMarkdownConverter
class NewDocProcessor extends BaseMarkdownConverter {
  async convertToMarkdown(input, config, context): Promise<ProcessingResult> { ... }
}
```

### 2. 注册到系统

在 `index.ts` 的注册列表中加入处理器。

### 3. 添加模板配置

在 `packages/shared/data/presets/file-processing.ts` 中添加模板。

## 使用示例

### Renderer 端

```typescript
// 启动处理
const { trigger: startProcess } = useMutation('POST', '/file-processing/requests')
const { requestId } = await startProcess({ body: { file, feature: 'text_extraction' } })

// 查询结果
const { data: result } = useQuery('/file-processing/requests/:requestId', { params: { requestId } })
```

### Main 进程

```typescript
const { requestId } = await fileProcessingService.startProcess({ file, feature: 'text_extraction' })
const result = await fileProcessingService.getResult(requestId)
fileProcessingService.cancel(requestId)
```

## 相关文档

- [File Processing 概念设计](./fileProcessing-overview.md)
- [File Processing Data API 设计](./fileProcessing-data-api.md)
- [Data System 设计规范](../../../docs/en/references/data/README.md)
