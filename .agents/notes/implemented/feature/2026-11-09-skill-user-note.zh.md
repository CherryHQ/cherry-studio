# Agent Note: 已安装技能的用户备注

Status: implemented

[English](2026-11-09-skill-user-note.md) | 中文

## Problem

用户需要为已安装技能记录个人提醒，同时保留作者元数据、搜索行为与调用身份。备注需要持久保存，并在该安装技能的所有智能体视图间共享。

## Decision

每个已安装技能 ID 对应一条用户备注，存入可空 TEXT 列 `agent_global_skill.note`，由追加迁移 `0036_yummy_arclight.sql` 引入。所有智能体视图共享该行。备注只存在于数据库，不进入 SKILL.md、frontmatter、contentHash，也不导出到技能 ZIP 文件。

`PATCH /skills/:skillId` 接受包含 `isGlobalEnabled?` 与 `note?` 的部分更新，至少提供一项。备注先 trim；空串、纯空白字符串与 null 均归一为 SQL NULL。省略的字段保留原值，组合 patch 原子更新两个字段。

备注显示于设置页技能列表卡片、智能体创建/编辑 picker，以及 Composer 技能子面板和根搜索结果；Composer 两个入口使用同一批 item。设置页技能详情提供第四个显示面：带显式保存的独立备注编辑框。空备注不改变任何既有渲染。摘要单行截断，使用现有 `Tooltip` 原地查看全文。备注不进入任何搜索、排序或过滤输入。

## Alternatives considered

- 复用 SKILL.md 的 description：拒绝，因为它是作者元数据，修改会影响搜索和技能包。
- 使用独立备注表：拒绝，因为一一对应关系不需要独立生命周期或关联查询。
- 按智能体存储备注：拒绝，因为用户提醒属于已安装技能 ID，必须在智能体视图间共享。

## Consequences

卸载技能，或 reconcile 因目录删除而删除数据库行时，备注随行消失。重装不会恢复备注。

Pi 与 Pi Durable 的连接签名包含启用技能的完整 DTO 与 `updatedAt`。因此保存备注会让相关暖连接在下一次 reconcile 重建。在启动窗口内保存可能触发现有的 `configuration changed during startup` 错误并需要重试。Issue #22017 明确接受此代价，本任务不改变 runtime 行为。按更新时间排序的列表可能因保存备注而移动技能位置。

数据库持久化、列表/详情显示、Tooltip 全文与完整应用重启已由真机探针验证。智能体创建/编辑 picker 与 Composer 子面板仅有组件测试覆盖。真实技能调用、Pi/Pi Durable 暖连接重建与启动竞态，以及跨窗口刷新仍未验证。

## Verification

以下记录本轮收尾与上一轮实现实际执行的命令。多文件命令的用例数为合计，不代表逐文件数量。早先失败的尝试与成功重跑分别标明。

