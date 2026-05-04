# 绘图模块 `providers/models` 从 v1 到 v2 的迁移方案

## 文档目的

本文用于规划 `src/renderer/src/pages/paintings` 对 provider/model 数据来源的迁移，目标是在遵守 `docs/references/data` 规范的前提下，去掉绘图模块对 v1 Redux `useProvider.ts` 的直接依赖，切换到 v2 DataApi domain hooks。

本文是设计与实施计划，不是实现说明。默认前置条件为 PR `#14269` 合并后再开始编码。

## 范围

本次迁移覆盖：

- 绘图模块内对 v1 `useAllProviders()` 的直接使用
- 绘图模块内对 `provider.apiKey`、`provider.apiHost`、`provider.enabled`、`provider.models` 的直接依赖
- 绘图模块内与 v2 `useProviders`、`useProvider`、`useProviderApiKeys`、`useModels` 对接的类型与加载状态处理

本次迁移不直接扩展新的 Main DataApi 端点。优先复用 PR `#14269` 已提供的 `/providers`、`/providers/:id/api-keys`、`/models`。

## 规范约束

依据：

- `docs/references/data/README.md`
- `docs/references/data/data-api-in-renderer.md`
- `docs/references/data/api-design-guidelines.md`
- `docs/references/provider-model/provider-registry.md`

迁移时必须遵守以下边界：

- SQLite 持久化的 provider/model 数据，走 DataApi。
- 只用于运行时调用第三方接口的数据，不新增 DataApi 包装层。
- 外部模型发现接口不属于 DataApi 范畴，不能为了“统一”而硬塞进 `/models`。
- 绘图模块内部不要继续把 v1 `Provider` 作为通用契约到处透传，更不能靠 `as Provider` 掩盖字段不兼容。

## 现状排查结论

### 1. 直接使用 v1 `useAllProviders()` 的位置

当前确认有 3 处：

| 文件 | 当前用法 | 迁移影响 |
| --- | --- | --- |
| `src/renderer/src/pages/paintings/route/PaintingsRoute.tsx` | `useAllProviders()` | 用于筛选可用的 NewAPI provider |
| `src/renderer/src/pages/paintings/hooks/usePaintingProviderRuntime.ts` | `useProvider()` | 用于按 `providerId` 找 provider 对象并适配为 `PaintingProviderRuntime` |
| `src/renderer/src/pages/paintings/providers/tokenflux/slots.tsx` | `useAllProviders()` | 用于拿 `apiHost/apiKey` 拉取 TokenFlux 外网模型列表 |

### 2. 绘图模块对 v1 Provider 字段的真实依赖

| 字段 | v1 来源 | 绘图内用途 | v2 替代 |
| --- | --- | --- | --- |
| `apiKey` | `Provider.apiKey: string` | 生成接口鉴权、TokenFlux 拉模型 | `useProviderApiKeys(providerId)` |
| `apiHost` | `Provider.apiHost: string` | 生成接口 URL 拼接、TokenFlux 拉模型 | `provider.endpointConfigs[...]?.baseUrl` |
| `enabled` | `Provider.enabled?: boolean` | `checkProviderEnabled()` | `provider.isEnabled` |
| `models` | `Provider.models: Model[]` | `newapi` / `ovms` 模型选项、`AiProvider(provider).generateImage()` 隐式依赖 | `useModels(...)` 或本地静态模型源 |

### 3. 不是 3 个 import 替换那么简单

除了表面上的 hook 替换，本次迁移还存在 3 类额外风险：

| 风险点 | 现状 | 影响 |
| --- | --- | --- |
| `PaintingsRoute` 的 `isNewApiProvider(provider)` | 该工具依赖 v1 `provider.type`，而 v2 `Provider` 不暴露 `type` | 不能原样复用旧判断逻辑 |
| `AiProvider(provider).generateImage()` | `AiProvider.ensureConfig()` 会读 `provider.models` | `zhipu`、`aihubmix`、`silicon` 路径会被牵连 |
| `getProviderByModel()` | 仍从 v1 store 读取 provider | `silicon/generate.ts` 仍有外部 v1 依赖 |

