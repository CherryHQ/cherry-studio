# M1 BRIEF — 被审对象 pin（人类 2026-11-27 裁决 ①）

本文件与 PIN.json 成对：PIN.json 机器读（tools/gate_preflight_m1.py --root . --pin PIN.json），本文件人读。
任何一次重跑之前先跑 preflight；MEASURED_SHA 与 pin 不逐字相同 → VERDICT: SNAPSHOT_MISMATCH，rc=3，**重跑不算数**。
不 pin sha 的「已刷新」只是声明。

## pin（本机 shasum -a 256 实测，2026-11-27 17:3x）

| 侧 | 路径 | sha256 | 字节 |
|---|---|---|---|
| 生成侧 | uf003_identity.py | 99a605f9356a0a818876ab5d6520a9e71f94b81e38cb1b3e9e53737ba10df4cb | 87,349 |
| 判定侧 | tools/conformance.py | 31c866aa9e8a53e78ff333bab8a1955d48f8fa6d7bb9e48c5f512a6d734908be | 37,785 |
| 判定侧 | tools/id_patterns.py | d2a97cae138c4e6ab2acd9d455c7e4dd081aa104127719a8b5a7efe742ac6a0c | 8,710 |
| 判定侧 | tools/enum_source.py | 374db8d987112ed58abf5016488e0d633163a712a4b0f69178da61071e72c3eb | 16,670 |
| 契约 | v1.11 detail-row.v1.11.schema.json | d9b9ad9f2c750a28aa52108d1c43a44a7393cf7194c12712f0bbc3ce0f06121f | 4,054 |

四条与业主给的数字逐字一致（99a605f9 / 31c866aa / d2a97cae / 374db8d9）。

## 版本来源（裁决 ②，已落在 preflight）

- 只认两处：主件 `x-contract-version`（version_source=header）或 argv `--contract`（version_source=argv）。
- 两者都无 → rc=3 `CONTRACT_VERSION_UNRESOLVED`。
- `UF003_CONTRACT_VERSION` 只是白名单选择器：与声明不一致 → rc=3 `CONTRACT_VERSION_MISMATCH`，点 env / header / argv 三个值。
- QQ 段字节等同不作版本来源，只记 `qq_segment_sha` 供事后比对。
- 因此 version_source 只会是 header 或 argv，**不会**出现 env / qq_segment，报告里不会出现 PASS-WITH-VERSION-INFERENCE（③ 由构造满足）。

## 实测控制（2026-11-27，本机）

| 用例 | 结果 |
|---|---|
| A 正控 `--root . --contract v1.10` | rc=0，四 pin OK，`contract_version: v1.10 (version_source=argv)`，`VERDICT: SNAPSHOT_OK` |
| B argv v1.11（本树无该件） | rc=3 `CONTRACT_VERSION_UNRESOLVED  argv=v1.11 但本树无 detail-row.v1.11.schema.json` |
| C 无 argv 无 header | rc=3 `CONTRACT_VERSION_UNRESOLVED  主件无 x-contract-version 且未给 --contract` |
| D 副本 conformance.py 追加 1 字节 | rc=3 `SNAPSHOT_MISMATCH`，pointwise 打出 pin=31c866aa… got=96d8ed84… |
| E env=v1.9 vs argv v1.10 | rc=3 `CONTRACT_VERSION_MISMATCH  env=v1.9 header=(none) argv=v1.10` |
| F 位置参数 | rc=3 `USAGE_FAIL: 不接受位置参数，收到 ["x.ndjson"]` |
| G cv 树 + v1.11 打同一 pin | rc=3 `SNAPSHOT_MISMATCH`：conformance 实为 1c94bd02、id_patterns 实为 eacd1d2a、enum_source MISSING |

## 结构性发现（挂载前置，未解决）

1. `release/m1/contract/` 只有 v1.9（475b8f0b，4,146 B）、v1.10（5daf972e，3,897 B）、主件 detail-row.schema.json（=v1.9）、channel-map*；**没有 v1.11**。
2. `x-contract-version` 只有 v1.11 声明；v1.9 / v1.10 / 主件三份 schema 都没有该键（实测 json 读取，None）。
3. 结论：pin 住的判定侧 31c866aa 只能靠 argv 定版本，且只认 v1.9 / v1.10 契约；要吃 v1.11 必须换成 cv 树的 conformance 1c94bd02（且 cv 树没有 enum_source.py）。
4. 即「生成侧 99a605f9 + 判定侧 31c866aa + 契约 v1.11」三者不能同树成立 → 当前 pin 下五关无法全绿，挂载条件结构性不满足。
