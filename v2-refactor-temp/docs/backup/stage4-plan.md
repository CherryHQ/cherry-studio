# 阶段 4 计划：控制面 + UX（D7 BackupProgress + durable progress + cancel + UI 契约）

> **📄 文档优先级（双源冲突规则）**：本 plan = 正文 + 文末「对抗 review 细化修正」段双源。冲突时**以文末修正为准**；正文未改的旧段（4b drain `Promise.all` 以 P0-1 Channel-first 为准；`relaunchRequested` 内存布尔以 P1 generation-token 为准；4a C7 已补，见验收6 + Implement7）若与修正冲突即作废。实施前先读文末修正段。

> 目标：消除 B7/B8/B13/B14（a1 后无控制面 / 无 durable progress / UI 契约断裂死按钮 + raw error + i18n marker / drain 固定 + cancel 不贯穿）+ **C3**（relaunch 无 idempotency，唯一落点 4b）+ C4/C5/C6/C7/C8（renderer 线性 / DESIGN/a11y / v1v2 并存 / startup 一次 / 无 envelope）。
> 工时修正后 ~2-3 周（含 drain/Abort 重做 + C7 startup 重试）。3 PR（4a 控制面 / 4b cancel+drain / 4c UI 契约）。
> 前置：**仅阶段 1 coordinator**（cancel/drain 复用；D7 仅依赖 D1）→ **stage4 可与 stage2/stage3 并行**（见架构依赖图）。
> **实施序与并行边界（R2 对齐架构）**：**4a** 可在 stage1 完成后与 stage2/3 并行开工（D7 仅依赖 D1）；**4b 等 stage3 3b**（消费 journal validator + RestoreGeneration 同源）；**4c** 脱敏/i18n 可并行、degradation 文案 after stage5 5a。PR 编号 4a/4b/4c 非实施序；对抗修正"修订顺序 4b→4a→4c"仅指 4b 依赖链内相对序，不阻止 4a 早开。

---

## PR 4a · BackupProgress window + durable progress + late subscriber

### PRD
**目标**：a1 摧毁主窗后仍有可靠控制面（mutation-free BackupProgress window，a1 前 open）+ durable `backup.restore_progress`/status replay（late subscriber 可恢复 active 状态）。

**范围**：
- 新 `WindowType.BackupProgress`（`mutationCapable:false`，singleton，a1 acquire **前** open，不被 destroy）
- `BackupProgressUpdate.phase` 扩展覆盖 ImportOrchestrator 全阶段（admission/quiesce/fingerprint/snapshot/stage/merge/migrate/seal/verify/journal/relaunch）
- `BackupService` 存 `lastRestoreProgress`（durable）+ `backup.restore_progress` event + `backup.restore_status` request（late subscriber pull）
- summary event envelope `{restoreId, schemaVersion, phase, summary}`（renderer 按 id/version 丢弃 stale）
- native Notification 仅 fallback（窗口开不了时）
- **C7 startup outcome 可重试**：`runBackupRestoreGate` 去一次性 flag，每次 boot 检查 journal terminal outcome + artifact state（已 terminal 不重复执行，但 failed/expired 可重试或提示用户重新 restore）— 消除"startup 仅检查一次"

**验收**：
1. BackupProgress window 在 a1 acquire 前 open，主窗 destroy 后仍存在
2. 全 ImportPhase 都有对应 progress
3. late subscriber（窗口重开/新 subscriber）能 pull 最近状态
4. progress IPC 属 backup.* 不被 mutation gate 阻
5. summary envelope 防 stale event
6. **C7 startup 可重试**：`runBackupRestoreGate` 去一次性 flag，boot 检查 journal terminal outcome + artifact state（已 terminal 不重复，failed/expired 可重试或提示重 restore）

### Design
**windowRegistry**（`windowRegistry.ts` 加）：
```ts
{ type: 'BackupProgress', mutationCapable: false, mode: 'singleton', lifecycle: 'default' }
// WindowManager 在 a1 acquire 前 open；mutationCapable:false → 不被 hold 摧毁
```

**phase 扩展**（`shared/types/backup.ts`）：
```ts
type BackupProgressPhase =
  | 'admission' | 'quiesce' | 'fingerprint' | 'snapshot' | 'stage'
  | 'merge' | 'migrate' | 'seal' | 'verify' | 'journal' | 'relaunch'
  | 'completed' | 'failed' | 'cancelled' | 'expired'
type RestoreProgress = {
  restoreId: string; phase: BackupProgressPhase; status: string
  startedAt: number; updatedAt: number; cancellable: boolean
  percent?: number; lastError?: string; generation: number
}
```

