# Agent Note: 将目录排除规则限制在选定根目录内

Status: implemented

[English](2026-11-07-directory-scan-root-boundary.md) | 中文

## Problem

隔离配置位于 `.cache` 下时，N-01 成功保存了笔记，重启后的笔记列表却为空。目录枚举将绝对根路径传给 ripgrep，默认的 `!**/.cache/**` 规则因而同时排除了根目录的祖先和子项。`build` 下的目录和模糊搜索的回退扫描也受到影响。

## Decision

将请求目录设为 ripgrep 的工作目录，以 `.` 作为搜索路径。相对于该根目录解析返回路径，调用方仍收到规范化的绝对路径。对模糊候选结果应用已有的 gitignore 判定器，因为忽略大小写的正向 glob 可以覆盖 ripgrep 的默认排除规则。

## Alternatives considered

将 E2E 配置移出 `.cache` 会掩盖用户自选目录中的同类缺陷。移除默认排除规则会暴露选定目录内的生成文件和缓存。将排除规则复制到搜索模块则会使扫描和监听策略发生偏移。

## Consequences

被排除的祖先不再使选定目录变为空列表。隐藏文件和被排除的子项仍会被过滤，模糊搜索继续返回绝对路径。过滤逻辑复用现有 ignore 库，不改变偏好设置、存储格式或 IPC 契约。

## Verification

- Regression — `search.test.ts`：真实 ripgrep 能枚举 `.cache` 和 `build` 下的根目录，保留隐藏文件及生成子项的排除规则，并覆盖模糊候选和回退路径。三个新增用例在修复前失败，四个用例在修复后全部通过。
- Regression — `pnpm exec vitest run --project main src/main/services/file/tree/__tests__/search.test.ts src/main/services/file/tree/__tests__/builder.test.ts src/main/services/file/tree/__tests__/builder.events.test.ts src/main/services/file/tree/__tests__/builder.init.test.ts`：65 项通过。
- Electron — 修复前的 N-01 复现了重启后目录树为空，但笔记文件和 Markdown 内容仍在磁盘上的现象。修复后的原生 E2E 验证单独记录在 PR 中。
