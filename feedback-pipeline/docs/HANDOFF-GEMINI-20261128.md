# 求助 Gemini carbon：m1 上线链「最小最快可上线范围与方案」

> 交办人：王小成 Bot（转 Gemini carbon）。诉求方：业主（王新铭）。
> 业主原话要点：**太慢了，先停下来**；要 Gemini 给**最小最快可上线的范围与方案**；**严禁扩大范围**；暂停 Codex(terra) 审阅；先快速推进上线。
> 因此请只回答「怎么用最小范围最快上线」，不要提出新架构、不要新增关卡、不要扩字段、不要重构。

## 一、目标（唯一）

把 `~/HermesRuntime/release/m1/` 这套「UF-003 反馈流水线」推到**可上线**状态：判定门 `m1_gate` 已 ALLOW，剩下的 10 关链条要收敛到能实际生效（写表/写 GitHub），而不是继续在复核里打转。

## 二、当前事实（截至 2026-11-28 19:10，均为实跑证据）

### 2.1 进度：PLAN 表 PASS 行数 = 6 / 10

表文件：`~/HermesRuntime/release/m1/PLAN-20261128.md`（进度只认这张表）。

| 关 | 内容 | 状态 |
|---|---|---|
| 1 | 入口/环境自检 | PASS |
| 2 | 契约装载 | PASS |
| 3 | 字节绑定 bind_check | PASS |
| 4 | 关卡 3.5 复修 | PASS |
| 5 | 判定 `m1_gate --new-only` | PASS |
| 6 | 闸门 `m1_gate` R1C ALLOW | PASS（REVIEWED_SHA 已写回） |
| 7 | identity（身份判定器） | **二轮复核 BLOCK**，仅剩 1 条 |
| 8 | window_to_rows 键口径 | **二轮复核 BLOCK**，仅剩 1 条 |
| 9 | 「identity 之后的关」 | **PLAN 里没有定义**，从未开工 |
| 10 | GitHub 提交 | **锁在业主手里**，未开工 |

### 2.2 第 7 关（identity）——已通过的实跑数字

包：`~/HermesRuntime/codex-tasks/uf003-gate7-20261128/pkg/`
- `contract/detail-row.schema.json`：37 properties / 9 required / additionalProperties=true，sha256 `1d81291f…`
- `uf003_identity.py` sha256 `fcb96527…`；`tools/conformance.py` sha256 `6c941b4d…`
- 自检守卫套件 `pkg/tests/u1_selfcheck_guard.py`：52 个 OK、0 FAIL、rc=0
- 契约套件 `pkg/tests/u1_v110_contract.py`：15/15、rc=0
- 守卫七个函数（`_selfcheck_rc`/`_count_conflicts`/`_judge_part`/`_as_int`/`JUDGE_RULES`/`_row_shape_error`/`build_identity`）与上一轮快照逐字节相同
- 四条直接反证仍 rc=3（`family_ok>verified`、`verified>sampled`、未知 rule、直接矛盾）
- T0 基线 `baseline-20261124T105021.ndjson` 673 行：673/673 合规、0 违规
- 九渠道「schema = v1.10 补丁 = conformance.CHANNEL_PATTERNS」三方逐字相等（QQ 解码串 `6094df77…`）

**唯一阻断项 D**：构建器在「事件 ID 只命中契约族、但没有独立核验」的分支上同时执行 `ok += 1` 与 `verified += 1`。实测同一个合成窗口：旧版 `family_ok=1, verified=0 → rc=3`；新版 `family_ok=1, verified=1 → rc=0`，而该样本本身是 `unverified`。复核方判这是「等价替换」，第 7 关任务书明令禁止。
→ 缺的**不是代码，是一句口径定义**：什么算「独立核验通过」（有公开链接/原件可回读才算？还是合族即可？）。业主未定。

复核件：`report.md` 51,028 B（一轮）、`report-2.md` 27,544 B（二轮，唯一 `VERDICT: BLOCK`）。

### 2.3 第 8 关（window_to_rows 键口径）

候选：`codex-tasks/r13d-review-20261128/cand/tools_window_to_rows.r13d.py`，sha256 前缀 `b8e44504e61e5e6d`，46,533 B。
- 六条阻断项**已关闭 5 条**（实跑）：D1 规范化重算逐行一致（`independent_mismatch=0`）、逐行 `placeholder` 布尔存在、占位键 `uf:__ph__:<渠道>:<sha16>`、重复键按字典序 1-based 不去重、带扩展名渠道键被拒
- **未关闭 D2-2（版本语义）**：候选把新增列 `placeholder`、`事件类型` 与新行键语义仍标成 `v1.11`，但真实旧 v1.11 消费者不按版本拒绝——`old conformance --contract v1.11` 吃候选输出得 `row_key_bad=4`、`missing_field=4`、rc=2（静默误消费，不是版本拒绝）；`bind_check.py` 对 `contract_version=v1.10` 负例仍输出 4 条 `BINDING_OK`、rc=0。
- 另一处待裁定：`release/m1/contract/detail-row.v1.12.schema.json:218` 的 `same_row_key_shares_sequence=true`（同键共序号）与任务书 §〇「重复行不去重、按字典序 1..n」直接冲突。v1.11 里没有这个字段。

