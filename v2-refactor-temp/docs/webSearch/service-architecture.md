# WebSearch Service Architecture (V2)

## 1. 目标

WebSearch 的 v2 目标是把搜索核心能力稳定地收敛到 Main 进程，形成一套可复用的后端能力，而不是继续让搜索逻辑分散在 Renderer、工具层和不同入口里。

这套能力的设计目标：

1. 核心搜索逻辑统一放在 Main。
2. 对外只暴露共享执行契约，不暴露 Renderer 专用状态或 UI 细节。
3. 同一份能力可被多个入口复用，而不是每个入口复制一套实现。
4. Electron 相关依赖被限制在边缘层，核心逻辑尽量保持可迁移、可复用。

当前约束：

1. Main-side contract 只接收归一化后的 `question: string[]`。
2. raw `links` / `summarize` 这类上游编排信号不进入新的 Main-side contract。
3. RAG 压缩能力暂不在 Main 侧落地，当前只保留压缩配置和状态模型。

### 1.1 当前实现范围 / Review Contract

这份文档对应的当前实现与 review 合同如下：

#### 任务

当前改动的确切任务是把 `web search service` 从 Renderer 侧实现迁移到 Main 进程，形成一套可复用的 Main-side 搜索服务，并通过 preload / IPC 暴露统一调用入口。

#### In Scope

本次明确在范围内的行为包括：

1. Main 侧 `webSearch` service、config resolver、provider factory、provider drivers 的建立。
2. `api`、`mcp`、`local` 三类 provider 在 Main 中执行搜索。
3. shared contract、IPC channel、preload bridge 的接通。
4. Main 侧状态写入 `chat.web_search.active_searches`。
5. Main 侧黑名单过滤。
6. `local` 保持“只返回摘要”。
7. `searxng` 保持与旧 Renderer 一致，先搜索，再按结果 URL 抓取正文。
8. Main 侧请求输入校验。

#### Out of Scope

本次明确不在范围内，或刻意不做的内容包括：

1. Renderer 调用链路切换到新的 Main service。
2. `rag` 相关能力在 Main 落地。
3. `summarize` / `links` 这类上游编排信号进入 Main contract。
4. 旧 Renderer web search 实现的清理。
5. 旧 Renderer store 中 `subscribeSources` 黑名单机制迁移到 Main。

#### Constraints

当前已知约束和暂时需要跳过的点包括：

1. 所有数据相关实现必须遵循 `docs/en/references/data/`。
2. review 只围绕这次 Main-side web search 重构，不扩散到 Renderer 重构。
3. `rag` 当前冻结，不作为这次实现目标。
4. 旧 Renderer 黑名单订阅源机制后续会删除，因此本次不围绕它补 shared / Main 数据模型。

#### Frozen Areas

当前没有额外声明“后续 PR 落地前不能改”的模块或接口。

#### Review Priority

如果存在取舍，这次 review 的优先级是：

1. `架构简洁`
2. 正确性
3. 类型安全

不是以发版速度为第一优先。

---

## 2. 设计原则

1. **能力先于入口**：先做稳定的 Main backend，再决定由哪些入口接入。
2. **执行与配置分离**：Preference 描述“用户怎么配”，Contract 描述“系统怎么执行”。
3. **共享契约单一来源**：跨进程、跨入口统一使用 shared types。
4. **边缘依赖外置**：IPC、BrowserWindow、本地抓取等 Electron 依赖留在边缘层。
5. **适度分层**：只保留当前实现真正需要的模块，不为了“架构完整”提前加层。

---

## 3. 谁会调用 WebSearch Service

v2 下，WebSearch Service 是 Main 侧能力中心。不同调用方都应该围绕它组织，而不是各自拥有独立实现。

### 3.1 Renderer 聊天与搜索编排

Renderer 最终会通过 preload + IPC 调用 Main WebSearch Service。

适用场景：

