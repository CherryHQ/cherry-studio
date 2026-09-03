# Extension 体系：通用宿主 + 贡献点，Provider 是第一个贡献点

> 状态：设计稿（未实现）。日期：2026-09-03。
> 目标：定义 Cherry Studio 的 extension 体系——包格式、安装、运行、以及"贡献点"模型——并以 **model provider** 作为第一个贡献点落地。宿主层是通用的；provider 只是第一个消费者。
> 试金石：[PR #19882（TokenDance）](https://github.com/CherryHQ/cherry-studio/pull/19882)——一个协议完全标准的 provider，进主仓库改了 49 个文件。这个设计的目标是让同样的 provider 变成一个扩展包，主仓库零改动。

## 0. 一页结论

| 问题 | 决定 |
|---|---|
| 扩展包是什么 | zip，根目录 `manifest.json`，可选 `main.js`（主进程代码，单文件 ESM）。**复用 mini app 安装代码的实现**：归档检查、同意账本、staging、下载校验、崩溃日志、锁抽到 `services/packageInstall/`，两边共用（§3.2 / §3.3） |
| 一个扩展能贡献什么 | `contributes: { <kind>: [...] }`，kind 对应仓库里已有的注册表：`providers` / `webSearchProviders` / `fileProcessors` / `channels` / `agentRuntimes` / `mcpServers` / `skills` / `codeCliTools`。v1 只实现 `providers` |
| 宿主与贡献点的分工 | 宿主管信封、安装、生命周期、加载代码；**每个 kind 的 schema 与注册/注销由该子系统自己拥有**（VS Code contribution point 模型） |
| 开发方式 | `@cherrystudio/extension-sdk` 写 TypeScript（`defineExtension` / `defineProvider`），`cherry-ext build` 生成 `manifest.json` + 单文件 `main.js`；开发者不手写 manifest |
| Provider 贡献点的稳定 API | **全部 Cherry 自有类型，不暴露 AI SDK**。L0 数据 = registry `ProviderConfig` + `headers` / `configuration` / `models`；L1 钩子 = `listModels` / `acquireCredential` / `refreshCredential` / `transformRequest`；L2 模型接口 = `languageModel` / `embeddingModel` / `imageModel` / `rerankModel`，宿主内部适配到 AI SDK |
| id | 扩展 id 反向域名；贡献项 id 局部，宿主合成 `扩展id[.局部id]`；内置 id 无 `.` 故永不冲突 |
| Runtime v1 | 主进程内 `import()`；受信任代码模型。**仅用于用户自选文件/URL 安装** |
| Runtime v2（API 不变） | Electron `utilityProcess` + `fetch` 反向桥。**我们自己分发索引之前必须落地** |
| 版本 | manifest `apiVersion: 1` + `minAppVersion`；SDK 类型只增不改，破坏性变更走 `…V2`；AI SDK 版本对扩展不可见，升级只改宿主 adapter |

## 1. 仓库里已经存在的"扩展形状"

### 1.1 已有的安装单元

| 单元 | 包格式 | 安装管线 | 运行 | 权限模型 |
|---|---|---|---|---|
| Mini app | `.miniapp` zip + `manifest.json` | `features/miniApp/install/*`：预览 → 同意卡 → 确认（重算 hash）→ 一事务提交；`mini_app_installation` 存 manifestJson + previous* 供回滚 | 沙箱 webview + `window.cherry` 桥 | `MINI_APP_METHODS` 表：声明 vs 授予分开存，更新时 diff |
| MCP 包 | `.mcpb`（DXT 格式）manifest + zip | `McpPackageService` | 子进程 stdio | 无 |
| Skill | 目录 / zip / GitHub release | `SkillService` + `skillArchive.ts` | 数据（markdown） | 无 |
| 本地模型 | HF/ModelScope 镜像 bundle | `localModel/acquisition` | worker_threads | 无 |
| Code CLI 工具 | npm/pipx/aqua 包 | mise（binary-manager） | 外部进程 | 无 |

结论：**mini app 是这个仓库里最完整的 extension host**——信封校验、同意、hash 一致性、回滚、授权 diff 全都有，而且已经有文档和测试。extension 体系应当复用它的信封与安装流程，差异只在"运行的是主进程代码而不是沙箱页面"。

### 1.2 已有的注册表 = 天然贡献点

| kind | 现有注册表 | 形态 | 纯数据可行？ | 代码接口 | 进程 |
|---|---|---|---|---|---|
| `providers` | `provider-registry` + `extensionRegistry`（aiCore） | `defineProvider()` 数据 + `ProviderExtension.create({ create })` | 是（协议标准的中转站） | `createProvider(settings) → ProviderV3` | main |
| `webSearchProviders` | `WEB_SEARCH_PROVIDER_REGISTRY`（构造函数表） | `class implements WebSearchProviderDriver` | 否 | `searchKeywords` / `fetchUrls` | main |
| `fileProcessors` | `fileProcessing/processors/registry.ts` | 按 id 的处理器表 | 否 | processor 接口 | main |
| `channels` | `registerAdapterFactory(type, factory)` | **已经是自注册工厂表** | 否 | `ChannelAdapter` | main |
| `agentRuntimes` | `runtimeDriverRegistry` + `AGENT_RUNTIME_CAPABILITIES` | driver + 描述符 | 否 | `AgentSessionRuntimeDriver` | main |
| `mcpServers` | `presets/mcpServers.ts` | 数据 | 是 | — | — |
| `skills` | `SkillService` | 数据 | 是 | — | — |
| `codeCliTools` | `presets/codeCliTools.ts` | mise 安装事实 | 是 | — | — |
| （渲染层）file preview 插件 | `FilePreview/filePreviewRegistry.ts` | React 组件 | 否 | 组件 | renderer，**v1 不做** |

这些注册表今天都是编译期闭合的常量表。extension 体系要做的事只有一件：**给每个表加一个运行时入口**。表的 schema、校验、注册顺序仍由各子系统自己管。

## 2. PR #19882 解剖：一个"标准 provider"实际碰了什么

TokenDance 只走 OpenAI / Anthropic / Gemini 标准协议，`defineProvider` 只有 42 行。但 PR 改了 49 个文件，拆开看是 **五个贡献 + 三处宿主硬编码**：

| PR 里的改动 | 本质 | 在 extension 体系里 |
|---|---|---|
| `providers/tokendance.ts` + `providers.json` + `index.ts` | provider 连接事实 | manifest `contributes.providers[0]`（数据） |
| svg + 4 个 tsx + `catalog/loaders/meta-catalog` 重新生成 | 图标 | manifest `icon` 文件，走已有的 `logoSrc` 渲染路径；**不再进 icon catalog** |
| `label.ts` + 14 个 locale 文件 | 显示名 | manifest `name`（字符串或 locale map，同 mini app）；`getProviderLabelKey(id, fallback)` 已支持回退 |
| `listModels.ts` + `listModelsSchemas.ts`（`supported_protocols` → endpointTypes） | 自定义模型发现 | 扩展代码 `listModels()` |
| `tokenDanceOAuth.ts`（PKCE + 127.0.0.1 回调）+ IpcApi 路由 + 渲染层 launcher | 浏览器授权换 API key | 扩展钩子 `acquireCredential()` 返回结构化凭证；IpcApi 路由和 launcher 变成**通用的一条** |
| `constants.ts` `X-App-URL` + `utils/provider.ts` `getExtraHeaders` 特判 | 固定归因头 | manifest `headers`（数据）；宿主在 `getExtraHeaders` 合并一次 |
| `pi/modelInjection.ts` + `dsh/modelInjection.ts` 改走 `getExtraHeaders` | agent runtime 也要带头 | PR 已经把口子打通；数据从 manifest 来后不再需要逐 provider 改 |
| `systemProviderId.ts` + `API_KEY_OAUTH_PROVIDER_IDS` + `iconDisplayConfig.ts` + `OauthButton` 的 id→launcher 表 + `oauth.ts` 的充值/账单 URL 表 | **宿主硬编码** | 一次性改成读 provider 行（`authMethods` / `metadata.website`），此后不再逐 provider 改 |
| `product-manifest.json` | 生成物 | 非扩展关心 |

两条结论：

1. **"provider"不是一个贡献点，是一组。** 连接事实、图标、显示名、模型发现、授权流、请求头——前三个是数据，后三个可能是代码。设计必须让数据部分零代码、代码部分只写业务。
2. **代码贡献只到达 in-app AI SDK 路径。** pi / dsh / claude-code 运行时拿的是 `{ baseUrl, apiKey, headers, api }`，不经过 `createProvider`。所以**凡是 agent 运行时必须看见的东西（endpoint、头、鉴权方式）只能是 manifest 数据**。这条规则决定了下面 API 的边界。

## 3. 扩展信封（宿主层，kind 无关）

```jsonc
// manifest.json —— 与 mini app manifest 同一套 id / name / version / icon / update 约定
{
  "id": "space.tokendance.cherry",      // 反向域名，同 mini app 规则；全局唯一
  "name": { "en": "TokenDance", "zh": "TokenDance" },
  "description": "…",
  "version": "1.0.0",
  "icon": { "path": "icon.png", "sha256": "…" },
  "apiVersion": 1,                      // 扩展 API 主版本；宿主 SUPPORTED_API_VERSIONS = [1]
  "minAppVersion": "2.1.0",
  "main": "dist/main.js",               // 可选；纯数据扩展不填
  "network": ["tokendance.space"],      // 声明会访问的主机；同意卡展示；v1 不强制
  "contributes": {
    "providers": [ /* §4 */ ]
    // 未来：webSearchProviders / fileProcessors / channels / agentRuntimes / mcpServers / skills / codeCliTools
  },
  "update": { "url": "https://…/manifest.json" }   // 可选；复用 mini app 的分发 manifest 流程
}
```

宿主只校验信封：id 格式、版本、`apiVersion`、`main` 存在性、`contributes` 的 key 是已注册 kind、每个 kind 的 items 交给该 kind 的 schema 校验。**宿主不认识任何 kind 的内容。**

### 3.1 贡献点接口（宿主与子系统的契约）

```ts
// src/main/services/extension/contributionPoint.ts —— 全部公开面
export interface ContributionPoint<TItem, TModule = never> {
  kind: string                              // 'providers'
  schema: z.ZodType<TItem>                  // 该 kind 的 item schema，子系统拥有
  /** 安装/启用时调用；纯数据 kind 的 module 为 undefined。返回注销函数。 */
  register(ext: ExtensionRef, items: TItem[], module?: TModule): Promise<() => void>
}
export interface ExtensionRef { id: string; version: string; dir: string }
```

各子系统在自己目录里实现并注册（`providerContributionPoint.ts` 放在 `src/main/ai/provider/`，`webSearchContributionPoint.ts` 放在 `src/main/services/webSearch/`）。宿主维护 `Map<kind, ContributionPoint>`，安装时按 kind 分发。

> 纪律：这个接口在 **第二个 kind 落地时** 才抽出来。P0/P1 阶段宿主直接调 provider 的注册函数——单一使用者不建抽象。但 manifest 的 `contributes` 形状从第一天就是 map，避免以后迁移用户已安装的包。

### 3.2 安装 / 生命周期：复用 mini app 的实现

已决定：**复用实现，不只是复用约定。** 依据是逐文件读过 `src/main/features/miniApp/install/`（3254 行、8 个测试文件）后的切分：

| 模块 | 行数 | 通用部分（抽走） | mini app 专属（留下） | 抽取方式 |
|---|---|---|---|---|
| `archive.ts` | 307 | 条目表预检（大小、条目数、符号链接、路径包含、"压缩了文件夹"前缀容错）、解压、`assertTreeContained`、`sha256File`、预览不落盘 | 限额常量、保留目录 `__cherry`、`entry` / `icon.path` 必须是普通文件、`MiniAppManifestSchema.parse` | 参数化：`{ manifestSchema, limits, reservedDirs, requiredFiles(manifest) }` |
| `installFlow.ts` | 437 | 待同意账本 `MiniAppInstallConsentService`（`beginPreview` / `endPreview` / `assertLive` / `register` / `take` / `cancel`：每窗口一个 claim、TTL、token 不区分"不存在/过期/别人的"）、`assertManifestUnchanged`（JSON 逐字节相等）、"确认前重算文件 hash"模式 | 同意卡摘要（grants、placement）、`confirmPendingInstall` 的三源分派、builtin 源 | 账本按 `PendingInstall<TManifest, TPayload>` 泛型化；三源分派每个 kind 自己写 |
| `installer.ts` | 694 | `createStagingDir` / `sweepAbandonedStaging` / `copyTreeToStaging` / `hashFile` / `hashTree` / `resolveInsideTree` / `assertIconMatchesDigest` | `installExtracted` → `publishInstall` / `publishReinstall`（写 `mini_app` 三张表 + grants + activity log + 清 partition）、`wipeMiniAppData`、`uninstallMiniApp`、`assertOfficialNamespace`（官方命名空间策略） | staging 根目录参数化；DB 提交每个 kind 自己写，形状照抄 |
| `httpSource.ts` | 278 | `assertHttps`、`mirrorOrder`（region 选镜像）、`fetchManifest`（边收边计数、超限即断）、`fetchPackage`（流式计数 + 期望 sha256/size/origins 校验、`DownloadedPackage.cleanup`）、`fetchIcon` | 只有 `MiniAppDistributionManifestSchema` 这一个类型绑定 | `fetchManifest<T>(urls, schema)` |
| `webInstaller.ts` | 1006 | 更新评审账本（同 TTL 模式）、"三棵树"发布（install / rolling / backup 目录轮换）的骨架 | `reviewUpgradeOverInstalled`（grants diff）、`applyUpdate` / `rollbackUpdate` / `installFromUrlConfirmed` 的 DB 行操作 | 三棵树的目录轮换抽成函数；行操作每个 kind 自己写 |
| `publishJournal.ts` | 354 | 崩溃一致性日志的机制（不存路径、按 id + contentHash 与已提交行对账、启动时恢复） | id schema、路径推导、对账用的表 | 参数化：`{ idSchema, pathsFor(id), committedHashOf(id) }` |
| `publishLock.ts` | 26 | 全部（按 id 的 promise 链） | — | 原样移动 |
| `cleanup.ts` | 20 | 全部（`bestEffortCleanup`） | — | 原样移动 |
| `icon.ts` | 66 | `assertSupportedIconBytes`（magic bytes 白名单） | `applyPackagedIcon` → `setInstalledMiniAppLogo` | 扩展接 provider logo 管线 |
| `builtin.ts` / `orderKey.ts` | 66 | — | 全部 | 不动 |

**共享模块的位置**：`src/main/services/packageInstall/`。理由：账本和锁持有内存状态（不是 `utils`），业务无关但可移除（不是 `core`），按 main-process 架构文档归 `services/`。mini app 与 extension 都从这里导入；`features/miniApp/install/` 只剩 DB 提交、grants、同意卡摘要、builtin。

**共享信封 schema**：`src/shared/types/packageManifest.ts` 抽 `PackageEnvelopeSchema = { id: 反向域名, name: LocalizedName, description: LocalizedDescription, version, icon?: { path, sha256 }, releaseNotes?, update?: { url, urlCn? } }` 和 `withDistribution(schema)`（加 `package` 块）。`MiniAppManifestSchema = 信封 + entry / permissions / optionalPermissions / network`；`ExtensionManifestSchema = 信封 + apiVersion / minAppVersion / main? / network? / contributes`。`resolveLocalizedText` 一并上移。

**extension 侧自己写的部分**（形状照抄 mini app）：

| 步骤 | 复用 | extension 自己的 |
|---|---|---|
| 归档检查 | `packageInstall/archive` + 参数 | `requiredFiles = manifest.main ? [main] : []`；无保留目录 |
| 预览 → 同意卡 → 确认 | 账本 + `assertManifestUnchanged` + hash 重算 | 同意卡摘要：贡献 kind 列表、`network` 主机、**是否含 `main`（"将以应用权限运行"）** |
| 落盘 | staging + 三棵树轮换 | 目标目录 `{userData}/Data/Extensions/<id>@<version>/`（版本目录：ESM `import()` 按 URL 缓存） |
| 记录 | — | 新表 `extension` + `extension_installation`，字段抄 `mini_app_installation`（`manifestJson` / `contentHash` / `source` / `previous*` 回滚）；无 `grant` 表——v1 的权限只是同意卡上的披露，没有运行时门（§5） |
| 崩溃恢复 | journal 机制 + 参数 | `committedHashOf` 查 `extension_installation` |
| 启用 / 禁用 / 卸载 | 状态机形状 | 禁用 = 调用所有 kind 的注销函数；卸载保留业务行（provider 的 key 是用户的），行因 preset 不可解析而在列表里隐藏 |
| 升级 | 更新评审账本 + 三棵树 | 新版本目录 → `import` 新 → 注册新（各 kind）→ **成功后**注销旧 → 删旧目录；任一 kind 注册失败 ⇒ 回滚新注册，旧版本继续运行（opencode v2 的 generation 语义） |

安装只做"解压 + 校验 + 拷贝"，**不执行任何脚本**。

### 3.3 抽取顺序与验证

抽取是 P0 的第一个 PR，且必须是**行为保持**的重构：

```
1. 新建 services/packageInstall/{archive,consentLedger,staging,httpSource,publishJournal,publishLock,cleanup}.ts，
   把上表"通用部分"移过去并参数化；features/miniApp/install/* 改为薄包装调用
   → verify: miniApp/install/__tests__ 的 8 个测试文件一行不改、全部通过；`pnpm lint`
2. 抽 shared/types/packageManifest.ts 的 PackageEnvelopeSchema；MiniAppManifestSchema 改为 extend
   → verify: miniAppManifest 的 schema 测试与 installFlow.test 不改通过；manifest 的 zod 错误信息路径不变
3. 只有 1、2 合入后，extension 的安装流程才开始写；它是这些模块的第二个消费者
   → verify: 一个纯数据扩展 zip 走完 预览 → 同意 → 确认 → 落盘 → 记录 → 卸载
```

不抽的：`publishInstall` / `publishReinstall` / `applyUpdate` / `rollbackUpdate` 的 DB 行操作。两个消费者的表不同、字段语义不同（mini app 有 grants 与 partition），硬抽会得到一个带 12 个回调参数的函数。写两份，形状一致，靠测试对齐。

## 4. 第一个贡献点：`providers`

> 设计原则（回应评审）：① 扩展 API 由 Cherry 拥有，**不暴露 AI SDK 的任何类型**，宿主内部做适配；② 开发者用 SDK 写 TypeScript，manifest 是构建产物；③ 所有 id 由宿主用扩展 id 限定命名空间；④ 模型元数据复用 registry 的完整 schema，不造"最小描述"；⑤ 钩子从整个 provider 群体推导，PR #19882 只是测试用例之一。

### 4.0 从整个 provider 群体推导需求

样本：`config.ts` 的 23 个构建分支、`listModels.ts` 的 15 个 fetcher、`custom/` 的 12 个自定义 provider、`extensions.ts` 的 29 个 `ProviderExtension`、`OAuthRuntimeService` 的 3 个登录 provider + 渲染层 5 个弹窗取 key 的 provider、`providerSpecificSettingsRegistry` 的 12 个专属面板。按"偏离标准协议的方式"归类：

| # | 偏离类型 | 实例 | 出现频率 | 本质 |
|---|---|---|---|---|
| 1 | 鉴权：怎么拿到凭证 | api-key 手填（默认）；浏览器弹窗回传 key（302ai / silicon / aihubmix / ppio / aionly）；PKCE 回环换 key（tokendance）；OAuth 会话含刷新（codex / grok-cli / cherryin）；设备码（copilot）；IAM（bedrock / vertex / azure）；无凭证（ollama / lmstudio / ovms / gpustack）；外部 CLI（claude-code） | 每个 provider 都有一种 | **凭证是结构化对象，不是字符串**；获取方式是一个可选钩子 |
| 2 | URL 构造 | `formatBaseURL` / azure 的 deployment 路径 / newapi 的版本后缀 / ollama host 归一 | 6 | 数据（endpoint 声明）+ 少量宿主规则 |
| 3 | 请求整形 | 固定头（copilot / doubao / radeon `X-Source` / tokendance `X-App-URL`）；body 改写（zhipu / lmstudio `transformRequestBody`）；fetch 包装改 body（ark 去 include / dashscope 加 web_extractor / codex、grok 强制字段）；`stream_options` 方言 | 10 | 头是数据；body 改写是"JSON 进 JSON 出"的纯函数 |
| 4 | 模型发现 | 15 个 fetcher 的差异全在：URL、响应 schema、字段映射（ollama `/api/tags`+`/api/show`、gemini `models/` 前缀、vertex publisher、copilot、ovms、together、newapi、openrouter、ppio、gateway、anthropic、jina、openai、tokendance `supported_protocols`） | 15 | 返回值必须是 registry 的模型 schema，否则每个 fetcher 都在重新发明字段 |
| 5 | 非标准模态传输 | 图像 submit/poll（ppio / dmxapi / tokenhub / modelscope / silicon / minimax / aihubmix / dashscope / gateway，已有 Cherry 自有接口 `ImageGenerationTransport`）；embedding 按模型分族（dmxapi）；rerank 专用 URL（dashscope）；进程内 embedding（localEmbedding） | 12 | 需要"模型实现"级别的接口；图像已有现成的 Cherry 自有接口 |
| 6 | 服务端工具 | `toolFactories`（vertex / vertex-anthropic / bedrock / moonshot）+ zhipu 的 body 标记 | 4 | 函数值，跨进程不可搬；全是一线大厂，无第三方需求 |
| 7 | 网关内按模型路由 | aihubmix / dmxapi 的 `gatewayRouting` + per-model `providerOptions` 命名空间 | 2 | 多数可由 `models[].endpointTypes` 表达 |
| 8 | 专属设置面板 | IAM 表单（bedrock / vertex / azure）、登录面板（copilot / cherryin / codex / grok）、本地服务选项（ovms / gpustack / lmstudio / dmxapi）、营销位（radeon） | 12 | 表单类可声明式描述；登录面板由钩子 1 驱动；营销位不支持 |

推导出的分层（按出现频率排序，越靠前越该零代码）：

| 层 | 内容 | 覆盖偏离 | 形态 |
|---|---|---|---|
| **L0 数据** | 连接（endpoints / baseUrl / adapterFamily / dialect）、身份（name / icon / website 含 credits、activity）、鉴权声明（`authMethods` + `configuration` 字段）、固定头、静态模型清单 | 2、3（头）、8（表单） | manifest，由 SDK 生成 |
| **L1 钩子** | `listModels` / `acquireCredential` / `refreshCredential` / `transformRequest` | 1、3（body）、4 | 纯数据进出的函数，宿主注入能力 |
| **L2 模型实现** | `languageModel` / `embeddingModel` / `imageModel` / `rerankModel` | 5 | Cherry 自有接口，宿主适配到 AI SDK |
| 不做 | 6、7、8（营销位） | — | 出现第三方需求时再议 |

### 4.1 SDK 与开发流程：manifest 是构建产物

开发者只接触 `@cherrystudio/extension-sdk`（TypeScript）。它做三件事：提供 `defineExtension` / `defineProvider` 等类型化的定义函数；把 provider-registry 的 zod 与枚举原样导出（`EndpointType` / `ProviderConfig` / `ProviderModelOverride` / `ModelCapability` / `Modality`），**API 里没有裸 `string`**；提供 `cherry-ext build | dev | pack` 命令。

```ts
// src/index.ts —— 开发者写的全部
import { defineExtension, defineProvider, ENDPOINT_TYPE } from '@cherrystudio/extension-sdk'

export default defineExtension({
  id: 'space.tokendance.cherry',
  name: { en: 'TokenDance', zh: 'TokenDance' },
  version: '1.0.0',
  icon: './icon.png',
  contributes: {
    providers: [
      defineProvider({
        // ↓ 与 packages/provider-registry 的 defineProvider 同一套字段与校验
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: { /* … */ },
        headers: { 'X-App-URL': 'app://cherryai.com.cn' },
        authMethods: ['api-key'],
        metadata: { website: { official: '…', apiKey: '…', credits: '…', activity: '…' } },
        hooks: { listModels, acquireCredential }        // L1，见 §4.4
      })
    ]
  }
})
```

`cherry-ext build`：类型检查 → 用 tsdown 打成单文件 ESM `dist/main.js`（依赖全部内联）→ **静态求值 `defineExtension` 的数据部分抽成 `manifest.json`**（与 `packages/provider-registry/scripts/generate-catalog.ts` 从 `defineProvider` 抽 `providers.json` 是同一个动作）→ 计算 icon sha256 → `pack` 打 zip。`cherry-ext dev` 装进开发实例并 watch（LM Studio `lms dev` 的形态）。

manifest 仍然是**安装时契约**：宿主校验它、同意卡展示它、`extension_installation.manifestJson` 存它。开发者永远不手写它。长期看，`packages/provider-registry/src/providers/*.ts` 里的内置 provider 就是"恰好随 app 打包的扩展"——同一个 `defineProvider`，同一个抽取器。

### 4.2 id 命名空间

- 扩展 id：反向域名（`space.tokendance.cherry`），与 mini app 同一规则；索引/市场保证唯一，本地安装遇同 id 走升级或重装流程。
- **贡献项的 id 是扩展内局部的**，运行时 id 由宿主合成：一个扩展只贡献一个 provider 时 `providerId = 扩展 id`；多个时 `${扩展 id}.${局部 id}`。所有 kind 同规则（VS Code 也是宿主把 `vendor/id` 拼起来）。
- 内置 registry 的 provider id 没有一个含 `.`（已核对 `providers.json`），所以扩展 provider 与内置永不冲突；扩展之间的唯一性由扩展 id 唯一性直接推出。
- 约束：providerId 不能含 `::`（unique model id 分隔符）和 `/`（`/providers/:providerId` 路由无通配）——`.` 两者都安全。

### 4.3 数据（L0）

manifest item = registry `ProviderConfigSchema` + 以下新增字段（都要加进 registry schema，内置 provider 同样受益）：

| 字段 | 作用 | 干掉的硬编码 |
|---|---|---|
| `headers?: Record<string, string>` | 固定请求头，宿主在 `getExtraHeaders` 合并 ⇒ aiSdk / pi / dsh 三条路径全部生效 | `utils/provider.ts` 里 tokendance / radeon-cloud 特判 |
| `metadata.website.credits?` / `.activity?` | 充值、用量页链接 | 渲染层 `oauth.ts` 的 `providerCharge` / `providerBills` id 表 |
| `configuration?: ConfigurationField[]` | 声明式配置字段 `{ key, type: 'string'\|'number'\|'boolean'\|'select'\|'secret', title, description?, required?, default?, options? }`；宿主渲染进 provider 设置页，`secret` 走现有凭证存储，值通过 `ctx.configuration` 给钩子 | bedrock / vertex / azure 的 IAM 表单（region / project / location / apiVersion）；VS Code 2026 年也把 key 存储和配置 UI 从扩展收回宿主（manifest `configuration` + `secret: true`） |
| `models?: ProviderModelOverride[]` | 静态模型清单，语义同 `provider-models.json` | — |

`adapterFamily` 取值 = 内置族名 ∪ `{ 本扩展 providerId }`。填扩展 id ⇒ 该 endpoint 的模型由 L2 实现提供；填内置族名 ⇒ 宿主用内置 AI SDK 适配器直连（TokenDance 全部如此）。

### 4.4 钩子（L1）——Cherry 自有类型，纯数据进出

```ts
// @cherrystudio/extension-sdk —— provider 钩子的全部公开面
import type { EndpointType, ProviderModelOverride } from './registry'   // 与 provider-registry 同源

export type Credential =
  | { type: 'api-key'; key: string; label?: string }
  | { type: 'oauth'; accessToken: string; refreshToken?: string; expiresAt?: number; accountId?: string }
//  ↑ 与 shared/data/types/provider.ts 的 ApiKeyEntry / AuthConfig(oauth) 一一对应，宿主直接落库

export interface ProviderContext {
  providerId: string
  endpointType: EndpointType
  baseUrl: string
  endpointBaseUrls: Partial<Record<EndpointType, string>>
  credential?: Credential                       // 轮转后的当前凭证；authOptional 时缺省
  configuration: Record<string, unknown>        // manifest configuration 字段的当前值
  fetch: typeof globalThis.fetch                // 宿主 fetch：代理 / UA / 重定向 / trace
  signal?: AbortSignal
  /** 宿主在刷新列表、模型选择器等场景以 silent=true 调用；只有用户显式"同步模型"才是 false。
   *  silent 时不得触发任何交互（不弹窗、不起回环服务器）。VS Code 的 PrepareLanguageModelChatModelOptions.silent。 */
  silent: boolean
}

export interface AuthContext extends ProviderContext {
  openExternal(url: string): Promise<void>
  /** 宿主起 127.0.0.1 临时端口监听一次回调（复用 OAuth runtime 的 LoopbackCallbackTransport） */
  awaitLoopbackCallback(path: string, timeoutMs?: number): Promise<{ url: URL; respond(html: string): void }>
  /** 宿主开一个授权窗口，把页面 postMessage 与导航 URL 流给扩展判定（silicon / 302ai / aihubmix / ppio / aionly 的形态） */
  openAuthWindow(url: string): AsyncIterable<{ kind: 'message'; data: unknown } | { kind: 'navigate'; url: URL }> & { close(): void }
}

/** 出站请求的可改写视图；只覆盖 AI SDK 路径（pi / dsh 有自己的传输，它们只吃 manifest 数据） */
export interface OutgoingRequest {
  url: string
  headers: Record<string, string>
  body?: unknown                                // 已解析的 JSON；改完宿主重新序列化
}

export interface ProviderHooks {
  /** 模型发现。返回 registry 的完整模型 schema，宿主用现有 toModel() 归一并做 endpoint 推导 */
  listModels?(ctx: ProviderContext): Promise<ProviderModelOverride[]>
  /** 交互式获取凭证：弹窗回传 key、PKCE 回环、OAuth 授权码 */
  acquireCredential?(ctx: AuthContext): Promise<Credential>
  /** 有 refreshToken 的凭证过期时由宿主调用；缺省 ⇒ 过期即失效 */
  refreshCredential?(ctx: ProviderContext, current: Credential): Promise<Credential>
  /** 每次请求前改写 URL / 头 / body（zhipu、lmstudio、ark、dashscope、codex、grok 这一类） */
  transformRequest?(request: OutgoingRequest, ctx: ProviderContext): OutgoingRequest | Promise<OutgoingRequest>
}
```

三条规则：

- 入参只有纯数据和四个宿主能力函数（`fetch` / `openExternal` / `awaitLoopbackCallback` / `openAuthWindow`）。这四个都是"宿主做事、扩展等结果"的形状，可以在 §5 方案 C 里桥接。
- `listModels` 是三级递进的最后一级：`models[]` 静态清单 → `modelsApiUrls` 走宿主默认 fetcher → `listModels` 钩子。今天 15 个 fetcher 里 14 个的差异都能在钩子里 20 行内表达，因为返回类型是 registry schema 而不是各自的 `Partial<Model>`。
- `acquireCredential` 返回结构化 `Credential`，宿主按 `type` 落到 `apiKeys[]` 或 `authConfig`，并统一处理 `isEnabled` 翻转与 OAuth runtime 的 token store——PR #19882 的 IpcApi 路由和渲染层 launcher 表退化为一条通用的 `provider.acquire_credential { providerId }`。
- 与 opencode v2 的 integration 域（§7.2）同构但更收口：他们的 `authorize()` 返回 `{ url, callback }` 让插件自己收回调；我们把回环服务器和授权窗口做成宿主能力，扩展只描述流程。授权前需要用户输入的东西（region / resourceName 之类）走 §4.3 的 `configuration` 声明字段，不另设 `prompts`。

### 4.5 模型实现（L2）——Cherry 自有接口，宿主适配到 AI SDK

设计依据是 VS Code 定稿的 `LanguageModelChatProvider`（§7）：provider 侧类型与消费侧类型分开、模型对象原样传回、封闭的小 part 联合 + 一个 data 逃生口、宿主填默认值。VS Code 刻意不放进接口的三样——reasoning、per-response usage、system 角色——Cherry 的 UI 都要，所以我们必须有。part 词汇按 AI SDK v3 的语义命名，让内部 adapter 保持 1:1；但**类型由 SDK 拥有、单独版本化**，AI SDK 从 v3 升 v4 时只改 adapter。

```ts
// 模型层公开面（节选；完整 d.ts 随 SDK 发布）
export interface ProviderModels {
  languageModel?(modelId: string, ctx: ProviderContext): LanguageModel
  embeddingModel?(modelId: string, ctx: ProviderContext): EmbeddingModel
  imageModel?(modelId: string, ctx: ProviderContext): ImageModel
  rerankModel?(modelId: string, ctx: ProviderContext): RerankModel
}

export interface LanguageModel {
  stream(request: ChatRequest, ctx: ProviderContext): AsyncIterable<ChatStreamPart>
  countTokens?(input: string | ChatMessage[]): Promise<number>          // 缺省 ⇒ 宿主估算
}
export interface ChatRequest {
  system?: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]                                              // { name, description, inputSchema: JSONSchema }
  toolChoice?: 'auto' | 'required' | 'none' | { name: string }
  maxOutputTokens?: number; temperature?: number; topP?: number; stopSequences?: string[]; seed?: number
  responseFormat?: { type: 'text' } | { type: 'json'; schema?: JSONSchema }
  options?: Record<string, unknown>                                     // 透传的 provider 特有选项
}
export type ChatMessage =
  | { role: 'user'; content: Array<TextPart | FilePart> }
  | { role: 'assistant'; content: Array<TextPart | FilePart | ReasoningPart | ToolCallPart> }
  | { role: 'tool'; content: ToolResultPart[] }
export type ChatStreamPart =
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'reasoning-delta'; id: string; delta: string; signature?: string }   // VS Code 没有，我们要渲染思考
  | { type: 'tool-call'; callId: string; name: string; input: unknown }
  | { type: 'file'; mediaType: string; data: Uint8Array | string }
  | { type: 'source'; url: string; title?: string }
  | { type: 'data'; mimeType: string; data: Uint8Array }                         // 逃生口，同 VS Code DataPart
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'other';
      usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }; cost?: number }
  | { type: 'error'; error: unknown }

export interface EmbeddingModel { embed(values: string[], ctx: ProviderContext): Promise<{ embeddings: number[][]; usage?: { tokens: number } }> }
export type ImageModel = ImageGenerationTransport      // 已存在的 Cherry 自有接口：submit / poll / cancel，原样复用
export interface RerankModel { rerank(query: string, documents: string[], ctx: ProviderContext): Promise<{ results: Array<{ index: number; score: number }> }> }
```

宿主侧 `src/main/ai/provider/extensionAdapter.ts`：`LanguageModel` → `LanguageModelV3`（`doStream` 逐 part 映射，`doGenerate` 由 `stream` 收集）、`EmbeddingModel` → `EmbeddingModelV3`、`ImageModel` → 现有 `createImageGenerationModel(transport)`、`RerankModel` → `RerankingModelV3`；再拼成一个 `ProviderV3` 注册进 `extensionRegistry`。这与今天 `localEmbeddingProvider.ts`（手写 `EmbeddingModelV3`）和 `imageGenerationModel.ts`（`ImageGenerationTransport` → `ImageModelV3`）做的是同一件事，只是换成对扩展开放的稳定接口。

分阶段：`imageModel` 随 P1 落地（PPIO 需要，接口已存在）；`languageModel` / `embeddingModel` / `rerankModel` 的接口随 SDK 一起发布并冻结，adapter 在第一个非 OpenAI 兼容的第三方聊天协议出现时实现（今天 `custom/` 里所有聊天路径都是 OpenAI 兼容 + 整形，L1 已覆盖）。

### 4.6 版本与兼容

| 维度 | 机制 |
|---|---|
| 扩展 API | manifest `apiVersion` 整数；宿主 `SUPPORTED_API_VERSIONS`。SDK 类型只增不改；破坏性变更走 `XxxV2` 并存一段时间后改回原名（VS Code 的 `…2` 纪律） |
| AI SDK | 扩展看不见。AI SDK v3 → v4 只改 `extensionAdapter.ts` |
| registry schema | 扩展与内置共用；registry 已有 `REGISTRY_SCHEMA_VERSION` + 兼容基线机制 |
| App | manifest `minAppVersion` |

### 4.7 宿主一次性接缝

```
1. ProviderRegistryService：contribution 层（bundled → 扩展贡献），isRegistryProvider 对扩展 provider 为 true
   → verify: GET /providers/space.tokendance.cherry/preset 返回 manifest 的 endpointConfigs

2. registry schema：加 headers / website.credits / website.activity / configuration；getExtraHeaders 合并 provider.headers（删两处特判）
   → verify: aiSdk / pi / dsh 三条路径的 header 测试改成读 provider.headers

3. endpoint.ts：`adapterFamily in appProviderIds || extensionRegistry.has(adapterFamily)`
   config.ts：generic 之前一条 `match: (_, id) => extensionHost.ownsProviderFamily(id)`；transformRequest 挂在 customFetch 包装上
   → verify: endpoint.test / config.test 各加一例

4. listModels.ts：fetchers[] 首位加 extensionFetcher（扩展有 listModels ⇒ 调用；结果是 ProviderModelOverride[]，经现有 resolve 逻辑）
   → verify: 扩展 fetcher 优先；返回值走 registry schema 校验

5. 凭证：IpcApi `provider.acquire_credential { providerId } → Credential`；宿主实现 AuthContext（loopback 复用 OAuth runtime 的 LoopbackCallbackTransport；authWindow 用 BrowserWindow + preload 转发 postMessage）
   渲染层 OauthButton：`isProviderSupportAuth` 改为读 provider 行的 `supportsAcquireCredential`；launcher 表退化为一条通用调用
   → verify: 现有 5 个弹窗 provider 不回归（先保留各自 launcher，迁移是后续 PR）

6. extensionAdapter.ts：Cherry 模型接口 → AI SDK V3；P1 只接 imageModel
   → verify: PPIO 扩展的图像生成走 submit/poll 通过

7. user_provider delta 行：安装时同 presetProviderSeeder.toDbRow；卸载保留
8. 图标 / 显示名：按 mini app applyPackagedIcon 同款进 provider_logo_file_ref；name 取 manifest
```

不改的东西：`Provider` / `Model` 共享类型（只加可选字段）、`ProviderExtension` 类、AI SDK 版本、icon catalog 生成器。

### 4.8 试金石

| 扩展 | 覆盖 | 通过标准 |
|---|---|---|
| **TokenDance**（PR #19882） | L0 全部 + L1 `listModels` + `acquireCredential`（PKCE 回环） | manifest 由 SDK 生成；`main.ts` 只有两个钩子；主仓库除 §4.7 一次性接缝外零文件 |
| **PPIO**（`custom/ppio/`） | L2 `imageModel` | 删掉 `custom/ppio/` 与 config.ts 分支、`imageTransportRegistry` 的 ppio 项 |
| **Bedrock**（P2） | L0 `configuration`（region / accessKeyId(secret) / secretAccessKey(secret)） | `AwsBedrockSettings.tsx` 可删；IAM 字段由声明式表单渲染 |

## 5. Runtime

评估维度：`fetch` 接缝（代理 / UA / 重定向 / trace）、流搬运成本、崩溃隔离、信任边界、实现量。

| 方案 | fetch 接缝 | 流搬运 | 隔离 | 实现量 | 备注 |
|---|---|---|---|---|---|
| **A. 主进程内 `import()`** | 直接注入 | 无 | 无 | ~300 行 | Obsidian / opencode / n8n 的模型 |
| B. `worker_threads` | 要桥；worker 里没有 Electron `net` | 要 | 弱 | ~800 行 | localModel worker 是"拿代理快照自建 dispatcher"，对 provider 不可接受（丢 UA / trace） |
| **C. `utilityProcess`** | 反向 RPC：扩展 `fetch` 等四个宿主能力 → MessagePort → 宿主执行 | §4.5 的 `ChatStreamPart` 全是纯对象，可搬（`signal` 换 id、`Uint8Array` 走 transfer） | 强 | ~1200 行 | `workerProxy.ts` 注释已预留入口 |
| D. 子进程 + JSON-RPC（MCP 式） | 同 C | 同 C，自定义协议 | 强 | ~1500 行 | 唯一优势是非 JS 扩展；本体系不需要 |
| E. WASM | 宿主提供 | 要 | 最强 | 大 | AI SDK 包编译不进 WASM；Zed 走这条是因为扩展面窄且是 Rust |

**决定：v1 用 A，API 按 C 设计；C 是分发索引的前置条件。**

- 选 A：目标是最简实现；provider 的工作就是发 HTTP，宿主网络策略全收敛在 `customFetch`，进程内注入零成本。
- 按 C 设计：§4.4 / §4.5 的入参除四个宿主能力函数（`fetch` / `openExternal` / `awaitLoopbackCallback` / `openAuthWindow`）外全是纯数据，出参（`Credential` / `ProviderModelOverride[]` / `ChatStreamPart` 流）全是纯对象。换 C 时扩展代码零改动，宿主把 `extensionAdapter.ts` 的输入端从"进程内对象"换成"MessagePort 代理"。§4.0 排除服务端工具正是为了不在 API 里放函数值。
- A 的边界：VS Code 和 LM Studio 这两个让插件当 provider **且有市场**的 GUI 应用都隔离了插件进程；不隔离的（opencode / n8n / Obsidian）都是"用户亲手装"的场景。所以 A 只覆盖用户自选文件 / URL 安装；我们自己分发索引之前，C 必须先落地。
- A 的纪律：只加载 `feature.extensions` 下用户显式安装的目录；同意卡写明"含代码，以应用权限运行"；manifest zod 严格模式；id 冲突拒绝；扩展抛错 ⇒ `ProviderCreationError`，只标记该 provider 不可用；不自动更新。
- 加载：`import(pathToFileURL(main).href)`；`main.js` 单文件 ESM，`cherry-ext build` 把依赖全部内联，宿主**不**给扩展解析自己的 `node_modules`——版本由宿主决定的依赖就是隐式 API。扩展对宿主的唯一编译期依赖是 `@cherrystudio/extension-sdk` 的类型。

宿主服务：`ExtensionHostService`（`BaseService`，WhenReady，放 `src/main/services/extension/`——业务无关但可移除，按 main-process 架构文档的规则归 `services/` 而不是 `core/`；贡献点实现各自留在子系统目录）。职责：扫目录 → 校验信封 → `import(main)` → 按 kind 分发给 `ContributionPoint.register` → 持有注销函数。IpcApi：`extension.list` / `extension.preview` / `extension.confirm` / `extension.set_enabled` / `extension.remove`（与 mini app 的路由形状一致）。

## 6. 分发

| 阶段 | 来源 | 机制 |
|---|---|---|
| v1 | 本地 zip / 目录 | mini app 的文件安装流程 |
| v1 | URL | mini app 的 web 安装流程（分发 manifest + `package.url` + sha256） |
| 之后 | 索引 | `x-files/extensions/v1/index.json`，条目 `{ id, name, version, url, sha256 }`，与 provider-registry 远程分支同款；**需要 §5 方案 C 先落地** |
| 之后 | npm 包名 | binary-manager 的 `bun` 装到 `Extensions/_npm/`，自动生成 manifest 包一层。AI SDK 社区 provider 就是现成生态（opencode 路线） |

## 7. 开源实现对照

| 项目 | 扩展单元 | 安装来源 | 运行隔离 | host↔扩展协议 | 版本检查 | 扩展能当 provider？ |
|---|---|---|---|---|---|---|
| opencode（v1 → v2，§7.2） | npm 包 / 本地 TS；v2 `define({ id, setup(ctx) })` | Arborist 装 npm（`ignoreScripts`），本地，`file://`；v2 加 `plugin add/update` + Git | 进程内（两代都是） | v1 返回 hook 对象；v2 `ctx.<domain>.transform/hook` + `dispose` | `engines.opencode` | **是**：v1 `auth.loader` + `provider.models`；v2 `integration` 域 + `catalog.transform`，AI SDK 只剩 `aisdk.hook` 一对口 |
| VS Code LM API | VSIX + `package.json` contributions | Marketplace / VSIX | **独立 extension host 进程** | JSON-RPC；`Progress<Part>` | `engines.vscode` | **是**：`registerLanguageModelChatProvider`（3 个方法） |
| LM Studio | 目录 + `manifest.json` | Hub / `lms dev --install` | **独立 Node 进程** | 插件反向拨号 WebSocket | 无 | **是**：`generator` |
| Dify | `.difypkg` | Marketplace / GitHub / 本地（签名） | Go daemon 子进程 | STDIN/STDOUT | `minimum_dify_version` + 签名 | 是 |
| Jan | npm workspace → 编译进 app | 只有内置 | 进程内 | 直接调用 | 有钩子无执行 | 曾经是；**已退回**内置 |
| Zed | `extension.wasm` | zed.dev 索引 | Wasmtime | WIT | `wasm_api_version` | **否**（manifest 有桩，WIT 没导出） |
| Obsidian | `main.js` + `manifest.json` | GitHub release 列表；BRAT | 进程内 | 直接调用 | `minAppVersion` | n/a |
| n8n | npm 包 + `n8n` 字段 | `npm install` + 校验和名单 | 进程内 | 直接调用 | `n8nNodesApiVersion` | 是 |
| MCPB | zip + `manifest.json` | 双击 | 子进程 | MCP stdio | `compatibility` | n/a |

直接决定本设计的几点：

1. **成功案例的 API 面都极小**（VS Code 三个方法、LM Studio 一个函数、opencode 零方法）；做大了的（Jan 11 种扩展类型、Zed 全套 WIT）要么退回内置，要么至今没开 provider 口。→ 每个 kind 的代码接口按"该子系统今天的最小接口"定，不为想象中的需求加。
2. **VS Code 的 contribution point 模型**：宿主只认 `contributes` 的 key，每个 key 的 schema 与消费者由对应子系统拥有。→ §3.1。
3. **三件事拆开：SDK 实现 / 声明式元数据 / 凭证**（opencode、VS Code、Dify 都收敛于此）。→ §4.3 数据、§4.4 钩子 / §4.5 模型实现、`authMethods` + `configuration` + `acquireCredential` 各归各。
4. **让 provider 代码当扩展且有市场的 GUI 应用都隔离进程**。→ §5 的 C-before-index 约束。
5. **安装即拷贝、不跑脚本；升级换目录、不做模块缓存失效；装的东西要校验**。→ §3.2、§6。
6. **模型列表是数据不是代码**（opencode 拉 models.dev，Jan 拉远程目录）。→ 新模型 id 不该要求扩展发版；`modelsApiUrls` / `models[]` / `listModels()` 三级递进。

### 7.1 VS Code Language Model Provider API：v1 → v2 → 定稿（1.104，2025-09）

来源：`vscode.proposed.chatProvider.d.ts` 历史、跟踪 issue #250007、定稿 PR #263415 / #265213、`vscode-copilot-chat/src/extension/byok`。

| 维度 | v1（2024） | v2 → 定稿 | 动机（原话/出处） |
|---|---|---|---|
| 注册粒度 | `registerChatModelProvider(id, provider, metadata)`，**每个模型**一次 | `registerLanguageModelChatProvider(vendor, provider)`，**每个厂商**一次 | #250007："we need a way to have a sort of provider provider for the language model lists" |
| 模型元数据 | 注册时的静态对象 | 运行时 `provideLanguageModelChatInformation({ silent }, token)` + `onDidChange…` 事件 | 模型列表取决于 key / endpoint，"NOT cacheable (between reloads)"；`silent` 让发现过程永不主动要 key |
| 请求方法 | `provideLanguageModelResponse(messages, options, extensionId, progress<Fragment>, token)` | `provideLanguageModelChatResponse(model: T, messages, options, progress<Part>, token)` | 模型对象原样传回（泛型 `T` 让扩展把 key / URL 挂在模型上）；jrieken："don't reuse the LanguageModelChatRequestOptions so that consumer and provider part of the API can develop independently" |
| 流元素 | `ChatResponseFragment2 { index; part }` | 直接 `LanguageModelTextPart \| ToolCallPart \| ToolResultPart \| DataPart` | PR #261645 简化 |
| 用量统计 | `onDidReceiveLanguageModelResponse2` 事件 | **删除**，无替代 | PR #255892；用量留在扩展自己的 telemetry 里 |
| 能力 | `vision / toolCalling / agentMode` | `capabilities: { imageInput?, toolCalling?: boolean \| number }`，**必填** | "make non optional so providers don't miss setting it" |
| 选择器策略 | `isDefault / isUserSelectable / category` | 明确"NOT BEING FINALIZED" | 宿主拥有 UI 策略 |
| 凭证 | 扩展自管 `SecretStorage` + `managementCommand` | 2026：`managementCommand` 废弃，manifest `configuration` schema（`secret: true`）+ `PrepareLanguageModelChatModelOptions.configuration`，宿主拥有存储与 UI | BYOK 迁移（`lm.migrateLanguageModelsProviderGroup`） |
| 仍在提案 | — | `LanguageModelThinkingPart`、`System` 角色、`languageModelPricing`（静态、只展示）、`requestInitiator`、`requiresAuthorization`、`editTools` 能力 | Copilot 用 `DataPart` 私有 mime（`cache_control` / `stateful_marker` / `thinking`）绕过 |
| 版本纪律 | 提案整数版本 `chatProvider@4` | 定稿后只增不改；破坏性变更走 `…2` 类型再改回；整数提案版本机制 2026-06 删除（#321391） | — |

对本设计的直接影响：

- §4.4 的 `silent`、§4.5 的"模型对象传回 + 小联合 + data 逃生口"、§4.6 的 `…V2` 纪律、§4.3 的 `configuration`（`secret`）——都直接来自这里。
- VS Code 刻意不放进接口的 reasoning / per-response usage / system 角色，Cherry 的 UI 都要展示，所以 §4.5 必须有 `reasoning-delta` 和 `finish.usage`。**不要照抄它的省略。**
- BYOK 的实现形态（`AbstractLanguageModelChatProvider<T>`：`silent && !apiKey ⇒ []`；`GET /models` 发现 + 静态能力表兜底；`instanceof` 分派把 part 转成厂商 wire 格式）就是 §4.5 adapter 的镜像——只是方向相反：他们在扩展里转成厂商格式，我们在宿主里转成 AI SDK。

### 7.2 opencode plugin API：v1 → v2（2026-06，`@opencode-ai/plugin@beta`）

来源：`anomalyco/opencode`（原 `sst/opencode`）`dev` 与 `v2` 分支、PR #33111 / #33416、`packages/plugin/src/v2/effect/PLAN.md`、issue #36189。npm 上没有 2.x 大版本：v2 先以 `/v2/promise` 子路径出现在 `latest`，`v2` 分支上成为 `.` 入口（`beta` tag）。

| 维度 | v1 | v2 | 动机（原话/出处） |
|---|---|---|---|
| 模块形状 | `export const X: Plugin = async (input) => Hooks`，返回一个 `"dotted.name"(input, output)` 的钩子对象 | `export default define({ id, setup(ctx) })`；`setup` 可返回清理函数 | PLAN.md step 7 "Remove Returned Hooks" |
| 扩展看到什么 | `PluginInput { client, project, directory, worktree, $ }` | `PluginContext { agent, aisdk, catalog, command, integration, mcp, permission, session, tool, … }`——"essentially an OpenCode server client … adds plugin-only methods for transforms, runtime hooks, reloads, registrations" | "Internal and external plugins use the same public plugin API" |
| 注册方式 | 返回对象 | `ctx.<domain>.transform(editor)`（可重放的草稿编辑）+ `ctx.<domain>.hook(name, cb)`（运行时），都返回 `Registration { dispose }` | "Registrations are scoped, independently disposable, ordered, and removable" |
| provider / model 契约 | `Provider`/`Model` 内部类型 | `Provider.Info` / `Model.Info` 是**生成的 schema JSON**：`api: { package: 'aisdk:@ai-sdk/openai' \| '@opencode-ai/ai/providers/…', settings }` + `headers/body` 覆盖 + `capabilities/limit/cost/variants` + `compatibility: { reasoningField, requireReasoning, maxTokensField, … }` | "Public domain values use generated `@opencode-ai/sdk` types" |
| AI SDK 暴露 | `auth.loader` 返回 `{ apiKey, fetch, headers }` 直接进 `create*(options)`；插件包硬依赖 `@ai-sdk/provider` | 只剩 `aisdk.hook('sdk')`（包名 → 实例）和 `aisdk.hook('language')`（实例 → 模型）两个口；`v2` 分支再把 `LanguageModelV3` 包成中立的 `@opencode-ai/ai` `LanguageModel` | **issue #36189**："`@opencode/plugin` should not depend on or expose `@opencode/lm` internals … expose session-shaped messages rather than LM provider-shaped messages" |
| 凭证 | `auth: { provider, loader(getAuth, provider) → options, methods: [oauth \| api] }`——插件自己拿 key、自己刷新、自己塞 `fetch` | 独立的 **integration** 域：方法是纯数据 `{ type: 'oauth' \| 'key' \| 'env' \| 'command', label, prompts? }` + `authorize(inputs) → { mode: 'auto' \| 'code', url, instructions, callback → Credential }` + `refresh?(cred)`；宿主解析连接、过期前 5 分钟刷新、runner 注入——**provider 插件不再接触 key** | v1 每个插件都在重写刷新逻辑 |
| 请求整形 | `chat.headers` / `chat.params`（可变 JSON 输出） | `session.hook('model.request' \| 'context' \| 'http.request' \| 'http.response' \| 'retry', cb, { providerID })`——可变 JSON + provider 限定；自定义 `fetch` 仍是 `options` 里的逃生口 | — |
| 加载 / 隔离 | 进程内 `import`，无沙箱；`engines.opencode` semver | 同；`v2` 加 `PluginSupervisor`：监视源、按 generation 重载，"The new revision never became a generation, so the one already running keeps its place" | 失败的 reload 不影响运行中的一代 |
| 分发 | npm（Arborist `ignoreScripts`）/ 本地文件 / `file://` | 同 + `opencode2 plugin add\|list\|check\|update\|remove`、Git spec、宿主按自身版本自动安装 `@opencode-ai/plugin` | — |

对本设计的直接影响：

- **#36189 是"不暴露 AI SDK"的反面教材**：opencode v1 把 `LanguageModelV3` 和 `create*(options)` 交给插件，两年后自己开 issue 要收回。§4.5 的 Cherry 自有类型 + §4.6 "AI SDK 对扩展不可见"就是避开这一步。
- **凭证与 provider 分离**（v2 integration 域）与 §4.3 `configuration` + §4.4 `acquireCredential` / `refreshCredential` 同构：方法声明是数据，交互由钩子描述，存储、刷新、注入归宿主。差异：opencode 的 `authorize` 返回 `{ url, callback }` 让插件自己收回调（codex 插件自起回环服务器）；我们把回环 / 授权窗口做成宿主能力（`AuthContext`），是为 §5 方案 C 留的口。
- **`Model.Info.compatibility` 与 Cherry 的 `EndpointDialect` 是同一个东西**（`streamOptions` / `developerRole` / `reasoningSummary`）：方言是数据，已在 registry schema 里，L0 直接覆盖。
- **`http.response` 钩子**：仓库里只有 ark 一处响应归一化（`normalizeArkResponsesResponse`）；§4.4 先不放 `transformResponse`，第二个实例出现时按同样形状加。
- **generation 语义**：§3.2 的升级流程改为"新版本注册成功后才注销旧版本；失败则旧版本继续运行"。
- 与 VS Code 的交叉印证：两家都在 2026 年把凭证存储从扩展收回宿主、都把模型元数据做成运行时数据、都保留一个 JSON 逃生口（VS Code `DataPart` mime / opencode `headers/body` overlay）。三家里唯一做进程隔离的是 VS Code；opencode 两代都进程内。

### 7.3 pi / dsh / openclaw：三个"第一方全是插件"的系统为什么复杂

三个仓库都在 2026-09-03 更新到最新 main/master 后逐文件统计（pi-mono `e44d75c20`、deepseek-harness `76fda72979`、openclaw `b5f9636c016`）。

| | pi（pi-mono） | dsh（deepseek-harness） | openclaw |
|---|---|---|---|
| 插件运行时规模 | 契约 + 分发 4,125 行；含包管理 / 资源发现 ~10k | Cordis 内核 2,693 行（vendored）；周边 boot / loader / 门禁 / 生成器 ~40k | `src/plugins` 非测试 119k 行；SDK 54k 行、**324 个 subpath 导出** |
| 第一方插件 | 78 个示例 + 内置 llama（14.5k 行） | **250 个包**全是插件，含 agent loop、tools、session | **151 个内置扩展**，103 万行（57 个 provider、27 个 channel） |
| API 面 | 25 方法 + `ctx.ui` 28 方法 + **36 事件（15 个可改写/阻断）** | 16 个 Context 方法 + **97 个 typed service** + 69 事件（14 waterfall）+ 112 个 config schema | **82 成员（56 个 `register*`）+ 42 hook**；manifest 49 个顶层字段 |
| provider 契约 | `registerProvider(name, { baseUrl, apiKey, models[], streamSimple, oauth })`，`streamSimple` 直接暴露内部 `Model / Context / AssistantMessageEventStream` | `LlmAdapter { listModels, resolveModel, prepareCall, stream → StreamChunk(7 变体) }`，**自有类型，无 AI SDK** | `ProviderPlugin` **64 个字段（3 必填）**，吸收 auth / OAuth / 目录 / wire / replay / failover / thinking / usage；小 provider 靠 `defineSingleProviderPluginEntry` 才能 38 行 |
| 内部类型泄漏 | 是：`VIRTUAL_MODULES` 把 pi-ai / pi-tui / agent-core 直接给扩展 | 否（LLM 层）；但每个包 peerDep `@deepseek-ai/cordis` | 是：`StreamFn` / `AgentMessage` / `OpenClawConfig`；`sdk-alias.ts` 1,617 行只是给内部起稳定别名 |
| 运行 / 隔离 | 进程内 jiti，无沙箱；folder trust 是唯一门 | 进程内单 Context，fiber 六态；无沙箱 | 进程内 jiti；安全靠 allowlist、安装扫描（1,286 行）、`contracts` 门控、16 个 policy 文件 |
| 组合 / 配置 | `package.json#pi` + settings 数组 | bundles → profile → home → `--patch` 四层 YAML patch；564 行校验器；事务化 include | 必填 `configSchema` + `uiHints` + `setup` 向导 + `doctorContract`；44 个 manifest 归一化文件 |
| 热重载 | `/reload` 全量重建 + 失效 token | fiber / HMR 存在但 base profile **关着**；19 个 vendor patch 里 5 个是生命周期修复 | `registerReload({ restart/hot/noop prefixes })` |
| 已付出的代价 | 191 次提交、10 个编号回归测试；正在建第二套多进程 facet 架构（chord + experimental ~15k 行），因为进程内对象跨不了 server / TUI / worker | 2 次 postmortem 都是插件机制的坑（default export 吞 `inject`、`!!js`）；1,720 条 agent notes 里 815 条提到 cordis/plugin | 两天 6 个 perf 提交（扫 151 个 manifest 的启动成本）；`update.test.ts` 一个文件 6,235 行 |

复杂度的来源，三家各不相同，但根因一致：

1. **复杂度与"第一方有多少东西是插件"成正比，与第三方 API 大小无关。** pi 78 例、dsh 250 包、openclaw 151 扩展——大部分机器是为了让这些第一方代码围绕内核保持一致（dsh 的 5,400 行门禁/生成器、openclaw 的 `contracts` 层 18.8k 行都只服务内置代码）。本设计里内置 provider **不迁移成扩展**，只是"恰好随 app 打包"，这笔账不用付。
2. **宿主越多，runtime API 越大。** pi 要给 TUI / RPC / json 三种模式各实现一份 `ctx.ui`；openclaw 有 gateway / CLI / paired nodes / macOS app，`api.runtime` 长到 18 个命名空间 68 个成员。本设计只有主进程一个宿主，渲染层 v1 零贡献点。
3. **热重载 / fiber / DI 是为"运行时替换核心"服务的。** dsh 能换 agent loop，所以要 fiber 六态和服务可用性驱动的激活；但它自己的 base profile 把 HMR 关了。本设计不替换核心，§3.1 的 `register → dispose` 就够。
4. **三家都进程内、无隔离，越大的系统越靠策略层补。** openclaw 走到了 allowlist + 安装扫描 + contracts 门控。§5 把 `utilityProcess` 设为索引前置，就是不走这条路。
5. **内部类型当 SDK 的维护成本是显性的。** pi 的回归测试和第二套架构、openclaw 的 1,617 行别名文件；dsh 的 LLM 层是唯一自有类型的例子，也是 §4.5 的同构物。
6. **provider 契约会吸收所有厂商差异。** openclaw 64 个字段是终态；防线只有"数据优先 + 家族 helper"（`build*FamilyHooks`）。§4.0 的 L0 / L1 / L2 分层就是把这条防线放在第一天。
7. **Cherry 自己的 dsh bridge 插件（473 行）证明了最小面**：注入 7 个 service、挂 4 个事件、调 2 个注册——贡献点加一个 waterfall 门，不碰 fiber / isolate / HMR / Config。

## 8. 分阶段

| 阶段 | 交付 | 验证 |
|---|---|---|
| P0-a | **行为保持的抽取 PR**：`services/packageInstall/` + `shared/types/packageManifest.ts`，mini app 改为薄包装（§3.3 第 1、2 步） | mini app 的 8 个安装测试文件一行不改全绿 |
| P0-b | SDK 包（类型 + `defineExtension` + `cherry-ext build`）+ `ExtensionManifestSchema` + `ExtensionHostService` + extension 安装流程（§3.3 第 3 步）+ `providers` L0（§4.7 第 1、2、7、8 项） | 一个纯数据扩展装上后，设置页出现该 provider，聊天与 pi/dsh 都带上 manifest headers |
| P1 | L1 钩子 `listModels` / `acquireCredential` + L2 `imageModel` adapter（§4.7 第 3–6 项） | **TokenDance 作为扩展包通过**；PPIO 搬出主仓库 |
| P2 | `configuration` 声明式表单 + `refreshCredential` / `transformRequest`；第二个 kind（建议 `webSearchProviders`），此时抽出 `ContributionPoint` 接口 | Bedrock 的 IAM 表单由声明式字段渲染；两个 kind 共用一套安装/启停/卸载 |
| P3 | `utilityProcess` runtime（§5 方案 C），provider kind 的远程 shim | 同一个 TokenDance / PPIO 包在 A/C 下都通过，扩展代码零改动 |
| P4 | 索引 + sha256 + 一键安装 | 索引安装的扩展只在 C 下运行 |
| 之后 | `channels`（已是自注册工厂表，最顺手）→ `fileProcessors` → `agentRuntimes`（描述符 + driver 两半都要贡献，最重） | 各自子系统的合同测试 |

P3 排在 P4 前是硬约束，不是偏好。P2 之前不抽 `ContributionPoint` 接口是纪律，不是遗漏。

## 9. 决策记录

| 日期 | 决定 | 理由 | 状态 |
|---|---|---|---|
| 2026-09-03 | 不做"provider 扩展"，做"通用宿主 + 贡献点"，provider 是第一个贡献点 | PR #19882：一个协议标准的 provider 进主仓库改 49 个文件，其中是五个贡献 + 三处硬编码；未来的 kind 还有很多（§1.2） | 已定 |
| 2026-09-03 | 扩展 API 全部 Cherry 自有类型，不暴露 AI SDK | 评审意见；opencode v1 暴露 `LanguageModelV3` 后自己开 issue #36189 要收回（§7.2）；AI SDK v3→v4 时只改 `extensionAdapter.ts` | 已定 |
| 2026-09-03 | 开发者用 `@cherrystudio/extension-sdk` 写 TypeScript，manifest 是 `cherry-ext build` 的产物 | 评审意见；与 provider-registry 的 `defineProvider` → `providers.json` 是同一个抽取动作（§4.1） | 已定 |
| 2026-09-03 | 贡献项 id 局部，运行时 id 由宿主合成 `扩展id[.局部id]` | 评审意见（跨 kind 撞 id）；内置 provider id 无 `.`，永不冲突（§4.2） | 已定 |
| 2026-09-03 | `listModels` 返回 registry 的 `ProviderModelOverride`，SDK 无裸 `string` | 评审意见（"最小描述多半会出问题"、"为什么是 string"）（§4.4） | 已定 |
| 2026-09-03 | 凭证是结构化 `Credential`，获取/刷新是钩子，存储/注入归宿主 | 评审意见；VS Code 与 opencode v2 都在 2026 年把凭证收回宿主（§7.1 / §7.2） | 已定 |
| 2026-09-03 | 钩子从 23 个配置分支、15 个 fetcher、12 个自定义 provider、4 种鉴权、12 个面板推导，PR #19882 只是测试用例 | 评审意见（"刚刚那个 PR 的特化，没有思考"）（§4.0） | 已定 |
| 2026-09-03 | Runtime v1 进程内 `import()`，仅用于用户自选文件/URL 安装；`utilityProcess` 隔离是分发索引的前置条件 | 让插件当 provider 且有市场的 GUI 应用（VS Code、LM Studio）都隔离；opencode / n8n / Obsidian 不隔离但都是"用户亲手装"（§5） | 已定 |
| 2026-09-03 | **复用 mini app 安装代码的实现**，通用部分抽到 `services/packageInstall/`，信封抽到 `shared/types/packageManifest.ts`；DB 提交、grants、更新行操作各写各的 | 用户拍板；逐文件切分见 §3.2，抽取是行为保持的 P0-a PR，8 个 mini app 安装测试不改全绿（§3.3） | 已定 |
| 2026-09-03 | 升级采用 generation 语义：新版本各 kind 注册成功后才注销旧版本，失败则旧版本继续运行 | opencode v2 `PluginSupervisor`（§7.2） | 已定 |
| — | 第二个 kind 选 `webSearchProviders` 还是 `channels` | 前者接口最小（两个方法、构造函数表）；后者已经是自注册工厂表，改动最少。文档暂按前者 | **待定** |
| — | `transformResponse` 钩子 | 仓库里只有 ark 一处响应归一化；第二个实例出现时按 `transformRequest` 同形加 | 暂不做 |
| — | 服务端工具（`toolFactories`）、网关按模型路由、营销位面板 | 函数值跨进程不可搬 / 多数可由 `models[].endpointTypes` 表达 / 无第三方需求 | 暂不做 |
