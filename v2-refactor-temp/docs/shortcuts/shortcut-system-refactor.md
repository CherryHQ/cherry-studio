# Cherry Studio 快捷键系统重构设计

> 版本：v2.0
> 更新日期：2026-04-14
> 分支：`refactor/v2/shortcuts`

## 背景

v1 快捷键系统的主要问题有 5 个：

- 数据源分散在 Redux 和 `configManager`
- 主进程与渲染进程靠手动 IPC 同步
- 新增快捷键需要改多处 `switch-case`
- 定义分散，缺少统一入口
- 类型约束弱，运行时容易出现脏数据

v2 的目标很明确：

- 用 `SHORTCUT_DEFINITIONS` 统一描述所有快捷键元数据
- 用 Preference 存储用户配置，不再维护第二套状态
- main / renderer 各自按职责注册，但共用同一套定义和工具
- 通过 `resolveShortcutPreference` 保证读取结果始终完整可用
- 让新增快捷键尽量收敛为“定义 + 默认值 + 使用”三步

## 核心模型

系统由 4 层组成：

1. 定义层：`packages/shared/shortcuts/definitions.ts`
2. 工具层：`packages/shared/shortcuts/utils.ts`
3. 存储层：`packages/shared/data/preference/preferenceSchemas.ts`
4. 消费层：`ShortcutService` 与 `useShortcuts.ts`

它们各自负责的事情很简单：

| 层 | 作用 |
| --- | --- |
| 定义层 | 描述快捷键是什么 |
| 工具层 | 做格式转换、校验、默认值和归一化 |
| 存储层 | 保存用户真正可变的配置 |
| 消费层 | 在 main / renderer 中注册并使用快捷键 |

### 1. 定义层

`SHORTCUT_DEFINITIONS` 是快捷键系统的单一真相源。每条定义描述一个快捷键的静态元数据，例如：

```ts
{
  key: 'shortcut.feature.quick_assistant.toggle_window',
  scope: 'main',
  category: 'general',
  labelKey: 'mini_window',
  global: true,
  supportedPlatforms: ['darwin', 'win32']
}
```

常用字段：

| 字段 | 说明 |
| --- | --- |
| `key` | Preference key，格式通常为 `shortcut.{category}.{name}` |
| `scope` | `main`、`renderer` 或 `both` |
| `category` | 设置页分组，如 `general`、`chat`、`topic`、`feature.selection` |
| `labelKey` | i18n 文案 key |
| `editable` | 是否允许用户修改绑定 |
| `global` | 是否在窗口失焦后仍需保留注册 |
| `variants` | 同一快捷键的额外绑定 |
| `supportedPlatforms` | 平台限制 |

### 2. 存储层

快捷键偏好只保存用户真正会改的部分：

```ts
type PreferenceShortcutType = {
  binding: string[]
  enabled: boolean
}
```

默认值定义在 `preferenceSchemas.ts`。例如：

```ts
'shortcut.chat.clear': { enabled: true, binding: ['CommandOrControl', 'L'] }
'shortcut.general.show_main_window': { enabled: false, binding: [] }
```

这里不存 `editable`、`scope`、`labelKey` 这类静态信息，它们始终从 `SHORTCUT_DEFINITIONS` 读取。

### 3. 工具层

`utils.ts` 里最重要的是 4 类能力：

- 格式转换：Electron accelerator 与 renderer hotkey 之间互转
- 显示格式化：把绑定转成 `⌘L` / `Ctrl+L`
- 合法性校验：限制无效单键
- 偏好归一化：把任意原始值整理成稳定的 `ResolvedShortcut`

核心函数是 `resolveShortcutPreference(definition, value)`。它负责：

- 值缺失时回退到 schema 默认值
- 保留用户显式清空的 `binding: []`
- 当 `enabled` 字段异常时回退到默认值

对调用侧来说，拿到的始终是：

```ts
type ResolvedShortcut = {
  binding: string[]
  enabled: boolean
}
```

## 运行方式

### 主进程

`ShortcutService` 负责所有 `scope !== 'renderer'` 的快捷键。

它的实现重点只有 3 件事：

1. 注册内置 handler：用 `Map<ShortcutPreferenceKey, ShortcutHandler>` 代替 `switch-case`
2. 监听 Preference 变化：配置变更后重算当前应注册的快捷键
3. 管理窗口生命周期：窗口 focus / blur 时切换“全部快捷键”与“仅全局快捷键”

当前注册逻辑是增量 diff：

- 先根据定义、平台、功能开关和偏好算出目标 accelerator 集合
- 再和已注册集合比较
- 只卸载或重绑真正变化的项

这样可以避免无意义的全量 unregister / register。

### 渲染进程

`useShortcuts.ts` 提供 3 个 Hook：

| Hook | 作用 |
| --- | --- |
| `useShortcut` | 注册单个 renderer 快捷键 |
| `useShortcutDisplay` | 返回格式化后的展示文案 |
| `useAllShortcuts` | 为设置页提供完整快捷键列表和统一更新入口 |

其中 `useAllShortcuts()` 现在会直接处理：

- 平台过滤
- 依赖功能开关的过滤
- label 生成
- “无绑定不算启用”的展示态收敛

设置页只需要继续做搜索、录制、冲突提示和渲染。

## 关键规则

有几条规则是这个系统稳定运行的关键：

### 单一真相源

