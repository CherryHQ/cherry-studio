# WebSearch Service Architecture (Current Branch vs `v2`)

## 1. 文档目的

这份文档不再描述“理想中的最终形态”，而是基于 `v2` 分支与当前分支的代码对比，说明 WebSearch 架构现在**实际发生了什么变化**。

重点是两件事：

1. `v2` 基线下，WebSearch 仍然主要跑在 Renderer。
2. 当前分支新增了一套 Main-side WebSearch backend，但还没有完成所有入口切换。

换句话说，这次改动的本质不是“WebSearch 已经完全迁到 Main”，而是“Main 侧能力已经起出第一版骨架，Renderer 侧旧链路暂时仍在”。

---

## 2. `v2` 基线是什么

以 `v2` 分支为基线，WebSearch 的主执行链路仍然在 Renderer：

1. `src/renderer/src/services/WebSearchService.ts` 持有请求状态、provider 调用、压缩、临时知识库、引用筛选等完整流程。
2. `src/renderer/src/providers/WebSearchProvider/*` 持有各 provider 的具体实现。
3. aiCore、搜索编排、设置页 provider 检查等调用方，仍然直接依赖 Renderer 侧 WebSearch service。
4. 搜索状态也仍然由 Renderer 负责写入，而不是由 Main 侧统一管理。

`v2` 分支下**不存在**以下能力：

1. `packages/shared/data/types/webSearch.ts`
2. `src/main/services/webSearch/*`
3. Main-side provider factory / provider drivers
4. Main-side 独立请求 contract / request schema 校验
5. Main-side blacklist 过滤
6. Main-side post processing

因此，`v2` 的真实基线不是“Main backend 已存在，只差接入口”，而是“搜索核心本身还留在 Renderer”。

---

## 3. 当前分支新增了什么

当前分支围绕 Main 侧新增了一整套 WebSearch backend 基础设施。

### 3.1 Shared Contract

新增文件：

`packages/shared/data/types/webSearch.ts`

这层现在定义了 Main-side 执行契约：

1. `WebSearchRequest`
2. `WebSearchResult`
3. `WebSearchResponse`
4. `WebSearchStatus`
5. `WebSearchCompressionConfig`
6. `WebSearchExecutionConfig`
7. `ResolvedWebSearchProvider`
8. `WebSearchResolvedConfig`

当前 contract 的边界很明确：

1. 现在保留了一份轻量 shared request type：`providerId` / `questions` / `requestId`
2. 同时覆盖结果、状态、运行时配置和 provider resolved config
3. 只表达 Main-side 执行层当前已经稳定下来的字段
4. 不包含 UI 文案、toast、Renderer span 细节
5. 不包含原始 `links` / `summarize` / XML 之类上游编排协议

### 3.2 Shared Cache 调整

这次分支顺手把搜索状态模型往 shared cache 收敛了一步。

相关改动：

1. `packages/shared/data/cache/cacheSchemas.ts`
2. `packages/shared/data/cache/cacheValueTypes.ts`

变化点：

1. `chat.web_search.active_searches` 从 `UseCacheSchema` 挪到了 `SharedCacheSchema`
2. `CacheActiveSearches` 改为直接依赖 shared 的 `WebSearchStatus`
3. `CitationBlock` 也改成通过 `useSharedCache('chat.web_search.active_searches')` 观察状态

这意味着搜索状态不再只是 Renderer 内部实现细节，而开始成为跨边界共享的数据。

但这里也要明确当前分支的边界：

1. 这次改动的重点是先把搜索状态模型收敛到 shared cache，让 Main-side backend 具备可写入、Renderer 具备可观察的基础。
2. Renderer 层本身暂时不继续做更深入的改造，仍允许保留当前分支里的旧读写方式。
3. Renderer 侧后续如何进一步收敛到新的入口和单一写入策略，会在后续切流阶段再统一修改，而不是在这次分支里完成。

审查约束：

