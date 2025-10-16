# 知识库界面 antd 迁移指南

本文档梳理 `src/renderer/src/pages/knowledge` 目录下仍依赖 antd 的组件，并给出迁移到 HeroUI 组件体系（公司当前推荐的 shadcn 兼容实现）的建议步骤。请在动手前阅读结尾的注意事项，确保迁移工作符合项目规范。

## 迁移范围统计

- **涉及文件数**：7 个文件（同一文件中可能引用多个 antd 组件）。
- **待替换 antd 组件**（按字母排序，共 3 项）：`Empty`、`Menu`、`Modal`（1 处）、`ModalProps`、`Progress`。
- **已完成迁移**：~~`Tabs`~~ ✅、~~`Dropdown`~~ ✅、~~`MenuProps`~~ ✅、~~`Divider`~~ ✅、~~`Spin`~~ ✅、~~`Input`~~ ✅、~~`InputRef`~~ ✅、~~`Modal`~~（1 处）✅、~~`List`~~ ✅、~~`Typography`~~ ✅

| 文件 | antd 依赖 | 备注 |
| --- | --- | --- |
| `KnowledgePage.tsx` | `Empty` | ~~侧边栏右键菜单（已迁移至 shadcn DropdownMenu）~~、空状态 |
| `KnowledgeContent.tsx` | `Empty` | 列表空视图 |
| `components/KnowledgeSearchPopup.tsx` | - | ~~全部迁移完成~~ ✅ |
| `components/KnowledgeSettings/KnowledgeBaseFormModal.tsx` | `Modal`、`Menu`、`ModalProps` | 知识库设置抽屉左侧菜单 |
| `components/StatusIcon.tsx` | `Progress` | 处理状态的圆形进度 |
| `components/KnowledgeSearchItem/components.tsx` | - | ~~全部迁移完成~~ ✅ |
| `components/KnowledgeSearchItem/TextItem.tsx` & `VideoItem.tsx` | - | ~~全部迁移完成~~ ✅ |

> Tipp: 通过 `python scripts` 输出的清单见执行日志，可用于对照核查。

## 推荐替换方案

