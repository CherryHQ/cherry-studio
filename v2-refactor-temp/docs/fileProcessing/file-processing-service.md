# File Processing Unified Task Refactor

## 1. 文档目的

这份文档是 `src/main/services/fileProcessing` 下一轮重构的设计基线。

当前代码已经有一版 Main-side file-processing service，但它不是定稿。后续实现可以围绕本文重新组织接口、任务模型和内部服务边界，不需要维护旧的 split API 作为兼容目标。

本文覆盖：

1. file-processing 的模块边界
2. 统一任务式 API
3. artifact 结果模型
4. 任务状态、取消、事件和落盘语义
5. processor 与配置边界
6. 本轮重构明确不做的内容

本文不直接描述 UI 交互，也不要求立刻完成 Renderer 切流。

---

## 2. 设计定位

`file-processing` 是 Main 进程里的内容提取 / 内容转换能力模块。

当前明确支持两类使用场景：

1. 知识库上传 PDF / Word 等文档前，先把文档转换成 Markdown。
2. 翻译等上层功能上传图片后，把图片 OCR 成文字。

这两个场景都应该收口到同一套底层能力，但 `file-processing` 本身不应该理解知识库或翻译业务。

换句话说：

1. `file-processing` 负责把输入文件处理成可消费的结果 artifact。
2. `KnowledgeService` 或其他上层 service 负责决定何时处理、如何展示进度、如何入库、如何切 chunk、如何做 embedding。
3. 翻译页面或翻译业务负责把 OCR 文本插入输入框、发起翻译或展示错误。

因此，底层接口不使用 `preprocessKnowledgeFile`、`translateOcr` 这类业务命名，而使用 `startTask`、`getTask`、`cancelTask` 这类能力命名。

---

## 3. Canonical Terms

| 术语 | 含义 |
| --- | --- |
| File Processing | 文件内容提取 / 转换能力集合，不代表某个具体业务流程 |
| Processor | 一个可执行文件处理能力的处理器，例如 `tesseract`、`paddleocr`、`mineru`、`doc2x` |
| Feature | Processor 暴露的能力类型，当前只有 `image_to_text` 和 `document_to_markdown` |
| Capability | Processor 对某个 Feature 的支持声明，包括输入类型、输出类型和默认 API 配置 |
| FileProcessingTask | 一次 processor execution，由 Main 进程生成统一 `taskId` 跟踪 |
| Artifact | 任务完成后产出的结果项，例如内联 text 或落盘 markdown file |
| Provider task | 第三方 provider 自己的任务句柄，例如远程 OCR / Markdown 服务返回的 job id；只属于 Main 内部实现细节 |
| Runtime state | 任务状态、abort controller、远程 query context、in-flight query 等 Main 进程内存态协调数据 |

需要避免的命名：

1. 不把底层 `image_to_text` 命名成 `translate_ocr`。
2. 不把底层 `document_to_markdown` 命名成 `knowledge_preprocess`。
3. 不在对外契约里暴露 `providerTaskId` 或 provider-specific query context。

---

## 4. Public Main-side Contract

统一对外能力面：

1. `startTask({ feature, file, processorId? })`
2. `getTask({ taskId })`
3. `cancelTask({ taskId })`

推荐 IPC channel：

1. `file-processing:start-task`
2. `file-processing:get-task`
3. `file-processing:cancel-task`

旧 file-processing IPC 不保留兼容包装：

1. `file-processing:extract-text`
2. `file-processing:start-markdown-conversion-task`
3. `file-processing:get-markdown-conversion-task-result`

这些旧接口应在实现重构时被替换，而不是继续作为新 API 的 facade。

### 4.1 startTask

`startTask` 接收：

1. `feature`: `image_to_text` 或 `document_to_markdown`
2. `file`: `FileMetadata`
3. `processorId`: 可选；未传时按 feature 读取默认 processor preference

`startTask` 返回任务启动结果：

```ts
type FileProcessingTaskStartResult = {
  taskId: string
  feature: FileProcessorFeature
  status: 'pending' | 'processing'
  progress: number
  processorId: FileProcessorId
}
```

约束：