1. 当前分支围绕 `chat.web_search.active_searches` 的目标，是先完成 shared cache 形态收敛与 Main-side 可写入基础，而不是在本次分支里完成 Renderer 旧写入链路清理。
2. 在后续切流完成前，Main 与 Renderer 对 `chat.web_search.active_searches` 的并存写入，属于当前阶段明确接受的过渡态，不应单独作为本次分支的 review blocker。
3. 针对该 key 的审查，应聚焦于是否违反本文档已经声明的边界，或是否引入了超出该边界的新行为回归；不应把“尚未完成单一写入策略收口”本身视为本次分支缺陷。
4. 当前分支中，`CitationBlock` 通过 `useSharedCache('chat.web_search.active_searches')` 接入 shared cache 观察能力，也属于过渡实现的一部分；Renderer 侧围绕该观察接入产生的初始化与同步时序问题，留待后续切流阶段统一收敛，不单独作为本次分支的 review blocker。

### 3.3 Main-side WebSearch Service

新增目录：

`src/main/services/webSearch/`

这一层是当前分支最核心的增量。

#### `WebSearchService.ts`

职责：

1. 根据 `providerId` 解析 provider
2. 读取 runtime config
3. 对 `questions` 执行 fanout
4. 合并成功的搜索结果
5. 应用黑名单过滤
6. 应用 post processing
7. 写入并清理搜索状态
8. 输出统一的 `WebSearchResponse`

当前行为特征：

1. 对多问题搜索使用 `Promise.allSettled`
2. 允许部分 query 失败，只要至少有一个 query 成功就继续产出结果
3. 所有 query 都失败时才抛错
4. 在 `finally` 中清理 `chat.web_search.active_searches`

#### `utils/config.ts`

职责：

1. 从 `PreferenceService` 读取 `chat.web_search.*`
2. 合并 preset 与用户 override
3. 输出 resolved provider 和 runtime config

这里已经把 Main 执行层需要的配置读取逻辑从 Renderer 里抽出来了。

#### 关于 `searchWithTime`

这里需要特别说明一个容易误判的边界：

1. `searchWithTime` 属于 Renderer 旧 WebSearch 栈里的遗留行为，当前已经不再是后续架构的目标能力。
2. Main-side runtime config 没有继续把这项字段带进来，这是有意收口，不是这次迁移漏掉了能力。
3. Renderer 侧目前仍残留“给 query 注入日期”或 provider-specific freshness / timeRange 的旧实现，但这些会在后续切流和旧链路清理时一起收敛。
4. 因此，当前分支里 Main-side backend 未保留 `searchWithTime`，应视为对废弃行为的提前对齐，而不是功能回归。

#### 关于 local provider 的语言注入

这里还有一个容易和 `searchWithTime` 混在一起误判的点：

1. Renderer 旧链路里的 `local-google` / `local-bing` 曾经会基于 `app.language` 给 query 注入 `lang:<xx>` 之类的语言 bias。
2. Main-side local provider 没有继续复制这项行为，这是当前分支的有意变化，不是迁移遗漏。
3. 当前分支的判断是：检索语言与最终回答语言不需要强绑定，Agent 可以对跨语言搜索结果继续用用户语言总结。
4. 因此 Main-side local provider 当前更偏向“扩大召回范围”，而不是默认按 UI 语言限制搜索语料。
5. 换句话说，当前分支不再把 `app.language` 作为隐式 query rewrite 策略；如果未来需要恢复语言偏置，也应作为显式检索策略再单独设计，而不是沿用旧 Renderer 的隐式注入。

#### `providers/factory.ts`

职责：

1. 将 provider id 映射到具体 driver
2. 把 provider 选择逻辑收敛到 Main

当前支持的 provider 分类：

1. `api`: `zhipu` / `tavily` / `searxng` / `exa` / `bocha` / `querit`
2. `mcp`: `exa-mcp`
3. `local`: `local-google` / `local-bing` / `local-baidu`

#### Provider Drivers

新增目录：

1. `src/main/services/webSearch/providers/api/`
2. `src/main/services/webSearch/providers/mcp/`
3. `src/main/services/webSearch/providers/locals/`

职责：

1. 封装各 provider 的网络协议
2. 把返回结果归一化成统一的 `WebSearchResponse`
3. 把 provider 级差异隔离在 Main 侧

当前已实现的关键差异处理：

1. `searxng` 仍然保持“先搜索，再抓取结果 URL 正文”的旧行为
2. `local-*` provider 仍然保持“只返回搜索结果摘要，不抓正文”
3. `exa-mcp` 通过 MCP 风格的 HTTP / SSE 文本响应解析结果

#### `postProcessing.ts`

职责：

