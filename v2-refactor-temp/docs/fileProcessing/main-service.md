# FileProcessing Main Service PR Scope

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
2. processor 的能力边界以 feature 为单位表达；同一个 processor 可以同时暴露 `markdown_conversion` 和 `text_extraction` 两个异步能力接口。

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
3. 当前先由 `FileProcessingService` 对外提供 provider-aware 的薄 facade，KnowledgeService 后续再基于处理结果继续处理。
4. 本次 PR 先把 Main-side service 迁移完成，再推进前端切流和知识库接入。

---

## 5. FileProcessingService 接口设计

当前实现阶段中，`FileProcessingService` 对外提供的是 provider-aware 的薄 facade，而不是统一 `taskId` 任务管理器。

建议接口：

1. `extractText(input)`
2. `startMarkdownConversionTask(input)`
3. `getMarkdownConversionTaskResult(input)`

设计原则：

1. `FileProcessingService` 只负责解析 config、创建 processor，并转发调用。
2. `FileProcessingService` 当前不维护统一的本地 `taskId`。
3. 对支持异步文档解析的 provider，外部 service 直接持有 `providerTaskId` 并负责轮询。
4. 当前阶段调用方需要感知 `processorId` 与 `providerTaskId`，这属于明确接受的过渡设计。

当前接口语义：

1. `extractText(input)`：
   返回 `FileProcessingTextExtractionResult`
2. `startMarkdownConversionTask(input)`：
   返回 `FileProcessingMarkdownTaskStartResult`
3. `getMarkdownConversionTaskResult(input)`：
   返回 `FileProcessingMarkdownTaskResult`

其中：

1. `FileProcessingTextExtractionResult` 承载文本提取结果。
2. `FileProcessingMarkdownTaskStartResult` 承载 provider 返回的文档解析任务启动结果。
3. `FileProcessingMarkdownTaskResult` 承载查询到的文档解析任务状态与最终结果。
4. 对文档解析查询来说，外部 service 需要提供：
   - `providerTaskId`
   - `processorId`

这里需要特别说明：

1. 当前 `FileProcessingService` 还没有抽象出统一 `taskId -> providerTaskId` 映射层。
2. 当前 `markdown_conversion` 已经不再建模成“同步立即返回最终结果”，但查询行为也还没有被 service 完全屏蔽掉 provider 差异。
3. 这次 PR 的重点是先把 Main-side 能力和 provider 入口拆出来，而不是在本次内完成统一任务编排平台。

---

## 6. Provider 抽象设计

`file-processing` 的 provider 当前按统一接口表达能力，但不同 provider 的执行行为仍然允许存在差异。

### 6.1 能力维度

统一能力仍然保持两类：

1. `text_extraction`
2. `markdown_conversion`

同一个 processor 可以同时支持两类能力，也可以只支持其中一类。

### 6.2 当前 capability 分层接口

当前实现不再要求所有 provider 暴露完全相同的三方法能力面，而是按 capability 分层接口表达：

1. `ITextExtractionProcessor`
   - `extractText(...)`
2. `IMarkdownConversionProcessor`
   - `startMarkdownConversionTask(...)`
   - `getMarkdownConversionTaskResult(...)`

这样做的目标是：

1. 避免不支持某项能力的 provider 实现无意义的占位方法。
2. 让 `FileProcessingService` 按 feature 选择对应的 processor factory。
3. 保留统一 Main-side 调用入口，同时让 provider 抽象更贴近真实能力边界。

当前阶段对这些接口的理解是：

1. `extractText(...)`：
   主要用于图片 OCR / 文本提取
2. `startMarkdownConversionTask(...)`：
   主要用于启动文档解析任务
3. `getMarkdownConversionTaskResult(...)`：
   主要用于查询文档解析任务状态

### 6.3 provider 行为差异

虽然 `FileProcessingService` 对外仍保持统一 service 入口，但 provider 内部实现和能力分布仍分成两类：

#### 远程查询型 provider

这类 provider 天然支持“启动任务 + 查询任务结果”。

典型例子：

1. `mineru`
2. `paddleocr`
3. `doc2x`
4. `open-mineru`

这类 provider 的特点：

1. `startMarkdownConversionTask(...)` 会返回远程 `providerTaskId`
2. `getMarkdownConversionTaskResult(...)` 会继续查询远程状态
3. 调用方需要持有 `providerTaskId`

#### 本地/同步封装型 provider

这类 provider 不一定天然支持远程任务查询，但当前仍通过 capability 分层接口接入 `FileProcessingService`。

典型例子：

1. `tesseract`
2. `system`
3. `ovocr`
4. `mistral`

这类 provider 的特点：

1. `tesseract`、`system`、`ovocr`、`mistral` 当前仅支持图片 `text_extraction`，不参与 `markdown_conversion` 文档解析。
2. 对不支持某项能力的方法，当前实现允许直接抛明确错误。

### 6.4 当前抽象边界

当前阶段的边界是：

1. 统一的是 `FileProcessingService` 对外入口和 capability 分层接口，而不是统一任务 ID 模型。
2. `FileProcessingService` 当前只是 provider-aware facade，不负责屏蔽所有 provider 差异。
3. `providerTaskId` 目前是显式暴露给调用方的。

---

## 7. Shared Cache 设计预留

当前仓库已经有 `file_processing.active_tasks` shared cache schema，但当前主流程尚未接入。

当前状态应理解为：

1. 当前对外查询接口仍然走 `providerTaskId + processorId` 输入。
2. shared cache 当前仍是预留设计，不承担主流程状态同步。
3. 当前不应把 shared cache 当作已经落地的 file-processing 状态系统。

换句话说：

1. `file_processing.active_tasks` 当前仍是预留 schema。
2. 后续如果需要 renderer 直接观察 file-processing 状态，再按具体 provider 执行模型接入。
3. 当前仍不应把 shared cache 误解成已经完整落地的统一 file-processing 状态系统。

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
