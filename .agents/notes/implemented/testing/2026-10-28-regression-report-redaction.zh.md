# Agent Note: 在 Playwright 报告序列化前脱敏凭据

Status: implemented

[English](2026-10-28-regression-report-redaction.md) | 中文

## 问题

即使关闭追踪，Playwright 仍会在步骤标题中记录密码输入框的值。一次真实 CODE-01 运行在 blob 报告中暴露了已配置的服务商密钥。回归判定结果脱敏和截图遮罩不能清理这些步骤。

## 决策

回归配置将 RedactionReporter 放在所有其他 reporter 之前。它使用共用的已配置密钥脱敏函数，在 JSON、HTML 和 blob reporter 序列化之前，处理步骤标题以及步骤、测试和执行器错误。自定义 reporter 选择必须保留此顺序。

## 考虑过的替代方案

- 关闭追踪不能移除 blob 报告中的步骤标题。
- 运行后再清理压缩包，会在清理完成前保留原始凭据。
- 删除凭据输入步骤会导致真实服务商配置流程不再被测试。

## 影响

报告保留失败结果和步骤结构，同时用脱敏标记替换已配置的凭据。此 reporter 不处理应用日志、任意附件或截图像素；它们继续使用现有控制措施。

## 验证

- 回归 — `scripts/e2e/regression/__tests__/RedactionReporter.test.ts` 使用真实 Playwright reporter，将虚构凭据放入步骤标题和失败错误，再检查 JSON、blob 内容以及 HTML 报告内嵌 ZIP 中是否仍有原值。
