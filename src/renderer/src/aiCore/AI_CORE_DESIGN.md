# Cherry Studio AI Provider 技术架构文档 (新方案)

## 1. 核心设计理念与目标

本架构旨在重构 Cherry Studio 的 AI Provider（现称为 `aiCore`）层，以实现以下目标：

- **职责清晰**：明确划分各组件的职责，降低耦合度。
- **高度复用**：最大化业务逻辑和通用处理逻辑的复用，减少重复代码。
- **易于扩展**：方便快捷地接入新的 AI Provider (LLM供应商) 和添加新的 AI 功能 (如翻译、摘要、图像生成等)。
- **易于维护**：简化单个组件的复杂性，提高代码的可读性和可维护性。
- **标准化**：统一内部数据流和接口，简化不同 Provider 之间的差异处理。

核心思路是将纯粹的 **SDK 适配层 (`XxxApiClient`)**、**通用逻辑处理与智能解析层 (中间件)** 以及 **统一业务功能入口层 (`AiCoreService`)** 清晰地分离开来。

## 2. 核心组件详解

### 2.1. `aiCore` (原 `AiProvider` 文件夹)

这是整个 AI 功能的核心模块。

#### 2.1.1. `XxxApiClient` (例如 `aiCore/clients/openai/OpenAIApiClient.ts`)

- **职责**：作为特定 AI Provider SDK 的纯粹适配层。
  - **参数适配**：将应用内部统一的 `CoreRequest` 对象 (见下文) 转换为特定 SDK 所需的请求参数格式。
  - **基础响应转换**：将 SDK 返回的原始数据块 (`RawSdkChunk`，例如 `OpenAI.Chat.Completions.ChatCompletionChunk`) 转换为一组最基础、最直接的应用层 `Chunk` 对象 (定义于 `src/renderer/src/types/chunk.ts`)。
    - 例如：SDK 的 `delta.content` -> `TextDeltaChunk`；SDK 的 `delta.reasoning_content` -> `ThinkingDeltaChunk`；SDK 的 `delta.tool_calls` -> `RawToolCallChunk` (包含原始工具调用数据)。
    - **关键**：`XxxApiClient` **不处理**耦合在文本内容中的复杂结构，如 `<think>` 或 `<tool_use>` 标签。
- **特点**：极度轻量化，代码量少，易于实现和维护新的 Provider 适配。

#### 2.1.2. `ApiClient.ts` (或 `BaseApiClient.ts` 的核心接口)

- 定义了所有 `XxxApiClient` 必须实现的接口，如：
  - `getSdkInstance(): Promise<TSdkInstance> | TSdkInstance`
  - `getRequestTransformer(): RequestTransformer<TSdkParams>`
  - `getResponseChunkTransformer(): ResponseChunkTransformer<TRawChunk, TResponseContext>`
  - 其他可选的、与特定 Provider 相关的辅助方法 (如工具调用转换)。

#### 2.1.3. `ApiClientFactory.ts`

- 根据 Provider 配置动态创建和返回相应的 `XxxApiClient` 实例。

#### 2.1.4. `AiCoreService.ts` (`aiCore/index.ts`)

- **职责**：作为所有 AI 相关业务功能的统一入口。
  - 提供面向应用的高层接口，例如：
    - `executeCompletions(params: CompletionsParams): Promise<AggregatedCompletionsResult>`
    - `translateText(params: TranslateParams): Promise<AggregatedTranslateResult>`
    - `summarizeText(params: SummarizeParams): Promise<AggregatedSummarizeResult>`
    - 未来可能的 `generateImage(prompt: string): Promise<ImageResult>` 等。
  - **返回 `Promise`**：每个服务方法返回一个 `Promise`，该 `Promise` 会在整个（可能是流式的）操作完成后，以包含所有聚合结果（如完整文本、工具调用详情、最终的`usage`/`metrics`等）的对象来 `resolve`。
  - **支持流式回调**：服务方法的参数 (如 `CompletionsParams`) 依然包含 `onChunk` 回调，用于向调用方实时推送处理过程中的 `Chunk` 数据，实现流式UI更新。
  - **封装特定任务的提示工程 (Prompt Engineering)**：
    - 例如，`translateText` 方法内部会构建一个包含特定翻译指令的 `CoreRequest`。
  - **编排和调用中间件链**：通过内部的 `MiddlewareBuilder` (参见 `middleware/BUILDER_USAGE.md`) 实例，根据调用的业务方法和参数，动态构建和组织合适的中间件序列，然后通过 `applyCompletionsMiddlewares` 等组合函数执行。
  - 获取 `ApiClient` 实例并将其注入到中间件上游的 `Context` 中。
  - **将 `Promise` 的 `resolve` 和 `reject` 函数传递给中间件链** (通过 `Context`)，以便 `FinalChunkConsumerAndNotifierMiddleware` 可以在操作完成或发生错误时结束该 `Promise`。
