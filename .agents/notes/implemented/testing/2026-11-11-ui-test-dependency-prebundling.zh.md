# Agent Note: 在 DOM 测试中预打包 UI 日期依赖

Status: implemented

[English](2026-11-11-ui-test-dependency-prebundling.md) | 中文

## Problem

导入 UI 公共入口时也会加载日期选择器。隔离的 DOM 测试文件会反复加载 `react-day-picker` 和 `date-fns` 的模块树，即使测试对象是其他组件。在六个文件仅收集测试的剖析中，导入求值耗时为 6.81～7.41 秒；此次测量有意跳过测试用例执行。

## Decision

在共享测试配置中，为 `@cherrystudio/ui > date-fns` 和 `@cherrystudio/ui > react-day-picker` 启用 Vitest 的客户端依赖优化器。嵌套依赖标识通过 UI workspace 声明的依赖进行解析，适配 pnpm 的依赖布局。UI workspace 源码不进入优化器，使组件 mock 保留源码边界。Node 项目保留现有的 SSR 依赖处理方式。

使用 workspace 的 `node_modules` 内置优化器缓存。不新增 CI 缓存 action，不用 mock 替换真实组件，不关闭测试隔离，也不调整 worker 上限和分片数量。

## Alternatives considered

- 将 `date-fns` 重定向到 CommonJS 入口，对仅收集测试的命令提速小于预打包，而且改变了选用的模块形式。
- 此前固定文件范围的 Node 编译缓存试验未显示稳定收益，也不会合并这些导入树。
- 重写 UI 公共导出或消费者导入，会将测试运行时优化扩大为包 API 改动。
- 关闭隔离会让测试文件共享模块和 mock 状态。

## Consequences

每个测试项目先打包依赖，再由 worker 导入。六个文件仅收集测试的冷启动端到端耗时为 7.80 秒，未优化时为 12.01～13.78 秒；其导入求值耗时为 2.26 秒，重复运行时为 2.69 秒。这些本地测量不代表完整 CI 的提速。浏览器应用构建、UI 公共导出、测试清单和原生 worker 池保持不变。

## Verification

- Regression — `SessionHoverPreview`、`AgentSelector`、`AssistantSelector`、`ResourceSelectorShell`、`DiagnosticUploadPanel` 和 `ModelDrawer` 的 110 条既有 renderer 用例全部通过，覆盖真实 UI 组件及部分组件 mock 共存的场景。
- Regression — `packages/ui/src/components/composites/date-time-picker/__tests__/date-time-picker.test.tsx` 的三条既有用例全部通过，包含格式化，以及通过真实日历组件进行受控时间编辑。
- Regression — `PreviewOptions.test.tsx` 和 `PreviewLimits.test.tsx` 在共享 DOM 优化器配置下的八条 file-preview 用例全部通过。
- Regression — `scripts/__tests__/validationWorkflow.test.ts` 在保持不变的 Node 测试环境下的 23 条用例全部通过。
