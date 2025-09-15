# UI 组件库迁移状态

## 使用示例

```typescript
// 从 @cherrystudio/ui 导入组件
import { Spinner, DividerWithText, InfoTooltip, CustomTag } from '@cherrystudio/ui'

// 在组件中使用
function MyComponent() {
  return (
    <div>
      <Spinner size={24} />
      <DividerWithText text="分隔文本" />
      <InfoTooltip content="提示信息" />
      <CustomTag color="var(--color-primary)">标签</CustomTag>
    </div>
  )
}
```

## 目录结构说明

```text
@packages/ui/
├── src/
│   ├── components/         # 组件主目录
│   │   ├── base/           # 基础组件（按钮、输入框、标签等）
│   │   ├── display/        # 显示组件（卡片、列表、表格等）
│   │   ├── layout/         # 布局组件（容器、网格、间距等）
│   │   ├── icons/          # 图标组件
│   │   ├── interactive/    # 交互组件（弹窗、提示、下拉等）
│   │   └── composite/      # 复合组件（多个基础组件组合而成）
│   ├── hooks/              # 自定义 React Hooks
│   └── types/              # TypeScript 类型定义
```

### 组件分类指南

提交 PR 时，请根据组件功能将其放入正确的目录：

- **base**: 最基础的 UI 元素，如按钮、输入框、开关、标签等
- **display**: 用于展示内容的组件，如卡片、列表、表格、标签页等
- **layout**: 用于页面布局的组件，如容器、网格系统、分隔符等
- **icons**: 所有图标相关的组件
- **interactive**: 需要用户交互的组件，如模态框、抽屉、提示框、下拉菜单等
- **composite**: 复合组件，由多个基础组件组合而成

## 迁移概览

- **总组件数**: 236
- **已迁移**: 43
- **已重构**: 0
- **待迁移**: 193

## 组件状态表