## 关于“models 是否全部写死 / 全部走外网拉取”的结论

不是。绘图模块里的 models 需要按来源拆开看，不能一刀切。

### 1. 需要走 DataApi 的 models

这类 model 已经是 SQLite 持久化数据，应该通过 v2 hooks 读取：

- `newapi/provider.tsx`
- `ovms/provider.tsx`
- 未来任何依赖 `/models` 持久化表的 provider

读取方式：

- `useModels({ providerId })`
- 如需过滤绘图能力，使用 `useModels({ providerId, capability: MODEL_CAPABILITY.IMAGE_GENERATION })`

### 2. 应继续保留本地静态定义的 models

这类 model 本来就不是用户可 CRUD 的业务数据，而是绘图 provider 自己的本地配置或常量：

- `zhipu`
- `silicon`
- `aihubmix` 中部分固定模式
- 其他 `config.ts` 里已有的静态选项

这部分不应为了“统一”强行改成 DataApi。

### 3. 应继续通过外部接口拉取的 models

以 `tokenflux/slots.tsx` 为代表，这类模型列表来自第三方实时接口，不是本地 SQLite 业务数据。

根据 DataApi 边界规范，这类数据：

- 不能新增 `/models` DataApi 包装
- 应保留为 renderer/service 侧的外部请求
- 只需要把 provider 凭据来源从 v1 store 切到 v2 hook

## 推荐总体方案

推荐按“绘图本地适配层 + 分阶段替换”推进，而不是在绘图代码里散落使用 v2 Provider 原始结构。

### 方案核心

在绘图模块内部新增一层适配，统一把 v2 provider 数据解析成绘图运行时真正需要的最小上下文。

建议新增：

- `src/renderer/src/pages/paintings/model/types/paintingProvider.ts`
- `src/renderer/src/pages/paintings/hooks/usePaintingProvider.ts`

建议定义本地类型：

```ts
export interface PaintingProviderContext {
  id: string
  name: string
  presetProviderId?: string
  isEnabled: boolean
  apiKey: string
  apiHost: string
}
```

设计意图：

- 绘图运行时只消费自己需要的字段
- v2 `Provider` 的 `endpointConfigs/apiKeys/isEnabled` 结构只在适配层出现一次
- `generate.ts`、`checkProviderEnabled()`、`tokenflux/slots.tsx` 不直接感知 v2 结构
- 避免继续使用 `(providers.find(...) ?? { id }) as Provider`

## 详细改造步骤

### 阶段 0：前置依赖

依赖 PR `#14269` 提供以下能力：

- `src/renderer/src/hooks/useProviders.ts`
- `useProviders()`
- `useProvider(providerId)`
- `useProviderApiKeys(providerId)`
- `src/renderer/src/hooks/useModels.ts`
- `useModels(query, options?)`
- `/models` 支持 `capability` 查询参数

如果 PR 未合并，本方案不应提前落代码。

### 阶段 1：建立绘图 provider 适配层

新增 `usePaintingProvider(providerId)`，内部组合：

- `useProvider(providerId)`
- `useProviderApiKeys(providerId)`

解析规则建议如下：

1. `apiKey`
   从 `useProviderApiKeys(providerId)` 返回的 `keys` 中选一个可用 key。

2. `apiHost`
   优先级建议：
   - `endpointConfigs[ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]?.baseUrl`
   - `endpointConfigs[provider.defaultChatEndpoint]?.baseUrl`
   - `endpointConfigs[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl`
   - `''`

3. `isEnabled`
   直接使用 `provider.isEnabled ?? false`

4. `isLoading`
   组合 provider query 与 api-keys query 的加载态

注意：

