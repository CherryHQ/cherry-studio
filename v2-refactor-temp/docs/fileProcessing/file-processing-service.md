# File Processing Service PR Scope

## 1. 文档目的

这份文档用于明确当前 File Processing PR 的任务边界、约束范围和评审基线，避免后续实现和 review 时把本次改动误解为“完整迁移”或“要求与 v1 完全一致”。

当前 PR 的定位很明确：

1. 只处理 Main 线程的 file-processing service 迁移。
2. 不在本次 PR 内完成 Renderer 侧调用切换。
3. 不以完全保持 v1 行为一致为目标。

---

## 2. 当前 PR 要做什么

本次 PR 只专注于 `v2` 分支上的 File Processing Main-side service 迁移。

核心目标：

1. 在 Main 线程落地 file-processing 的后端 service 能力。
2. 让 file-processing 从当前知识库实现中拆分出来，成为独立模块。
3. 统一承接原先分散在 preprocess 和 OCR 中的 provider 能力。
4. 为后续 Renderer / UI 切流提供稳定的 Main-side 基础设施。

这里要特别明确：

1. 本次迁移不是把 v1 代码原样搬运到 `v2`。
2. 本次迁移允许围绕模块边界和职责拆分做结构性调整。
3. 只要调整方向符合“从知识库中解耦、形成独立 file-processing 模块”的目标，就不应默认按“与 v1 不同”来判定为缺陷。

---

## 3. 当前 PR 的设计取向

这次改动的一个关键前提是：`file-processing` 不再继续作为知识库内部耦合实现存在，而是作为独立模块建设。

这意味着本次 PR 的设计重心是：

1. 优先建立清晰的 Main-side service 边界。
2. 优先把 file-processing 的职责从知识库逻辑中拆出来。
3. 优先让模块关系、依赖方向和后续扩展点更清晰。

当前 service 设计还需要明确两条约束：

1. 文档预处理 provider 和 OCR provider 都收口到 `file-processing` 模块内，而不是分散在不同业务模块中继续维护。
2. processor 的能力边界以 feature 为单位表达；同一个 processor 可以同时暴露 `markdown_conversion` 和 `text_extraction` 两类能力接口。

因此，本次 PR 可以接受以下类型的变化：

1. 与 v1 不完全一致的 service 组织方式。
2. 为了解耦知识库而产生的调用链调整。
3. 为适配 `v2` 数据层和服务层而做的接口或结构重组。

---

## 4. 当前 PR 明确不包含什么

本次 PR 不包含 Renderer 侧改动。

也就是说，以下内容不在本次范围内：

1. Renderer 侧 file-processing 调用入口的统一切换。
2. 现有前端调用链路的系统性替换。
3. UI 层为新 Main-side service 做的适配与清理。
4. KnowledgeService 对 file-processing 结果的消费与后续入库联调。

当前阶段的处理原则是：

1. 原有 Renderer 逻辑先保留。
2. 等后续 UI PR 再统一修改调用方式。
3. 当前执行入口由 `FileProcessingOrchestrationService` 对外提供 provider-aware 的执行入口；processor 配置当前由 shared preset + preference key 组合表达，不再通过 DataApi handler 暴露配置接口。
4. 本次 PR 先把 Main-side service 迁移完成，再推进前端切流和知识库接入。

---

## 5. 当前接口与分层设计

当前实现已经拆成执行入口、markdown 任务运行时、OCR 能力层和共享配置定义，不再保留旧的单体 `FileProcessingService` / DataApi facade：

1. 执行入口：`FileProcessingOrchestrationService`
   - `extractText(...)`
   - `startMarkdownConversionTask(...)`
   - `getMarkdownConversionTaskResult(...)`
   - 负责 IPC handler 注册、payload 校验和对外方法转发
2. markdown 任务运行时：`MarkdownTaskService`
   - 负责本地 `taskId` 生成
   - 负责 Main 进程内存态 task store
   - 负责远程查询去重、后台执行跟踪、TTL 剪枝和结果落盘状态推进
3. OCR 能力层：
   - `ocrService`：direct-import singleton，负责解析 OCR config、选择 provider 并执行 `text_extraction`
   - `TesseractRuntimeService`：生命周期 service，负责共享 worker、串行队列、idle release 和 stop 时的清理
