# 阶段 3 计划：生命周期 + 策略（D6 artifact lifecycle + journal 状态机 + restore lease + 策略解锁）

> **📄 文档优先级（双源冲突规则）**：本 plan = 正文 + 文末「对抗 review 细化修正」段双源。冲突时**以文末修正为准**；正文未改的旧段（旧 PRD"staged/promoting 超时"以 Design 仅 staged 为准；3a Implement 未拆以 PRD 3a-1/3a-2 拆分为准；RestoreArtifact 字段以 P0-3 inverseManifest 为准）若与修正冲突即作废。实施前先读文末修正段。

> 目标：消除 B5/B6（sealed restore service restart 误释放 / 新旧 instance 重叠）+ B9（undo/expired/GC 不完整）+ C1（journal 无 transition validator；**C3 relaunch idempotency 归 stage4 4b，不属本阶段**）+ 解锁 OVERWRITE/RENAME/Notes dir-swap（B2/B16）。
> 工时修正后 ~3-4 周（stage3 是最大低估，原 1-2 周 → 修正 12-18d）。**4 PR**：**3a-1**（RestoreArtifactStore sidecar + 记录 + expired）/ **3a-2**（undo API + sweeper CAS + boot sweeper）/ 3b（journal 状态机 + RestoreGeneration lease）/ 3c（策略）。3a 拆分因原单 PR 承载 6 功能点过载。
> 前置：阶段 2（decision graph + 原子事务）完成。

---

## PR 3a · artifact lifecycle（**拆 3a-1 sidecar+expired / 3a-2 undo+CAS+sweeper**；原单 PR 6 功能点过载）

### PRD
**目标**：完整 artifact 生命周期（aside/quarantine/staging/work-failed）：undo API + retention + expired 触发 + 统一 sweeper + GC。消除"aside 累积 / 用户误以为可 undo / expired 永久 pending"。

**拆分（原单 PR 过载）**：
- **3a-1**：`RestoreArtifactStore` sidecar（app DB 外 crash-safe）+ promotion 完成/失败写记录 + expired 触发（仅 staged TTL）
- **3a-2**：undo API（durable inverse + CAS lease）+ sweeper CAS（compare-and-swap + 删前重检）+ boot sweeper + acknowledge 尊重 owner

**范围**：
- `RestoreArtifact` durable store：`{restoreId, kind(aside/quarantine/staging/work-failed), path, owner, createdAt, retentionDeadline, state}`
- undo API：`backup.restore_undo(restoreId)`（用户显式回滚到 aside DB + 资源 inverse，走同一 promotion/quiesce protocol）
- expired 触发：journal `createdAt` 进 gate 逻辑（staged/promoting 超时 → `expired` + cleanup 或 quarantine）
- 统一 artifact sweeper（boot 时扫 aside/quarantine/staging/work-failed，按 retention + disk budget GC）
- acknowledge 不在 artifact owner 仍需要时删引用

**不在范围**：Channel durable（上游）、force-cancel（defer）

**验收**：
1. restore completed 后 aside 有 owner + retention + 可 undo
2. undo API 走 quiesce + promotion（与 restore 同 protocol），结果一致
3. staged/promoting 超时 → expired（不永久 pending）
4. boot sweeper 按 retention + disk budget GC（不删 active artifact）
5. acknowledge 不删仍需的 artifact 引用

### Design
**`RestoreArtifactStore`**（新，**durable sidecar JSON：独立文件 + fsync + 权限，非 app DB 表**——restore rename 整 app DB 会覆盖表，见 P1 修正）：
```ts
type RestoreArtifact = {
  restoreId: string
  kind: 'aside' | 'quarantine' | 'staging' | 'work-failed'
  paths: string[]
  owner: 'completed-restore' | 'failed-restore' | 'corrupt-journal'
  createdAt: number
  retentionDeadline: number   // 默认 7 天，可配
  state: 'live' | 'undo-available' | 'undo-applied' | 'gc-pending' | 'garbage-collected'
}
```

**undo 流程**：
```
user 调 backup.restore_undo(restoreId)
  → coordinator.acquire(restoreId + '-undo')   // 复用阶段 1 coordinator
  → 找 aside artifact + inverse resource plan
  → promotion protocol（aside → live，资源 inverse）
  → 新 aside（当前 live）留作再 undo
  → artifact state → undo-applied
```

