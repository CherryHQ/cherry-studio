# uf003-u1-31 候选状态（2026-11-26 23:0x UTC+8）

## 一、照抄可跑的复跑命令（工作目录固定，逐条独立）
```
cd /Users/cherryai003/HermesRuntime/cache/user-feedback/scratch/u1-31-run
python3 tests/u1_samples.py            # 期望 97/97 passed
python3 tests/u1_selfcheck_guard.py    # 期望 PASS: 自检对故障注入的防线
python3 tests/u1_dump_guard.py         # 期望 PASS: _dump 超大整数兜底
python3 tests/u1_adv31.py              # 期望 26/26 passed
python3 tests/u1_v110_contract.py      # 期望 15/15 passed
python3 state/uf-003/c1_probe2.py      # 期望 TOTAL: ALL OK（24 例）
python3 tools/conformance.py state/uf-003/baseline-20261124T105021.ndjson \
  --channel-map contract/channel-map.json \
  --baseline state/uf-003/baseline-20261124T105021.ndjson \
  --json state/uf-003/u1-31-selfcompare.json   # 期望 rc=0、673/673、violations_total=0
```
冻结只读副本（内容逐字相同，已复核五套全绿）：
```
cd /Users/cherryai003/HermesRuntime/codex-tasks/review-uf003-31/review
python3 tests/u1_adv31.py && python3 tests/u1_v110_contract.py && python3 state/uf-003/c1_probe2.py
```

## 二、实测数字（2026-11-26 23:0x UTC+8，candidate 同步进运行目录后重跑）
| 项目 | 结果 |
|---|---|
| `u1_samples.py` | 97/97 passed（RID=1060093 conv=10745033155462002 seq=5920850 qq_len=117） |
| `u1_selfcheck_guard.py` | PASS |
| `u1_dump_guard.py` | PASS |
| `u1_adv31.py` | 26/26 passed（连跑 3 次稳定） |
| `u1_v110_contract.py` | 15/15 passed（受签 1188/1188、全量 15258/15258） |
| 基线自比 | rc=0，rows_total=673 / history_rows=673 / violations_total=0，report.contract=v1.1 |
| C1 探针（修订2） | 24 例 ALL OK，错误文本点名白名单闭集与越界值 |

> 注意：运行目录 `tools/conformance.py` 曾落后于候选，2026-11-26 23:0x 已用 `cp -c` 同步（sha256 6c941b4d…），上表是在同步后的件上重跑。

## 三、本轮改动（相对生效路径 stage-003）
| 文件 | 变动 |
|---|---|
| `tools/conformance.py` | +163 / −29（699 行，sha256 6c941b4da66352f4d3c6c2b1…） |
| `uf003_identity.py` | +20 / −1（sha256 c948b31b9f26db62…） |
| `tests/u1_samples.py`、`u1_selfcheck_guard.py`、`u1_dump_guard.py` | +0 / −0（完全同源） |
| 新增 `tests/u1_adv31.py`(279 行)、`tests/u1_v110_contract.py`(238 行) | 新增 |

生效路径指纹（未改动）：`stage-003/tools/conformance.py` = 97c395dcec7497ac…；`stage-003/uf003_identity.py` = 146c77b093f2c40f…。

## 四、契约字面量对齐（修订4）
- `channel-map` 目标 `其他→其它`、`邮箱→支持邮箱` 已清；加载器新增 `target` 闭集校验（越界即 rc=3，点名字段与被拒值）。
- 真表 662 非空分布：企微 400 / QQ 209 / Discord 30 / Telegram 22 / 内部飞书 1；空 11。
- schema `来源渠道.enum` 9 项；8 条 rules 的 target 全部落在 enum 内，`企业微信→企微` 为别名收敛。

## 五、未决
1. **T0 时刻互斥且已过期**：维护者写「2026-11-26 09:00–09:15 (UTC+8) = 2026-11-27 01:00–01:15 UTC」；UTC+8 的 09:00 对应同日 01:00 UTC（不是次日），且 2026-11-26 09:00 已过去。待确认改为 2026-11-27 09:00–09:15 (UTC+8) = 2026-11-27 01:00–01:15 UTC。
2. R7 执行前必须先 `field-list` 读回单选列真实选项（不猜 8→12）。
3. 第 31 轮复核进行中（单轮封顶，一次通过制）。