4. 共享配置与类型定义：
   - `packages/shared/data/presets/file-processing.ts`
   - `packages/shared/data/types/fileProcessing.ts`
   - `feature.file_processing.default_*`
   - `feature.file_processing.overrides`
   - `resolveProcessorConfig(...)` / `mergeProcessorPreset(...)`

因此，当前对外 provider-aware entry 仍然是 `FileProcessingOrchestrationService`；但 markdown 任务上下文和状态 source of truth 已经收口到 `MarkdownTaskService`，而不是再额外拆一个独立的 markdown runtime facade。

当前推荐能力面：

1. `extractText(...)`
2. `startMarkdownConversionTask(...)`
3. `getMarkdownConversionTaskResult(...)`

设计原则：

1. `FileProcessingOrchestrationService` 负责参数校验、方法签名统一和 IPC 暴露，不直接持有 markdown task store。
2. 当前对外 markdown 任务契约已经统一为本地 `taskId`；`providerTaskId` 只保存在 Main 进程内部 task record 中，不再通过 shared result type 暴露给调用方。
3. 所有 markdown provider 无论是 remote-poll 还是 background 模式，都会先由 Main 进程生成统一 `taskId`，再把 provider 内部的 `providerTaskId` 绑定到该任务记录。
4. `resolveProcessorConfig(...)` 会先使用显式传入的 `processorId`，否则读取按 feature 区分的默认 preference；若两者都没有，则直接 fail fast。
   - 这里的 fail fast 是当前明确接受的契约，不是待补默认值的缺陷。
   - fresh install 场景同样适用这条约束：用户必须先配置默认 processor，或者调用方必须显式传入 `processorId`，否则主服务拒绝执行属于预期行为。
   - legacy migration 场景同样适用这条约束：如果迁移后的默认 markdown processor 落到当前新模型不支持、不可用或未配置完成的值上，当前不会在迁移阶段自动改写成其他默认值，而是在真正执行时 fail fast；这同样属于预期行为。
5. 当前 Main service 方法签名已切到 input object 风格；IPC handler 也已统一成单 `payload` 入参，并在 `FileProcessingOrchestrationService` 内通过 Zod schema `.parse(...)` 做显式运行时校验，风格与 `KnowledgeOrchestrationService` 对齐。
6. 当前生命周期分层是：
   - `FileProcessingOrchestrationService`：`WhenReady`
   - `MarkdownTaskService`：`WhenReady`
   - `TesseractRuntimeService`：`WhenReady`
   - `ocrService`：non-lifecycle direct-import singleton
   - `FileProcessingOrchestrationService` 会显式依赖 `MarkdownTaskService` 和 `TesseractRuntimeService`，避免 IPC 提前暴露到尚未完成初始化的运行时能力

当前接口语义：

1. `extractText(...)`：
   返回 `FileProcessingTextExtractionResult`
2. `startMarkdownConversionTask(...)`：
   返回 `FileProcessingMarkdownTaskStartResult`
3. `getMarkdownConversionTaskResult(...)`：
   返回 `FileProcessingMarkdownTaskResult`

其中：

1. `FileProcessingTextExtractionResult` 承载文本提取结果。
2. `FileProcessingMarkdownTaskStartResult` 当前返回：
   - `taskId`
   - `status`
   - `progress`
   - `processorId`
3. `FileProcessingMarkdownTaskResult` 承载查询到的文档解析任务状态与最终结果。
4. 对文档解析查询来说，调用方当前只需要提供：
   - `taskId`

这里需要特别说明：

1. 当前 `FileProcessingOrchestrationService` 已经引入统一的本地 `taskId` 模型；调用方不再直接持有 `providerTaskId` 进行查询。
2. 当前 `providerTaskId` 仍然存在，但它是 provider 内部任务句柄，由 `MarkdownTaskService` 持有并用于 remote-poll / background 执行衔接。
3. 当前查询契约仍然是“当前 Main 进程会话内可轮询”；如果 Main 进程重启，调用方应视为任务上下文失效并重新发起任务。
4. 当前终态结果不会在首次查询后立刻删除；`completed` / `failed` 任务会继续保留在内存态 store 中，直到 TTL 剪枝或服务停止。
5. 当前 `markdown_conversion` 已经不再建模成“同步立即返回最终结果”，但 provider 内部差异仍然没有被完全屏蔽；统一的是对外 `taskId` 查询入口。
6. 当前 remote-poll provider 在“provider 已完成但下载 / 落盘失败”这类场景下，任务状态不会立即推进到终态，后续对同一 `taskId` 再次查询时仍可能重试收口；background provider 当前没有等价的 retryable snapshot 语义。

