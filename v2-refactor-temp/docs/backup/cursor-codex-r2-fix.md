# Cursor：codex round-2 修复（2 个安全 finding）

> 2 个已验证的安全 finding，连贯修。严守 backup/restore 架构边界，最小改动。完成后 orca send 到 term_6468b98a。

## 工作目录
主仓 `feat/backup-v2-restore` @ HEAD（6bcf8ae3ae round-1 之上）。你已在。

## 2 findings

### 1. [high] post-publish chmod 失败误报 credential archive 安全（archive.ts:204-214）
**问题**：round-1 把 `chmod(outPath, 0o600)` 放进 best-effort try（和 fsync 一起）。chmod 失败只 warn，export 报成功——但 archive 含明文 credential，可能以 0644 发布（其他本地用户可读）。chmod 是**安全不变量**，不是 durability。

**修**（最小）：把 `chmod` 从 best-effort try **移出**，作为 publish 后的 security invariant：
- copy 分支：`await chmod(outPath, 0o600)` 单独 try；失败 → `await unlink(outPath).catch(()=>{})` + throw（不发布 0644 credential archive）
- fsync（fsyncPath + fsyncParentDir）**保持** best-effort try-catch warn（durability，不阻塞）
- 即：publish 成功 → chmod（security，必须成功否则撤销）→ fsync（best-effort）

### 2. [high] preboot journal 允许 out-of-tree file ops（restoreJournal.ts:60-75 + restorePromotion.ts consumption）
**问题**：journal schema 的 `promote/aside/stagingPath/livePath/asidePath` 都只 `z.string().min(1)`，注释说 userData-relative，但 preboot 用 `path.resolve(userData, value)` 不防绝对路径/`../` → 逃逸 userData → rename/remove 信任任意路径。journal 是磁盘文件（可被 tampered），consumption 是信任边界，必须独立校验。

**修**（最小）：preboot consumption（restorePromotion.ts 读 journal 后、任何 fs op 前）加 containment 校验：
- 新增 shared helper（如 `assertPathInsideUserData(value, userData)`）：`resolve(userData, value)` 后用 `realpath` 解析（含 symlink parent），断言结果 `isPathInside` userData；拒绝绝对路径（`path.isAbsolute(value)`）和逃逸 `../`
- 对 `db.promote` / `db.aside` / 每个 `fileResources[].stagingPath/livePath/asidePath` 都校验
- 违反 → throw 稳定 error（journal corrupt/tampered，不执行 fs op）
- 复用 `@main/utils/file` 的 `isPathInside`（backup/admitArchive 已用）

## 约束
- 只改 archive.ts + restorePromotion.ts（+ 可能 restoreJournal schema 注释），不改架构边界
- 无 Co-authored-by，conventional + `backup` scope，`--signoff --no-verify`，不 push
- 最小改动，不过度设计（#1 只移 chmod 出 try；#2 只加 consumption 校验）
- 对照 `docs/references/backup/backup-architecture.md`（archive durability §、preboot promotion §）

## 验证
- `pnpm vitest run src/main/services/backup src/main/data/db/restore`（绿，含新测试）
  - #1 加测试：copy 分支 chmod 失败 → archive 不残留 / export 失败
  - #2 加测试：journal promote/aside 含绝对路径或 `../` → reject，不执行 fs op
- `pnpm lint`（绿）

## ⚠️ 反向通知
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "codex-r2 done: <hashes>, tests green, lint green, no co-author" --enter
```