**expired 触发**（`runRestorePromotion` 入口；**同步 P0-2：仅 staged 可 TTL expire**）：
```ts
const journal = readRestoreJournal()
// 仅 staged 可 TTL expire；promoting 必须走 D3 marker/reconcile（防 new DB+未完成资源 mixed state）
if (journal.kind === 'ok' && journal.state === 'staged') {
  if (Date.now() - parseCreatedAtMs(journal.journal.createdAt) > STALE_RESTORE_TTL) {  // 如 24h；createdAt 统一 epoch ms
    finalize(journal, 'expired', undefined, 'staged journal timed out before promotion')
    sweepArtifacts(restoreId)  // cleanup staging（保留 aside 作 forensic）
  }
}
```

**boot sweeper**（新 service，boot 时跑）：
- 扫 `RestoreArtifactStore` + 文件系统（aside/quarantine/staging/work-failed）
- 按 retentionDeadline + disk budget GC
- active restore 引用的 artifact 不删
- GC 失败 → durable diagnostic（不静默）

### Implement steps（拆 3a-1 / 3a-2，N7）

**3a-1（RestoreArtifactStore sidecar + 记录 + expired）**：
1. `RestoreArtifactStore` schema（含 P0-3 `inverseManifest`/`planHash`/`resourceStates`/`preDbArtifact`/`postDbArtifact`/`parentArtifactId`/`generation`/`undoingLease` 全字段，非仅 paths）+ sidecar CRUD + 单测 → verify: 持久化 + 读旧（无 store 视 legacy aside）
2. promotion 完成/失败写 artifact record（完整字段）+ 测试 → verify: aside/quarantine/staging/work-failed 记录
3. expired 触发（**仅 staged** TTL，gate 检查 createdAt epoch ms）+ 测试 → verify: 超时 expired + cleanup（aside 保留 forensic）

**3a-2（undo API + sweeper CAS + boot sweeper）**：
4. undo API（durable inverse + CAS lease + 独立 operation journal + `undoing`/`undoing-failed-reconciling` 状态）+ 走 promotion protocol + 测试 → verify: undo 一致 + 可再 undo + 并发 undo CAS
5. boot sweeper（durable store CAS `live/undo-available → gc-pending` + 删前重检 active journal/generation lease/undoing pin/D3 marker + 删完成才写 garbage-collected）+ 测试 → verify: GC 正确 + 不删 active + fail-closed
6. acknowledge 尊重 artifact owner + 测试 → verify: 不删仍需引用

### 测试矩阵
- completed restore → aside artifact（owner + retention）
- undo API → 一致回滚 + 可再 undo
- expired staged/promoting → expired + cleanup（aside 保留 forensic）
- boot sweeper GC expired artifacts
- boot sweeper 不删 active restore artifact
- GC 失败 → diagnostic（不静默）
- acknowledge 不删仍需 artifact
- 多次 restore retention（aside 累积上限）

### 风险 + 回滚
- **undo 走 promotion 同 protocol 复杂**→ 复用阶段 2 原子事务 + 测试
- **sweeper 误删 active**→ active 引用检查 + 保留期 + 测试
- **retention 太短用户没 undo**→ 默认 7 天 + UI 显示 deadline（阶段 4）
- **回滚**：artifact store additive；undo/sweeper 是新 API/服务，可禁用

---

## PR 3b · journal 状态机 + restore lease/generation

### PRD
**目标**：journal 从"可写结构"升级为"事件驱动变迁的状态机"（transition validator + monotonic step + explicit commit boundary）。restore runtime lease/generation（sealed hold 持到 process exit/promotion，service restart fencing）。

> **D6 承接 B5/B6**：本 PR 的 `RestoreGeneration` 是 **restore instance 级**（sealed hold + service restart fencing），与 stage1 D1 的 `WriteEpoch`（writer coordinator 级 drain 置位）是**两个不同作用域**，命名区分，勿混。D1 只 fencing 基建，B5/B6 的真正修复在 3b。

