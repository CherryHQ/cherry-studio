spec: task
name: "WebSearchSettings 架构重构"
tags: [renderer, settings, websearch, refactor]
---

## 意图

重构 `src/renderer/src/pages/settings/WebSearchSettings` 的页面架构，使其更接近
`src/renderer/src/pages/settings/SelectionAssistantSettings` 的组织方式。当前任务只聚焦
页面层的结构整理、可读性提升与有限的 UIUX 精简，不改变 Web Search 的运行时能力、
数据模型或技术栈迁移方向。

## 已定决策

- 页面目录重构参考 `src/renderer/src/pages/settings/SelectionAssistantSettings`
  的模式，当前界面专用模块优先收口到 `WebSearchSettings/components/**` 与
  `WebSearchSettings/hooks/**`
- 仅当模块只被 `WebSearchSettings` 界面消费时，才允许从共享目录迁入页面目录
- 继续使用现有 `antd` 与 `styled-components` 模式，不做 Tailwind、Shadcn、
  `@packages/ui` 迁移
- 允许为精简代码而合并重复组件、提炼页面内 hook、调整局部布局与交互层级，
  但必须保留当前设置入口与主要配置流程
- 完成后的交付验证只要求运行 `pnpm lint` 与 `pnpm format`，不要求运行 `pnpm test`

## 边界

### 允许修改
- src/renderer/src/pages/settings/WebSearchSettings/**
- src/renderer/src/hooks/useWebSearchProviders.ts
- src/renderer/src/config/webSearch/**
- src/renderer/src/i18n/locales/**
- src/renderer/src/i18n/translate/**

### 禁止做
- 不要修改 `src/renderer/src/services/WebSearchService.ts`、`src/renderer/src/aiCore/prepareParams/**`
  或 provider runtime 实现来配合页面重构
- 不要新增或删除 preference key、Redux 字段、数据库 schema 或 migration
- 不要把共享运行时逻辑为了“看起来集中”而强行移动到页面目录
- 不要借本任务进行 v2 UI 迁移或样式体系迁移

## 验收标准

场景: WebSearchSettings 按页面内 components/hooks 方式重组
  测试: test_websearch_settings_refactor_co_locates_screen_only_modules
  假设 `WebSearchSettings` 目录下仍存在多个仅供当前界面使用的平铺模块
  当 本次重构完成后
  那么 `WebSearchSettings` 的目录组织参考 `src/renderer/src/pages/settings/SelectionAssistantSettings`
  那么 当前界面专用组件位于 `src/renderer/src/pages/settings/WebSearchSettings/components/**`
  并且 当前界面专用 hooks 位于 `src/renderer/src/pages/settings/WebSearchSettings/hooks/**`
  并且 `WebSearchGeneralSettings` 与 `WebSearchProviderSettings` 仍能组合出 general 与 provider 两类页面

场景: 轻量 UIUX 精简后仍保留主要配置入口
  测试: test_websearch_settings_uiux_cleanup_preserves_navigation_and_forms
  假设 允许为降低重复代码而合并区块、抽取局部组件或调整布局层级
  当 用户进入 `/settings/websearch/general`
  那么 用户仍可访问基础设置、压缩设置与黑名单设置
  并且 当 用户进入 `/settings/websearch/provider/$providerId`
  那么 用户仍可访问对应 provider 的配置表单

场景: 模块不满足单页面专用条件时禁止迁入页面目录
  测试: test_websearch_settings_rejects_moving_cross_screen_modules
  假设 某个候选模块计划迁入页面目录，但是它仍被其他页面、服务层或运行时逻辑复用
  当 本次重构完成后
  那么 该模块不应被移动到 `src/renderer/src/pages/settings/WebSearchSettings/components/**`
  并且 该模块不应被移动到 `src/renderer/src/pages/settings/WebSearchSettings/hooks/**`
  并且 `@renderer/config/webSearch/**` 与跨界面共享 hook 仅在仍属共享职责时保留在共享目录

场景: 本次任务不触发 UI 技术栈迁移
  测试: test_websearch_settings_refactor_keeps_antd_and_styled_components
  假设 本次任务只做页面架构整理
  当 修改 `WebSearchSettings` 相关界面文件时
  那么 变更结果继续使用 `antd` 与 `styled-components`
  并且 不引入以迁移为目的的 Tailwind、Shadcn 或 `@packages/ui` 重写

场景: 交付验证仅要求 lint 与 format
  测试: test_websearch_settings_refactor_verification_commands
  假设 页面重构代码已完成
  当 进行交付前验证
  那么 执行 `pnpm lint`
  并且 执行 `pnpm format`
  但是 不将 `pnpm test` 作为本任务完成前置条件

## 排除范围

- Web Search provider 的运行时行为修改
- Web Search 数据结构、preference schema、Redux state 或 migration 调整
- 将 WebSearchSettings 迁移到 v2 UI 组件体系
- 清理所有历史 i18n key、store 字段或运行时兼容代码