- Regression — `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false --incremental false`：exit 0，0 个 error。
- Regression — `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false --incremental false`：exit 2，仅既有无关错误 `AgentSessionRuntimeService.ts(1083,71) TS2322`（`UIMessageChunk | undefined`）；该文件不在本 Issue 范围。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx`：exit 0，1 文件 / 40 例通过；检查备注显示与移除。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`：exit 0，1 文件 / 159 例通过；检查子面板/根搜索显示、备注独有词不命中，以及禁用安装项与同名本地技能反例。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SkillCatalogPicker.test.tsx`：exit 0，1 文件 / 7 例通过；点击/聚焦备注保持创建分支的 checkbox 状态。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/hooks/__tests__/useSkillLauncher.test.tsx src/renderer/hooks/resourceCatalog/__tests__/useResourceCatalogController.test.tsx`：exit 0，2 文件 / 27 例通过。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx src/renderer/hooks/__tests__/useSkills.test.ts`：exit 0，2 文件 / 30 例通过。
- Regression — `node --import tsx scripts/i18n-check.ts`：exit 0，校验 101696 条翻译。
- Regression — `node node_modules/drizzle-kit/bin.cjs check --config /Volumes/cherrydev/development/cherry-studio/worktrees/issue-22017/migrations/sqlite-drizzle.config.ts`：exit 0，`Everything's fine`。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/data/api/handlers/__tests__/skills.test.ts src/main/ai/skills/__tests__/SkillService.test.ts src/main/ai/skills/__tests__/SkillService.authoring.test.ts src/main/data/db/__tests__/applyMigrations.populated.test.ts`：上一轮，exit 0；Test Files  4 passed (4); Tests  203 passed (203)。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/hooks/__tests__/useSkills.test.ts src/renderer/hooks/resourceCatalog/__tests__/skillAdapter.test.ts src/renderer/hooks/__tests__/useSkillLauncher.test.tsx src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx src/renderer/pages/settings/SkillDetails/__tests__/SkillFileBrowser.test.tsx src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SkillCatalogPicker.test.tsx src/renderer/components/resourceCatalog/catalog/__tests__/ResourceGrid.test.tsx src/renderer/components/QuickPanel/__tests__/row.test.tsx`：上一轮，exit 0；Test Files  8 passed (8); Tests  100 passed (100)。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/data/db/__tests__/skillNoteMigration.test.ts`：上一轮，exit 0；Test Files  1 passed (1); Tests  1 passed (1)。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/data/api/handlers/__tests__/skills.test.ts`：上一轮，exit 0；Test Files  1 passed (1); Tests  3 passed (3)。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx src/renderer/components/composer/variants/__tests__/agentComposerTokens.test.ts src/renderer/components/composer/quickPanel/__tests__/unifiedPanel.test.ts src/renderer/components/QuickPanel/__tests__/row.test.tsx src/renderer/components/QuickPanel/__tests__/view.test.tsx src/renderer/components/QuickPanel/__tests__/defaultStrategies.test.ts src/renderer/components/resourceCatalog/dialogs/create/steps/__tests__/CapabilityStep.test.tsx src/renderer/components/resourceCatalog/dialogs/edit/__tests__/EditDialogs.test.tsx src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx`：上一轮，exit 1；Test Files  1 failed | 8 passed (9); Tests  11 failed | 344 passed (355)。 旧 Composer mock 缺少新增备注映射；成功的单文件重跑另行记录。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/pi/piConnectionSignature.test.ts src/main/ai/runtime/pi/PiRuntimeConnection.test.ts src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts src/main/ai/runtime/claudeCode/__tests__/skillDependencies.test.ts`：上一轮，exit 0；Test Files  6 passed (6); Tests  439 passed (439)。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SkillCatalogPicker.test.tsx`：上一轮，exit 0；Test Files  1 passed (1); Tests  6 passed (6)。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`：上一轮，exit 0；Test Files  1 passed (1); Tests  158 passed (158)。
- Regression — `node node_modules/vitest/vitest.mjs run --project shared src/shared/data/api/schemas/__tests__/skills.test.ts`：上一轮，exit 0；Test Files  1 passed (1); Tests  2 passed (2)。
- Regression — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/pages/settings/SkillDetails/__tests__/SkillDetails.test.tsx src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SkillCatalogPicker.test.tsx`：上一轮，exit 0；Test Files  2 passed (2); Tests  15 passed (15)。
- Regression — `node --import tsx scripts/docsGovernance/verify-translation-pairing.ts --write .agents/notes/implemented/feature/2026-11-09-skill-user-note.md`: exit 0。
- Regression — `node --import tsx scripts/docsGovernance/verify-translation-pairing.ts .agents/notes/implemented/feature/2026-11-09-skill-user-note.md`: exit 0。
- Regression — `node --import tsx scripts/docsGovernance/verify-agent-note-format.ts`: exit 0。
- Regression — `node --import tsx scripts/docsGovernance/verify-doc-structure.ts`: exit 0。
- Regression — `node --import tsx scripts/docsGovernance/verify-doc-frontmatter.ts`: exit 0。
- Regression — `node --import tsx scripts/docsGovernance/check-doc-links.ts`: exit 0。
- Regression — `CHERRY_EDITION=global node node_modules/electron-vite/bin/electron-vite.js build`：成功；应用在 `pnpm rebuild:electron` 切 ABI 后以真实 Electron 进程启动，跑完切回 ABI。
- Regression — `node /Volumes/cherrydev/development/cherry-studio/worktrees/.tasks/issue-22017/round-1/e2e/note-probe.cjs /Volumes/cherrydev/development/cherry-studio/worktrees/issue-22017 /Volumes/cherrydev/development/cherry-studio/worktrees/.tasks/issue-22017/round-1/e2e/out`：使用隔离 profile，经产品自身的 `skill.install_from_directory` 安装仓库示例技能 `tests/e2e/regression/fixtures/skill-sample`。
- Regression — `note-probe.cjs`，Settings → Skills → 示例技能详情：`User note` 多行输入保存成功，界面出现 `Saved` 提示。
- Regression — `note-probe.cjs`，设置页技能列表：保存后，技能名称旁出现单行截断摘要（`Use this one for release no…`）；悬停该摘要，Tooltip 显示完整备注全文。
- Regression — `note-probe.cjs`，完全退出应用进程后重新启动：列表摘要与详情页输入框里仍是同一条备注（`afterRestartNotePersisted: true`）。
- Regression — 机器可读证据：`round-1/e2e/out/probe-report.json` 记录 `listShowsNote: true`、`afterRestartListShowsNote: true`、`afterRestartNotePersisted: true`；`round-1/e2e/probe.log` 输出 `tooltipMentionsTail: true`（JSON 中存为 `tooltipText: true`）。截图位于 `round-1/e2e/out/shots/`（01/02/04/05/06/07/08）。
- Regression — 仍未验证：智能体创建/编辑 picker 与 Composer 子面板的真机截图（这两处只有组件测试）；真实技能调用（AC4 的模型侧）；Pi / Pi Durable 暖连接重建与启动竞态；跨窗口刷新。