- **优势**：
  - 业务逻辑（如翻译、摘要的提示构建和流程控制）只需实现一次，即可支持所有通过 `ApiClient` 接入的底层 Provider。
  - **支持外部编排**：调用方可以 `await` 服务方法以获取最终聚合结果，然后将此结果作为后续操作的输入，轻松实现多步骤工作流。
  - **支持内部组合**：服务自身也可以通过 `await` 调用其他原子服务方法来构建更复杂的组合功能。

#### 2.1.5. `coreRequestTypes.ts` (或 `types.ts`)

- 定义核心的、Provider 无关的内部请求结构，例如：
  - `CoreCompletionsRequest`: 包含标准化后的消息列表、模型配置、工具列表、最大Token数、是否流式输出等。
  - `CoreTranslateRequest`, `CoreSummarizeRequest` 等 (如果与 `CoreCompletionsRequest` 结构差异较大，否则可复用并添加任务类型标记)。

### 2.2. `middleware`

中间件层负责处理请求和响应流中的通用逻辑和特定特性。其设计和使用遵循 `middleware/BUILDER_USAGE.md` 中定义的规范。

**核心组件包括：**

- **`MiddlewareBuilder`**: 一个通用的、提供流式API的类，用于动态构建中间件链。它支持从基础链开始，根据条件添加、插入、替换或移除中间件。
- **`applyCompletionsMiddlewares`**: 负责接收 `MiddlewareBuilder` 构建的链并按顺序执行，专门用于 Completions 流程。
- **`MiddlewareRegistry`**: 集中管理所有可用中间件的注册表，提供统一的中间件访问接口。
- **各种独立的中间件模块** (存放于 `common/`, `core/`, `feat/` 子目录)。

#### 2.2.1. `middlewareTypes.ts`

- 定义中间件的核心类型，如 `AiProviderMiddlewareContext` (扩展后包含 `_apiClientInstance` 和 `_coreRequest`)、`MiddlewareAPI`、`CompletionsMiddleware` 等。

#### 2.2.2. 核心中间件 (`middleware/core/`)

- **`TransformCoreToSdkParamsMiddleware.ts`**: 调用 `ApiClient.getRequestTransformer()` 将 `CoreRequest` 转换为特定 SDK 的参数，并存入上下文。
- **`RequestExecutionMiddleware.ts`**: 调用 `ApiClient.getSdkInstance()` 获取 SDK 实例，并使用转换后的参数执行实际的 API 调用，返回原始 SDK 流。
- **`StreamAdapterMiddleware.ts`**: 将各种形态的原始 SDK 流 (如异步迭代器) 统一适配为 `ReadableStream<RawSdkChunk>`。
  - **`RawSdkChunk`**：指特定AI提供商SDK在流式响应中返回的、未经应用层统一处理的原始数据块格式 (例如 OpenAI 的 `ChatCompletionChunk`，Gemini 的 `GenerateContentResponse` 中的部分等)。
- **`RawSdkChunkToAppChunkMiddleware.ts`**: (新增) 消费 `ReadableStream<RawSdkChunk>`，在其内部对每个 `RawSdkChunk` 调用 `ApiClient.getResponseChunkTransformer()`，将其转换为一个或多个基础的应用层 `Chunk` 对象，并输出 `ReadableStream<Chunk>`。

