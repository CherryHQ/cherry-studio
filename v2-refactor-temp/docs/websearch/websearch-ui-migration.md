# WebSearch UI 迁移计划

## 概述

WebSearch Settings UI 迁移分为三个阶段：

1. **第一阶段**: 数据层迁移 (Redux → Preference API) ✅ 已完成
2. **第二阶段**: UI 组件库迁移 (antd → CherryUI + Tailwind) ✅ 已完成
3. **第三阶段**: Setting 组件迁移 (styled-components → Tailwind) ⏳ 待开始

**迁移范围**：
- 保留功能：使用新 hooks
- 废弃功能：移除 UI

---

## 数据迁移对照表

| 原功能 | 状态 | 新实现 |
|--------|------|--------|
| `providers` 列表 | 保留 | `useWebSearchProviders()` |
| 单个 provider 读写 | 保留 | `useWebSearchProvider(id)` |
| `searchWithTime` | 保留 | `useWebSearchSettings().setSearchWithTime` |
| `maxResults` | 保留 | `useWebSearchSettings().setMaxResults` |
| `excludeDomains` | 保留 | `useWebSearchSettings().setExcludeDomains` |
| `compression` | 保留 | `useWebSearchCompression()` / `useWebSearchSettings()` |
| `defaultProvider` | 废弃 | 移除 UI |
| `subscribeSources` | 废弃 | 移除 UI |

---

## 类型变更

新的 Preference 返回的 provider 类型与旧 Redux 类型不同：

| 字段 | 旧类型 (Redux) | 新类型 (Preference) |
|------|---------------|-----------------|
| `provider.id` | `WebSearchProviderId` (字面量联合) | `string` |

**影响**：需要将使用 `WebSearchProviderId` 作为参数的函数改为接受 `string` 类型。

类型定义来自 `@shared/data/preference/preferenceTypes`。

---

## 组件修改清单

### 1. `index.tsx` (WebSearchSettings 主容器) ✅ 已完成

**文件**: `src/renderer/src/pages/settings/WebSearchSettings/index.tsx`

| 修改项 | 说明 |
|--------|------|
| import 修改 | `useWebSearchProviders` 改为从 `@renderer/hooks/useWebSearch` 导入 |
| 移除 import | `useDefaultWebSearchProvider`, `Tag`, `WebSearchProviderId` |
| 移除调用 | `useDefaultWebSearchProvider()` |
| 移除变量 | `isDefault` (两处) |
| 移除属性 | `rightContent` (两处 ListItem) |
| 类型修改 | `getProviderLogo(providerId: WebSearchProviderId)` → `getProviderLogo(providerId: string)` |

**移除内容**:
- 侧边栏 "默认" Tag 标签显示

---

### 2. `BasicSettings.tsx` ✅ 已完成

**文件**: `src/renderer/src/pages/settings/WebSearchSettings/BasicSettings.tsx`

| 修改项 | 说明 |
|--------|------|
| import 修改 | `useWebSearchSettings` 改为从 `@renderer/hooks/useWebSearch` 导入 |
| 移除 import | `useDefaultWebSearchProvider`, `useWebSearchProviders`, Redux imports, logo imports |
| 移除函数 | `getProviderLogo`, `updateSelectedWebSearchProvider`, `sortedProviders`, `renderProviderLabel` |
| 移除调用 | `useDefaultWebSearchProvider()`, `useWebSearchProviders()`, `dispatch` |
| 移除 UI | 整个 "Search Provider" SettingGroup（默认 provider 选择器） |
| dispatch 修改 | `dispatch(setSearchWithTime(checked))` → `setSearchWithTime(checked)` |
| dispatch 修改 | `dispatch(setMaxResult(value))` → `setMaxResults(value)` |
| 状态来源 | `compressionMethod` 来自 `useWebSearchSettings` |

**Slider 组件迁移** (antd → @cherrystudio/ui):

| 修改项 | 说明 |
|--------|------|
| import | `import { Slider } from 'antd'` → `import { Slider } from '@cherrystudio/ui'` |
| defaultValue | `defaultValue={maxResults}` → `defaultValue={[maxResults]}` (数组) |
| marks | `marks={{ 1: '1', ... }}` → `marks={[{ value: 1, label: '1' }, ...]}` |
| 事件 | `onChangeComplete` → `onValueChange` |
| 样式 | `style={{ width: '100%' }}` → `className="w-full"` |

