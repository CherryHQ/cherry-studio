# 知识库界面 antd 迁移指南

最新扫描结果显示，`src/renderer/src/pages/knowledge` 目录中 **已完全移除 antd 依赖**。本文档记录迁移完成状态及后续仍需推进的样式治理计划，便于团队持续维护。

## 当前状态

### antd 迁移
- **antd 引用**：0 个文件，0 个组件。✅ **已完成**
- **验证命令**：`rg "from 'antd'" src/renderer/src/pages/knowledge -n`（运行时间：2025-01-16）。
- **完成节点**：`StatusIcon.tsx` 中的进度展示已切换至 HeroUI/自研组件，至此知识库页面全部 UI 组件遵循 HeroUI/shadcn 体系。

### styled-components 迁移至 Tailwind CSS
- **进度**：6/6 文件已完成（100%）✅ **已完成**
- **已完成**：`KnowledgePage.tsx`（6 个组件）、`KnowledgeContent.tsx`（10 个组件）、`StatusIcon.tsx`（1 个组件）、`VideoItem.tsx`（2 个组件）、`KnowledgeSettings/styles.ts`（2 个组件）、`KnowledgeSearchItem/index.tsx`（5 个组件）
- **总迁移组件数**：26 个 styled 组件已全部迁移至 Tailwind CSS
- **验证命令**：`rg "styled from 'styled-components'" src/renderer/src/pages/knowledge -n`（运行时间：2025-01-16）

## 历史记录

- 2025-01-10：首次梳理共 13 个 antd 组件（Dropdown、Tabs、Modal 等）。
- 2025-01-13：`KnowledgeSearchPopup`、`KnowledgeBaseFormModal` 等弹窗、列表类组件迁移到 HeroUI。
- 2025-01-16：`StatusIcon` 最后一个 antd 组件（Progress）完成替换，知识库页面去除 antd。
- 2025-01-16：`KnowledgePage.tsx` 完成 styled-components 到 Tailwind CSS 迁移，移除 6 个 styled 组件。
- 2025-01-16：`KnowledgeContent.tsx` 完成 styled-components 到 Tailwind CSS 迁移，移除 10 个 styled 组件，替换 antd 图标为 lucide-react。
- 2025-01-16：`components/StatusIcon.tsx` 完成 styled-components 到 Tailwind CSS 迁移，移除 `StatusDot` styled 组件，替换 antd 图标（`CheckCircleOutlined`、`CloseCircleOutlined`）为 lucide-react（`CheckCircle`、`XCircle`）。
- 2025-01-16：`components/KnowledgeSearchItem/VideoItem.tsx` 完成 styled-components 到 Tailwind CSS 迁移，移除 `VideoContainer`、`ErrorContainer` 2 个组件。
- 2025-01-16：`components/KnowledgeSettings/styles.ts` 完成 styled-components 到 Tailwind CSS 迁移，移除 `SettingsPanel`、`SettingsItem` 2 个组件，并删除该样式文件。
- 2025-01-16：`components/KnowledgeSearchItem/index.tsx` 完成 styled-components 到 Tailwind CSS 迁移，移除 `ResultItem`、`TagContainer`、`ScoreTag`、`CopyButton`、`MetadataContainer` 5 个组件，使用 Tailwind 的 group 机制实现复杂 hover 效果。
- 2025-01-17：扫描知识库页面 HeroUI 使用情况，发现 3 个文件共 8 个组件需要迁移到 shadcn，制定迁移计划和优先级。

> 如需复核历史细节，可查阅同分支的提交描述或执行 `git log -- docs/knowledge/knowledge-antd-migration.md`。

## 🚧 下阶段计划：HeroUI 到 shadcn 迁移

### 当前 HeroUI 使用情况

根据 2025-01-17 扫描结果，知识库页面中仍有 **3 个文件**使用 HeroUI 组件，总计 **8 个组件**需要迁移到 shadcn：

| 文件 | HeroUI 组件 | 用途 | 优先级 |
| --- | --- | --- | --- |
| `items/KnowledgeUrls.tsx` | Dropdown, DropdownItem, DropdownMenu, DropdownTrigger | URL 操作下拉菜单 | 高 |
| `components/KnowledgeSettings/AdvancedSettingsPanel.tsx` | Alert, NumberInput | 警告提示、数字输入框 | 中 |
| `components/KnowledgeSettings/GeneralSettingsPanel.tsx` | Input, Select, SelectItem, Slider | 文本输入、选择器、滑块 | 中 |

### 迁移映射关系

| HeroUI 组件 | shadcn 对应组件 | 迁移复杂度 | 备注 |
| --- | --- | --- | --- |
| Dropdown | DropdownMenu | 低 | API 相似，需要调整触发方式 |
| DropdownItem | DropdownMenuItem | 低 | 属性基本一致 |
| DropdownMenu | DropdownMenuContent | 低 | 需要适配事件处理 |
| DropdownTrigger | DropdownMenuTrigger | 低 | 直接替换 |
| Alert | Alert | 低 | 需要调整样式变体 |
| NumberInput | Input + type="number" | 中 | 需要添加数值验证逻辑 |
| Input | Input | 低 | 属性基本一致 |
| Select | Select | 中 | API 有差异，需要适配 |
| SelectItem | SelectItem | 中 | 需要调整渲染逻辑 |
| Slider | Slider | 中 | 需要适配标记点和事件 |

### 迁移建议优先级

1. **高优先级**：`KnowledgeUrls.tsx` - URL 管理核心功能，用户交互频繁
2. **中优先级**：设置面板组件 - 配置功能，相对独立，便于测试

### 注意事项

- 测试文件中的 `vi.mock('@heroui/react')` 需要同步更新
- 保持现有的样式和交互行为不变
- 确保表单验证和状态管理逻辑正常工作

## ✅ 迁移完成：样式从 styled-components 到 Tailwind CSS

知识库页面已**完全完成** styled-components 到 Tailwind CSS 的迁移，实现统一的设计系统。

### 🎉 迁移成果

- ✅ **6 个文件，26 个 styled 组件**全部迁移完成
- ✅ **100% 移除 styled-components 依赖**
- ✅ 统一使用 **Tailwind CSS + HeroUI** 生态
- ✅ 保留 **CSS 变量**确保主题兼容性
- ✅ 成功实现复杂 **hover 交互效果**（group 机制）

### 📊 迁移明细

| 文件 | 迁移组件数 | 说明 |
| --- | --- | --- |
| `KnowledgePage.tsx` | 6 | 页面布局、侧边栏、按钮等 |
| `KnowledgeContent.tsx` | 10 | 主内容区、头部信息、响应式组件 |
| `components/StatusIcon.tsx` | 1 | 状态圆点与动画 |
| `components/KnowledgeSearchItem/VideoItem.tsx` | 2 | 视频预览和错误提示 |
| `components/KnowledgeSettings/styles.ts` | 2 | 设置面板布局（文件已删除） |
| `components/KnowledgeSearchItem/index.tsx` | 5 | 搜索结果卡片及复杂交互 |

### 🔧 技术亮点

1. **复杂交互效果**：使用 Tailwind 的 `group` 和 `group-hover` 实现父子组件样式联动
2. **CSS 变量保留**：确保与现有暗色主题系统完全兼容
3. **动画效果保持**：pulse 动画、transition 效果等全部复现
4. **响应式设计**：所有断点和响应式逻辑保持一致
5. **导入导出关系**：确保组件间依赖关系不变 |

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