**范围**：
- `transitionRestoreJournal(current, event)` 集中函数（强制合法转移 + monotonic step）
- 所有 journal 写入经 transition（不再直接 `writeRestoreJournal` 任意对象）
- restore lease/generation：每次 restore 分配 generation token；async continuation 检查 generation owner；`onStop` 不无条件 release（sealed 持 lease）
- service stop two-phase（停 admission → 等 in-flight → 释放 holds）

**验收**：
1. 非法转移被拒（staged→completed / step 回退 / terminal 回 staged）
2. monotonic step 强制（gate-passed → ... → integrity-ok 单调）
3. sealed restore service stop 不释放 quiesce（lease 持到 process exit/promotion）
4. 旧 service instance release 拒（generation fencing）
5. service stop two-phase（等 in-flight 完成或明确移交）

### Design
**journal transition validator**（`restoreJournal.ts` 新）：
```ts
const ALLOWED: Record<State, Event[]> = {
  none: ['stage'],
  staged: ['promote'],
  promoting: ['advance-step', 'complete', 'fail', 'expire'],  // step 单调
  completed: [], failed: [], expired: []   // terminal，不可回
}
function transitionRestoreJournal(cur, event): RestoreJournal {
  if (!ALLOWED[cur.state].includes(event.type)) throw new IllegalTransitionError(...)
  if (event.type === 'advance-step' && stepIndex(event.step) <= stepIndex(cur.step)) throw ...
  return { ...cur, ...event.fields }
}
```

**`writeRestoreJournal` 强制 transition**：内部调 `transitionRestoreJournal`，不再接受任意对象。所有内部写入口（promotion 各步）改用 event。

**restore lease/generation**（`BackupService` + coordinator 协作）：
```ts
type RestoreGeneration = { restoreId: string; generation: number }
// 每次 startRestore 分配；async continuation 检查：
if (this.generation !== currentGeneration) return  // 旧 instance 不执行副作用
// onStop:
if (this.sealedButNotPromoted) {
  // 不释放 lease！持到 process exit
  this.scheduleProcessExitOrTransfer()
} else {
  this.releaseRestoreQuiesce(this.lease)  // 匹配 lease 才释放
}
```

**service stop two-phase**：
1. 停新 admission（acquire 拒）
2. 等 in-flight operation（or orchestrator cleanup）
3. 释放 holds（sealed 情况持 lease 或 process exit）

**journal 状态机 × operation 状态机映射（与 stage4 4b 跨阶段契约；按现行 seal 语义重画 N3）**：

| journal state (3b) | operation state (4b) 同进程 | preboot gate（新进程） | cancel / hold 语义 |
|---|---|---|---|
| none | admitted/quiescing/running | — | cancel 可；hold 可释放 |
| staged（seal 后） | sealed | — | **cancel 禁**（writers held + journal 即将不可逆）；hold 持到 promotion/exit |
| promoting | —（无同进程 cancelable operation） | `runRestorePromotion` 跑 | **preboot-only，无 4b cancel**；按 D3 marker reconcile 恢复 |
| promoting(inverse-failed) | cleanup-pending/process-exiting | reconcile | lease 持有或转移（不释放） |
| completed/failed/expired | completed/failed/aborted | — | terminal，hold 释放 |

> 关键：seal 后 journal=`staged` 且 writers held → operation≈`sealed`（cancel 禁）；`promoting` 多在 preboot gate（新进程）无同进程 cancelable operation。每 operation transition 对应的 journal transition + guard + side effect + progress event + hold owner 在 stage4 4b 定义完整状态表；3b 保证 journal 状态机合法转移供 4b 消费，4b 不绕过 3b validator。

### Implement steps
1. `transitionRestoreJournal` + ALLOWED 表 + 单测 → verify: 合法转移 OK + 非法拒 + monotonic
2. `writeRestoreJournal` 强制 transition + 所有写入口改 event + 测试 → verify: 现有 promotion 测试绿（改 event）
3. restore generation token + async continuation 检查 + 测试 → verify: 旧 instance 不副作用
4. onStop sealed lease 持有 + 测试 → verify: sealed 不释放（B5 修复）
5. service stop two-phase + 测试 → verify: 等 in-flight 或移交
6. 非法转移 e2e（构造非法 + 拒）+ 测试 → verify: 状态机强制

