# 划词与快捷助手模型导航实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在划词助手设置中展示实际生效的默认助手模型和翻译模型，并让划词助手与快捷助手能够精确跳转到全局模型设置中的对应行。

**架构：** 保留 `useDefaultModel()` 和全局 Preference 作为唯一模型来源，局部设置页只读展示并导航。`/settings/model` 通过受校验的 `focus` 查询参数定位并短暂高亮目标行；不新增 Preference、DataApi、IPC 或运行时模型解析逻辑。

**技术栈：** React 19、TypeScript、TanStack Router、i18next、`@cherrystudio/ui`、Vitest、Testing Library、Tailwind CSS。

---

## 文件结构

- 创建 `src/renderer/pages/settings/ModelSettings/modelSettingsFocus.ts`：集中定义模型设置可聚焦行及路由查询参数校验。
- 创建 `src/renderer/pages/settings/ModelSettings/__tests__/modelSettingsFocus.test.ts`：保护 `default` / `translate` 查询参数合同。
- 修改 `src/renderer/routes/settings/model.tsx`：把校验函数接入 `/settings/model`。
- 修改 `src/renderer/pages/settings/ModelSettings/ModelSettings.tsx`：读取焦点参数，滚动并短暂高亮默认或翻译模型行。
- 修改 `src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx`：保护两个聚焦目标的用户可见结果。
- 创建 `src/renderer/pages/settings/SelectionAssistantSettings/components/SelectionActionModelSettings.tsx`：展示两种有效模型和两个导航入口。
- 创建 `src/renderer/pages/settings/SelectionAssistantSettings/components/__tests__/SelectionActionModelSettings.test.tsx`：保护模型名称与精确导航目标。
- 修改 `src/renderer/pages/settings/SelectionAssistantSettings/components/SelectionActionsList.tsx`：在动作预览和列表前插入模型行。
- 修改 `src/renderer/pages/settings/QuickAssistantSettings.tsx`：默认模型模式展示当前默认模型和导航入口。
- 修改 `src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx`：保护默认模型模式与助手模式的不同入口。
- 修改 `src/renderer/i18n/locales/{de-de,el-gr,en-us,es-es,fr-fr,ja-jp,pt-pt,ro-ro,ru-ru,vi-vn,zh-cn,zh-tw}.json`：添加模型导航按钮及划词动作模型说明。

## 测试价值边界

本计划保护的具体回归：

- 链接进入模型设置后落在错误模型行，或无效查询值产生错误聚焦。
- 划词设置再次隐藏有效默认/翻译模型，或两个按钮跳往同一个错误目标。
- 快捷助手“默认模型”模式仍不显示实际模型，或助手模式错误展示全局模型入口。

明确不新增的测试：

- 不断言高亮的具体 Tailwind 类、动画时长或模型头像 DOM；这些是视觉实现细节。
- 不重复测试 `useDefaultModel()` 的 Preference 读写与翻译回退；其现有 hook 测试已覆盖模型解析职责，新增组件只消费有效模型对象。
- 不测试搜索、复制、引用是否调用模型；本次不修改动作执行链。
- 不新增 E2E；组件导航和路由聚焦是同一 renderer 内的行为，组件测试加真实 Electron 交互验证已是最低充分层级。

### 任务 1：模型设置精确聚焦路由

**文件：**

- 创建：`src/renderer/pages/settings/ModelSettings/modelSettingsFocus.ts`
- 创建：`src/renderer/pages/settings/ModelSettings/__tests__/modelSettingsFocus.test.ts`
- 修改：`src/renderer/routes/settings/model.tsx`
- 修改：`src/renderer/pages/settings/ModelSettings/ModelSettings.tsx`
- 测试：`src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx`

- [ ] **步骤 1：先写查询参数合同的失败测试**

