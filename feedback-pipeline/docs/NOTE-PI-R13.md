# NOTE-PI-R13（cwd release/m1；只改 candidates/m1-gate-R1-fix/m1_gate.fix.py）

改前候选 `e4ac47f5c3159d3c3830d18f8e8d7c8e74ab68f5d0e7f783af0c74393eae454a` 13070 B → 改后 `4c6349b1bb270d81329380ecdcddaf0297ea3dd4542003dd308d0de504ae49eb` 15240 B。
环境：`/usr/bin/python3` 3.9.6，全程 `-B`；fixture 在 `cache/scratch/pi-r13/`。
`BASE=cache/u1b-test/real743x34.ndjson`（743 行，sha `b268b1df5169dfea0e008b5e40009083e342ac0bede09c511bf8c63f0924a061`）；`GOOD=cache/scratch/pi-r13/good-new.ndjson`（744 行=743+1 合法新行，sha `90e77ede…`，new-only rc=0 用例）。
改动：① 未给 `--json` 且给了 `--scratch` → 报告 `<scratch>/m1-gate-<pid>-<6hex>.json`（`secrets.token_hex(3)`）；② 显式 `--json` 的 realpath basename（NFC+小写）= `m1-new-only-merged.ndjson` 且本次确会写合并文件 → `M1_REPORT_PATH_COLLISION` rc=3、零写盘；③ 报告一律 `os.open(O_CREAT|O_EXCL|O_WRONLY,0600)`，EEXIST → `M1_REPORT_PATH_TAKEN` rc=3，不覆盖不删除；④ `finally` 只删本次合并文件，清理后 `lstat` 复核报告为非空普通文件，否则 `M1_REPORT_LOST` rc=3；⑤ 新分支全走 `M1_*`，rc 只 0/3。

## 1 D1 改前（备份原候选 e4ac47f5，未改件）
```
$ python3 -B /Users/cherryai003/HermesRuntime/cache/user-feedback/scratch/review-gate-r3/release-m1-20261127T142709Z/candidates/m1-gate-R1-fix/m1_gate.fix.py --rows cache/scratch/pi-r13/good-new.ndjson --baseline cache/u1b-test/real743x34.ndjson --contract v1.11 --new-only --scratch cache/scratch/pi-r13/before/d1 --json cache/scratch/pi-r13/before/d1/m1-new-only-merged.ndjson
{"ok": true, "contract": "v1.11", "rows_total": 744, "new_rows": 1, "history_rows": 743, "mode": "new-only", "baseline_rows": 743, "violations_total": 0, "hard": {}, "advisory": {}, "json": "cache/scratch/pi-r13/before/d1/m1-new-only-merged.ndjson"}
M1_PASS: 硬红 0，告警 0 类（存量口径，已记录）
rc=0
$ ls -la cache/scratch/pi-r13/before/d1
total 0
drwxr-xr-x  2 cherryai003  staff   64 Nov 27 23:52 .
drwxr-xr-x  5 cherryai003  staff  160 Nov 27 23:52 ..
$ find cache/scratch/pi-r13/before/d1 -type f | wc -l
0
```
## 2 改动后同一命令
```
$ python3 -B candidates/m1-gate-R1-fix/m1_gate.fix.py --rows cache/scratch/pi-r13/good-new.ndjson --baseline cache/u1b-test/real743x34.ndjson --contract v1.11 --new-only --scratch cache/scratch/pi-r13/d1 --json cache/scratch/pi-r13/d1/m1-new-only-merged.ndjson
M1_REPORT_PATH_COLLISION: 报告路径与合并文件同名 cache/scratch/pi-r13/d1/m1-new-only-merged.ndjson
rc=3
$ ls -la cache/scratch/pi-r13/d1
total 0
drwxr-xr-x  2 cherryai003  staff   64 Nov 27 23:56 .
drwxr-xr-x  7 cherryai003  staff  224 Nov 27 23:58 ..
$ find cache/scratch/pi-r13/d1 -type f | wc -l
0
```
## 3 D2 改前 / 改后
- 改前（原候选，同 `--json` 顺序 743→744）：rc1=0、报告 rows_total=743 → rc2=0、报告 rows_total=744（后写覆盖）；并发同 `--json`：rc1=0 rc2=0，目录仅 1 份 `gate.json`（rows_total=744）。
- 改后同 `--json` 顺序：rc1=0 → rc2=3，首行 `M1_REPORT_PATH_TAKEN: cache/scratch/pi-r13/final2/d2/gate.json`；胜者报告仍 rows_total=743 ok=True 1344 B。
- 改后并发同 `--json`：rc1=0 / rc2=3，out2 首行 `M1_REPORT_PATH_TAKEN: cache/scratch/pi-r13/final2/d2c/gate.json`，胜者报告 1344 B 未覆盖。
- 改后不同 `--json` 并发：rc1=0 rc2=0；`gate-a.json` 52 行 bytes=1344 ok=True rows_total=743；`gate-b.json` 52 行 bytes=1344 ok=True rows_total=744。

