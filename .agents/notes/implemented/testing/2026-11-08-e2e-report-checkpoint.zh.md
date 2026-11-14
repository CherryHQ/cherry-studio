# Agent Note: 在 Smoke 前发布已脱敏的回归证据

Status: implemented

[English](2026-11-08-e2e-report-checkpoint.md) | 中文

## Problem

回归证据原先要等独立 Smoke 结束才上传，而 Smoke 最长可运行一小时。这延迟了对已完成回归失败的诊断。取消已被替代的 workflow，可能使最终附件无法上传。

## Decision

分支 `all` 运行成功验证 Smoke 构建后，先完成回归检查点的报告整理与上传，再开始 Smoke。两个检查点步骤均可失败。上传要求报告整理步骤的 `outcome` 成功；即使失败步骤被容错为成功 `conclusion`，也不能放行上传。

检查点和最终报告使用相同的凭据脱敏环境、公开证据根目录与附件名称。最终报告只有在自身整理成功后才覆盖检查点。最终报告整理、平台校验和汇总校验仍为必需步骤；检查点不能作为 Smoke 验收通过的依据。

## Alternatives considered

- 取消 workflow 以获取最终报告，无法可靠保留附件。
- 上传原始运行目录，会绕过现有脱敏与私有路径边界。
- 独立命名的检查点附件可单独保留中间证据，但会新增附件生命周期和汇总契约。

## Consequences

Smoke 继续运行时，已完成回归的证据即可供检查。检查点不可用不会使原本有效的运行失败；最终报告和所有测试闸门保留原有失败行为。

上传 action 的 [overwrite 选项](https://github.com/actions/upload-artifact/blob/main/README.md#inputs) 会先删除旧附件，再上传替代附件。因此，最终替换失败或被取消时，检查点可能丢失。本改动提供提前读取机会，不保证替换期间附件始终保留。

## Verification

- Regression — `pnpm exec vitest run --project scripts scripts/e2e/regression/__tests__/reportBundle.test.ts` 的七项检查通过。结果与取消状态真值表验证：即使脱敏失败被容错为成功 conclusion，也不能上传；明确的脱敏输入和公开上传根目录保持一致。
- Regression — 同一套件以返回成功的回归命令桩执行真实汇总闸门 shell，证明测试任务失败或被取消时仍不能通过。托管检查点的可用性和最终替换仍需在完整 workflow 复跑中验证。
