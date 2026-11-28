SCOPE: full — 改 1/2/3 全部交付；只新增 3 个文件（本文件、tools/window_to_rows.py、tests/test_window_to_rows.py），既有件零改动（PIN 逐件核对见 §5.10）。
# NOTE — tools/window_to_rows.py（真实窗口 → 明细行 ndjson），2026-11-27

## 1. 实测（run=external-a-20261127T0800；生成侧 uf003_identity 99a605f9=PIN，id_patterns eacd1d2a=PIN，契约 v1.11 d9b9ad9f=PIN）
- rc=0，rows=479（wecom 9 / qq 194 / telegram 275 / discord 1），missing=[]；by_channel 与 raw 文件条数逐一相等。
- 身份：blocked_rows=0。真实 id 478：wecom 9 条 `wc:<conv>:<seq>`、qq 194 条 `qq:<group_openid>:ROBOT1.0_…`、telegram 275 条 `tg:<chat_id>:<message_id>`；占位 1 条（discord，`unknown:user-feedback-20261127#0800:479`）。record_id 唯一 479/479。
- 证据 479 行全为 `无公开链接`（build_identity 真实结果，身份档 unverified）。说明/身份档 不是 34 字段快照的字段，未落进行里。
- 测试：`python3 -B tests/test_window_to_rows.py` → TESTS 39/39（连跑 3 次）；输出落 /var/folders/…（out/ 之外）。
- 送闸门实测（m1_gate 45bddd01 / conformance 1c94bd02 / v1.11 / 基线 real743x34，--new-only）：rc=3；hard={workitem_key_empty:479, seq_type_bad:479}；advisory missing_field=2395（工作项键/事件序号/事件类型/明细行键/身份档 各 479）；record_id_missing/dup、missing_identity_field、event_id_family、channel_bad、batch_key_bad、type_error 全 0；顶层 unknown_event_id=1。
- 复跑：`UF003_CONTRACT_DIR=$PWD/cache/contract-view UF003_CONTRACT_VERSION=v1.11 python3 -B tools/window_to_rows.py --run <run目录> --out <out/ 之外的路径>`（run-m1.sh --run 的第 3 关即此调用）。

## 2. underived（汇总里的逐字段空串计数；测试已与文件空串格逐字段核对一致）
- 28 个字段 ×479（窗口记录推不出）：工作项键 日期 profile 工作项 类型 输入 输出 状态 tokens 调用数 工具摘要 委派次数（含 Codex） 飞书次数 GitHub次数 置信度 需人判断 待决事项 失败原因 置信度分 置信度理由 查重次数 重复命中数 明细行键 事件序号 PM 工作项 身份状态 身份原因 身份对账。
- 对象 ×275：只有 telegram 窗口记录没有会话标题（`username` 是作者用户名，不是会话名）；wecom 9 / qq 194 / discord 1 由 conv_name / group_name / channel_name 得出，与真表 对象 列取值逐字同源（如「Cherry Studio 官方沟通群 113」）。
- 每行都得出：日报键（user-feedback-20261127，取 run 目录名）、来源渠道、来源事件标识、证据、原始消息ID（wecom.RID / qq.id / telegram.message_id / discord.id）。真表存量 wecom 行的 原始消息ID 就是 Info.db 的 RID（只读查询核对：1055459 的 seq=5919000）。

## 3. blocked_rows=0 的原因，以及何时会 blocked
- 身份三字段（record_id / 来源渠道 / 来源事件标识）479 行全非空。blocked 只在 build_identity 对该行抛错或产出空串时出现；典型：run 目录名不带 -YYYYMMDDTHHMM → 无批次键 → 取不到真实 id 的行连占位都造不出（合成目录实测：rc=3、行文件照写、ok=false、blocked_rows=1）。
- 占位（`unknown:`）非空，按任务字面不计 blocked，单列 placeholder_rows=1，并在 stderr 逐条 WARN（含 build_identity 写的失败原因）。

