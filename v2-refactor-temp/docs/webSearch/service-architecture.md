# WebSearch Main Service Architecture

## 1. 文档目的

本文档定义下一版 Main-side WebSearch service 的目标架构。

这次重构的核心不是把现有 `searchUrls` / `searchKeywords` 简单改名，而是修正领域模型：

1. provider 是配置与凭据的归属。
2. capability 是 provider 能执行的动作。
3. 对调用方暴露意图明确的工具入口。

当前实现用 provider id 把搜索能力分成 `KeywordSearchProviderId` 和 `UrlSearchProviderId`，这会把“provider 是谁”和“它能做什么”混在一起。Jina 是最典型的问题：同一个 Jina 服务同时提供 URL 内容抓取和关键词搜索，但旧模型只能把它放进其中一类。

本次目标是把 Main-side WebSearch 调整成 `Provider + Capability` 架构。

---

## 2. 术语

### Provider

Provider 表示一个外部或本地 WebSearch 服务的配置主体。

Provider 负责承载：

1. 稳定 id
2. 展示名称
3. provider 类型，例如 `api` / `mcp`
4. API key
5. capability endpoint
6. provider-specific 配置，例如 engines / basic auth

Provider 不等同于一个执行动作。一个 provider 可以支持多个 capability。

### Capability

Capability 表示 provider 能执行的动作。

当前只定义两个 capability：

1. `searchKeywords`
2. `fetchUrls`

Capability 决定输入类型、provider driver 方法、endpoint 选择和测试方式。

### `searchKeywords`

`searchKeywords` 表示使用关键词或自然语言 query 执行 Web 搜索。

输入是一个或多个 keyword query。

输出是统一的 `WebSearchResponse`：

1. `query`
2. `results[]`
3. 每个 result 包含 `title` / `content` / `url`

示例 provider：

1. Zhipu
2. Tavily
3. Searxng
4. Exa
5. Exa MCP
6. Bocha
7. Querit
8. Jina

### `fetchUrls`

`fetchUrls` 表示抓取输入 URL 的正文内容。

输入是一个或多个 URL。

它不是搜索，不应做相关搜索、摘要扩展或 SERP 查询。它只把指定 URL 转成可供模型消费的内容。

示例 provider：

1. Fetch
2. Jina

旧名称 `searchUrls` 不再作为目标架构概念使用，因为它把 URL 内容抓取误称为搜索。

### Request

Request 表示一次 Main-side WebSearch 执行。

一次 request 必须只走一个工具入口。需要同时搜索关键词和抓取 URL 时，上游调用方应分别调用 `searchKeywords` 和 `fetchUrls`。

---

## 3. 架构决策

### 3.1 使用 Provider + Capability

目标模型：

```text
Provider
  -> capabilities[]
      -> searchKeywords
      -> fetchUrls
```

不再用两组 provider id 数组表达能力：

1. 不再用 `KEYWORD_SEARCH_PROVIDER_IDS` 决定谁能搜索关键词。
2. 不再用 `URL_SEARCH_PROVIDER_IDS` 决定谁能抓取 URL。

这些数组的问题是：一个 provider 只能被归到某个输入类别下，无法自然表达 Jina 这种多能力 provider。

### 3.2 Main service 暴露两个工具入口

Main-side service 的目标公共入口是两个意图明确的方法：

```typescript
searchKeywords({
  providerId?,
  keywords
})

fetchUrls({
  providerId?,
  urls
})
```

原因：

1. `searchKeywords` 和 `fetchUrls` 对 AI SDK tools 是两个不同工具。
2. tool description 可以让模型完成意图选择。
3. service request 不需要再携带 `capability` 字段。
4. WebSearchService 不接收、不生成、不返回 `requestId`；工具调用身份、lifecycle、abort 和 UI 状态由 tool block / tool runtime 承担。
5. service 内部仍可以复用一个私有执行管线，避免重复 fanout / merge / blacklist / post process 逻辑。

调用方职责：

