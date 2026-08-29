# 阶段 1 计划：数据正确性根基（D1 writer coordinator + D2 DB-FS 共同快照）

> **📄 文档优先级（双源冲突规则）**：本 plan = 正文 + 文末「对抗 review 细化修正」段双源。冲突时**以文末修正为准**；正文未改的旧段（旧伪码 / 旧验收 / 旧 Design）若与修正冲突即作废。实施前先读文末修正段。

> 目标：消除 A1（writer quiesce 不完整 → snapshot 后写入被 promotion 静默覆盖丢数据）+ A2（DB 与 FS 无共同一致性快照 → DB row 与 payload 版本不一致）。
> 工时 ~2-3 周。拆 2 个 PR（1a coordinator / 1b 快照）。1b 依赖 1a。

---

## PR 1a · 统一 writer coordinator

### PRD

**目标**：所有 live DB / 文件 / cache / preference writer 在 restore quiesce 期间被统一 gate（admission + in-flight drain + epoch fencing），消除"snapshot 后写入被覆盖"。

**范围**：
- `quiesceGate` 升级：模块级 boolean → **epoch/lease**（acquire 返唯一 lease，release 须匹配当前 epoch，stale lease 不清新 gate）
- 统一 writer registry + in-flight drain（gate 前已进入的 writer 必须等完成才 snapshot）
- 迁移所有 writer 入口到 `assertWriteAllowed`：
  - DataApi mutation（`IpcAdapter.ts:65-81` 已有入口 gate → 加 in-flight registry）
  - `PreferenceService.set/setMultiple`（`:263-281,366-370` 已有入口 gate → 加 registry）
  - `CacheService.Cache_Sync`（`:813-851` 旁路 → 加 gate）
  - `ipc.ts:185-203` File_*（Save/Write/Move/Rename/Mkdir）+ legacy Backup_*（旁路 → 加 `assertNotBackupInProgress`）
  - **KnowledgeService 索引写 / SkillService 目录写 / NotesService 笔记写**（fs 写入口 → `assertWriteAllowed`；若含 DB 直写走 fingerprint 兜底，见修正 1）— **1b resource quiesce hold 依赖此 inventory 完整，否则 A2 DB-FS 一致性有漏洞**
  - `DbService` direct DML inventory（所有 `getDb().insert/update/delete`）→ 迁 `withWriteTx`（gate）
- **restore 自身 work DB 写入不被 live gate 阻**（detached work DB 边界）

**不在范围**：drain 分级 timeout（阶段 4）、Channel durable（上游 #16849）、resource quiesce（PR 1b）

**验收标准**：
1. gate 未持时所有 mutation 正常执行
2. gate 持时 DataApi/Preference/Cache/File/withWriteTx/direct DML 全拒（`BackupInProgressError`）
3. writer 在 gate acquire 前进入 → registry drain 等完成才放行 snapshot
4. 并发无 snapshot race（writer 与 acquire 竞态）
5. stale lease（旧 service instance）release 不清新 gate
6. restore work DB 写入不被 live gate 错阻

### Design

**`RestoreWriteCoordinator`**（新 service，替换 quiesceGate；fencing token 命名 `WriteEpoch` 以区别 stage3 `RestoreGeneration`，N10）：
```ts
type WriteEpoch = number  // coordinator 级 fencing token（区别 stage3 3b RestoreGeneration restore-instance 级）
type WriteLease = { restoreId: string; epoch: WriteEpoch; acquiredAt: number }

class RestoreWriteCoordinator {
  private lease: WriteLease | null = null
  private inflight = new Set<Promise<unknown>>()
  acquire(restoreId: string): WriteLease   // 原子设 lease，返回唯一 WriteEpoch
  release(lease: WriteLease): boolean      // 匹配当前 epoch 才清，stale 拒
  registerInflight<T>(p: Promise<T>): Promise<T>  // writer 进入注册
  async drain(deadline: number): Promise<void>    // 等所有 inflight 或 deadline
  assertWriteAllowed(): void          // 所有 writer 入口调，gate 持时 throw
  isHeld(): boolean
}
```

**epoch fencing**：`release` 必须传 acquire 返回的 lease；service restart 后旧 lease 的 epoch 已过期，新 acquire 的 epoch 不同 → stale release 拒。防"B5 sealed restore service stop 误释放"（阶段 3 持久化 lease 衔接）。

