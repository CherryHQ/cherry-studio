# Extension 体系：通用宿主 + 贡献点，Provider 是第一个贡献点

> 状态：设计稿（未实现）。日期：2026-09-03。
> 归宿：本目录是 v2 重构的临时目录（`v2-refactor-temp/README.md`：重构落地后删除），设计稿按惯例先放这里；P0-b 随首个实现 PR 迁到 `docs/references/ai/extension-system.md`（补 frontmatter，跑 `pnpm docs:index`），§9 决策记录随之搬走。
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
| id | 扩展 id 反向域名；贡献项 id 局部且必填，宿主恒合成 `扩展id.局部id`；内置 id 无 `.` 故永不冲突 |
| Runtime v1 | 主进程内 `import()`；**受信任代码模型：扩展与 app 同权**。只装用户自选的、我们自己维护的扩展，不做市场；同意卡明说 + 安装时扫描（§5.1） |
| Runtime v2（API 不变） | Electron `utilityProcess` + `fetch` 反向桥。买到的是崩溃隔离，**不是沙箱**（Node 权限一个不少） |
| 真沙箱 | 只有 JS 引擎沙箱（QuickJS）或 WASM 才拿得掉 Node 权限；我们的 API 形状（纯数据 + 四个宿主能力）已经适配，做不做取决于要不要开市场（§5.1） |
| 开市场的前置条件 | 签名 + 审核 + 吊销，**不是**隔离方案——manifest 决定 endpoint 即凭证去向，纯数据扩展同样不能随便从网上装 |
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
  /** 安装/启用时调用；纯数据 kind 的 module 为 undefined。**全有或全无**：抛错时必须自己已经清干净。返回注销函数。 */
  register(ext: ExtensionRef, items: TItem[], module?: TModule): Promise<() => void>
}
export interface ExtensionRef { id: string; version: string; dir: string }
```

各子系统在自己目录里实现并注册（`providerContributionPoint.ts` 放在 `src/main/ai/provider/`，`webSearchContributionPoint.ts` 放在 `src/main/services/webSearch/`）。宿主维护 `Map<kind, ContributionPoint>`，安装时按 kind 分发。

回滚只有靠"全有或全无"才成立：宿主手里只有**已成功返回**的注销函数，`register` 抛错时它拿不到任何句柄。所以"注册到第 3 个 provider 才失败"这种局部状态必须由该 kind 自己回收（先全量校验、再一次性注册；或就地 unregister 已注册项后再抛）。宿主负责的只是跨 kind 那一层：kind B 失败 ⇒ 调 kind A 返回的注销函数 ⇒ 整个扩展回到未启用。

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
| 预览 → 同意卡 → 确认 | 账本 + `assertManifestUnchanged` + hash 重算 | 同意卡摘要：贡献 kind 列表、`network` 主机、**是否含 `main`（"将以应用权限运行"）**、`main.js` 的安装时扫描结论（§5.1） |
| 落盘 | staging + 三棵树轮换 | 新增三个路径键（照抄 mini app 的分法，`pathRegistry.ts`）：`feature.extension.packages` = `{userData}/Data/Extensions/packages`（每个扩展一个 `<id>@<version>/` 目录——带版本是因为 ESM `import()` 按 URL 永久缓存）、`feature.extension.snapshots` = `…/Extensions/snapshots`（回滚快照，与 packages 平级）、`feature.extension.publish_journal` = `…/Extensions/.publish-journal`。一律经 `application.getPath()` 取，代码里不拼路径 |
| 记录 | — | 新表 `extension` + `extension_installation`，字段抄 `mini_app_installation`（`manifestJson` / `contentHash` / `source` / `previous*` 回滚）+ **`isEnabled`**；无 `grant` 表——v1 的权限只是同意卡上的披露，没有运行时门（§5） |
| 崩溃恢复 | journal 机制 + 参数 | `committedHashOf` 查 `extension_installation` |
| 启用 / 禁用 / 卸载 | 状态机形状 | 禁用 = 写 `extension.isEnabled = false` **再**调用所有 kind 的注销函数——状态在库里，开机扫目录时跳过禁用的扩展（只进内存的禁用会在下次启动复活，等于没禁）；卸载保留业务行（provider 的 key 是用户的），但**必须在同一事务里把当前 preset 的连接事实固化进 `user_provider` 行并把 `presetProviderId` 置空**——行降级为普通自定义 provider（§4.7 第 7 项） |
| 升级 | 更新评审账本 + 三棵树 | 新版本目录 → `import` 新 → 校验信封与各 kind 的 items → 每个 kind 在扩展锁内**注销旧、注册新**；任一步失败 ⇒ 重新注册旧模块，旧版本继续服务（generation 语义，见下） |

安装只做"解压 + 校验 + 拷贝"，**不执行任何脚本**。

两条被现有实现约束死的细节（读代码得出，不是偏好）：

- **卸载不能只靠"preset 解析不到就隐藏"。** `ProviderService.list` 只按 `isRetiredProvider` 与 edition 过滤，preset 解析失败时 `getProviderDisplayMetadata` 返回 `{}`（`ProviderRegistryService.ts:779`）——行照样出现在设置页，只是没有描述、没有 endpoint；而且 `delete()` 会因 `presetProviderId === providerId` 判定为"预置行"直接拒删（`ProviderService.ts:936`），用户连清理都做不到。所以卸载必须主动降级：写回 `endpointConfigs`（含 `adapterFamily` / `baseUrl`）、`name`、`logo`，清空 `presetProviderId`。之后它就是一个普通自定义 provider——可用、可改、可删；重新安装同 id 扩展时再认回 preset。
- **generation 语义在 provider 这个 kind 上是"换"不是"叠"。** `extensionRegistry.register` 对已存在的 name 幂等跳过（`ExtensionRegistry.ts:55`），两代同 `providerId` 不可能共存；先注册新代是静默 no-op，随后注销旧代会把 provider 直接删掉。因此顺序固定为"校验通过 → `unregister(old)` → `register(new)`"，失败回滚 = 重新 `register(old)`（`unregister` 已 `clearCache()`，旧实例不会残留）。opencode 的"新代没成型就保持旧代"仍然成立，代价是切换点上有一个极短的不可用窗口——这是 id 唯一键注册表的固有性质，凡是按 id 索引的 kind 都同样处理。

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
        // ↓ 与 packages/provider-registry 的 defineProvider 同一套字段与校验，但 id 是**局部**的，
        //   宿主合成 providerId = 'space.tokendance.cherry.chat'；name / presetProviderId 也归宿主（§4.2）
        id: 'chat',
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

**manifest 与运行时代码靠局部 id 对齐。** `hooks` 是函数，抽取器序列化不了，所以它在 manifest 里只留名字：`{ "id": "chat", …数据…, "hooks": ["listModels", "acquireCredential"] }`（同意卡据此显示"该 provider 会自行获取凭证"）。启用时宿主 `import(main)` 拿到同一个 `defineExtension` 对象，按 `kind + 局部 id` 把内存里的函数挂到 manifest 的数据项上。两边对不上就拒绝启用：manifest 有而模块没有的 id、声明了 `hooks` 却没有对应函数、模块多出 manifest 里没有的贡献项——全部报错，不做"以模块为准"的兜底。理由：manifest 是用户同意过、`extension_installation.manifestJson` 存下来的那一份，运行时贡献必须是它的子集，否则同意卡就成了摆设。纯数据扩展没有 `main`，这一步跳过。

manifest 仍然是**安装时契约**：宿主校验它、同意卡展示它、`extension_installation.manifestJson` 存它。开发者永远不手写它。长期看，`packages/provider-registry/src/providers/*.ts` 里的内置 provider 就是"恰好随 app 打包的扩展"——同一个 `defineProvider`，同一个抽取器。

### 4.2 id 命名空间

- 扩展 id：反向域名（`space.tokendance.cherry`），与 mini app 同一规则；索引/市场保证唯一，本地安装遇同 id 走升级或重装流程。
- **每个贡献项必须有局部 id，运行时 id 恒为 `${扩展 id}.${局部 id}`**——没有"只有一个就省掉后缀"的捷径。捷径会制造一个升级即毁数据的坑：v1.0 只贡献一个 provider ⇒ `providerId = space.tokendance.cherry`，v1.1 加第二个 ⇒ 第一个变成 `space.tokendance.cherry.chat`，而 `user_provider` / `user_model` 以及引用模型的历史消息都还指着旧 id，用户的 key 和模型列表凭空消失。局部 id 一旦发布就是不可变的持久化键，改它等同于删旧建新。所有 kind 同规则（VS Code 也是宿主把 `vendor/id` 拼起来）。
- 内置 registry 的 provider id 没有一个含 `.`（已核对 `providers.json`），所以扩展 provider 与内置永不冲突；扩展之间的唯一性由扩展 id 唯一性直接推出。
- 约束：providerId 不能含 `::`（unique model id 分隔符）和 `/`（`/providers/:providerId` 路由无通配）——`.` 两者都安全。
- **身份字段一律由宿主填，扩展写不了。** registry 的 `ProviderConfigSchema` 要求 `id`（`ProviderIdSchema`）与 `name`（裸 `string`），`ProviderModelOverrideSchema` 要求 `providerId` + `modelId`；这三个里扩展只知道 `modelId`。所以 SDK 的 `defineProvider` 接 `Omit<ProviderConfig, 'id' | 'name' | 'presetProviderId'>` + `{ id: 局部 id; label?: LocalizedName }`，`models[]` 与 `listModels()` 接 `Omit<ProviderModelOverride, 'providerId'>`，宿主在注册时补齐：`id` / `providerId` = 合成 id，`name` = `resolveLocalizedText(label ?? manifest.name)`，`presetProviderId` = 合成 id 自身。
- `presetProviderId` 一起 `Omit` 掉不是洁癖：它是分组键，`resolveProviderPreset` 会拿它去解析内置预置（`zai → zhipu` 就是这么工作的），扩展若填 `'openai'`，自己的行就会继承 openai 的 `endpointConfigs`——**一个由不受信数据指定凭证去向的口子**。宿主恒等赋值，扩展碰不到。
- 贡献多个 provider 时 `label` 必填：`name` 默认取信封名，两个 provider 会在设置页显示成同名两行。SDK 在 `contributes.providers.length > 1 && !label` 时构建期报错，而不是留给用户去猜。

### 4.3 数据（L0）

manifest item = registry `ProviderConfigSchema` + 以下新增字段（都要加进 registry schema，内置 provider 同样受益）：

| 字段 | 作用 | 干掉的硬编码 |
|---|---|---|
| `headers?: Record<string, string>` | 固定请求头，宿主在 `getExtraHeaders` 合并 ⇒ aiSdk / pi / dsh 三条路径全部生效 | `utils/provider.ts` 里 tokendance / radeon-cloud 特判 |
| `metadata.website.credits?` / `.activity?` | 充值、用量页链接 | 渲染层 `oauth.ts` 的 `providerCharge` / `providerBills` id 表 |
| `configuration?: ConfigurationField[]` | 声明式配置字段 `{ key, type: 'string'\|'number'\|'boolean'\|'select'\|'secret', title, description?, required?, default?, options? }`；宿主渲染进 provider 设置页，`secret` 走现有凭证存储，值通过 `ctx.configuration` 给钩子 | bedrock / vertex / azure 的 IAM 表单（region / project / location / apiVersion）；VS Code 2026 年也把 key 存储和配置 UI 从扩展收回宿主（manifest `configuration` + `secret: true`） |
| `models?: Omit<ProviderModelOverride, 'providerId'>[]` | 静态模型清单，语义同 `provider-models.json`；`providerId` 由宿主补（§4.2）。模型 id 不在 `models.json` 里时必须带 standalone 字段（`name` 必填，`capabilities` / `limits` / `endpointTypes` 按需）——resolver 正是靠它们合成 `ModelConfig`，只给 `{ modelId }` 会得到一个没有能力的空模型 | — |

`adapterFamily` 取值 = 内置族名 ∪ `{ 本扩展 providerId }`。填扩展 id ⇒ 该 endpoint 的模型由 L2 实现提供；填内置族名 ⇒ 宿主用内置 AI SDK 适配器直连（TokenDance 全部如此）。

### 4.4 钩子（L1）——Cherry 自有类型，纯数据进出

```ts
// @cherrystudio/extension-sdk —— provider 钩子的全部公开面
import type { EndpointType, ProviderModelOverride } from './registry'   // 与 provider-registry 同源

export type Credential =
  | { type: 'api-key'; key: string; label?: string }
  | { type: 'oauth'; clientId: string; accessToken: string; refreshToken?: string; expiresAt?: number; accountId?: string }
//  ↑ 对齐 shared/data/types/provider.ts：api-key → ApiKeyEntry（宿主补 `id`/`isEnabled`），
//    oauth → AuthConfig(oauth)，其 `clientId` 是必填，所以钩子必须把它一起返回（PKCE 的 client id 本就是公开值）

export interface ProviderContext {
  providerId: string
  endpointType: EndpointType
  baseUrl: string
  endpointBaseUrls: Partial<Record<EndpointType, string>>
  credential?: Credential                       // 轮转后的当前凭证；authOptional 时缺省
  configuration: Record<string, unknown>        // manifest configuration 字段的当前值
  /** 宿主 fetch：代理 / UA / 重定向 / trace。签名收窄到可跨进程搬运的子集（§5）：
   *  url 只能是字符串，init 只能是普通对象，不接 `Request`、不接流式请求体 */
  fetch: (url: string, init?: ExtensionRequestInit) => Promise<Response>
  signal?: AbortSignal
  /** 宿主在刷新列表、模型选择器等场景以 silent=true 调用；只有用户显式"同步模型"才是 false。
   *  silent 时不得触发任何交互（不弹窗、不起回环服务器）。VS Code 的 PrepareLanguageModelChatModelOptions.silent。 */
  silent: boolean
}

