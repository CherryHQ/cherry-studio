# 知识库界面 antd 迁移指南

最新扫描结果显示，`src/renderer/src/pages/knowledge` 目录中 **已完全移除 antd 依赖**。本文档记录迁移完成状态及后续仍需推进的样式治理计划，便于团队持续维护。

## 当前状态

### antd 迁移
- **antd 引用**：0 个文件，0 个组件。✅ **已完成**
- **验证命令**：`rg "from 'antd'" src/renderer/src/pages/knowledge -n`（运行时间：2025-01-16）。
- **完成节点**：`StatusIcon.tsx` 中的进度展示已切换至 HeroUI/自研组件，至此知识库页面全部 UI 组件遵循 HeroUI/shadcn 体系。

### styled-components 迁移至 Tailwind CSS
- **进度**：1/6 文件已完成（约 16.7%）
- **已完成**：`KnowledgePage.tsx`（6 个组件）
- **待迁移**：5 个文件，约 20+ 个 styled 组件

## 历史记录

- 2025-01-10：首次梳理共 13 个 antd 组件（Dropdown、Tabs、Modal 等）。
- 2025-01-13：`KnowledgeSearchPopup`、`KnowledgeBaseFormModal` 等弹窗、列表类组件迁移到 HeroUI。
- 2025-01-16：`StatusIcon` 最后一个 antd 组件（Progress）完成替换，知识库页面去除 antd。
- 2025-01-16：`KnowledgePage.tsx` 完成 styled-components 到 Tailwind CSS 迁移，移除 6 个 styled 组件。

> 如需复核历史细节，可查阅同分支的提交描述或执行 `git log -- docs/knowledge/knowledge-antd-migration.md`。

## 后续工作：样式从 styled-components 迁移至 Tailwind

虽然 antd 已拆除，知识库页面仍大量依赖 `styled-components`。建议以 TailwindCSS 为核心样式方案，统一与 HeroUI 生态。

### 已完成迁移

- ✅ `KnowledgePage.tsx` - 已将 `Container`, `ContentContainer`, `KnowledgeSideNav`, `MainContent`, `AddKnowledgeItem`, `AddKnowledgeName` 等 6 个 styled 组件迁移至 Tailwind CSS

### 待迁移组件列表

| 文件 | styled 组件列表 | 说明 |
| --- | --- | --- |
| `KnowledgeContent.tsx` | `MainContainer`, `HeaderContainer`, `ModelInfo`, `ItemContainer`, `ItemHeader`, `StatusIconWrapper`, `RefreshIcon`, `ResponsiveButton`, `FlexAlignCenter`, `ClickableSpan` | 主内容区框架、头部信息、按钮响应式样式 |
| `components/StatusIcon.tsx` | `StatusDot` | 状态圆点与动画 |
| `components/KnowledgeSearchItem/index.tsx` | `ResultItem`, `TagContainer`, `ScoreTag`, `CopyButton`, `MetadataContainer` | 搜索结果卡片及交互样式 |
| `components/KnowledgeSearchItem/VideoItem.tsx` | `VideoContainer`, `ErrorContainer` | 视频预览和错误提示 |
| `components/KnowledgeSettings/styles.ts` | `SettingsPanel`, `SettingsItem` | 设置面板列布局、条目样式 |

### 推荐迁移步骤

1. **布局容器优先**：
   - 将 `KnowledgePage.tsx` 与 `KnowledgeContent.tsx` 的基础容器改写为 Tailwind className（`flex`, `min-h`, `border`, `gap` 等）。
   - 利用 CSS 变量或 Tailwind 自定义主题保证颜色、间距与现有视觉一致。

2. **局部组件替换**：
   - 将 `StatusDot`、`ScoreTag`、`CopyButton` 等小组件改为 Tailwind 原子类，复用现有动画（例如 `animate-pulse`）。
   - 处理 Hover/Active 状态，可通过 `group`/`group-hover` 或 `data-[state]` 选择器配合实现。

3. **设置面板整合**：
   - 重构 `components/KnowledgeSettings/styles.ts`，改为导出简单的 class 字符串或直接内联于 JSX。
   - 清理不再需要的 styled-components 依赖文件。

4. **复用公共工具**：
   - 若多个页面共享样式片段，可在 `@renderer/components` 或 `@cherrystudio/ui` 中封装 Tailwind 助手（例如通用滚动容器、按钮变体）。

5. **回归与校验**：
   - 每次迁移后跑 `yarn build:check`，并手动验证知识库主要流程（拖拽排序、搜索弹窗、设置表单、进度状态）。
   - 对比迁移前后截图，确保布局与交互一致，必要时更新设计文档。

### 完成定义（DoD）

- 知识库目录中不再存在 `styled-components` 引入。
- Tailwind class 复现原有视觉，含暗色模式、Hover、Active、Scrollbar 等状态。
- `KnowledgeSettings` 面板样式统一，复用 HeroUI/Tailwind 现有变量。
- 文档和变更记录更新，便于后续团队成员追踪。

## 通用注意事项

- 新增 UI 组件务必优先使用 HeroUI 与 Tailwind，避免重新引入 antd 或额外的 CSS-in-JS 方案。
- 若 HeroUI/Tailwind 出现功能空缺，可在项目内部封装轻量组件，但需与团队沟通并记录在文档中。
- 样式迁移涉及大量视觉细节，请在 PR 中邀请设计/QA 回归，确保体验没有回退。

如需额外的迁移脚本、样式对照表或 Tailwind 配置支持，请联系 UI 平台组协助。