1. Main 进程必须生成统一 `taskId`。
2. 调用方不直接持有 provider task id。
3. 如果没有显式 `processorId`，且对应 feature 没有配置默认 processor，直接 fail fast。
4. 如果指定 processor 不支持该 feature，直接 fail fast。
5. 如果 `file.type` 不符合 capability 的输入类型，直接 fail fast。

### 4.2 getTask

`getTask` 接收：

```ts
type GetFileProcessingTaskInput = {
  taskId: string
}
```

`getTask` 返回当前任务快照：

```ts
type FileProcessingTaskResult =
  | FileProcessingTaskPendingResult
  | FileProcessingTaskProcessingResult
  | FileProcessingTaskCompletedResult
  | FileProcessingTaskFailedResult
  | FileProcessingTaskCancelledResult
```

`getTask` 是查询入口，同时允许 task service 在查询时推进 remote-poll provider 的状态。

约束：

1. 对 remote-poll provider，同一个 `taskId` 的并发查询应在 Main 内部 dedupe。
2. 对 background provider，查询只返回内存中已知状态，不重复启动任务。
3. completed / failed / cancelled 是终态，重复查询返回同一终态快照，直到 TTL 清理。
4. app 重启后任务上下文失效；调用方应重新发起任务。

### 4.3 cancelTask

`cancelTask` 接收：

```ts
type CancelFileProcessingTaskInput = {
  taskId: string
}
```

`cancelTask` 返回取消后的任务快照。

取消语义：

1. pending / processing 任务进入 `cancelled`。
2. 本地 background execution 必须 abort。
3. remote-poll query 必须停止本地轮询。
4. 第三方远程平台上的 provider task 只做 best effort，不承诺真正远程取消。
5. completed / failed / cancelled 任务再次 cancel 时保持原终态并返回当前快照。
6. 不存在的 `taskId` 直接报错。

---

## 5. Task State Model

任务状态统一为：

1. `pending`
2. `processing`
3. `completed`
4. `failed`
5. `cancelled`

基础字段：

```ts
type FileProcessingTaskBase = {
  taskId: string
  feature: FileProcessorFeature
  processorId: FileProcessorId
  status: FileProcessingTaskStatus
  progress: number
}
```

终态字段：

```ts
type FileProcessingTaskCompletedResult = FileProcessingTaskBase & {
  status: 'completed'
  progress: 100
  artifacts: FileProcessingArtifact[]
}

type FileProcessingTaskFailedResult = FileProcessingTaskBase & {
  status: 'failed'
  error: string
}

type FileProcessingTaskCancelledResult = FileProcessingTaskBase & {
  status: 'cancelled'
  reason?: string
}
```

实现要求：

1. `progress` 统一 clamp 到 0-100 的整数。
2. `completed` 必须有至少一个 artifact。
3. `failed` 必须有非空 error。
4. `cancelled` 不应伪装成 failed。
5. provider-specific status 必须映射到以上统一状态。

---

## 6. Artifact Model

任务结果统一通过 `artifacts` 表达，而不是为每个 feature 增加专用字段。

当前最小 artifact 类型：

```ts
type FileProcessingArtifact =
  | {
      kind: 'text'
      format: 'plain'
      text: string
    }
  | {
      kind: 'file'
      format: 'markdown'
      path: string
    }
```

当前 feature 到 artifact 的映射：

| Feature | Artifact |
| --- | --- |
| `image_to_text` | `{ kind: 'text', format: 'plain', text }` |
| `document_to_markdown` | `{ kind: 'file', format: 'markdown', path }` |

设计取向：

1. OCR 文本以内联 text artifact 返回，避免翻译场景还要额外读文件。
2. Markdown 文档以 file artifact 返回，因为大文档、图片资源和 zip 解包结果更适合落盘。
3. artifact 是统一结果容器，不等于所有结果都用同一种存储方式。
4. 未来如果需要结构化 OCR、表格、图片资源或多文件输出，应扩展 artifact union，而不是把 provider-specific 字段塞进 task 顶层。

---

## 7. Service 分层

目标分层：