```ts
import { describe, expect, it } from 'vitest'

import { validateModelSettingsSearch } from '../modelSettingsFocus'

describe('validateModelSettingsSearch', () => {
  it.each(['default', 'translate'] as const)('accepts the %s model row', (focus) => {
    expect(validateModelSettingsSearch({ focus })).toEqual({ focus })
  })

  it.each([{ focus: 'quick' }, { focus: 1 }, {}])('drops an unsupported focus value', (search) => {
    expect(validateModelSettingsSearch(search)).toEqual({})
  })
})
```

- [ ] **步骤 2：运行测试，确认因模块尚不存在而失败**

运行：

```bash
pnpm test src/renderer/pages/settings/ModelSettings/__tests__/modelSettingsFocus.test.ts
```

预期：FAIL，Vitest 报告无法解析 `../modelSettingsFocus`。

- [ ] **步骤 3：实现最小查询参数校验，并接入路由**

`modelSettingsFocus.ts`：

```ts
export type ModelSettingsFocus = 'default' | 'translate'

export type ModelSettingsSearch = {
  focus?: ModelSettingsFocus
}

export function validateModelSettingsSearch(search: Record<string, unknown>): ModelSettingsSearch {
  return search.focus === 'default' || search.focus === 'translate' ? { focus: search.focus } : {}
}
```

`routes/settings/model.tsx`：

```tsx
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { validateModelSettingsSearch } from '@renderer/pages/settings/ModelSettings/modelSettingsFocus'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/model')({
  component: ModelSettings,
  validateSearch: validateModelSettingsSearch
})
```

- [ ] **步骤 4：运行查询参数测试，确认转绿**

运行：

```bash
pnpm test src/renderer/pages/settings/ModelSettings/__tests__/modelSettingsFocus.test.ts
```

预期：PASS，5 个参数样例全部通过。

- [ ] **步骤 5：先在 ModelSettings 现有测试中加入聚焦行为测试**

在测试 harness 中加入可变路由搜索值、`scrollIntoView` 和 timer hook 模拟：

```ts
const routerSearch = vi.hoisted(() => ({ current: {} as { focus?: string } }))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => routerSearch.current
}))

Element.prototype.scrollIntoView = vi.fn()

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))
```

在 `beforeEach` 中重置 `routerSearch.current = {}`，再添加：

```tsx
it.each([
  ['default', 'settings.models.default_assistant_model'],
  ['translate', 'settings.models.translate_model']
] as const)('focuses the %s model row requested by the route', (focus, expectedTitle) => {
  routerSearch.current = { focus }

  const { container } = render(<ModelSettings showPaintingModel={false} showSettingsButton={false} />)

  const focusedRows = container.querySelectorAll('[data-focused]')
  expect(focusedRows).toHaveLength(1)
  expect(focusedRows[0]).toHaveTextContent(expectedTitle)
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
})
```

- [ ] **步骤 6：运行 ModelSettings 测试，确认聚焦测试正确失败**

运行：

```bash
pnpm test src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx
```

预期：FAIL，新用例找不到 `[data-focused]`。

- [ ] **步骤 7：实现滚动和短暂高亮**

在 `ModelSettings.tsx` 中：

- 用 `useSearch({ strict: false })` 读取查询值，并再次通过 `validateModelSettingsSearch` 收窄类型。
- 为默认和翻译模型行各持有一个 `useRef<HTMLDivElement | null>`。
- 用现有 `scrollIntoView()` 与 `useTimer()` 在目标变化时滚动；2 秒后只移除视觉高亮，保留 `data-focused` 作为稳定焦点标记。
- 扩展私有 `ModelSettingRow` 参数为 `rowRef?: Ref<HTMLDivElement>`、`focused?: boolean`、`focusFaded?: boolean`。用一个私有外层 `div` 承载 ref、`data-focused` 和短暂样式，内部继续使用现有 `SettingRow`；不要为了本页需求扩展共享 `SettingRow` API：

