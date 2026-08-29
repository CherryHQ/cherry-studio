# Cursor：backup v2 spec compliance hardening（8 important + 4 minor）

> 完整方案见 `/Users/gd32/Coding/CherryV2/.trellis/tasks/07-24-backup-v2-spec-compliance/implement.md`（+ 同目录 `prd.md` 验收）。按它修。完成后 orca send 到 term_6468b98a。

## 工作目录
主仓 `feat/backup-v2-restore` @ `91a1465ee0`（你已在）。

## 范围（8 important，详见 implement.md 每条决策+步骤）
- **naming**：删 2 个嵌套 barrel（`contributors/index.ts` + `merge/index.ts`，消费者改具体模块 import）+ 3 重命名（`ExcludedDomainStripper.ts`→`SqliteBackupStripper.ts` / `FileStager.ts`→`SqliteFileStager.ts` / `FtsCentralHelper.ts`→`ftsCentral.ts` + object 改函数）
- **ipc**：新建 `src/shared/ipc/errors/backup.ts`（`backupErrorCodes` const map，对照 knowledge.ts 风格，先 grep 收齐全部 code）+ BackupService 13 处 bare string → const + renderer 3 处 → const + handler senderId gate（+INVALID_SENDER）
- **lifecycle**：BackupService owned Emitter 删 registerDisposable，改 onDestroy dispose
- 4 minor 随带（senderId 测试 / renderer instanceof IpcError / 两处 application.get 先赋局部变量）

## 约束（关键）
- **无 Co-authored-by**（上轮违规过）
- 分 logical commits（naming / ipc / lifecycle），conventional + `backup` scope，`--signoff --no-verify`
- 对照 `docs/references/{naming-conventions,ipc/ipc-overview,lifecycle/lifecycle-usage}.md`
- 重命名用 `git mv` + grep 更新所有 import
- **不 push**（等 GLM 审 + codex review）
- 顺序：ipc error map（#6）→ lifecycle（#8）→ ipc senderId（#7，用 #6 的 map）→ barrel（#1#2）→ 重命名（#3#4#5，放最后）

## 验证
- `pnpm vitest run src/main/services/backup`（绿）
- `pnpm lint`（绿）
- grep 自检：`grep -rn "new IpcError(['\"]BACKUP" src/main/services/backup` → 0；backup 下无嵌套 barrel

## ⚠️ 反向通知（不走收件箱）
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "spec-compliance done: <hashes>, tests green, lint green, no co-author" --enter
```