1. 聊天消息中的内置 web search。
2. 搜索编排插件触发的外部搜索。
3. 任何需要把搜索结果回填到消息引用块的 UI 流程。

这类调用的设计要求：

1. Renderer 只负责发起请求、消费结果、展示状态。
2. 搜索编排与 provider 执行不再留在 Renderer 内部。

### 3.2 Renderer 设置页与 Provider 校验

设置页中的 provider 可用性检测，本质上也是 WebSearch backend 的调用方。

适用场景：

1. “检查搜索连通性”
2. 多 API key 连通性检测

这类调用未必必须复用 `search()` 主流程，但应该复用同一套 provider 配置解析和 driver 执行能力，而不是保留一套平行的 Renderer-only 校验实现。

### 3.3 aiCore

aiCore 是 v2 中的重要调用方，但**未来会迁移到 Main**。

因此架构上要明确：

1. 当前如果 aiCore 还在 Renderer，它只是过渡状态。
2. 长期目标不是让 aiCore 通过 Renderer 间接访问 WebSearch。
3. aiCore 迁到 Main 后，应直接以 Main 内部调用的方式接入 WebSearch Service，而不是继续依赖 preload / IPC。

换句话说，aiCore 在最终形态下是 WebSearch Service 的 **Main-side in-process caller**。

### 3.4 Gateway / HTTP API

如果未来提供外部 HTTP 能力，Gateway 应作为 WebSearch Service 的适配层，而不是维护另一套搜索实现。

### 3.5 CLI

CLI 也是同样的道理：它应该只是另一个入口，不应拥有独立的 provider 逻辑或配置拼装逻辑。

---

## 4. 总体拓扑

```text
+----------------------------------------------------------------------------------+
|                                   Callers                                        |
|----------------------------------------------------------------------------------|
| Renderer(UI) | Renderer(Settings) | aiCore(Main, future) | Gateway | CLI        |
+--------------------+--------------------+--------------------+---------+---------+
                     |                    |                    |         |
                     v                    v                    v         v
+----------------------------------------------------------------------------------+
|                             Adapters / Entry Points                               |
|----------------------------------------------------------------------------------|
| IPC Adapter        | Provider Check Adapter | In-Process Adapter | HTTP | CLI    |
+---------------------------------------------+--------------------+------+--------+
                                              |
                                              v
+----------------------------------------------------------------------------------+
|                         WebSearch Application Service (Main)                      |
|----------------------------------------------------------------------------------|
| 1) ConfigResolver                                                                |
| 2) WebSearchService                                                              |
| 3) Provider Factory                                                              |
| 4) PostProcessor                                                                 |
| 5) Status Writer / Logger                                                        |
+----------------------------------------------------------------------------------+
                    |                         |                        |
                    v                         v                        v
         +------------------+      +------------------+     +----------------------+
         | API Drivers      |      | MCP Drivers      |     | Local Drivers        |
         | zhipu/tavily/... |      | exa-mcp          |     | google/bing/baidu    |
         | bocha/querit     |      |                  |     |                      |
         +------------------+      +------------------+     +----------------------+
```

---

## 5. 分层与职责

### 5.1 Shared Contracts Layer

文件：

`packages/shared/data/types/webSearch.ts`

职责：

1. 定义 `WebSearchRequest`
2. 定义 `WebSearchQueryInput`
3. 定义 `WebSearchResult`
4. 定义 `WebSearchResponse`
5. 定义 `WebSearchStatus`
6. 定义 `WebSearchError`
7. 定义 `ResolvedWebSearchProvider`

边界：

1. 只放执行契约，不放 UI 字段。
2. 不放 raw `links` / `summarize` 这类上游协议。
3. contract 表示“已整理好的搜索请求”，不是“原始用户输入”。

### 5.2 Preference & Preset Layer

文件：

1. `packages/shared/data/preference/preferenceTypes.ts`
2. `packages/shared/data/preference/preferenceSchemas.ts`
3. `packages/shared/data/presets/web-search-providers.ts`

