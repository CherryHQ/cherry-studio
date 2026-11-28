# U2.3 r10 任务书（三条，不许扩项）

只改 `uf003_identity.py`、`tools/id_patterns.py`、`tests/u2_3_boundary.py`、`NOTE-r10.md`。改完自己跑，实测数字写进 NOTE-r10.md，不许只写结论。

## 现状（我刚在 u2.3-r9 上实测，供你复现，不许当结论抄）

契约目录里有三份 schema：不带版本号的 `detail-row.schema.json`（生成侧实际读的那份）+ `detail-row.v1.9.schema.json` + `detail-row.v1.10.schema.json`。生成侧用「主件与哪个带版本兄弟件逐字相同」来定「所在版本」（`_sibling_schema_versions`），`load_contract()` 里 :236 先赋值、:237 立刻用 `require_shipped_qq()` 的返回值覆盖。

实测构型：把主件 `detail-row.schema.json` 的 QQ 段换成 v1.10 的冻结原文（其它字段不动），删掉 `detail-row.v1.10.schema.json`：
- `UF003_CONTRACT_DIR=<该目录> python3 -B uf003_identity.py --fixture-demo <out>` → **rc=0、写出 10 行**
- `load_contract()["contract_version"]` = `'v1.10'`，`contract_version` 是哈希标签回填的，不是兄弟件比出来的
- 同一份主件在判定侧（`tools/conformance.py --contract v1.9`）读的是 `detail-row.v1.9.schema.json`，不受影响

根因：主件一旦被改动就与所有兄弟件都不逐字相同 → `siblings=[]` → version=None → `require_shipped_qq` 退回「只核哈希」→ 放行。也就是说 r9 C 要抓的那个场景（两版 QQ 段整段互换）在生成侧仍然 rc=0，只有判定侧因为 `--contract` 显式给了版本才拦住。

## 改三条

1. 版本不可判定必须 fail-closed：`siblings` 为空（0 个或多于 1 个）时不许 `version=None` 静默只核哈希，一律 `rc=3`、单行、点名 `CONTRACT_VERSION_UNRESOLVED`，写出兄弟件列表与实际哈希；生成侧不得写输出文件。允许的例外只有一种：显式给 `UF003_CONTRACT_VERSION=v1.9|v1.10` 且与哈希标签一致，且此路径必须在 NOTE 里说明是给「契约目录只带主件」的部署用的。
2. `contract_version` 不许被哈希标签覆盖：`:236` 记录的兄弟件版本与 `:237` 的哈希标签要分开存（比如 `sibling_version` / `qq_hash_tag`），下游 `_gate_reason` / `assert_assembled` 核的是「两者都存在且相等」。制造 `sibling_version=v1.9` + QQ 段换成 v1.10 原文 的内存契约，必须抛 `QQSegmentDrift` 而不是靠标签自比自。
3. 回归要自己造数据并跑红：新增用例必须覆盖上面三种构型——① 主件被改+兄弟件缺失 → rc=3 单行不落文件；② 主件被改+兄弟件齐 → 按内容判成 v1.10（这是合法的，要 rc=0）；③ 只带主件且无 `UF003_CONTRACT_VERSION` → rc=3。以及 r9 现有的 `tests/u2_3_boundary.py after` 9/9、`tests/u1_samples.py` 103/103 不许退。

## 红线

不许改 `tests/EXPECT-COUNTS.json` 里的既有期望来凑绿；不许把 `rc=3` 降成 rc=1 或 warn；不许为了让 ② 变绿而在「主件被改」时猜版本；`before` 标签已经删了，别再动它。完成后在 NOTE-r10.md 里给：每条构型的命令、rc、行数、关键输出原文。