| Category | Component Name | Migration Status | Refactoring Status | Description |
|----------|----------------|------------------|--------------------|-------------|
| **base** | | | | 基础组件 |
| | CopyButton | ✅ | ❌ | 复制按钮 |
| | CustomTag | ✅ | ❌ | 自定义标签 |
| | DividerWithText | ✅ | ❌ | 带文本的分隔线 |
| | EmojiIcon | ✅ | ❌ | 表情图标 |
| | ErrorTag | ✅ | ❌ | 错误标签 |
| | IndicatorLight | ✅ | ❌ | 指示灯 |
| | Spinner | ✅ | ❌ | 加载动画 |
| | SuccessTag | ✅ | ❌ | 成功标签 |
| | TextBadge | ✅ | ❌ | 文本徽标 |
| | WarnTag | ✅ | ❌ | 警告标签 |
| | CustomCollapse | ✅ | ❌ | 自定义折叠面板 |
| **display** | | | | 显示组件 |
| | Ellipsis | ✅ | ❌ | 文本省略 |
| | ExpandableText | ✅ | ❌ | 可展开文本 |
| | ThinkingEffect | ✅ | ❌ | 思考效果动画 |
| | EmojiAvatar | ✅ | ❌ | 表情头像 |
| | ListItem | ✅ | ❌ | 列表项 |
| | MaxContextCount | ✅ | ❌ | 最大上下文数显示 |
| | CodeViewer | ❌ | ❌ | 代码查看器 (外部依赖) |
| | OGCard | ❌ | ❌ | OG 卡片 |
| | MarkdownShadowDOMRenderer | ❌ | ❌ | Markdown 渲染器 |
| | Preview/* | ❌ | ❌ | 预览组件 |
| **layout** | | | | 布局组件 |
| | HorizontalScrollContainer | ✅ | ❌ | 水平滚动容器 |
| | Scrollbar | ✅ | ❌ | 滚动条 |
| | Layout/* | ❌ | ❌ | 布局组件 |
| | Tab/* | ❌ | ❌ | 标签页 (Redux 依赖) |
| | TopView | ❌ | ❌ | 顶部视图 (window.api 依赖) |
| **icons** | | | | 图标组件 |
| | CopyIcon | ✅ | ❌ | 复制图标 |
| | DeleteIcon | ✅ | ❌ | 删除图标 |
| | EditIcon | ✅ | ❌ | 编辑图标 |
| | FileIcons | ✅ | ❌ | 文件图标 (包含 FileSvgIcon、FilePngIcon) |
| | ReasoningIcon | ✅ | ❌ | 推理图标 |
| | RefreshIcon | ✅ | ❌ | 刷新图标 |
| | ResetIcon | ✅ | ❌ | 重置图标 |
| | SvgSpinners180Ring | ✅ | ❌ | 旋转加载图标 |
| | ToolsCallingIcon | ✅ | ❌ | 工具调用图标 |
| | VisionIcon | ✅ | ❌ | 视觉图标 |
| | WebSearchIcon | ✅ | ❌ | 网页搜索图标 |
| | WrapIcon | ✅ | ❌ | 换行图标 |
| | UnWrapIcon | ✅ | ❌ | 不换行图标 |
| | OcrIcon | ✅ | ❌ | OCR 图标 |
| | ToolIcon | ✅ | ❌ | 工具图标 |
| | Other icons | ❌ | ❌ | 其他图标文件 |
| **interactive** | | | | 交互组件 |
| | InfoTooltip | ✅ | ❌ | 信息提示 |
| | HelpTooltip | ✅ | ❌ | 帮助提示 |
| | WarnTooltip | ✅ | ❌ | 警告提示 |
| | EditableNumber | ✅ | ❌ | 可编辑数字 |
| | InfoPopover | ✅ | ❌ | 信息弹出框 |
| | CollapsibleSearchBar | ✅ | ❌ | 可折叠搜索栏 |
| | ImageToolButton | ✅ | ❌ | 图片工具按钮 |
| | DraggableList | ✅ | ❌ | 可拖拽列表 |
| | EmojiPicker | ❌ | ❌ | 表情选择器 (useTheme 依赖) |
| | Selector | ✅ | ❌ | 选择器 (i18n 依赖) |
| | ModelSelector | ❌ | ❌ | 模型选择器 (Redux 依赖) |
| | LanguageSelect | ❌ | ❌ | 语言选择 |
| | TranslateButton | ❌ | ❌ | 翻译按钮 (window.api 依赖) |
| **composite** | | | | 复合组件 |
| | - | - | - | 暂无复合组件 |
| **未分类** | | | | 需要分类的组件 |
| | Popups/* (16+ 文件) | ❌ | ❌ | 弹窗组件 (业务耦合) |
| | RichEditor/* (30+ 文件) | ❌ | ❌ | 富文本编辑器 |
| | CodeEditor/* | ❌ | ❌ | 代码编辑器 |
| | MarkdownEditor/* | ❌ | ❌ | Markdown 编辑器 |
| | MinApp/* | ❌ | ❌ | 迷你应用 (Redux 依赖) |
| | Avatar/* | ❌ | ❌ | 头像组件 |
| | ActionTools/* | ❌ | ❌ | 操作工具 |
| | CodeBlockView/* | ❌ | ❌ | 代码块视图 (window.api 依赖) |
| | ContextMenu | ❌ | ❌ | 右键菜单 (Electron API) |
| | WindowControls | ❌ | ❌ | 窗口控制 (Electron API) |
| | ErrorBoundary | ❌ | ❌ | 错误边界 (window.api 依赖) |

## 迁移步骤

### 第一阶段：复制迁移（当前阶段）

- 将组件原样复制到 @packages/ui
- 保留原有依赖（antd、styled-components 等）
- 在文件顶部添加原路径注释

### 第二阶段：重构优化

- 移除 antd 依赖，替换为 HeroUI
- 移除 styled-components，替换为 Tailwind CSS
- 优化组件 API 和类型定义

## 注意事项

1. **不迁移**包含以下依赖的组件（解耦后可迁移）：
   - window.api 调用
   - Redux（useSelector、useDispatch 等）
   - 其他外部数据源

2. **可迁移**但需要后续解耦的组件：
   - 使用 i18n 的组件（将 i18n 改为 props 传入）
   - 使用 antd 的组件（后续替换为 HeroUI）

3. **提交规范**：
   - 每次 PR 专注于一个类别的组件
   - 确保所有迁移的组件都有导出
   - 更新此文档的迁移状态