复核件：`report.md` 19,744 B，唯一 `VERDICT: BLOCK`。

### 2.4 第 9、10 关

- 第 9 关在 PLAN 只有一行「identity 之后的关」，**无定义、无任务书、无候选**。
- 第 10 关 GitHub 提交：**提交锁未放**；按现行纪律不因旧任务提示词自解锁，也不以测试写 Issue 验证权限。

## 三、硬约束（不可动）

1. 不许改 Hermes 核心代码（`~/.hermes/hermes-agent*` 源码树），只能 skill/插件/定时任务/配置/外围脚本。
2. 实现一律派 Pi（GLM 5.4，`~/HermesRuntime/bin/pi-run`），复核一律 Codex gpt-6.1-terra max——**现在复核已按业主指令暂停**，只保留实现与验收。
3. 单 writer；同一产物目录只一个驱动方；写回前 `cp -c` 备份 + before/after sha。
4. 结论格式：复核报告首行唯一 `VERDICT:`，1 行才有效，≥2 行整轮作废。
5. 业主明令：**严禁扩大范围**。你给的方案如果比现状范围大，等于没用。

## 四、要 Gemini 回答的（请直接、具体、可执行）

1. **最小可上线范围**：这 10 关里哪几关是「上线必需」，哪几关可以延后、降级（比如只在新行上生效、旧行不动）、或用开关默认关闭地随包上线？请逐关给「必须/可延后/可删」。
2. **最快路径与用时**：在「第 7 关只剩一条计数口径、第 8 关只剩一条版本语义、第 9 关无定义、第 10 关锁着」的前提下，给出最少步数的上线序列，标注每步的产出物与验收命令，总用时按小时估。
3. **第 7 关 D 项怎么在最小范围内关闭**：是（a）改构建器只按真实核验计数、合族不计 verified（回到 rc=3 语义）；还是（b）给 `verified` 一个可机检的证据定义；还是（c）把该分支默认关闭、只统计不判定？给一条，并说明它会不会连带要改守卫。
4. **第 8 关 D2-2 怎么在最小范围内关闭**：是（a）升 `v1.12` 并让旧消费者按版本明确拒绝；还是（b）退回 `v1.11` 语义、把 `placeholder`/`事件类型` 挪到旁路元数据；还是（c）只在新表上启用、旧表只读？给一条，并说明 `same_row_key_shares_sequence` 冲突怎么处置。
5. **第 9 关怎么处理**：如果它没有定义，能不能直接判「不在上线范围内」并从 10/10 里剔除？若不能，给一句最小定义。
6. **第 10 关**：上线是否必须走 GitHub 提交？如果提交锁由业主控制，能否先「本地生效 + 台账留痕」上线，GitHub 后补？给风险判断。
7. **明确劝退项**：哪些当前在做的动作应该立刻停（例如继续跑第二轮复核、继续补字段、继续对齐九渠道三方 sha）。

## 五、需要你产出的格式

`report-gemini-scope.md`：
- 一、一句话结论（最小范围是什么）
- 二、上线必需/可延后/可删（逐关表）
- 三、最小步骤序列（步骤 / 产出物 / 验收命令 / 用时）
- 四、第 7、8 关二选一的裁决建议（各一条，直接）
- 五、第 9、10 关处理
- 六、立刻停做的动作清单
- 七、风险与上线前必验 3 条

## 六、现场路径

- 计划与进度：`~/HermesRuntime/release/m1/PLAN-20261128.md`
- 第 7 关：`~/HermesRuntime/codex-tasks/uf003-gate7-20261128/`（`pkg/`、`report.md`、`report-2.md`、`BRIEF-7U7.md`、`BRIEF-REVIEW-G7b.md`）
- 第 8 关：`~/HermesRuntime/codex-tasks/r13d-review-20261128/`（`BRIEF.md`、`report.md`、`cand/`、`base/`、`refs/`）
- 闸门：`~/HermesRuntime/codex-tasks/r2f3a1d-gate-20261128/review/report-v4.md`（ALLOW）
- 基线：`~/HermesRuntime/release/m1/state/uf-003/baseline-20261124T105021.ndjson`（673 行）
