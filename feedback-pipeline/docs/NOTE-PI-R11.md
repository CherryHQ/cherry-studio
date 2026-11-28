# NOTE-PI-R11（2026-11-27，cwd release/m1；被审起点 tools/window_to_rows.py = 04f15e4f… 18546 B）

## 改了什么（只动 3 个文件）
- **tools/window_to_rows.py**：① `read_window()` 同一份 bytes → sha256 → `raw.decode("utf-8")`（无 `errors=`、不剥 BOM）→ `json.loads(text)`，不再 `json.loads(bytes)`；BOM → JSONDecodeError、UTF-16 → UnicodeDecodeError（ValueError 子类）→ 原 except → WindowError → rc=3，`--out` 不创建。
  ② 删除模块级 `WINDOW_SHA`；`read_window(path, sha_out)` 记入调用方传入的 dict，`main()` 每次新建 `window_sha = {}`；汇总键名/结构不变。
- **tools/bind_check.py**（新建）：只读比对 selfcheck.json `checks[].used_bytes_sha256` 与 gen-report.json `used_bytes_sha256`（键去 `.json`）。四渠道两侧都存在、64 位小写 hex、逐字相等 → 每渠道 `BINDING_OK <ch> <sha16>` rc=0；
  否则 `BINDING_MISMATCH <ch> self=<sha|MISSING|INVALID:type> gen=<…>` rc=3；参数/文件/JSON/结构错 → stderr 单行 `BIND_CHECK_FAIL` rc=3。整体 except，无 traceback。
- **run-m1.sh**：L102 改为 `( set -o pipefail; python3 -B tools/window_to_rows.py … | tee "$OUTDIR/gen-report.json" ) || fail "行源"`（子 shell pipefail：否则管线 rc 只看 tee；实测 /bin/bash 3.2.57 无 pipefail 时生成 rc=3 被吞成 0）。新增 `ROWS_SOURCE` 标记；
  `pass "行源"` 后、关卡4 前插入关卡3.5：行源 window_to_rows → `bind_check … || fail "字节绑定"`；行源 run-dir → `echo "BINDING_NA rows_source=run-dir"` + `pass`。`--fixture-demo`/`--rows` 路径、`--baseline` 必填、`--scratch "$OUTDIR"`、退出码 0/3 均未动。

## 1. 严格解码负控（同进程 import，直接喂 read_window；module has WINDOW_SHA attr: False）
```
NEG utf8-bom               bytes=efbbbf5b7b7d5d       -> RAISED WindowError: …（JSONDecodeError: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)） | sha_recorded=[]
NEG utf16-le-bom           bytes=fffe5b007b007d005d00 -> RAISED WindowError: …（UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte） | sha_recorded=[]
NEG plain-utf8 (control)   bytes=5b7b7d5d             -> RETURNED [{}]  sha_recorded=['e10808d43975dc400731053386849f864f297e6c4f7519c380f3dbaf7067a840']
CLI（run 目录 discord.json = efbbbf5b5d）：rc=3 stdout_bytes=0 out_exists=no  stderr: WINDOW_READ_FAIL: …raw/discord.json（JSONDecodeError: Unexpected UTF-8 BOM (decode using utf-8-sig) …）
CLI（discord.json = fffe5b005d00）：    rc=3 stdout_bytes=0 out_exists=no  stderr: WINDOW_READ_FAIL: …raw/discord.json（UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 0 …）
改动前对照（同机 python3 -c）：json.loads(bytes) 对这两种输入都返回 [{}]（放宽）；改后两者均被拒。
```