1. `FileProcessingOrchestrationService`
   - 生命周期 service
   - 注册 IPC handler
   - 做 payload Zod 校验
   - 调用 task service
   - 不持有 task store
2. `FileProcessingTaskService`
   - 生命周期 service
   - 生成 `taskId`
   - 持有 Main 进程内存 task store
   - 管理 background execution、remote-poll query、dedupe、TTL、cancel
   - 产出统一 artifact
   - 暴露内部 `onTaskChanged` event
3. Processor 层
   - 以 processor 为第一层组织单元
   - 按 capability feature 暴露 handler
   - 不暴露 provider task id 给调用方
   - 不依赖旧 knowledge preprocess service 或旧 OCR facade
4. Processor-owned runtime 层
   - 只在某个 processor 真的拥有生命周期资源时出现
   - 承载 worker、队列、池、锁、idle release、stop / destroy cleanup 等 processor-owned runtime state
   - 当前只有 `tesseract` 需要 lifecycle runtime

`FileProcessingTaskService` 应是任务状态的 source of truth。

`FileProcessingOrchestrationService` 只是对外入口，不应该重复维护任务状态或实现 provider 细节。

### 7.1 Processor-first 目录结构

`fileProcessing` 内部目录应以 processor 为第一层组织轴心，而不是以 `ocr` / `markdown` feature 分类。

目标结构：

```text
src/main/services/fileProcessing/
  config/
  persistence/
  processors/
    registry.ts
    types.ts
    tesseract/
      index.ts
      types.ts
      image-to-text/
        handler.ts
        prepare.ts
        __tests__/
      runtime/
        TesseractRuntimeService.ts
        types.ts
        __tests__/
    paddleocr/
      index.ts
      types.ts
      utils.ts
      image-to-text/
        handler.ts
      document-to-markdown/
        handler.ts
    mineru/
      document-to-markdown/
        handler.ts
    doc2x/
      document-to-markdown/
        handler.ts
    mistral/
      image-to-text/
        handler.ts
    system/
      image-to-text/
        handler.ts
    ovocr/
      image-to-text/
        handler.ts
    open-mineru/
      document-to-markdown/
        handler.ts
  task/
  utils/
```

目录规则：

1. processor 目录名使用 processor id，例如 `tesseract`、`paddleocr`、`open-mineru`。
2. feature 子目录使用 kebab-case，例如 `image-to-text`、`document-to-markdown`。
3. shared feature enum 使用 `image_to_text` / `document_to_markdown`，目录名只是对应的 kebab-case 形式。
4. 同一个 processor 的跨 feature 共享代码放在 processor 根目录，例如 `processors/paddleocr/types.ts`、`processors/paddleocr/utils.ts`。
5. 只有跨多个 processor 都适用的 helper 才放在 file-processing 顶层 `utils/`。
6. 重构时应一次性移除旧的顶层 `ocr/`、`markdown/`、`runtime/services/` 结构，不保留长期桥接目录。

### 7.2 Processor Registry

processor handler 通过静态 registry 注册。

推荐 shape：

```ts
processorRegistry[processorId].capabilities[feature]
```

设计约束：

1. registry 以 processor 为第一层 map，和目录结构一致。
2. 不做目录自动扫描，避免 Electron / Vite 打包和类型推断变复杂。
3. 不维护 processor map 和 feature map 两套 source of truth。
4. 测试必须校验 `PRESETS_FILE_PROCESSORS` 声明的 capability 与 registry handler 一致：
   - preset 有 capability，registry 必须有 handler
   - registry 不应声明 preset 不支持的 capability
5. `FileProcessingTaskService` 解析 processor config 后，通过 registry 找到目标 capability handler。

### 7.3 Capability Handler Contract

processor module 对 task service 暴露 capability handler，而不是继续暴露 `OcrProvider` / `MarkdownProvider` 两套接口。

handler 使用 discriminated execution mode：

1. `mode: 'background'`
2. `mode: 'remote-poll'`

handler 方法分层：

1. `prepare(file, config, signal?)`
   - 做 provider-specific fail-fast 校验
   - 解析 processor options / capability config
   - 返回后续执行需要的 prepared context
