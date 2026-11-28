#!/bin/bash
# M1 上线闸门串联：契约前置校验 → 身份 → 行源 → 只判新行
# 用法:
#   ./run-m1.sh --run <采集窗口目录> --baseline <T0全表导出.ndjson>   # 真实窗口：契约前置校验 + 身份自检 + 行源 + 字节绑定 + 闸门
#   ./run-m1.sh --fixture-demo --baseline <T0全表导出.ndjson>          # 冒烟：契约前置校验 + 生成 demo 行 + 闸门（demo 行无 record_id，闸门关必红，只能验到第 2 关）
#   ./run-m1.sh --rows <今日生成.ndjson> --baseline <T0导出.ndjson>    # 正式：契约前置校验 + 闸门（只判新行）
# --run 行源优先级: <dir>/rows.ndjson → tools/window_to_rows.py 生成 → 都没有则 RUN_M1_NO_ROWS_SOURCE（RC=3，不编造行）
# 退出码: 0 全绿 / 3 任一关失败（内部 python 的 1/2 与任何异常一律归 3，不透出）
# 产物纪律: 只落 out/<YYYYMMDD>/（selfcheck.json / gen-report.json / rows.ndjson / gate.json）；不写 state/、不写 contract/、不调飞书
# 每关一行 STAGE=<序号> <名称> RC=<0|3>，最后一行 RUN_M1_RUN_RESULT RC=<0|3> out=<目录>
set -u
cd "$(dirname "$0")" || exit 3

OUTDIR="out/UNKNOWN"
STAGE_N=0

# 统一收尾：无论从哪条路径退出（含 set -u 未绑定变量等异常），退出码只有 0/3，且最后一行固定为结果行
on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] || rc=3
  echo "RUN_M1_RUN_RESULT RC=$rc out=$OUTDIR"
  exit "$rc"
}
trap on_exit EXIT
TODAY="$(date +%Y%m%d)" || TODAY=""
[ -n "$TODAY" ] || { echo "RUN_M1_BLOCK: date +%Y%m%d 失败，无法确定产物目录"; exit 3; }
OUTDIR="out/$TODAY"
pass() { STAGE_N=$((STAGE_N+1)); echo "STAGE=$STAGE_N $1 RC=0"; }
fail() { STAGE_N=$((STAGE_N+1)); echo "STAGE=$STAGE_N $1 RC=3"; exit 3; }

MODE=""; RUN=""; ROWS=""; BASE=""; CONTRACT="v1.11"
pick_mode() {  # 一次只允许一种模式，后给的覆盖先给的会造成静默误判
  [ -z "$MODE" ] || { echo "RUN_M1_USAGE_FAIL: 只能选一种模式（--run / --fixture-demo / --rows）"; exit 3; }
  MODE="$1"
}
while [ $# -gt 0 ]; do
  case "$1" in
    --run|--rows|--baseline|--contract)
      [ $# -ge 2 ] || { echo "RUN_M1_USAGE_FAIL: $1 缺参数值"; exit 3; } ;;
    --fixture-demo) ;;
    *) echo "RUN_M1_USAGE_FAIL: 未知参数 $1"; exit 3 ;;
  esac
  case "$1" in
    --run)          pick_mode run;  RUN="$2";  shift 2 ;;
    --fixture-demo) pick_mode demo; shift ;;
    --rows)         pick_mode rows; ROWS="$2"; shift 2 ;;
    --baseline)     BASE="$2"; shift 2 ;;
    --contract)     CONTRACT="$2"; shift 2 ;;
  esac
done
[ -n "$BASE" ] || { echo "RUN_M1_USAGE_FAIL: 必须显式给 --baseline（存量冻结基线）"; exit 3; }
[ -n "$MODE" ] || { echo "RUN_M1_USAGE_FAIL: 需要 --run <dir> / --fixture-demo / --rows <file>"; exit 3; }
# --run 目录不存在：在任何关卡之前拦下（不跑自检、不建 out/<日期>/）
if [ "$MODE" = run ]; then
  [ -d "$RUN" ] || { echo "RUN_M1_BLOCK: --run 目录不存在 $RUN"; exit 3; }
fi

# 关卡1 契约版本前置校验（三种模式同一参数；只读，失败时不建产物目录）
PF="$(python3 -B tools/contract_preflight.py --contract-dir contract --expect "$CONTRACT")"; PF_RC=$?
echo "$PF"
VER="$(printf '%s\n' "$PF" | awk '/^CONTRACT_OK/ {print $2}')"
[ "$PF_RC" -eq 0 ] && [ -n "$VER" ] || fail "契约前置校验"
pass "契约前置校验"
mkdir -p "$OUTDIR" || { echo "RUN_M1_BLOCK: 无法建产物目录 $OUTDIR"; exit 3; }