#### 2.2.3. 特性中间件 (`middleware/feat/`)

这些中间件消费由 `ResponseTransformMiddleware` 输出的、相对标准化的 `Chunk` 流，并处理更复杂的逻辑。

- **`ThinkingTagExtractionMiddleware.ts`**: 检查 `TextDeltaChunk`，解析其中可能包含的 `<think>...</think>` 文本内嵌标签，生成 `ThinkingDeltaChunk` 和 `ThinkingCompleteChunk`。
- **`ToolUseExtractionMiddleware.ts`**: 检查 `TextDeltaChunk`，解析其中可能包含的 `<tool_use>...</tool_use>` 文本内嵌标签，生成工具调用相关的 Chunk。如果 `ApiClient` 输出了原生工具调用数据，此中间件也负责将其转换为标准格式。

#### 2.2.4. 核心处理中间件 (`middleware/core/`)

- **`TransformCoreToSdkParamsMiddleware.ts`**: 调用 `ApiClient.getRequestTransformer()` 将 `CoreRequest` 转换为特定 SDK 的参数，并存入上下文。
- **`SdkCallMiddleware.ts`**: 调用 `ApiClient.getSdkInstance()` 获取 SDK 实例，并使用转换后的参数执行实际的 API 调用，返回原始 SDK 流。
- **`StreamAdapterMiddleware.ts`**: 将各种形态的原始 SDK 流统一适配为标准流格式。
- **`ResponseTransformMiddleware.ts`**: 将原始 SDK 响应转换为应用层标准 `Chunk` 对象。
- **`TextChunkMiddleware.ts`**: 处理文本相关的 Chunk 流。
- **`ThinkChunkMiddleware.ts`**: 处理思考相关的 Chunk 流。
- **`McpToolChunkMiddleware.ts`**: 处理工具调用相关的 Chunk 流。
- **`WebSearchMiddleware.ts`**: 处理 Web 搜索相关逻辑。

#### 2.2.5. 通用中间件 (`middleware/common/`)

- **`LoggingMiddleware.ts`**: 请求和响应日志。
- **`AbortHandlerMiddleware.ts`**: 处理请求中止。
- **`FinalChunkConsumerMiddleware.ts`**: 消费最终的 `Chunk` 流，通过 `context.onChunk` 回调通知应用层实时数据。
  - **累积数据**：在流式处理过程中，累积关键数据，如文本片段、工具调用信息、`usage`/`metrics` 等。
  - **结束 `Promise`**：当输入流结束时，使用累积的聚合结果来完成整个处理流程。
  - 在流结束时，发送包含最终累加信息的完成信号。

### 2.3. `types/chunk.ts`

- 定义应用全局统一的 `Chunk` 类型及其所有变体。这包括基础类型 (如 `TextDeltaChunk`, `ThinkingDeltaChunk`)、SDK原生数据传递类型 (如 `RawToolCallChunk`, `RawFinishChunk` - 作为 `ApiClient` 转换的中间产物)，以及功能性类型 (如 `McpToolCallRequestChunk`, `WebSearchCompleteChunk`)。

## 3. 核心执行流程 (以 `AiCoreService.executeCompletions` 为例)

```markdown
**应用层 (例如 UI 组件)**
||
\\/
**`AiProvider.completions` (`aiCore/index.ts`)**
(1. prepare ApiClient instance. 2. use `CompletionsMiddlewareBuilder.withDefaults()` to build middleware chain. 3. call `applyCompletionsMiddlewares`)
||
\\/
**`applyCompletionsMiddlewares` (`middleware/composer.ts`)**
(接收构建好的链、ApiClient实例、原始SDK方法，开始按序执行中间件)
||
\\/
**[ 预处理阶段中间件 ]**
(例如: `FinalChunkConsumerMiddleware`, `TransformCoreToSdkParamsMiddleware`, `AbortHandlerMiddleware`)
|| (Context 中准备好 SDK 请求参数)
\\/
**[ 处理阶段中间件 ]**
(例如: `McpToolChunkMiddleware`, `WebSearchMiddleware`, `TextChunkMiddleware`, `ThinkingTagExtractionMiddleware`)
|| (处理各种特性和Chunk类型)
\\/
**[ SDK调用阶段中间件 ]**
(例如: `ResponseTransformMiddleware`, `StreamAdapterMiddleware`, `SdkCallMiddleware`)
|| (输出: 标准化的应用层Chunk流)
\\/
**`FinalChunkConsumerMiddleware` (核心)**
(消费最终的 `Chunk` 流, 通过 `context.onChunk` 回调通知应用层, 并在流结束时完成处理)
||
\\/
**`AiProvider.completions` 返回 `Promise<CompletionsResult>`**
```

