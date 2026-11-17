# Agent Note: 将目录排除规则限制在选定根目录内

Status: implemented

[English](2026-11-07-directory-scan-root-boundary.md) | 中文

## Problem

隔离配置位于 `.cache` 下时，N-01 成功保存了笔记，重启后的笔记列表却为空。目录枚举将绝对根路径传给 ripgrep，默认的 `!**/.cache/**` 规则因而同时排除了根目录的祖先和子项。`build` 下的目录和模糊搜索的回退扫描也受到影响。

## Decision

将请求目录设为 ripgrep 的工作目录，以 `.` 作为搜索路径。相对于该根目录解析返回路径，调用方仍收到规范化的绝对路径。由 ripgrep 按原生忽略规则发现机制枚举可用文件，再交给 JavaScript 做模糊匹配。在 Git 仓库之外也启用忽略规则发现。正向查询 glob 会覆盖忽略规则，而只读取根目录的 ignore 判定器无法遵守嵌套例外，因此模糊候选过滤不再使用这两种机制。

## Alternatives considered

将 E2E 配置移出 `.cache` 会掩盖用户自选目录中的同类缺陷。移除默认排除规则会暴露选定目录内的生成文件和缓存。将排除规则复制到搜索模块则会使扫描和监听策略发生偏移。

## Consequences

被排除的祖先不再使选定目录变为空列表。隐藏文件和被排除的子项仍会被过滤，模糊搜索继续返回绝对路径。文件搜索过滤由 ripgrep 负责，包括嵌套 `.gitignore` 例外。JavaScript 对所有可用路径评分，不再使用正向 glob 预筛选；不改变偏好设置、存储格式或 IPC 契约。

## Verification

- Regression — `search.test.ts`：真实 ripgrep 能枚举 `.cache` 和 `build` 下的根目录，保留隐藏文件、生成子项的排除规则及隐藏条目显式启用行为，并支持跨路径段模糊匹配。根目录的 `*.md` 配合嵌套的 `!README.md` 时，无论是否有 Git 元数据，文件名和跨路径段查询都能返回被保留的文件；两个 Git 工作区用例在移除根级后置过滤前失败。
- Regression — `pnpm exec vitest run --project main src/main/services/file/tree/__tests__/search.test.ts src/main/services/file/tree/__tests__/builder.test.ts src/main/services/file/tree/__tests__/builder.events.test.ts src/main/services/file/tree/__tests__/builder.init.test.ts`：69 项通过。
- Electron — 修复前的 N-01 复现了重启后目录树为空，但笔记文件和 Markdown 内容仍在磁盘上的现象。在 `2fd3f18efc` 上，N-01 无需诊断观察器即可通过创建、自动保存和重启后显示验证；清理、报告和所选任务门禁通过，自有运行目录已删除。完整测试集验收仍单独确认。