**移除内容**:
- 整个 "默认搜索提供商" 选择器区块
- 所有 provider logo imports
- 所有 Redux 相关代码

---

### 3. `BlacklistSettings.tsx` ✅ 已完成

**文件**: `src/renderer/src/pages/settings/WebSearchSettings/BlacklistSettings.tsx`

| 修改项 | 说明 |
|--------|------|
| import 修改 | `useWebSearchSettings` 改为从 `@renderer/hooks/useWebSearch` 导入 |
| 移除 import | `useBlacklist`, `useAppDispatch`, `useAppSelector`, Redux actions, `Table`, `AddSubscribePopup`, `loggerService`, `useTimer` |
| 移除类型 | `TableRowSelection`, `DataType`, `TableProps` |
| 移除常量 | `columns`, `logger` |
| 移除状态 | `subscribeChecking`, `subscribeValid`, `selectedRowKeys`, `dataSource` |
| 移除函数 | `onSelectChange`, `rowSelection`, `updateSubscribe`, `handleAddSubscribe`, `handleDeleteSubscribe` |
| 移除 useEffect | 订阅源相关 useEffect |
| 移除 UI | 整个订阅源 SettingGroup（Table + 添加/更新/删除按钮） |
| hooks 修改 | `useAppSelector(state => state.websearch.excludeDomains)` → `useWebSearchSettings().excludeDomains` |
| dispatch 修改 | `dispatch(setExcludeDomains(...))` → `setExcludeDomains(...)` |

**TextArea 组件迁移** (antd → @cherrystudio/ui):

| 修改项 | 说明 |
|--------|------|
| import | `import TextArea from 'antd/es/input/TextArea'` → `import { Textarea } from '@cherrystudio/ui'` |
| 组件 | `<TextArea ... />` → `<Textarea.Input ... />` |
| 事件 | `onChange={(e) => setValue(e.target.value)}` → `onValueChange={setValue}` |
| 样式 | `autoSize={{ minRows: 4, maxRows: 8 }}` → `className="min-h-[100px] max-h-[200px]"` |

**移除内容**:
- 整个 "订阅源" 功能区块
- `AddSubscribePopup` 组件引用
- 所有订阅源相关状态、函数、类型定义

**保留内容**:
- 黑名单 TextArea 输入和保存功能
- Alert 错误提示（仍使用 antd）

---

### 4. `WebSearchProviderSetting.tsx`✅ 已完成

**文件**: `src/renderer/src/pages/settings/WebSearchSettings/WebSearchProviderSetting.tsx`

| 行号 | 当前代码 | 修改 |
|------|---------|------|
| 15 | `import { useDefaultWebSearchProvider, useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'` | 改为 `import { useWebSearchProvider } from '@renderer/hooks/useWebSearch'` |
| 36 | `const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()` | **删除** |
| 178-189 | `isDefault`, `canSetAsDefault`, `handleSetAsDefault` | **删除** |
| 208-210 | "设为默认" Button | **删除** |

**移除内容**:
- 标题栏右侧的 "设为默认" 按钮

---

### 5. 可删除的文件

迁移完成后可删除：

| 文件 | 说明 |
|------|------|
| `src/renderer/src/pages/settings/WebSearchSettings/AddSubscribePopup.tsx` | 订阅源弹窗（功能废弃） |

---

## 迁移后的 Hook 导入对照

| 组件 | 旧导入 | 新导入 |
|------|-------|--------|
| index.tsx | `useDefaultWebSearchProvider`, `useWebSearchProviders` | `useWebSearchProviders` |
| BasicSettings.tsx | `useDefaultWebSearchProvider`, `useWebSearchProviders`, `useWebSearchSettings` + Redux | `useWebSearchSettings` |
| BlacklistSettings.tsx | `useBlacklist` + Redux | `useWebSearchSettings` |
| WebSearchProviderSetting.tsx | `useDefaultWebSearchProvider`, `useWebSearchProvider` | `useWebSearchProvider` |
| CompressionSettings/RagSettings.tsx | `useWebSearchSettings` | `useWebSearchSettings` |
| ApiKeyListPopup/list.tsx | `useWebSearchProvider` | `useWebSearchProvider` |

> 所有组件现统一从 `@renderer/hooks/useWebSearch` 导入。

---

## 验证清单

迁移完成后验证：

