# WebSearch UI 迁移计划

## 概述

将 WebSearch Settings UI 从旧 Redux hooks 迁移到新的 `useWebSearch.ts` hooks。

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
| `compression` | 保留 | `useWebSearchSettings().setCompression` |
| `defaultProvider` | 废弃 | 移除 UI |
| `subscribeSources` | 废弃 | 移除 UI |

---

## 类型变更

新的 DataApi 返回的 provider 类型与旧 Redux 类型不同：

| 字段 | 旧类型 (Redux) | 新类型 (DataApi) |
|------|---------------|-----------------|
| `provider.id` | `WebSearchProviderId` (字面量联合) | `string` |

**影响**：需要将使用 `WebSearchProviderId` 作为参数的函数改为接受 `string` 类型。

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
| 变量重命名 | `compressionConfig` → `compression` |

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
- [ ] 运行 `pnpm build:check` 通过(需要迁移check search)

---

## 文件路径汇总

**需要修改**:
- `src/renderer/src/pages/settings/WebSearchSettings/index.tsx`
- `src/renderer/src/pages/settings/WebSearchSettings/BasicSettings.tsx`
- `src/renderer/src/pages/settings/WebSearchSettings/BlacklistSettings.tsx`
- `src/renderer/src/pages/settings/WebSearchSettings/WebSearchProviderSetting.tsx`

**可删除**:
- `src/renderer/src/pages/settings/WebSearchSettings/AddSubscribePopup.tsx`

**旧代码（迁移完成后删除）**:
- `src/renderer/src/hooks/useWebSearchProviders.ts`
- `src/renderer/src/store/websearch.ts`