1. 处理 `none`
2. 处理 `cutoff`
3. 为未来的 Main-side `rag` 保留入口

当前真实状态：

1. `none` 已实现
2. `cutoff` 已实现
3. `rag` 只是占位，当前仍直接返回原结果

#### `runtime/status.ts`

职责：

1. 将 `chat.web_search.active_searches` 写入 shared cache
2. 让 Renderer 可以观察 Main-side 搜索阶段变化

当前已落地的 phase 包括：

1. `fetch_complete`
2. `partial_failure`
3. `cutoff`

补充边界：

1. `partial_failure` 已经会由 Main-side service 写入 shared cache，表达“多 query 中部分失败但整体仍可返回结果”。
2. 当前 Renderer 还没有为 `partial_failure` 单独提供状态文案分支，因此 UI 上暂时会回退到默认 searching 文案。
3. `rag` 相关 phase 仍停留在状态模型层，没有完整 Main-side 执行逻辑。

审查约束：

1. `partial_failure` 已进入当前分支的 shared status model，但 Renderer 尚未补齐对应的独立 UI 文案，这属于本文档已声明并接受的阶段性差异，不单独作为本次分支的 review blocker。
2. 只要该行为仍符合这里描述的 fallback 语义，就不应把“状态模型已扩展、UI 文案尚未完全对齐”本身视为本次分支缺陷；后续若要补齐，应在切流与 Renderer 收口阶段统一处理。

#### 请求边界（暂未固化）

当前状态：

1. Main-side service 现在直接接收调用方传入的参数对象
2. `providerId` / `questions` / `requestId` 这一层保留了一份 shared request type，便于后续 Main / Renderer 共用
3. 但独立的 request schema 校验暂未接入公共入口
4. 也还没有把这层请求边界正式固化成稳定的公共 entry contract

这部分会在后续真正补 Main-side entry adapter / 调用链切换时再一起收敛：保留 shared type，延后 schema 校验与入口冻结。

### 3.4 测试覆盖

当前分支给 Main-side WebSearch 新增了比较完整的单测：

1. `src/main/services/webSearch/WebSearchService.test.ts`
2. `src/main/services/webSearch/providers/__tests__/ApiProviders.test.ts`
3. `src/main/services/webSearch/providers/locals/__tests__/LocalProviders.test.ts`
4. `src/main/services/webSearch/runtime/__tests__/status.test.ts`
5. `src/main/services/webSearch/utils/__tests__/*`

当前测试重点覆盖了：

1. `cutoff` post-processing
2. blacklist 过滤
3. partial success 行为
4. local provider 支持
5. 各 API provider 的协议解析

---

## 4. 当前分支改完以后，架构实际变成了什么

最准确的描述不是“Main 已经替代 Renderer”，而是：

1. Renderer 旧 WebSearch 栈还在
2. Main 新 WebSearch 栈已经新增出来
3. 两边暂时并存

### 4.1 当前真实拓扑

```text
+------------------------------------------------------------------------------------+
|                                  Existing Callers                                  |
|------------------------------------------------------------------------------------|
| aiCore / Search Orchestration / Settings Check / Chat Flow                         |
+-----------------------------------------------+------------------------------------+
                                                |
                                                v
+------------------------------------------------------------------------------------+
|                       Existing Renderer WebSearch Stack (still active)              |
|------------------------------------------------------------------------------------|
| src/renderer/src/services/WebSearchService.ts                                      |
| src/renderer/src/providers/WebSearchProvider/*                                     |
| Renderer-side compression / temporary KB / references selection                    |
+-----------------------------------------------+------------------------------------+
                                                |
                                                | status now writes shared cache
                                                v
+------------------------------------------------------------------------------------+
|                             Shared Cache / Shared Types                              |
|------------------------------------------------------------------------------------|
| chat.web_search.active_searches                                                     |
| packages/shared/data/types/webSearch.ts                                             |
+-----------------------------------------------+------------------------------------+
                                                ^
                                                |
+------------------------------------------------------------------------------------+
|                        New Main-side WebSearch Backend (new in branch)              |
|------------------------------------------------------------------------------------|
| WebSearchService                                                                    |
| Config Resolver                                                                     |
| Provider Factory                                                                    |
| API / MCP / Local Drivers                                                           |
| Blacklist Filter                                                                    |
| Post Processing (none / cutoff)                                                     |
+-----------------------------------------------+------------------------------------+
                                                |
                                                v
+------------------------------------------------------------------------------------+
|                              Incomplete Entry Layer                                  |
|------------------------------------------------------------------------------------|
| Main-side backend exists                                                             |
| but there is currently no public IPC / preload entry wired for it                    |
+------------------------------------------------------------------------------------+
```

