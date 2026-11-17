# Agent Note: OpenClaw schema 检查诊断

Status: implemented

[English](2026-11-04-openclaw-schema-check-diagnostics.md) | 中文

## Problem

stderr 中的 Node 警告可能掩盖 schema 命令的实际错误，非零退出码也可能导致已经返回的 schema 被拒绝。两种情况都被误报为二进制不兼容。

## Decision

无论退出码如何，都接受捕获到的顶层 schema 对象，并将 stderr 记为诊断信息。命令不支持、成功退出但输出格式错误以及输出截断仍视为不兼容。其他非零退出错误报告检查项、退出码、有意义的 stderr 和检测到的版本；仅在该失败路径缺少版本时探测。

## Alternatives considered

拒绝所有非零退出码会丢弃可用的 schema。将所有失败都视为不兼容会在运行时错误时错误地建议升级。

## Consequences

即使命令未成功退出，也会信任有效的对象。stderr 按警告块扫描，块外错误形状的行优先；只有警告时会明确标示。版本探测取 stdout 的首条非警告行，未取得版本时退到 stderr 的首条非警告行。探测可能使已失败的检查增加最多五秒；探测失败不会替换原始诊断。

## Verification

- AC1 — `node node_modules/vitest/vitest.mjs run --project main src/main/services/__tests__/OpenClawService.test.ts`：验证非零退出时保留有效 schema，且失败包含有用的诊断信息。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/services/__tests__/OpenClawService.test.ts`：保护命令不支持、无效 JSON 和超时行为。