1. 当用户意图是“查询北京天气”时，调用 `searchKeywords({ keywords: ['北京天气'] })`。
2. 当用户意图是“获取 xxx.com 的内容”时，调用 `fetchUrls({ urls: ['https://xxx.com'] })`。
3. 如果一次用户请求需要两类能力，调用方分别调用两个工具并自行编排结果。
4. `providerId` 是可选覆盖；不传时由 service 按 capability 读取默认 provider preference。

### 3.3 Driver 方法使用领域动作命名

Provider driver 不再统一暴露一个含糊的 `search(query)` 方法。

目标方法：

1. `searchKeywords(input, config, httpOptions?)`
2. `fetchUrls(input, config, httpOptions?)`

Driver 只实现自己支持的 capability。service 在调用前必须根据 provider capability registry 校验支持关系。

### 3.4 Jina 是一个 provider

Jina 在目标架构里是一个 provider，而不是两个 provider。

目标 provider id：

```text
jina
```

Jina 支持两个 capability：

1. `searchKeywords`
2. `fetchUrls`

Jina 的两个能力共享同一组 API key，但使用不同 endpoint。

Jina 官方 Reader 文档也把这两个能力分开描述：

1. `https://r.jina.ai` 用于读取 URL 并获取内容。
2. `https://s.jina.ai` 用于搜索网络并获取 SERP。

参考：

1. <https://jina.ai/reader/>
2. <https://github.com/jina-ai/reader>

### 3.5 不为 v2 旧数据做兼容

本次重构不考虑 v2 兼容性。

因此可以做破坏性调整：

1. `jina-reader` 可以改为 `jina`。
2. 旧 `searchUrls` request type 可以移除或替换。
3. 旧 provider id 分类类型可以移除。
4. 旧 preference 数据不需要迁移或别名兼容。

如果后续需要保护用户已有配置，应作为新的兼容性任务单独设计，而不是污染这次 Main service 架构。

---

## 4. Shared Contract

WebSearch preset 应参考 File Processing preset 的 layered preset pattern：

1. preset 是只读模板，放在 `packages/shared/data/presets/`。
2. 用户配置只存 override delta。
3. runtime config 由 preset 与 override merge 得到。
4. capability 是 preset 内的一等元素，capability 自己携带可覆盖的 API 配置。

File Processing 已经采用这个形状：

```typescript
capabilities: [
  {
    feature: 'document_to_markdown',
    inputs: ['document'],
    output: 'markdown',
    apiHost: 'https://mineru.net',
    modelId: 'pipeline'
  }
]
```

WebSearch 应复用这个设计语言，而不是重新发明一套 `defaultApiHost` / `capabilityApiHosts` 命名。

但 WebSearch 不需要照搬 File Processing 的 `inputs` / `output` 字段。File Processing 需要它们，是因为同一个 processor feature 要声明支持的文件输入类别和产物类型；WebSearch 的 capability 名已经决定输入语义，且输出统一是 `WebSearchResponse`。

### 4.1 Capability 类型

Shared contract 应定义稳定 capability：

```typescript
type WebSearchCapability = 'searchKeywords' | 'fetchUrls'
```

### 4.2 Request 类型

目标 request contract：

```typescript
type WebSearchSearchKeywordsRequest = {
  providerId?: WebSearchProviderId
  keywords: string[]
}

type WebSearchFetchUrlsRequest = {
  providerId?: WebSearchProviderId
  urls: string[]
}
```

输入约束：

1. `keywords` 必须至少包含一个非空 keyword query。
2. `urls` 必须至少包含一个合法 URL。
3. `searchKeywords` request 不接受 URL 抓取语义。
4. `fetchUrls` request 不接受 keyword 搜索语义。
5. `providerId` 是调用方可选覆盖，不应要求 AI 模型每次指定 provider。

### 4.3 Default Provider Preference

WebSearch 默认 provider 参考 File Processing 的 feature default 模式：每个 capability 一个 default preference。

目标 preference keys：

```typescript
'chat.web_search.default_search_keywords_provider': WebSearchProviderId | null
'chat.web_search.default_fetch_urls_provider': WebSearchProviderId | null
```

规则：