- 文档与代码里应使用真实的 `EndpointType` 常量，例如 `openai-image-generation`、`openai-chat-completions`，不要再写旧口径的 `'openai'`。
- 这一步只解决“provider 基础配置与凭据”的来源问题，不负责提供 `models`。

### 阶段 2：替换绘图模块的 3 个直接 hook 使用点

#### 2.1 `PaintingsRoute.tsx`

替换：

- `useAllProviders()` -> `useProviders()`

但这里不能只替换 import，因为旧逻辑还依赖 `isNewApiProvider(provider)`。

需要同步引入新的绘图专用判断函数，例如：

```ts
function isPaintingNewApiProvider(provider: PaintingRouteProviderLike) {
  return ['new-api', 'cherryin', 'aionly'].includes(provider.id) || provider.presetProviderId === 'new-api'
}
```

原因：

- v2 `Provider` 没有 `type`
- 现有 `@renderer/utils/provider.isNewApiProvider()` 不能直接用于 v2 `Provider`

#### 2.2 `usePaintingWorkspace.ts`

替换：

- `useAllProviders()` -> `usePaintingProvider(providerId)`

同时修改返回值：

- `provider` 改为 `PaintingProviderContext`
- 增加 `isProviderLoading`

这里不要继续使用旧的 `Provider` 类型断言。

#### 2.3 `tokenflux/slots.tsx`

替换：

- `useAllProviders()` -> `usePaintingProvider('tokenflux')`

保留外部请求逻辑不变，只切换凭据来源。

这一步不引入 DataApi `/models`，因为 TokenFlux 模型列表不是本地业务数据。

### 阶段 3：替换 `checkProviderEnabled()` 的输入类型

文件：

- `src/renderer/src/pages/paintings/utils/index.ts`

把输入类型从 v1 `Provider` 改成绘图本地类型：

```ts
checkProviderEnabled(provider: PaintingProviderContext)
```

同时把判断逻辑改为：

- `provider.isEnabled`
- `provider.apiKey`

### 阶段 4：迁移 `provider.models` 依赖

#### 4.1 `newapi/provider.tsx`

当前问题：

- `getModels()` 使用 `type: 'dynamic'`
- resolver 直接读 `provider.models`

建议改为 DataApi 驱动的异步加载：

- `type: 'async'`
- `loader: () => dataApiService.get('/models', { query: { providerId, capability: MODEL_CAPABILITY.IMAGE_GENERATION } })`

原因：

- 这批 model 在 v2 中已经脱离 provider 内嵌数组
- `/models` 已支持 `capability` 过滤

#### 4.2 `ovms/provider.tsx`

当前问题：

- `resolver: (provider) => getOvmsModels(provider.models)`

建议同样改为 `type: 'async'`，通过 `/models?providerId=ovms` 读取后再调用 `getOvmsModels(models)`。

#### 4.3 `useModelLoader.ts`

建议同步收敛模型加载契约：

- 保留 `static`
- 保留 `async`
- 逐步淘汰绘图模块内部对 `dynamic(provider)` 的依赖

原因：

- v2 迁移后，模型来源要么是本地静态，要么是 DataApi，要么是第三方外部接口
- 再把 `provider` 整包传给 resolver，只会继续放大类型耦合

### 阶段 5：处理 `AiProvider(provider)` 和 `getProviderByModel()` 隐式 v1 依赖

这是本次迁移最容易漏掉的一层。

#### 5.1 `zhipu/generate.ts`

当前代码：

- `new AiProvider(provider).generateImage(...)`

问题：

- `AiProvider.ensureConfig()` 会从 `provider.models` 里找模型
- `PaintingProviderContext` 不会也不应该天然携带 v1 `models`

建议：

- 改成显式提供模型配置，不再依赖 `provider.models`
- 或新增绘图侧的 `toLegacyAiProvider(provider, models)` 兼容桥，只在极少数仍依赖 `AiProvider` 的路径使用

#### 5.2 `aihubmix/generate.ts`