**durable progress**（`BackupService`）：
```ts
private lastRestoreProgress: RestoreProgress | null
// ImportOrchestrator 每 phase 回调 → 更新 lastRestoreProgress + broadcast 'backup.restore_progress'
// 'backup.restore_status' request → 返 lastRestoreProgress（late subscriber）
```

**summary envelope**（`backup.restore_summary`）：
```ts
{ restoreId, schemaVersion, phase, summary }   // renderer 按 restoreId/version 丢 stale
```

**a1 前 open**：`BackupService.startRestore` 在 `acquireMutationCapableWindowHold` **前** `windowManager.open('BackupProgress', { restoreId })`。

### Implement steps
1. `WindowType.BackupProgress` 注册（mutationCapable:false/singleton）+ WindowManager open/close + 单测
2. phase 扩展 + ImportOrchestrator 全阶段回调 + 测试
3. `lastRestoreProgress` + `backup.restore_progress`/`status` IPC + late subscriber + 测试
4. summary envelope + renderer stale 丢弃 + 测试
5. a1 前 open + 主窗 destroy 后存活 + 测试
6. native Notification fallback（窗口开不了）+ 测试
7. **C7**：`runBackupRestoreGate` 去一次性 flag + boot 检查 journal terminal/artifact state + 重试逻辑 + 测试

### 测试矩阵
- BackupProgress a1 前 open + 主窗 destroy 后存活
- 全 ImportPhase 对应 progress
- late subscriber pull 最近状态
- progress IPC quiesce 期间可用（不被 gate）
- summary envelope stale 丢弃
- Notification fallback
- locale 不显 marker（阶段 0 #9 已修，回归）
- 窗口关闭/崩溃/relaunch 不泄 hold

### 风险 + 回滚
- **新窗口 lifecycle 复杂**（relaunch 竞态）→ lifecycle 测试 + a1 前/后/destroy 场景
- **progress IPC 高频**→ coalesce/throttle（C4）+ 测试
- **回滚**：window 注册 additive；progress IPC additive

---

## PR 4b · cancel/relaunch/forceExit 统一状态机 + drain 分级 timeout

### PRD
**目标**：统一 cancel/relaunch/forceExit 状态机（普通 cancel 不 abort 业务；a1 后 cancel 必须 relaunch；sealed 禁 cancel）+ drain 分级 soft/hard timeout + AbortSignal 贯穿。

**范围**：
- runtime operation 状态机：`admitted/quiescing/running/sealed/relaunch-requested/process-exiting/aborted/failed/completed`（每状态定义允许的 cancel/relaunch/writer/hold/journal transition）
- 普通 cancel：取消 restore 编排（drain 接 signal、不进 snapshot、不丢 Channel pending、不强制终止 AI/Agent/Job、cleanup；a1 后 cancel relaunch；sealed 禁）
- drain 分级：soft（进度窗显示等待对象/数量/已等 + 可继续/取消）/ hard（fail-closed）+ absolute deadline + AbortSignal
- cancel signal 贯穿 admission/unpack/cp/merge
- relaunch one-shot/idempotency（绑 restoreId + token，重复请求返状态不重复执行）

**不在范围**：force-cancel（abort 业务，defer）、Channel durable（上游）

**验收**：
1. 普通 cancel 各 phase 可用（不 abort 业务任务）
2. a1 后 cancel 触发 relaunch（不复活已 destroy 窗）
3. sealed 后 cancel 禁（journal 不可逆）
4. drain soft/hard + absolute deadline + AbortSignal
5. relaunch idempotent（重复不多次副作用）

### Design
**operation 状态机**（`BackupService`；**C3 唯一落点 = relaunch idempotency 在此**）：
```ts
type OperationState = 'admitted'|'quiescing'|'running'|'sealed'|'cancelling'|'cleanup-pending'|'relaunch-scheduled'|'relaunch-requested'|'process-exiting'|'aborted'|'failed'|'completed'  // 完整 union 与对抗 P1 RestoreOperationState 对齐（含 cancelling/cleanup-pending/relaunch-scheduled）
const ALLOWED_TRANSITIONS: Record<OperationState, OperationState[]> = { ... }
const CANCELABLE: Set<OperationState> = new Set(['admitted','quiescing','running'])  // sealed 不可
```

