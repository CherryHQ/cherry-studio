# Agent Note: 从启动台访问统一网关

Status: proposed

[English](2026-11-19-launchpad-api-gateway.md) | 中文

## Problem

开发者连接外部工具时，经常需要启停统一网关，并检查地址、端口和 API 密钥。从「设置 → 设备连接」进入的路径较深，入口也无法固定。设备连接会跳转到现有网关设置页，这条路径及其行为需要保留。

## Proposal

按照 issue #24909 的决策卡 `cf395e0ca9f`，在现有启动台应用网格中增加内置的 `api_gateway` 卡片。`src/shared/data/preference/preferenceTypes.ts` 的 `SIDEBAR_FAVORITES` 是持久化值的上界，`src/renderer/utils/sidebar.ts` 中的渲染进程注册表决定可用能力，两处都要加入该值。保留旧的 `openclaw` 持久化值。

卡片打开 `/app/api-gateway`，由新页面 `src/renderer/pages/apiGateway/ApiGatewayPage.tsx` 承载。页面使用 `PageHeader` 和一个 `ScrollArea`，高度由标签页父容器提供。将现有网关控件提取到 `src/renderer/components/apiGateway/ApiGatewayPanel.tsx`；设置页保留原有外壳、标题、容器、宽度和滚动结构，内容交由该面板渲染。页面之间不互相导入。

共享面板展示运行状态、地址、端口和 API 密钥是否就绪，通过现有 `useApiGateway`、`api_gateway.start` 和 `api_gateway.stop` IPC 命令及 `feature.api_gateway.*` 偏好完成启停，保留现有控件行为。卡片、侧栏和页面标题复用 `code.api_gateway.title`，面板复用现有 `apiGateway.*` 及通用文案。不新增 IPC、偏好迁移或 locale 键。

固定操作复用现有侧栏快捷方式机制。启动台和侧栏进入同一路由、使用同一组件；标签页仍按现有规则替换或新开，不保证全局只有一个标签页。不自动固定，也不新增小程序。

有两处手动同步点没有类型守卫：`src/renderer/i18n/label.ts` 的侧栏标签／图标键，以及 `src/renderer/utils/routeTitle.ts` 的路由标题键，后者保证切换语言时标签标题重新本地化。实施时重新生成 `src/renderer/routeTree.gen.ts`、`resources/builtin-agents/cherry-assistant/product-manifest.json` 和 `docs/dev/sources-index.json`，并更新 `docs/dev/references/api-gateway/README.md` 中的入口路径和 `sources`。

## Alternatives considered

侧栏一级应用入口或在设置中提升入口位置都会增加常驻导航面，无法直接实现选定的启动台流程。复制面板 JSX 容易让两处控件逐渐不一致；新页面直接导入设置页则违反渲染进程的边界。完整小程序需要额外注册和生命周期，超出需求。自动固定会在用户未选择时改变其偏好。一次性产品引导需要额外状态，而原有入口仍然可用。

## Acceptance criteria

- AC1 — 启动台应用网格显示统一网关入口，点击后打开对应页面 (verification: 渲染进程组件测试和 Electron 冒烟测试 — 启动台与路由)。
- AC2 — 面板能够启停网关，并显示运行状态、地址、端口和 API 密钥是否就绪 (verification: 渲染进程组件测试和 Electron 冒烟测试 — 网关面板)。
- AC3 — 入口可固定到侧栏，侧栏打开同一面板，取消固定后启动台卡片仍在 (verification: 渲染进程组件测试和 Electron 冒烟测试 — 侧栏快捷方式与启动台)。
- AC4 — 网关停止时页面明确显示停止状态，不会空白 (verification: 渲染进程组件测试和 Electron 冒烟测试 — 网关面板)。
- AC5 — 原有设置中的网关入口和设备连接路径保持原有行为 (verification: 渲染进程组件测试和 Electron 冒烟测试 — 设置与设备连接)。
- AC6 — 面板在浅色和深色主题下正确显示，在窗口又短又窄时仍可访问所有控件 (verification: Electron 冒烟测试和文档门禁 — 网关页面与文档)。

## Risks

提取控件可能改变设置页行为，也可能意外暴露密钥；需要在两个入口验证现有掩码和控件。遗漏手动标签或路由标题映射可能导致标签未翻译或标签页标题未更新。父容器内的滚动区域必须保证小窗口下所有控件可达。生成文件和关联源码的文档需要与新路由保持同步。
