# Backup v2 正确性审计

- 日期：2026-07-23
- Commit：`dd4eaf7bea`（`feat/backup-v2-restore`）
- 范围：schema 漂移 / overwrite 边界 / FIELD_MERGE notNull 缺陷 / restore-merge 边界
- 方法：4 路并行只读代码审计（drift / overwrite-edges / fieldmerge-notnull-gaps / restore-merge-edges）

---

## 1. Schema 漂移 — ✅ CLEAN（零发现）

5 类全部 clean，14 contributor ↔ codegen(`dbSchemaRefs`) ↔ drizzle schema 完全 lockstep：

1. contributor 声明的 table/column 全部存在于 codegen + drizzle（38 表）。
2. `identityKey` / `members.viaColumn` / `uniqueMergeRules` 引用全部有效（0 个悬空）。
3. references FK column 全部存在（41 单列 + 1 复合；`job` 表 2 个 FK 故意不声明 = runtime-only，无 contributor 拥有）。
4. `exemptJsonCols` / `jsonSoftReferences` 覆盖全部 JSON 列（15 表），无遗漏/误分类。
5. `dbSchemaRefs` codegen 与 drizzle schema 一致（`generatedAt 2026-07-21`，CI `backup:refs:check` 守护）。

> `migrations/sqlite-drizzle/*.sql` 是 dev-only throwaway（CLAUDE.md），release 前会重生成，不计入漂移。

---

## 2. Overwrite 边界 — 4 PASS / 1 FAIL / 5 RISK

| # | 场景 | 状态 | 说明 |
|---|---|---|---|
| 1 | 覆盖已存在 .cbu（atomic rename） | PASS | overwrite=true 跳过 existsSync，parent/managed-path 检查仍执行；fsync tmp → rename → fsync parent |
| 2 | 连续两次备份同路径 | PASS | active slot 释放后第二次 overwrite=true 不被拒；新 backupId 隔离 snapshot/staging |
| 3 | 覆盖中磁盘满 | **RISK** | rename 成功**后** parent fsync 失败 → 报错但新归档已可见、旧文件已被替换（不确定结果） |
| 4 | 覆盖中 cancel | **RISK** | fsync/rename 之间无 signal 再检查 → 用户取消但 export 仍可能完成 rename |
| 5 | 跨文件系统 EXDEV | PASS | tmp 是 outPath sibling（同卷）；若真 EXDEV，catch 删 tmp 保旧目标（但未映射专用 IPC code） |
| 6 | Windows rename 覆盖 | **RISK** | 当作 POSIX atomic-replace；无 Windows 事务/恢复保证，跳过 parent fsync |
| 7 | 目录/symlink/managed-path 目标 | **🔴 FAIL** | **managed-path 校验绕过**（见下） |
| 8 | parent 缺失/不可写 | **RISK** | 无 W_OK 检查，可读不可写目录通过 validation，到创建 tmp 才 EACCES（浪费前序工作） |
| 9 | temp GC 与活跃 export 并发 | PASS | ownership marker（pid 戳）守护，marker 存活则跳过整个 root |
| 10 | Windows 目标被占用 | **RISK** | rename EACCES/EPERM，无稳定 "file in use" IPC 映射 → 通用 INTERNAL |

### 🔴 FAIL #7：managed-path 校验绕过（安全）

`BackupService.validateOutputPath` 用 lexical `resolve()` 算 `canonical` 来查 managed-path（L804-820），但 `assembleArchive` 最终把**原始 `outputPath`** 交给 `rename`（archive.ts publish）。形如 `/safe/symlink-to-managed/../../userdata/live.db` 的 symlink + `..` 可绕过 managed-path 防护，让备份写入/覆盖 managed 路径（含 live DB）。`overwrite=true` 跳过 existsSync 后更明显。

**修复方向**：`validateOutputPath` 返回 canonical 路径，全链路（startBackup → exportBackup → assembleArchive）用 canonical 而非原始 outputPath publish。

---

## 3. FIELD_MERGE notNull 缺陷 — 27 列（Provider isEnabled 同类）

**根因**：`MergeEngine.fieldMergeRow`（MergeEngine.ts:804-874）对无 `fieldMergePolicy` 的列默认 `remote-fills-local-null`——仅当本地值为 SQL NULL 才用备份值。**NOT NULL 列永不为空**（至少 default）→ 永远保留本地、**静默丢弃备份**（无 `degradedToSkips` 提示）。`user_provider.isEnabled`（notNull default false）是已知例子。

### 3.1 全表（27 列）

