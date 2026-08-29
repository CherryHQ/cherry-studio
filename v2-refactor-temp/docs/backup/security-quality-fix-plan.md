# Backup v2 安全/质量修复 Plan

> 2026-07-31。3 项本地可修、不依赖上游、Cursor review 认可（含其修正）。
> 目标：beta 前关闭 3 个真 bug / 质量门。总工时 ~4-8h。

## 总览

| # | 问题 | 严重度 | 工时 | 依赖 |
|---|---|---|---|---|
| 1 | terminal journal cleanup 路径越界（安全） | P1 | 0.5-1h | 无 |
| 2 | post-seal 双重 relaunch failure 卡死 | P1 | 2-4h | 新 i18n key |
| 3 | i18n 非英文 locale marker 显示 | P1 | 1-2h | 无 |

**执行顺序**：1 → 3 → 2（2 依赖新 i18n key，3 先把 i18n resolver 改好；1 独立最快）。每项独立 commit，可回滚。

---

## 1. terminal journal cleanup 路径越界（安全 P1）

### 问题证据
`src/main/data/db/restore/restorePromotion.ts:143-156` `cleanupTerminalRestoreArtifacts()` 直接：
```ts
const stagingRoot = application.getPath('feature.backup.restore.staging')
fs.rmSync(path.join(stagingRoot, journal.restoreId), { recursive: true, force: true })
```
**未复用**同文件 `removeStagingTree()`（:728-736）的 containment guard。`restoreId` schema 仅 `z.string().min(1)`（`restoreJournal.ts:88`，无 basename 约束）。正常 `ImportOrchestrator` 创建时有 `isSafeBasename`，但**损坏/手改 journal** 可写出 `../` → preboot gate 每次启动调 cleanup → **递归删除 stagingRoot 外路径**（本地 trust-boundary 安全洞）。

> Cursor 路径更正：此文件在 `src/main/data/db/restore/restorePromotion.ts`（非旧 `db/backup/`）。

### 改法
**复用 `removeStagingTree()`，不在 cleanup 重写删除逻辑**：
```ts
// cleanupTerminalRestoreArtifacts() 内：
// 旧：fs.rmSync(path.join(stagingRoot, journal.restoreId), { recursive: true, force: true })
// 新：
removeStagingTree(journal.restoreId)
```
`removeStagingTree` 现有 containment（path.resolve + path.relative，`rel === '' || includes('..') || isAbsolute` → logger.error + return）。

**可选增强**（推荐）：`removeStagingTree` 返回 `boolean`，cleanup 在 false 时不记 "cleared" 成功（避免审计日志误导）。
```ts
function removeStagingTree(restoreId: string): boolean {
  const target = path.resolve(stagingRoot, restoreId)
  const rel = path.relative(stagingRoot, target)
  if (rel === '' || rel.split(path.sep).includes('..') || path.isAbsolute(rel)) {
    logger.error('Refusing to delete staging outside the staging root', { restoreId })
    return false
  }
  fs.rmSync(target, { recursive: true, force: true })
  return true
}
```

### 测试
`src/main/data/db/restore/__tests__/restorePromotion.test.ts`（已有 `runRestorePromotion` 越界测试 :312，但未直接覆盖 `cleanupTerminalRestoreArtifacts`）：
```ts
it('refuses terminal cleanup when restoreId escapes staging root', () => {
  const outside = join(userData, 'outside-dir')
  mkdirSync(join(outside, 'keep.txt'), { recursive: true })
  writeFileSync(join(outside, 'keep.txt'), 'keep')
  writeRestoreJournal({ ...terminalJournal, restoreId: '../outside-dir' } as RestoreJournal)
  cleanupTerminalRestoreArtifacts()
  expect(existsSync(join(outside, 'keep.txt'))).toBe(true)   // 未删
  expect(journalState()).toBe('completed')                    // journal 保留，下次重试
})
// + 绝对路径 restoreId：join(userData, 'outside-dir') → 同样拒绝
```
保留现有合法 cleanup 删除测试（不回归）。