- [x] Settings 页面正常加载
- [x] Provider 列表正确显示（无默认标签）
- [x] Provider 详情页正常工作（无设为默认按钮）
- [x] searchWithTime 开关正常保存
- [x] maxResults 滑块正常保存
- [x] excludeDomains 黑名单正常保存
- [x] Compression 设置正常工作
- [x] 运行 `pnpm build:check` 通过

---

## 文件路径汇总

**已修改**:
- `src/renderer/src/pages/settings/WebSearchSettings/index.tsx` ✅
- `src/renderer/src/pages/settings/WebSearchSettings/BasicSettings.tsx` ✅
- `src/renderer/src/pages/settings/WebSearchSettings/BlacklistSettings.tsx` ✅
- `src/renderer/src/pages/settings/WebSearchSettings/WebSearchProviderSetting.tsx` ✅
- `src/renderer/src/pages/settings/WebSearchSettings/CompressionSettings/RagSettings.tsx` ✅
- `src/renderer/src/components/Popups/ApiKeyListPopup/list.tsx` ✅

**已删除**:
- `src/renderer/src/pages/settings/WebSearchSettings/AddSubscribePopup.tsx` ✅
- `src/renderer/src/hooks/useWebSearchProviders.ts` ✅
- `src/renderer/src/store/websearch.ts` ✅ (Redux store 已完全移除)

---

# 第二阶段：UI 组件库迁移 (antd → CherryUI + Tailwind) ✅ 已完成

## 概述

在数据层迁移完成后，将剩余的 antd 组件迁移到 CherryUI (@cherrystudio/ui) + Tailwind CSS。

**数据层状态**: ✅ 已完成 (Redux → Preference API)
**UI 层状态**: ✅ 已完成 (antd → CherryUI)

---

## 已迁移文件和组件

| 文件 | antd 组件 | 状态 |
|------|----------|------|
| `CompressionSettings/RagSettings.tsx` | Slider | ✅ 已完成 |
| `CompressionSettings/index.tsx` | Select | ✅ 已完成 |
| `CompressionSettings/CutoffSettings.tsx` | Input, Select, Space.Compact | ✅ 已完成 |
| `BlacklistSettings.tsx` | Alert, 图标 | ✅ 已完成 |
| `index.tsx` | Flex, styled-components | ✅ 已完成 |
| `WebSearchProviderSetting.tsx` | Form, Input, Input.Password, Divider, Link, 图标, styled-components | ✅ 已完成 |

---

## 迁移步骤

### 阶段 1: RagSettings.tsx

**路径**: `src/renderer/src/pages/settings/WebSearchSettings/CompressionSettings/RagSettings.tsx`

替换 antd Slider → CherryUI Slider:

```tsx
// 前
import { Slider } from 'antd'
<Slider value={ragDocumentCount} min={1} max={10} onChange={handleChange} marks={{ 1: '1', 3: '3' }} />

// 后
import { Slider } from '@cherrystudio/ui'
<Slider value={[ragDocumentCount]} min={1} max={10} onValueChange={(v) => handleChange(v[0])} marks={[{ value: 1, label: '1' }, { value: 3, label: '3' }]} />
```

---

### 阶段 2: CompressionSettings/index.tsx

**路径**: `src/renderer/src/pages/settings/WebSearchSettings/CompressionSettings/index.tsx`

替换 antd Select → CherryUI Select:

```tsx
// 前
import { Select } from 'antd'
<Select value={compressionMethod} onChange={handleChange} options={compressionMethodOptions} />

// 后
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
<Select value={compressionMethod} onValueChange={handleChange}>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="none">{t('...')}</SelectItem>
    <SelectItem value="cutoff">{t('...')}</SelectItem>
    <SelectItem value="rag">{t('...')}</SelectItem>
  </SelectContent>
</Select>
```

---

### 阶段 3: CutoffSettings.tsx

**路径**: `src/renderer/src/pages/settings/WebSearchSettings/CompressionSettings/CutoffSettings.tsx`

替换 Space.Compact + Input + Select:

```tsx
// 前
<Space.Compact>
  <Input style={{ maxWidth: '60%' }} ... />
  <Select style={{ minWidth: '40%' }} options={unitOptions} />
</Space.Compact>

// 后
<div className="flex w-[200px]">
  <Input className="w-3/5 rounded-r-none border-r-0" ... />
  <Select>
    <SelectTrigger className="w-2/5 rounded-l-none"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="char">{t('...')}</SelectItem>
      <SelectItem value="token">{t('...')}</SelectItem>
    </SelectContent>
  </Select>
</div>
```