| Domain | Table.Column | 类型 | 建议 | 理由 |
|---|---|---|---|---|
| PROVIDERS | user_provider.name | TEXT | **remote-wins** | 用户可见 provider 显示名 |
| PROVIDERS | user_provider.isEnabled | bool | **remote-wins** | 已知缺陷：启用/禁用是用户偏好 |
| PROVIDERS | user_provider.orderKey | TEXT | **remote-wins** | provider 列表排序 |
| PROVIDERS | user_model.name | TEXT | **remote-wins** | 模型显示名（可用户改） |
| PROVIDERS | user_model.capabilities | JSON | **remote-wins** | 已解析的模型能力配置 |
| PROVIDERS | user_model.supportsStreaming | bool | **remote-wins** | 模型流式能力 overlay |
| PROVIDERS | user_model.isEnabled | bool | **remote-wins** | 模型启用状态 |
| PROVIDERS | user_model.isHidden | bool | **remote-wins** | 模型可见性 |
| PROVIDERS | user_model.isDeprecated | bool | keep-default | runtime catalog 评估，非用户偏好 |
| PROVIDERS | user_model.orderKey | TEXT | **remote-wins** | 模型排序 |
| TAGS_GROUPS | pin.orderKey | TEXT | **remote-wins** | pin 列表排序 |
| MINIAPPS | mini_app.name | TEXT | **remote-wins** | miniapp 显示名 |
| MINIAPPS | mini_app.url | TEXT | **remote-wins** | 核心 endpoint 配置 |
| MINIAPPS | mini_app.status | TEXT | **remote-wins** | enabled/disabled/pinned |
| MINIAPPS | mini_app.orderKey | TEXT | **remote-wins** | 列表排序 |
| MINIAPPS | mini_app.bordered | bool | **remote-wins** | 视觉偏好 |
| AGENTS | agent_workspace.type | TEXT | keep-default | runtime ownership 分类 |
| AGENTS | agent_workspace.orderKey | TEXT | **remote-wins** | workspace 排序 |
| AGENTS | job_schedule.trigger | JSON | **remote-wins** | 调度配置 |
| AGENTS | job_schedule.enabled | bool | **remote-wins** | 调度开关 |
| AGENTS | job_schedule.catchUpPolicy | JSON | **remote-wins** | 补偿策略配置 |
| AGENTS | job_schedule.metadata | JSON | keep-default | 可能含 runtime bookkeeping |
| SKILLS | agent_global_skill.name | TEXT | **remote-wins** | skill 显示名 |
| SKILLS | agent_global_skill.source | TEXT | keep-default | runtime resource 分类 |
| SKILLS | agent_global_skill.isEnabled | bool | **remote-wins** | 全局 skill 启用（与 Provider.isEnabled 同类） |
| TRANSLATE_HISTORY | translate_language.value | TEXT | **remote-wins** | 语言显示标签（含自定义） |
| TRANSLATE_HISTORY | translate_language.emoji | TEXT | **remote-wins** | 语言 emoji |

### 3.2 统计

- **remote-wins（应备份覆盖本地）= 23 列**
- keep-default（保留本地 runtime state）= 4 列：`user_model.isDeprecated`、`agent_workspace.type`、`job_schedule.metadata`、`agent_global_skill.source`

### 3.3 修复方向

1. `MergeEngine` 新增 `remote-wins` FieldMergePolicy strategy（备份无条件覆盖本地非 identity 列）。
2. 给 23 个 remote-wins 列声明该 policy（按域，在各 contributor `fieldMergePolicies`）。
3. 4 个 keep-default 列维持现状。
4. **产品决策点**：哪些列算"用户偏好"（remote-wins）vs "runtime state"（keep-default）——见上表 rationale，需产品确认。

---

## 4. Restore/Merge 边界 — 14 findings（6 HIGH / 8 MEDIUM）