---

## 6. Provider 抽象设计

`file-processing` 的 provider 当前按统一接口表达能力，但不同 provider 的执行行为仍然允许存在差异。

### 6.1 能力维度

统一能力仍然保持两类：

1. `text_extraction`
2. `markdown_conversion`

同一个 processor 可以同时支持两类能力，也可以只支持其中一类。

### 6.2 当前 capability 分层接口

当前实现不再要求所有 provider 暴露完全相同的三方法能力面，而是按当前代码中的两类 provider 入口表达：

1. OCR provider：
   - `extractText(...)`
   - 由 `createOcrProvider(...)` 选择具体实现，统一走 `ocrService`
2. markdown provider：
   - `MarkdownRemoteTaskProvider`
     - `startTask(...)`
     - `pollTask(...)`
   - `MarkdownBackgroundTaskProvider`
     - `startTask(...)`
     - `executeTask(...)`
   - 由 `createMarkdownProvider(...)` 选择具体实现，统一走 `MarkdownTaskService`

这样做的目标是：

1. 避免不支持某项能力的 provider 实现无意义的占位方法。
2. 让 `FileProcessingOrchestrationService` 按 feature 选择对应的 provider factory。
3. 保留统一 Main-side 调用入口，同时让 provider 抽象更贴近真实能力边界。

当前阶段对这些接口的理解是：

1. `extractText(...)`：
   主要用于图片 OCR / 文本提取
2. `startTask(...)`：
   主要用于启动文档解析任务
3. `pollTask(...)` / `executeTask(...)`：
   分别用于远程轮询型 provider 和后台执行型 provider 的后续状态推进

这里需要再明确一条 `markdown_conversion` 的输入约束：

1. `markdown_conversion` 当前没有放在 facade 层做统一的文件类型前置准入校验。
2. 具体某个 provider 实际支持哪些文档格式，由上游调用方和 provider 自身共同决定，不要求在 `FileProcessingOrchestrationService` 层统一做一层前置格式拦截。
3. 换句话说，`FileProcessingOrchestrationService` 当前不负责回答“这个文档格式是否一定能被某 provider 成功解析”；它只负责按 feature 选 processor 并转发调用。
4. provider 仍然会做自身需要的运行时校验，例如 `file.path`、`apiHost`、`apiKey`、特定模型限制，部分 `text_extraction` provider 还会校验是否为图片输入。
5. 因此，评审时不应把“未在 facade 层统一校验 `file.type === 'document'`”单独判定为缺陷；这是当前明确保留给上游调用方和具体 provider 的职责边界。

### 6.3 provider 行为差异

虽然 `FileProcessingOrchestrationService` 对外保持统一执行入口，但 provider 内部实现和能力分布仍分成两类：

#### 远程查询型 provider

这类 provider 天然支持“启动任务 + 查询任务结果”。

典型例子：

1. `mineru`
2. `paddleocr`
3. `doc2x`

这类 provider 的特点：

1. provider `startTask(...)` 会返回内部 `providerTaskId` 和可选 `queryContext`
2. `MarkdownTaskService` 会把该内部任务句柄绑定到统一的本地 `taskId`
3. 调用方对外只看到 `taskId`；后续查询由 `MarkdownTaskService` 内部再用 `providerTaskId + queryContext` 继续轮询
4. `paddleocr` 当前同时支持 `text_extraction` 和 `markdown_conversion`；二者都走远程任务能力，但结果收口方式不同：
   - `text_extraction` 内部会等待任务完成并直接返回文本
   - `markdown_conversion` 会先启动任务，随后通过 `taskId` 轮询获取结果

#### 本地 / 后台执行型 provider

这类 provider 不一定天然支持远程任务查询，但当前仍通过 capability 分层接口接入 `FileProcessingOrchestrationService`。

典型例子：

1. `tesseract`
2. `system`
3. `ovocr`
4. `mistral`
5. `open-mineru`

这类 provider 的特点：

