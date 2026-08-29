# Cursor 审查任务：backup v2 hardening 计划系列

> 只读审查。**不要改 `.trellis` 计划、`src` 代码、测试**。只产出审查报告。

## 审查对象（主仓 feat, commit dd4eaf7bea）

计划文件（绝对路径，对照主仓读，不是你的 backup-cs-audit 工作树）：
- Roadmap parent：`/Users/gd32/Coding/CherryV2/.trellis/tasks/07-23-backup-v2-hardening-roadmap/prd.md`
- 19 child task：`/Users/gd32/Coding/CherryV2/.trellis/tasks/07-23-p0-*/prd.md`、`07-23-p1-*/prd.md`（其中 12 个另有 `design.md`：journal-crash-converge / merge-identity-propagation / dbonly-fileentry-blob / uniquemergerules-fk / busy-gate-restart / overwrite-windows / appstate-invariant-timing / composite-fk-partialnull / fts-migration-order / staging-gc-corrupt / residual-artifacts-gc / completed-disclosure）
- Branding 占位：`/Users/gd32/Coding/CherryV2/.trellis/tasks/07-23-backup-extension-rename/prd.md`
- 审计事实来源：`/Users/gd32/Coding/CherryV2/v2-refactor-temp/docs/backup/backup-v2-correctness-audit.md`

## 对照源码

`/Users/gd32/Coding/CherryV2/src`（feat dd4eaf7bea）。审根因时去源码核对 file:line。

## 每个 task 的审查点

1. 根因引的 `file:line` 是否准确（去源码核对，指出偏移）
2. 修复方案是否技术合理——会否引入新问题 / 副作用 / 破坏现有不变量
3. 边界 / 兼容性 / 回滚是否考虑周全
4. 验收标准是否可验证、是否漏测关键场景
5. 优先级 / 依赖是否合理（尤其 B1 identity-propagation 是 uniquemergerules-fk / dbonly-fileentry-blob 的基础这个判断对不对）
6. 遗漏的问题或风险（审计没覆盖、方案没考虑的）

## 重点关注

- **P0 安全**：`p0-managed-path-canonical`（canonical 透传防 symlink+`..` 绕过）、`p0-journal-path-guard`（restore journal 路径约束）——方案能否真正堵住攻击面。
- **最大工程 B1**：`p1-merge-identity-propagation`（identity ledger + ordinary FK / required JSON soft-ref 重写）——设计是否正确、tuple-safe ledger 不变量是否完备、post-import phase 时机是否对。
- **数据正确性主线**：`p1-dbonly-fileentry-blob`、`p1-uniquemergerules-fk`、`p1-journal-crash-converge`、`p1-busy-gate-restart`。

## 输出

写到 `/Users/gd32/Coding/CherryV2/v2-refactor-temp/docs/backup/hardening-plan-review.md`：

- 每个 task 一段：`✅合理` / `⚠️问题（具体 + 建议）` / `🔴严重（具体 + 阻塞）`
- 整体小结：计划完整性、优先级建议、阻塞性问题清单、可立即开工的 vs 需返工的。
- 如发现计划与 feat 源码不一致（file:line 偏移、方案前提不成立），明确列出。

## 完成后

用 `orca orchestration` 通知 `term_17766fca`（GLM），告知报告路径。

## 约束

- 只读：不改 `.trellis/` 计划、不改 `src/`、不改测试。
- 对照**主仓 feat**（`/Users/gd32/Coding/CherryV2`），不是你的 backup-cs-audit 工作树。
- 审计划合理性 + 与代码一致性，不要重新实现。