和 `zhipu` 同类问题，尤其是 `imagen` / `gemini` 分支仍走 `AiProvider(provider).generateImage(...)`。

#### 5.3 `silicon/generate.ts`

当前问题更外扩：

- 仍调用 `getProviderByModel(model)`
- `getProviderByModel()` 读取的是 v1 store

建议将其明确列为“绘图迁移的外部依赖项”，单独拆一个小步骤处理：

- 要么新增 v2 版 `getProviderByModel` 查询能力
- 要么在绘图模块内自行按 model/provider 建立解析逻辑

在这一步没有收口前，不能宣称绘图模块已经完全脱离 v1 provider/model 体系。

## 建议实施顺序

1. 合并 PR `#14269`
2. 新增 `PaintingProviderContext` 与 `usePaintingProvider()`
3. 替换 `usePaintingWorkspace.ts`、`tokenflux/slots.tsx`、`PaintingsRoute.tsx`
4. 替换 `checkProviderEnabled()`
5. 把 `newapi`、`ovms` 的模型加载切到 `useModels` / `dataApiService.get('/models')`
6. 收口 `AiProvider(provider)` 与 `getProviderByModel()` 的残余 v1 依赖
7. 更新测试

## 受影响文件清单

### 必改

- `src/renderer/src/pages/paintings/route/PaintingsRoute.tsx`
- `src/renderer/src/pages/paintings/index.tsx`
- `src/renderer/src/pages/paintings/hooks/usePaintingProviderRuntime.ts`
- `src/renderer/src/pages/paintings/providers/tokenflux/slots.tsx`
- `src/renderer/src/pages/paintings/utils/index.ts`
- `src/renderer/src/pages/paintings/providers/newapi/provider.tsx`
- `src/renderer/src/pages/paintings/providers/ovms/provider.tsx`

### 建议新增

- `src/renderer/src/pages/paintings/model/types/paintingProvider.ts`
- `src/renderer/src/pages/paintings/hooks/usePaintingProvider.ts`

### 需要一并排期处理的外部依赖

- `src/renderer/src/pages/paintings/providers/zhipu/generate.ts`
- `src/renderer/src/pages/paintings/providers/aihubmix/generate.ts`
- `src/renderer/src/pages/paintings/providers/silicon/generate.ts`
- `src/renderer/src/aiCore/AiProvider.ts`
- `src/renderer/src/services/AssistantService.ts`

## 测试与验证要求

至少补或改以下测试：

- `src/renderer/src/pages/paintings/__tests__/PaintingsRoute.test.tsx`
- `src/renderer/src/pages/paintings/hooks/__tests__/usePaintingGenerationGuard.test.ts`
- `tokenflux` slot / service 相关测试
- `newapi`、`ovms` 模型加载测试

验收标准：

- 绘图页面不再 import `@renderer/hooks/useProvider`
- 绘图模块内部不再依赖 v1 `Provider.apiKey/apiHost/models/enabled`
- `newapi`、`ovms` 模型选项在 v2 数据下可正常加载
- `tokenflux` 外部模型列表仍可正常拉取
- `zhipu`、`aihubmix`、`silicon` 的图像生成链路不再通过 v1 store 取 provider/models

## 结论

绘图模块的 v1 -> v2 迁移不是“小改 3 个文件”。

准确范围应拆成两层：

- 第一层是显式依赖：`useAllProviders()`、`provider.apiKey/apiHost/enabled/models`
- 第二层是隐式依赖：`isNewApiProvider(provider.type)`、`AiProvider.ensureConfig(provider.models)`、`getProviderByModel()`

如果只做第一层替换，代码表面能编过，但绘图链路仍会残留 v1 依赖，后续很容易在 `zhipu`、`aihubmix`、`silicon` 或 NewAPI provider 入口处出现运行时问题。

因此，推荐按本文的分阶段方案推进，并把 `AiProvider` / `getProviderByModel` 视为绘图迁移的正式范围，而不是“后面再看”的隐性尾巴。