### 测试矩阵
- 合法转移（none→staged→promoting→...→completed）
- 非法转移拒（staged→completed / step 回退 / terminal→staged）
- monotonic step（跳步/回退拒）
- sealed service stop 不释放（lease 持有）
- 旧 instance generation 拒（不副作用）
- service stop two-phase（等 in-flight）
- 旧 journal（无 transition）legacy 兼容读

### 风险 + 回滚
- **transition 改所有写入口**（侵入大）→ 渐进（先 validator 加 + 旧写入口 warning，再强制）
- **generation fencing 漏**（某 async 不检查）→ 审计所有 async continuation + lint
- **回滚**：validator 先 warning 模式；generation additive

---

## PR 3c · OVERWRITE / RENAME / Notes dir-swap（阶段 2 decision graph 解锁）

### PRD
**目标**：在阶段 2 的 decision graph + 阶段 3a artifact lifecycle 上实现 OVERWRITE/RENAME/Notes directory swap 策略（当前 fail-closed，现解锁）。

**范围**：
- decision graph 支持 `dbAction: 'overwrite'/'rename'` + `resourceAction: 'overwrite'/'tree-swap'`
- OVERWRITE：DB+资源成对（DB row 覆盖 + 资源覆盖），走 aside（旧值留 aside 可 undo）
- RENAME：identity 重新映射（新 PK）+ 资源 move
- Notes dir-swap：目录级 `notes-tree-swap`（manifest treeHash + near-atomic swap + Notes writer quiesce），不再逐文件 additive
- UI 暴露策略选择（阶段 4 UI 配合）

**不在范围**：逐字段用户选择器（defer）

**验收**：
1. OVERWRITE DB+资源成对执行（无 mixed）+ aside 留旧值可 undo
2. RENAME identity 重映射 + 资源 move
3. Notes dir-swap 目录级原子（treeHash 校验 + near-atomic swap）
4. Notes writer quiesce（写期间 gate）
5. 策略 conflict decision 进 summary

### Design
**OVERWRITE**（decision graph 扩展）：
```ts
{ dbAction: 'overwrite', resourceAction: 'overwrite', targetFingerprint, asidePath }
// 执行：backup row → live（覆盖）；backup 资源 → live（覆盖，旧 → aside）
```

**RENAME**：
```ts
{ dbAction: 'rename', resourceAction: 'rename', newIdentity }
// 执行：identity map 映射新 PK；资源 move 到新路径
```

**Notes dir-swap**（`ResourceDescriptor` 新 kind `notes-tree-swap`）：
```ts
{ kind: 'notes-tree-swap', rootPath, treeHash, asideTreePath }
// 执行：manifest treeHash 校验 → near-atomic swap（live tree → aside，staging tree → live）→ Notes writer quiesce（coordinator）
```

### Implement steps
1. decision graph 支持 overwrite/rename/tree-swap action + 测试
2. OVERWRITE 执行（DB+资源成对 + aside）+ 测试
3. RENAME 执行（identity 重映射 + 资源 move）+ 测试
4. Notes dir-swap descriptor + manifest treeHash + near-atomic swap + Notes quiesce + 测试
5. 策略 conflict 进 summary + UI（阶段 4 配合）
6. e2e（OVERWRITE/RENAME/Notes round-trip + undo）+ 测试

### 测试矩阵
- OVERWRITE DB+资源一致 + aside 可 undo
- RENAME identity 重映射 + 资源 move
- Notes dir-swap treeHash 校验 + near-atomic
- Notes writer quiesce
- 策略 summary 披露
- undo OVERWRITE/RENAME

### 风险 + 回滚
- **OVERWRITE 数据覆盖风险**→ aside 强制 + undo + 默认仍 SKIP/FIELD_MERGE（用户显式选）
- **Notes dir-swap 原子性**→ near-atomic + treeHash + crash 测试
- **回滚**：策略 fail-closed flag（默认关，逐步开）

---

