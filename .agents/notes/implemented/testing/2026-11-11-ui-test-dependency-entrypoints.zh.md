# Agent Note: 在 renderer 测试中使用日期依赖的 CommonJS 入口

Status: implemented

[English](2026-11-11-ui-test-dependency-entrypoints.md) | 中文

## Problem

导入 UI 公共入口时也会加载日期选择器。隔离的 renderer 测试会反复链接 `react-day-picker` 和 `date-fns` 的 ESM 依赖树，即使测试对象是其他组件。

## Decision

仅在 renderer 中为公共包标识 `date-fns` 和 `react-day-picker` 设置精确别名。通过以 `packages/ui/package.json` 为根的 `createRequire` 解析其支持的 CommonJS 导出，使 pnpm 选用 UI workspace 声明的依赖版本。保留现有 renderer 别名，子路径导入保持不变。

保持 Vitest 依赖优化器关闭。其他测试项目、应用构建、UI 公共导出、worker 池、测试隔离和分片数量保留现有行为。

## Alternatives considered

- Vitest 客户端依赖预打包降低了导入耗时，但真实编辑器和通知测试失败：CodeMirror 构造器和 Radix Dialog 上下文出现了身份分裂。将范围缩小到 renderer 仍能复现失败；全局启用时还会提前初始化用不到的浏览器依赖。
- 仅重定向 `date-fns`，仍需承担原生 ESM `react-day-picker` 树的开销。需要同时使用两者的 CommonJS 入口。
- 重写 UI 公共导出或关闭测试隔离，会扩大范围或让文件共享模块及 mock 状态。

## Consequences

renderer 测试选用同一已安装依赖版本的 CommonJS 形式；生产导入保持不变。固定六个文件仅收集测试的试验中，记录的导入求值耗时从 6.95～7.29 秒降至 2.64～2.65 秒，命令端到端耗时从 12.29～13.36 秒降至 7.92～7.95 秒。该试验有意跳过测试用例，不代表完整 CI 的提速。依赖升级必须保留这些受支持的导出，否则配置加载会明确失败。

## Verification

- Regression — 既有 `LazyCodeEditor.theme`、`NotificationCenter`、`HtmlArtifactsPopup.session` 和 `CliConfigEditor.format` 文件在预打包时复现 21 条失败，用精确包入口别名后 21 条用例全部通过，保留对编辑器状态、撤销、格式化及对话框上下文行为的验证。
