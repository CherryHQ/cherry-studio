# T-008B 方案 B 最小实现可行性评估

> 任务来自 D-003C / 用户对方案 B "Chat 模型选择器迁 v2" 的最小成本核实需求。
> 本轮**只诊断 + 写方案**，不动业务代码。

## TL;DR — 比 T-008 诊断时估的小得多

T-008 诊断曾写 "方案 B 约 100–200 行 + 测试重写 + 影响 Chat 主链路"。深入后发现：

- 仓库里已经有现成的 v1↔v2 **模型适配器**（`utils/v1ProviderShim.ts` 的 `toV1ProviderShim` + `toV1ModelShim`）
- 它们正好就是 "保留 v1 下游形状但喂 v2 数据" 的桥
- 把这两个 shim 套在 `chat-model-popup.tsx` 的入口，就能让 **picker 输出 v1 形状的 Model**（id 是 raw `'qwen2.5:7b'`，不是 `'ollama::qwen2.5:7b'`），全部下游零改动

**最小 Plan B = 改 1 个文件 + 重写 1 个测试**，~50 行 src + ~50 行测试。**比方案 A（v2→v1 dispatch 桥）更干净**，因为 A 是双写两个 store；B 是单一数据源（v2）+ 单一适配层（picker 出口）。

**结论**：建议现在直接做方案 B，**跳过方案 A**。

---

## 1. Chat 顶栏 picker 的实际组件链

| 层 | 文件 | 角色 |
|---|---|---|
| 入口按钮（活跃 assistant，顶栏左上）| `pages/home/components/SelectModelButton.tsx:28–41` | 调 `SelectChatModelPopup.show(...)`, 把结果传给 `useAssistant(id).updateAssistant({ model })` |
| 通用按钮（mention / 任意场景）| `components/ModelSelectButton.tsx:17–24` | 调 `SelectChatModelPopup.show(...)`，把结果传给 `onSelectModel` callback |
| Assistant 模型选择（Default Assistant 设置 + 其他 assistant 设置面板）| `pages/home/AssistantSettings/AssistantModelSettings.tsx:222–240` | 同上，写 `updateAssistant({ model, defaultModel })` |
| Chat.tsx 主页面 | `pages/home/Chat.tsx:91–92` | `modelFilter = (m) => !isEmbeddingModel(m) && !isRerankModel(m)` |
| Message → 引用同消息追问 | `pages/home/Messages/MessageMenubar.tsx:553` | `appendAssistantResponse(message, selectedModel, { ...assistant, model: selectedModel })` |
| 库编辑器 assistant prompt 区 | `pages/library/editor/assistant/sections/PromptSection.tsx` | 同 picker |
| **Default Assistant 设置弹窗（`/settings/model/default-assistant`）**| `pages/settings/ModelSettings/DefaultAssistantSettings.tsx` | **没有 SelectModelPopup 入口**（只放 prompt / temperature 等）—— Default Assistant 的模型切换实际走的是上面的「顶栏按钮 → updateAssistant」路径 |

| 弹窗本体 | 文件 | 角色 |
|---|---|---|
| 容器 + 数据源 | `components/Popups/SelectModelPopup/chat-model-popup.tsx:18–42` | **唯一与 v1 Redux 直接耦合的点** —— `useProviders` (singular = v1) + `provider.models` 直读 |
| 视觉层（搜索框、列表、置顶分组等）| `components/Popups/SelectModelPopup/base-popup.tsx` | 接收 `providers: Provider[]`（v1 shape），按 `provider.models` 迭代 |
| 搜索栏 / 标签筛 | `searchbar.tsx`、`TagFilterSection.tsx`、`filters.ts` | 无 v1/v2 直接依赖；接收 v1-shape model 即可 |

## 2. 现成可复用的 v2 模型选择器

仓库里 **已经** 有 v2-aligned 的 `components/ModelSelector/`：

