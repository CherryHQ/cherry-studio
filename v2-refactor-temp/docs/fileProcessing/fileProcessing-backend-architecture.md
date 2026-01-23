# File Processing Backend Architecture

本文档描述 File Processing Provider 后端重构的架构设计，遵循 SOLID 原则。

## 目录

- [现状分析](#现状分析)
- [设计目标](#设计目标)
- [架构设计](#架构设计)
- [核心接口定义](#核心接口定义)
- [错误类型定义](#错误类型定义)
- [类设计](#类设计)
- [外部调用示例](#外部调用示例)
- [文件结构](#文件结构)
- [实施步骤](#实施步骤)
- [测试策略](#测试策略)
- [新增 Provider 指南](#新增-provider-指南)

---

## 现状分析

### 当前架构问题

| 问题 | 现状描述 | SOLID 违反 |
|------|----------|-----------|
| 架构不一致 | OCR 使用注册表模式 (`OcrService.register()`)，Preprocess 使用工厂模式 (`PreprocessProviderFactory`) | - |
| switch-case 工厂 | `PreprocessProviderFactory` 中硬编码所有 provider 类型 | **OCP** (开闭原则) |
| 业务耦合 | Preprocess 与知识库业务紧密耦合，位于 `src/main/knowledge/preprocess/` | **SRP** (单一职责) |
| 配置分散 | 没有统一的配置获取机制，各 provider 自行处理配置 | **DIP** (依赖倒置) |
| 接口粗糙 | `OcrBaseService` 只定义一个 `ocr` 方法，没有细分能力 | **ISP** (接口隔离) |

### 现有代码位置

```
src/main/services/ocr/
├── OcrService.ts                 # 注册表模式，管理 OCR handlers
├── builtin/
│   ├── OcrBaseService.ts         # 极简抽象类 (只有 abstract ocr 方法)
│   ├── TesseractService.ts       # Tesseract 实现
│   ├── SystemOcrService.ts       # 系统 OCR 实现
│   ├── PpocrService.ts           # PaddleOCR 实现
│   └── OvOcrService.ts           # Intel OpenVINO OCR 实现

src/main/knowledge/preprocess/
├── BasePreprocessProvider.ts     # 抽象基类 (parseFile)
├── PreprocessProviderFactory.ts  # switch-case 工厂
├── PreprocessingService.ts       # 与知识库耦合的服务
├── MineruPreprocessProvider.ts
├── Doc2xPreprocessProvider.ts
├── MistralPreprocessProvider.ts
└── OpenMineruPreprocessProvider.ts
```

### 数据模型（已实现）

数据模型已在 `packages/shared/data/presets/fileProcessing.ts` 中定义，采用 Template + Override 分层模式。

---

## 设计目标

### 功能需求

1. **统一接口**: 将 OCR 和 Preprocess 统一为 File Processing 服务
2. **能力支持**: `text_extraction` (文字提取) 和 `to_markdown` (转 Markdown)
3. **输入类型**: `image` (图片) 和 `document` (文档)
4. **配置集成**: 从 Preference 系统获取配置（模板 + 用户覆盖合并）
5. **取消支持**: 支持取消操作

### SOLID 原则目标

| 原则 | 目标实现 |
|------|----------|
| **S - 单一职责** | 分离配置获取、文件处理、结果存储等职责到不同类 |
| **O - 开闭原则** | 添加新 Provider 不需要修改现有代码 |
| **L - 里氏替换** | 所有 Provider 可以互换使用 |
| **I - 接口隔离** | 按能力定义细粒度接口 |
| **D - 依赖倒置** | 高层模块依赖抽象，不依赖具体实现 |

---

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         IPC Layer                                │
│                    (src/main/ipc.ts)                            │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FileProcessingService                           │
│                    (主编排服务)                                   │
│  - process(processorId, feature, input, context)                │
│  - findProcessor(feature, inputType)                            │
└─────────┬───────────────────────────────────┬───────────────────┘
          │                                   │
          ▼                                   ▼
┌─────────────────────┐             ┌─────────────────────┐
│  ProcessorRegistry  │             │ ConfigurationService │
│    (注册表)          │             │    (配置服务)        │
│                     │             │                      │
│ - register()        │             │ - getConfiguration() │
│ - get()             │             │ - getDefaultProcessor│
│ - findByCapability()│             │ - onConfigChange()   │
└─────────┬───────────┘             └──────────┬──────────┘
          │                                    │
          │                                    ▼
          │                         ┌─────────────────────┐
          │                         │  PreferenceService  │
          │                         │  (数据存储层)        │
          │                         └─────────────────────┘
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IFileProcessor                              │
│                       (接口抽象)                                  │
├─────────────────────────────────────────────────────────────────┤
│  ITextExtractor              │  IMarkdownConverter               │
│  - extractText()             │  - toMarkdown()                   │
├─────────────────────────────────────────────────────────────────┤
│  IDisposable                                                     │
│  - dispose()                                                     │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BaseFileProcessor                            │
│                      (抽象基类)                                   │
├──────────────────────────┬──────────────────────────────────────┤
│   BaseTextExtractor      │      BaseMarkdownConverter            │
│   (文字提取基类)          │      (Markdown 转换基类)              │
├──────────────────────────┴──────────────────────────────────────┤
│                      具体实现                                     │
├─────────────────────────────────────────────────────────────────┤
│  Builtin:                    │  API:                             │
│  - TesseractProcessor        │  - MineruProcessor                │
│  - SystemOcrProcessor        │  - Doc2xProcessor                 │
│  - PpocrProcessor            │  - MistralProcessor               │
│  - OvOcrProcessor            │  - OpenMineruProcessor            │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流

```
1. IPC 请求
      │
      ▼
2. FileProcessingService.process(processorId, feature, input, context)
      │
      ├──► ConfigurationService.getConfiguration(processorId)
      │         │
      │         ├──► 获取 Template (只读预设)
      │         └──► 获取 UserOverride (Preference)
      │         │
      │         ▼
      │    合并为 FileProcessorMerged
      │
      ├──► ProcessorRegistry.get(processorId)
      │         │
      │         ▼
      │    获取 IFileProcessor 实例
      │
      ▼
3. 路由到对应方法
      │
      ├── feature === 'text_extraction'
      │         └──► processor.extractText(input, config, context)
      │
      └── feature === 'to_markdown'
                └──► processor.toMarkdown(input, config, context)
      │
      ▼
4. 返回 ProcessingResult
```

---

## 核心接口定义

### 类型定义 (`types.ts`)

> **设计原则**：`types.ts` 只定义后端特有的类型，共享类型直接从 `@shared/data/presets/fileProcessing` 导入。

```typescript
// 处理结果 - 所有处理器的统一输出
interface ProcessingResult {
  text?: string                       // 提取的文本内容
  markdown?: string                   // 转换的 Markdown 内容
  outputPath?: string                 // 输出文件路径（如果保存到磁盘）
  metadata?: Record<string, unknown>  // 可选的扩展元数据（处理器特定）
}

// 处理选项
interface ProcessOptions {
  signal?: AbortSignal                // 取消信号
  onProgress?: (progress: number) => void  // 进度回调
}

// 内部处理上下文（由服务创建，传递给处理器）
interface ProcessingContext {
  requestId: string                   // 请求追踪 ID
  signal?: AbortSignal                // 取消信号
  onProgress?: (progress: number) => void  // 进度回调
}
```

**注意**：
- `ProcessingInput` 已移除，直接使用 `FileMetadata`（来自 `@types`）
- `ProcessorConfiguration` 已移除，统一使用 `FileProcessorMerged`（来自 shared）
- 共享类型（如 `FileProcessorMerged`、`FeatureCapability` 等）从 `@shared/data/presets/fileProcessing` 导入

### 接口定义 (`interfaces.ts`)

```typescript
import type { FileProcessorMerged, ... } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'
import type { ProcessingContext, ProcessingResult } from './types'

// 基础处理器接口 - 所有处理器必须实现
interface IFileProcessor {
  readonly id: string
  readonly template: FileProcessorTemplate
  supports(feature: FileProcessorFeature, inputType: FileProcessorInput): boolean
  isAvailable(): Promise<boolean>
}

// 文字提取能力 (原 OCR)
interface ITextExtractor extends IFileProcessor {
  extractText(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext): Promise<ProcessingResult>
}

// Markdown 转换能力 (原 Preprocess)
interface IMarkdownConverter extends IFileProcessor {
  toMarkdown(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext): Promise<ProcessingResult>
}

// 资源释放能力 - 有状态的 Provider 实现
interface IDisposable {
  dispose(): Promise<void>
}
```

> **扩展性说明**：当前设计假设每个处理器只有单一能力类型。
> 如果未来需要支持同时具备两种能力的处理器，可以通过实现多个接口来实现。

### 类型守卫

```typescript
const isTextExtractor = (p: IFileProcessor): p is ITextExtractor =>
  'extractText' in p && typeof p.extractText === 'function'

const isMarkdownConverter = (p: IFileProcessor): p is IMarkdownConverter =>
  'toMarkdown' in p && typeof p.toMarkdown === 'function'
```

---

## 错误类型定义

> **TODO**: 错误处理定义待补充。

---

## 类设计

### BaseFileProcessor (抽象基类)

**职责**：
- 提供通用的能力检查方法 (`supports`)
- 提供取消检查方法 (`checkCancellation`)
- 提供可用性检查默认实现 (`isAvailable`)

**关键方法**：

| 方法 | 说明 |
|------|------|
| `supports(feature, inputType)` | 检查是否支持指定能力 |
| `isAvailable()` | 检查处理器是否可用（子类可覆盖） |
| `checkCancellation(context)` | 检查取消状态 |
| `getCapability(feature)` | 获取能力配置 |

### BaseTextExtractor / BaseMarkdownConverter

**职责**：
- 实现模板方法模式，定义处理框架
- 统一验证、日志、取消检查
- 子类只需实现核心业务逻辑

**模板方法流程**：

```
extractText / toMarkdown
    │
    ├── 日志记录
    ├── 取消检查 (checkCancellation)
    ├── 输入验证 (validateInput / validateDocument)
    ├── 核心处理 (doExtractText / doConvert) ← 子类实现
    └── 返回结果
```

### ProcessorRegistry (注册表)

**职责**：
- 管理处理器注册和获取
- 按能力查找处理器
- 检查处理器可用性

**关键方法**：

| 方法 | 说明 |
|------|------|
| `register(processor)` | 注册处理器（OCP：新增不修改现有代码） |
| `unregister(processorId)` | 注销处理器 |
| `get(processorId)` | 获取处理器 |
| `findByCapability(feature, inputType)` | 按能力查找处理器 |
| `isAvailable(processorId)` | 检查处理器可用性 |
| `_resetForTesting()` | 测试专用：重置实例 |

### ConfigurationService (配置服务)

**职责**：
- 合并模板配置与用户覆盖配置，生成 `FileProcessorMerged`
- 获取默认处理器设置
- 监听配置变化

**关键方法**：

| 方法 | 说明 |
|------|------|
| `getConfiguration(processorId)` | 获取合并后的 `FileProcessorMerged` 配置 |
| `getTemplate(processorId)` | 获取模板配置 |
| `getDefaultProcessor(inputType)` | 获取默认处理器 |
| `onConfigurationChange(callback)` | 订阅配置变化 |
| `_resetForTesting()` | 测试专用：重置实例 |

**配置合并逻辑**：

```
Template (只读)  +  UserOverride (Preference)  →  FileProcessorMerged
      │                      │
      ├── id                 ├── apiKey
      ├── type               ├── featureConfigs[]
      └── capabilities       └── options
```

### FileProcessingService (主服务)

**职责**：
- 编排整个处理流程
- 管理取消控制器
- 路由到对应处理器方法

**关键方法**：

| 方法 | 说明 |
|------|------|
| `process(file, feature, processorId?, options?)` | 处理文件，processorId 可选（不传使用默认） |
| `cancel(requestId)` | 取消处理 |
| `listAvailableProcessors(inputType)` | 列出可用处理器 |
| `getInputType(file)` | 判断文件输入类型 |

---

## 外部调用示例

### 设计原则

与 Data API 保持一致，使用相同的模式：
- **Renderer**: 通过 `useQuery` / `useMutation` 或自定义 Hook 调用
- **Main**: 通过 Handler → Service 模式处理请求
- **通信**: 统一使用 DataApi 的 IPC 通道

### API Schema 设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `/file-processing/processors` | GET | 获取可用处理器列表 |
| `/file-processing/process` | POST | 处理文件 |
| `/file-processing/cancel` | POST | 取消处理 |

### Renderer 端调用方式

```typescript
// 使用 Hook
const { process, cancel, canCancel, isLoading } = useFileProcessing()

// OCR，使用默认处理器
await process(file, 'text_extraction')

// 文档转换，指定处理器
await process(file, 'to_markdown', 'mineru')

// 取消
cancel()
```

### Main 进程直接调用

```typescript
// Service 调用
await fileProcessingService.process(file, 'text_extraction')
await fileProcessingService.process(file, 'to_markdown', 'mineru')
fileProcessingService.cancel(requestId)
```

---

## 文件结构

```
src/main/services/fileProcessing/
├── index.ts                          # 公共 API 导出 + 注册引导
├── FileProcessingService.ts          # 主编排服务
├── types.ts                          # 后端特有类型 (ProcessingResult, ProcessingContext)
├── interfaces.ts                     # 接口定义 (ISP)
│
├── base/
│   ├── BaseFileProcessor.ts          # 抽象基类
│   ├── BaseTextExtractor.ts          # 文字提取基类
│   └── BaseMarkdownConverter.ts      # Markdown 转换基类
│
├── registry/
│   └── ProcessorRegistry.ts          # Provider 注册表 (OCP)
│
├── config/
│   └── ConfigurationService.ts       # 配置合并服务 (DIP)
│
├── providers/
│   ├── builtin/
│   │   ├── TesseractProcessor.ts     # Tesseract OCR
│   │   ├── SystemOcrProcessor.ts     # 系统 OCR
│   │   ├── PpocrProcessor.ts         # PaddleOCR
│   │   └── OvOcrProcessor.ts         # Intel OpenVINO OCR
│   │
│   └── api/
│       ├── MineruProcessor.ts        # MinerU 文档解析
│       ├── Doc2xProcessor.ts         # Doc2x 文档转换
│       ├── MistralProcessor.ts       # Mistral OCR
│       └── OpenMineruProcessor.ts    # 开源 MinerU
│
│
└── __tests__/                        # 单元测试
    ├── ProcessorRegistry.test.ts
    ├── ConfigurationService.test.ts
    ├── BaseFileProcessor.test.ts
    ├── FileProcessingService.test.ts
    └── mocks/
        └── MockProcessor.ts          # Mock 处理器

packages/shared/data/presets/
└── fileProcessing.ts                 # 共享类型定义 + FileProcessorMerged
```

**类型组织原则**：
- 共享类型（`FileProcessorMerged`、`FeatureCapability` 等）定义在 `packages/shared/data/presets/fileProcessing.ts`
- 后端特有类型（`ProcessingResult`、`ProcessingContext`）定义在 `types.ts`
- `interfaces.ts` 直接从 shared 导入共享类型

---

## 实施步骤

### ✅ Phase 1: 基础设施 

| 步骤 | 文件 | 说明 |
|------|------|------|
| 1 | `types.ts` | 创建类型定义 |
| 2 | `interfaces.ts` | 创建接口定义 |

### Phase 2: 核心框架

| 步骤 | 文件 | 说明 |
|------|------|------|
| 4 | `base/BaseFileProcessor.ts` | 创建抽象基类 |
| 5 | `base/BaseTextExtractor.ts` | 创建文字提取基类 |
| 6 | `base/BaseMarkdownConverter.ts` | 创建 Markdown 转换基类 |
| 7 | `registry/ProcessorRegistry.ts` | 创建注册表 |
| 8 | `config/ConfigurationService.ts` | 创建配置服务 |

### Phase 2.5: 单元测试

在核心框架完成后、迁移开始前，添加单元测试确保核心组件质量：

**测试覆盖范围：**

- Registry 注册/获取/查询功能
- 配置合并逻辑（模板 + 用户覆盖）
- 基类模板方法流程
- 取消机制

### Phase 3: 迁移内置处理器

| 步骤 | 新文件 | 迁移自 |
|------|--------|--------|
| 9 | `providers/builtin/TesseractProcessor.ts` | `ocr/builtin/TesseractService.ts` |
| 10 | `providers/builtin/SystemOcrProcessor.ts` | `ocr/builtin/SystemOcrService.ts` |
| 11 | `providers/builtin/PpocrProcessor.ts` | `ocr/builtin/PpocrService.ts` |
| 12 | `providers/builtin/OvOcrProcessor.ts` | `ocr/builtin/OvOcrService.ts` |

### Phase 4: 迁移 API 处理器

| 步骤 | 新文件 | 迁移自 |
|------|--------|--------|
| 13 | `providers/api/MineruProcessor.ts` | `preprocess/MineruPreprocessProvider.ts` |
| 14 | `providers/api/Doc2xProcessor.ts` | `preprocess/Doc2xPreprocessProvider.ts` |
| 15 | `providers/api/MistralProcessor.ts` | `preprocess/MistralPreprocessProvider.ts` |
| 16 | `providers/api/OpenMineruProcessor.ts` | `preprocess/OpenMineruPreprocessProvider.ts` |

### Phase 5: 集成

| 步骤 | 文件 | 说明 |
|------|------|------|
| 17 | `FileProcessingService.ts` | 创建主服务 |
| 18 | `index.ts` | 创建注册引导和导出 |
| 19 | `src/main/data/api/handlers/fileProcessing.ts` | 创建 DataApi Handler |
| 20 | - | 添加向后兼容适配器（可选） |

**集成验证清单：**

- [ ] Handler → Service → Processor 完整链路通畅
- [ ] 取消机制正常工作

### Phase 6: 清理与验收

| 步骤 | 说明 |
|------|------|
| 21 | 标记旧代码为 `@deprecated` |
| 22 | 更新知识库服务使用新 API |
| 23 | 移除旧的 `PreprocessProviderFactory` |
| 24 | 创建端到端集成测试 |

---

## 测试策略

### 测试工具

- **单元测试**: Vitest
- **Mock**: 使用 Mock 处理器测试核心组件

### 测试覆盖范围

| 组件 | 测试内容 |
|------|----------|
| ProcessorRegistry | 注册、获取、按能力查找、重复注册检测 |
| ConfigurationService | 配置合并、默认处理器获取、变化通知 |
| BaseFileProcessor | 取消检查、能力检查 |
| FileProcessingService | 完整链路集成、取消流程 |

### 验证方案

| 验证项 | 命令 | 预期结果 |
|--------|------|----------|
| 类型检查 | `pnpm lint` | 无错误 |
| 单元测试 | `pnpm test:main` | 全部通过 |
| 功能验证 - OCR | 手动测试 | 图片文字提取正常 |
| 功能验证 - 文档 | 手动测试 | 文档转 Markdown 正常 |
| 取消机制 | 手动测试 | 处理可被正确取消 |
| 回归测试 | 手动测试 | 现有 OCR/Preprocess 功能不受影响 |

---

## 新增 Provider 指南

添加新的 Provider 只需三步，**无需修改现有代码**：

### 步骤 1: 创建 Provider 类

根据能力类型选择基类：
- **文字提取 (OCR)**: 继承 `BaseTextExtractor`，实现 `doExtractText()`
- **Markdown 转换**: 继承 `BaseMarkdownConverter`，实现 `doConvert()`

### 步骤 2: 注册到系统

在 `index.ts` 中调用 `processorRegistry.register(processor)`

### 步骤 3: 添加模板配置

在 `packages/shared/data/presets/fileProcessing.ts` 中添加模板配置

---

## SOLID 原则总结

| 原则 | 实现方式 |
|------|----------|
| **S - 单一职责** | 每个类只有一个变化原因：`ProcessorRegistry` 管理注册，`ConfigurationService` 合并配置，各 Processor 只负责具体处理逻辑 |
| **O - 开闭原则** | 新增 Provider 只需创建类并调用 `processorRegistry.register()`，无需修改现有代码 |
| **L - 里氏替换** | 所有处理器继承 `BaseFileProcessor` 并实现 `IFileProcessor`，可以互换使用 |
| **I - 接口隔离** | 分离 `ITextExtractor`、`IMarkdownConverter`、`IDisposable` 等细粒度接口 |
| **D - 依赖倒置** | `FileProcessingService` 依赖 `IFileProcessor` 抽象和 `IConfigurationProvider` 接口，不依赖具体实现 |

---

## 相关文档

- [File Processing 概念设计](./fileProcessing-overview.md)
- [File Processing Data API 设计](./fileProcessing-data-api.md)
- [Data System 设计规范](../../../docs/en/references/data/README.md)
- [Layered Preset Pattern](../../../docs/en/references/data/best-practice-layered-preset-pattern.md)

---

## 关键文件参考

| 文件 | 说明 |
|------|------|
| `packages/shared/data/presets/fileProcessing.ts` | 类型定义 + 模板配置 |
| `src/renderer/src/config/fileProcessing.ts` | Renderer 配置入口 |
| `src/main/services/ocr/` | 现有 OCR 实现（待迁移） |
| `src/main/knowledge/preprocess/` | 现有 Preprocess 实现（待迁移） |

---

*文档更新于 2026-01-23*