## 4 未给 `--json`（给 `--scratch`，743 自比连跑两次）
```
run1 → cache/scratch/pi-r13/final2/auto/m1-gate-27638-4dd72a.json
run2 → cache/scratch/pi-r13/final2/auto/m1-gate-27641-fbd01f.json
```
两个不同文件，均 1344 B；正则 `^m1-gate-\d+-[0-9a-f]{6}\.json$` 全匹配。

## 5 正控不回归（BASE 743 行）
```
full: {"ok": true, "contract": "v1.11", "rows_total": 743, "new_rows": 0, "history_rows": 743, "mode": "full", "baseline_rows": 743, "violations_total": 0, "hard": {}, "advisory": {}, "json": null} / M1_PASS: 硬红 0，告警 0 类（存量口径，已记录） / rc=0
new-only 同文件: M1_NO_NEW_ROWS: 窗口内没有超出基线的记录（新行 0 / 基线 743），拒绝出空跑绿 / rc=3
```
## 6 负控不回归（全 rc=3）
```
缺文件: M1_READ_FAIL: FileNotFoundError: [Errno 2] No such file or directory: 'cache/scratch/pi-r13/final2/nope.ndjson'
空文件: M1_READ_FAIL rc=3: READ_FAIL: 输入为空，无法判定（空导出不等于通过）
坏 JSON: M1_READ_FAIL: JSONDecodeError: Expecting value: line 2 column 1 (char 6)
缺 --scratch: M1_READ_FAIL: 有新行时必须显式给 --scratch <已存在且可写目录>
--json scratch 外（有 scratch）: M1_READ_FAIL: --json 必须落在 --scratch 目录内（给定 /tmp/pi-r13-outside-final2.json，scratch cache/scratch/pi-r13/final2）；ls → No such file or directory
--json scratch 外（无 scratch）: M1_READ_FAIL: --json 必须落在 --scratch 目录内（给定 /tmp/pi-r13-outside-noscratch.json，scratch 未给）；ls → No such file or directory
```
另：已存在 `--json` → `M1_REPORT_PATH_TAKEN` rc=3 且 `KEEP-ME` 未动；`--json` 为目录 → TAKEN rc=3。
退出码扫描 37 条（含 --help/无参/未知参数/缺文件/空/坏 JSON/软链/越界/同名/已存在/自动报告/479 真实合并）：`RC_SET(37)=[0, 3]  TRACEBACK=0`。
`M1_REPORT_LOST` 分支用 harness 在清理时删报告复现：首行 `M1_REPORT_LOST: …/lost-final/gate.json`、rc=3。

## 7 sha256
```
4c6349b1bb270d81329380ecdcddaf0297ea3dd4542003dd308d0de504ae49eb  15240 B  candidates/m1-gate-R1-fix/m1_gate.fix.py（新）
7eca78e71b5a16b0ff44b341879713806744b3cf9af516f8292f099e0b67647f  tools/m1_gate.py        ✓ 与任务书一致
8e0b90e7ffab29701e42243abdbeb5b7bf2cc7756c15ee68445b033cfb5faefa  run-m1.sh              ✓ 与任务书一致
f414db2c17ec54a444ecdde95aef10bef6969de026f5bbbc57ba13d5c9a89c97  tools/bind_check.py     ✗ 任务书给 bf1262bcee030d01727e706f0e5e1179e40f0ea7bf85f02b9cb3456a84f9fe12；本单元未写它，23:48:16 被并行 PI-R12 改为 13557 B（NOTE-PI-R12.md）
6462b5ad15ee8315b873aba8433b72e0e67fa0fb9ea0534b74851df5cf208b7e  tools/window_to_rows.py ✓ 与任务书一致
99a605f9356a0a818876ab5d6520a9e71f94b81e38cb1b3e9e53737ba10df4cb  uf003_identity.py       ✓ 与任务书一致
05a6a4d3792dcc760f397af1b00f3dd588be0aa7b5f6f2343faf4cacb5f30ef9  PIN.json               （任务书未给值，仅记录）
```