- `useModelSelectorData.ts:1–7` 用 `useModels` + `useProviders`（v2 plural hook）
- 被 `ModelSettings` / `Translate` / `OpenClaw` / `Library` 在用
- 视觉层是另一套（不是 Radix Popover / antd Modal，是 Tailwind shadcn 风）

**但 v2 ModelSelector ≠ Chat 顶栏 picker UI**：两套视觉层、两套 keybindings、两套 pin 处理逻辑。要复用 ModelSelector 完整 UI = 大重构。

**推荐路径 = 只复用 v2 数据 hooks，不动 picker UI**。即：在 `chat-model-popup.tsx` 内部把 `useProviders` (v1) 换成 `useProviders` (v2 plural) + `useModels()`，用现有 shim 转回 v1 shape，喂给 base-popup —— **零 UI 改动**。

## 3. v2 Model id 是否会再次踩 message.modelId FK？

不会。已被 T-005B 防御。

`StreamingService.createAssistantMessage`（fix 在 commit `15ad2eb08`）：

```ts
const safeModelId = isUniqueModelId(modelId) ? modelId : undefined
```

- 如果上游传**raw v1 id**（如 `'qwen-plus'`）→ 不是 UniqueModelId → 写 `null`（**当前行为**）
- 如果上游传**v2 UniqueModelId**（如 `'dashscope::qwen-plus'`）→ 通过 → 写真实值（**FK 实际能 join 上 `user_model` 行**）

**关键决策**：选择 picker 输出哪种形状决定写入 DB 的是 null 还是 UniqueModelId：

- **方案 B.1（保守 / 推荐）**：picker 输出 v1 shape（id = raw `'qwen2.5:7b'`），写入仍是 `modelId=null`，**与当前同等行为**，无 FK 风险，但牺牲 model 与 message 的可联表
- **方案 B.2（激进）**：picker 输出 v2 shape（id = `'ollama::qwen2.5:7b'`），写入 modelId 是 UniqueModelId，FK 第一次真正生效；但下游所有 `model.provider`/`model.endpoint_type`/`isEmbeddingModel` 等 v1 字段读取要么全改要么全套 shim

**推荐 B.1**。FK 联表是 v2 完整迁移的后续收益，不必这一轮硬上 —— 让 picker 解锁 Ollama 显示是当下的明确目标。B.2 留作未来 task。

## 4. 能否只改 picker 数据源、不改模型调用链？

**能**。

下游 `assistant.model`/`sendMessage`/`messageThunk` 链路 grep 结果（关键点）：

| 点 | 代码 | 期望的字段形状 |
|---|---|---|
| `messageThunk.ts:638,901,1062,1266` | `modelId: assistant.model?.id` | 字符串 id；shim 输出 raw id 即可 |
| `messageThunk.ts:802` | `modelId: mentionedModel.id` | 同上 |
| `MessagesService.ts:164,184,202` | `modelId: model?.id` | 同上 |
| `useProvider(model.provider)`（SelectModelButton 等）| 读 v1 `model.provider` | shim 输出有 `provider` 字段 |
| `isEmbeddingModel`/`isRerankModel`/`isWebSearchModel`/`isVisionModel` | 读 `model.id`, `model.provider`, `model.endpoint_type` | shim 全部保留 |
| StreamingService.createAssistantMessage | `isUniqueModelId(modelId) ? modelId : undefined` | raw id → null（当前行为）|

shim 输出形状（`v1ProviderShim.ts:87–100` 已有）：

```ts
{
  id: apiId,                          // 'qwen2.5:7b'（不是 'ollama::qwen2.5:7b'）
  provider: v2.providerId,            // 'ollama'
  name: v2.name,
  group: v2.group ?? '',
  owned_by: v2.ownedBy,
  description: v2.description,
  endpoint_type: v2.endpointTypes?.[0],
  supported_endpoint_types: v2.endpointTypes
}
```

下游读什么 → shim 都给。**链路零改动**。

## 5. 方案 B 最小文件清单

### 改动（src）