export interface AuthContext extends ProviderContext {
  openExternal(url: string): Promise<void>
  /** 宿主起 127.0.0.1 临时端口监听一次回调（复用 OAuth runtime 的 LoopbackCallbackTransport）。
   *  回调页由宿主渲染（统一的"可以关闭此窗口"），扩展不返回 HTML——省掉一个跨进程搬不动的回调函数。 */
  awaitLoopbackCallback(path: string, timeoutMs?: number): Promise<{ url: string }>
  /** 宿主开一个授权窗口，把页面 postMessage 与导航 URL 流给扩展判定（silicon / 302ai / aihubmix / ppio / aionly 的形态） */
  openAuthWindow(url: string): AsyncIterable<{ kind: 'message'; data: unknown } | { kind: 'navigate'; url: string }> & { close(): void }
}

/** 出站请求的可改写视图；只覆盖 AI SDK 路径（pi / dsh 有自己的传输，它们只吃 manifest 数据） */
export interface OutgoingRequest {
  url: string
  headers: Record<string, string>
  body?: unknown                                // 已解析的 JSON；改完宿主重新序列化
}

export interface ProviderHooks {
  /** 模型发现。返回 registry 的完整模型 schema（`providerId` 由宿主补），宿主用现有 resolve 归一并做 endpoint 推导 */
  listModels?(ctx: ProviderContext): Promise<Omit<ProviderModelOverride, 'providerId'>[]>
  /** 交互式获取凭证：弹窗回传 key、PKCE 回环、OAuth 授权码 */
  acquireCredential?(ctx: AuthContext): Promise<Credential>
  /** 有 refreshToken 的凭证过期时由宿主调用；缺省 ⇒ 过期即失效 */
  refreshCredential?(ctx: ProviderContext, current: Credential): Promise<Credential>
  /** 每次请求前改写 URL / 头 / body（zhipu、lmstudio、ark、dashscope、codex、grok 这一类） */
  transformRequest?(request: OutgoingRequest, ctx: ProviderContext): OutgoingRequest | Promise<OutgoingRequest>
}
```

三条规则：

- 入参只有纯数据和四个宿主能力函数（`fetch` / `openExternal` / `awaitLoopbackCallback` / `openAuthWindow`）。这四个都是"宿主做事、扩展等结果"的形状，在 §5 的 C / F 里都能桥接。
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
   → verify: GET /providers/space.tokendance.cherry.chat/preset 返回 manifest 的 endpointConfigs

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

7. user_provider delta 行：安装时同 presetProviderSeeder.toDbRow；卸载时固化连接事实 + 清 presetProviderId（§3.2）
   → verify: 卸载后该行仍可用、可编辑、可删除；重装同 id 扩展后重新认回 preset
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

**两个概念必须分开记：崩溃隔离（扩展挂了别拖垮 app）和权限沙箱（扩展拿不到它不该拿的东西）。** 换进程只买到前者。

| 方案 | fetch 接缝 | 流搬运 | 崩溃隔离 | **权限沙箱** | 实现量 | 备注 |
|---|---|---|---|---|---|---|
| **A. 主进程内 `import()`** | 直接注入 | 无 | 无 | **无** | ~300 行 | Obsidian / opencode / n8n 的模型；扩展与 app 同权，还能改 app 自己的模块 |
| B. `worker_threads` | 要桥；worker 里没有 Electron `net` | 要 | 弱 | **无**（worker 里 Node 内建全在） | ~800 行 | localModel worker 是"拿代理快照自建 dispatcher"，对 provider 不可接受（丢 UA / trace） |
| **C. `utilityProcess`** | 反向 RPC：扩展 `fetch` 等四个宿主能力 → MessagePort → 宿主执行 | §4.5 的 `ChatStreamPart` 全是纯对象，可搬（`signal` 换 id、`Uint8Array` 走 transfer） | 强 | **无** | ~1200 行 | `workerProxy.ts` 注释已预留入口。它是一个**带完整 Node 的子进程**，没有 `sandbox` 开关；`fs` / `child_process` / 原生模块一个不少 |
| D. 子进程 + JSON-RPC（MCP 式） | 同 C | 同 C，自定义协议 | 强 | 无（除非再叠 OS 级沙箱） | ~1500 行 | 唯一优势是非 JS 扩展；本体系不需要 |
| E. WASM | 宿主提供 | 要 | 强 | **强** | 大 | AI SDK 包编译不进 WASM；Zed 走这条是因为扩展面窄且是 Rust |
| **F. C + 嵌入式 JS 引擎（QuickJS）** | 宿主注入 | 同 C | 强（外层还是 `utilityProcess`） | **强**（引擎里根本没有 Node 内建，能力全靠宿主注入） | C + ~600 行 | Figma 插件走的就是 QuickJS。性能远低于 V8，npm 生态受限 |
| ~~G. 隐藏渲染进程（`sandbox: true`）~~ | 同 C | 同 C | 强 | 强（Chromium OS 级沙箱） | ~1200 行 | **否决**：provider 扩展是后端能力，拿 UI 构件当计算宿主要背窗口生命周期、后台节流、以及 Blink 的 2GB 内存分区（#18435 的崩溃类）。理由见 §5.1 |

**决定：v1 用 A，API 按"跨进程可搬"设计（C / F 通用）；真沙箱选 F；索引的前置条件是来源可信，不是任何一种隔离。**

- 选 A：目标是最简实现；provider 的工作就是发 HTTP，宿主网络策略全收敛在 `customFetch`，进程内注入零成本。
- 按跨进程设计：§4.4 / §4.5 的入参除四个宿主能力函数（`fetch` / `openExternal` / `awaitLoopbackCallback` / `openAuthWindow`）外全是纯数据，出参（`Credential` / `ProviderModelOverride[]` / `ChatStreamPart` 流）全是纯对象。换成 C / F 时扩展代码零改动，宿主把 `extensionAdapter.ts` 的输入端从"进程内对象"换成"MessagePort 代理"。§4.0 排除服务端工具正是为了不在 API 里放函数值。

**"零改动"不是自动成立的，它由下面这条线上契约保证**（现在就写进类型，否则 P3 会发现 API 里躺着搬不动的值）：

| API 面 | 桥的形状 | 约束 |
|---|---|---|
| `openExternal` / `awaitLoopbackCallback` | 一次请求 / 一次响应 | 入参出参都是 structured-clone 类型：**没有 `URL`、没有回调函数、没有 `Response`**。§4.4 的 `url` 全部是 `string`，回环回调页由宿主渲染 |
| `openAuthWindow` | 一条事件通道（宿主推 `message` / `navigate`，扩展发一次 `close`） | 事件负载走 structured clone；`data` 是页面 postMessage 的原值，本来就只能是可克隆值 |
| `fetch` | 请求/响应 + 响应体分块推流；扩展侧是一个真的 `fetch` 实现（签名不变） | 支持的子集：`input` 为 URL 字符串、`init` 为普通对象（`method` / `headers` / `body: string \| Uint8Array \| URLSearchParams` / `signal`），响应以 `{ status, headers, body: 分块 Uint8Array }` 回传后在扩展侧重建 `Response`。**不支持** `Request` 对象入参、请求体流式上传（`duplex: 'half'`）、`fetch` 上的自定义 agent |
| 钩子返回值 / `ChatStreamPart` | 一次响应或一条流通道 | 全是纯对象；`Uint8Array` 走 transfer；`AbortSignal` 换 id，宿主侧 abort 转成通道消息 |

这四条在 v1（方案 A，进程内）下同样成立——A 只是把桥换成直接调用。谁写了一个 `Request` 入参的 fetch 调用，A 下能跑、C 下崩，所以子集从第一天就是 SDK 类型的一部分，而不是 P3 的迁移说明。
- A 的边界：只覆盖用户自选文件 / URL 安装。
- A 的纪律：只加载 `feature.extension.packages` 下用户显式安装的目录；同意卡写明"含代码，以应用权限运行"；manifest zod 严格模式；id 冲突拒绝；扩展抛错 ⇒ `ProviderCreationError`，只标记该 provider 不可用；不自动更新。
- 加载：`import(pathToFileURL(main).href)`；`main.js` 单文件 ESM，`cherry-ext build` 把依赖全部内联，宿主**不**给扩展解析自己的 `node_modules`——版本由宿主决定的依赖就是隐式 API。扩展对宿主的唯一编译期依赖是 `@cherrystudio/extension-sdk` 的类型。

### 5.1 信任模型：v1 不是沙箱，也不假装是

带 `main` 的扩展（L1 钩子 / L2 模型实现）就是跑在 Node 上的代码，拥有和 app 一样的权限：读写用户目录、起子进程、连任意网络。**换进程改变不了这一点**——Electron 的 `utilityProcess` 是一个带完整 Node 的子进程，没有 `sandbox` 选项；它买到的是"扩展崩了不拖垮 app、内存有边界"，不是"扩展拿不到你的文件"。§5 表格里 C 那一格的"强"只属于崩溃隔离列，任何时候都不要拿它当安全论据。

所以 v1 的安全边界只有一条，而且它不是技术边界：**只装用户自己挑的、我们自己维护的扩展，没有线上市场。**在这个前提下这个风险是可接受的——用户手动下载一个 zip 双击安装，和他下载一个 exe 双击运行是同一件事，VS Code / Obsidian / opencode / n8n 全都停在这个模型上。配套的三件事：

1. **同意卡说人话**：不写"需要 network 权限"，写"这个扩展包含代码，运行后可以访问你的文件和网络，和 Cherry Studio 本身权限相同。只安装你信任的来源"。含 `main` 与不含 `main` 的扩展在同意卡上必须长得明显不一样。
2. **安装时扫一遍**：解压后、落盘前，对 `main.js` 做一次静态检查（`child_process` / `fs` 写入 / `eval` / 动态 `import` / 混淆特征 / manifest `network` 之外的域名字面量）加一次 agent 阅读，把结论摆在同意卡上。openclaw 的安装扫描（§7.3，1,286 行）就是这个位置的东西。**定位要摆正：它抬高门槛、给用户信息，不构成保证**——分阶段下载的 payload、跑起来才拼出来的字符串，静态扫和 LLM 阅读都拦不住。写成"已扫描，安全"就成了反作用。
3. **不自动更新**：更新和首装走同一条同意 + 扫描路径。

**开索引/市场时，门槛不是隔离方案，是来源可信。** 理由在仓库里已经有先例：`ProviderRegistryUpdaterService` 明写"provider 路由保持内置，因为未签名的数据绝不能决定凭证去向"——而扩展的 manifest 恰恰就在决定 endpoint，即 API key 发去哪。这意味着**即使是纯数据扩展（无 `main`）也不能随便从网上装**。所以索引阶段要补的是签名、审核与吊销名单，不是"上了 utilityProcess 就能开市场"。C 值得做，但它的理由是稳定性，不是安全。

**选沙箱方案前先认清 provider 扩展是什么：一个后端能力。** 无 UI、随 app 常驻、按请求跑、要长时间搬运流式响应。所以候选运行时只能在"后端"这一侧挑——main、`utilityProcess`、或嵌进去的 JS 引擎。

**因此 G（隐藏渲染进程 + `sandbox: true`）被否掉**，尽管它是 Electron 里唯一现成的 OS 级沙箱，也尽管 mini app 已经在用这个形态。理由是 mini app 的先例迁不过来——**mini app 本来就是 UI**（一个网页），而 provider 扩展不是；拿窗口当计算宿主要背三笔与沙箱无关的账：

- **窗口生命周期**。仓库规定所有 `BrowserWindow` 走 `WindowManager` 并在 `windowRegistry` 声明模式，于是一个后端服务的运行时变成了窗口注册表里的一项，启停顺序、pooled/singleton 语义、`onWindowCreated` 全要跟着走一遍。
- **后台节流**。隐藏/被遮挡的渲染进程会被 Chromium 降优先级并节流定时器，得靠 `backgroundThrottling: false` 关掉——一个必须记住否则会偶发慢的坑。
- **Blink 的内存天花板**。这条最硬：#18435 已经实锤，流式响应在渲染进程里累积会打爆 Blink 的 PartitionAlloc 分区（约 2GB，144 秒可复现崩溃）。provider 的流式路径正是那条路径，把它塞回渲染进程等于把一个已经查清的崩溃类请回来。Node 侧没有这个分区限制。

**所以真沙箱只有 F：把扩展代码放进嵌入式 JS 引擎（QuickJS，`quickjs-emscripten`），引擎跑在 `utilityProcess` 里。** 引擎里没有 `fs` / `child_process` / 裸 `fetch`，能力全部由宿主注入——这正是 §4.4 / §4.5 已经写好的四个。外层的 `utilityProcess` 负责崩溃与内存边界，内层的引擎负责权限，两件事各归各。已知代价：性能远低于 V8（provider 的活是 I/O 密集，解析 SSE 分块够用，但 L2 里做重计算的扩展不适合）；PKCE 要的 SHA-256 / 随机数得宿主注入；npm 生态里依赖 Node 内建的包全部不可用。`isolated-vm` 不选——原生插件，每次 Electron 升级都要跟着重编（`better-sqlite3` 的 ABI 问题已经够烦了）。

Figma 的插件走的就是 QuickJS，而且它的分工和我们一样：计算在引擎里、UI 在别处。VS Code 的 web extension（Web Worker，无 Node）是同一个思路的另一种壳。

便宜的中间加固（可选，未验证）：如果 C 先于 F 落地，给 `utilityProcess` 的 `execArgv` 加 Node 权限模型开关（`--permission --allow-fs-read=<扩展目录>`，不给 `--allow-child-process` / `--allow-addons`）。**需要先验证 Electron 是否透传这些标志**；即便可行，Node 的权限模型也不管网络，挡的是文件与起进程，属于 defense-in-depth，仍然不是沙箱。

宿主服务：`ExtensionHostService`（`BaseService`，WhenReady，放 `src/main/services/extension/`——业务无关但可移除，按 main-process 架构文档的规则归 `services/` 而不是 `core/`；贡献点实现各自留在子系统目录）。职责：扫目录（跳过 `isEnabled = false` 的）→ 校验信封 → `import(main)` → 按 kind 分发 → 持有注销函数。**分发在 P0/P1 是一个写死的 `if (kind === 'providers')` 直调**，§3.1 的 `ContributionPoint` 接口到 P2 第二个 kind 落地时才存在；本文其余地方说"调各 kind 的 register / 注销函数"指的是这个能力，不是说接口那天就在。IpcApi：`extension.list` / `extension.preview` / `extension.confirm` / `extension.set_enabled` / `extension.remove`（与 mini app 的路由形状一致）。

## 6. 分发

| 阶段 | 来源 | 机制 |
|---|---|---|
| v1 | 本地 zip / 目录 | mini app 的文件安装流程 |
| v1 | URL | mini app 的 web 安装流程（分发 manifest + `package.url` + sha256） |
| 之后 | 索引 | `x-files/extensions/v1/index.json`，与 provider-registry 远程分支同款；**前置条件是签名 + 审核 + 吊销（§5.1），不是 utilityProcess** |
| 之后 | npm 包名 | binary-manager 的 `bun` 装到 `Extensions/_npm/`，自动生成 manifest 包一层。AI SDK 社区 provider 就是现成生态（opencode 路线） |

**索引与包地址必须双源**，这是仓库里已有的硬规矩，不是可选优化：

- 索引本身走 GitHub raw + GitCode raw 两个地址，按 `RegionService` 选序——与 `ProviderRegistryUpdaterService` 的 `REGISTRY_URL_GITHUB` / `REGISTRY_URL_GITCODE` 同一套分支与选路。
- 条目是 `{ id, name, version, url, urlCn?, sha256, size }`；`url` / `urlCn` 沿用 mini app 的成对声明规则（`miniAppManifest.ts:423`：`update.urlCn` 与 `package.urlCn` 必须同时出现或同时不出现），下载时用 `mirrorOrder` 选序、两个镜像必须是同一份字节（sha256 校验兜底）。
- URL 一律 `assertHttps`；这些都是 §3.2 抽到 `packageInstall/httpSource` 的现成能力，索引这一层不用新代码。

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
4. **让 provider 代码当扩展且有市场的 GUI 应用都隔离进程——但没有一家给了插件真沙箱。** VS Code 的 extension host 同样是全权限 Node 进程，市场的安全靠审核、签名与吊销；Zed 是唯一做到真沙箱的（WASM），代价是它的扩展面窄到没有 provider 口。→ §5.1：v1 不做市场，市场的门是来源可信。
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
- **凭证与 provider 分离**（v2 integration 域）与 §4.3 `configuration` + §4.4 `acquireCredential` / `refreshCredential` 同构：方法声明是数据，交互由钩子描述，存储、刷新、注入归宿主。差异：opencode 的 `authorize` 返回 `{ url, callback }` 让插件自己收回调（codex 插件自起回环服务器）；我们把回环 / 授权窗口做成宿主能力（`AuthContext`），是为 §5 的跨进程/沙箱运行时留的口。
- **`Model.Info.compatibility` 与 Cherry 的 `EndpointDialect` 是同一个东西**（`streamOptions` / `developerRole` / `reasoningSummary`）：方言是数据，已在 registry schema 里，L0 直接覆盖。
- **`http.response` 钩子**：仓库里只有 ark 一处响应归一化（`normalizeArkResponsesResponse`）；§4.4 先不放 `transformResponse`，第二个实例出现时按同样形状加。
- **generation 语义**：§3.2 的升级流程改为"新版本注册成功后才注销旧版本；失败则旧版本继续运行"。
- 与 VS Code 的交叉印证：两家都在 2026 年把凭证存储从扩展收回宿主、都把模型元数据做成运行时数据、都保留一个 JSON 逃生口（VS Code `DataPart` mime / opencode `headers/body` overlay）。三家里唯一做进程隔离的是 VS Code；opencode 两代都进程内。

### 7.3 pi / dsh / openclaw：三个"第一方全是插件"的系统为什么复杂

三个仓库都在 2026-09-03 更新到最新 main/master 后逐文件统计（pi-mono `e44d75c20`、deepseek-harness `76fda72979`、openclaw `b5f9636c016`）。口径：各仓库插件相关目录下非测试 TS/JS 的物理行数，方法数与事件数按导出面手点。**换个人重数会有出入**——"哪些目录算插件运行时"没有客观边界，行数本身也含注释与空行。所以下面的结论只用到数量级差（几千 vs 几万 vs 百万、十几个方法 vs 八十几个），不依赖任何单个数字；把某一格改动 30% 不会改变任何一条结论。

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

三个仓库的提交历史里能直接读出"哪些决定后来被自己推翻"。把其中与本设计相关的五条固定为规则：

| 规则 | 反例（在对方仓库里的悔改证据） | 本设计对应 |
|---|---|---|
| **宿主对象显式构造、显式传递，不用全局槽和作用域栈** | 用 `globalThis` 符号槽存注册表、再叠 AsyncLocalStorage 区分"哪一代注册表"的做法，产生了一串"改无关配置后注册表失效 / 请求线程重建整个注册表 / `register()` 跑三次"的修复 | `ExtensionHostService` 是唯一持有者；贡献点通过 `register(ext, items, module)` 拿到引用，不查全局 |
| **重载单位是整个扩展目录，不做配置路径级热重载** | 几千行的"配置路径前缀 → hot / restart / none"计划器与进程内重启协调器、OS 级守护进程三套并存，四成提交是修复 | §3.2：新版本目录 → 注册 → 成功后注销旧；失败保留旧代。没有 per-path 规则 |
| **`apiVersion` 从第一天独立于 app 版本** | 用 app 的 CalVer 当插件 API 兼容范围，只能表达"宿主不低于某发布"，结果是四个月 25 个 Breaking 段落和一个专门的 API baseline diff 工具 | §3 manifest `apiVersion` 整数 + `SUPPORTED_API_VERSIONS`；§4.6 的 `…V2` 纪律 |
| **provider 差异做成数据 + 家族 helper，不做大契约** | 64 字段的 provider 契约，小 provider 靠事后补的 family-hook 构建器才能写短；SDK 缺的 helper 被 29 个扩展各抄一份 | §4.0 的 L0 / L1 / L2；§4.3 `configuration`、`headers` 这类字段先于钩子 |
| **不做市场，直到 API 停止变动；运行时不做 TS 转译** | 十种安装来源和市场先于稳定 API；运行时 jiti 加载 TS 入口后来降级为 emergency fallback，中间付了别名层和多次启动性能回归 | §6 索引排在签名 + 审核之后（§5.1）；§4.1 扩展交付单文件 ESM，宿主只 `import()` |

## 8. 分阶段

| 阶段 | 交付 | 验证 |
|---|---|---|
| P0-a | **行为保持的抽取 PR**：`services/packageInstall/` + `shared/types/packageManifest.ts`，mini app 改为薄包装（§3.3 第 1、2 步） | mini app 的 8 个安装测试文件一行不改全绿 |
| P0-b | SDK 包（类型 + `defineExtension` + `cherry-ext build`）+ `ExtensionManifestSchema` + `ExtensionHostService` + extension 安装流程（§3.3 第 3 步）+ `providers` L0（§4.7 第 1、2、7、8 项）；本文迁到 `docs/references/ai/` | 一个纯数据扩展装上后，设置页出现该 provider，聊天与 pi/dsh 都带上 manifest headers；`pnpm docs:check` 过 |
| P1 | L1 钩子 `listModels` / `acquireCredential` + L2 `imageModel` adapter（§4.7 第 3–6 项） | **TokenDance 作为扩展包通过**；PPIO 搬出主仓库 |
| P2 | `configuration` 声明式表单 + `refreshCredential` / `transformRequest`；第二个 kind（建议 `webSearchProviders`），此时抽出 `ContributionPoint` 接口 | Bedrock 的 IAM 表单由声明式字段渲染；两个 kind 共用一套安装/启停/卸载 |
| P3 | `utilityProcess` runtime（§5 方案 C）+ provider kind 的远程 shim；开市场的话再叠 QuickJS（方案 F） | 同一个 TokenDance / PPIO 包在 A/C 下都通过，扩展代码零改动 |
| P4 | 索引 + 签名 + 审核 + 吊销名单 + 一键安装 | 未签名的包装不上；吊销名单命中的包禁用；索引安装的扩展只在沙箱（F）下运行 |
| 之后 | `channels`（已是自注册工厂表，最顺手）→ `fileProcessors` → `agentRuntimes`（描述符 + driver 两半都要贡献，最重） | 各自子系统的合同测试 |

P3 排在 P4 前是硬约束，不是偏好。P2 之前不抽 `ContributionPoint` 接口是纪律，不是遗漏。P0–P2 只有"用户自选安装 + 同意卡 + 安装扫描"这一层门（§5.1），这是明知的取舍，不是待补的 TODO。

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
| 2026-09-03 | Runtime v1 进程内 `import()`，仅用于用户自选文件/URL 安装 | 最简实现；用户亲手装的模型与 opencode / n8n / Obsidian 一致（§5） | 已定 |
| 2026-09-04 | ~~`utilityProcess` 隔离是分发索引的前置条件~~ → **推翻**：C 只提供崩溃隔离，索引的前置条件是签名 + 审核 + 吊销 | 评审（@苏垚）：`utilityProcess` 是全权限 Node 子进程，没有 sandbox 开关，L1/L2 代码照样能读文件、起进程；原规则把崩溃隔离当成了安全门（§5.1） | 已定 |
| 2026-09-04 | v1 不做市场，只装用户自选、我们自己维护的扩展；同意卡明写"与 app 同权"，安装时静态 + agent 扫描一次，结论摆给用户看 | 用户拍板；在"用户亲手装"的前提下这个风险与双击运行一个 exe 同级。扫描定位为抬门槛，不写成安全保证（§5.1） | 已定 |
| 2026-09-04 | 真沙箱路线选 F（`utilityProcess` + QuickJS），做不做取决于要不要开市场 | provider 扩展是后端能力：无 UI、常驻、流式。外层进程管崩溃、内层引擎管权限。`isolated-vm` 因原生 ABI 排除（§5.1） | 待定 |
| 2026-09-04 | 否决 G（隐藏渲染进程 + `sandbox: true`），尽管它是 Electron 里唯一现成的 OS 级沙箱 | 用户指出这是后端能力，mini app 的先例迁不过来（mini app 本身就是 UI）：要背窗口生命周期与 `WindowManager` 规则、后台节流，且 #18435 已证明流式累积会打爆 Blink 的 PartitionAlloc 分区（§5.1） | 已定 |
| 2026-09-03 | **复用 mini app 安装代码的实现**，通用部分抽到 `services/packageInstall/`，信封抽到 `shared/types/packageManifest.ts`；DB 提交、grants、更新行操作各写各的 | 用户拍板；逐文件切分见 §3.2，抽取是行为保持的 P0-a PR，8 个 mini app 安装测试不改全绿（§3.3） | 已定 |
| 2026-09-03 | 升级采用 generation 语义，但按 id 索引的 kind 是"校验后原地换"：`unregister(old)` → `register(new)`，失败重新 `register(old)` | opencode v2 `PluginSupervisor`（§7.2）；`ExtensionRegistry.register` 对同名幂等跳过，两代不可能共存（§3.2） | 已定 |
| 2026-09-04 | 卸载时把 preset 连接事实固化进 `user_provider` 行并清空 `presetProviderId`，行降级为自定义 provider | 评审；preset 解析不到并不会隐藏行（`getProviderDisplayMetadata` 返回 `{}`），且 `delete()` 会拒删预置行，用户会得到一个删不掉的死行（§3.2） | 已定 |
| 2026-09-04 | provider / model 的身份字段（`id` / `name` / `providerId`）由宿主填，SDK 类型里直接 `Omit` 掉 | 评审；registry schema 把这三个列为必填，扩展只知道 `modelId`（§4.2） | 已定 |
| 2026-09-04 | `Credential` 的 oauth 变体带 `clientId` | 评审；`AuthConfigOAuth.clientId` 是必填，否则"宿主直接落库"不成立（§4.4） | 已定 |
| 2026-09-04 | 宿主能力的线上子集写进 SDK 类型：无 `URL`、无回调函数、`fetch` 收窄到字符串 URL + 普通 init | 评审；否则 §5 的"换沙箱运行时扩展零改动"只是承诺（§5） | 已定 |
| 2026-09-04 | 索引与包地址双源（GitHub + GitCode，`url`/`urlCn` 成对），走 `mirrorOrder` + sha256 | 评审；与 `ProviderRegistryUpdaterService`、mini app 分发 manifest 同一规矩（§6） | 已定 |
| 2026-09-04 | 局部 id 必填，运行时 id 恒为 `扩展id.局部id`，没有"单贡献省后缀"的捷径 | 评审；捷径会让"1 个 provider → 2 个"的升级改掉已持久化的 providerId，用户的 key / 模型 / 历史引用全部悬空（§4.2） | 已定 |
| 2026-09-04 | manifest 数据项与模块内实现按 `kind + 局部 id` 对齐，对不上就拒绝启用 | 评审；`hooks` 是函数、序列化不进 manifest，没有对齐规则就等于运行时可以超出用户同意过的那份 manifest（§4.1） | 已定 |
| 2026-09-04 | `presetProviderId` 也 `Omit` 掉，宿主恒等赋值；多 provider 时 `label` 必填 | 评审；前者是"不受信数据指定凭证去向"的口子，后者会让设置页出现同名两行（§4.2） | 已定 |
| 2026-09-04 | 禁用状态落 `extension.isEnabled`，开机跳过；扩展目录走 `feature.extension.*` 三个路径键 | 评审；只进内存的禁用下次启动就复活，拼路径违反"路径集中获取"（§3.2） | 已定 |
| 2026-09-04 | `ContributionPoint.register` 契约为"全有或全无"，宿主只做跨 kind 回滚 | 评审；register 抛错时宿主拿不到注销函数，kind 内的局部注册只能由 kind 自己收（§3.1） | 已定 |
| — | 第二个 kind 选 `webSearchProviders` 还是 `channels` | 前者接口最小（两个方法、构造函数表）；后者已经是自注册工厂表，改动最少。文档暂按前者 | **待定** |
| — | `transformResponse` 钩子 | 仓库里只有 ark 一处响应归一化；第二个实例出现时按 `transformRequest` 同形加 | 暂不做 |
| — | 服务端工具（`toolFactories`）、网关按模型路由、营销位面板 | 函数值跨进程不可搬 / 多数可由 `models[].endpointTypes` 表达 / 无第三方需求 | 暂不做 |
