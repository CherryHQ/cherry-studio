# 阶段 6 计划：测试矩阵 + e2e + 对抗 review

> **📄 文档优先级（双源冲突规则）**：本 plan = 正文 + 文末「对抗 review 细化修正」段双源。冲突时**以文末修正为准**；正文未改的旧段（crash matrix oracle 以 P0-1/P0-2 进程边界为准）若与修正冲突即作废。实施前先读文末修正段。

> 目标：填测试缺口（之前 plan 的 it.todo roundtrip）+ 全场景覆盖（crash matrix/大库/跨设备/并发/多 restore）+ 多轮对抗 review 到无 high/medium。
> 工时 ~1 周。3 PR（6a e2e roundtrip / 6b crash matrix + 场景 / 6c 对抗 review 闭环）。
> 前置：阶段 1-5 完成（本阶段是整体验证）。

---

## PR 6a · e2e 真实 DB roundtrip

### PRD
**目标**：真实 export→admit→restore merge→promotion 完整 roundtrip e2e（当前 `restore.full.resources.test.ts:427` 是 `it.todo`）。真实 export 产的 `.cherrybackup` 被真实 restore 消费，promotion 文件落盘 userData 验证。

**范围**：
- 新 `src/main/services/backup/__tests__/e2e/restore.roundtrip.test.ts`
- 复用 `setupTestDatabase`（真实 file-backed SQLite + production migrations + FTS5）+ mkdtemp userData + `application.getPath` spy（5 keys + 文件 roots 指 temp）
- seed 跨 domain（preference/user_provider/topic/message/file_entry + 真实 blob + KB dir + skill dir + notes）
- 真实 ExportOrchestrator → ImportOrchestrator → runRestorePromotion
- 验证：live DB 含 backup rows（fresh-install backfill）+ 文件 promote 到 userData（内容一致）+ journal completed + PRAGMA foreign_key_check/integrity_check OK + captureLiveFingerprint 匹配 + broadcast backup.restore_summary

**验收**：真实 roundtrip 在真实 DB（production migrations + FTS5）上绿，全程 os.tmpdir 内不破坏生产。

### Design / Implement（e2e 流程见 §PR 6a 流程步骤 + 对抗修正 P0-3 进程边界拆两层）
1. seed live DB（drizzle schema-typed 跨 domain）
2. 真实 export（ExportOrchestrator + 真实 contributor registry + SqliteBackupStripper）
3. 真实 restore（ImportOrchestrator + 真实 admitArchive + MergeEngine + quiesce mock）
4. 真实 promotion（runRestorePromotion）
5. 验证 live DB + 文件 + journal + fingerprint + broadcast

### 测试矩阵
- happy path roundtrip（全 domain seed）
- 含 SKILLS/KNOWLEDGE/Notes/MCP 资源 roundtrip
- migration chain 跨版本（schemaMigrationId migrate-forward / fork 拒）
- crash/error follow-up（staged journal relaunch 前 live 被写 → expire）

### 风险：测试隔离（temp userData + setupTestDatabase）+ 真实 fsync 慢（可接受）

---

## PR 6b · crash matrix + 大库 + 跨设备 + 并发 + 多 restore

### PRD
**目标**：覆盖所有崩溃/边界/规模场景。

**范围**：
- **crash matrix**：**row key = stage2 冻结的 `checkpoint × decisionId`（共享机读表，stage6 只扩展用例，不另造 ID 体系）**；每 checkpoint 注入崩溃（`arrange-and-crash` 关 SQLite handle + `fresh-boot-recover` 新 module graph）→ 验证 boot 恢复一致态（阶段 3a reconcile）
- **大库**：10万消息 / GB 知识库 / 大 junction restore（内存监控 + 不 OOM + 性能基准）
- **跨设备**：external file dangling（summary 提示）+ MCP dxtPath 不存在（功能降级可见）+ 路径映射
- **并发**：snapshot 期 writer race（阶段 1 coordinator）+ 多 restore retention（aside 累积）+ service restart（sealed lease fencing）
- **symlink/路径**（**只做覆盖测试，防御实现在 1b/2a**）：archive zip-slip 拒 + staging symlink 拒 + knowledge/skills 内部 symlink 防御（**挂 stage1 1b `copyDirectoryVerified` realpath + stage2 2a apply 前 lexical containment 的 test ID**）+ TOCTOU 深度防御（外部进程替换窗口）
- **journal 状态机**：非法转移拒 + monotonic step + legacy 兼容
- **cancel/relaunch**：各 phase cancel + a1 后 relaunch + sealed 禁 + relaunch idempotency
- **UI**：a1 后控制面 + late subscriber + 脱敏 + degradation + i18n + a11y

**验收**：全场景测试绿；crash matrix 每态可恢复到一致。