2. background handler
   - `execute(context, executionContext)`
   - 用于本地 OCR、同步 API 或没有远程任务查询模型的 processor
3. remote-poll handler
   - `startRemote(context)`
   - `pollRemote(remoteContext)`
   - 用于天然支持远程 start / query 的 processor

设计约束：

1. `prepare` 不创建本地 task record；task record 仍由 `FileProcessingTaskService` 创建。
2. `prepare` 可以在 `startTask` 期间 fail fast，例如缺 path、缺 API key、processor option 无效、file type 不匹配。
3. provider task id、query context、remote context 都只保存在 Main 进程内部 task record。
4. handler 输出不直接作为 IPC result；task service 负责统一映射成 artifacts。
5. capability handler 不应持有跨任务可变全局状态；需要生命周期状态时，交给 processor-owned runtime service。

---

## 8. Execution Model

统一任务 API 不要求所有 processor 内部都变成同一种执行方式。

Task service 内部允许两类执行模式：

1. background execution
2. remote poll

### 8.1 background execution

适用于本地 OCR、同步 API 调用、或 processor 自身没有远程任务查询模型的能力。

典型场景：

1. `tesseract` 图片 OCR
2. `system` 图片 OCR
3. `ovocr` 图片 OCR
4. `mistral` 图片 OCR
5. `open-mineru` 这类由 Main 启动并等待的后台执行

行为：

1. `startTask` 创建本地 task record 后立即返回。
2. Task service 在后台执行 capability handler。
3. handler 成功后由 task service 转成 artifacts。
4. handler 抛错后 task 进入 `failed`。
5. caller cancel 或 service stop 时 abort。

### 8.2 remote poll

适用于 processor 天然支持“启动远程任务 + 查询远程任务结果”的能力。

典型场景：

1. `mineru`
2. `paddleocr` 的文档解析能力
3. `doc2x`

行为：

1. `startTask` 创建本地 `taskId`。
2. handler `startRemote` 返回内部 provider task id 和 query context。
3. Task service 把 provider task id 绑定到本地 task record。
4. 调用方后续只用本地 `taskId` 查询。
5. `getTask` 可推进一次远程查询并更新 task store。
6. 如果 remote task 已完成但 artifact 下载或落盘失败，任务进入 `failed`；调用方可重新发起任务。

### 8.3 OCR 任务化

即使图片 OCR 通常很快，也必须走统一 `FileProcessingTask`。

代价：

1. 翻译 OCR 场景从直接 await 文本变成 start/query。
2. Renderer 需要适配 task polling。

收益：

1. OCR 和 Markdown 使用同一套状态、失败、取消、进度模型。
2. 上层服务可以用同一种方式编排文件处理。
3. 未来加入更慢的 OCR provider 时不需要再改对外契约。

---

## 9. Internal Events

`FileProcessingTaskService` 应使用 lifecycle 的 `Emitter<T>` / `Event<T>` 暴露任务变化事件。

推荐形式：

```ts
private readonly _onTaskChanged = new Emitter<FileProcessingTaskResult>()
public readonly onTaskChanged: Event<FileProcessingTaskResult> = this._onTaskChanged.event
```

事件语义：

1. task 创建后 fire 一次 pending / processing 快照。
2. progress 变化时 fire 当前快照。
3. completed / failed / cancelled 时 fire 终态快照。
4. listener 错误不影响 task service。
5. event 只用于 Main 进程内 service 协调。

重要边界：

1. `Emitter/Event` 不直接等于 Renderer IPC 推送。
2. 本轮不设计 Renderer 订阅协议、多窗口广播或 UI task center。
3. Renderer / preload 暂时仍以 `getTask` 查询为准。
4. 如果后续需要实时 UI 推送，可以在 Orchestration 或专门的 bridge service 中订阅 `onTaskChanged` 后再转发 IPC。

不使用 `Signal` 表达 task 状态，因为 task 状态是 repeatable event，不是一次性初始化完成信号。

---

## 10. Data Ownership

file-processing 相关数据按职责分层：

1. Processor preset
   - 位于 `packages/shared/data/presets/file-processing.ts`
   - 属于内建 shared metadata
   - 不属于 DataApi / Cache / Preference 记录
