# Cherry Studio 快捷键系统重构设计文档

> 版本：v3.0（v2 Preference 架构）
> 更新日期：2026-04-03
> 分支：`refactor/shortcut`

## 目录

- [背景与目标](#背景与目标)
- [核心设计原则](#核心设计原则)
- [架构总览](#架构总览)
- [分层详解](#分层详解)
- [类型系统](#类型系统)
- [数据流](#数据流)
- [默认快捷键一览](#默认快捷键一览)
- [扩展指南](#扩展指南)
- [迁移清单](#迁移清单)
- [测试覆盖](#测试覆盖)
- [后续演进方向](#后续演进方向)

---

## 背景与目标

### 旧版问题

v1 快捷键系统存在以下架构缺陷：

| 问题 | 影响 |
|------|------|
| 双数据源（Redux store + `configManager`）| 主/渲染进程状态不一致 |
| `IpcChannel.Shortcuts_Update` 手动同步 | 多窗口场景下丢失更新 |
| `switch-case` 硬编码处理器 | 可维护性差，新增快捷键需改动多处 |
| 定义分散在多个文件 | 缺乏单一真相源 |
| 弱类型（`Record<string, unknown>`）| 运行时类型不安全 |

### 新版目标

- **单一真相源**：`SHORTCUT_DEFINITIONS` 数组为所有快捷键元数据的唯一来源
- **Preference 优先**：运行时状态完全托管于 `preferenceService`（SQLite + 内存缓存 + IPC 广播）
- **全链路类型安全**：从定义到存储到消费，TypeScript 严格约束
- **处理器注册表**：`Map<key, handler>` 替代 `switch-case`
- **三步扩展**：新增快捷键仅需「定义 → Schema 默认值 → 注册使用」
- **多窗口自动同步**：借助 `preferenceService` 的 IPC 广播机制
- **平台感知**：`supportedPlatforms` 字段过滤不支持的系统快捷键

---

## 核心设计原则

1. **关注点分离** — 定义层（静态元数据）、偏好层（用户配置）、服务层（注册与生命周期）、UI 层（展示与编辑）各司其职
2. **复用基础设施** — 所有持久化依赖 `preferenceService`，不引入新的存储通道
3. **防御性 coerce** — 所有偏好读取均经过 `coerceShortcutPreference` 归一化，保证缺失字段有合理 fallback
4. **声明式驱动** — 注册逻辑遍历 `SHORTCUT_DEFINITIONS`，不硬编码具体快捷键

---

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                     Shortcut System v3                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  📋 Shared Definition Layer                          │     │
│  │  packages/shared/shortcuts/                          │     │
│  │  ├── types.ts        类型定义                        │     │
│  │  ├── definitions.ts  SHORTCUT_DEFINITIONS (真相之源) │     │
│  │  └── utils.ts        转换 / 校验 / coerce 工具      │     │
│  └─────────────────────────────────────────────────────┘     │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  💾 Preference Layer                                 │     │
│  │  packages/shared/data/preference/                    │     │
│  │  ├── preferenceSchemas.ts  默认值 (enabled + key)    │     │
│  │  └── preferenceTypes.ts    PreferenceShortcutType    │     │
│  └─────────────────────────────────────────────────────┘     │
│           │                              │                   │
│           ▼                              ▼                   │
│  ┌────────────────────┐    ┌──────────────────────────┐      │
│  │  ⚙️  Main Process   │    │  🖥️  Renderer Process    │      │
│  │  ShortcutService    │    │  useShortcut             │      │
│  │  ├ Handler Map      │    │  useShortcutDisplay      │      │
│  │  ├ Focus/Blur 生命周期│    │  useAllShortcuts         │      │
│  │  ├ Preference 订阅  │    │  (react-hotkeys-hook)    │      │
│  │  └ globalShortcut   │    └──────────────────────────┘      │
│  └────────────────────┘                  │                   │
│                                          ▼                   │
│                              ┌──────────────────────┐        │
│                              │  🎨 UI Layer          │        │
│                              │  ShortcutSettings     │        │
│                              │  ├ 录制 / 清空 / 重置 │        │
│                              │  ├ 冲突检测           │        │
│                              │  └ 启用 / 禁用        │        │
│                              └──────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

---

## 分层详解

### 1. 共享定义层 (`packages/shared/shortcuts/`)

#### `definitions.ts` — 单一真相源

所有快捷键以 `ShortcutDefinition[]` 数组集中声明，每条定义包含完整的静态元数据：

```typescript
{
  key: 'shortcut.general.show_mini_window',  // Preference key
  defaultBinding: ['CommandOrControl', 'E'], // Electron accelerator 格式
  scope: 'main',                         // main | renderer | both
  category: 'feature.selection',             // 点分命名空间 UI 分组：app.general、app.chat、plugin.xxx 等
  labelKey: 'mini_window',              // i18n label key
  system: true,                          // 系统级（不可删除绑定）
  editable: true,                        // 用户可修改绑定（默认 true）
  global: true,                          // 全局快捷键（窗口失焦后仍然生效）
  enabledWhen: (get) => !!get('feature.quick_assistant.enabled'),
  supportedPlatforms: ['darwin', 'win32']
}
```

**关键字段说明：**

| 字段 | 用途 |
|------|------|
| `key` | Preference key，内置快捷键用 `shortcut.app.{category}.{name}` 格式，插件用 `shortcut.plugin.{pluginId}.{name}` |
| `defaultBinding` | Electron accelerator 格式的默认绑定，空数组表示无默认绑定 |
| `scope` | 决定快捷键注册在哪个进程：`main`（globalShortcut）、`renderer`（react-hotkeys-hook）、`both`（两者都注册） |
| `category` | 点分命名空间 UI 分组（如 `general`、`chat`、`topic`、`plugin.translator`），类型为 `string` 以支持插件扩展 |
| `labelKey` | i18n label key，由 `getShortcutLabel()` 消费 |
| `editable` | 设为 `false` 表示用户不可修改绑定（如 Escape 退出全屏），默认 `true` |
| `system` | 系统级标记，`true` 时不可删除绑定 |
| `global` | 全局快捷键，窗口失焦时是否保留注册（如 `show_main_window` 需要在任何时候响应） |
| `variants` | 同一快捷键的多组绑定（如 zoom_in 同时绑定 `=` 和小键盘 `+`） |
| `enabledWhen` | 动态启用条件，接收 `getPreference` 函数，在注册时求值 |
| `supportedPlatforms` | 限制快捷键仅在指定操作系统上注册和显示，类型为 `SupportedPlatform[]`（`'darwin' | 'win32' | 'linux'`） |

#### `types.ts` — 类型体系

```typescript
// 从 PreferenceKeyType 推导出所有 shortcut.* 前缀的 key
type ShortcutPreferenceKey = Extract<PreferenceKeyType, `shortcut.${string}`>

// 去掉 shortcut. 前缀的短 key，用于调用侧简化
type ShortcutKey = ShortcutPreferenceKey extends `shortcut.${infer Rest}` ? Rest : never

// 运行时归一化后的完整状态
interface ResolvedShortcut {
  binding: string[]   // 生效的绑定（用户自定义、默认值或空数组——显式清空）
  enabled: boolean    // 是否启用
  editable: boolean   // 来自 definition.editable，不存储在偏好中
  system: boolean     // 来自 definition.system，不存储在偏好中
}
```

`ShortcutKey` 类型使得调用侧可以使用短 key：

```typescript
// 两种写法等价，均有类型补全
useShortcut('chat.clear', callback)
useShortcut('shortcut.chat.clear', callback)
```

#### `utils.ts` — 纯函数工具集

| 函数 | 职责 |
|------|------|
| `convertKeyToAccelerator` | DOM `event.code` → Electron accelerator 格式 |
| `convertAcceleratorToHotkey` | Electron accelerator → `react-hotkeys-hook` 字符串 |
| `formatShortcutDisplay` | accelerator → 用户友好的显示字符串（Mac 用符号，其他用文字） |
| `isValidShortcut` | 校验快捷键有效性（须含修饰键，或为特殊单键如 F1-F12、Escape） |
| `getDefaultShortcut` | 从 `DefaultPreferences` 读取 schema 默认值并归一化 |
| `resolveShortcutPreference` | **核心归一化函数**：将任意偏好值 + 定义 → 完整的 `ResolvedShortcut` |

`resolveShortcutPreference` 的防御逻辑：

```
输入值为 null/undefined → 使用 schema 默认值
输入的 key 为空数组    → binding 为空（用户显式清空）
输入的 enabled 非布尔  → 使用默认 enabled
editable/system        → 始终从 definition 读取（不存储在偏好中）
```

**设计决策**：禁用快捷键可以使用 `enabled: false`，也可以清空绑定（`key: []`）。想换键就录制覆盖，想重置就写回 `defaultBinding`。

### 2. 偏好层 (`preferenceSchemas.ts` + `preferenceTypes.ts`)

偏好值的存储结构经过精简，只持久化用户可变部分：

```typescript
// PreferenceShortcutType — 存储在 SQLite 中的数据结构
type PreferenceShortcutType = {
  key: string[]       // 用户自定义的键位绑定
  enabled: boolean    // 启用/禁用
}
```

**设计决策**：`editable` 和 `system` 不存储在偏好中，而是在运行时从 `ShortcutDefinition` 注入。这样修改定义不需要数据迁移。

`preferenceSchemas.ts` 中为每个快捷键声明默认值：

```typescript
'shortcut.chat.clear': { enabled: true, key: ['CommandOrControl', 'L'] },
'shortcut.chat.copy_last_message': { enabled: false, key: ['CommandOrControl', 'Shift', 'C'] },
```

### 3. 主进程服务层 (`ShortcutService`)

基于 v2 Lifecycle 架构实现，使用 `@Injectable`、`BaseService`、`@DependsOn` 等装饰器：

```typescript
@Injectable('ShortcutService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService', 'SelectionService', 'PreferenceService'])
export class ShortcutService extends BaseService { ... }
```

#### 处理器注册表

使用 `Map<ShortcutPreferenceKey, ShortcutHandler>` 存储处理器，在 `onInit` 时注册所有内置处理器：

```typescript
private handlers = new Map<ShortcutPreferenceKey, ShortcutHandler>()

// 注册示例
this.handlers.set('shortcut.general.zoom_in', (window) => {
  if (window) handleZoomFactor([window], 0.1)
})
```

#### 窗口生命周期管理

```
窗口创建 → registerForWindow(window)
    ├── 首次创建 + tray_on_launch → ready-to-show 时仅注册 global 快捷键
    ├── focus 事件 → registerShortcuts(window, false)  注册全部
    └── blur 事件  → registerShortcuts(window, true)   仅保留 global
```

`registerShortcuts` 的核心流程：

1. `globalShortcut.unregisterAll()` 清空所有注册
2. 遍历 `relevantDefinitions`（预过滤 `scope !== 'renderer'` 和 `supportedPlatforms`）
3. 对每个定义：读取偏好 → `coerceShortcutPreference` 归一化 → 检查 `enabled` + `enabledWhen` → 注册 handler
4. 如果定义有 `variants`，额外注册变体绑定

#### 偏好变更订阅

```typescript
for (const definition of relevantDefinitions) {
  const unsub = preferenceService.subscribeChange(definition.key, () => {
    this.reregisterShortcuts()  // 整体重注册
  })
  this.registerDisposable({ dispose: unsub })  // 生命周期自动清理
}
```

### 4. 渲染进程 Hook 层 (`useShortcuts.ts`)

提供三个核心 Hook：

#### `useShortcut(key, callback, options)`

注册渲染进程快捷键，核心逻辑：

1. `toFullKey()` 支持短 key 和完整 key 两种写法
2. `findShortcutDefinition()` 查找定义
3. `usePreference()` 读取当前偏好值
4. `coerceShortcutPreference()` 归一化
5. 检查 `scope === 'main'` → 跳过（主进程快捷键不在渲染进程注册）
6. 检查 `enabled` → 禁用则 hotkey 设为 `'none'`
7. `convertAcceleratorToHotkey()` 转换格式
8. 传递给 `react-hotkeys-hook` 的 `useHotkeys`

```typescript
// 调用侧简洁用法
useShortcut('chat.clear', () => clearChat())
useShortcut('topic.new', () => createTopic(), { enableOnFormTags: false })
```

**Options：**

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `preventDefault` | `true` | 阻止浏览器默认行为 |
| `enableOnFormTags` | `true` | 在 input/textarea 中是否生效 |
| `enabled` | `true` | 外部控制启用/禁用 |
| `enableOnContentEditable` | `false` | 在 contentEditable 元素中是否生效 |

#### `useShortcutDisplay(key)`

返回格式化后的快捷键显示字符串，用于 UI 提示（如 Tooltip）：

```typescript
const display = useShortcutDisplay('chat.clear')
// Mac: "⌘L"   Windows: "Ctrl+L"
```

#### `useAllShortcuts()`

供设置页使用，批量读取所有快捷键配置：

- 使用 `useMultiplePreferences()` 一次性读取所有 `shortcut.*` 偏好
- 返回 `ShortcutListItem[]`，每项包含 `definition`、`preference`、`defaultPreference`、`updatePreference`
- `updatePreference` 内部使用 `buildNextPreference` 合并 patch，仅写入 `{ key, enabled }`

### 5. UI 层 (`ShortcutSettings.tsx`)

设置页面直接消费 `useAllShortcuts()` Hook，支持以下操作：

| 功能 | 实现 |
|------|------|
| **平台过滤** | 根据 `supportedPlatforms` 过滤不支持的快捷键 |
| **快捷键录制** | `handleKeyDown` 捕获键盘事件 → `convertKeyToAccelerator` → `isValidShortcut` 校验 |
| **冲突检测** | `isDuplicateShortcut` 检查已显示快捷键中是否存在相同绑定 |
| **清空绑定** | `updatePreference({ key: [] })` |
| **重置单项** | 写入 `defaultPreference` 的 `binding` + `enabled` |
| **重置全部** | `preferenceService.setMultiple()` 批量写入所有默认值 |
| **启用/禁用** | `updatePreference({ enabled: !current })` |
| **修改标记** | `isShortcutModified` 比对当前值与默认值，决定重置按钮是否可用 |

---

## 类型系统

### 类型推导链

```
preferenceSchemas.ts 中声明 key
    ↓ 代码生成
PreferenceKeyType（所有偏好 key 的联合类型）
    ↓ Extract<..., `shortcut.${string}`>
ShortcutPreferenceKey（如 'shortcut.chat.clear'）
    ↓ Template literal infer
ShortcutKey（如 'chat.clear'）
```

### 调用侧类型安全

```typescript
// ✅ 编译通过 — 'chat.clear' 是合法的 ShortcutKey
useShortcut('chat.clear', callback)

// ✅ 编译通过 — 完整 key 也被接受
useShortcut('shortcut.chat.clear', callback)

// ❌ 编译报错 — 'chat.invalid' 不在 ShortcutKey 联合类型中
useShortcut('chat.invalid', callback)
```

---

## 数据流

### 启动阶段

```
PreferenceService.initialize()
    ↓ SQLite → 内存缓存
ShortcutService.onInit()
    ├── registerBuiltInHandlers()    注册 Map<key, handler>
    ├── subscribeToPreferenceChanges()  订阅每个 shortcut.* key
    └── registerForWindow(mainWindow)
            ├── focus → registerShortcuts(window, false)
            └── blur  → registerShortcuts(window, true)
```

### 用户修改快捷键

```
用户在设置页按下新快捷键
    ↓ handleKeyDown
convertKeyToAccelerator() + isValidShortcut() + isDuplicateShortcut()
    ↓ 通过校验
updatePreference({ key: newKeys })
    ↓ useMultiplePreferences.setValues()
preferenceService.set('shortcut.chat.clear', { key: [...], enabled: true })
    ├── SQLite 持久化
    ├── IPC 广播 → 所有渲染窗口自动更新
    └── subscribeChange 回调 → ShortcutService.reregisterShortcuts()
            ↓
        globalShortcut.unregisterAll() → 按新配置重注册
```

### 渲染进程快捷键触发

```
用户按下 Cmd+L
    ↓ react-hotkeys-hook
useHotkeys('mod+l', callback)
    ↓ 匹配成功
callback(event)  // 如 clearChat()
```

### 主进程快捷键触发

```
用户按下 Cmd+E（窗口失焦状态）
    ↓ Electron globalShortcut
handlers.get('shortcut.general.show_mini_window')
    ↓
toggleMiniWindow()
```

---

## 默认快捷键一览

### 应用级 (`app`)

| Preference Key | 默认绑定 | 作用域 | 备注 |
|---|---|---|---|
| `shortcut.general.show_main_window` | *(无)* | main | 失焦持久，系统级 |
| `shortcut.general.show_mini_window` | `Cmd/Ctrl+E` | main | 关联 quick_assistant 开关 |
| `shortcut.general.show_settings` | `Cmd/Ctrl+,` | both | 不可编辑 |
| `shortcut.general.toggle_sidebar` | `Cmd/Ctrl+[` | renderer | |
| `shortcut.general.exit_fullscreen` | `Escape` | renderer | 不可编辑，系统级 |
| `shortcut.general.zoom_in` | `Cmd/Ctrl+=` | main | 含小键盘变体 |
| `shortcut.general.zoom_out` | `Cmd/Ctrl+-` | main | 含小键盘变体 |
| `shortcut.general.zoom_reset` | `Cmd/Ctrl+0` | main | |
| `shortcut.general.search` | `Cmd/Ctrl+Shift+F` | renderer | |

### 聊天 (`chat`)

| Preference Key | 默认绑定 | 默认启用 | 备注 |
|---|---|---|---|
| `shortcut.chat.clear` | `Cmd/Ctrl+L` | 是 | |
| `shortcut.chat.search_message` | `Cmd/Ctrl+F` | 是 | |
| `shortcut.chat.toggle_new_context` | `Cmd/Ctrl+K` | 是 | |
| `shortcut.chat.copy_last_message` | `Cmd/Ctrl+Shift+C` | 否 | |
| `shortcut.chat.edit_last_user_message` | `Cmd/Ctrl+Shift+E` | 否 | |
| `shortcut.chat.select_model` | `Cmd/Ctrl+Shift+M` | 是 | |

### 话题 (`topic`)

| Preference Key | 默认绑定 |
|---|---|
| `shortcut.topic.new` | `Cmd/Ctrl+N` |
| `shortcut.topic.rename` | `Cmd/Ctrl+T` |
| `shortcut.topic.toggle_show_topics` | `Cmd/Ctrl+]` |

### 划词助手 (`selection`)

| Preference Key | 默认绑定 | 支持平台 |
|---|---|---|
| `shortcut.feature.selection.toggle_enabled` | *(无)* | macOS, Windows |
| `shortcut.feature.selection.get_text` | *(无)* | macOS, Windows |

---

## 扩展指南

### 新增一个快捷键（三步）

**Step 1：声明 Schema 默认值**

```typescript
// packages/shared/data/preference/preferenceSchemas.ts
'shortcut.chat.regenerate': { enabled: true, key: ['CommandOrControl', 'Shift', 'R'] },
```

> 注意：类型声明区也需要添加对应的类型声明行。

**Step 2：添加静态定义**

```typescript
// packages/shared/shortcuts/definitions.ts
{
  key: 'shortcut.chat.regenerate',
  defaultBinding: ['CommandOrControl', 'Shift', 'R'],
  scope: 'renderer',
  category: 'chat'
}
```

**Step 3：在目标模块使用**

```typescript
// 渲染进程
useShortcut('chat.regenerate', () => regenerateLastMessage())

// 或主进程（在 ShortcutService.registerBuiltInHandlers 中）
this.handlers.set('shortcut.chat.regenerate', () => { ... })
```

### 条件启用

使用 `enabledWhen` 让快捷键根据其他偏好动态启用/禁用：

```typescript
{
  key: 'shortcut.general.show_mini_window',
  enabledWhen: (get) => !!get('feature.quick_assistant.enabled'),
  // 当 quick_assistant 关闭时，此快捷键不会被注册
}
```

### 平台限制

```typescript
{
  key: 'shortcut.feature.selection.toggle_enabled',
  supportedPlatforms: ['darwin', 'win32'],
  // Linux 上不会注册，设置页也不会显示
}
```

---

## 迁移清单

### 已移除的旧组件

| 旧组件 | 状态 |
|--------|------|
| Redux `shortcuts` slice | 从 `combineReducers` 移除，文件保留供数据迁移 `initialState` 使用 |
| `IpcChannel.Shortcuts_Update` | 已删除 |
| `window.api.shortcuts.update` (preload bridge) | 已删除 |
| `configManager.getShortcuts()` / `setShortcuts()` | 已删除 |
| `ConfigKeys.Shortcuts` | 已删除 |

### 数据迁移

- `store/migrate.ts` 中引入 `MigrationState` 类型（`RootState & { shortcuts?: ShortcutsState }`），兼容旧 Redux 状态结构
- 已有用户偏好通过 `PreferenceMigrator` 从旧 key 映射到新 `shortcut.*` key
- 未持久化的快捷键自动继承 `preferenceSchemas.ts` 中的默认值

---

## 测试覆盖

### 单元测试 (`packages/shared/__tests__/shortcutUtils.test.ts`)

覆盖 `utils.ts` 中所有导出函数，共 19 个测试用例：

| 测试组 | 覆盖内容 |
|--------|----------|
| `convertKeyToAccelerator` | 已知 key 映射、未知 key 透传 |
| `convertAcceleratorToHotkey` | 修饰键转换（CommandOrControl→mod, Ctrl→ctrl 等） |
| `formatShortcutDisplay` | Mac 符号格式（⌘⇧⌥⌃）、非 Mac 文字格式 |
| `isValidShortcut` | 空数组、含修饰键、特殊单键、普通单键 |
| `getDefaultShortcutPreference` | 默认值读取、`editable`/`system` 继承 |
| `coerceShortcutPreference` | null/undefined 回退、自定义 key、空数组回退、enabled 覆盖 |

---

## 后续演进方向

1. **跨进程冲突检测** — 主进程与渲染进程联动校验绑定冲突并在设置页提示
2. **导入/导出** — 允许用户批量备份和恢复自定义快捷键配置
3. **多作用域绑定** — 同一逻辑按窗口类型或上下文切换不同绑定
4. **i18n label 自动化** — 消除 `labelKeyMap` 硬编码，从 definition key 自动推导 i18n key
5. **E2E 快捷键测试** — 通过 Playwright 验证主进程 globalShortcut 的端到端行为

---

> 如需扩展或有疑问，请在仓库中提交 Issue。