快捷键的静态信息只来自 `SHORTCUT_DEFINITIONS`，不要在页面、服务或迁移代码里再维护另一份描述。

### Preference 优先

运行时状态只从 Preference 读写。不要再引入 Redux、临时配置文件或额外 IPC 作为第二数据源。

### 无绑定即不可触发

即使某项 `enabled` 为 `true`，只要 `binding` 为空，它也不应被注册，也不应在设置页显示为启用。

### 功能关闭时不显示对应快捷键

当前有两类依赖功能状态的快捷键：

- `shortcut.feature.quick_assistant.toggle_window` 依赖 `feature.quick_assistant.enabled`
- `feature.selection.*` 依赖 `feature.selection.enabled`

功能关闭时，这些快捷键不会注册，也不会在设置页显示。

### 平台限制要同时作用于注册与展示

`supportedPlatforms` 不只是 UI 过滤条件，也决定快捷键是否会在当前系统上注册。

## 默认快捷键

下表只保留最常用的信息：key、默认绑定、scope、默认启用状态。

### general

| Key | 默认绑定 | Scope | 默认启用 |
| --- | --- | --- | --- |
| `shortcut.general.show_main_window` | *(无)* | main | 否 |
| `shortcut.feature.quick_assistant.toggle_window` | `Cmd/Ctrl+E` | main | 否 |
| `shortcut.general.show_settings` | `Cmd/Ctrl+,` | main | 是 |
| `shortcut.general.toggle_sidebar` | `Cmd/Ctrl+[` | renderer | 是 |
| `shortcut.general.exit_fullscreen` | `Escape` | renderer | 是 |
| `shortcut.general.zoom_in` | `Cmd/Ctrl+=` | main | 是 |
| `shortcut.general.zoom_out` | `Cmd/Ctrl+-` | main | 是 |
| `shortcut.general.zoom_reset` | `Cmd/Ctrl+0` | main | 是 |
| `shortcut.general.search` | `Cmd/Ctrl+Shift+F` | renderer | 是 |

### chat

| Key | 默认绑定 | Scope | 默认启用 |
| --- | --- | --- | --- |
| `shortcut.chat.clear` | `Cmd/Ctrl+L` | renderer | 是 |
| `shortcut.chat.search_message` | `Cmd/Ctrl+F` | renderer | 是 |
| `shortcut.chat.toggle_new_context` | `Cmd/Ctrl+K` | renderer | 是 |
| `shortcut.chat.copy_last_message` | `Cmd/Ctrl+Shift+C` | renderer | 否 |
| `shortcut.chat.edit_last_user_message` | `Cmd/Ctrl+Shift+E` | renderer | 否 |
| `shortcut.chat.select_model` | `Cmd/Ctrl+Shift+M` | renderer | 是 |

### topic

| Key | 默认绑定 | Scope | 默认启用 |
| --- | --- | --- | --- |
| `shortcut.topic.new` | `Cmd/Ctrl+N` | renderer | 是 |
| `shortcut.topic.rename` | `Cmd/Ctrl+T` | renderer | 否 |
| `shortcut.topic.toggle_show_topics` | `Cmd/Ctrl+]` | renderer | 是 |

### feature.selection

| Key | 默认绑定 | Scope | 默认启用 |
| --- | --- | --- | --- |
| `shortcut.feature.selection.toggle_enabled` | *(无)* | main | 否 |
| `shortcut.feature.selection.get_text` | *(无)* | main | 否 |

## 扩展方式

新增一个快捷键，原则上只需要 3 步。

### 1. 添加默认值

在 `preferenceSchemas.ts` 中增加 schema 默认值：

```ts
'shortcut.chat.regenerate': {
  enabled: true,
  binding: ['CommandOrControl', 'Shift', 'R']
}
```

### 2. 添加定义

在 `definitions.ts` 中加入静态元数据：

```ts
{
  key: 'shortcut.chat.regenerate',
  scope: 'renderer',
  category: 'chat',
  labelKey: 'regenerate'
}
```

### 3. 在目标位置使用

渲染进程：

```ts
useShortcut('chat.regenerate', () => regenerateLastMessage())
```

主进程：

```ts
this.handlers.set('shortcut.chat.regenerate', () => {
  // ...
})
```

如果是条件型快捷键，不要把条件写进定义层，应该在消费层做过滤或在 handler 内做早返回。

## 迁移与测试

### 迁移现状

- 旧的 Redux `shortcuts` slice 只保留为迁移输入
- `IpcChannel.Shortcuts_Update`、旧 preload bridge、`configManager` 快捷键接口都已移除
- 旧数据通过 `PreferenceMigrator` 映射到新的 `shortcut.*` key

### 当前测试重点

现有测试主要覆盖：

- `utils.ts` 的格式转换、校验和归一化
- 旧 key 到新 key 的迁移映射
- `ShortcutService` 的重注册行为

后续如果继续扩展，优先补下面两类测试：

- 设置页的录制、冲突和显示逻辑
- 主进程全局快捷键的端到端行为

## 总结

这套重构的核心不是“把快捷键做复杂”，而是把复杂度收拢到共享定义、统一归一化和清晰分层里。

对日常开发来说，只需要记住 3 件事：

1. 静态信息看 `SHORTCUT_DEFINITIONS`
2. 用户配置看 Preference
3. main / renderer 按各自职责消费同一套定义