2. 用户默认 processor 与 override
   - 位于 Preference
   - 当前键位继续使用：
     - `feature.file_processing.default_document_to_markdown`
     - `feature.file_processing.default_image_to_text`
     - `feature.file_processing.overrides`
3. 任务运行时状态
   - 位于 `FileProcessingTaskService` 内存 store
   - 包括 task record、provider task id、query context、abort controller、in-flight query、background execution
   - 不落 DataApi，不镜像到 Cache / SharedCache
4. 最终 file artifact
   - 落盘到 `application.getPath('feature.files.data')/fileId/file-processing/taskId`
   - 由 task completed artifact 返回 path

DataApi 边界：

1. 当前没有 file-processing task 数据表。
2. task state 是 runtime coordination state，不是 SQLite-backed business data。
3. 因此不新增 DataApi endpoint。

Cache 边界：

1. 不新增 shared cache task mirror。
2. 不把 task progress 当跨窗口共享状态存 Cache。
3. 如果上层业务需要聚合进度，应由上层业务维护自己的状态。

---

## 11. Task Retention

任务状态只在当前 Main 进程会话内有效。

默认保留策略：

1. task store 内存态。
2. completed / failed / cancelled 终态 task 在 TTL 到期前可重复查询。
3. pending / processing task 如果长期无访问，也会被 TTL 清理并 abort。
4. 每次 `getTask` 可 touch `updatedAt`，持续轮询会延长保留时间。
5. service stop 时 abort 所有非终态任务并清理内存。
6. app restart 后不恢复 task store。

可以沿用当前默认值：

1. task TTL：10 分钟
2. prune interval：5 分钟

最终 artifact 文件不会因为 task TTL 自动删除。artifact 生命周期由 feature 文件数据目录和上层业务清理策略决定。

---

## 12. Input Validation

`FileProcessingOrchestrationService` / task service 必须做基础准入校验。

基础校验包括：

1. IPC payload 使用 Zod schema 校验。
2. `feature` 必须是 `FILE_PROCESSOR_FEATURES` 中的值。
3. `processorId` 如果传入，必须是 `FILE_PROCESSOR_IDS` 中的值。
4. `file` 必须符合共享 `FileMetadataSchema`。
5. processor 必须支持请求的 feature。
6. `file.type` 必须匹配 capability `inputs`，例如：
   - `image_to_text` 接收 `image`
   - `document_to_markdown` 接收 `document`

不在 facade 层做的校验：

1. PDF、DOCX、PNG、JPG 等细分扩展名白名单。
2. provider 特定模型限制。
3. provider 特定 API key / api host / path 可用性。
4. 远程服务是否真的支持某个文档格式。

这些细节由 provider 自己负责，并把错误映射为 failed task 或 startTask fail-fast。

---

## 13. Processor Boundary

file-processing processor 应在 `src/main/services/fileProcessing/processors` 内闭环。

允许复用：

1. 通用底层工具，例如 `loadOcrImage`
2. 第三方 SDK / 原生库
3. shared preset / preference 类型
4. `application.getPath(...)`
5. processor-owned lifecycle runtime service，例如 `processors/tesseract/runtime/TesseractRuntimeService`

不应依赖：

1. 旧 knowledge preprocess service
2. 旧 `src/main/services/ocr` facade
3. Renderer store / Redux / Dexie / ElectronStore
4. processor-specific 全局单例状态，除非有 lifecycle runtime service 管理

Processor handler 输出不直接返回给 IPC 调用方，而由 task service 统一转换成 artifact。

Processor 内部错误应尽量包含明确上下文，但不要把 secret、API key、token 写入错误或日志。

### 13.1 Runtime Ownership Criteria

`runtime` 不是 provider utils 的新名字。只有 processor 执行时需要长期持有、可复用、需要 lifecycle 清理的资源管理层，才应该建立 processor-owned runtime。

满足以下任意两条时，才考虑 runtime：