---

### 阶段 4: BlacklistSettings.tsx

**路径**: `src/renderer/src/pages/settings/WebSearchSettings/BlacklistSettings.tsx`

1. 替换图标: `InfoCircleOutlined` → `Info` (lucide-react)
2. 替换 Alert:

```tsx
// 前
<Alert message={t('...')} type="error" />

// 后
<div className="mt-2.5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
  <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
  <span className="text-sm text-red-700 dark:text-red-300">{t('...')}</span>
</div>
```

---

### 阶段 5: index.tsx

**路径**: `src/renderer/src/pages/settings/WebSearchSettings/index.tsx`

移除 styled-components，改用 Tailwind:

| styled-component | Tailwind 类 |
|-----------------|------------|
| `Container` | `flex flex-1` |
| `MainContainer` | `flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden` |
| `MenuList` | `flex h-[calc(100vh-var(--navbar-height))] w-[var(--settings-width)] flex-col gap-[5px] border-r border-[var(--color-border)] p-3 pb-12` |
| `RightContainer` | `relative flex flex-1` |

---

### 阶段 6: WebSearchProviderSetting.tsx (最复杂)

**路径**: `src/renderer/src/pages/settings/WebSearchSettings/WebSearchProviderSetting.tsx`

#### 6.1 图标替换

| antd 图标 | lucide-react |
|----------|--------------|
| `CheckOutlined` | `Check` |
| `ExportOutlined` | `ExternalLink` |
| `LoadingOutlined` | `Loader2` + `animate-spin` |

#### 6.2 Divider → Tailwind

```tsx
// 前
<Divider style={{ margin: '10px 0' }} />

// 后
<div className="my-2.5 h-px w-full bg-[var(--color-border)]" />
```

#### 6.3 Link → 原生 a 标签

```tsx
// 前
<Link target="_blank" href={url}><ExportOutlined /></Link>

// 后
<a target="_blank" href={url} rel="noopener noreferrer"><ExternalLink size={12} /></a>
```

#### 6.4 Input.Password → InputGroup

```tsx
// 前
<Input.Password value={apiKey} onChange={(e) => setApiKey(e.target.value)} />

// 后
const [showPassword, setShowPassword] = useState(false)
<InputGroup>
  <InputGroupInput type={showPassword ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
  <InputGroupAddon align="inline-end">
    <InputGroupButton variant="ghost" size="icon-xs" onClick={() => setShowPassword(!showPassword)}>
      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
    </InputGroupButton>
  </InputGroupAddon>
</InputGroup>
```

#### 6.5 Form/Form.Item → Tailwind 布局

```tsx
// 前
<Form layout="vertical">
  <Form.Item label="Username"><Input /></Form.Item>
</Form>

// 后
<div className="flex flex-col gap-4">
  <div className="flex flex-col gap-1.5">
    <label className="text-sm font-medium">Username</label>
    <Input />
  </div>
</div>
```

#### 6.6 styled-components → Tailwind

```tsx
// 前
const ProviderName = styled.span`font-size: 14px; font-weight: 500;`

// 后
<span className="text-sm font-medium">...</span>
```

---

## 关键 API 差异

### CherryUI Slider vs antd Slider

| 属性 | antd | CherryUI |
|-----|------|----------|
| value | `number` | `number[]` |
| onChange | `(value: number) => void` | `onValueChange: (values: number[]) => void` |
| marks | `{ [value]: label }` | `[{ value, label }]` |

### CherryUI Select vs antd Select

| 属性 | antd | CherryUI |
|-----|------|----------|
| 结构 | 单组件 + options prop | 复合组件 (Select, SelectTrigger, SelectContent, SelectItem) |
| onChange | `(value) => void` | `onValueChange: (value) => void` |
| options | `[{ value, label }]` | 通过 SelectItem 子组件定义 |

---

## UI 组件库迁移验证清单

- [x] `pnpm lint` 无错误
- [x] `pnpm test` 通过
- [x] `pnpm build:check` 通过
- [x] 功能验证:
  - [x] Provider 列表正常显示
  - [x] API Key 输入、密码显示/隐藏、检查功能正常
  - [x] Compression 设置 (none/cutoff/rag) 正常
  - [x] Blacklist 保存和错误提示正常
  - [x] 深色模式样式正确

---

## 迁移总结