| 文件 | 行数估计 | 改什么 |
|---|---|---|
| `src/renderer/src/components/Popups/SelectModelPopup/chat-model-popup.tsx` | 净 +30 / -15（~45 行 diff） | 数据源换 v2 + 用 shim 转 v1 + 保留 CHERRYAI fallback |

### 改动（测试）

| 文件 | 行数估计 | 改什么 |
|---|---|---|
| `src/renderer/src/components/Popups/SelectModelPopup/__tests__/chat-model-popup.test.tsx`（如不存在则不改）| ~50 行 | mock `useProviders`(v2) + `useModels`(v2)；assert picker shows ollama 模型 |

### 不动

- `base-popup.tsx`、`searchbar.tsx`、`TagFilterSection.tsx`、`filters.ts`（视觉层，接收 v1-shape Provider/Model）
- 所有 picker 调用方（`SelectModelButton.tsx`、`ModelSelectButton.tsx`、`AssistantModelSettings.tsx`、`Chat.tsx`、`MessageMenubar.tsx`、`PromptSection.tsx`）
- `messageThunk.ts`、`MessagesService.ts`、`StreamingService.ts`、`AssistantService.ts`
- `useAssistant.ts`、`useProvider.ts`（v1 hook，仍被其它路径用，本次不动）
- 所有 `isEmbeddingModel`/`isVisionModel` 等 filter helpers
- v1 Redux schema、initialState、SYSTEM_PROVIDERS_CONFIG
- v2 DataApi / Provider 设置页

## 6. 实施草稿（仅供参考，本轮不写代码）

```tsx
// chat-model-popup.tsx 新版本骨架
import { useProviders } from '@renderer/hooks/useProviders'             // ← v2 plural
import { useModels } from '@renderer/hooks/useModels'                   // ← v2
import { toV1ProviderShim, toV1ModelShim }
  from '@renderer/pages/settings/ProviderSettings/utils/v1ProviderShim'
import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import type { Model, Provider } from '@renderer/types'                  // ← v1 type，输出契约
import { groupBy, sortBy } from 'lodash'

const PopupContainer: React.FC<Props> = ({ model, filter, showTagFilter = true, resolve }) => {
  const { providers: v2Providers } = useProviders()                     // v2 DataApi
  const { models: v2Models } = useModels()                              // v2 DataApi all models

  const filteredProviders = useMemo<Provider[]>(() => {
    const modelsByProvider = groupBy(v2Models, 'providerId')

    const v1Providers: Provider[] = v2Providers
      .filter((p) => p.isEnabled)
      .map((v2p) => {
        const shimProvider = toV1ProviderShim(v2p)
        const v2ModelsForProvider = modelsByProvider[v2p.id] ?? []
        const v1Models = v2ModelsForProvider
          .filter((m) => m.isEnabled && !m.isHidden)
          .map(toV1ModelShim)
        return { ...shimProvider, models: filter ? v1Models.filter(filter) : v1Models }
      })
      .filter((p) => p.models.length > 0)

    // 保留 CherryAI 试用 qwen 直到 v2 user_model 真有 cherryai 行
    const v1WithFallback = v1Providers.some((p) => p.id === 'cherryai')
      ? v1Providers
      : [...v1Providers, CHERRYAI_PROVIDER].filter((p) => p.models.length > 0)

    // v2 providers 自带 position 排序；CherryAI 永远靠后
    return v1WithFallback
  }, [v2Providers, v2Models, filter])

  return (
    <SelectModelPopupView
      providers={filteredProviders}
      model={model}
      showTagFilter={showTagFilter}
      showPinnedModels={true}
      resolve={resolve}
    />
  )
}
```

约 30 行（除去 import）。

## 7. 改动风险逐条评估