| 级别 | 区域 | 说明 | 位置 |
|---|---|---|---|
| **HIGH** | 恢复门禁安全 / journal 路径 | RestoreJournalSchema 只验非空字符串；promotion 用 `path.resolve(userData, journalPath)` 直接 rename/rm。绝对路径或 `../` 可让 promote/aside 指向 userData 外 → preboot 零连接窗口移动/覆盖/删除任意文件 | restoreJournal.ts:59-85 |
| **HIGH** | 崩溃恢复 / terminal journal 落盘失败 | finalize 先写 terminal journal 再删 staging；writeRestoreJournal 失败则外层 crash net 重试同样失败。live DB 已恢复 + aside 已清时 isLiveDbStranded=false，应用继续启动但 journal 仍 staged/promoting → 每次启动重复 promote/recover | restorePromotion.ts:51-72 |
| **HIGH** | B1 identity propagation / required FK | natural-key 冲突把 backup PK 映射到 local canonical PK，但只用于 pure junction；普通 owning/optional FK 和 JSON soft refs 未重写 → SET NULL/prune。可复现：workspace FIELD_MERGE 保留 local，新 agent_session.workspace_id=remote 悬空 | MergeEngine.ts:286-309 |
| **HIGH** | DB-only restore / file_entry blob | startRestore 让 stageFileResources 返回 []，但 skippedFileEntryIds 也空 → 所有 file_entry 行仍导入，无 blob。message.data 记 degradation 但不移除 file_entry/file-ref；degradedToSkips 仅日志不跨重启披露 | ImportOrchestrator.ts:183-203 |
| **HIGH** | uniqueMergeRules member conflict FK | user_model(providerId,modelId) 冲突时 fieldMergeRow 保留 local PK，但 backup→local canonical 映射不传播到普通 FK → message/assistant/knowledge_base 的 remote modelId 被 SET NULL | MergeEngine.ts:729-785 |
| **HIGH** | busy gate / service restart concurrency | activeOperation 只在实例内；onStop 仅 abort 不等待 promise；生命周期重启可同实例再次 onInit 接受新操作 → 旧 finally 与新操作并发访问 DbService/staging，旧 finally 无条件 setBackupInProgress(false) 可能解除新 restore 的 hold | BackupService.ts:130-159 |
| MEDIUM | app_state key-set invariant 时机 | merge tx 在 applyMigrations 前快照/验证 key-set；跨版本 migration 增删 key 后，最终 promote 的 key-set 已变，但检查已通过 | ImportOrchestrator.ts:195-215 |
| MEDIUM | composite FK repair partial-NULL | repairDanglingRefs 对 mixed-nullability composite FK 无条件设所有 nullable 列 NULL，未按 registry 语义决定；未来任意 mixed-null CASCADE/RESTRICT FK 被通用化处理 | MergeEngine.ts:1040-1099 |
| MEDIUM | dangling repair 同行多 FK 计数 | 同一 row 多 violation 时逐项 UPDATE/DELETE 不检查 changes；删行后后续 DELETE 0 rows 仍计 repaired+degradation；最多 10 pass 放大披露偏差 | MergeEngine.ts:1054-1113 |
| MEDIUM | FTS rebuild / migration ordering | FTS rebuild+integrity 在 merge tx 内、applyMigrations 前；跨版本 migration DROP/CREATE FTS 对象后不再 FTS check → stale rebuild 可 seal | ImportOrchestrator.ts:195-223 |
| MEDIUM | staging GC / corrupt journal | corrupt journal quarantine 后无可信 restoreId，直接递归删整个 staging root；可能删活跃 work.sqlite。README 约定 BackupService 清理 quarantined，但实现只建 .corrupt-* 不枚举不清理 | restorePromotion.ts:594-606 |
| MEDIUM | restore residual artifacts | 成功 promotion 保留 aside；post-commit failure 保留 work-failed-<id>.sqlite。BackupService recovery 只清 journal/staging，不清 aside/work-failed/corrupt → 敏感 DB 副本永久积累，restore-then-restore 可磁盘耗尽 | restorePromotion.ts:513-519 |
| MEDIUM | completed journal disclosure | completed journal 等 "B3 after acknowledge"，但无读取/ack API；下次 startRestore 直接清掉。degradedToSkips 只在 staging 进程 log，不写 journal → 重启后 completed journal 不含降级信息 | BackupService.ts:337-365 |
| MEDIUM | busy gate / pending journal vs export | startBackup 只查内存 activeOperation，不查 staged/promoting journal。正常成功路径立即 exit 窗口小，但 relaunch 被 mock / dev dialog 异常 / gate 未消费时仍可启动 export → 与已 staged restore 并存 | BackupService.ts:245-264 |

---

## 5. 优先级建议

- **P0 安全**：FAIL #7 managed-path 绕过（validateOutputPath 返回 canonical，全链路透传到 assembleArchive publish）。
- **P0 功能（等产品）**：FIELD_MERGE remote-wins（23 列，含 isEnabled/name/orderKey/status）—— 需产品确认列范围后实现 `remote-wins` strategy。
- **P1 restore**：14 findings 的 6 个 HIGH（journal 路径约束、崩溃收敛、B1 identity propagation、file_entry blob、uniqueMergeRules FK、service restart 并发）。
- **P2 边界**：overwrite RISK（#3 parent fsync 失败处理、#4 cancel 窗口、#6/#10 Windows）。