**writer inventory**（必须完整，虚假安全是最大风险）：
| writer | 当前状态 | 迁移 |
|--------|---------|------|
| DataApi mutation（IpcAdapter） | 入口 gate | + inflight registry |
| PreferenceService.set/setMultiple | 入口 gate | + registry |
| CacheService.Cache_Sync | **旁路** | + assertWriteAllowed |
| ipc.ts File_Save/Write/Move/Rename/Mkdir | **旁路** | + assertNotBackupInProgress |
| legacy Backup_Backup* | **旁路** | + gate |
| **KnowledgeService 索引写（fs+DB）** | **入口待 inventory** | fs → gate；DB 直写 → fingerprint 兜底 |
| **SkillService 目录写（fs）** | **入口待 inventory** | + assertWriteAllowed |
| **NotesService 笔记写（fs）** | **入口待 inventory** | + assertWriteAllowed |
| DbService.withWriteTx | 不查 gate | + assertWriteAllowed |
| getDb().insert/update/delete（直写） | **旁路** | inventory → 全迁 withWriteTx |

**direct DML inventory 方法**：`grep -rn 'getDb()\.\(insert\|update\|delete\)' src/main/` 全量列，逐个迁 `withWriteTx`（gate）。lint 规则禁 `getDb()` 直写（除 snapshot 读）。

**in-flight registry 语义**：writer handler 入口 `coordinator.registerInflight(asyncWork)` → acquire 前 registry 非空 → `drain(deadline)` 等 allSettled → 超时则 straggler 进 fail-closed（与现有 Channel/AI/Agent/Job drain 一致）。

**live vs work DB 边界**：gate 只阻 live DB（`DbService.getDb()` 写 + snapshot），restore 的 detached work DB（staging work.sqlite）写不受阻（不同 connection/path）。

### Implement steps（每步验证）

1. 建 `RestoreWriteCoordinator` + 单测（acquire/release/epoch fencing/drain/registry）→ verify: 单测绿
2. 迁 DataApi/Preference 入口 gate → `assertWriteAllowed` + `registerInflight` → verify: 现有 DataApi/Preference 测试绿 + 新 inflight 测试
3. Cache_Sync + File_* + legacy Backup 加 `assertWriteAllowed` → verify: gate 持时拒测试
4. direct DML inventory（grep 全量）→ 逐个迁 `withWriteTx` + lint 规则 → verify: inventory 清单全测 + lint 禁直写
5. BackupService.startRestore 用 `coordinator.acquire` + `drain`（替代当前 pause/drain 调用）→ verify: 现有 restore 测试绿
6. 端到端并发测试（snapshot 期 writer race / stale lease / work DB 边界）→ verify: 并发测试绿

### 测试矩阵
- gate 未持：每类 writer 正常
- gate 持：每类 writer 拒（BackupInProgressError）
- inflight：writer 进入后 acquire，drain 等完成
- 并发 race：writer 与 acquire 竞态无 snapshot race
- stale lease：旧 epoch release 拒
- work DB：restore 写 work DB 不受阻
- direct DML：inventory 每点覆盖
- lint：禁 getDb() 直写

### 风险 + 回滚
- **inventory 不全（虚假安全）** → 完整 inventory 文档（commit 里）+ 端到端并发测试 + lint 规则强制
- **全局 gate 阻 restore 内部 live 写** → 明确 live/work 边界 + 测试；restore 若需写 live（如 journal）走 backup.* exempt
- **回滚**：coordinator 是新模块，旧 `setBackupInProgress` 保留作 fallback（双跑期）；PR 独立可 revert

---

## PR 1b · DB-FS 共同一致性快照（依赖 1a）

### PRD

**目标**：export 时 DB snapshot 与 FS payload 有共同一致性快照（resource quiesce + content hash + combined fingerprint），消除"DB row 与 payload 版本不一致"。restore 时校验 contentHash drift → fail-closed。

**范围**：
- `startBackup` DB snapshot 前获 **resource quiesce hold**（盖 File/Knowledge/Skill/Notes writer，复用 PR 1a coordinator）
- `SqliteFileStager` 加 `copyFileVerified`/`copyDirectoryVerified`/`hashResource`（copy 前 stat+hash → copy → copy 后 stat+hash，source 变 → abort，半拷贝不进 archive）
- `manifest.resources[]` 加 `{contentHash, size}`；manifest 加 `combinedFingerprint`（DB hash + 所有 resource hashes）
- `admitArchive` 校验 manifest contentHash 与 archive entry 实际 hash
- restore staging copy 后校验 contentHash

**验收标准**：
1. 应用内 File/Knowledge/Skill/Notes writer 在 snapshot 前被 gate
2. source 复制前后变化 → export fail（不生成坏 archive）
3. 半拷贝目录/临时文件清理，不进 archive
4. manifest contentHash 与 staged 实际一致
5. restore 时 contentHash drift → fail-closed
6. combinedFingerprint 进 manifest，promotion 可校验