# 采集/生成侧（uf003_identity.py、tools/window_to_rows.py）的契约来源必须显式给：
# 默认探测的 handoff-v1.9 目录本机不存在（实测 LOAD_FAIL 找不到契约目录）；
# cache/contract-view 提供裸主件 detail-row.schema.json（软链 → contract/detail-row.<V>.schema.json）。
# 闸门链路（contract_preflight / m1_gate / conformance）不读这两个变量，只认 argv，故此处 export 不影响判定。
export UF003_CONTRACT_DIR="$PWD/cache/contract-view" UF003_CONTRACT_VERSION="$CONTRACT"

case "$MODE" in
  run)
    # 关卡2 身份自检：报告落 out/<日期>/selfcheck.json；rc 0 放行，2（有 id 不合族）/3（结论不可信）/其它一律 3
    python3 -B uf003_identity.py --run "$RUN" --selfcheck >"$OUTDIR/selfcheck.json" 2>"$OUTDIR/selfcheck.err"; RC=$?
    if [ "$RC" -ne 0 ]; then
      echo "SELF_CHECK_FAIL python_rc=${RC}（已归 3）"
      [ -s "$OUTDIR/selfcheck.err" ] && head -c 600 "$OUTDIR/selfcheck.err"
      grep -m1 '"rc_reason"' "$OUTDIR/selfcheck.json"
      fail "身份自检"
    fi
    [ -s "$OUTDIR/selfcheck.err" ] || rm -f "$OUTDIR/selfcheck.err"
    pass "身份自检"
    ;;
  demo)
    # 关卡2 生成 demo 行（产物只落 out/<日期>/，不再写 state/）
    ROWS="$OUTDIR/rows.ndjson"
    python3 -B uf003_identity.py --fixture-demo "$ROWS" || fail "生成(demo)"
    [ -s "$ROWS" ] || fail "生成(demo)"
    pass "生成(demo)"
    ;;
esac

ROWS_SOURCE=""   # 行源：window_to_rows / run-dir（关卡3.5 据此决定核不核字节绑定）
case "$MODE" in
  run)
    # 关卡3 行源：<dir>/rows.ndjson 优先；否则 tools/window_to_rows.py（存在才用）；两者都没有 fail-closed
    if [ -f "$RUN/rows.ndjson" ]; then
      ROWS="$RUN/rows.ndjson"
      ROWS_SOURCE="run-dir"
      echo "ROWS_SOURCE=run-dir $ROWS"
    elif [ -f tools/window_to_rows.py ]; then
      ROWS="$OUTDIR/rows.ndjson"
      ROWS_SOURCE="window_to_rows"
      # stdout（汇总 JSON）用 tee 同时落 $OUTDIR/gen-report.json，给关卡3.5 比对 used_bytes_sha256（控制台照旧可见）。
      # 子 shell 里开 pipefail：否则管线 rc 只看 tee，生成进程 rc≠0 会被吞掉、fail "行源" 不触发
      ( set -o pipefail; python3 -B tools/window_to_rows.py --run "$RUN" --out "$ROWS" | tee "$OUTDIR/gen-report.json" ) || fail "行源"
      [ -s "$ROWS" ] || fail "行源"
      echo "ROWS_SOURCE=window_to_rows $ROWS"
    else
      echo "RUN_M1_NO_ROWS_SOURCE: $RUN/rows.ndjson 不存在且 tools/window_to_rows.py 不存在，拒绝（不编造行）"
      fail "行源"
    fi
    ;;
esac
[ -s "$ROWS" ] || { echo "RUN_M1_BLOCK: 行文件不存在或为空 $ROWS"; fail "行源"; }
pass "行源"

# 关卡3.5 字节绑定：自检读的窗口字节（selfcheck.json 各渠道 used_bytes_sha256）必须等于行生成用的字节
# （gen-report.json 的 used_bytes_sha256）；此前两步各报各的 sha，没有任何一步比较。只核行源来自 window_to_rows
# 的情形；行源是 $RUN/rows.ndjson 时没有窗口字节参与，显式报 NA，不假装已验证。--fixture-demo / --rows 不经此关。
if [ "$MODE" = run ]; then
  if [ "$ROWS_SOURCE" = window_to_rows ]; then
    python3 -B tools/bind_check.py --selfcheck "$OUTDIR/selfcheck.json" --gen "$OUTDIR/gen-report.json" || fail "字节绑定"
    pass "字节绑定"
  elif [ "$ROWS_SOURCE" = run-dir ]; then
    echo "BINDING_NA rows_source=run-dir"
    pass "字节绑定"
  fi
fi

# 关卡4 判定：只判新行，存量按基线冻结；必须显式 --baseline；报告落 out/<日期>/gate.json
# 新接口：new-only 且存在新行时必须显式给一个「已存在且可写」的 --scratch 目录，闸门不创建、不回落
[ -d "$OUTDIR" ] && [ -w "$OUTDIR" ] || fail "判定"
python3 -B tools/m1_gate.py --rows "$ROWS" --baseline "$BASE" --contract "$VER" --new-only --scratch "$OUTDIR" --json "$OUTDIR/gate.json" || fail "判定"
pass "判定"
exit 0