> **operation × journal 映射（消费 stage3 3b 契约）**：完整状态表逐行列 `trigger/from/to/guard/side effect/progress event/journal mutation/hold owner/允许 IPC command`（见对抗修正 P1）；journal mutation 必须经 stage3 3b `transitionRestoreJournal` validator（4b 不绕过）。journal↔operation 联动见 stage3 3b 映射表。
> **generation 同源**：4b relaunch token `{restoreId, generation, nonce}` 的 `generation` **来自 stage3 3b `RestoreGeneration`**（coordinator 拥有，非本进程独立字段），与 3b generation fencing 同源 —— 勿在 4b 另造 generation。

**drain 分级**（`BackupService.startRestore`）：
```ts
const deadline = Date.now() + TOTAL_DEADLINE   // 绝对值
await Promise.all([
  drainWithSignal(channel,   { soft: 5_000,  hard: 30_000,  deadline, signal }),
  drainWithSignal(aiStream,  { soft: 30_000, hard: 120_000, deadline, signal }),
  drainWithSignal(agent,     { soft: 60_000, hard: 600_000, deadline, signal }),
  drainWithSignal(job,       { soft: 30_000, hard: 300_000, deadline, signal }),
])
// soft → progress 窗显示；hard → fail-closed；signal → cancel 中止
```

**cancel 流程**：
```ts
async cancel(restoreId) {
  if (!CANCELABLE.has(this.state)) throw new NotCancelableError(this.state)
  this.abortController.abort()   // signal 传 drain/admission/cp/merge
  // 不强制终止 AI/Agent/Job（业务继续）
  await cleanup()                // staging 清理
  if (this.a1Acquired) this.scheduleRelaunch()  // a1 后必须 relaunch
  this.state = 'aborted'
}
```

**relaunch idempotency**：
```ts
private relaunchRequested = false
requestRelaunch(restoreId, token) {
  if (this.relaunchRequested) return currentStatus   // 幂等
  this.relaunchRequested = true
  this.schedulePostSealRelaunch()
}
```

### Implement steps
1. operation 状态机 + ALLOWED_TRANSITIONS + 单测 → verify: 合法/非法转移
2. drain 分级 soft/hard + deadline + AbortSignal + drainWithSignal + 测试
3. cancel 流程（各 phase + a1 后 relaunch + sealed 禁）+ 测试
4. AbortSignal 贯穿 admission/unpack/cp/merge + 测试
5. relaunch idempotency + 测试
6. forceExit 路径统一（阶段 0 #10 已修 escapeStrandedProcess，整合状态机）

### 测试矩阵
- cancel admitted/quiescing/running（不 abort 业务）
- cancel a1 后 → relaunch
- cancel sealed → 拒
- drain soft 后继续成功 / hard fail-closed
- deadline 不因重复轮询延长
- AbortSignal 中止等待（不丢 Channel batch）
- relaunch 重复请求幂等
- forceExit 与状态机一致

### 风险 + 回滚
- **cancel 误 abort 业务**→ signal 只传 restore drain，不传业务 task + 测试
- **drain hard 太短误判**→ 分级 + 用户可继续 + 测试
- **回滚**：状态机 additive；drain 分级可回固定 5s

---

## PR 4c · UI 契约（删死按钮 + 脱敏 + degradation + i18n + DESIGN/a11y + v1v2 gate）

### PRD
**目标**：UI 与 main auto-relaunch 契约一致（删 RestoreV2Popup 死按钮）+ raw error/路径脱敏 + degradation 分类披露 + i18n 补全 + DESIGN/a11y 合规 + v1/v2 popup gate + summary 虚拟化。

**范围**：
- 删 `RestoreV2Popup` 的 Restart 按钮请求 `backup.restore_relaunch`（a1 后死按钮）→ 改用 BackupProgress window（PR 4a）+ post-relaunch outcome fallback
- raw error/绝对 archivePath/skip id/journal reason 脱敏（按 errorCode/summary kind 做 i18n mapping；路径显示 basename；diagnostic 仅 logger/可复制高级详情）
- degradation 分类披露（external/knowledge-reindex/skill-missing/conflict/skip 各有可理解说明 + 可恢复/不可恢复 + 后续动作）
- i18n：10 locale v2 backup ~55 keys 全 marker → 正式翻译（`pnpm i18n:translate` 流程）
- summary envelope renderer 处理（restoreId/version 丢 stale）
- DESIGN/a11y：Dialog size 规范、aria-live（progress）、role=alert（error）、semantic token
- v1/v2 popup gate（明确入口，不并存歧义）
- renderer summary 虚拟化/分页 + progress throttle（C4）