```tsx
const ModelSettingRow: FC<ModelSettingRowProps> = ({
  icon,
  title,
  description,
  compact,
  children,
  rowRef,
  focused,
  focusFaded
}) => (
  <div
    ref={rowRef}
    data-focused={focused || undefined}
    className={cn(focused && !focusFaded && '-mx-2 rounded-md bg-primary/10 px-2 ring-1 ring-primary/40')}>
    <SettingRow className={cn(compact ? 'flex-col items-stretch gap-3 py-1' : 'items-start gap-6 py-1.5')}>
      <div className="min-w-0 flex-1">
        <SettingRowTitle className="gap-2">
          {icon}
          {title}
        </SettingRowTitle>
        {description && <SettingDescription className="mt-1.5 leading-5">{description}</SettingDescription>}
      </div>
      <div className={compact ? 'flex w-full items-center gap-2' : 'flex w-[340px] shrink-0 items-center gap-2'}>
        {children}
      </div>
    </SettingRow>
  </div>
)
```

核心 effect：

```tsx
const { focus } = validateModelSettingsSearch(useSearch({ strict: false }) as Record<string, unknown>)
const defaultRowRef = useRef<HTMLDivElement | null>(null)
const translateRowRef = useRef<HTMLDivElement | null>(null)
const [focusFaded, setFocusFaded] = useState(false)
const { setTimeoutTimer } = useTimer()

useEffect(() => {
  if (compact || !focus) return
  const target = focus === 'default' ? defaultRowRef.current : translateRowRef.current
  if (!target) return
  scrollIntoView(target)
  setFocusFaded(false)
  setTimeoutTimer('model-settings-focus-fade', () => setFocusFaded(true), 2000)
}, [compact, focus, setTimeoutTimer])
```

只给默认和翻译行传入各自的 `rowRef`、`focused` 和 `focusFaded`。

- [ ] **步骤 8：运行聚焦与现有模型设置测试，确认转绿**

运行：

```bash
pnpm test src/renderer/pages/settings/ModelSettings/__tests__/modelSettingsFocus.test.ts src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx
```

预期：PASS，原有模型选择与重试测试仍通过。

- [ ] **步骤 9：提交聚焦路由变更**

```bash
git add src/renderer/routes/settings/model.tsx src/renderer/pages/settings/ModelSettings
git commit -S --signoff -m "feat(model-settings): support focused model navigation"
```

### 任务 2：划词动作模型展示和导航

**文件：**

- 创建：`src/renderer/pages/settings/SelectionAssistantSettings/components/SelectionActionModelSettings.tsx`
- 创建：`src/renderer/pages/settings/SelectionAssistantSettings/components/__tests__/SelectionActionModelSettings.test.tsx`
- 修改：`src/renderer/pages/settings/SelectionAssistantSettings/components/SelectionActionsList.tsx`
- 修改：全部 12 个 `src/renderer/i18n/locales/*.json`

- [ ] **步骤 1：先写划词模型行的失败组件测试**

测试使用真实组件，只模拟模型 hook、路由导航、主题外观依赖和头像叶子。定义两个模型：

```ts
const modelState = vi.hoisted(() => ({
  defaultModel: { id: 'openai::gpt-4o', providerId: 'openai', name: 'GPT-4o' } as Model,
  translateModel: { id: 'deepseek::deepseek-chat', providerId: 'deepseek', name: 'DeepSeek Chat' } as Model
}))
const navigateMock = vi.hoisted(() => vi.fn())
```

添加三个用户行为用例：

```tsx
it('shows the effective default and translation models', () => {
  render(<SelectionActionModelSettings />)
  expect(screen.getByText('GPT-4o')).toBeInTheDocument()
  expect(screen.getByText('DeepSeek Chat')).toBeInTheDocument()
})

it.each([
  ['settings.models.default_assistant_model', 'default'],
  ['settings.models.translate_model', 'translate']
] as const)('opens the focused model setting from %s', async (rowName, focus) => {
  const user = userEvent.setup()
  render(<SelectionActionModelSettings />)

  const row = screen.getByRole('group', { name: rowName })
  await user.click(within(row).getByRole('button', { name: 'navigate.model_settings' }))

  expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/model', search: { focus } })
})
```

- [ ] **步骤 2：运行测试，确认因组件尚不存在而失败**

运行：