职责：

1. 保存 provider 类型与 id 集合。
2. 保存 override 结构。
3. 保存内置 provider preset。
4. 继续沿用 `chat.web_search.*` 偏好键。

当前 provider 集合：

1. `api`: `zhipu` / `tavily` / `searxng` / `exa` / `bocha` / `querit`
2. `mcp`: `exa-mcp`
3. `local`: `local-google` / `local-bing` / `local-baidu`

### 5.3 Main Application Layer

#### `WebSearchConfigResolver`

职责：

1. 从 PreferenceService 读取 `chat.web_search.*`
2. 合并 preset 与 user override
3. 输出 runtime config 与 resolved provider

#### `WebSearchService`

职责：

1. 根据 `providerId` 解析 provider
2. 执行 query fanout
3. 汇总搜索结果
4. 调用 post-processing
5. 写入状态
6. 输出统一响应

不负责：

1. UI toast
2. Renderer 状态管理
3. Prompt 提取
4. 原始 XML 协议解释

#### `providers/factory.ts`

职责：

1. 按 provider id 构造具体 driver
2. 把 id 到 driver 的映射收敛在 Main

#### Provider Drivers

职责：

1. 封装外部 provider 请求细节
2. 归一化返回结果
3. 屏蔽各 provider 的协议差异

#### `postProcessor.ts`

职责：

1. 处理 `none`
2. 处理 `cutoff`
3. 为未来的 RAG 或其他压缩策略保留位置

#### `status.ts`

职责：

1. 将 `chat.web_search.active_searches` 写入 shared cache
2. 让 Renderer 可以观察搜索阶段变化

#### 日志与追踪

当前：

1. 统一通过 `loggerService`

未来：

1. tracing 可以在 Main 侧入口适配层或 service 边缘补齐

### 5.4 Adapter / Entry Layer

当前已存在：

1. `ipcMain.handle(IpcChannel.WebSearch_MainSearch)`
2. `window.api.webSearch.mainSearch()`

架构上预期存在的入口类型：

1. Renderer IPC 调用
2. Provider 健康检查调用
3. aiCore Main 内部调用
4. Gateway HTTP 调用
5. CLI 调用

---

## 6. 关键边界

### 6.1 上游负责什么

上游调用方负责：

1. 把用户意图整理成搜索问题
2. 决定是否需要调用 WebSearch
3. 决定调用哪个 provider

### 6.2 WebSearch Service 负责什么

WebSearch Service 负责：

1. 配置解析
2. provider driver 选择
3. 搜索执行
4. 结果汇总
5. 状态输出

### 6.3 不进入 Main-side contract 的内容

这些内容不属于新的 Main-side contract：

1. raw `links`
2. `summarize`
3. XML 结构
4. UI 文案
5. toast / span 的 Renderer 细节

---

## 7. 执行流

```text
Caller
  -> Adapter / Entry
  -> WebSearchConfigResolver.getProviderById()
  -> createWebSearchProvider(provider)
  -> WebSearchService.search(request.input.question)
     -> ProviderDriver.search(query)
  -> Result merge
  -> PostProcessor(none/cutoff)
  -> Status write + logger
  -> Response
```

---

## 8. 与 v2 的关系

这份设计文档描述的是 v2 下 WebSearch 的**目标后端形态**。

对 v2 来说，重要的不是“某个入口今天是否已经切过去”，而是：

1. Main backend 是唯一搜索核心。
2. Renderer 只是调用方，不再长期持有一份完整搜索实现。
3. aiCore 未来迁到 Main 后，会直接成为 WebSearch Service 的 Main 内部调用方。
4. Gateway、CLI、设置页校验都应该围绕同一套 Main 能力组织。

因此，v2 中 WebSearch Service 的定位不是“Renderer 的一个附属能力”，而是“Main 的共享搜索后端”。