### Design

**resource quiesce hold**：`startBackup` 调 `coordinator.acquire('backup-export')` → File/Knowledge/Skill/Notes writer 全 gate（PR 1a 已迁）→ snapshot 期间无应用内写入。

**`copyFileVerified`**：
```ts
async function copyFileVerified(src, dst): Promise<{hash, size}> {
  const before = statWithHash(src)       // {mtime, size, hash}
  await copyFile(src, dst)
  const after = statWithHash(src)
  if (before.hash !== after.hash || before.mtime !== after.mtime) {
    throw new BackupResourceChangedError(src)  // source 在复制期间变了
  }
  const dstHash = hashFile(dst)
  if (dstHash !== before.hash) throw ...       // 半拷贝
  return {hash: before.hash, size: before.size}
}
```

**`copyDirectoryVerified`**（**D11 落点：symlink defense-in-depth，解 B15**）：递归 + 每文件 `copyFileVerified` + 聚合 treeHash（sorted entries hash）+ **每成员 `lstat`+`realpath` 校验**（`lstat` 非 follow 打开 + realpath 解析后路径必须 lexical-contain 在 root 下；符号链接越出 root → `BackupSymlinkEscapeError`，不进 archive）。此 `lstat`+realpath+lexical 覆盖架构 D11 `O_NOFOLLOW` 语义（且更强：递归验每个成员）。防 staging/promotion 路径 TOCTOU 替换越出 userData。

**manifest schema 扩展**：
```ts
resources: Array<{kind, path, contentHash, size}>  // 现有 + contentHash/size
combinedFingerprint: string   // hash(DB.fingerprint + sorted(resource.contentHash))
```

**admitArchive 校验**：解压时算 entry hash → 与 manifest contentHash 比，不匹配 → `BackupResourceCorruptError`。

**restore staging 校验**：copy 到 staging 后校验 contentHash（防 staging 损坏）。

### Implement steps

1. `SqliteFileStager.copyFileVerified`/`copyDirectoryVerified`/`hashResource` + 单测 → verify: source 变 abort + 半拷贝抛
2. `ExportOrchestrator` 用 verified copy + manifest contentHash/combinedFingerprint → verify: export 一致性测试
3. `admitArchive` 校验 contentHash → verify: 篡改 archive 拒
4. `startBackup` resource quiesce hold（复用 coordinator）→ verify: snapshot 期 writer gate
5. restore staging contentHash 校验 → verify: staging drift fail-closed
6. combinedFingerprint 进 promotion 校验链 → verify: promotion 时校验

### 测试矩阵
- source 复制前后变 → abort（不生成 archive）
- 半拷贝 → 清理 + 抛
- manifest contentHash 与实际一致
- 篡改 archive entry → admitArchive 拒
- restore staging drift → fail-closed
- 应用内 writer snapshot 前 gate
- combinedFingerprint drift → promotion fail-closed
- **B15 symlink 防御（D11）**：copyDirectoryVerified 遇越出 root 的 symlink → `BackupSymlinkEscapeError`（不进 archive）+ 内部 symlink 递归 realpath 校验 + staging 期外部进程 TOCTOU 替换拒
- 大文件 hash 性能（基准）

### 风险 + 回滚
- **外部进程写入只能 hash fail-closed（不阻）** → 文档明确边界；hash 是最终防线
- **hash 大文件/大目录耗时** → 阶段 4 进度窗反馈 + 可选增量 hash
- **manifest schema 变更** → 版本号升级 + 旧 manifest 兼容读（admitArchive legacy 路径）
- **回滚**：verified copy 是新函数，旧 copy 保留 fallback；manifest contentHash optional（旧 archive 无则跳校验）

---

## 阶段 1 整体验证闭环

```bash
pnpm vitest run src/main/data/db/backup src/main/services/backup src/main/data/CacheService src/main/data/PreferenceService src/main/data/api
pnpm lint && pnpm build:check
# 端到端并发 + 一致性 e2e（阶段 6 补完整 roundtrip，阶段 1 先关键场景）
```

## 阶段 1 门槛
- vitest 绿 + lint 0 error + build:check 绿
- cursor/codex 对抗 review 无 high/medium（重点审 epoch fencing / inventory 完整性 / hash 一致性 / **B15 symlink 防御**）
- writer inventory 文档（machine-readable JSON）commit 进 repo（审计可查，stage6 traceability 消费）
- **局部 traceability**：本 plan 各 PR"测试矩阵"段即 criterion→test 映射（PR 实施时填 test ID + CI tier）；架构 Master Traceability 是汇总索引