### Design / Implement
- crash matrix 用 **真进程边界**（`arrange-and-crash` 关所有 SQLite handle + 销毁 module graph → `fresh-boot-recover` 新 module graph 执行 `runBackupRestoreGate()`；消费 stage2 冻结的 `checkpoint×decisionId` 机读表）；`markerFailure`/`fsyncDirFailure` 单列 **I/O failure 套件**（非 crash test）
- 大库用 seeder（10万 message + GB blob，可控）
- 并发用 fake timers + registry spy
- 跨设备用 path mock

### 测试矩阵（每阶段验收的整合）
- 阶段 1：writer race / snapshot 一致 / contentHash drift
- 阶段 2：composite round-trip / inverse 失败 reconcile / decision 四层一致
- 阶段 3：undo / expired / sweeper / transition / lease fencing / OVERWRITE aside
- 阶段 4：a1 后控制面 / cancel 各 phase / 脱敏 / a11y
- 阶段 5：大库不 OOM / preflight / FTS 一致 / 资源 round-trip
- 跨阶段：crash matrix + 跨设备 + 并发

### 风险：大库测试慢（可接受，CI 分层）+ fault injection 完整性

---

## PR 6c · 对抗 review 闭环

### PRD
**目标**：cursor + codex 多轮对抗 review 全 PR 到无 high/medium。

**范围**：
- 每阶段 commit 完成后 cursor review（adversarial）+ codex review
- 修到无 high/medium（如阶段 0 的循环模式）
- 整体 roundtrip e2e + crash matrix 通过后，全量对抗 review（架构一致性 **D1-D11** + Master Traceability 全对照）

**验收**：cursor + codex 对抗 review 无 high/medium；验收标准全对照通过。

### Implement
- 每阶段：cursor review → 修 → cursor 再 review（循环到无 high/medium）
- codex adversarial-review 每阶段
- 最终全量：架构方案 D1-**D11** 全落实 + Master Traceability 表全对照（**6c 只汇总审计，映射首次发明在各 stage 局部表**）

### 风险：review 轮次多（可接受，质量门）

---

## 阶段 6 门槛（整体交付）
- e2e roundtrip 绿 + crash matrix 全态可恢复 + 大库基准达标
- cursor + codex 对抗 review 无 high/medium
- **验收标准全对照（架构 Master Traceability + 各 stage 局部表；架构无 §Beta 节）**
- 状态机图 / artifact lifecycle 图 / decision graph 图 commit（由同 transition/decision schema 生成或 CI 表驱动 test 验证）
- 阶段 0-6 全 commit + 准备开 PR（或拆多 PR 按阶段）
- **traceability**：6c 只做汇总审计（架构 Master 表 + 各 stage 局部表已建），不负责首次发明映射

---

## 对抗 review 细化修正（stage6 review：4 P0 + 5 P1 + 2 P2）

> review 结论：当前计划"正确识别测试主题，但未把验证对象/崩溃模型/CI 门槛定义成可执行可审计契约"。以下修正使其可验收。

### P0 修正

**P0-1 · crash matrix 对齐 stage2 `decisionId`（6b）**：原只枚举 ImportPhase/promotion step，但 stage2 原子性是 per-resource `decisionId` + durable state + inverse（stage2-plan.md:31,157）。row key 必须是 `decisionId`（非 ImportPhase/PROMOTION_STEP_ORDER，restoreJournal.ts:72 现只 path+kind）。
修正 — 机读 crash-case 表（每行）：
| 字段 | 内容 |
|---|---|
| caseId | 稳定 ID（如 `restore-crash-note-overwrite-after-aside`）|
| restoreId/decisionId | fixture 固定可断言 |
| durable checkpoint | DB state/resource state/promotion step/generation |
| physical fault point | 资源操作前后/fsync 前后/marker 前后 |
| fresh-boot entry | 经 `runBackupRestoreGate()`（backupRestoreGate.ts:37）|
| expected terminal | completed/reverted/failed/quarantined |
| DB oracle | fingerprint/foreign_key_check/integrity_check/domain rows |
| resource oracle | 每 decisionId 的 source/live/aside/ownership |
| idempotency oracle | 第二次 fresh boot 不改终态/文件树 |

**P0-2 · 真 crash 模型（6b）**：`markerFailure`/`fsyncDirFailure` 是**可捕获异常非进程中止**（restorePromotion.test.ts:55/restorePromotion.ts:479 catch）；同进程抛异常 catch/finally/mock cleanup + 存活 SQLite handle 会执行 ≠ 断电/崩溃后下次启动读磁盘。
修正：
- test-only `FaultPoint` seam（命名与 matrix checkpoint 一一对应）
- 每 crash case 两步：`arrange-and-crash`（持久化到边界后立即终止）+ `fresh-boot-recover`（**新进程/新 module graph** 执行 preboot gate）
- `markerFailure`/`fsyncDirFailure` 保留为 I/O failure 测试（不标 crash test）
- 每 fault point 覆盖两窗口："操作未生效" + "操作已生效但 marker 未生效"（reconcile 关键窗口）