```bash
pnpm test src/renderer/pages/settings/SelectionAssistantSettings/components/__tests__/SelectionActionModelSettings.test.tsx
```

预期：FAIL，Vitest 报告无法解析 `SelectionActionModelSettings`。

- [ ] **步骤 3：实现最小的两行只读模型组件**

组件必须：

- 读取 `useDefaultModel()` 返回的有效 `defaultModel` 和 `translateModel`，不读取原始 Preference ID。
- 使用 `SettingRow`、`SettingRowTitle`、`SettingDescription`、`SettingDivider` 与 `@cherrystudio/ui` 的 `Button`。
- 每行设置 `role="group"` 和由 `useId()` 生成的 `aria-labelledby`，让两个同名导航按钮在语义上分别归属于对应模型行。
- 模型存在时显示 `ModelAvatar` 和可截断模型名；不存在时显示 `t('settings.models.empty')`。
- 导航按钮采用网络搜索现有模式：`variant="outline"`、`size="sm"`、`ArrowRight size={13}` 和 `t('navigate.model_settings')`。
- 默认行导航到 `{ to: '/settings/model', search: { focus: 'default' } }`；翻译行使用 `focus: 'translate'`。

私有行组件签名固定为：

```tsx
interface ModelNavigationRowProps {
  description: string
  model: Model | undefined
  onNavigate: () => void
  title: string
}
```

翻译说明必须明确语言自动识别可能额外使用快速模型；不新增第三行快速模型。

- [ ] **步骤 4：把组件插入动作卡片顶部**

在 `SelectionActionsList.tsx` 的标题分隔线之后、工具栏预览之前加入：

```tsx
<SelectionActionModelSettings />
```

`SelectionActionModelSettings` 自己在第二行之后输出 `SettingDivider`，保持标题、模型行和工具栏预览之间的现有分隔节奏。

- [ ] **步骤 5：添加并同步 i18n 文案**

新增键：

```json
{
  "navigate": {
    "model_settings": "Go to model settings"
  },
  "selection": {
    "settings": {
      "actions": {
        "models": {
          "default_description": "Used by Explain, Summarize, Refine, and custom actions that use the default model.",
          "translate_description": "Used to generate translations. Automatic language detection may also use the quick model."
        }
      }
    }
  }
}
```

运行 `pnpm i18n:sync` 后，按下表替换每个目录中的占位符：

