# Agent Note: Shadcn 设计系统 lint 接入

Status: implemented

[English](2026-11-11-shadcn-lint.md) | 中文

## 问题

现有 lint 流程不检查 Tailwind 类名有效性或未声明的颜色 token。仓库根目录的主题自动发现会选择 file-preview 样式表，而不是 renderer 入口。

## 决策

在现有 Oxlint 配置中为 renderer、共享 UI 源码和 file-preview 源码的 TypeScript 注册 `@shadcn/lint`。暂时显式关闭 `no-raw-colors` 和 `no-unknown-classes`，逐步清理既有调用点后再启用。Oxlint 固定为插件要求的最低版本 1.80.0。将来若以 warning 重新启用，现有命令的 `--deny-warnings` 会使这些发现阻塞 CI。ESLint 不再注册插件，避免重复诊断。

根目录的 `components.json` 指定 renderer 的 Tailwind 入口。共享组件导入使用 `@cherrystudio/ui`。UI 包保留自身配置；由于其纯主题样式表没有导入 Tailwind，插件使用它的 Storybook Tailwind 入口验证类名。

共享 ScrollArea 契约规定 padding 属于内容层，而非根节点或 viewport。本地 `cherry-scroll-area/no-container-padding` 规则检查这两个显式 class 位置，也识别导入的 `SettingsContentColumn` 包装组件；静态分析限制记录在 `scripts/lint/README.md`。已检出的既有调用点将留白移至内容层。Session Details 保留嵌套滚动区域，将摘要留白与资源列表分离，并为外层轨道预留 12px 空间。

## 考虑过的替代方案

- 保留在 ESLint：兼容，但选定方案将这些检查统一交给 Oxlint。
- 将全部规则启用为 error：组件样式覆盖、内联动态尺寸和任意值需要单独审查契约，本次不启用。

## 影响

使用 `pnpm exec oxlint --deny-warnings <changed-files>` 执行限定范围检查。规则级别和导入识别配置位于 `.oxlintrc.json`。ScrollArea 规则继续阻塞 CI；两条 shadcn 规则目前关闭。现有已声明的基础色板 token 仍视为已声明 token；本次接入不会强制仅使用语义颜色，也不能检测滚动条位置等视觉布局问题。

## 验证

以下 shadcn 正反例验证执行于最终关闭规则之前，用来证明兼容性，不代表当前已启用门禁。padding 规则保持启用。

- Regression — 三个范围的 Oxlint CLI 探针均接受 `flex p-3 bg-card text-muted-foreground rounded-xl`，并通过预期规则报告 `flex-cols` 和 `bg-not-a-real-token`，退出码为 1。相同的违规样例放在 UI 范围之外时没有诊断。
- Regression — 对 agent 上下文摘要、会话详情布局和共享滚动区域运行带 `--deny-warnings` 的限定范围 Oxlint，通过。全仓库 lint 留给 CI；这些文件之外的既有违规尚未审计。

- Regression — `pnpm test:scripts scripts/lint/__tests__/scroll-area.test.ts`：验证 padding 诊断、别名、变体、viewport 属性、内容层和祖先例外，以及无关组件和同名遮蔽。
- Regression — Electron 中使用生产 Session Details 组件和合成的长资源列表：验证 viewport 无 padding、轨道间独立的 12px 空间、数字之后的 12px 避让，以及内层滚到底后滚轮继续滚动外层。已捕获两种主题。

为既有 CSS/DOM 标记类添加精确例外，并将未声明的前景色工具类替换为语义 token 后，变更文件的 Oxlint 门禁通过。CLI 反例仍会拒绝容器 padding、未知工具类和未声明颜色。Web 类型检查在未修改的 Markdown 文件中报错。新的 ScrollArea 规则在既有 ScrollArea 调用点中通过；这些结果不表示完整 CI 门禁已通过。

布局回归验证按卡片内容宽度计算资源库列数。设置包装组件保留原有的 32px 顶部内容留白，根节点无 padding。普通文件预览随长内容增长并撑满短内容；内部滚动预览保留固定高度。Electron 实测确认长内容末尾完整预留 80px。
