# NOTE-PI-R12 — bind_check.py 收紧（只改 tools/bind_check.py）

结论：四条改动已落地。REVIEW-R11 四个反例改前全部假绿或崩溃、改后全部 `rc=3` 且无 traceback；正控与原有负控无回归；
真实窗口端到端正控 `rc=0`、改一位 `rc=3`。只改 `tools/bind_check.py`（5577 → 13557 B）。

## 1. 四个反例：改前（/tmp/bind_check.before.py）→ 改后（tools/bind_check.py）

| 反例 | 改前 | 改后 |
|---|---|---|
| ① 自检多 `mail`、生成无 | `rc=0`，四行 `BINDING_OK` | `rc=3`，`BINDING_CHANNEL_SET_MISMATCH self_only=[mail] gen_only=[]` |
| ② checks 末项非对象 | `rc=0`，四行 `BINDING_OK`（数组/字符串/null/数字/空 dict 五种全同） | `rc=3`，`BIND_CHECK_FAIL: checks[4] 不是非空对象（list） channel=? side=self`（其余 str/NoneType/int/dict） |
| ③ `{"wecom":"bad","wecom.json":"<64hex>"}` | `rc=0`，四行 `BINDING_OK`（后者覆盖前者） | `rc=3`，`BINDING_KEY_COLLISION raw=wecom vs wecom.json channel=wecom` |
| ④ 渠道名 `"\ud800"` | `rc=1`+traceback：`print(...) UnicodeEncodeError: 'utf-8' codec can't encode character '\ud800'` | `rc=3`，`BINDING_CHANNEL_SET_MISMATCH self_only=[\ud800] gen_only=[]`，无 traceback |

④ 补充：改前「自检侧含 `\ud800`」是 `rc=0` 假绿，「生成侧键含 `\ud800`」才 `rc=1`+traceback；两种改后都 `rc=3`。控制字符
`we\ncom\x00x` → `self_only=[we com\x00x]`、5000 字符渠道名 → 截断加 `...`；改动 1 反向与两侧都有 `mail` 均 `rc=3`；改动 2 另测自检缺 sha / 非 64hex、生成值为空对象 / 缺字段 / 非 64hex / 数字 → 全 `rc=3` 带 `channel=/side=`。

## 2. 正控不回归

```
$ python3 -B tools/bind_check.py --selfcheck fx/self-ok.json --gen fx/gen-ok.json ; echo rc=$?
BINDING_OK wecom 4c578206ae49aa05
BINDING_OK qq c6644c291424f349
BINDING_OK telegram b8a6f77de58e5772
BINDING_OK discord f03902a3e1775fae
rc=0
```
变体同样 `rc=0`：生成侧键无 `.json` 后缀；渠道值为含 `used_bytes_sha256` 的对象（改前 `rc=3 INVALID:dict`）。

## 3. 原有负控不回归（改前/改后均 `rc=3`，文案不变）

| 负控 | 输出 |
|---|---|
| 值不等 | `BINDING_MISMATCH wecom self=…421 gen=…420`（四渠道各一行，改前改后逐字相同） |
| 生成侧缺 qq / 自检侧缺 qq | `…self=c6644c…182 gen=MISSING` / `…self=MISSING gen=c6644c…182` |
| 文件缺失 / 空文件 / 非 JSON | `BIND_CHECK_FAIL: ValueError: --selfcheck 不存在或不是文件 …` / `JSONDecodeError: Expecting value: line 1 column 1` / `…property name enclosed in double quotes` |
| 顶层数组 / null / 缺参 | `ValueError: selfcheck 顶层不是对象或缺 checks 数组` / `BIND_CHECK_FAIL: USAGE the following arguments are required: --selfcheck, --gen` |

## 4. 端到端（真实窗口 external-a-20261127T0800，四个 raw/*.json；产物只在 cache/scratch/pi-r12/e2e/）

```
$ python3 -B tools/bind_check.py --selfcheck e2e/selfcheck.real.json --gen e2e/gen-report.json ; echo rc=$?
BIND_CHECK_FAIL: checks[0] 缺 used_bytes_sha256 channel=wecom side=self
BIND_CHECK_FAIL: checks[1] 缺 used_bytes_sha256 channel=qq side=self
BIND_CHECK_FAIL: checks[2] 缺 used_bytes_sha256 channel=telegram side=self
rc=3
```
身份件现状：`uf003_identity.py` 不写 `used_bytes_sha256`、`checks` 只覆盖 wecom/qq/telegram 且无 discord，即任务书所说「身份件
未装导致的入口耦合，不在本单元」。按真实窗口字节补齐该列后验 bind_check 自身：