1. `tesseract`、`system`、`ovocr`、`mistral` 当前仅支持图片 `text_extraction`，不参与 `markdown_conversion` 文档解析。
2. `open-mineru` 当前通过 `MarkdownTaskService` 的 background execution 模式接入 `markdown_conversion`；provider 自身会先生成内部 `providerTaskId`，但对外统一返回的仍然是主服务生成的 `taskId`。
3. `tesseract` 的 worker 不是在 bootstrap 时预热，而是在首次 OCR 调用时按语言懒创建；`TesseractRuntimeService` 负责生命周期、串行队列、idle release 和 stop 时的中断处理。
4. `open-mineru` 当前没有单独的 `OpenMineruRuntimeService`；其后台任务上下文、进度和终态收口都由 `MarkdownTaskService` 持有。
5. 对不支持某项能力的方法，当前实现允许直接抛明确错误。

这里还需要把 `file-processing migration` 的整体语义明确写死：

1. legacy `preprocess` / OCR 配置迁移到新的 file-processing 模型时，目标是按新模块边界重建当前可接受的配置，不是按 v1 语义做 1:1 保真搬运。
2. 迁移过程允许对超出新能力边界、已经被裁剪或当前不再继续支持的旧语义做有损收敛。
3. 因此，评审时不应把“迁移后某些 legacy 语义不再继续映射”本身直接视为缺陷；需要先看它是否属于当前文档已经明确接受的迁移约束。

这里还需要把 `mistral` 的迁移语义明确写死：

1. legacy `preprocess` 里的 `mistral` 配置，当前不再按 `markdown_conversion` 语义迁移。
2. 当前接受的迁移策略是：legacy `preprocess` 里的 `mistral` 配置只迁移到新的 `text_extraction` 配置位。
3. 换句话说，当前不应把 legacy `preprocess` 中的 `mistral` 理解成“仍然接入文档 markdown 解析链路”。
4. 这是一条明确接受的过渡约束；评审时不应把“legacy preprocess 的 `mistral` 没有迁移到 `markdown_conversion`”单独判定为缺陷。

`paddleocr` 的迁移语义也需要明确：

1. legacy `preprocess` 和 legacy OCR 里的 `paddleocr` 配置，当前至少会迁移 API key / token。
2. 当前接受的迁移策略是：`paddleocr` 的自定义 `apiHost`、`apiUrl`、`model` 不进入新的 capability override。
3. 换句话说，迁移后的 `paddleocr` override 当前主要承担凭证承接，不承诺保留 legacy 自定义 endpoint / model 配置。
4. 但如果 legacy 数据里存在 `preprocess.options`、OCR `langs` 或 OCR `apiVersion`，当前实现仍会沿用通用 `options` merge 逻辑把这些值并入新的 override `options`。
5. 因此，评审时不应把“`paddleocr` 没有迁移 legacy 自定义 host/model”单独判定为缺陷；当前真正被明确放弃的是 capability 级 host/model 迁移，而不是所有 option 字段都一律丢弃。

### 6.4 当前抽象边界

当前阶段的边界是：

1. 统一的是 `FileProcessingOrchestrationService` 对外执行入口、capability 分层接口和本地 `taskId` 查询模型。
2. `FileProcessingOrchestrationService` 当前只是 provider-aware orchestration entry，不负责屏蔽所有 provider 差异；真正的 markdown task state、轮询和后台执行收口在 `MarkdownTaskService`。
3. `providerTaskId`、`queryContext`、background execution 细节目前都属于 Main 进程内部实现细节，不再显式暴露给调用方。

### 6.4.1 与统一进程管理的未来边界

当前 `file-processing` 只负责 provider 选择、必要的运行时输入校验、本地 `taskId` 与内部 provider task 的绑定、状态映射和结果落盘，不负责建设通用进程管理能力。

这里的“必要的运行时输入校验”应理解为：

1. 文件路径、必填配置、provider 请求参数等能否执行当前调用的基本校验。
2. 不包含对 `markdown_conversion` 支持文档范围的统一前置格式拦截。
3. 对“某类文档是否适合某 provider”这类更高层的准入判断，当前仍由上游调用方负责。

当前结果落盘已经不是 Main 进程 temp 目录过渡方案，而是稳定写入 `application.getPath('feature.files.data')/fileId/file-processing/taskId`。当前实现会把 markdown 统一收口为稳定文件名 `output.md`，并以原子替换方式更新当前任务的结果目录。

当前结果落盘还有一条需要明确的过渡约束：