1. `searchKeywords` 未传 `providerId` 时读取 `chat.web_search.default_search_keywords_provider`。
2. `fetchUrls` 未传 `providerId` 时读取 `chat.web_search.default_fetch_urls_provider`。
3. default value 为 `null` 时，service 抛配置错误，不自动选择首个可用 provider。
4. request 显式传入 `providerId` 时，使用该 provider 作为覆盖。
5. 显式 provider 或 default provider 不支持对应 capability 时，service 抛明确错误，不自动 fallback。
6. 旧 `chat.web_search.default_provider` 不进入目标架构；本次不做旧 preference 兼容迁移。

### 4.4 Response 类型

继续使用统一 response：

```typescript
type WebSearchResult = {
  title: string
  content: string
  url: string
  sourceInput: string
}

type WebSearchResponse = {
  query?: string
  providerId: WebSearchProviderId
  capability: WebSearchCapability
  inputs: string[]
  results: WebSearchResult[]
}
```

`query` 的含义按 capability 解释：

1. `searchKeywords`：调用方传入的 keyword query 合并展示。
2. `fetchUrls`：调用方传入的 URL 合并展示。

`results` 始终是模型可消费内容，不暴露 provider 原始返回结构。

Trace metadata：

1. `providerId` 是本次 tool call 实际使用的 provider，包括 default provider 解析后的结果。
2. `capability` 是本次 tool call 的能力：`searchKeywords` 或 `fetchUrls`。
3. `inputs` 是本次 tool call 的规范化输入数组。
4. `sourceInput` 记录单条 result 来自哪个 keyword 或 URL，用于后续按 tool call / query 分组和去重。
5. 不在当前 contract 中加入 `warnings`、`failedInputs`。

`requestId` 不属于新的 WebSearch 领域 contract：

1. 单次 tool 调用的身份由 tool runtime / message block 的 tool call id 承载。
2. 多次 WebSearch tool 调用的聚合边界是 assistant turn，而不是 WebSearch 内部 request。
3. Abort、running、done、error 状态由 tool block lifecycle 表达。
4. WebSearchService 只负责执行 capability 并返回内容结果，不负责维护 UI 进度状态。

因此实现迁移时应删除 WebSearch request / response / status 中的 `requestId`，而不是保留空字段或透传字段。

`query` 必须保留 request input 的语义，而不是 provider 处理后的 query：

1. 可以做最小本地规范化，例如 trim 空白和 URL 校验。
2. 不应使用 Exa `autopromptString`、Bocha `originalQuery`、Tavily 返回的 `query` 等 provider response 字段覆盖它。
3. 不应记录旧 `searchWithTime` 这类注入后的 query。
4. 对 `fetchUrls`，`query` 保留输入 URL；最终跳转 URL 或 provider 返回 URL 应放在 result 的 `url` 字段。

如果后续确实需要展示 provider 改写后的 query，应新增 provider metadata 字段单独承载，不能改变 `query` 的含义。

### 4.5 Provider Definition

Provider definition 应表达 capability 与 endpoint 的关系。

目标结构参考 File Processing preset：

```typescript
type WebSearchProviderFeatureCapability =
  | {
      feature: 'searchKeywords'
      apiHost?: string
    }
  | {
      feature: 'fetchUrls'
      apiHost?: string
    }

type WebSearchProviderPresetConfig = {
  name: string
  type: WebSearchProviderType
  capabilities: readonly WebSearchProviderFeatureCapability[]
}

type WebSearchProviderPreset = {
  id: WebSearchProviderId
} & WebSearchProviderPresetConfig
```

命名规则：

1. 使用 `feature` 作为 discriminant，保持与 File Processing 的 capability schema 一致。
2. `apiHost` 是 capability 默认 endpoint，不再使用 provider 级 `defaultApiHost`。
3. 不增加 `inputs` / `output` 字段；`searchKeywords` 固定接收 keyword query，`fetchUrls` 固定接收 URL，输出统一为 `WebSearchResponse`。

对于只有一个 endpoint 的 provider，也把 endpoint 放在唯一 capability 上。

对于 Jina 这种多 endpoint provider，必须按 capability 配置 endpoint：