| locale | `navigate.model_settings` | `default_description` | `translate_description` |
|---|---|---|---|
| de-de | Zu den Modelleinstellungen | Wird für „Erklären“, „Zusammenfassen“, „Überarbeiten“ und benutzerdefinierte Aktionen verwendet, die das Standardmodell nutzen. | Wird zum Erstellen von Übersetzungen verwendet. Die automatische Spracherkennung kann zusätzlich das Schnellmodell verwenden. |
| el-gr | Μετάβαση στις ρυθμίσεις μοντέλου | Χρησιμοποιείται από τις ενέργειες Επεξήγηση, Σύνοψη, Βελτίωση και τις προσαρμοσμένες ενέργειες που χρησιμοποιούν το προεπιλεγμένο μοντέλο. | Χρησιμοποιείται για τη δημιουργία μεταφράσεων. Η αυτόματη ανίχνευση γλώσσας μπορεί επίσης να χρησιμοποιήσει το γρήγορο μοντέλο. |
| en-us | Go to model settings | Used by Explain, Summarize, Refine, and custom actions that use the default model. | Used to generate translations. Automatic language detection may also use the quick model. |
| es-es | Ir a la configuración de modelos | Se usa en Explicar, Resumir, Mejorar y en las acciones personalizadas que utilizan el modelo predeterminado. | Se usa para generar traducciones. La detección automática del idioma también puede usar el modelo rápido. |
| fr-fr | Accéder aux paramètres des modèles | Utilisé par Expliquer, Résumer, Améliorer et les actions personnalisées configurées pour utiliser le modèle par défaut. | Utilisé pour générer les traductions. La détection automatique de la langue peut également utiliser le modèle rapide. |
| ja-jp | モデル設定へ移動 | 「説明」「要約」「推敲」、およびデフォルトモデルを使用するカスタムアクションで使用されます。 | 翻訳の生成に使用されます。言語の自動検出では高速モデルも使用される場合があります。 |
| pt-pt | Ir para as definições de modelos | Utilizado por Explicar, Resumir, Melhorar e por ações personalizadas que usam o modelo predefinido. | Utilizado para gerar traduções. A deteção automática do idioma também pode utilizar o modelo rápido. |
| ro-ro | Accesează setările modelelor | Folosit de acțiunile Explică, Rezumă, Îmbunătățește și de acțiunile personalizate care utilizează modelul implicit. | Folosit pentru generarea traducerilor. Detectarea automată a limbii poate utiliza și modelul rapid. |
| ru-ru | Перейти к настройкам моделей | Используется для действий «Объяснить», «Суммировать», «Улучшить» и пользовательских действий, использующих модель по умолчанию. | Используется для перевода. Автоматическое определение языка также может использовать быструю модель. |
| vi-vn | Đi tới cài đặt mô hình | Được dùng cho các thao tác Giải thích, Tóm tắt, Trau chuốt và thao tác tùy chỉnh sử dụng mô hình mặc định. | Được dùng để tạo bản dịch. Tính năng tự động nhận diện ngôn ngữ cũng có thể sử dụng mô hình nhanh. |
| zh-cn | 前往模型设置 | 用于解释、总结、润色，以及使用默认模型的自定义功能。 | 用于生成翻译结果；自动语言检测也可能使用快速模型。 |
| zh-tw | 前往模型設定 | 用於「解釋」、「總結」、「潤飾」及使用預設模型的自訂功能。 | 用於產生翻譯結果；自動語言偵測也可能使用快速模型。 |

- [ ] **步骤 6：运行划词组件测试和 i18n 检查，确认转绿**

运行：

```bash
pnpm test src/renderer/pages/settings/SelectionAssistantSettings/components/__tests__/SelectionActionModelSettings.test.tsx
pnpm i18n:check
```

预期：组件测试 PASS；目录结构、排序、插值与翻译值检查全部通过且没有 `[to be translated]`。

- [ ] **步骤 7：提交划词模型入口**

```bash
git add src/renderer/pages/settings/SelectionAssistantSettings src/renderer/i18n/locales
git commit -S --signoff -m "feat(selection-assistant): show action models"
```

### 任务 3：快捷助手默认模型入口

**文件：**

- 修改：`src/renderer/pages/settings/QuickAssistantSettings.tsx`
- 测试：`src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx`

- [ ] **步骤 1：先写默认模型模式的失败测试**

把测试中的 `useDefaultModel` mock 改为可变的 `modelState.defaultModel`，新增 `navigateMock` 和 `useNavigate` mock。添加：

```tsx
it('shows the default model and opens its global model setting in default-model mode', async () => {
  const user = userEvent.setup()
  MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', '')
  modelState.defaultModel = {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o'
  } as Model

  render(<QuickAssistantSettings />)

  expect(screen.getByText('GPT-4o')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'navigate.model_settings' }))
  expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/model', search: { focus: 'default' } })
})

it('keeps global model navigation out of assistant mode', () => {
  MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', 'assistant-1')

  render(<QuickAssistantSettings />)

  expect(screen.queryByRole('button', { name: 'navigate.model_settings' })).not.toBeInTheDocument()
})
```

- [ ] **步骤 2：运行快捷助手测试，确认第一条因入口缺失而失败**

运行：

```bash
pnpm test src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
```

预期：FAIL，默认模型模式找不到 `GPT-4o` 或模型设置按钮；助手模式用例通过。

- [ ] **步骤 3：实现默认模型只读展示和跳转**

在 `QuickAssistantSettings.tsx`：

- 添加 `useNavigate()` 和 `ArrowRight`。
- 在右侧 `RowFlex` 内、助手选择器之前，仅当 `!isAssistantMode` 时显示一个紧凑区域。
- 模型存在时显示 `ModelAvatar` 和可截断名称；不存在时显示 `t('settings.models.empty')`。
- 添加 `variant="outline"`、`size="sm"` 的按钮，内容为 `ArrowRight size={13}` 与 `t('navigate.model_settings')`。
- 点击调用：