**验收**：
1. 无死按钮（a1 后 UI 不依赖被 destroy 的 Main renderer）
2. 无 raw error/绝对路径/id/reason 泄露（i18n mapping + 脱敏）
3. degradation 分类披露（各场景用户可理解）
4. 10 locale backup UI 正式翻译（非 marker fallback）
5. DESIGN/a11y 合规
6. v1/v2 popup 不并存歧义
7. summary 大列表不卡（虚拟化/throttle）

### Design
**死按钮删/改**（`RestoreV2Popup.tsx:283-383`）：
- 删 Restart 按钮请求 `backup.restore_relaunch`
- restore 进度/控制移到 BackupProgress window（PR 4a）
- RestoreV2Popup 仅作 post-relaunch outcome 显示（读 summary envelope）

**脱敏 mapping**（新 `renderer/backup/errorMapping.ts`）：
```ts
const ERROR_I18N: Record<string, string> = {
  BACKUP_RESOURCE_INCOMPLETE: 'backup.errors.resource_incomplete',
  BACKUP_RESTORE_DRAIN_UNCLEAN: 'backup.errors.drain_unclean',
  // ...
}
// 显示：i18n message + basename（archivePath）；diagnostic 进 logger + 可复制
```

**degradation 分类**：
```ts
const DEGRADATION_I18N: Record<string, { title, body, recoverable, action }> = {
  external_file_payload_not_included: { ... },
  knowledge_index_rebuild_failed: { ... },
  skill_dir_missing: { ... },
  field_conflict: { ... },
}
```

**i18n 翻译**：跑 `pnpm i18n:translate`（10 locale backup keys）；**`pnpm i18n:sync` 作为显式步骤**（阶段 0 教训：手动加键触发 `build:check` 排序失败，需补 format commit）；阶段 0 #9 的 marker fallback 作安全网。

**DESIGN/a11y**（DESIGN.md 合规）：
- Dialog size 用共享组件（不硬编码 `sm:max-w-[520px]`）
- progress 区 `role="status" aria-live="polite"`
- error 区 `role="alert"`
- semantic token（`text-foreground-secondary` 等）

**summary 虚拟化**：`summary.toSkip`/`degradations` 聚合（按 kind/reason）+ 详情分页（C4）。

### Implement steps
1. 删 RestoreV2Popup 死按钮 + 移控制到 BackupProgress window + post-relaunch outcome + 测试
2. errorMapping（errorCode→i18n + 脱敏）+ degradation 分类披露 + 测试
3. i18n 翻译（pnpm i18n:translate 10 locale）+ i18n:check + 测试
4. summary envelope renderer 处理 + 虚拟化/throttle + 测试
5. DESIGN/a11y 合规（Dialog/aria/semantic token）+ 测试
6. v1/v2 popup gate（明确入口）+ 测试

### 测试矩阵
- 无死按钮（a1 后 UI 不依赖 Main renderer）
- 脱敏（无 raw error/绝对路径/id/reason）
- degradation 各场景披露
- 10 locale 翻译（非 marker）
- DESIGN/a11y（Dialog/aria/token）
- summary 虚拟化（大列表不卡）
- v1/v2 gate

### 风险 + 回滚
- **删死按钮改交互**→ BackupProgress window 先就位 + 测试
- **i18n 翻译质量**→ 翻译流程 + review
- **回滚**：UI 改动隔离；errorMapping additive

---

## 阶段 4 验证闭环 + 门槛
- vitest（renderer backup 测试）+ lint + build:check 绿
- cursor/codex 对抗无 high/medium（审：a1 后控制面 / cancel 各 phase / 脱敏 / a11y / i18n / **C7 startup 可重试**）
- DESIGN.md 合规检查
- **局部 traceability**：本 plan 各 PR"测试矩阵"段即 criterion→test 映射（PR 实施时填 test ID + CI tier）；架构 Master Traceability 是汇总索引

---

## 对抗 review 细化修正（stage4 review：2 P0 + 6 P1 + 3 P2）

### P0 修正

