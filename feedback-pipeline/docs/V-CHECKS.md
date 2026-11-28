# V-CHECKS —— 上线前必须量出的基线（可勾选）

每条都要求「实测数字 + 产物路径」。没数字 = 未完成；数字对不上 = 停，先查实现再谈阈值。

## V-1 存量重复基线（复合主键）

规则见 `spec/dedup-rule.md`；脚本口径 `state/ref-census/composite-key-baseline.json`。

语料 `reports/uf003-u2.1-real743-handoff/real743x34.ndjson`（743 行，70 行有非空事件标识）：

- [x] `unique_keys = 70`（事件标识 + 工作项键 + 内容指纹）
- [x] `duplicate_pairs = 0`（同键同内容）
- [x] `多明细组 = 4`（同键不同内容，合法多明细，放行）
- [x] 复合组 `(事件标识, 工作项键) = 66`；差值 4 = 那 4 组多明细
- [x] 673 行空事件标识：复合主键无效，须 `EVENT_ID_MISSING` fail-closed

上线后若 `DUPLICATE` > 0 或 `多明细组` ≠ 4，先怀疑查重实现/上游锚点，不得归因“新数据重复”。

## V-2 行内同 ref 分布（存量 743）

- [x] 同一份表文件内同 ref 两行 = 15 组
- [x] 其中工作项键不同 = 11 组（跨轮：`1400:x` / `2200:x`），按复合主键天然放行
- [x] 其中工作项键相同 = 4 组（明细行键不同），按内容指纹判为多明细
- [x] 明细：`state/ref-census/intra-table-dup.json`

## V-3 ref 唯一性（历史结论已更正）

- [x] 早期口径 `C=0` **作废**（假阴性：同 ndjson 只按 ref 取首行工作项键）
- [x] 更正记录：`state/ref-census/CENSUS-REPORT.md` §3.5.1
- [x] 结论：v1.12 不能只扩格式分支，写前查重必须用复合主键

## V-4 真表零写入（每轮必核）

- [x] rows = 743
- [x] `RECORDS_SHA = 6d8204e0ce88decb`
- [x] patrol `ok=true`（2026-11-27 复核）

## V-5 禁止项扫描的正控／负控（验收第 8 条的证据）

- [x] 工具 `tests/grep_round_controls.py`，主输出 `tests/grep-round-controls.txt`，退出码 0
- [x] 正控：植入 4 种违规写法（中文 3 + ASCII 1）→ 命中 5 处，覆盖 5 个模式；`中文行命中=True`、`ASCII 行命中=True`
- [x] 负控 A（日常判定）：排除 `cache/out/scratch` 与扫描器自身 → `files_scanned=28`、`hits=0`
- [x] 负控 B（完整留存）：不排除任何文件 → `files_scanned=29`、`hits=24`，全部来自扫描器自身，逐条落盘 `tests/grep-round-controls-full.txt`
- [x] 规则成文：`spec/scan-rules.md` R-1…R-4（不用 BSD grep 扫多字节；正控必须中文行+ASCII 行；排除即盲区须给 A/B 且 B hits 只能当证据不能当指标；0 命中须带扫描规模）
- [x] 扫描下限来自 `tests/scan-scope-pin.json`（`files_scanned=28`），偏差 >10% → `rc=3 SCAN_SCOPE_DRIFT`；PIN 缺失 → `rc=3 SCAN_SCOPE_UNDECLARED`
- [x] 故障注入实测：把 PIN 改成 40 → 偏差 30.0%、`rc=3 SCAN_SCOPE_DRIFT`（点名 40/28）；恢复 28 → 偏差 0.0%、exit 0
- [x] 已删首版 `tests/grep_round_controls.sh`：自命中 + BSD grep 多字节漏报，两个缺陷都不可留

## 待办（未完成，不得勾）

- [ ] 生成侧显式轮次字段（未提供时 `round_relation=unknown`，不得参与任何 rc 判定；**禁止**从工作项键解析轮次）
- [ ] 写前查重实现（`DUPLICATE` / `MULTI_DETAIL` / `round_relation` 三元 / `REF_CONFLICT`(仅显式轮次相同) / `EVENT_ID_MISSING`）
- [ ] U1（`--expect-new-rows` + `overlap < n_base`）改完重送门禁
- [ ] U1b 门禁结论（进行中）

## V-6 U1 / U1b 启用顺序（2026-11-27 定，来自门禁实测反例）

- **必须同轮生效，或 U1b 先上**；禁止「先 U1 后 U1b」——中间段判定器已产出 `INPUT_INCOMPLETE`，而挂载层只认 `READ_FAIL`，会出现 rc=3 但 `rc_reason` 空。
- **6 条候选 + real743 基线 → rc=2 / violations_total=743 不是通过证据**：那是 U1（overlap < n_base → INPUT_INCOMPLETE）未生效期间，挂载层把「批次不完整」报成「数据脏」的已知误报。E2E 必须用 743+N（本轮 749 行）输入。
- 该反例的正向价值：它实证了 U1 的必要性；不得把它读成 U1b 行为正确，也不得读成 U1b 失败。

## V-7 证据文件写入必须原子（2026-11-27 实测，**本条为唯一来源**）

> 唯一来源声明：skill / 其它文档只写「见 V-CHECKS V-7」，不复制条文。改口径只改这里。

禁止 `open(dst,'w').write(open(dst).read())` 及任何「先开写、再从同一路径读」的管道式一行流：
`'w'` 在对端求值前就截断，文件变空且不报错，`grep` 只表现为「少了一行」，会被当成「本来就没有」。
必须 temp + `os.replace` 原子替换，或先读进变量再写；`BASE_SHA`、清单、台账、报告等证据文件一律适用。
实测事故：重建 `candidates/U1b-A/BASE_SHA` 时用该写法把文件清空，导致核对时只看到 B、C 两行。

## V-8 启用必须有启用记录：COMBINED_SHA + 启用前后真表快照（2026-11-27 定，**本条为唯一来源**）

> 唯一来源声明：其它文档只写「见 V-CHECKS V-8」，不复制条文。

- 任何「首次写表 / 启用 live 路径 / 切换判定器口径」之前，必须同时具备：
  1) **四条门禁结论齐**（U1b-A、U1b-B、U1b-C、U1），且各自首行 VERDICT 为 ALLOW；
  2) **COMBINED_SHA**：对四件（`tools/conformance.py`、`tools/mount_dryrun.py`、`PIN.json`、渠道白名单契约）按固定顺序取 sha 后再取合并 sha；
  3) **启用前后各一次真表快照**（全字段、分页取尽、`has_more=false`）：`delta_rows=0`、`schema_sha` 前后一致；
  4) 记录由脚本 `tools/enable_record.py` 生成（人不手抄数字），落 `records/ENABLE-<stamp>.md`。
- 缺任一项 → 不算启用完成，不得声称「已上线」或「线上未动」。脚本 VERDICT 非 OK 即禁止启用。
- 反例依据：31,577 被手抄成 31,648、`open(dst,'w').write(open(dst).read())` 把 BASE_SHA 清空——两次都属手抄/手写造成的证据失真。
