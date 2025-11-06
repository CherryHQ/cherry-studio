# Cherry Studio 快捷键系统重构设计文档 v2.1

> 最近更新：2025-01-30  
> 维护者：Architecture Team

## 目录

- [背景与目标](#背景与目标)
- [核心原则](#核心原则)
- [架构分层](#架构分层)
- [关键实现](#关键实现)
- [数据流](#数据流)
- [默认快捷键](#默认快捷键)
- [迁移与兼容性](#迁移与兼容性)
- [后续演进方向](#后续演进方向)

---

## 背景与目标

旧版快捷键系统存在以下问题：

1. 依赖已弃用的 `configManager`，与 v2 架构不兼容；
2. Redux store 与本地存储重复维护状态；
3. 处理器通过 `switch-case` 硬编码，可维护性差；
4. 快捷键定义分散，缺乏统一真相源；
5. 新增快捷键需要触达多处文件，易错且低效。

新版系统要实现：

- **单一真相源**：快捷键定义集中管理，保证一致性；
- **偏好服务优先**：所有运行时状态通过 `preferenceService` 管理；
- **处理器注册表**：解除 `switch-case` 依赖，改用 Map 注册；
- **类型安全**：从定义、存储到消费全链路具备 TypeScript 约束；
- **易扩展**：新增快捷键仅需「定义 → 注册处理器 → 使用」三步；
- **性能稳定**：支持 100+ 快捷键规模，主/渲染进程高效同步；
- **多窗口同步**：借助 `preferenceService` 自动推送变更。

---

## 核心原则

1. **关注点分离**  
   - 定义层：静态元数据（名称、默认绑定、作用域、分类等）；  
   - 偏好层：用户可变配置（绑定、启用状态等）；  
   - 服务层：主进程注册、电焦/失焦时的生命周期管理；  
   - UI 层：设置面板、快捷键提示等。

2. **复用基础设施**  
   - 所有持久化均依赖 `preferenceService`（SQLite + 内存缓存 + IPC）；  
   - 变更通过订阅自动广播至所有窗口；  
   - 新增键位无需改动主进程/渲染进程的底层框架代码。

---

## 架构分层

```
┌──────────────────────────────────────────────┐
│                   Shortcut 系统               │
├──────────────────────────────────────────────┤
│ 📋 Definitions (packages/shared/shortcuts)   │
│   - types.ts：类型、作用域、分类              │
│   - definitions.ts：静态定义（真相之源）      │
│   - utils.ts：转换/校验工具                   │
│                                              │
│ 💾 Preferences (preferenceService)            │
│   - preferenceSchemas.ts 默认值               │
│   - preferenceTypes.ts 类型导出               │
│                                              │
│ ⚙️ Services                                   │
│   - src/main/services/ShortcutService.ts      │
│     · 处理器注册表、focus/blur 生命周期       │
│     · preference 订阅、主进程快捷键注册       │
│   - 渲染进程 useShortcut/useShortcutDisplay   │
│                                              │
│ 🎨 UI                                         │
│   - 设置页 ShortcutSettings                   │
│   - 各功能模块中的 useShortcut/useShortcutDisplay │
└──────────────────────────────────────────────┘
```

---

## 关键实现

### 1. 静态定义

- 所有快捷键在 `packages/shared/shortcuts/definitions.ts` 中集中维护；
- 包含 `scope`（main / renderer / both）、`category`、`persistOnBlur` 等元信息；
- `enabledWhen` 支持动态启用（如 mini window 与 quick assistant 开关关联）；
- 新增快捷键步骤：
  1. 在 `preferenceSchemas.ts` 中声明默认值；
  2. 在 `definitions.ts` 中补充静态定义；
  3. 在主/渲染进程相关模块注册处理器或消费 Hook。

### 2. 偏好系统

- 所有运行时配置通过 `preferenceService` 读写；
- 默认值与 `PreferenceShortcutType` 结构保持一致；
- `ShortcutService` / `useShortcuts` 访问偏好时统一调用 `coerceShortcutPreference`，确保 fallback 与类型安全；
- 批量重置通过 `preferenceService.setMultiple` 实现。

### 3. 主进程服务

- `ShortcutService` 负责：
  - 生命周期：随着窗口 focus/blur 注册或卸载快捷键；
  - 处理器注册：Map 替换 `switch-case`；
  - 订阅偏好变更：自动重新注册；
  - `persistOnBlur`：例如 `show_main_window` 在窗口失焦时仍可触发；
  - `shortcut.app.show_settings` 会在需要时唤起窗口并调用 `window.navigate('/settings/provider')`，避免重复 blur/focus。

### 4. 渲染进程 Hook

- `useShortcut`：从偏好获取绑定 → 转为 `react-hotkeys-hook` 字符串 → 注册快捷键；
- `useShortcutDisplay`：转换为 UI 显示字符串（`⌘` / `Ctrl+` 等）；
- `useAllShortcuts`：批量拉取配置 + diff 默认值，供设置面板使用；
- 新增 `enableOnContentEditable` 等配置支撑设置页和富文本场景。

### 5. 设置界面

- `ShortcutSettings` 直接消费 `useAllShortcuts`；
- 支持录制、清空、重置默认、启用/禁用、冲突检测；
- 重新绑定时使用 `convertKeyToAccelerator` / `isValidShortcut` / `formatShortcutDisplay`；
- “重置全部” 通过 `preferenceService.setMultiple` 一次性写入默认配置；
- 新增表格展示 `hasCustomBinding`，区分用户自定义与继承默认值。

---

## 数据流

### 启动阶段

1. `preferenceService.initialize()` 载入缓存；
2. `shortcutService` 构造时注册处理器与订阅；
3. 窗口创建后调用 `shortcutService.registerForWindow`，在 `focus` 时注册主进程快捷键。

### 运行时变更

1. 设置页或其他模块调用 `preferenceService.set` / `setMultiple`；
2. 主进程订阅触发 → `globalShortcut.unregisterAll()` → 按新配置重注册；
3. 渲染进程通过 `usePreference`/`useMultiplePreferences` 自动收到更新，UI 即时刷新。

---

## 默认快捷键

| preference key                          | 默认绑定                    | 描述 / 备注                          |
|----------------------------------------|-----------------------------|--------------------------------------|
| `shortcut.app.show_main_window`        | `Cmd/Ctrl + Shift + A`      | 主窗口显示（失焦持久）               |
| `shortcut.app.show_mini_window`        | `Cmd/Ctrl + E`              | Mini 窗口（与 quick assistant 联动） |
| `shortcut.app.show_settings`           | `Cmd/Ctrl + ,`              | 设置页入口                           |
| `shortcut.app.toggle_show_assistants`  | `Cmd/Ctrl + [`              | 助手侧边栏                           |
| `shortcut.app.exit_fullscreen`         | `Escape`                    | 系统级，不可编辑                     |
| `shortcut.app.zoom_in/out/reset`       | `Cmd/Ctrl + = / - / 0`      | 包含数字键盘变体                     |
| `shortcut.app.search_message`          | `Cmd/Ctrl + Shift + F`      | 全局搜索                             |
| `shortcut.chat.clear`                  | `Cmd/Ctrl + L`              | 清空消息                             |
| `shortcut.chat.search_message`         | `Cmd/Ctrl + F`              | 聊天内搜索                           |
| `shortcut.chat.toggle_new_context`     | `Cmd/Ctrl + K`              | 新上下文                             |
| `shortcut.chat.copy_last_message`      | `Cmd/Ctrl + Shift + C`      | 复制最后一条                         |
| `shortcut.chat.edit_last_user_message` | `Cmd/Ctrl + Shift + E`      | 编辑最后一条用户消息                 |
| `shortcut.topic.new`                   | `Cmd/Ctrl + N`              | 新增话题（默认启用）                 |
| `shortcut.topic.rename`                | `Cmd/Ctrl + T`              | 重命名话题（默认启用，自 2025-01 调整） |
| `shortcut.topic.toggle_show_topics`    | `Cmd/Ctrl + ]`              | 话题侧边栏                           |
| `shortcut.selection.*`                 | 无默认绑定                  | 划词助手开关、取词                   |

> 具体配置以 `preferenceSchemas.ts` 为准，可在设置页查看或调整。

---

## 迁移与兼容性

- 已有用户偏好：沿用旧值；新增键（如 `shortcut.topic.rename`）在数据库不存在时继承新默认；
- 旧版 Redux store / `configManager` 已彻底移除；
- `IpcChannel.Shortcuts_Update` 与 `window.api.shortcuts.update` 相关逻辑已弃用；
- `PreferenceMigrator` 中保留与旧 keys 的映射，确保升级顺畅。

---

## 后续演进方向

1. **冲突检测增强**：主/渲染进程联动校验冲突并提示；
2. **导入导出**：允许用户批量备份/恢复自定义快捷键；
3. **多作用域绑定**：同一逻辑支持按窗口类型或上下文切换；
4. **可视化录制**：增加「录制模式」避免输入框手动录制；
5. **自动化测试**：补充主进程/渲染进程快捷键单元测试样板。

---

> 如需扩展或有疑问，请联系架构团队或在仓库中提交 Issue。  
> 设计文档 v2.1 同步最新实现（2025-01），包含 `shortcut.topic.rename` 默认启用、`show_settings` 优化等补充说明。