```
$ python3 -B tools/bind_check.py --selfcheck e2e/selfcheck.e2e-ok.json --gen e2e/gen-report.json ; echo rc=$?
BINDING_OK wecom 309fe02c3c08af28
BINDING_OK qq feba8dd374cac5ae
BINDING_OK telegram adb138329aed31a1
BINDING_OK discord 22bdce4e46dba74e
rc=0
$ python3 -B tools/bind_check.py --selfcheck e2e/selfcheck.e2e-1bit.json --gen e2e/gen-report.json ; echo rc=$?
BINDING_MISMATCH qq self=feba8dd…c7020 gen=feba8dd…c702c
rc=3
```
四个 sha 与 `shasum -a 256 raw/{wecom,qq,telegram,discord}.json` 及 gen-report 的 `used_bytes_sha256` 逐字相同。

## 5. 改动 4 佐证（退出码只出现 0 / 3，无 traceback）

二进制垃圾 / UTF-16 / BOM / 5000 层嵌套 / 10MB 长串 / 10 万字符 sha / 5000 个代理项 / 路径=目录 → 全 `rc=3`（各自单行归 3）。
输出端：`| head -c 1`（BrokenPipe）正控 `rc=0`、负控 `rc=3`；`2>&-` 正控 `rc=0`；`>&-` → `rc=3` + `BIND_CHECK_FAIL: ValueError: stdout/stderr 不可用（文件描述符已关闭）`。`/dev/full` 本机沙箱 Operation not permitted、`head -0` BSD 不支持，非本工具行为。

## 6. sha256

```
$ shasum -a 256 tools/bind_check.py tools/window_to_rows.py run-m1.sh tools/m1_gate.py uf003_identity.py PIN.json
f414db2c17ec54a444ecdde95aef10bef6969de026f5bbbc57ba13d5c9a89c97  tools/bind_check.py
6462b5ad15ee8315b873aba8433b72e0e67fa0fb9ea0534b74851df5cf208b7e  tools/window_to_rows.py
8e0b90e7ffab29701e42243abdbeb5b7bf2cc7756c15ee68445b033cfb5faefa  run-m1.sh
7eca78e71b5a16b0ff44b341879713806744b3cf9af516f8292f099e0b67647f  tools/m1_gate.py
99a605f9356a0a818876ab5d6520a9e71f94b81e38cb1b3e9e53737ba10df4cb  uf003_identity.py
05a6a4d3792dcc760f397af1b00f3dd588be0aa7b5f6f2343faf4cacb5f30ef9  PIN.json
```
`bind_check.py` 新大小 13557 B、sha `f414db2c…89c97`（改前 5577 B、`bf1262bc…f9fe12`）。四个给定基线全部一致：`window_to_rows.py` ✓ `run-m1.sh` ✓ `m1_gate.py` ✓ `uf003_identity.py` ✓；`PIN.json` 任务书未给基线，只报实测值。
未写 `out/`、`state/`、`tests/`、`contract/`。

## 7. 必须点明的两处

1. **改动 2 的字面与仓库现状不符。** 任务书要求「生成侧每个渠道值必须是非空 dict」，但 `tools/window_to_rows.py:354` 实际
   输出是 `{"<渠道>.json": "<64hex 字符串>"}`（真实跑一次即见）。按字面实现则真实端到端永远 `rc=3`、正控不可能达成。故实现为
   「两种形态都严格校验、其它一律拒」：字符串必须 64 位小写 hex，对象必须非空且含合法 `used_bytes_sha256`。未加开关、未把任何
   异常降级为告警，空对象/缺字段/数字/非 hex 仍 `rc=3`。
2. **第 5 项正控用的是补齐 `used_bytes_sha256` 的自检报告**，属任务书已排除的入口耦合（见第 4 节）；补的值就是四个窗口文件的
   真实字节 sha，未改 `uf003_identity.py`。