| 风险 | 程度 | 解释 / 缓解 |
|---|---|---|
| **CherryAI Qwen 消失** | 🟡 中 | v2 catalog 0 cherryai models（grep `cherryai` provider-models.json / models.json = 0）；fresh install 无 user 写入 cherryai → picker 空。**缓解**：示意代码里保留 `CHERRYAI_PROVIDER` fallback，等 v2 cherryai 真有内容再去掉 |
| **modelId FK 重新触发** | 🟢 低 | shim 输出 raw id；T-005B 的 `isUniqueModelId` 守卫现在仍 fallback 到 null —— 与当前完全等价行为，无新增 FK 风险 |
| **provider 排序变化** | 🟢 低 | v2 `/providers` 按 `position` 排；v1 是 Redux 数组顺序。两者在 fresh install 上接近一致；用户可在 v2 ProviderSettings 拖拽调整 |
| **置顶模型 pin 失效** | 🟢 低 | `usePinnedModels` + `getModelUniqId({id, provider})` 用 v1-shape key；shim 输出含两个字段 → 与现有 pin 键完全兼容 |
| **filter helpers 误判** | 🟢 低 | `isEmbeddingModel` 等读 v1 字段；shim 全部保留；与改前同 |
| **Mention `appendAssistantResponse(message, selectedModel, {...assistant, model: selectedModel})`** | 🟢 低 | selectedModel 是 shim 出的 v1-shape，与之前完全一致 |
| **v2 useModels() 性能 / 首次加载** | 🟢 低 | SWR 缓存 + DataApi 是现成路径；Provider 设置页已经在用，性能验证过 |
| **测试覆盖** | 🟡 中 | 现有 chat-model-popup 测试（如果有）要重写 mock；mock v2 hooks 比 mock Redux selectors 略繁琐但 Settings 页测试有现成模板可抄 |
| **`useDefaultModel`/`state.llm.defaultModel`** | 🟢 低 | 不动 Redux defaultModel；picker 输出 v1 shape 写回 `assistant.model` 完全兼容 |
| **agent / mini-app 等其它 picker 入口**| 🟢 低 | `agent-model-popup.tsx` 与本次不同弹窗；不受影响 |

## 8. 是否建议现在实施

**建议现在实施方案 B**，理由：

1. **改动比方案 A 还小** —— A 要在 sync hook 里反向 dispatch + 注意去重 + 处理 Provider 创建/更新 + 处理删除时反向；B 只改 picker 一个文件
2. **方案 A 是双写脏数据（v2 → v1 mirror），方案 B 是单一数据源**；v2 迁移大方向上 B 不留技术债，A 留
3. **风险都已识别，全部 🟢/🟡**，无 🔴
4. **已经有现成 shim 工具可复用**（`toV1ProviderShim`、`toV1ModelShim`），不需要自己写
5. **不影响 T-006 Text Anchor**（picker 是独立组件树）

唯一需要确认的是 **CHERRYAI fallback 怎么处理**：

- **A. 保留硬编码 CHERRYAI_PROVIDER 直到 v2 cherryai 有内容**（picker 内部 fallback）— 推荐
- **B. 删 CHERRYAI 硬编码，让 v2 cherryai 空就空**（用户必须手动添加 API key 才显示）
- **C. 把 qwenModel 在 v2 catalog 里也 seed 进去**（独立 task，超出 B 范围）

## 9. 如果不实施 B，方案 A 还做不做？

**如果决定方案 B 当下不做，那才回到方案 A**：

- 方案 A 改动面：~30 行 hook（`useProviderModelSync` 成功回调里反向 dispatch v1 `addProvider`/`updateProvider({enabled:true})` + 逐个 `addModel`）
- 缺点：双写两个 store，未来 v2 迁移完成后要拆掉
- 优点：picker 内部完全不动

**结论**：A 和 B 改动量都在 30–50 行左右，但 B **没有双写技术债**。**不建议走 A**。

## 10. 不在范围（无论 A/B）

- 删除 v1 Redux `state.llm.providers` / `useProvider` singular hook（v2 迁移末期清理）
- 把 CherryAI Qwen demo 写入 v2 catalog（独立数据 task）
- 迁移 `useDefaultModel`/`state.llm.defaultModel` 到 v2 preference（独立 task）
- 迁移 base-popup 视觉层到 v2 ModelSelector 风格（独立 task）
- 处理老用户 v1 Redux 与新 v2 user_model 之间的迁移路径