1. 持有长寿命 worker、process、pool、connection 或模型加载状态。
2. 需要 lifecycle `onStop` / `onDestroy` 清理。
3. 有队列、池、锁或 idle release。
4. 初始化成本高，需要跨任务复用。
5. 任务取消不能只靠单个请求的 `AbortSignal` 解决。

当前判断：

1. `tesseract`
   - 需要 runtime service。
   - 原因是它持有 `tesseract.js` worker、串行队列、language-key worker reuse、idle release 和 lifecycle cleanup。
2. `ovocr`
   - 暂时不建 runtime service。
   - 它当前是一次性 child process execution，临时目录、脚本执行和结果解析留在 `processors/ovocr/image-to-text` 内。
   - 未来如果多个 processor 都需要外部进程生命周期管理，再迁入统一 process management。
3. `open-mineru`
   - 暂时不建 runtime service。
   - 当前只调用已经运行的本地 HTTP service；除非未来由 Cherry 负责启动 / 停止 OpenMinerU 服务本身。
4. `mineru`、`doc2x`、`paddleocr`、`mistral`
   - 暂时不建 runtime service。
   - 它们是远程 API processor。
5. `system`
   - 暂时不建 runtime service。
   - 当前只调用系统 OCR API，不持有长寿命资源。

本轮不抽通用 `ProcessManagerService` 或 `ProcessRunner`。

原因：

1. Tesseract worker、OV OCR script、OpenMinerU HTTP call 不是同一种 runtime。
2. 当前没有足够重复的外部进程需求来支撑通用进程平台。
3. 过早抽象会把 file-processing 重构扩大成基础设施工程。
4. 如果未来出现多个外部二进制 / utility process processor，再把 process lifecycle 从 processor 内迁到统一 ProcessManager。

### 13.2 Tesseract Runtime Boundary

`TesseractRuntimeService` 应移动到 `processors/tesseract/runtime/`，并只暴露 runtime-level API。

推荐 public input：

```ts
type TesseractRuntimeInput = {
  file: ImageFileMetadata
  langs: LanguageCode[]
  signal?: AbortSignal
}
```

边界：

1. `processors/tesseract/image-to-text/prepare.ts` 负责从 `FileProcessorMerged` 解析 langs 和 options。
2. `TesseractRuntimeService` 不接收 `FileProcessorMerged`，也不 import image-to-text handler 的 private types。
3. `TesseractRuntimeService` 可以保留图片大小校验和 `loadOcrImage`，因为它们属于 worker 执行前的资源保护和输入加载。
4. runtime 继续保持当前行为：
   - 单 shared worker
   - 按 langs key 复用
   - `PQueue` concurrency 1
   - idle release
   - stop / destroy 时 abort pending work 并 terminate worker
5. 不在本轮引入 language worker pool 或 per-task worker。

---

## 14. Result Persistence

Markdown conversion 的文件 artifact 继续由 Main 进程稳定落盘。

落盘规则：

1. 路径使用 `application.getPath('feature.files.data')` 派生。
2. 结果目录按 `fileId/taskId` 分桶。
3. Markdown 主文件归一为稳定文件名，例如 `output.md`。
4. zip 结果必须做 entry path 规范化和安全校验，防止 zip slip。
5. 写入结果目录时继续使用原子替换策略。

OCR text artifact 不落盘，直接以内联文本返回。

如果未来 text artifact 可能很大，再单独引入 size threshold 或 file artifact fallback；本轮不提前设计这个分支。

---

## 15. Lifecycle

服务选择：

1. `FileProcessingOrchestrationService`：生命周期 service，因为它注册 IPC handler。
2. `FileProcessingTaskService`：生命周期 service，因为它持有任务 store、timer、abort controller 和 internal event。
3. `processors/tesseract/runtime/TesseractRuntimeService`：继续作为生命周期 service，因为它管理长寿命 worker、队列和 idle release。
4. processor helper / pure utility：保持普通函数或 direct-import singleton，不引入无意义 lifecycle 层。

依赖关系：

1. `FileProcessingOrchestrationService` 依赖 `FileProcessingTaskService`。
2. `FileProcessingTaskService` 不直接访问 `TesseractRuntimeService`；Tesseract image-to-text handler 在执行时通过 `application.get('TesseractRuntimeService')` 获取 runtime。
3. 不需要声明对 BeforeReady 服务的 cross-phase `@DependsOn`；Preference 等 BeforeReady 初始化顺序由 lifecycle 系统保证。

