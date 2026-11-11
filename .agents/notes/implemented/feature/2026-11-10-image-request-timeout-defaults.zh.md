# Agent Note: 按提供商设置图像请求超时默认值

Status: implemented

[English](2026-11-10-image-request-timeout-defaults.md) | 中文

## Problem

目前没有可复用的图像请求超时设置。提交时 600,000 毫秒的默认值和草稿单独覆盖值已经发布，但用户不能为每个提供商保存一个值。

## Decision

提供商记录增加可选的整数毫秒值 `settings.imageRequestTimeoutMs`，范围为 10,000–1,800,000 毫秒。PATCH 中的 `null` 会删除该值；未设置时使用回退值。渲染进程在请求和显示时按草稿覆盖值 → 提供商值 → 600,000 毫秒的顺序解析，草稿不会预先复制提供商值。仅在切换到其他提供商时清除显式草稿覆盖值。

该设置只适用于已支持它的四个提供商 ID：`ppio`、`dashscope`、`modelscope` 和 `tokenhub`。提供商的 API 设置抽屉负责编辑，绘画创作区的设置弹出框显示有效值。通用的 `settings.timeout` 保持不变。

## Alternatives considered

- 使用 `feature.paintings.*` 偏好映射会重复提供商的所有权，还需要单独管理生命周期。
- 复用导出的通用 `settings.timeout` 会把图像请求与不相关的设置混在一起。
- 按模型存储无法提供所需的按提供商默认值，还会重复设置。
- 在新草稿中快照提供商值会阻止实时继承后续修改。
- 提交后在主进程解析回退值，会使渲染进程无法显示有效值并在提交时一致地捕获它。

## Consequences

只增加一个可选 JSON 设置，无需迁移或回填默认值。没有覆盖值的打开草稿会跟随之后的提供商编辑；显式覆盖值保持独立。已提交的任务保留其捕获的值。不受支持的提供商或以 UUID 克隆的提供商保持原有行为。回滚只需删除该字段和编辑器。

本次自动化交付属于维护者关于无需另开已批准 Spec PR 即交付 #22679 可逆部分的指示范围；不声称此前获得过人工 Spec 批准，产品决策由审阅者接受与否决定。

## Verification

- AC1 — 共享提供商 schema 测试与主进程 ProviderService 更新测试覆盖校验、可空 patch 删除和持久化。
- AC2 — 渲染进程 `PaintingSettings` 与 `paintingPipeline` 测试覆盖有效值、继承，以及交给生成路径的超时值；`usePaintingModelSwitch` 覆盖切换 provider 后的草稿状态。
- AC3 — ProviderApiOptionsDrawer、ProviderHeader 和 useProviderMeta 测试覆盖编辑器保存、清除、失败、支持的可见性和不支持的提供商；usePaintingModelSwitch 测试覆盖切换后合并的草稿状态。
- AC4 — `i18n-check` 和 Web TypeScript 检查通过。
- Regression — Node TypeScript 检查在未修改的 `AgentSessionRuntimeService.ts(1088,71)` 报告 TS2322；未修改的基线树可复现相同错误，与本次变更无关。