**P0-1 · drain 顺序（4b）**：原 `Promise.all([channel, aiStream, agent, job])` 破坏 Channel→AI 依赖（Channel 刷出批次等 AI admission 死锁，BackupService.ts:445,508）。
修正 drain matrix：
1. acquire a1 hold + set BACKUP_IN_PROGRESS
2. pause Channel，**单独** drain Channel（clean 后才继续）
3. pause AI/Agent/Job，**后 3 并行** drain
每项定义：prerequisite / soft-hard timeout / 全局剩余 deadline（`Math.max(0, deadline - Date.now())` 传每次等待）/ soft UI payload / hard error code / cancel 行为 / hold release owner。单 hard timeout 不绕总 deadline。

**P0-2 · AbortSignal cooperative（4b）**：禁止 `Promise.race(drain, abort)` 假取消（race 只让流程返回，底层 drain/writer 仍跑 → 释放 hold 重开写入）。
修正：阶段 1 coordinator API 须支持 cooperative AbortSignal（abort 后给"已停等但 writer 仍跑"确定结果）。cancel 语义拆：
- 未进 a1：abort，等 quiesce 清理 + hold 释放
- 已进 a1：abort，**持 hold 到清理完成**，安全后 token 保护 relaunch
- sealed：拒 cancel（journal 唯一真相）

### P1 修正

- **4a IPC 双状态**：保持 `backup.restore_status`（journal outcome 跨重启 pending/completed/failed/expired，backup.ts:208）**不变**；新增 `backup.restore_progress` request 返 `{active: null} | {active: RestoreProgress}`；`lastRestoreProgress` 仅**同 main 生命周期** late subscriber（非跨进程 durable，崩溃后从 journal terminal outcome 披露）
- **4a 窗口实施清单**：PR 4a checklist 含 WindowType + 完整 windowRegistry metadata + preload 权限审计 + `src/renderer/windows/backupProgress/{index.html,entryPoint.tsx}` + window source logger + i18n init + `electron.vite.config.ts` renderer input（electron.vite.config.ts:152 现无）+ WindowManager close/crash 策略；**关闭策略**（a1 后唯一控制面）：定义阻止关闭 / 关闭自动 reopen / 或明确 notification fallback 可操作路径 + 测试 crash/manual close/late re-open
- **4b 状态机拆三模型**：`ImportPhase`（编排进度）/ `RestoreOperationState`（本进程操作+取消权限，加 `cancelling`/`cleanup-pending`/`relaunch-scheduled`）/ `RestoreJournalState`（跨重启 staged/promoting/...）。状态表逐行：trigger/from/to/guard/side effect/progress event/journal mutation/hold owner/允许 IPC command
- **4b relaunch token**：`{restoreId, generation, nonce}`，timer fire / IPC 请求 / fallback relaunch 三处重读 staged journal 验证；timer lifecycle owner + stop 行为 + idempotent result（非内存布尔，BackupService.ts:646 裸 timer 须改）；sealed 后 activeOperation=null + holds + journal + timer 所有权写为可测试 invariant
- **4c presentation DTO（main 侧）**：main 生成最小化 presentation DTO（**不传 raw detail/resource id/绝对 path/journal reason**，backup.ts:121,145 现含）；progress 用稳定 `statusCode`（非 `lastError` 原文）；"可复制高级详情"只 allowlist 非敏感；summary **directed-send BackupProgress**（非无条件 broadcast 所有 renderer）
- **4c sequence**：每 active restore event 加单调 `sequence`，renderer 只接受 `sequence > lastSeen`；snapshot pull 响应同 sequence；throttle 规则（阶段切换 + terminal 永不丢，计数按间隔/显著变化）

### P2 修正
- 4c 脱敏字段级 policy 表（archivePath/basename/resource id/reason/engine detail/error code/count/kind × 进 journal/跨 IPC/显示/屏幕/日志等级）；renderer DOM 测试断言不出现临时目录/用户目录/UUID/raw engine message
- v1/v2 gate 唯一权威 predicate（入口组件 + gate 读取源 + v1 residue 删除范围 + fallback）+ route-level test
- 验收改可审计断言（WindowManager integration / Vite entry build / late pull ordering / fake-clock deadline / Channel-first dependency / state-command pair / cancel×seal 并发 / timer token stale / locale key 完整 / DOM 脱敏 / ARIA / Dialog size / large-summary virtualization）

### 修订顺序
4b drain matrix + cancel ownership → 4a IPC 双状态 + 窗口交付清单 → 4c presentation DTO（基于稳定 main DTO）
