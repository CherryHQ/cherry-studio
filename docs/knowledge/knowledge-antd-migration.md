# 知识库界面 antd 迁移指南

本文档记录 `src/renderer/src/pages/knowledge` 目录内剩余的 antd 依赖，帮助团队持续推进向 HeroUI（shadcn 体系）迁移的工作。以下统计基于最新代码扫描结果。

## 迁移范围统计

- **涉及文件数**：1
- **未迁移 antd 组件**：`Progress`

| 文件 | antd 依赖 | 说明 |
| --- | --- | --- |
| `components/StatusIcon.tsx` | `Progress` | 圆形进度条，根据处理进度展示百分比 |

> 统计命令：`python3` 结合正则扫描（详见运行日志）。如需复核，可再次执行 `rg "from 'antd'" src/renderer/src/pages/knowledge -n`。

## 替换建议

| 现有 antd 组件 | 推荐 HeroUI 替代 | 迁移要点 |
| --- | --- | --- |
| `Progress` (`type="circle"`) | `CircularProgress`（`@heroui/react`）或项目内封装的圆形进度组件 | - `percent` → `value`
| | | - antd 的 `size={14}` 可改为 `className="h-3.5 w-3.5"`
| | | - 自定义颜色可通过 `className` 或 CSS 变量覆盖
| | | - 组件与 Tooltip 组合时注意居中对齐

若 `CircularProgress` 无法满足设计需求，可在 `@renderer/components` 下封装 `ProcessingCircularProgress`，对 HeroUI 组件进行二次包装，统一尺寸和颜色。

## 建议的迁移流程

1. **封装替代组件**：创建 `ProcessingCircularProgress`，接收 `value`, `isIndeterminate`, `className` 等 props，并内置默认尺寸/颜色。
2. **更新 `StatusIcon.tsx`**：
   - 将 antd `Progress` 替换为封装组件。
   - 保留现有 `Number(progress?.toFixed(0))` 逻辑，确保传入值在 0–100。
   - 复核 `Tooltip` 提示与图标颜色，确认不同状态表现一致。
3. **回归验证**：
   - 手动测试目录、文件、预处理等不同流程，观察进度条显示。
   - 执行 `yarn build:check` 保证 lint、测试、类型校验通过。

## 历史里程碑

- 其余 antd 组件（`Dropdown`、`Tabs`、`Modal`、`Typography` 等）已在此前迁移为 HeroUI/shadcn 实现。
- 目前知识库页面仅剩 `Progress` 依赖，完成迁移后可彻底移除 antd。
- 迁移完成后建议在此文件补充完成日期、责任人，方便追踪治理成效。

## 注意事项

- 新增 UI 组件务必复用 HeroUI，避免重新引入 antd 或额外的 styled-components。
- 若 HeroUI 功能不足，可在项目内部封装扩展，保持 API 简洁一致。
- 本组件涉及实时状态展示，迁移后请安排 QA 或产品进行一次流程回归。

如需帮助编写封装示例或测试计划，请在 PR 中 @UI 平台组。