## 阶段 3 验证闭环 + 门槛
- vitest 绿 + lint 0 error + build:check 绿
- cursor/codex 对抗无 high/medium（审：undo 一致 / sweeper 不删 active / transition 强制 / lease fencing / OVERWRITE aside）
- 状态机图 + artifact lifecycle 图 commit
- **局部 traceability**：本 plan 各 PR"测试矩阵"+"可审计验收物"段即 criterion→test 映射（PR 实施时填 test ID + CI tier）；架构 Master Traceability 是汇总索引
- **3c 只消费 2b 冻结的宽 union**（含 overwrite/rename/tree-swap/newIdentity），不扩 ConflictDecision schema（见 P1 修正）；3c 实现前 stage2 2b-schema 必须已合入

---

## 对抗 review 细化修正（stage3 review：6 P0 + 6 P1）

### P0 修正

**P0-1 · 状态机表完整（3b）**：原表漏 `staged→expired`（现有 admission failure 可 `staged→expired`，restorePromotion.ts:286,381）；`advance-step` 只拒 `<=` 会跳步；`complete` 可在任意 promoting step 绕 integrity。
修正：
- 补完整 `state × event × guard × durable effect` 表
- `advance-step` 只允许下一**相邻** step（严格 `stepIndex(next) === stepIndex(cur) + 1`）
- `complete` 仅允许 `integrity-ok` 且 D3 所有 `resourceState==='applied'`
- `staged→expired` 仅限 admission 尚未改 live state
- `promoting` 失败/重试保留 D3 reconcile 语义（不经一般 transition 绕过）

**P0-2 · TTL 仅 staged（3a）**：原 TTL 对 staged/promoting 一刀切 → promoting 越 `work-promoted` 后 expire 删 staging → new DB+未完成资源 mixed。且 `Date.now() - createdAt` 类型错（createdAt 是 ISO string，restoreJournal.ts:93）。
修正：
- 仅 `staged` 可 TTL expire；`promoting` 必须走 D3 marker/reconcile（按 commit boundary + resourceStates 恢复 old/new 完整态）
- 时间字段统一 epoch ms（或严格 parse ISO + 拒无效/未来）
- 补 pre-commit / post-commit / inverse-failed 三组 TTL crash test

**P0-3 · undo durable inverse（3a）**：原 RestoreArtifact 只有 paths，无 inverse manifest/parent/lease；成功 promotion 删 staging（restorePromotion.ts:723）+ add 资源无 aside → 不能可靠 undo/再 undo。
修正：
```ts
type RestoreArtifact = {
  artifactId, restoreId, kind, paths, owner, createdAt, retentionDeadline, state,
  // 加：
  inverseManifest: InverseOp[]      // 每 add/overwrite/tree 的反向操作 + hash
  planHash: string                  // 关联 D4 decision graph
  resourceStates: ResourceState[]   // D3 marker 快照
  preDbArtifact, postDbArtifact     // DB aside（pre/post promotion）
  parentArtifactId?: string         // 父代（undo 再 undo）
  generation: number
  undoingLease?: Lease              // CAS lease 防 并发 undo
}
```
- undo 创建**独立 operation journal**（不回写 terminal→staged）
- 状态机加 `undoing`/`undoing-failed-reconciling`/`superseded`
- CAS lease 保护 undo（防并发）
- add 资源 promotion 时也留 aside（为 undo 可逆）

**P0-4 · sweeper CAS（3a）**：原"active 引用不删"无引用来源/锁/重检；`hasPendingRestore`（restoreJournal.ts:214）不够（undo/reconcile/新 instance 多 lease）。
修正：
- sweeper 在 durable store 内 CAS：`live/undo-available → gc-pending`（compare-and-swap）
- 删前重检：active journal + generation lease + `undoing` pin + D3 unfinished marker
- 删文件完成才写 `garbage-collected`
- CAS 失败 / 文件系统扫描出的无记录 artifact → **fail-closed（不删，仅诊断）**
- 补 sweeper × undo/restore 并发 / sweeper rename 前后崩溃 / retention × disk-budget 相撞 测试