### 验证 / 回滚
- `pnpm vitest run src/main/data/db/restore` 绿
- 回滚：`git revert <sha>`（单 commit）

---

## 3. i18n marker 显示（P1，先于 2）

### 问题证据
`src/main/i18n/translate/*.json` 10 个非英文 locale（ja-jp/fr-fr/de-de/es-es/ru-ru/zh-tw/el-gr/ro-ro/vi-vn/pt-pt）的 `[to be translated]:` marker **全库约 690 个**（backup notification 6 keys + renderer credentials_warning 等）。`translate/` 是自动翻译流程产物（README 禁手改）。当前 main `t()` 仅 key 缺失才 fallback，marker 是真字符串 → 直接显示给用户（数据安全流程显示英文 marker）。

### 改法（改 resolver，不手改 690 marker）

**main** — `src/main/i18n/resolver.ts`：
```ts
const MARKER = '[to be translated]:'
const isUntranslatedMarker = (v: string | undefined): boolean => v?.startsWith(MARKER) ?? false
const currentValue = resolve(getI18n().translation)
const fallbackValue = resolve(locales[defaultLanguage].translation)
const value = currentValue && !isUntranslatedMarker(currentValue) ? currentValue : fallbackValue
```

**renderer** — `src/renderer/i18n/resolver.ts`：`resourcesToBackend` 的动态 loader 对加载的 locale 做不可变递归清洗（marker leaf → undefined），让 i18next `fallbackLng: defaultLanguage`（en-US）生效：
```ts
const MARKER = '[to be translated]:'
function removeTranslationMarkers(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith(MARKER) ? undefined : value
  if (Array.isArray(value)) return value.map(removeTranslationMarkers)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, removeTranslationMarkers(v)] as const)
        .filter(([, v]) => v !== undefined)
    )
  }
  return value
}
```

> Cursor 注意：确认 `t()` 热路径 marker 前缀判断性能可忽略（`startsWith` 廉价）；renderer 清洗**勿破坏已翻译 leaf**（只删 marker leaf）。

### 测试
- `src/main/i18n/__tests__/index.test.ts`：`app.language='ja-JP'` 时 `t('backup.restore.notification.completed')` 等于 en-US 文案（不含 marker）
- `src/renderer/i18n/__tests__/resolver.test.ts`：切 ja-JP，`backup.credentials_warning`/notification key 返 en-US；zh-CN 正常中文；缺失 key 仍按现有 fallback
- regression：其他 marker key 也 fallback（不只 backup）

### 后续（非阻塞）
正式翻译走 `pnpm i18n:translate` 流程（10 locale 建议已在主方案文档）。resolver fallback 是安全网，翻译流程补正式值。

### 验证 / 回滚
- `pnpm vitest run src/main/i18n src/renderer/i18n` + `pnpm i18n:check` 绿
- 回滚：`git revert`

---

## 2. post-seal 双重 relaunch failure 卡死（P1，依赖 3 的 i18n key）

### 问题证据
`src/main/services/backup/BackupService.ts:663-675` `schedulePostSealRelaunch`：
```ts
try { this.relaunchStagedRestore() }
catch (e) {
  logger.error('post-seal staged relaunch failed; falling back to app relaunch', e as Error)
  try { application.relaunch() }
  catch (relaunchErr) { logger.error('post-seal fallback app relaunch failed', relaunchErr as Error) }  // ← 只 log
}
```
第二次失败仅 log。此时：renderer 已 destroy（a1）+ writer hold/BACKUP_IN_PROGRESS 持有 + staged journal 阻塞后续 restore → **用户无主窗，只能杀进程**。

### 改法（A+B 组合，不无限 retry）