清理要求：

1. `onStop` abort 所有非终态 execution / query。
2. 等待后台 promise settle 后清空 in-flight maps。
3. 清理 prune timer。
4. owned `Emitter` 在 `onDestroy` dispose，不作为 stop disposable 清掉。

---

## 16. Legacy And Scope

本轮 file-processing 重构不做以下事情：

1. 不完成 Renderer 全量切流。
2. 不删除旧 `window.api.ocr`。
3. 不删除旧 `src/main/services/ocr`。
4. 不把旧 OCR IPC 桥接到新 task API。
5. 不完成 KnowledgeService 对新 artifact 的消费、入库和 chunk 联调。
6. 不建立统一 UI task center。
7. 不新增 DataApi task table。

短期允许并存：

1. 新 file-processing task API
2. 旧 OCR renderer/main 调用链
3. 尚未切流的知识库旧 preprocess 调用链

但是新 file-processing API 自身不保留旧接口包装。

后续 PR 应分别处理：

1. Renderer / preload 对 `startTask/getTask/cancelTask` 的正式接入。
2. 翻译 OCR 从旧 `window.api.ocr` 切到 file-processing task。
3. KnowledgeService 消费 Markdown file artifact。
4. 删除旧 OCR service 与旧 preprocess provider。
5. 清理旧 i18n、设置页和 migration 中不再需要的兼容逻辑。

---

## 17. Feature Rename Implementation Notes

当前 feature 名应从旧的行为描述改成 I/O 描述：

| Old | New | Handler name | Directory |
| --- | --- | --- | --- |
| `text_extraction` | `image_to_text` | `imageToText` | `image-to-text/` |
| `markdown_conversion` | `document_to_markdown` | `documentToMarkdown` | `document-to-markdown/` |

命名理由：

1. `text_extraction` 太宽，容易和 PDF 原生文本提取、Word 解析、任意文档读文本混淆。
2. `image_to_text` 明确表达输入是 image、输出是 text，不把 OCR 这个实现方式写进 feature 名。
3. `document_to_markdown` 明确表达输入是 document、输出是 markdown，比泛化的 conversion 更具体。
4. 两个 feature 都以 I/O 命名，不携带知识库或翻译业务语义。

实现时必须同步修改：

1. `packages/shared/data/preference/preferenceTypes.ts`
   - `FILE_PROCESSOR_FEATURES` 改成 `['image_to_text', 'document_to_markdown']`。
2. `packages/shared/data/presets/file-processing.ts`
   - capability schema 从旧 literal 改成新 literal。
   - preset capability 的 `feature` 字段全部改名。
   - capability override schema key 从旧 feature key 改成新 feature key。
3. preference schema / default preference keys
   - 默认 processor key 改成 `feature.file_processing.default_image_to_text`。
   - 默认 processor key 改成 `feature.file_processing.default_document_to_markdown`。
   - `feature.file_processing.overrides` 内 capability override key 使用新 feature 名。
4. `v2-refactor-temp/tools/data-classify/data/classification.json`
   - 更新目标 key，之后通过 data-classify toolchain 重新生成 preference schema 和 mapping。
5. v2 migration mappings / tests
   - 更新 file-processing override merge 中的 feature 名。
   - 更新 default processor mapping 的 target key。
   - 更新相关单测断言。
6. file-processing service / processor code
   - resolver、registry、task payload schema、capability handler、tests 全部使用新 feature 名。

本轮不考虑旧数据兼容性：

1. 不保留旧 preference key 到新 preference key 的 runtime fallback。
2. 不在 service 里接受旧 feature 名 alias。
3. 不在 override 读取时兼容旧 `text_extraction` / `markdown_conversion` capability key。
4. migration / data-classify 只需要生成新 schema 和新目标 key，不需要为旧 v2 中间数据做兼容迁移。
5. 如果本分支已有旧名写入的开发期数据，可以直接清理或重新迁移；这属于 v2 开发期 schema drift。