| antd 组件 | HeroUI 替代建议 | 额外说明 |
| --- | --- | --- |
| ~~`Dropdown`~~ ✅ | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` (shadcn) | ✅ **已完成**：使用受控的 `open`/`onOpenChange` 状态管理；右键菜单通过 `onContextMenu` 事件实现；`MenuProps['items']` 转为组合式 `DropdownMenuItem` 组件；`danger: true` 改为 `variant="destructive"`；`type: 'divider'` 改为 `DropdownMenuSeparator`。参考：`KnowledgePage.tsx:102-135`。 |
| `Empty` | 自研 `EmptyState` 组件或 HeroUI `Card` + 自定义文案 | HeroUI 暂无完全等价组件，可在 `@renderer/components` 中补一个通用空态。 |
| ~~`Tabs`~~ ✅ | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (shadcn) | ✅ **已完成**：使用 shadcn Tabs 组合式 API，`value`/`onValueChange` 替代 `activeKey`/`onChange`；将 antd `items` 数组转为 `TabsTrigger` + `TabsContent` 节点；下划线样式使用 Tailwind 类名实现。参考：`KnowledgeContent.tsx:159-177`。 |
| ~~`Modal`~~ ✅（部分）| `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter` (shadcn) | ✅ **已完成（1/2 处）**：`open` 保持不变；`onCancel`/`onOk` 合并为 `onOpenChange`；`afterClose` 在 `onOpenChange` 中处理；`title` 改为 `<DialogTitle>`；`footer` 改为 `<DialogFooter>`；`closable={false}` 改为 `showCloseButton={false}`；`centered` 默认居中；`width` 用 `className="w-[700px]"` 或 `max-w-[700px]`；样式通过 `className` 覆盖。参考：`KnowledgeSearchPopup.tsx:69-114`。 |
| `ModalProps` | - | 类型依赖，随 Modal 迁移一起移除。 |
| ~~`Input`/`InputRef`~~ ✅ | `Input` (shadcn) | ✅ **已完成**：`InputRef` 改为 `React.RefObject<HTMLInputElement>`；`prefix` 通过包装容器实现；`allowClear` 手动实现清除按钮；`onPressEnter` 改为 `onKeyDown` 检测 Enter 键；`variant="borderless"` 使用 `className` 移除边框和阴影。参考：`KnowledgeSearchPopup.tsx:98-121`。 |
| ~~`Divider`~~ ✅ | `Separator` (shadcn) | ✅ **已完成**：使用 `Separator` 组件，默认水平方向；通过 `className` 调整间距。参考：`KnowledgeSearchPopup.tsx:94`。 |
| ~~`List`~~ ✅ | 自建列表（div + map） | ✅ **已完成**：`dataSource` + `renderItem` 改为 `map` 直接渲染；`List.Item` 改为自定义 styled-component `ResultsListItem`，添加底部边框和 padding。参考：`KnowledgeSearchPopup.tsx:104-110`。 |
| ~~`Spin`~~ ✅ | `Spinner` (base/Spinner) | ✅ **已完成**：迁移到 base/Spinner 组件（带文本的搜索状态指示器）；保持原有动画和文本显示效果。参考：`KnowledgeSearchPopup.tsx:99`。 |
| `Menu` | `Tabs`（垂直模式）、`Listbox` 或 `Accordion` | 侧边菜单可改为 `Listbox`，利用 `selectedKeys` 控制选中态。 |
| `Progress` | `CircularProgress` | `value` 接收 0-100 数字；若需要小尺寸可用 `size="sm"` 并修改 `className`。 |
| ~~`Typography`~~ ✅ | 原生 HTML 标签 + CSS 变量 | ✅ **已完成**：`Typography.Text` 改为 `<span>`；`type="secondary"` 改为 `className="text-[var(--color-text-2)]"`；`Typography.Paragraph` 改为 `<p className="mb-0 select-text">`。参考：`components.tsx:23-28`、`TextItem.tsx:22-24`、`VideoItem.tsx:74-76`。 |

## 迁移实施建议

1. **抽象共享 UI**：在 `@renderer/components` 或 `@cherrystudio/ui` 中创建可复用的 HeroUI 包装（如 `EmptyState`、`ContextMenu`）。在知识库页面引用，以免重复实现。
2. **分文件迁移**：
   - 先迁移基础弹窗和列表组件（`KnowledgeSearchPopup`, `KnowledgeBaseFormModal`），再处理页面容器（`KnowledgePage`, `KnowledgeContent`）。
   - 文本样式相关文件（`KnowledgeSearchItem/*`）可以与 UI 重构同步完成。
3. **处理类型依赖**：
   - `MenuProps`、`ModalProps`、`InputRef` 均可替换为组件自带的 props 或原生 `HTMLDivElement`/`HTMLInputElement` 引用。
   - 若 HeroUI 未导出 TypeScript 类型，可手动扩展接口或使用 `ComponentProps<typeof Modal>`。
4. **保持样式一致**：
   - 避免新增 styled-components；优先使用 Tailwind/内置 className。若短期仍需 styled-components，可复用现有模式，并在后续统一替换。
   - 调整 CSS 变量以还原 antd 下的间距、字体大小。
5. **交互校验**：
   - 迁移后逐一验证快捷键、右键菜单、滚动行为、IPC 回调是否正常。
   - 覆盖空态、加载态、错误态，确保 HeroUI 版本的弹窗关闭动画与 TopView 生命周期兼容。
6. **测试与回归**：
   - 运行 `yarn build:check`；如涉及视觉变更，更新截图或设计说明。
   - 与设计/产品确认 HeroUI 组件表现符合预期。

## 迁移进度跟踪

### 已完成 (10/13)

- [x] **Tabs** - `KnowledgeContent.tsx` (2025-01-16)
  - 迁移到 shadcn Tabs 组合式 API
  - 实现下划线样式，左对齐布局
  - 移除 `StyledTabs`、`TabLabel`、`TabContent` styled-components

- [x] **Dropdown** - `KnowledgePage.tsx` (2025-01-16)
  - 迁移到 shadcn DropdownMenu 组合式 API
  - 实现右键菜单触发（`onContextMenu` + 受控状态）
  - 转换 `MenuProps['items']` 为 `DropdownMenuItem` 组件
  - 删除 `getMenuItems` 函数，重构为独立的事件处理器

- [x] **MenuProps** - 类型依赖已随 Dropdown 迁移移除

- [x] **Divider** - `KnowledgeSearchPopup.tsx` (2025-01-16)
  - 迁移到 shadcn Separator 组件
  - 使用 Tailwind 类名 `mt-1` 替代内联样式

- [x] **Spin** - `KnowledgeSearchPopup.tsx` (2025-01-16)
  - 迁移到 base/Spinner 组件（带文本的搜索状态指示器）
  - 保持原有动画和文本显示效果

- [x] **Input** - `KnowledgeSearchPopup.tsx` (2025-01-16)
  - 迁移到 shadcn Input 组件
  - `InputRef` 改为 `React.RefObject<HTMLInputElement>`
  - 手动实现 `prefix` 和 `allowClear`（清除按钮）功能
  - `onPressEnter` 改为 `onKeyDown` 处理 Enter 键
  - 使用包装容器 `SearchInputContainer` 组织布局

- [x] **InputRef** - 类型依赖已随 Input 迁移移除

- [x] **Modal** (部分) - `KnowledgeSearchPopup.tsx` (2025-01-16)
  - 迁移到 shadcn Dialog 组件（1/2 处完成）
  - `onCancel`/`onOk` 合并为 `onOpenChange`，在状态变化时触发 resolve
  - `closable={false}` 改为 `showCloseButton={false}`
  - `width={700}` 改为 `className="w-[700px] max-w-[90vw] sm:max-w-[700px]"`
  - `styles` 改为 `className` 实现（圆角、padding 等）

- [x] **List** - `KnowledgeSearchPopup.tsx` (2025-01-16)
  - 移除 antd List，改用原生 div + map 渲染
  - `dataSource` + `renderItem` 模式改为直接 `results.map()`
  - `List.Item` 改为自定义 `ResultsListItem` styled-component
  - 添加底部边框和 padding 样式，保持视觉一致
  - 实现条件渲染：初始状态显示空、加载中显示 Spinner、无结果显示空状态、有结果显示列表

- [x] **Typography** - 3 处 (`components.tsx`, `TextItem.tsx`, `VideoItem.tsx`) (2025-01-16)
  - `Typography.Text` 改为 `<span>` 标签
  - `type="secondary"` 改为 `className="text-[var(--color-text-2)]"`（次要文本颜色）
  - `Typography.Paragraph` 改为 `<p>` 标签
  - `style={{ userSelect: 'text', marginBottom: 0 }}` 改为 `className="mb-0 select-text"`
  - 使用项目 CSS 变量实现文本颜色层级

### 待迁移 (3/13)

- [ ] `Empty` - 2 处 (`KnowledgePage.tsx`, `KnowledgeContent.tsx`)
- [ ] `Modal` - 1 处 (`KnowledgeBaseFormModal.tsx`)
- [ ] `Menu` - 1 处 (`KnowledgeBaseFormModal.tsx`)
- [ ] `Progress` - 1 处 (`StatusIcon.tsx`)
- [ ] `ModalProps` - 类型依赖

## 注意事项

- 根据项目指南，新的 UI 组件需统一替换为 HeroUI 实现，避免再引入 antd 或 styled-components。若必须保留 styled-components，请在合并前与维护者确认。
- HeroUI 组件库基于 shadcn 架构，若遇到功能缺口，可先在 `@heroui/react` 上扩展二次封装。
- 迁移涉及大量 UI 行为，请在合并前邀请团队成员进行人工回归。

如需进一步的分支计划或代码模板，可以在完成页面级别迁移后追加文档补充。
