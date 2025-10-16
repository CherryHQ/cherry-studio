# 知识库界面 antd 迁移指南

本文档梳理 `src/renderer/src/pages/knowledge` 目录下仍依赖 antd 的组件，并给出迁移到 HeroUI 组件体系（公司当前推荐的 shadcn 兼容实现）的建议步骤。请在动手前阅读结尾的注意事项，确保迁移工作符合项目规范。

## 迁移范围统计

- **涉及文件数**：7 个文件（同一文件中可能引用多个 antd 组件）。
- **待替换 antd 组件**（按字母排序，共 13 项）：`Divider`、`Dropdown`、`Empty`、`Input`、`InputRef`、`List`、`Menu`、`MenuProps`、`Modal`、`ModalProps`、`Progress`、`Spin`、`Tabs`、`Typography`。

| 文件 | antd 依赖 | 备注 |
| --- | --- | --- |
| `KnowledgePage.tsx` | `Dropdown`、`Empty`、`MenuProps` | 侧边栏右键菜单、空状态 |
| `KnowledgeContent.tsx` | `Empty`、`Tabs` | 列表空视图、Tab 容器 |
| `components/KnowledgeSearchPopup.tsx` | `Modal`、`Divider`、`Input`、`InputRef`、`List`、`Spin` | 搜索弹窗（输入框、搜索结果列表、Loading） |
| `components/KnowledgeSettings/KnowledgeBaseFormModal.tsx` | `Modal`、`Menu`、`ModalProps` | 知识库设置抽屉左侧菜单 |
| `components/StatusIcon.tsx` | `Progress` | 处理状态的圆形进度 |
| `components/KnowledgeSearchItem/components.tsx` | `Typography` | 搜索结果元信息的文字样式 |
| `components/KnowledgeSearchItem/TextItem.tsx` & `VideoItem.tsx` | `Typography` | 高亮文段、段落排版 |

> Tipp: 通过 `python scripts` 输出的清单见执行日志，可用于对照核查。

## 推荐替换方案

| antd 组件 | HeroUI 替代建议 | 额外说明 |
| --- | --- | --- |
| `Dropdown` | `@heroui/react` 的 `Dropdown`, `DropdownTrigger`, `DropdownMenu` | 使用 `DropdownMenu` 的 `onAction` 异步处理代替 antd `MenuProps`；若需要右键触发，可封装自定义触发器。 |
| `Empty` | 自研 `EmptyState` 组件或 HeroUI `Card` + 自定义文案 | HeroUI 暂无完全等价组件，可在 `@renderer/components` 中补一个通用空态。 |
| `Tabs` | `Tabs`, `Tab`, `TabPanel` | HeroUI Tabs 使用受控 `selectedKey`；需要改造 `items` 数组为显式 `Tab` 节点。 |
| `Modal`/`ModalProps` | `Modal`, `ModalContent`, `ModalBody`, `ModalHeader`, `ModalFooter` | HeroUI Modal 默认受控 `isOpen` + `onOpenChange`；`destroyOnHidden` 可用 `unmountOnExit` 替代。 |
| `Input`/`InputRef` | `Input`, `InputProps` | `InputRef` 改为 `React.RefObject<HTMLInputElement>`；`allowClear` 可通过 `endContent` 自行实现。 |
| `Divider` | `Divider` | HeroUI Divider 支持 `orientation` & `className`；注意尺寸需用 CSS 变量对齐。 |
| `List` | `Listbox`、`ScrollShadow` 或自建列表 | HeroUI 无 `List.Item` 结构，建议改为 `Listbox` + `ListboxItem`；若需要复杂子项，可直接渲染 `div` 列表，并配合 `ScrollShadow` 实现滚动。 |
| `Spin` | `Spinner` | 支持 `size="lg"` 等；包装在 `flex` 容器中对齐。 |
| `Menu` | `Tabs`（垂直模式）、`Listbox` 或 `Accordion` | 侧边菜单可改为 `Listbox`，利用 `selectedKeys` 控制选中态。 |
| `Progress` | `CircularProgress` | `value` 接收 0-100 数字；若需要小尺寸可用 `size="sm"` 并修改 `className`。 |
| `Typography` | `Text`, `Paragraph`, `Link` | HeroUI 文本组件支持 `as` 属性；高亮逻辑保留。 |

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

## 注意事项

- 根据项目指南，新的 UI 组件需统一替换为 HeroUI 实现，避免再引入 antd 或 styled-components。若必须保留 styled-components，请在合并前与维护者确认。
- HeroUI 组件库基于 shadcn 架构，若遇到功能缺口，可先在 `@heroui/react` 上扩展二次封装。
- 迁移涉及大量 UI 行为，请在合并前邀请团队成员进行人工回归。

如需进一步的分支计划或代码模板，可以在完成页面级别迁移后追加文档补充。