**P0-3 · 6a 拆两层（进程边界）（6a）**：原单测试保 `setupTestDatabase` live connection（testDatabase.ts:41,71）+ 绕过 preboot shell + 直接 orchestrator 不产 broadcast（BackupService.ts:573,578）。
修正拆两层：
1. **Durable roundtrip integration**：prepare process 生成 source DB/archive → restore process admit/merge/seal 后**关闭所有 SQLite handle** → fresh-preboot process 执行 `runBackupRestoreGate()` → verification process 重开 live DB 验证
2. **BackupService lifecycle integration**：经真实 BackupService 入口覆盖 quiesce/a1 hold/summary broadcast/sealed relaunch/重复 relaunch 拒绝
path keys 需精确：`app.userdata`/`app.database.file`/`app.database.migrations`（restorePromotion.ts:372 直读）/`feature.backup.restore.file`/`feature.backup.restore.staging` + 全资源根（"5 keys + file roots"不够）

**P0-4 · coverage inventory（6a）**：手写 domain 列表会过期（stage6-plan.md:17 vs :31 声明"全 domain"）。
修正 — 静态 `CoverageSpec`：domain 列表从 full preset/contributor registry **导出**（或测试启动时比较），registry 新增 contributor/resource kind 而 spec 未更新 → **失败**。每 domain/resource kind 定义：source fixture + 唯一 sentinel / manifest 预期 / merge ConflictDecision+decisionId / promotion 后 DB+filesystem oracle / fresh-install vs merge-into-existing 两预期 / external+dangling 显式 skip-degraded outcome

### P1 修正

- **migration + scale + 跨设备分层（6b）**：migration fixture 固定（archive-schema-version + migration-chain fixture + accept/reject，含可迁移旧版/fork chain/未来版/缺 migration file，restorePromotion.ts:371 prefix 判断）；**三层 CI**（PR small correctness / nightly scale / release-manual stress，ci.yml:163 现 PR 只 main Vitest）；scale fixture 固定 seed/消息+blob 分布/磁盘预算/**max RSS**/wall time/回归比例（"不 OOM"不可验收）；benchmark 输出 CI artifact，阈值按 runner/OS 分
- **EXDEV + Windows（6b）**：path mock 不能验 EXDEV；filesystem seam 让特定 `renameSync` 抛 EXDEV（restorePromotion.ts:817）→ 断言 admission 拒或指定 terminal/reconcile（不退化为非原子 copy-delete）；"managed promotion roots 同设备"作 admission preflight 契约；CI matrix 明确 macOS/Linux/Windows 不同 durability（restorePromotion.ts:827 Win 跳 fsync，:953 现跳 Win）+ skip 原因 + 替代断言
- **durable fencing 测试（6b）**：非仅 fake timers + registry spy。每状态转移加 `state×event×guard×persisted effect` 表，测：stale generation 拒写 journal/移文件 / 同 restoreId 双调用只一获 lease / 两 restore aside-artifact 不互清 / staged TTL 但 promoting 恢复或隔离不被 sweep / 重启后租约过期 + terminal ack + artifact retention 一致
- **summary vs restore_status 时序（6a/6c）**：拆断言 — seal 前 summary 与 durable journal summary 一致（backup.ts:16,84 pre-relaunch future-tense）/ fresh boot 后 `restore_status` 返 terminal outcome+loss+degradation+failure+quarantine / renderer Playwright 覆盖 late subscriber+a11y+i18n+脱敏（tests/e2e/README.md:1 Electron E2E ≠ backup Vitest，明确哪些 Playwright 哪些 IPC contract）
- **6c traceability（6c）**："无 high/medium"非可审计门。改 immutable acceptance traceability 表：`architecture/stage criterion → test ID → CI tier → artifact → result → reviewer finding → disposition → commit`；每轮 review 固定基线 SHA；新发现必有修复 commit/明确接受风险/blocker；最终复审针对完整范围+最终 SHA

### P2 修正
- `cryptic-inventing-toucan.md`（stage6-plan.md:23 引用）仓库不存在 → 移实际 fixture topology/path mapping/SQLite close-reopen/process boundary/cleanup ownership 入 stage6，或改可追踪仓库内链接
- 状态机/artifact lifecycle/decision graph 图：须由同 transition/decision schema **生成**或 CI 表驱动 test 验证（非仅说明文档，否则无法发现设计漂移）

### 执行重排
1. 先冻结测试契约（decisionId/checkpoint/状态转移/artifact owner/terminal oracle/CI tier 表）
2. 6a 真实 durable roundtrip（分离 prepare/restore/fresh-preboot/verify 进程边界）+ 全 registry inventory
3. 6b fault matrix（每 durable effect 前后 crash + fresh boot recovery + 重复幂等 + EXDEV + Windows + lease/generation）
4. 独立 scale + UI 套件（scale 硬阈值 nightly/release 门；UI Playwright，不混入 main Vitest）
5. 6c 最终固定点审计（D1-**D11** + 阶段验收 + 测试/CI artifact 可追溯表）
