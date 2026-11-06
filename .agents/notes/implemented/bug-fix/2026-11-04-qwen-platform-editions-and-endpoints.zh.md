# Agent Note: Qwen 平台品牌与默认端点

Status: implemented

[English](2026-11-04-qwen-platform-editions-and-endpoints.md) | 中文

## Problem

供应商名称、链接、模型标志和默认端点需要匹配千问 AI 平台与 Qwen Cloud 品牌，同时避免覆盖用户配置。

## Decision

- 保留 `dashscope` 和 `qwencloud` 标识、凭据、模型绑定及现有版本可用性规则，包括 v1 版本豁免。
- 更新本地化平台名称及 API 密钥和模型选择链接。
- 通过供应商配置和图像传输默认值更新默认端点。保留已保存的端点覆盖值，包括旧官方 URL。
- 这些平台上的 Qwen 系列模型复用对应供应商标志，包括预设派生副本和深色模式变体。

## Alternatives considered

- 自动改写已保存的官方 URL 会将品牌更新扩大为数据迁移。因此保留用户覆盖值。
- 新增 Qwen 专属版本限制会改变现有用户的访问权限。因此保留现有可用性策略。

## Consequences

不新增数据库迁移或 v1 导入转换。现有 v1 默认值投影继续省略未修改的历史默认值，使其继承当前目录默认值；显式覆盖值仍由用户持有。

## Verification

- Regression — `ProviderModelMigrator.test.ts`：现有 v1 默认值投影与覆盖值保留。
- Regression — `ProviderService.edition.test.ts`：现有版本可用性与 v1 豁免。
- Regression — 供应商配置、图像传输及目录测试：默认端点解析与目录一致性。
- Regression — `logo.test.ts`：平台专属 Qwen 标志、预设副本及其他模型品牌保留。