### 移除的依赖

**antd 组件**:
- `Slider`, `Select`, `Input`, `Input.Password`, `Form`, `Form.Item`, `Divider`, `Alert`, `Flex`, `Space.Compact`
- `Link` (from `antd/es/typography/Link`)

**@ant-design/icons**:
- `CheckOutlined`, `ExportOutlined`, `LoadingOutlined`, `InfoCircleOutlined`

**styled-components**:
- `Container`, `MainContainer`, `MenuList`, `RightContainer`, `ProviderName`

### 新增的依赖

**@cherrystudio/ui**:
- `Slider`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `Input`

**lucide-react**:
- `Check`, `ExternalLink`, `Loader2`, `Eye`, `EyeOff`, `AlertCircle`, `Info`

**Tailwind CSS**:
- 布局类: `flex`, `flex-col`, `gap-*`, `w-*`, `h-*`
- 样式类: `rounded-*`, `border-*`, `bg-*`, `text-*`
- 响应式 Alert 组件 (支持深色模式)

---

# 第三阶段：Setting 组件迁移 (styled-components → Tailwind) ⏳ 待开始

## 概述

将 `src/renderer/src/pages/settings/index.tsx` 中的 styled-components 设置组件迁移到 Tailwind CSS，实现完全去除 styled-components 依赖。

**目标**:
- 移除 styled-components
- 移除 antd `Divider` 和 `Link`
- 使用 Tailwind CSS 原生实现

---

## 待迁移组件

| 组件 | 当前实现 | 使用文件 |
|------|---------|---------|
| `SettingContainer` | styled.div | WebSearchGeneralSettings.tsx, WebSearchProviderSettings.tsx |
| `SettingGroup` | styled.div | BlacklistSettings.tsx, BasicSettings.tsx, WebSearchProviderSettings.tsx |
| `SettingTitle` | styled.div | BlacklistSettings.tsx, BasicSettings.tsx, WebSearchProviderSetting.tsx |
| `SettingSubtitle` | ✅ 已使用 Tailwind | WebSearchProviderSetting.tsx |
| `SettingDivider` | styled(antd.Divider) | 所有文件 |
| `SettingRow` | styled.div | BlacklistSettings.tsx, BasicSettings.tsx, CompressionSettings/ |
| `SettingRowTitle` | styled.div | BlacklistSettings.tsx, BasicSettings.tsx, CompressionSettings/ |
| `SettingHelpTextRow` | styled.div | WebSearchProviderSetting.tsx |
| `SettingHelpText` | styled.div | WebSearchProviderSetting.tsx |
| `SettingHelpLink` | styled(antd.Link) | WebSearchProviderSetting.tsx |

---

## 迁移方案

### SettingContainer

```tsx
// 前 (styled-components)
export const SettingContainer = styled.div<{ theme?: ThemeMode }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 15px 18px;
  overflow-y: scroll;
  background: ${(props) => (props.theme === 'dark' ? 'transparent' : 'var(--color-background-soft)')};
  &::-webkit-scrollbar { display: none; }
`

// 后 (Tailwind)
<div className={cn(
  "flex flex-1 flex-col overflow-y-scroll p-[15px_18px] scrollbar-none",
  theme === 'dark' ? 'bg-transparent' : 'bg-[var(--color-background-soft)]'
)}>
```

### SettingGroup

```tsx
// 前 (styled-components)
export const SettingGroup = styled.div<{ theme?: ThemeMode }>`
  margin-bottom: 20px;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid var(--color-border);
  padding: 16px;
  background: ${(props) => (props.theme === 'dark' ? '#00000010' : 'var(--color-background)')};
`

// 后 (Tailwind)
<div className={cn(
  "mb-5 rounded-[var(--list-item-border-radius)] border border-[var(--color-border)] p-4",
  theme === 'dark' ? 'bg-black/[0.06]' : 'bg-[var(--color-background)]'
)}>
```

### SettingTitle

```tsx
// 前 (styled-components)
export const SettingTitle = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  font-size: 14px;
  font-weight: bold;
`

// 后 (Tailwind)
<div className="flex select-none items-center justify-between text-sm font-bold">
```

### SettingDivider

```tsx
// 前 (styled-components + antd)
export const SettingDivider = styled(Divider)`
  margin: 10px 0;
  border-block-start: 0.5px solid var(--color-border);
