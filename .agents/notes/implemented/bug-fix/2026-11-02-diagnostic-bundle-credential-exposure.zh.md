# Agent Note: 诊断包中的凭据暴露

Status: implemented

[English](2026-11-02-diagnostic-bundle-credential-exposure.md) | 中文

## 问题

DataApi 请求日志曾包含请求参数和请求体。启用诊断功能的构建会写入 debug 日志，而常规 `app.*.log` 文件也会包含在诊断包中。内置扫描只读取 `app-error.*.log`，因此请求体中的提供商密钥可能被打包，却没有任何发现项。

## 决策

DataApi 请求日志仅保留方法、路径和请求 ID。诊断包扫描还会检查已暂存的常规应用日志，查找符合凭据形态的值，包括常见密钥前缀、授权令牌和私钥头部。发现项在写入报告前会经过秘密信息脱敏。

## 考虑过的替代方案

- 保留请求内容并依赖扫描：拒绝，因为即使扫描发现问题，日志和归档中仍会保留秘密。
- 仅脱敏特定请求字段：拒绝，因为未来新增的请求字段和参数名也可能携带凭据。
- 脱敏诊断包中的所有日志：拒绝，因为诊断包有意保持未脱敏，而发现项才是提醒用户分享前检查内容的保护措施。

## 影响

请求日志不再暴露负载详情，但仍保留足够信息以将请求与其完成记录关联起来。较早的常规应用日志中已有的凭据仍可能出现在归档中；扫描会报告问题，但不会把凭据值复制到发现项中，以便用户在分享前检查并轮换凭据。

## 验证

- 回归 — `pnpm test:main src/main/data/api/core/__tests__/MiddlewareEngine.test.ts src/main/services/diagnostics/scan/__tests__/engine.test.ts src/main/services/diagnostics/scan/__tests__/rules.fixtures.test.ts src/main/services/diagnostics/__tests__/DiagnosticBundleService.scan.test.ts`：验证 DataApi debug 调用不含请求负载、凭据 fixture 按预期匹配或拒绝，以及常规应用日志会产生已脱敏的凭据发现项。