---

## 对抗 review 细化修正（stage1 review 发现）

> review 两次因 API 失败，但留 3 个关键 design 发现。以下修正覆盖原 D1 design 决策，实施按修正后执行。

### 修正 1 · gate 层：不强迁 getDb 直写 withWriteTx，改"fingerprint backstop 兜底"

**review 发现**：把所有 `getDb().insert/update/delete` 直写迁 `withWriteTx` 违背仓库单语句 autocommit 约定（CLAUDE.md 明确单写不需 withWriteTx），且现有事务 helper 仍接受裸 getDb。inventory 实测 **189 个 getDb() 调用点**（多形态：`dbService.getDb()` / `application.get('DbService').getDb()` / `const db = ...; db.insert` 中间变量 / `jobService.setXxxTx(dbService.getDb(), ...)` 传 db 给 service 函数 / MigrationEngine exempt），逐个 gate 不可行。

**修正 design**：
- **gate 主要写入口**（DataApi mutation / PreferenceService / CacheService.Cache_Sync / ipc.ts File_* / legacy Backup / `withWriteTx`）— 这些是应用层主要写路径，gate 集中
- **getDb 直写不强制 gate**（尊重 autocommit 约定），由 **fingerprint backstop 兜底**：snapshot 前后 hash live DB，若 getDb 直写导致 drift → abort restore（fail-closed，不 mixed state；live DB 写入保留，staging 清，用户重试）
- 即"D1 主要 gate + fingerprint backstop 兜底直写"两层（与架构方案 D1 + L3 fingerprint 一致）
- **inventory 仍要做**（调用形态分析：189 点分类读/写/migration），用于：审计哪些直写点依赖 fingerprint 兜底 + 长期鼓励迁 withWriteTx（lint warning，非强制）

**验收修正**：
- 加"fingerprint drift → abort restore（不 mixed state）"测试（getDb 直写 snapshot 后 → hash 变 → abort + live 写入保留）
- inventory 文档 commit（标注哪些走 gate / 哪些走 fingerprint 兜底）

### 修正 2 · assertWriteAllowed + registerInflight 原子合并（消除 acquire/drain 竞态）

**review 发现**：`assertWriteAllowed()` 与 `registerInflight()` 分两次调用，二者之间 writer 可进入 → acquire/drain 竞态（assert 过了但 register 前，gate acquire，writer 漏 registry）。

**修正 design**：合并为单一原子 API：
```ts
class RestoreWriteCoordinator {
  // 原子：assert + register 一步，返回 release handle
  beginWrite<T>(writer: string, fn: () => Promise<T>): Promise<T> {
    this.assertWriteAllowed()            // 同步 assert
    return this.registerInflight(writer, fn)  // 同步 register 后执行
  }
}
// writer 用法：coordinator.beginWrite('FileService', () => doWrite())
```
`beginWrite` 内 assert + register 原子（同步，无 await 间隙）→ 消除竞态。

**验收修正**：加"assert 与 register 之间 gate acquire"竞态测试（注入 acquire 在 assert 后 register 前 → writer 应被 registry 跟踪或拒）。

### 修正 3 · inventory 方法：调用形态分析（非文本正则）

**review 发现**：简单 `grep getDb().insert` 正则不命中中间变量 / service 函数传 db / application.get 链形态。

**修正 inventory 方法**（实施时）：
1. grep `getDb()` 全量（189 点）→ 人工/Semi-auto 分类：
   - **读**（select/get）→ 不 gate
   - **写**（insert/update/delete 直接或经 service 函数）→ gate 或 fingerprint 兜底
   - **migration**（MigrationEngine/MigrationDbService）→ exempt（detached migration DB）
2. 中间变量追踪（`const db = ...getDb()` 后续 db.insert）→ 手动审计 + IDE rename/find usages
3. service 函数传 db（`jobService.setXxxTx(db, ...)`）→ 追踪 service 函数内是否写
4. 输出 inventory 清单（commit 进 repo，**machine-readable JSON** 供 stage6 traceability 消费）：每点 `{file, line, writer, type: 'read'|'write'|'migration', gate: 'assertWriteAllowed'|'fingerprint-backstop'|'exempt'}`

**验收修正**：inventory 清单可审计；新增 getDb 直写点时 lint warning（鼓励 withWriteTx）。

### 工时修正
- 原 PR 1a 含"direct DML 全迁 withWriteTx" → 改为"inventory + 主要入口 gate + fingerprint 兜底"，工时下调（不强迁 189 点）
- PR 1a ~3-5 天（原 5-10 天），PR 1b 不变 ~3-5 天