## 4. 口径与假设（显式、可见；业主可推翻，各是一处可改的常量）
- record_id：真表里是飞书写入时分配的 rec…，写前不存在，不编造 → 取 build_identity 的 来源事件标识 作写前临时行标识，写入后须换成 Base 记录 ID。spec/dedup-rule.md 明言「事件标识标识事件、不标识行」，同一事件落多行时此临时 id 会撞（本窗口 0 撞）。
- 轮次：取 run 目录名的 HHMM（0800），与契约「4 位轮次」及真表工作项键前缀 0800/1400/2200 同形；目录名无时间戳 → None。已知限制：T0000 → 轮次 0 过不了 unknown_id 的下限 1，该窗口的降级行会 blocked。
- 键名适配：只做一处 RID→rid（值不动、原记录不改）。PIN 版生成侧的 _wecom_lookup 只认 rid/mid/rowid，不认窗口的大写 RID；不适配则 wecom 9 条全降级占位。
- 事件序号 写 ""（按任务要求）：conformance 要求整数，空串被判 seq_type_bad 硬红；省略该键才只是 missing_field 告警。未擅自偏离任务要求，留业主裁决。
- 契约目录：uf003_identity.load_contract() 只认「裸主件 detail-row.schema.json + channel-map.json」布局。测试从真源字节拷贝出临时目录并设 UF003_CONTRACT_VERSION=v1.11——这是给「契约目录只带主件」部署用的路径（BRIEF.md 要求在此说明）。cache/contract-view（run-m1.sh 导出的那套）实测同样可加载（declared_version=v1.11 / qq_hash_tag=v1.11）；直接指向运行时 contract/ → CONTRACT_LOAD_FAIL rc=3、不落文件。

## 5. 被证伪的旧断言（本轮实测推翻）
1. 「build_identity 返回 record_id」— 否：只返回 来源渠道/来源事件标识/证据/说明/身份档。
2. 「UF003_CONTRACT_DIR=$PWD/contract 可直接给生成侧用」（RUN.md）— 否：运行时 contract/ 无主件，load_contract 抛 FileNotFoundError。
3. 「wecom 无 seq 就拿不到真实 id」与「生成侧直接认窗口的 RID」— 都不成立：不适配 → 9 条占位；适配后 9/9 真实 wc: id。
4. 「生成侧在任务期间稳定」— 否：20:09 磁盘上是 87,419 字节版（_wecom_lookup 含 ("RID","RID")），随后被还原为 PIN 版 99a605f9；同一窗口先后量出 478 → 469（还原后、未适配）→ 478（适配后）。测试因此加了「生成侧 sha == PIN.json」守护。
5. 「行源产出的行能直接过闸门」（并行新增的 tests/test_run_mode.py 期望 STAGE=4 RC=0）— 否：工作项键不可推导，workitem_key_empty 硬红 479；与「不可推导字段写 ""」这条规则在闸门上不相容。
6. 「m1_gate 对占位判 unknown_event_id 硬红」（其 docstring）— 与代码不符：它是 conformance 顶层计数器，不进 rule_counts，当前 hard 不含它。
7. 「不可推导字段写 "" 至多是 missing_field 告警」— 否：事件序号 "" → seq_type_bad 硬红 479。
8. 「四个渠道都能拿到真实 id」— 否：Discord 窗口记录无 guild_id/guild，1 条占位。
9. 「对象 对各渠道都可推导」— 否：telegram 275 行无会话标题。
10. 「m1_gate.py 与 PIN 一致」— 否：磁盘 45bddd01 ≠ PIN d0d49c22（20:23 被并行改动，新增 --new-only；红线/告警分类未变）。非本任务改动，仅记录；其余 PIN 项中 candidates/U1b-B/tools/mount_dryrun.py、tests/test_u1b_b.py 也不符，同样非本任务。
