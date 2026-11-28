# 切流首轮约束（业主 2026-11-28 裁定，切流前必读）

状态：约束已定，切流本身仍锁定（须业主签 898abfd3a1a7 + 替换生效件后执行）。

## R1 首轮窗口起点必须 ≥ 上线时刻，不得回溯

- 依据：存量 673 行（`state/uf-003/baseline-20261124T105021.ndjson`）只有 `record_id`/`fields` 两列，**没有 `来源事件标识`**；查重键已按 `DEDUPE_KEY_GLOBAL_SCOPE` 换成 `来源事件标识` → 这批存量永远无法参与查重（`T0_NOT_GATE_BASELINE`）。
- 后果：首轮窗口若与这批存量时段重叠，新产的有 ident 行对不上无 ident 存量 → 重复入库，且查重抓不到。
- 判据：首轮窗口起点 `>=` 上线时刻（只判新事件），不得回溯。
- 若确需回溯 → 记 `STOCK_NO_IDENT_OVERLAP`，先人工核对再入库，**不许直接跑**。
- 为什么不能用补键解决：补键等于写表，撞「真表零写入」铁律；只能靠窗口起点规避。

## R2 首轮后必须核一次数量守恒

- 判据：首轮结束核「新增行数 == 窗口事件数」。
- 不等 → 说明窗口与无 ident 存量有重叠（或事件在窗口边界被重复计入），停轮排查，不得进入第二轮。

## 附：口径定义

- `T0_NOT_GATE_BASELINE`：T0 673 行件是 identity 侧快照（老键格式），**永不作 gate baseline**；gate 的 history 冻结口径 = 125 行键化基线 `baseline_detail_125.ndjson`（sha `b42c6c89b257e2e5`，唯一能过 `M1_BASELINE_UNUSABLE` 的口径）。
- `M1_BASELINE_UNUSABLE` 是 fail-closed 正确行为，不是缺陷。
- 结构关系：798 = 125（键化 history）+ 673（无 ident 存量）；后者不参与查重。
