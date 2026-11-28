# 三件套写回计划（只写计划，不执行；2026-11-27 23:16 起）

## 现状（23:16 实测 sha256 前缀）
| 文件 | 生效件 sha | 大小/时间 | 候选件 | 评审状态 | 写回可执行？ |
|---|---|---|---|---|---|
| tools/window_to_rows.py | 6462b5ad | 19251 B / 22:11 | 无独立候选（现生效件即 R11 交付态） | UNREVIEWED_LIVE（无派发记录、无复核） | **否**，先补复核 |
| tools/bind_check.py | bf1262bc | 5577 B / 22:12（新建） | 同上 | UNREVIEWED_LIVE | **否**，先补复核 |
| uf003_identity.py | 99a605f9 | 87349 B / 17:11 | candidates/uf003-wecom-RID-key-20261127/uf003_identity.fix1.py = e6bfd880 | 无有效结论：编号 `r10` 的复核件有两份 —— `m1-gate-r10/final-message-r10.txt`（481 B / ca22b484 / 无 VERDICT，交付报告）与 `uf003-r10-review/final-message-r10review.txt`（9979 B / 27398c90 / 159 行 / **无 VERDICT 行**）→ 记 **未出结论**（原引用的 BLOCK 已撤回） | **否**，缺结论，需重派复核 |
| tools/m1_gate.py | 7eca78e7 | 9322 B / 20:32 | candidates/m1-gate-R1-fix/m1_gate.fix.py（13070 B，e4ac47f5） | r3a BLOCK → r3b BLOCK → **r3c ALLOW**（23:01，VERDICT 在首行） | **是**（ALLOW 已有）；写回排明日，须带“报告覆盖合并文件后 scratch 判空仍 rc=0”已知缺陷 |

结论：m1_gate 具备写回条件（r3c ALLOW），其余三件不具备。写回动作一律排明日。

## ALLOW 已知未修缺陷（m1_gate，写回后仍存在）
来源：`codex-tasks/m1-gate-r3c-review/final-message-gate-r3c.txt` 首行 `VERDICT: ALLOW`，正文第 15 行“已知缺陷：仍可复现”。

| # | 缺陷 | 复现 | 后果 | 修复单 |
|---|---|---|---|---|
| D1 | 报告与合并文件同名 | `--json "$WORK/collision/m1-new-only-merged.ndjson"`，其文件名与内部合并输出同名 | 报告被清理覆盖，scratch 目录判空，进程仍 rc=0 并打印 `M1_PASS` | R13 |

判据：**ALLOW 只表示“可以写回”，不表示“没有已知缺陷”**。写回后 D1 仍在，必须继续修；写回完成不等于缺陷关闭。

## 判定提取规则（本计划内所有 verdict 读取共用）
只认 `^VERDICT:` 整行（不论出现在第几行），用 Python 逐行 `startswith` 提取；禁用 rg/grep 等词面匹配。无该行 → **未出结论**（既不是 ALLOW 也不是 BLOCK，不可写回也不可回滚）；出现两行 → `verdict_duplicated`，整轮无效。

## 写回五步（乙方案，逐件执行，一件一账）
```
① 冻结：记录当前生效件 sha256 + size + mtime，写进台账（writeback-freeze）
② 备份：cp -c（APFS clone）到 release/m1/originals/<name>.<sha8>.sh|py
③ 替换：先写 <name>.new（同目录），chmod 755/644 与原一致，再 mv -f 原子替换
④ 回读：shasum -a 256 生效件必须等于候选件 sha256；stat 权限一致；行数一致
⑤ 记账：ledger 两行 —— writeback-done（含 before/after sha、候选来源评审文件名与日期）
        + rollback-recipe（一条可直接执行的回滚命令）
判据：④ 三条任一不符 → 立即用 ② 的备份回滚，并记 writeback-failed
```

## 逐件前置条件
- **window_to_rows.py**：需先派一份 terra 复核“R11 交付态 + 第三槽四列”合并判据（R13 落地后一并审），ALLOW 后才进入五步。
- **bind_check.py**：与 window_to_rows 同批复核（两者是字节绑定的两端，必须同批审）。
- **uf003_identity.py**：先按 r10/r2 的 BLOCK 项返修，再复核；不得跳过。
- **m1_gate.py**：gate-r2/r3a/r3b/r3c 四轮 BLOCK 的原因需先收敛成一份返修单，再重派。

## 排队（今晚不做）
第 9 项进程组 / fail-open（pgrep 失败）/ pending 唯一化 / marker TTL / 台账迁出 / PIN 重签 / `WARN_MODEL_NO_PROVIDER` 提示行 / 三件套写回本身。

## 今晚只做三件
① R12b / R13b 交付 + 各自 terra 复核（唯一在跑的实质工作）
② 写回：无 ALLOW，已改为“先出计划”（本文件）
③ 本计划本身