新增 `handlePostSealRelaunchFailure(error)` —— main-process `dialog.showMessageBox`（i18n 原生错误框）+ 15s watchdog → `application.forceExit(1)`：
```ts
const POST_SEAL_RELAUNCH_WATCHDOG_MS = 15_000

private handlePostSealRelaunchFailure(error: unknown): void {
  let finished = false
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const forceExit = (reason: string): void => {
    if (finished) return
    finished = true
    if (watchdog) clearTimeout(watchdog)
    logger.error(`post-seal relaunch escape: ${reason}`, error as Error)
    application.forceExit(1)
  }
  watchdog = setTimeout(() => forceExit('watchdog timeout'), POST_SEAL_RELAUNCH_WATCHDOG_MS)
  void dialog.showMessageBox({
    type: 'error',
    title: t('backup.restore.notification.relaunch_failed_title'),
    message: t('backup.restore.notification.relaunch_failed'),
    detail: t('backup.restore.notification.manual_restart'),
    buttons: [t('backup.restore.notification.exit')],
    defaultId: 0,
  }).then(() => forceExit('user acknowledged native dialog'))
    .catch((e: unknown) => { logger.error('post-seal relaunch failure dialog failed', e); forceExit('native dialog failure') })
}
```
`schedulePostSealRelaunch` 第二次 catch 改调 `this.handlePostSealRelaunchFailure(relaunchError)`。

**关键点**（Cursor）：
- 用 `dialog.showMessageBox`（**非 Sync**）—— Sync 阻塞 event loop，watchdog 跑不了
- watchdog 不 `unref()`，保证进程最终退出
- 一次性 `finished` 标志防 watchdog+dialog 双调
- **不释放 hold / 不删 journal / 不删 staging**（forceExit 后进程态消失，staged journal 留下次 preboot gate 继续处理；误清会丢恢复数据）
- **dev mode 仍 skip**（现有 isDev 分支保留——dev 不 relaunch，提示手动）
- `forceExit` 与 `application.relaunch` 语义差异在测试钉死

### 新 i18n keys（main locales en-us/zh-cn，其他 locale 走 #3 的 fallback）
```json
"backup.restore.notification": {
  "relaunch_failed_title": "Restore restart failed",
  "relaunch_failed": "The restore is ready, but Cherry Studio could not restart automatically.",
  "exit": "Exit"
}
```
（`manual_restart` 已存在，复用）

### 测试
`src/main/services/backup/__tests__/BackupService.restore.test.ts`（扩展现有"双失败"测试）：
- mock `dialog.showMessageBox` + `application.forceExit` + fake timers
- 场景：`relaunchStagedRestore` throw → fallback `application.relaunch` throw → `handlePostSealRelaunchFailure`：dialog 调用 + watchdog 超 → `forceExit(1)` **只一次**
- 分支：dialog resolve / dialog reject / dialog pending（watchdog 强退）/ 成功路径不触发 / 单 fallback 成功不触发

### 验证 / 回滚
- `pnpm vitest run src/main/services/backup` 绿
- `pnpm lint`（新 i18n key 跑 `pnpm i18n:sync`）
- 回滚：`git revert`

---

## 验证闭环（3 项全做完）

```bash
pnpm vitest run src/main/data/db/restore src/main/i18n src/renderer/i18n src/main/services/backup
pnpm i18n:check
pnpm lint        # oxlint + eslint + typecheck + i18n + format
pnpm build:check
```

**验收标准**：
1. 越界 `restoreId`（`../` / 绝对路径）永不删 stagingRoot 外文件
2. 任意 locale marker 不直接显示（fallback en-US）
3. 双 relaunch failure 必退出（dialog 或 watchdog → forceExit），不卡死
4. staged journal / staging tree 不因 relaunch 兜底被误清

## Commit 计划（3 个独立 commit，-S --signoff --no-verify，不 push）

1. `fix(restore): contain terminal journal cleanup to staging root`（#1）
2. `fix(i18n): fall back to en-US for untranslated markers`（#3）
3. `fix(backup): escape post-seal double-relaunch failure via dialog+watchdog`（#2）

## 风险 / 不做
- 不手改 translate/ JSON（生成产物，流程覆盖）
- 不无限 retry relaunch（fire-and-exit，重复调多实例/不可观测 child）
- 不在 cleanup "清整个 staging root"作 fallback（扩大删除面）
- silent-not-start（relaunch 不抛错但 child 没起）需跨进程 watchdog，非本次 scope（本地最小修只覆盖"第二次也 throw"卡死）