```text
jina.capabilities[feature=searchKeywords].apiHost -> https://s.jina.ai
jina.capabilities[feature=fetchUrls].apiHost      -> https://r.jina.ai
```

Preset map 的目标形状：

```typescript
export const WEB_SEARCH_PROVIDER_PRESET_MAP = {
  jina: {
    name: 'Jina',
    type: 'api',
    capabilities: [
      {
        feature: 'searchKeywords',
        apiHost: 'https://s.jina.ai'
      },
      {
        feature: 'fetchUrls',
        apiHost: 'https://r.jina.ai'
      }
    ]
  }
} as const satisfies Record<WebSearchProviderId, WebSearchProviderPresetConfig>
```

### 4.6 Provider Override

Provider override 需要支持 capability-specific endpoint。

目标语义：

1. API keys 仍属于 provider。
2. API host 属于 capability override。
3. engines / basic auth 仍按 provider 归属，除非后续某个 provider 明确需要 capability 级配置。
4. override 只存用户修改过的字段，不复制 preset 默认值。

示例语义：

```typescript
type WebSearchProviderCapabilityOverride = {
  apiHost?: string
}

type WebSearchProviderOverride = {
  apiKeys?: string[]
  capabilities?: Partial<Record<WebSearchCapability, WebSearchProviderCapabilityOverride>>
  engines?: string[]
  basicAuthUsername?: string
  basicAuthPassword?: string
}
```

`apiHost` 单字段不再足以表达目标架构。实现时应一次性替换为 capability-aware shape。

Merged provider config 应和 File Processing 一样保留 capability array，而不是把 capability override 暴露为 Record：

```typescript
type ResolvedWebSearchProvider = WebSearchProviderPreset & {
  apiKeys?: string[]
  capabilities: WebSearchProviderFeatureCapability[]
  engines?: string[]
  basicAuthUsername?: string
  basicAuthPassword?: string
}
```

merge 规则：

1. 先按 provider id 读取 preset。
2. 再读取 provider override。
3. provider-level 字段直接 merge。
4. capability override 按 `feature` merge 回 preset 的 `capabilities[]`。
5. 未出现在 preset capabilities 里的 override capability 应忽略或在 schema 层禁止。

---

## 5. Main-side 执行流

目标公共执行流：

```text
Caller
  -> WebSearchService.searchKeywords(request)
     or WebSearchService.fetchUrls(request)
  -> resolve providerId from request override or capability default preference
  -> resolve provider config
  -> validate provider supports the method capability
  -> create provider driver
  -> fanout request keywords/urls with matching driver method
  -> Promise.allSettled()
  -> reject immediately on AbortError
  -> log partial failures
  -> require at least one successful keyword or URL
  -> merge successful responses and keep request keywords/urls as response.query
  -> apply blacklist
  -> post process
  -> WebSearchResponse
```

### 5.1 Fanout

`keywords` / `urls` 使用 fanout 执行。

每个 keyword 或 URL 独立调用 provider capability 方法：

1. `searchKeywords` 调用 driver 的 `searchKeywords(input, ...)`。
2. `fetchUrls` 调用 driver 的 `fetchUrls(input, ...)`。

多个 keyword 或 URL 的结果按完成后的 successful results 合并。

实现可以有一个私有 helper 承载共同流程，例如：

```typescript
private runCapability({
  providerId,
  feature,
  inputs
})
```

这个 helper 是实现细节，不作为 AI SDK tools 或对外 service contract。

### 5.2 部分失败

继续保留当前 Main-side 语义：

1. 如果有 AbortError，整次 request 立即按 abort 失败。
2. 如果至少一个 keyword 或 URL 成功，整次 request 可以返回成功结果。
3. 如果所有 keyword 或 URL 都失败，整次 request 失败。
4. 部分失败不再通过 shared cache 写 UI 状态；service 记录日志并返回成功结果。
5. 部分失败不写入 `warnings` / `failedInputs`；当前 response contract 只返回成功结果。

### 5.3 UI 展示与状态

WebSearch tool 化后仍然需要展示搜索结果。

目标 UI 数据来源：

