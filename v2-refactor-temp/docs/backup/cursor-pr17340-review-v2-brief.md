# Cursor：Review PR #17340（A+B 合体后，集成视角 v2）

> PR #17346（A）已 squash merge 进 #17340（commit `a64e91ab58`）。现在 #17340 = disclosure（B）+ A 合体。fresh review 合体后的 #17340，看 A+B 集成有没有问题。**本地报告，不发上游 comment**（#17340 是同学 @DeJeune 的 PR，发 finding 前必须问用户）。

## PR
- https://github.com/CherryHQ/cherry-studio/pull/17340
- head `a64e91ab58`（含 disclosure + A squashed），base `feat/backup-v2-restore`
- 看 diff：`git fetch origin && git diff feat/backup-v2-restore...origin/feat/backup-v2-restore-contracts`

## 背景
- **B（disclosure，同学）**：B1 单入口（manifest.preset 自动路由）/ B2 KB reindex（onAllReady）/ B4 disclosure UI + relaunch gate（broadcast-then-wait）
- **A（squashed `a64e91ab58`，我们）**：planResources spine + A3 接线（broadcast 喂 plan）
- 之前分 review：
  - #17340 disclosure（v1）：P0=0 / P1=3 / P2=3。**P1-1（A2 接线）/ P1-2（e2e）已由 A 解决**；**P1-3（relaunch 失败 UI 无恢复）记本地未发**
  - #17346 A（review-v2）：P0=0 / P1=0 / P2=0

## review 维度（合体集成）
1. **A+B 集成**：disclosure 的 `broadcastRestoreSummary` 现在接 A 的 plan（A3 接线 `toSkip: plan.skips`）；spine（planResources 在 snapshot 后 merge 前）+ disclosure（sealed quiesce + broadcast-then-wait）合体一致？端到端：plan → merge → journal → broadcast → relaunch gate？
2. **P1-3 状态**（`app.relaunch` 失败 UI 无恢复，`RestoreV2Popup.tsx` `void ipcApi.request` 无 catch → quiesce 永久卡死）：合体后仍 open？同学修了？还是记本地？
3. **合体（squash）完整**：A squashed 进 contracts，代码完整无丢失？（对照之前 A1+A2 review-v2 的结论）
4. **整体回归**：A+B 合体后 full restore staging 端到端一致？
5. **规范对照**：`docs/references/main-process-architecture.md` / `data/` / `ipc/README.md` / `lifecycle/README.md`

## 输出
- 本地报告 `v2-refactor-temp/docs/backup/cursor-pr17340-review-v2.md`
- P0/P1/P2，每条 file:line + 问题 + 修法
- **绝不 post 上游 comment**（同学的 PR）

## 约束
- review-only，不改代码
- 无 Co-authored-by

## 完成后
```
orca terminal send --terminal term_6468b98a-5e7c-46b6-90db-6b590e0bafb0 --text "PR17340 review-v2 (A+B 合体) done: <P0数/P1数/P2数>" --enter
```
