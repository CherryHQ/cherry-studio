# Agent Note: 从文件来源重新同步系统技能

Status: implemented

[English](2026-11-10-system-skill-resync.md) | 中文

## Problem

系统导入会把来源目录复制到托管库中，因此当 `~/.claude/skills` 中的来源仓库执行 `git pull` 后，已安装的副本就会过时。`checkRemoteUpdate` 对所有非市场技能一律返回 `not_remote`，而 `importSystem` 对已导入的目录直接报错 `System skill is already imported`。唯一的变通办法是先卸载再重新导入，但这会硬删除数据行、级联删除全部 `agent_skill` 行，并插入新的技能 id——所有启用过该技能的智能体都会被静默关闭。

## Decision

来源为本地目录的系统技能现在成为可更新来源，且更新过程保持其身份不变：

- `hasSkillLocalUpdateProvenance`（`src/shared/utils/skillMarketplace.ts`）把 `source === 'system'` 且 `sourceUrl` 为 `file:`、内容哈希为目录哈希的技能视为更新来源，与原有的市场规则并存。
- `checkRemoteUpdate` 与 `applyRemoteUpdate`（`src/main/ai/skills/SkillService.ts`）通过本地读取支持 `system` 技能：对 `file:` URL 做 `realpath` 解析，若指向托管库或镜像根目录内部、或不是目录则拒绝，并像市场拉取一样计算哈希。修订号、`localChanges` 与显式覆盖语义与市场更新完全一致，同一数据行 id、`agent_skill` 行与镜像均保持不变。
- `importSystem` 对已注册的同源目录不再抛错，而是就地重新同步（`resyncSystemSkillLocked`）：校验持久化的来源仍解析到被发现的同一目录，替换托管文件，刷新名称、描述、版本、标签、内容哈希、规范 `sourceUrl` 与命名空间，然后重新链接镜像并通知投影。显式重新导入会无条件覆盖托管副本的编辑；而检查/应用路径在存在本地修改时仍要求覆盖标志。
- 快照不可变且带漂移校验（`snapshotLocalSkillSource`）：以 `strict:true` 复制实时 `file:` 来源，把快照描述符从 `skill.md` 规范为 `SKILL.md`，再比对快照哈希与实时来源哈希，最多重试三次。持续漂移则中止并保留上一次安装，绝不发布不完整目录。
- 内容哈希感知可执行位且描述符规范化（`src/main/ai/skills/SkillInstaller.ts`）：新安装持久化 `directory-sha256-v2:`（顶层 `skill.md`/`SKILL.md` 一律按 `SKILL.md` 计算哈希，可执行文件额外计入 `:exec:` 标记并记录确切执行位；不可执行文件哈希 hex 与旧版 `directory-sha256:` 一致，但前缀不同）。当托管树与来源一致而基线过期时（`remoteHash == currentHash != baseline`），`checkRemoteUpdate` 自愈基线并返回 `up_to_date` 且 `localChanges:false`。迁移前的 `directory-sha256:` 基线可通过旧指纹识别一次，使未改动的旧安装无需显式覆盖即可更新；新的 `directory-sha256-v2:` 基线永远不会命中旧指纹，因此之后的模式编辑仍会被标记为脏并要求显式覆盖。
- 外部导出绝不删除自占来源（`setExportEnabled`）：当导出目标正是该技能自身的 `file:` 来源（例如 `~/.agents/skills/<folder>`）时跳过导出、保留用户拥有的来源目录，仅刷新托管副本与内部镜像。
- 崩溃恢复按基线选择（`recoverInterruptedInstallWithBaseline`）：启动时保留与持久化 `contentHash` 相匹配的完整目录——新基线保留新树、旧基线回滚旧备份/清理目录，使恢复后的文件始终与记录哈希一致。
- 界面侧：技能详情页的“检查更新”入口同样面向 `system` 技能开放，`useSystemSkills.importSkill` 接受已注册候选项，系统技能对话框的导入操作可对已导入技能重新同步。只有文件夹名冲突仍被阻止。

## Alternatives considered

- 改为引用注册而不复制（见 #21202）能彻底省去同步步骤，但改动更大，且仍需要“来源已变更”的提示，因此不能覆盖本次需求。
- 用文件监听器对账数据库与磁盘（见 #14233）比显式更新路径更深入地改变归属模型。
- 把“卸载再重装”作为唯一路径，会在每次来源变更时永久丢失按智能体的启用状态。

## Consequences

无需新增 IPC 路由、Schema 或 `SkillRemoteUpdateCheck` 变体；`not_remote` 现在只适用于既非市场也非系统的来源。本地路径只能覆盖其持久化 `file:` 来源解析到同一目录的技能行对应的托管副本，绝不触及托管库或镜像根目录内部的路径。重新同步保持技能 id，因此来源变更后已有的智能体启用状态无需逐个修复。自占导出目标的来源会被保留（跳过导出），托管副本与内部镜像仍会刷新。并发的来源变更要么重试到完整快照，要么中止并保留上一次安装。仅模式变化的来源会报告 `available`，托管侧的模式编辑需要显式覆盖，崩溃恢复始终保留与记录基线一致的目录。

## Verification

- AC1 — `src/main/ai/skills/__tests__/SkillService.authoring.test.ts`：来源版本变化后系统技能报告 `available` 与 `localChanges`，未显式覆盖时以 `REMOTE_LOCAL_CHANGES` 拒绝，显式应用后保持技能 id 与 `agent_skill` 行。
- AC2 — `src/main/ai/skills/__tests__/SkillService.authoring.test.ts`：来源与基线一致时报告 `up_to_date`，非文件系统 URL 与本地来源返回 `missing_provenance`/`not_remote` 且不访问网络。
- AC3 — `src/main/ai/skills/__tests__/SkillService.test.ts`：重复导入同一系统来源会替换托管副本、保持技能 id，并保留智能体启用状态。
- AC4 — `src/renderer/hooks/__tests__/useSkills.test.ts` 与 `src/renderer/components/resourceCatalog/dialogs/skill/__tests__/SystemSkillDialog.test.tsx`：已注册的系统技能可从 Hook 与对话框重新导入，文件夹名冲突仍被阻止；所触及文件的 `npx tsc --noEmit` 与 `npx eslint` 均通过。
- 健壮性 — `src/main/ai/skills/__tests__/SkillService.authoring.test.ts`：自占导出保留（位于 `~/.agents/skills` 的来源刷新托管副本与内部镜像且不删除来源）、小写描述符规范化且无误报 `localChanges`、托管树与来源一致时自愈过期基线、按基线的崩溃恢复（新基线保留新树、旧基线回滚旧树，覆盖 `.bak` 与 `.cleanup`）、新增辅助文件被完整纳入且持续漂移时中止并保留旧安装、可执行位来源变更可检出且托管侧模式编辑受显式覆盖保护（Windows 跳过）、未改动的旧版可执行（`directory-sha256:`）基线无需显式覆盖即可更新（Windows 跳过）；`src/main/ai/skills/__tests__/SkillService.test.ts` 与 `SkillInstaller.test.ts`（200 个用例）仍全部通过。