1. 每次 `searchKeywords` / `fetchUrls` tool call 都产生一个 `WebSearchResponse`。
2. Tool execution UI 复用现有 MCP / tool block UI，展示 running / done / error。
3. 右侧“搜索结果”面板按 assistant turn 聚合该轮所有 web search/fetch tool outputs。
4. inline citation / sources 从同一份聚合结果派生。
5. `searchKeywords` 和 `fetchUrls` 都输出 `{ title, content, url }[]`，UI 不需要知道 provider 原始协议。

推荐聚合规则：

1. 聚合范围是当前 assistant message / assistant turn，而不是单个 tool call。
2. 默认按 tool call 或 query 分组，组内按 provider 返回顺序展示。
3. 相同 URL 去重，保留第一次出现的编号和内容。
4. `searchKeywords` 与 `fetchUrls` 可以在同一个面板展示，但应保留来源标签或分组标题。
5. 部分失败只影响对应 tool call；成功结果仍进入聚合结果。

这类结果展示不依赖 `chat.web_search.active_searches`。`active_searches` 只适合表达运行中的短暂进度，不适合保存或聚合搜索结果。

#### `chat.web_search.active_searches`

新 Main-side WebSearch 架构不再需要 `chat.web_search.active_searches`。

当前代码里的 `chat.web_search.active_searches` 是旧 UI 进度通道：

1. Renderer `CitationBlock` 读取它来显示 processing spinner 文案。
2. 旧 Renderer WebSearch service 写入它来显示 `fetch_complete` / `partial_failure` / `cutoff`。
3. 当前 Main-side prototype 也写入它，是为了让 Main 执行时能复用同一套 UI spinner。

Tool 化后，这个 shared cache 不再是结果展示边界：

1. AI SDK tool call 本身已经有运行中、完成、失败的生命周期。
2. `fetch_complete` 可以由 tool result 的 sources count 和 tool block 完成状态表达。
3. `partial_failure` 是 service 内部 fanout 的降级语义，不一定需要 UI 单独展示。
4. `cutoff` 是后处理细节，不应要求一个跨窗口 cache key 才能工作。

目标架构中：

1. 搜索结果面板从该 assistant turn 的 tool blocks 聚合 `WebSearchResponse.results`。
2. WebSearchService 不写 `chat.web_search.active_searches`。
3. WebSearchService 不依赖 `WebSearchStatus` / `WebSearchPhase`。
4. UI 运行中状态由 AI SDK tool invocation state 或 message/tool block state 表达。
5. 如果 UI 仍需要跨组件的细粒度进度，再新增明确的 tool progress event、callback 或 tool block progress 字段；不要把 shared cache 作为 service contract。

旧 Renderer 链路如果仍依赖 `chat.web_search.active_searches`，可以留到旧链路清理时删除。它不属于新 Main-side WebSearch 架构。

### 5.4 Blacklist 与 Post Processing

处理顺序固定为：

```text
merge successful responses
  -> blacklist filter
  -> post processing
```

理由：

1. blacklist 应作用于所有 provider 归一化后的 URL。
2. cutoff 应作用于最终进入模型上下文的内容。

---

## 6. Provider Capability Matrix

目标 capability matrix：

| Provider | ID | searchKeywords | fetchUrls | Notes |
| --- | --- | --- | --- | --- |
| Zhipu | `zhipu` | Yes | No | API keyword search |
| Tavily | `tavily` | Yes | No | API keyword search |
| Searxng | `searxng` | Yes | No | 搜索后内部抓取搜索结果 URL 正文，但对外仍是 `searchKeywords` |
| Exa | `exa` | Yes | No | API keyword search |
| Exa MCP | `exa-mcp` | Yes | No | MCP-style keyword search |
| Bocha | `bocha` | Yes | No | API keyword search |
| Querit | `querit` | Yes | No | API keyword search |
| Fetch | `fetch` | No | Yes | 本地 URL 内容抓取 |
| Jina | `jina` | Yes | Yes | `s.jina.ai` 搜索，`r.jina.ai` 抓取 URL |