## 2. 真实正控（UF003_CONTRACT_DIR=$PWD/cache/contract-view UF003_CONTRACT_VERSION=v1.11）
```
$ python3 -B tools/window_to_rows.py --run /Users/cherryai003/HermesRuntime/workspace/user-feedback/feedback-sync/runs/external-a-20261127T0800 --out /tmp/pi-r11/rows.ndjson
{"ok": true, "rows": 479, "by_channel": {"wecom": 9, "qq": 194, "telegram": 275, "discord": 1}, "underived": {"工作项键": 479, "日期": 479, "profile": 479, "工作项": 479, "类型": 479, "对象": 275, "输入": 479, "输出": 479, "状态": 479, "tokens": 479, "调用数": 479, "工具摘要": 479, "委派次数（含 Codex）": 479, "飞书次数": 479, "GitHub次数": 479, "置信度": 479, "需人判断": 479, "待决事项": 479, "失败原因": 479, "置信度分": 479, "置信度理由": 479, "查重次数": 479, "重复命中数": 479, "明细行键": 479, "事件序号": 479, "PM 工作项": 479, "身份状态": 479, "身份原因": 479, "身份对账": 479}, "blocked_rows": 0, "out": "/tmp/pi-r11/rows.ndjson", "missing": [], "placeholder_rows": 1, "used_bytes_sha256": {"wecom.json": "309fe02c3c08af28b90604cefc3399b816d95a5a36ec7ca21b23a1e1effad85c", "qq.json": "feba8dd374cac5ae1db0777608a42e5a075d150542fcf5b8a01de997d8ac702c", "telegram.json": "adb138329aed31a184119a528d0b84f2203f52bebdae54cf1df5af711452cdaf", "discord.json": "22bdce4e46dba74e6e5b7e27ee60e0dcc36248292cecedf185abce466af19e05"}}
rc=0   stderr: INFO contract_dir=…/cache/contract-view UF003_CONTRACT_VERSION=v1.11 contract_version=v1.11 batch_key=20261127 round4=800 / WARN discord row#479 ID 解析失败：discord guild: 没有可用的候选键（试过 guild_id/guild）    wc -l rows.ndjson → 479
USED wecom 309fe02c3c08af28b90604cefc3399b816d95a5a36ec7ca21b23a1e1effad85c | SUM wecom 309fe02c3c08af28b90604cefc3399b816d95a5a36ec7ca21b23a1e1effad85c → EQUAL wecom 309fe02c3c08af28 ;  USED qq feba8dd374cac5ae1db0777608a42e5a075d150542fcf5b8a01de997d8ac702c | SUM qq feba8dd374cac5ae1db0777608a42e5a075d150542fcf5b8a01de997d8ac702c → EQUAL qq feba8dd374cac5ae
USED telegram adb138329aed31a184119a528d0b84f2203f52bebdae54cf1df5af711452cdaf | SUM telegram adb138329aed31a184119a528d0b84f2203f52bebdae54cf1df5af711452cdaf → EQUAL telegram adb138329aed31a1 ;  USED discord 22bdce4e46dba74e6e5b7e27ee60e0dcc36248292cecedf185abce466af19e05 | SUM discord 22bdce4e46dba74e6e5b7e27ee60e0dcc36248292cecedf185abce466af19e05 → EQUAL discord 22bdce4e46dba74e
cmp 改动前基线 stdout vs 改后 stdout → IDENTICAL；stderr（去 INFO 路径行）diff 为空。WARN 是本机生产件 99a605f9 无 discord guild 兜底所致（占位，非 blocked），DISPATCHES 已记。
```

## 3. 脏状态负控（同一进程连续两次 main()；第二次 run 目录 raw/ 只有 wecom/qq/discord）
```
call1 rc=0 rows=479 by_channel={'wecom': 9, 'qq': 194, 'telegram': 275, 'discord': 1} missing=[] sha_keys=['discord.json', 'qq.json', 'telegram.json', 'wecom.json']
call2 rc=0 rows=204 by_channel={'wecom': 9, 'qq': 194, 'discord': 1} missing=['telegram'] sha_keys=['discord.json', 'qq.json', 'wecom.json']
call2 telegram sha present: False ; call2 rows == sum(other three): True = 204 ; call2 sha set == files actually read: True
改动前同一脚本：call2 sha_keys 含 'telegram.json'，带第一次的 adb13832…（bug 复现）。
```

## 4. 回归（逐个独立跑；日志与改动前基线 diff 只差随机临时目录名/PID）
```
$ python3 -B tests/test_window_to_rows.py  → rc=0  PASS 39 / FAIL 0  TESTS 39/39
$ python3 -B tests/test_u1b_a.py           → rc=0  PASS 83 / FAIL 0  SUMMARY mode=disk total=83 pass=83 fail=0
$ python3 -B tests/test_u1b_c.py           → rc=0  PASS 15 / FAIL 0  SUMMARY total=15 pass=15 fail=0
```

## 5. bind_check 负控/正控（/tmp/pi-r11/bind/*；sha 取真窗口四值）
```
sc-ok + gen-ok                                 → BINDING_OK wecom 309fe02c3c08af28 / BINDING_OK qq feba8dd374cac5ae / BINDING_OK telegram adb138329aed31a1 / BINDING_OK discord 22bdce4e46dba74e   rc=0
sc-ok + gen(qq 改成 000…0)                     → BINDING_MISMATCH qq self=feba8dd3…702c gen=0000000000000000000000000000000000000000000000000000000000000000   rc=3
sc(telegram skipped、discord 无项) + gen-ok    → BINDING_MISMATCH telegram self=MISSING gen=adb13832…2daf ; BINDING_MISMATCH discord self=MISSING gen=22bdce4e…9e05   rc=3
sc-ok + gen(discord 文件缺失)                  → BINDING_MISMATCH discord self=22bdce4e…9e05 gen=MISSING   rc=3
两侧同为 "deadbeef"（非 64 hex）               → BINDING_MISMATCH <四渠道> self=INVALID:str gen=INVALID:str   rc=3（不因「相等」误放行）
gen 空文件 / gen 非 JSON → BIND_CHECK_FAIL: JSONDecodeError: Expecting value: line 1 column 1 (char 0) rc=3 ;  sc {"checks":"nope"} → BIND_CHECK_FAIL: ValueError: selfcheck 顶层不是对象或缺 checks 数组 rc=3
gen 路径不存在 → BIND_CHECK_FAIL: ValueError: --gen 不存在或不是文件 …/does-not-exist.json rc=3 ;  --selfcheck <目录> / 无参 → BIND_CHECK_FAIL: USAGE the following arguments are required: --gen / …--selfcheck, --gen rc=3 ;  参数互换 → BIND_CHECK_FAIL: ValueError: gen 顶层不是对象或缺 used_bytes_sha256 对象 rc=3
全程无 traceback。
```