---

## 18. Testing Baseline

共享类型 / schema 测试：

1. `startTask` payload 校验
2. `getTask` payload 校验
3. `cancelTask` payload 校验
4. `FileProcessingTaskResult` discriminated union
5. `FileProcessingArtifact` discriminated union

Task service 测试：

1. 启动 `image_to_text` task 并返回 text artifact。
2. 启动 `document_to_markdown` task 并返回 markdown file artifact。
3. remote-poll task 并发查询 dedupe。
4. background task progress 更新。
5. provider 抛错后进入 failed。
6. cancel pending / processing task 后进入 cancelled。
7. cancel completed task 保持 completed。
8. 缺默认 processor 时 fail fast。
9. processor 不支持 feature 时 fail fast。
10. file type 不匹配 capability inputs 时 fail fast。
11. TTL prune 会 abort 非终态 task。
12. `onTaskChanged` 在创建、进度变化和终态时 fire。

Registry 测试：

1. 每个 preset capability 都有对应 registry handler。
2. registry 不声明 preset 不支持的 capability。
3. `processorRegistry[processorId].capabilities[feature]` 可以被 task service 按 processor + feature 找到。

Persistence 测试：

1. markdown content 原子写入 `output.md`。
2. zip result 安全解包并归一 markdown path。
3. unsafe zip entry 被拒绝。
4. 同一 file 不同 taskId 的结果目录互不覆盖。

Processor 测试：

1. processor-specific schema / request / result parsing 保持单测覆盖。
2. processor feature handler 不测试 task store 细节。
3. task service 不测试第三方真实网络。
4. processor-specific 测试贴近实现目录，例如 `processors/tesseract/runtime/__tests__`、`processors/paddleocr/image-to-text/__tests__`。
5. Tesseract runtime 测试继续覆盖 lifecycle phase、worker reuse、queued work、stop / destroy cleanup、idle release、stop 后拒绝新任务。

完成实现前必须运行：

1. `pnpm lint`
2. `pnpm test`
3. `pnpm format`

---

## 19. Accepted Trade-offs

统一任务式 API 的代价：

1. 快速 OCR 也需要 start/query。
2. 翻译页需要适配轮询或上层 await helper。
3. 类型比原来的 `extractText -> { text }` 更复杂。

接受这些代价的原因：

1. OCR 和 Markdown 共享进度、失败、取消和终态模型。
2. 慢 OCR provider 不需要未来再破坏接口。
3. 上层服务可以用统一方式编排文件处理。

统一 artifact 模型的代价：

1. 调用方需要 inspect `artifact.kind` 和 `artifact.format`。
2. 文本和文件仍然有不同存储策略。

接受这些代价的原因：

1. 未来可以自然扩展多 artifact 输出。
2. 不需要在 task result 顶层不断增加 feature-specific 字段。
3. OCR 保持内联文本的消费效率，Markdown 保持落盘文件的稳定性。

内存任务状态的代价：

1. app 重启后无法恢复任务。
2. 多窗口不能天然共享实时进度。

接受这些代价的原因：

1. 当前 task state 是 runtime coordination state，不是 business data。
2. 结果 artifact 已经稳定落盘。
3. 避免引入 DataApi / Cache 双 source of truth。

---

## 20. Review Baseline

评审这次重构时，应以本文作为目标契约。

重点关注：

1. 是否真正形成统一 `FileProcessingTask` API。
2. 是否避免把知识库 / 翻译业务语义塞进 file-processing。
3. 是否正确隐藏 provider task id 和 query context。
4. 是否用 artifact 统一终态结果。
5. 是否有清晰取消语义。
6. 是否把 task runtime state 保持在 Main 内存 source of truth。
7. 是否通过 `Emitter/Event` 暴露 Main 内部任务变化，而没有过早设计 Renderer broadcast 协议。

不应作为 blocker 的事项：

1. Renderer 尚未切到新 task API。
2. 旧 OCR service 尚未删除。
3. KnowledgeService 尚未消费新 markdown artifact。
4. 任务状态不跨 app restart 恢复。
5. facade 没有维护具体扩展名白名单。