注意：Searxng 内部会抓取搜索结果页面内容，但它的外部 capability 仍是 `searchKeywords`。Capability 描述的是调用方输入语义，不是 provider 内部实现步骤。

---

## 7. Settings 与 Check 行为

Settings 仍按 provider 展示配置，但需要展示 provider 支持的 capability。

目标展示语义：

1. 一个 provider 一个配置区。
2. API key 属于 provider。
3. endpoint 按 capability 展示。
4. Jina 显示 `searchKeywords` 和 `fetchUrls` 两个 endpoint。

Provider check 应按 capability 执行。

检查输入：

1. `searchKeywords` 使用稳定 test query，例如 `test query`。
2. `fetchUrls` 使用稳定 URL，例如 `https://example.com`。

检查结果：

1. 所有 capability 都通过，provider check 才算通过。
2. 某个 capability 失败时，错误信息应带 capability，避免用户不知道是哪条 endpoint 或能力失败。

---

## 8. 当前不做的事

本次 Main-side 架构重构不包含：

1. Renderer / aiCore 执行链路切到 Main-side service。
2. Renderer 旧 `WebSearchService` 和旧 provider driver 清理。
3. IPC / preload 公共入口设计。
4. tracing / span 迁移。
5. Main-side `rag` post processing 实现。
6. 旧 preference 数据兼容迁移。
7. `searchWithTime` 恢复。
8. 把右侧搜索结果面板绑定到 `chat.web_search.active_searches`。

`searchWithTime` 仍视为旧 Renderer WebSearch 栈里的遗留行为，不进入新的 Main-side runtime contract。

---

## 9. 测试要求

实现本架构时必须更新或新增以下测试。

### 9.1 Provider Registry / Factory

覆盖：

1. 每个 provider 的 capability matrix。
2. 不支持 capability 时抛明确错误。
3. Jina 同时支持 `searchKeywords` 和 `fetchUrls`。

### 9.2 Provider Drivers

覆盖：

1. Jina `fetchUrls` 使用 `https://r.jina.ai` endpoint。
2. Jina `searchKeywords` 使用 `https://s.jina.ai` endpoint。
3. Fetch 只支持 `fetchUrls`。
4. Keyword-only provider 不支持 `fetchUrls`。
5. URL 输入非法时，`fetchUrls` 在发请求前失败。

### 9.3 WebSearchService

覆盖：

1. `searchKeywords()` fanout 与结果合并。
2. `fetchUrls()` fanout 与结果合并。
3. 未传 `providerId` 时读取对应 capability default provider。
4. default provider 为 `null` 时抛配置错误。
5. 显式或默认 provider 不支持 capability 时抛明确错误。
6. response 包含 `providerId` / `capability` / `inputs` 和 result 级 `sourceInput`。
7. 部分失败时仍返回成功结果并记录失败日志。
8. 全部失败时抛错。
9. AbortError 直接向上抛。
10. 单个 tool call 返回的 `WebSearchResponse.results` 可被 assistant turn 级搜索结果面板聚合。
11. blacklist 发生在 post processing 前。

### 9.4 Settings Check

覆盖：

1. 多 capability provider 会逐 capability 检查。
2. capability check 失败时错误带 capability。
3. Jina 两个 endpoint 分别可配置。

---

## 10. 迁移后的目标状态

完成本架构后，Main-side WebSearch 应具备以下形态：

```text
Shared Provider Preset
  -> provider capabilities
  -> capability endpoint defaults

Preference Override
  -> provider credentials
  -> capability endpoint overrides

Main WebSearchService
  -> searchKeywords(providerId?, keywords)
  -> fetchUrls(providerId?, urls)
  -> provider capability validation
  -> provider driver capability method
  -> result normalization
  -> blacklist
  -> post processing
```

这时 WebSearch 的核心边界会变成：

1. Provider 表达“用哪个服务和配置”。
2. Capability 表达“执行哪类动作”。
3. Service tools 表达“调用方或 AI 模型可以选择的意图入口”。
4. Request 表达“这次工具调用的一组同类输入”。

这个模型可以自然支持 Jina 这类多能力 provider，也避免继续把 URL 内容抓取伪装成搜索。