**P0-5 · generation fencing 全 async（3b）**：原 generation 只 instance 字段，未覆盖所有 async continuation（finally release/progress/summary broadcast/relaunch timer/native dialog Promise/artifact 写/GC）。现有 sealed 清 activeOperation（BackupService.ts:571）+ onStop 释放（:1325）+ relaunch 无 lifecycle timer（:646）+ 测试断言 stop 释放 sealed（BackupService.restore.test.ts:749）。
修正：
- generation 由 **coordinator 拥有**（非 instance 字段）
- 每副作用点 lease compare：finally release / progress+summary broadcast / relaunch timer / dialog Promise continuation / artifact 写/GC
- `onStop` **async**（BaseService.ts:280 支持 await）：先 fence/admission close → await completion 到 deadline → 超时仅转移 durable lease（旧 instance 不得再写或释放新 owner hold）
- 修测试（:749 不再断言 stop 释放 sealed，改断言 sealed lease 持有或转移）
- 用注入型 deferred Promise 验证旧 instance 无法 release/broadcast/write artifact

**P0-6 · Notes tree-swap 顺序+原子性（3c）**：原 quiesce 排 hash/swap **后**（writer 可在 hash/swap 窗口写）；custom Notes path 可 userData 外/跨卷（BackupService.ts:1148）；`renameDurable`（restorePromotion.ts:817）不能证双 rename 原子。
修正：
- **先**获 D1 Notes writer lease，持到 treeHash + 双 rename + journal marker + D3 reconcile 全完成
- 仅支持 managed/in-userData 且**同设备** root；跨卷/自定义外部 root → `SKIP` fail-closed（resourcePlanning.ts:416 已跳 userData 外）
- 双 rename marker matrix：`live→aside` / `staging→live` / marker 失败 / 断电 each intermediate state 独立 marker + reconcile
- 同卷 rename 才原子（跨卷 fallback SKIP）

### P1 修正

- **3c 与 2b 兼容**：2b 先冻结 `ConflictDecision.resourceAction` union（含 `rename`/`tree-swap`/`newIdentity`）+ identity mapping + aside descriptor + schema/version/hash 规则；3c 只消费，不临时扩展（修正 stage2 ConflictDecision schema）
- **transition 迁移清单（3b）**：拆 `createStagedJournal()` + `transitionJournal(expectedRevision, event)`，消除任意对象写 API；迁移所有直调：ImportOrchestrator.ts:327 / promotion finalize（:729）/ markStep / LegacyBackupManager.ts:798；v1 writer 移除或兼容适配器（不静默绕 validator）
- **OVERWRITE 服务端约束（3c）**：default SKIP 写进 input schema + planning（缺策略/旧 client/无 matching aggregate policy → SKIP）；仅验证的 `strategySource:'user'` 显式才 overwrite/rename；补"无 UI/旧 client/篡改 journal 不能执行 OVERWRITE"测试
- **artifact store 不能 DB 表（3a）**：restore rename 整 app DB（restorePromotion.ts:550）会覆盖表 → store 必须 **app DB 外 crash-safe sidecar**（独立文件 + fsync + 权限 + schema version + 损坏 fail-closed + path registry key）
- **terminal→staged vs 连续 restore（3b）**：同 operation journal terminal 不可回 staged；但允许 `remove terminal → create new operation`（durable artifact ownership 验证后，BackupService.ts:381 现状）；测试区分两场景
- **C2 clearRestoreJournal（3b）**：`clearRestoreJournal()`（restoreJournal.ts:227）不清 `.tmp` + 不 fsync parent，但 acknowledge（BackupService.ts:402）+ 下次 restore 调它 → 3b 统一用 durable `removeRestoreJournal()` 语义 + 加中断写/ack 测试

### 工时修正
- 3a 加 undo durable inverse + sweeper CAS + artifact sidecar store → ~5-7 天（原 3-5）
- 3b 加完整状态机表 + generation fencing 全 async + transition 迁移 + C2 → ~4-6 天（原 2-4）
- 3c 加 Notes swap marker matrix + OVERWRITE 服务端约束 + 2b union 兼容 → ~3-5 天（原 2-4）

### 可审计验收物（每 PR）
- 状态机图（完整 state×event×guard×effect 表）
- artifact lifecycle 图（artifactId/parent chain/lease/pin/CAS/每类可删条件）
- generation fencing audit 清单（逐副作用点）
- 崩溃点清单 + 对应测试名
- sweeper CAS + fail-closed 测试矩阵
