# Agent Note: 保留 WebDAV 上传大小错误

Status: implemented

[English](2026-10-18-webdav-upload-size-errors.md) | 中文

## Problem

WebDAV 上传被 HTTP 413 拒绝后，备份界面只显示通用失败消息。自动备份还会对被拒绝的归档耗尽即时重试次数。

## Decision

仅将 WebDAV 客户端数值 `status` 为 413 的上传错误转为 `BACKUP_WEBDAV_TOO_LARGE: HTTP 413`。现有共用备份映射器显示本地化建议：排除附件，或选择上传限制更高的存储服务。自动备份立即报告该失败，同时保留下一个正常计划任务。

## Alternatives considered

- 匹配任意服务器响应文本不可靠，还可能暴露服务器私密信息。
- 硬编码坚果云限制会假定账号相关限额，而 HTTP 413 并未报告该限额。
- 分块或拆分会改变备份格式和恢复契约；本次修复不引入这些机制。

## Consequences

手动和自动备份共用此诊断。其他 HTTP 错误保留原处理方式。本次改动不会让超限归档上传成功，也不会在传输前拒绝超限归档；不声称已完成 Windows 或真实坚果云账号验证。

## Verification

- Regression — `src/main/services/__tests__/WebDav.test.ts`：缓冲与流式数据的 413 上传均产生稳定诊断；401 和 507 保留原错误。
- Regression — `src/main/services/__tests__/AutoBackupService.test.ts`：大小拒绝直接产生失败而不即时重试，下一正常计划仍可运行。
- Regression — `src/renderer/utils/__tests__/backup.test.ts`：IPC 消息映射至本地化大小提示。