## 6. 入口联通（真实入口；本机 uf003_identity.py = 99a605f9 旧版）
```
$ ./run-m1.sh --run /Users/cherryai003/HermesRuntime/workspace/user-feedback/feedback-sync/runs/external-a-20261127T0800 --baseline /Users/cherryai003/HermesRuntime/candidates/uf003-u2.0-r2/real743x34.ndjson --contract v1.11
CONTRACT_OK v1.11 qq_sha256=6094df77179a7b21 qq_owner=v1.10 file_sha256=d9b9ad9f2c750a28 bytes=4054
STAGE=1 契约前置校验 RC=0
SELF_CHECK_FAIL python_rc=3（已归 3）
 "rc_reason": "无有效采样（全部 skipped 或采样数为 0）"
STAGE=2 身份自检 RC=3
RUN_M1_RUN_RESULT RC=3 out=out/20261127
rc=3    selfcheck.json: wecom/qq/telegram 三项均 "skipped": "缺 raw/<ch>-window.json/…"（旧版只认 *-window.json 文件名）→ 关卡3/3.5/4 本次不可达。
```
已知待装候选所致，未改它。为给出关卡3.5 经同一段脚本的证据，另在 /tmp/pi-r11/tree 搭隔离树（其余条目软链回仓库，仅 uf003_identity.py 换成候选副本 e6bfd880、out/ 为独立空目录；仓库零写入）：
```
[runA 四渠道齐]  STAGE=1 契约前置校验 RC=0 / STAGE=2 身份自检 RC=0 / {"ok": true, "rows": 479, "by_channel": {"wecom": 9, "qq": 194, "telegram": 275, "discord": 1}, …}（tee 同步落 gen-report.json）/ ROWS_SOURCE=window_to_rows out/20261127/rows.ndjson / STAGE=3 行源 RC=0
                 BINDING_OK wecom 309fe02c3c08af28 / BINDING_OK qq feba8dd374cac5ae / BINDING_OK telegram adb138329aed31a1 / BINDING_OK discord 22bdce4e46dba74e
                 STAGE=4 字节绑定 RC=0 / {"ok": false, … "new_rows": 479, "hard": {"workitem_key_empty": 479, "seq_type_bad": 479} …} M1_BLOCK: 硬红 2 类，禁止入表 / STAGE=5 判定 RC=3 / RUN_M1_RUN_RESULT RC=3 out=out/20261127 / rc=3
[runB run 目录自带 rows.ndjson]  STAGE=1…RC=0 / STAGE=2…RC=0 / ROWS_SOURCE=run-dir …/rows.ndjson / STAGE=3 行源 RC=0 / BINDING_NA rows_source=run-dir / STAGE=4 字节绑定 RC=0 / STAGE=5 判定 RC=3 / RUN_M1_RUN_RESULT RC=3 / rc=3
[runC 无 discord.json]  STAGE=1…RC=0 / STAGE=2…RC=0 / {"ok": true, "rows": 478, … "missing": ["discord"]} / ROWS_SOURCE=window_to_rows … / STAGE=3 行源 RC=0 / BINDING_MISMATCH discord self=MISSING gen=MISSING / STAGE=4 字节绑定 RC=3 / RUN_M1_RUN_RESULT RC=3 / rc=3（判定未执行）
```
runA 的判定 RC=3 是既有闸门结论（workitem_key_empty / seq_type_bad，见 window_to_rows 模块说明），与本任务无关；关卡顺序 1→2→3→3.5→4，只多插一道。

## 7. 收尾 sha256 / 字节数
```
6462b5ad15ee8315b873aba8433b72e0e67fa0fb9ea0534b74851df5cf208b7e  tools/window_to_rows.py  19251 bytes（改前 04f15e4f… 18546）
bf1262bcee030d01727e706f0e5e1179e40f0ea7bf85f02b9cb3456a84f9fe12  tools/bind_check.py       5577 bytes（新建）
8e0b90e7ffab29701e42243abdbeb5b7bf2cc7756c15ee68445b033cfb5faefa  run-m1.sh                 7413 bytes
```
范围旁证：uf003_identity.py 99a605f9 / m1_gate.py 7eca78e7 / PIN.json 05a6a4d3 / conformance 1c94bd02 / id_patterns eacd1d2a / contract_preflight d1fd0295 均与改前一致（m1_gate ≠ PIN d0d49c22 为改前既有、DISPATCHES L187 已记，mtime 20:32）。
`out/20261127/selfcheck.{json,err}` 由第 6 节真实入口运行按其产物纪律重写（22:14），gate.json 仍为 20:28。DISPATCHES.md 22:13:10 被另一进程追加（网关侧进程台账），非本任务写入。
