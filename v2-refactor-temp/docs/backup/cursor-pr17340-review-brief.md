# Cursor：Review PR #17340 同学推的更新（disclosure UI + relaunch gate）

> PR #17340（契约 PR，base `feat/backup-v2-restore`）同学往上面推了新 commit。你 review 这些更新的质量 + 与 A2 spine 的衔接。**只出本地报告，不 post 任何上游 comment**（PR 是 @DeJeune 的，发 finding 前必须问用户）。

## PR
- https://github.com/CherryHQ/cherry-studio/pull/17340
- head `1a6e5fda75`，base `feat/backup-v2-restore`，9 commits
- 先 `git fetch origin feat/backup-v2-restore`

## review 范围（同学最近推的 4 个 commit）
- `d8a84aab7a` docs(backup): pin restore-summary broadcast-then-wait spine contract
- `edabfe44ee` test(backup): add full-restore resource e2e fixtures
- `fd43bd83e0` feat(backup): add pre-relaunch restore disclosure summary UI
- `1a6e5fda75` fix(backup): gate restore relaunch on renderer confirmation

用 `git log --oneline origin/feat/backup-v2-restore` + `git diff <base>..origin/feat/backup-v2-restore -- <file>` 看每个 commit。

## review 维度
1. **正确性**：disclosure summary UI 数据流（plan → IPC → renderer 弹窗）；relaunch gate（renderer 确认才 relaunch，否则不重启）逻辑是否 fail-safe
2. **与 A2 spine 衔接**：disclosure UI 是否正确消费 `ImportBackupResult.plan`（`{ skips, toRestore, resources }`）——我们 A2 刚把这个暴露给 B4。确认字段名/形状一致，没有重复定义或 drift
3. **契约一致性**：`broadcast-then-wait` spine contract doc（`d8a84aab7a`）vs 实现：broadcast summary → 等 renderer ack → 才 relaunch，是否吻合
4. **测试覆盖**：e2e fixtures（`edabfe44ee`）是否覆盖 disclosure/relaunch 关键场景（有 skips / 全 restore / renderer 拒绝 relaunch）
5. **规范对照**：`docs/references/renderer-architecture.md`（UI 层级）/ `docs/references/ipc/README.md`（RPC vs REST + IpcContext）/ `docs/references/lifecycle/README.md`（relaunch 时机）

## 输出
- 本地报告写到 `v2-refactor-temp/docs/backup/cursor-pr17340-review.md`
- findings 分 P0（阻塞）/ P1（应修）/ P2（可选），每条给 file:line + 问题 + 修法
- **绝不 post 上游 comment / 不 push**

## 约束
- review-only，不改同学 PR 的代码
- 无 Co-authored-by

## 完成后
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "PR17340 review done: <P0数/P1数/P2数>, 报告 v2-refactor-temp/docs/backup/cursor-pr17340-review.md" --enter
```
