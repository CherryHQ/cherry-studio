# TICKET-SCRATCH-LEAK-20261128 —— m1_gate --new-only 合并临时文件泄漏

状态：已挂单（业主 2026-11-28 裁定：按现状报签 898abfd3a1a7，泄漏另开一单，**切流前必须派出并处理**）
归属：既有缺陷（生效件 tools/m1_gate.py 同源同行为），非候选件 898abfd3a1a7 引入
实测：默认 scratch `~/HermesRuntime/cache/user-feedback/scratch/m1-gate`，v1.13 连跑 2 次 → 文件数 98 → 100，每个 585,052 B，每轮 +1、永不删除（两件均无 `unlink|finally|remove(`）
上线后果：切流后按小时跑 → 每天约 +14 MB，一年约 5 GB

## 第二步拆分（必须分两步做，先后不可合并）

### Step 1（代码）—— 独立升版、独立复核
- 动什么：`_split_new_only()` 写完 merged 文件后，在 `finally` 里 `os.unlink(merged_file)`（异常路径同样删）；不动判定逻辑、不动报告键、不动覆写/白名单/凭据门。
- 影响面：`--new-only` 路径的临时文件生命周期；conformance 仍按合并文件读入（读发生在 unlink 之前），判定结果不变。
- 怎么验证：v1.13 回归全套数不变（594/469/476/{7,469}、rkc 479/479、fam 479/479）+ G 三档 diff 全 NONE + 连跑 2 次 scratch 目录文件数为 0。
- 怎么回滚：保留当前 sha 原件，替换前备份；回滚即换回上一版 gate 文件（单文件，无状态迁移）。

### Step 2（存量清理）—— 批量删除，先交四行材料只读复核，PASS 才删
- 动什么：删除 `~/HermesRuntime/cache/user-feedback/scratch/m1-gate/m1-new-only-merged-*.ndjson`（截至挂单 100 个，约 57 MB）。
- 影响面：仅 scratch 下的中间产物；gate 每次运行自建自用，删后下一次运行不受影响；不触碰 release/、contract/、台账、报告。
- 怎么验证：删除前后 `ls | wc -l` 与 `du -sh` 对照；删后跑一次 v1.13 确认 rc=0 且 594/469/vt 0 不变。
- 执行约束（**删除前置门，缺一不可**）：先确认没有 gate 正在跑 —— `lsof` 无 `m1-new-only-merged-*` 句柄，且无正在执行的 gate 进程。进程检查用 `pgrep -fl 'python3 .*m1_gate\.py'`（实测 `pgrep -f m1_gate.py` 会被命令行里带该文件名的 shell 包装器命中，产生误报，不能作判据）；两条都空才可删。理由：若某轮正在跑而合并临时文件被删，conformance 读不到合并流会报 READ_FAIL，被误当真红。删完立刻按上条跑一次 v1.13 复核。
- 怎么回滚：这是可再生中间文件，无回滚需求；若误删非该前缀文件，从备份盘 `/Volumes/AgentBackup003/hermes-backups` 取回。

## 时间约束
Step 1 与 Step 2 均须在**切流前**完成；切流后启动的小时级调度不得在泄漏未修状态下运行。
