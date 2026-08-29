# Cursor 返工：b0ddce4551 的 3 个 review 问题

> 在 b0ddce4551 基础上 fixup（**amend**，不新开 commit）。完成后必须 orca send 到 term_6468b98a（见末尾）。

## 工作目录

主仓 `feat/backup-v2-restore` @ `b0ddce4551`（你已在）。

## 3 个问题（GLM review 发现）

### 1. translate 全量占位污染（surgical 违规）
你跑了**全量** `i18n:sync`，给 10 个 translate 文件各加了 ~32 个 `[to be translated]:` 占位（`delete`/`group_by`/`undo`/`manage_groups` 等无关 key），共 ~316 个，全是非 backup key，夹带进 backup PR。

**修**：回退 translate 目录到上轮（只回退 `translate/`，保留 admitArchive/archive/locales 的改动）：
```
git checkout ded94d49ea -- src/renderer/i18n/translate/
```

### 2. translate 漏同步这轮 2 个 key（vaayne #3 #4 要求 sync locale）
回退后 translate 的 confirm_content/pick_prompt 还是旧值。批量改值（10 文件：de-de / el-gr / es-es / fr-fr / ja-jp / pt-pt / ro-ro / ru-ru / vi-vn / zh-tw），用 perl/sed 批量替换：

**confirm_content**（注意整行精确匹配）：
- 旧值：`[to be translated]:Restoring will replace current data and relaunch the app. Continue?`
- 新值：`[to be translated]:Restoring will merge backup data into your current data (local non-empty values are kept), then relaunch the app. Continue?`

**pick_prompt**：
- 旧值：`[to be translated]:Select a .cbu backup archive to restore.`
- 新值：`[to be translated]:Select a .cherrybackup backup archive to restore.`

### 3. `Co-authored-by: Cursor` 违规
amend 时去掉这行（全局 git 规则 NO Co-Authored-By）。

## 约束（关键）

- **绝不跑 `pnpm i18n:sync`**（那就是 #1 的污染源）。`pnpm lint` 里的 `i18n:check` 只验证、不补 key，跑它即可。
- 只做三件事：回退 translate 占位 + 改 translate 2 个 key 值 + amend 去 Co-authored-by。不动别的文件。
- 改完确认：`git diff ded94d49ea -- src/renderer/i18n/translate/` 应该**只有** confirm_content + pick_prompt 两个 key 的值变化（+ 上轮已有的 overwrite_confirm 占位，那是 ded94d49ea 自带的，别动），没有任何新增 `[to be translated]:` 占位。

## 验证 + commit

- `pnpm vitest run src/main/services/backup`（绿）
- `pnpm lint`（绿；i18n:check 只验证）
- `git add -A && git commit --amend --signoff --no-verify`（去 Co-authored-by；subject 保持 `fix(backup): vaayne r3 lite gate, 0600, i18n`）
- **不要 push**（等 GLM 审）

## ⚠️ 完成后必须反向通知 GLM（不走 orca 收件箱）

```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "vaayne-r3 rework done: <new hash>, tests green, lint green, no co-author" --enter
```