1. 当前持久化结果目录按 `fileId/taskId` 分桶；同一个文件的不同 `taskId` 不再共享同一个结果目录。
2. 这意味着同一个文件在当前会话内重复触发 file-processing 时，不同任务的 `markdownPath` 会稳定指向各自的结果目录，不再互相覆盖。
3. 当前对结果路径的暴露仍以任务查询返回的 `markdownPath` 为主；当前没有额外提供“按 fileId 查询 latest result”的别名路径或索引接口。
4. 对 zip 类结果，当前实现会做 entry path 规范化与安全校验，并把 provider 内部的 markdown 路径归一到稳定输出文件名；评审时不应再按“结果仍落 temp”或“markdown 文件名随 provider 变化”来理解。

如果后续主进程引入统一的 `ProcessManagerService` / utility process / process pool，边界应理解为：

1. `file-processing` 保留：
   - capability 分发
   - 本地 `taskId` / 内部 provider task 上下文绑定
   - 结果状态映射
   - 输入输出路径与结果解析
2. 统一进程管理应接管：
   - 外部二进制或 utility process 的创建 / 停止 / 重启
   - 进程句柄追踪
   - 进程级日志、崩溃恢复和优雅关闭
   - 进程级并发池 / worker 池
3. 因此，当前 provider 内部与本地执行器直接耦合的实现，只应保持“当前可运行的最小闭环”，不应在 `file-processing` 内继续扩展成通用进程生命周期系统。
4. 典型地：
   - `ovocr` 未来如果继续依赖外部二进制，应切到统一 `ChildProcess` 管理
   - `tesseract` 如果未来迁到独立 utility process 或进程池，则其 worker 生命周期与并发控制也应迁出 `file-processing`
   - `doc2x`、`mineru`、`paddleocr` 这类远程 HTTP provider 不属于统一进程管理重点范围

### 6.5 当前模块目录与 provider 组织约定

当前 `file-processing` 模块内的目录已经形成了明确分层：

1. `config/`
   - preset 与 preference override 合并、feature 默认 processor 解析
2. `markdown/`
   - markdown task model、provider 选择、任务状态推进与结果落盘
3. `ocr/`
   - OCR provider 选择和 `text_extraction` 调度
4. `persistence/`
   - markdown / zip 结果的原子落盘和安全解包
5. `runtime/`
   - 当前仅放需要单独生命周期托管的运行时 service，例如 `TesseractRuntimeService`
6. `utils/`
   - URL 安全校验、provider 通用 helper 等模块级工具

#### 当前 provider 入口文件是 flat wrapper + provider 子目录

当前实现并不是“所有 provider 文件都放进各自目录”的纯目录化模式，而是：

1. 在 `markdown/providers/` 或 `ocr/providers/` 根目录放置 provider 入口文件
   - 例如：
     - `doc2xMarkdownProvider.ts`
     - `mineruMarkdownProvider.ts`
     - `openMineruMarkdownProvider.ts`
     - `paddleMarkdownProvider.ts`
     - `mistralOcrProvider.ts`
     - `tesseractOcrProvider.ts`
2. 如果某个 provider 需要更多本地 schema / utils / tests，再在同级建立 provider 子目录
   - 例如：
     - `markdown/providers/doc2x/`
     - `markdown/providers/mineru/`
     - `markdown/providers/open-mineru/`
     - `markdown/providers/paddle/`
     - `ocr/providers/mistral/`
     - `ocr/providers/tesseract/`
     - `ocr/providers/system/`
     - `ocr/providers/ovocr/`
     - `ocr/providers/paddle/`

换句话说，当前代码的默认组织方式是：

1. provider 入口文件保持 flat，便于 factory 直接 import
2. provider 细节实现按需拆入同名子目录
3. 不是强制“一个 provider 所有文件都必须进独立目录”，而是“入口稳定 + 细节按需目录化”

#### 当前 provider 文件职责约定

当前目录下的文件职责约定是：

1. `*MarkdownProvider.ts` / `*OcrProvider.ts`
   - 负责 capability 接口实现
   - 负责准备 context
   - 负责 orchestration / 状态推进
   - 不承载大段杂糅的协议细节或工具函数
2. provider 子目录下的 `types.ts`
   - 负责 provider 本地 schema、context、局部类型定义
3. provider 子目录下的 `utils.ts`
   - 负责与 provider 强绑定但可独立复用的执行细节
   - 包括请求封装、worker 初始化、下载 / 上传辅助、结果解析等

`utils.ts` 不是强制文件；如果 provider 入口文件仍然足够薄，可以只保留入口文件或入口 + types。

#### file-processing 内部优先自持 provider 实现

当前 processor 的组织还有一条重要约束：

1. `file-processing` provider 不应再绕回旧的知识库 preprocess service
2. builtin OCR processor 也不应继续依赖旧的 `main/services/ocr` service 作为中转层