```ts
void navigate({ to: '/settings/model', search: { focus: 'default' } })
```

- 助手模式保持现有助手下拉框，不显示全局模型按钮。

- [ ] **步骤 4：运行快捷助手测试，确认转绿**

运行：

```bash
pnpm test src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
```

预期：PASS，现有助手删除、加载和切换测试保持通过，新用例验证两种模式的差异。

- [ ] **步骤 5：提交快捷助手入口**

```bash
git add src/renderer/pages/settings/QuickAssistantSettings.tsx src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
git commit -S --signoff -m "feat(quick-assistant): link default model settings"
```

### 任务 4：集成验证和真实 Electron UX 检查

**文件：**

- 验证：本计划涉及的全部代码和 locale 文件

- [ ] **步骤 1：运行全部相关测试**

```bash
pnpm test \
  src/renderer/pages/settings/ModelSettings/__tests__/modelSettingsFocus.test.ts \
  src/renderer/pages/settings/ModelSettings/__tests__/ModelSettings.test.tsx \
  src/renderer/pages/settings/SelectionAssistantSettings/components/__tests__/SelectionActionModelSettings.test.tsx \
  src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx
```

预期：全部 PASS，无 React act warning、未处理 Promise 或控制台错误。

- [ ] **步骤 2：运行仓库规定的窄范围完整门禁**

```bash
pnpm lint
pnpm i18n:hardcoded:strict
git diff --check origin/main...HEAD
```

预期：lint（含格式、类型和 i18n）通过；没有新增硬编码 UI 文案；diff 无空白错误。

- [ ] **步骤 3：按 cherry-electron-dev 的 persistent 流程复用或启动跟踪实例**

先完整读取 `.agents/skills/cherry-electron-dev/references/electron-instance.md`，再按其中的 `persistent` 策略发现实例。不要关闭健康的用户实例，也不要用通用 Electron 启动命令绕过跟踪文件。

- [ ] **步骤 4：在真实窗口验证划词助手设置**

验证：

- “功能”卡片标题下、工具栏预览前出现默认助手模型和翻译模型两行。
- 当前模型名称与全局模型设置一致；空模型显示已有空状态文案。
- 两个按钮分别进入 `/settings/model?focus=default` 和 `/settings/model?focus=translate`。
- 到达后对应行进入视口并短暂高亮；约 2 秒后只淡出高亮，不改变页面滚动位置。
- 在真实窗口宽度及浅色/深色主题下，模型名可以截断，按钮和行不溢出卡片。

- [ ] **步骤 5：在真实窗口验证快捷助手设置**

验证：

- “默认模型”模式显示当前默认助手模型和模型设置按钮，按钮聚焦默认模型行。
- “使用助手”模式显示原有助手选择器，隐藏全局模型按钮。
- 模式切换和助手选择仍正常，预览窗口布局无跳动或溢出。

- [ ] **步骤 6：执行分支级自审**

读取并执行 `cherry-change-verification`，检查与 `origin/main` 的提交和 diff；确认所有 commit 都有 `gpgsig` 和 `Signed-off-by`，并记录跟踪实例 PID、CDP 端口、`instance.json` 路径及验证证据。

- [ ] **步骤 7：若最终验证产生修复，提交最小修正**

只有存在真实问题时才创建提交：

```bash
git add \
  src/renderer/routes/settings/model.tsx \
  src/renderer/pages/settings/ModelSettings \
  src/renderer/pages/settings/SelectionAssistantSettings \
  src/renderer/pages/settings/QuickAssistantSettings.tsx \
  src/renderer/pages/settings/__tests__/QuickAssistantSettings.test.tsx \
  src/renderer/i18n/locales
git commit -S --signoff -m "fix(selection-assistant): refine model navigation ux"
```

预期：没有问题时不创建空提交。
