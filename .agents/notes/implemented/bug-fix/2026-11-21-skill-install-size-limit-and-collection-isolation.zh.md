# Agent Note: 将技能安装大小上限放宽至 130 MiB 并隔离集合成员失败

Status: implemented

[English](2026-11-21-skill-install-size-limit-and-collection-isolation.md) | 中文

## 问题

在 `main`（`ccc2d00c63`）上对 CherryIN 市场全部 128 个在线技能包进行实测后，确认了 issue #24986 对应的两类安装失败问题：

1. 有 2 个已上架包略微超出原有的 100 MiB（`104,857,600` 字节）`MAX_SKILL_SIZE` 上限：单个技能 `Gorden PPT Skill`（`106,791,792` 字节）和 `Openclaw Medical Skills` 集合中的 `trialgpt-matching/`（`109,892,535` 字节）。
2. `downloadSkillPackage` 在循环校验每个发现的候选技能时，一旦遇到首个失败成员就会中止整个下载流程，丢弃多技能集合中其余全部正常成员（导致 `Openclaw Medical Skills` 中 896 个技能里的另外 895 个都无法安装），而 `SkillService.installMarketplacePackage`、`SkillService.installSubscription` 和 `MarketplaceSkillDialog` 本身已经支持按成员记录部分失败。

## 决策

- 将 `src/main/ai/skills/skillArchive.ts` 中的 `MAX_SKILL_SIZE` 从 100 MiB 提高到 130 MiB（`136,314,880` 字节），覆盖所有安装路径，并在 `assertSkillDirectoryWithinLimits` 报错中保留精确字节数的同时补充可读的 MiB 数值。
- 为 `exportSkillArchive` 拆出独立的 `MAX_SKILL_EXPORT_SIZE` 并保持 100 MiB（`104,857,600` 字节），因为导出会把全部文件读入内存并通过 IPC 返回 `Uint8Array`。
- 在 `downloadSkillPackage` 中，当 `candidates.length > 1` 时隔离单个成员的校验失败（`validateRepositorySkillDirectory`、`assertSkillDirectoryWithinLimits`、`parseSkillMetadata` 和目录名冲突），将失败成员记入 `{ members, failed }` 并继续处理其余有效成员，使 `SkillService.installMarketplacePackage` 与 `SkillService.installSubscription` 完成部分安装并向前端返回逐成员错误。归档级风险（超过 `MAX_ARCHIVE_SIZE`、符号链接、路径穿越、大小写折叠冲突、空包）以及单技能包（`candidates.length === 1`）继续整包拒绝。
- 在 `downloadMarketplaceSkill` 与 `SkillSubscriptionService.detail` 中缓存包含校验失败成员在内的完整 `downloaded.members`，保证集合总数与部分安装结果一致。

## 考虑过的替代方案

- 保持 `MAX_SKILL_SIZE` 为 100 MiB：在市场后端完成上架拦截和包瘦身前，现有略超 100 MiB 的线上包仍无法安装。
- 将导出上限与安装上限同步提高：在导出改为流式写盘前，会放大 `skill.export` 的主进程内存峰值与 IPC 负载体积。
- 对单技能包（`candidates.length === 1`）也走 `failed` 隔离：会把直接明了的安装失败提示变成泛化的 `已安装 0/1` 提示，并破坏单成员拒绝契约。

## 后果

- 体积在 100 MiB 至 130 MiB 之间的技能现在可以通过 CherryIN、ZIP、GitHub、skills.sh、claude-plugins、clawhub 和 ZIP 订阅正常安装；但尝试导出超过 100 MiB 的已安装技能时，仍会抛出 `Skill exceeds the export size limit`。
- CherryIN 与 ZIP 订阅的多技能集合不再因单个成员超限或校验失败而整包失败；有效成员照常安装，失败成员带着名称与原因进入 `MarketplaceInstallResult.failed`。
- 归档级上限（`MAX_ARCHIVE_SIZE` 1 GiB、`MAX_ARCHIVE_ENTRIES` 50,000）与安全校验均保持不变。

## 验证

- Regression — `accepts a skill directory between the previous 100 MiB and current 130 MiB install ceiling`：确认 110 MiB 的技能目录能够通过 `assertSkillDirectoryWithinLimits`。
- Regression — `refuses a skill directory over the per-skill size limit, reporting its real size`：确认 140 MiB 的目录报错同时包含精确字节数与 `(140 MiB)` / `(130 MiB)` 上限说明。
- Regression — `rejects directory junctions and oversize files without exporting outside contents`：确认超过 `MAX_SKILL_EXPORT_SIZE`（100 MiB）的技能仍能通过安装上限检查，但会被 `exportSkillArchive` 拒绝。
- Regression — `installs valid collection members when another member exceeds the per-skill size limit`、`returns per-member failures when every member in a multi-skill collection exceeds the size limit` 和 `isolates oversized members when installing a ZIP subscription collection`：确认 CherryIN 与 ZIP 订阅多技能集合会隔离单个成员校验失败并清理临时目录。
- Regression — `pnpm test:main src/main/ipc/handlers/__tests__/skill.test.ts` 与 `pnpm test:renderer src/renderer/pages/marketplace/__tests__/useMarketplace.test.tsx`：31 项主进程 handler 测试与 4 项渲染进程 hook 测试全部通过。
- Regression — `pnpm test:main src/main/ai/skills/__tests__/SkillService.test.ts`：Windows 下 189 项测试通过 183 项，覆盖全部 12 项 CherryIN 市场测试及全部大小与导出边界测试；其余 6 项原有无关测试因本机 Windows `fs.promises.symlink` 报 `EPERM` 失败。
- Regression — 对 5 个改动 TS 文件执行 `pnpm exec oxfmt --check`、`pnpm exec oxlint --deny-warnings`、`pnpm exec eslint` 及 `pnpm typecheck:node`：全部零警告、零错误通过。