允许复用的是：

1. 通用底层工具，例如 `loadOcrImage`
2. 第三方 SDK / 原生库
3. 少量稳定的 shared config / constants

不鼓励继续复用的是：

1. 老的 provider registry
2. 旧 OCR service 的 facade 层
3. 旧 knowledge preprocess 的业务编排层

原因很明确：

1. 当前目标是让 `file-processing` 成为独立 Main-side 模块
2. provider 行为应在 `file-processing` 模块内闭环
3. 避免形成“新 service 仍依赖旧 service 中转”的反向耦合

#### 当前 flat 文件的理解

当前 `file-processing` provider 仍然保留“flat 入口文件”这一层，但不再把所有协议细节都直接平铺在同一目录里。

这里的约束可以直接理解为：

1. 新增 provider 默认应至少有清晰的入口文件
2. 一旦 provider 逻辑超过几行 orchestration，就继续拆出 provider 子目录承载 `types.ts` / `utils.ts`
3. 不再回到“所有请求封装、schema、解析逻辑都堆在单个平铺 provider 文件里”的实现方式

---

## 7. 运行时状态边界

当前 `file-processing` 不再维护独立的 shared cache 任务摘要镜像。

当前状态应理解为：

1. 当前对外查询接口已经统一为 `taskId` 输入。
2. 运行时任务上下文的 source of truth 是 Main 进程内 `MarkdownTaskService` 的内存态 task store。
3. task record 当前至少包含：
   - `taskId`
   - `processorId`
   - `providerTaskId`
   - `fileId`
   - `status`
   - `progress`
   - `queryContext`
   - `markdownPath`
   - `error`
   - `createdAt` / `updatedAt`
4. task state 带有 TTL，当前默认保留 10 分钟，并由 5 分钟一次的后台 prune timer 负责清理。
5. 每次 `getMarkdownConversionTaskResult(...)` 查询都会 touch 当前 task 的 `updatedAt`，因此持续轮询会延长任务保留时间；当前没有单独的“访问时即时 prune”路径。
6. `completed` / `failed` 任务在 TTL 过期前仍可重复查询；当前实现不是一次性消费语义。
7. `file-processing` 当前不额外承担跨窗口状态分发职责，也不尝试对 UI 暴露独立任务中心。
8. `file-processing` 任务状态当前只存在于 Main 进程内存态 store；服务 stop / app restart 后不会恢复。

换句话说：

1. 当前阶段不再把 `file-processing` 任务状态额外镜像到 shared cache。
2. 如果后续由 `KnowledgeService` 或其他上层 service 编排 file-processing 流程，则应由上层 service 负责聚合进度并对 UI 暴露状态。
3. 当前仍不应把 `file-processing` 误解成已经完整落地的统一任务编排与状态分发系统；运行时查询上下文仍以 Main 进程内 store 为准。
4. 对 remote-poll provider，当前相同 `taskId` 的并发查询会在 `MarkdownTaskService` 内部做 dedupe，避免同一任务被重复轮询。
5. 对 background provider，当前后台执行对象也由 `MarkdownTaskService` 内部跟踪，并会在 service stop 或 task 过期时统一 abort。

---

## 8. 评审基线

评审本次 PR 时，应以“是否完成 Main-side file-processing 迁移，并建立独立模块边界”为主要标准，而不是以“是否已经完成全链路迁移”为标准。

评审应重点关注：

1. Main-side service 是否已经具备合理、清晰的职责边界。
2. file-processing 是否已经从知识库中有效拆分。
3. 当前实现是否为后续 Renderer / UI 接入留下稳定入口。

以下情况不应单独作为本次 PR 的 blocker：

1. Renderer 仍然保留旧逻辑。
2. 前后端调用链路尚未在本次 PR 中完全收口。
3. 某些行为与 v1 不完全一致，但这种差异来自本次明确接受的模块解耦和架构调整。

---

## 9. 后续 PR 再处理的内容

后续 UI / Renderer PR 再统一处理以下事项：

1. Renderer 对新 Main-side service 的正式接入。
2. 旧调用路径的替换与清理。
3. KnowledgeService 对 file-processing 结果的消费、编排和入库链路接入。
4. 与新模块边界对应的前端状态、交互和调用方式收口。

换句话说，当前 PR 的产出是 Main-side 基础设施；后续 PR 的产出才是完整切流。