`

// 后 (Tailwind)
<div className="my-2.5 h-px w-full bg-[var(--color-border)]" />
```

### SettingRow

```tsx
// 前 (styled-components)
export const SettingRow = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  min-height: 24px;
`

// 后 (Tailwind)
<div className="flex min-h-6 items-center justify-between">
```

### SettingRowTitle

```tsx
// 前 (styled-components)
export const SettingRowTitle = styled.div`
  font-size: 14px;
  line-height: 18px;
  color: var(--color-text-1);
  display: flex;
  flex-direction: row;
  align-items: center;
`

// 后 (Tailwind)
<div className="flex items-center text-sm leading-[18px] text-[var(--color-text-1)]">
```

### SettingHelpTextRow

```tsx
// 前 (styled-components)
export const SettingHelpTextRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 5px 0;
`

// 后 (Tailwind)
<div className="flex items-center py-[5px]">
```

### SettingHelpText

```tsx
// 前 (styled-components)
export const SettingHelpText = styled.div`
  font-size: 11px;
  color: var(--color-text);
  opacity: 0.4;
`

// 后 (Tailwind)
<span className="text-[11px] text-[var(--color-text)] opacity-40">
```

### SettingHelpLink

```tsx
// 前 (styled-components + antd)
export const SettingHelpLink = styled(Link)`
  font-size: 11px;
  margin: 0 5px;
`

// 后 (Tailwind)
<a className="mx-[5px] text-[11px] text-primary hover:underline" target="_blank" rel="noopener noreferrer">
```

---

## 迁移策略

### 方案 A: 直接内联替换 (推荐)

直接在使用处替换为 Tailwind 类：

```tsx
// 前
<SettingGroup theme={theme}>
  <SettingTitle>标题</SettingTitle>
  <SettingDivider />
  <SettingRow>
    <SettingRowTitle>标签</SettingRowTitle>
    <Switch />
  </SettingRow>
</SettingGroup>

// 后
<div className={cn(
  "mb-5 rounded-[var(--list-item-border-radius)] border border-[var(--color-border)] p-4",
  theme === 'dark' ? 'bg-black/[0.06]' : 'bg-[var(--color-background)]'
)}>
  <div className="flex select-none items-center justify-between text-sm font-bold">标题</div>
  <div className="my-2.5 h-px w-full bg-[var(--color-border)]" />
  <div className="flex min-h-6 items-center justify-between">
    <div className="flex items-center text-sm leading-[18px] text-[var(--color-text-1)]">标签</div>
    <Switch />
  </div>
</div>
```

### 方案 B: 创建 Tailwind 组件

在 `@cherrystudio/ui` 中创建新组件：

```tsx
// packages/ui/src/components/composites/Settings/index.tsx
export const SettingsGroup = ({ children, className }: Props) => (
  <div className={cn("mb-5 rounded-lg border border-border p-4 bg-card", className)}>
    {children}
  </div>
)

export const SettingsTitle = ({ children, className }: Props) => (
  <div className={cn("flex select-none items-center justify-between text-sm font-bold", className)}>
    {children}
  </div>
)

// ... 其他组件
```

---

## 待迁移文件

| 文件 | 使用的组件 |
|------|-----------|
| `BasicSettings.tsx` | SettingGroup, SettingTitle, SettingDivider, SettingRow, SettingRowTitle |
| `BlacklistSettings.tsx` | SettingGroup, SettingTitle, SettingDivider, SettingRow, SettingRowTitle |
| `WebSearchGeneralSettings.tsx` | SettingContainer |
| `WebSearchProviderSettings.tsx` | SettingContainer, SettingGroup |
| `WebSearchProviderSetting.tsx` | SettingTitle, SettingSubtitle, SettingDivider, SettingHelpTextRow, SettingHelpText, SettingHelpLink |
| `CompressionSettings/index.tsx` | SettingGroup, SettingTitle, SettingDivider, SettingRow, SettingRowTitle |
| `CompressionSettings/CutoffSettings.tsx` | SettingRow, SettingRowTitle |
| `CompressionSettings/RagSettings.tsx` | SettingDivider, SettingRow, SettingRowTitle |

---

## 验证清单

- [ ] `pnpm lint` 无错误
- [ ] `pnpm test` 通过
- [ ] `pnpm build:check` 通过
- [ ] 功能验证:
  - [ ] 设置页面布局正确
  - [ ] 深色/浅色主题切换正常
  - [ ] 所有交互功能正常