## 4. 建议的文件/目录结构

```
src/renderer/src/
└── aiCore/
    ├── clients/
    │   ├── openai/
    │   ├── gemini/
    │   ├── anthropic/
    │   ├── BaseApiClient.ts
    │   ├── ApiClientFactory.ts
    │   ├── AihubmixAPIClient.ts
    │   ├── index.ts
    │   └── types.ts
    ├── middleware/
    │   ├── common/
    │   ├── core/
    │   ├── feat/
    │   ├── builder.ts
    │   ├── composer.ts
    │   ├── index.ts
    │   ├── register.ts
    │   ├── schemas.ts
    │   ├── types.ts
    │   └── utils.ts
    ├── types/
    │   ├── chunk.ts
    │   └── ...
    └── index.ts
```

## 5. 迁移和实施建议

- **小步快跑，逐步迭代**：优先完成核心流程的重构（例如 `completions`），再逐步迁移其他功能（`translate` 等）和其他 Provider。
- **优先定义核心类型**：`CoreRequest`, `Chunk`, `ApiClient` 接口是整个架构的基石。
- **为 `ApiClient` 瘦身**：将现有 `XxxProvider` 中的复杂逻辑剥离到新的中间件或 `AiCoreService` 中。
- **强化中间件**：让中间件承担起更多解析和特性处理的责任。
- **编写单元测试和集成测试**：确保每个组件和整体流程的正确性。

此架构旨在提供一个更健壮、更灵活、更易于维护的 AI 功能核心，支撑 Cherry Studio 未来的发展。

## 6. 迁移策略与实施建议

本节内容提炼自早期的 `migrate.md` 文档，并根据最新的架构讨论进行了调整。

**目标架构核心组件回顾：**

与第 2 节描述的核心组件一致，主要包括 `XxxApiClient`, `AiCoreService`, 中间件链, `CoreRequest` 类型, 和标准化的 `Chunk` 类型。

**迁移步骤：**

**Phase 0: 准备工作和类型定义**

1.  **定义核心数据结构 (TypeScript 类型)：**
    - `CoreCompletionsRequest` (Type)：定义应用内部统一的对话请求结构。
    - `Chunk` (Type - 检查并按需扩展现有 `src/renderer/src/types/chunk.ts`)：定义所有可能的通用Chunk类型。
    - 为其他API（翻译、总结）定义类似的 `CoreXxxRequest` (Type)。
2.  **定义 `ApiClient` 接口：** 明确 `getRequestTransformer`, `getResponseChunkTransformer`, `getSdkInstance` 等核心方法。
3.  **调整 `AiProviderMiddlewareContext`：**
    - 确保包含 `_apiClientInstance: ApiClient<any,any,any>`。
    - 确保包含 `_coreRequest: CoreRequestType`。
    - 考虑添加 `resolvePromise: (value: AggregatedResultType) => void` 和 `rejectPromise: (reason?: any) => void` 用于 `AiCoreService` 的 Promise 返回。

**Phase 1: 实现第一个 `ApiClient` (以 `OpenAIApiClient` 为例)**

1.  **创建 `OpenAIApiClient` 类：** 实现 `ApiClient` 接口。
2.  **迁移SDK实例和配置。**
3.  **实现 `getRequestTransformer()`：** 将 `CoreCompletionsRequest` 转换为 OpenAI SDK 参数。
4.  **实现 `getResponseChunkTransformer()`：** 将 `OpenAI.Chat.Completions.ChatCompletionChunk` 转换为基础的 `
