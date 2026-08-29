# Cursor：对抗审 full-restore staging 计划（v2）

> **对抗审查任务。** 你和 Claude（GLM）各自独立审这份刚修正的计划，互相找盲区。Claude 侧同时在跑 3-lens workflow（logic / spec / adversarial）。你的任务：**假设这个计划仍然有错**，对照真实代码把它揪出来。不要背书，要 challenge。

## 审什么
Claude 刚修正了 5 P0 + 加了「自动判断恢复类型」。3 个计划文档：
- `.trellis/tasks/07-24-backup-v2-full-restore-staging/prd.md`
- `.trellis/tasks/07-24-backup-v2-full-restore-staging/design.md`
- `.trellis/tasks/07-24-backup-v2-full-restore-staging/implement.md`

## 不要信计划的声明，对照真实代码逐条验证
- `src/main/services/backup/BackupService.ts`（stageFileResources stub ~L434、admitArchive wrapper ~L389、ExportOrchestrator 构造 + roots L212-223、resolveNotesRoot ~L276、pendingNotesRoot）
- `src/main/services/backup/ImportOrchestrator.ts`（stageFileResources dep ~L102、workDir ~L127、调用 ~L234）
- `src/main/data/db/restore/restorePromotion.ts`（executeForward ~L429、assertNoAddConflicts ~L271、applyEntry switch ~L535、overwrite aside-first ~L547、assertPathInsideUserData）
- `src/main/data/db/restore/restoreJournal.ts`（FileResourceSchema ~L71、fileResources ~L88）
- `src/main/services/file/utils/pathResolver.ts`（resolvePhysicalPath、PathResolvableEntry）
- `src/main/services/backup/manifest.ts`（preset、skills.folders、files.ids、knowledge.bases、notes.paths）
- `src/main/services/backup/admitArchive.ts`（ArchiveContext、RECOGNIZED_DIR_PREFIXES、assertLiteManifestInvariants）
- `src/main/services/backup/presets.ts`（presetIncludesFiles）

## 计划声称已修正（逐一验证，别轻信）
1. journal paths userData-relative（`toRel=relative(userData,abs)`）
2. file livePath = `resolvePhysicalPath(row)`，非 external_path
3. skills.folders 用 `f.folderName`
4. 已存在 → `overwrite`/`note-overwrite` + asidePath；新建 → `dir-add`/`blob-add`/`note-add`
5. notes containment：userData 外 skip
- 自动判断：`if (!presetIncludesFiles(manifest.preset)) return []`；UI 删 `isV2BackupRestoreFullReady` gate
- roots：skillsRoot=`feature.agents.skills`、knowledgeRoot=`feature.knowledgebase.data`、notesRoot=`this.resolveNotesRoot()`

## 重点对抗方向（找出 Claude workflow 可能漏的）
- **applyEntry `overwrite` 对目录（KB/skills 整目录 rename）真的支持吗，还是只支持文件？** 读 applyEntry switch 全文确认——这是最大可疑点
- **aside 路径跨 resource 类冲突？aside 谁清理？** 不清理 → 无限增长；清理 → 丢回滚材料
- **partial failure 回滚**：applyEntry 抛错 mid-list，前面的 apply 回滚吗？半恢复状态有救吗？
- **磁盘满**：live→aside rename 成功，staging→live move 失败 ENOSPC → 原数据困 aside，可能被清 → **数据丢失**
- **路径穿越**：notes relPath / folderName / baseId 含 `../` → toRel 产出越界路径，preboot 才挡（太晚）
- symlink 攻击；KB index.sqlite + WAL 整目录 overwrite 时连接是否真关
- notesRoot export/restore 间变了 → 恢复到新目录（footgun？）
- stageFileResources 是 BackupService **实例方法**还是构造时注入的 inline arrow？`this` 绑定 + restoreId/usersData 闭包捕获对吗？
- FileResourceSchema 真允许 `overwrite` kind 带 asidePath 吗？允许目录语义吗？
- 删 `isV2BackupRestoreFullReady` 后有没有死引用（import / test / i18n key）
- 同时存在 dir-add 的 livePath 已是目录但内部有内容（KB 已有数据）→ overwrite 整目录会清掉用户新数据吗？

## 输出
写到 `v2-refactor-temp/docs/backup/cursor-plan-review-v2.md`：
- 每条 finding：severity（P0/P1/P2）+ title + evidence（file:line）+ failure scenario + fix
- 末尾给一句总体判断：计划可不可派工，还有什么 blocking
- 只要真问题，不要 nitpick / 风格

## 约束
- 只审，**不改代码 / 不改计划文档**
- 不 push / 不 commit
- 无 Co-authored-by

## 完成后
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "cursor plan review v2 done: <findings 数> findings, P0 <n>, 写在 cursor-plan-review-v2.md" --enter
```