### 4.2 这次分支没有做的事

以下内容仍然没有完成：

1. 对外 IPC / preload 入口尚未补齐
2. Renderer 主调用链切换到 Main-side `WebSearchService`
3. 设置页 provider 检查复用 Main-side driver
4. aiCore / search orchestration 改为调用 Main-side backend
5. shared request contract 与 Main-side 请求校验收敛
6. Main-side `rag` 压缩落地
7. 旧 Renderer provider 实现清理
8. tracing / span 迁移到 Main-side WebSearch 边缘
9. Renderer 层与 `chat.web_search.active_searches` 相关的进一步收敛和改写策略统一，留待后续切流阶段处理

所以当前分支的定位应当是：

`引入 Main-side backend`，而不是 `完成 WebSearch 迁移`

---

## 5. 当前已落地的执行流

如果只看新增的 Main-side backend，当前执行流如下：

```text
Caller
  -> Future Entry Adapter / In-Process Caller
  -> getProviderById(providerId)
  -> getRuntimeConfig()
  -> createWebSearchProvider(provider)
  -> Promise.allSettled(
       questions.map((question) => providerDriver.search(question, runtimeConfig))
     )
  -> merge successful results
  -> filterWebSearchResponseWithBlacklist()
  -> postProcessWebSearchResponse()
  -> setWebSearchStatus()
  -> clearWebSearchStatus()
  -> WebSearchResponse
```

补充说明：

1. `fetch_complete` 只会在多 query 且成功结果多于 1 个时写入
2. `partial_failure` 会在多 query 且至少一个成功、至少一个失败时写入
3. `cutoff` 由 `postProcessing.ts` 产出状态
4. blacklist 发生在结果 merge 之后、post process 之前
5. `clearWebSearchStatus()` 在 `finally` 中执行，因此无论成功或失败都会清理状态

---

## 6. 当前实现边界

### 6.1 上游负责什么

上游调用方仍然负责：

1. 把用户意图整理成 `questions`
2. 决定是否需要发起 WebSearch
3. 决定使用哪个 provider
4. 在当前分支里，很多调用方仍然直接走 Renderer 旧实现

### 6.2 Main-side WebSearch 负责什么

当前 Main-side WebSearch 已经负责：

1. provider 配置解析
2. provider driver 构造
3. provider 搜索执行
4. 结果归并
5. 黑名单过滤
6. `none` / `cutoff` 后处理
7. 搜索状态写入 shared cache

### 6.3 还不属于 Main-side contract 的内容

这些内容当前仍然不进入 Main-side contract：

1. 原始 `links`
2. `summarize`
3. XML 结构
4. Renderer toast / UI 文案
5. Renderer span / tracing 细节
6. 临时知识库驱动的 RAG 压缩执行链

---

## 7. 与 `v2` 的关系

从 `v2` 到当前分支，WebSearch 架构的核心变化可以概括为三句话：

1. `v2` 的搜索核心还在 Renderer。
2. 当前分支已经补出一套 Main-side backend。
3. 但当前分支还没有完成调用方切换，所以系统仍处于“双栈并存”阶段。

因此，现在最合适的定位不是：

`WebSearch 已迁移到 Main`

而是：

`WebSearch 的 Main-side backend 已落地第一版，后续还需要把 Renderer / aiCore / Settings 入口逐步切过去`

---

## 8. 后续迁移应以什么为目标

如果沿着这次分支继续推进，后续目标应该是：

1. Renderer 聊天链路改为通过统一入口调用 Main-side WebSearch
2. 设置页 provider 检查改为复用 Main-side provider driver
3. aiCore 迁移后直接成为 Main-side in-process caller
4. Renderer 旧 `providers/WebSearchProvider/*` 逐步下线
5. Main-side `rag` 压缩再决定是否补齐

完成这些步骤之后，文档才可以把 WebSearch 描述为：

`Main 的共享搜索后端`

而不是当前这个阶段性的：

`Main backend 已起出，但系统尚未完成切流`
