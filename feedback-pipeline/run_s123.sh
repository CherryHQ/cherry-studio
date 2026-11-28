#!/usr/bin/env bash
# run_s123.sh —— S1–S3 必跑套件（业主裁定 Ⅰ 的对应物；封 MISSING_SUITE_FREEZE）
#
# 一条命令跑完 S1A/S1B/S1C/S2/S3。任一阶段 FAIL 或 SKIP_MISSING → 末行 RESULT: FAILED=<n>、exit 1；
# 全绿 → 末行 RESULT: ALL_PASS、exit 0。参数错/环境缺 → exit 2（不计入阶段）。
# 只读：除本脚本日志（~/HermesRuntime/logs/m1/run_s123-<ts>.log）外不写、不改任何文件；脚本内无任何删除操作。
# 幂等：连跑结果一致，不产生累积残留（日志按时间戳另存，不覆盖）。
# 用法：bash run_s123.sh [--list] [--only S1|S2|S3]      环境变量覆盖：M1DIR S1DIR LOGDIR PY S2_SCRIPT S3_SCRIPT
set -u

# ===== 路径置顶（按现状写死，集中在此便于替换）=====
M1DIR="${M1DIR:-$HOME/HermesRuntime/release/m1}"
S1DIR="${S1DIR:-$HOME/HermesRuntime/codex-tasks/uf003-gate7-20261128/_run}"
LOGDIR="${LOGDIR:-$HOME/HermesRuntime/logs/m1}"
PY="${PY:-python3}"
S1_UNIT="$S1DIR/s1_unit.py"
S1_GATE="$M1DIR/tools/m1_gate.py"
# S2/S3 套件脚本默认路径（S3 由并行单落地）：脚本缺失 → SKIP_MISSING S2_PENDING/S3_PENDING，计入 FAILED（不许当通过，不许伪造命令）。
# 判定：rc=0 且末行 S2_SUMMARY ok=1 / S3_SUMMARY ok=1，否则 FAIL。
S2_SCRIPT="${S2_SCRIPT:-$M1DIR/tools/s2_suite.py}"   # 生成器 v1.13 出件 + 身份自检 + bind_check 4×BINDING_OK + 五版本变异负控
S3_SCRIPT="${S3_SCRIPT:-$M1DIR/tools/s3_suite.py}"   # verify_pack → vp_g8.json + SHA256SUMS（六项全绿）

STAGES=(S1A S1B S1C S2 S3)
usage() { echo "usage: bash run_s123.sh [--list] [--only S1|S2|S3]"; echo "env: M1DIR S1DIR LOGDIR PY S2_SCRIPT S3_SCRIPT"; }

# ===== 参数 =====
MODE=run; ONLY=all; bad=0
case "${1:-}" in
  "")        [ "$#" -eq 0 ] || bad=1 ;;
  --list)    MODE=list; [ "$#" -eq 1 ] || bad=1 ;;
  --only)    ONLY="${2:-}"; case "$ONLY" in S1|S2|S3) ;; *) bad=1 ;; esac; [ "$#" -eq 2 ] || bad=1 ;;
  -h|--help) usage; exit 0 ;;
  *)         bad=1 ;;
esac
[ "$bad" -eq 0 ] || { usage >&2; exit 2; }
command -v "$PY" >/dev/null 2>&1 || { echo "FATAL PY_NOT_FOUND $PY" >&2; exit 2; }
mkdir -p "$LOGDIR" 2>/dev/null || { echo "FATAL LOGDIR_UNWRITABLE $LOGDIR" >&2; exit 2; }

# ===== 日志：同一内容同时写文件 + stdout（逐行 tee，退出前必然落盘）=====
TS="$(date +%Y%m%dT%H%M%S)"; LOG="$LOGDIR/run_s123-$TS.log"; n=0
while [ -e "$LOG" ]; do n=$((n+1)); LOG="$LOGDIR/run_s123-$TS-$n.log"; done   # 同秒连跑不覆盖
log() { printf '%s\n' "$*" | tee -a "$LOG" || { echo "FATAL LOG_WRITE_FAIL $LOG" >&2; exit 2; }; }

# ===== 计数与公共件 =====
PASS_N=0; FAIL_N=0; SKIP_N=0; RUN_N=0; OUT=""; RC=0
pass()        { PASS_N=$((PASS_N+1)); log "PASS $1 $2"; }
fail()        { FAIL_N=$((FAIL_N+1)); log "FAIL $1 $2"; }
skip_missing(){ FAIL_N=$((FAIL_N+1)); SKIP_N=$((SKIP_N+1)); log "SKIP_MISSING $1 $2"; }   # 缺件 fail-closed：计入 FAILED
selected()    { [ "$ONLY" = all ] || [[ "$1" == "$ONLY"* ]]; }
run()  { local st="$1"; shift; log "RUN  $st: $*"; OUT="$("$@" 2>&1)"; RC=$?; [ -n "$OUT" ] && log "$OUT"; return 0; }
count(){ printf '%s\n' "$OUT" | grep -c "$1"; }   # 只取计数；grep -c 计数为 0 时 rc=1，不传递

# ===== 五个阶段 =====
stage_S1A() {
  [ -f "$S1_UNIT" ] || { skip_missing S1A "S1_UNIT_MISSING $S1_UNIT"; return 0; }
  run S1A "$PY" -B "$S1_UNIT" all
  local c; c=$(count 'mismatches=0')
  if [ "$RC" -eq 0 ] && [ "$c" -ge 1 ]; then pass S1A "rc=0 mismatches=0 lines=$c"
  else fail S1A "rc=$RC mismatches=0 lines=$c"; fi
}
stage_S1B() {
  [ -f "$S1_UNIT" ] || { skip_missing S1B "S1_UNIT_MISSING $S1_UNIT"; return 0; }
  run S1B "$PY" -B "$S1_UNIT" reason-all
  local c; c=$(count 'fail=0 extra_fail=0')      # 两个标记须同一行同现
  if [ "$RC" -eq 0 ] && [ "$c" -ge 1 ]; then pass S1B "rc=0 fail=0 extra_fail=0 lines=$c"
  else fail S1B "rc=$RC fail=0 extra_fail=0 lines=$c"; fi
}
stage_S1C() {
  [ -f "$S1_GATE" ] || { skip_missing S1C "S1_GATE_MISSING $S1_GATE"; return 0; }
  run S1C "$PY" -B "$S1_GATE" --help             # 生效件可执行冒烟，只判 rc
  if [ "$RC" -eq 0 ]; then pass S1C "rc=0 (--help smoke)"; else fail S1C "rc=$RC"; fi
}
stage_S2() {
  if [ -z "$S2_SCRIPT" ] || [ ! -f "$S2_SCRIPT" ]; then
    skip_missing S2 "S2_PENDING dep=${S2_SCRIPT:-<unset>} (generator v1.13 + selfcheck + bind_check + neg 5/5)"; return 0; fi
  run S2 "$PY" -B "$S2_SCRIPT"
  local last; last="$(printf '%s\n' "$OUT" | tail -n 1)"       # 只认末行 S2_SUMMARY
  if [ "$RC" -eq 0 ] && [[ "$last" == "S2_SUMMARY ok=1 "* ]]; then pass S2 "rc=0 $last"
  else fail S2 "rc=$RC last=<$last>"; fi
}
stage_S3() {
  if [ -z "$S3_SCRIPT" ] || [ ! -f "$S3_SCRIPT" ]; then
    skip_missing S3 "S3_PENDING dep=${S3_SCRIPT:-<unset>} (verify_pack -> vp_g8.json + SHA256SUMS, six green)"; return 0; fi
  run S3 "$PY" -B "$S3_SCRIPT"
  local last; last="$(printf '%s\n' "$OUT" | tail -n 1)"       # 只认末行 S3_SUMMARY
  if [ "$RC" -eq 0 ] && [[ "$last" == "S3_SUMMARY ok=1 "* ]]; then pass S3 "rc=0 $last"
  else fail S3 "rc=$RC last=<$last>"; fi
}

# ===== 主流程 =====
log "LOG  $LOG"
if [ "$MODE" = list ]; then
  log "STAGES ${#STAGES[@]} (only=$ONLY):"
  log "  S1A  $PY -B $S1_UNIT all          | want rc=0 and 'mismatches=0'"
  log "  S1B  $PY -B $S1_UNIT reason-all   | want rc=0 and 'fail=0 extra_fail=0' on one line"
  log "  S1C  $PY -B $S1_GATE --help     | want rc=0"
  log "  S2   $PY -B $S2_SCRIPT | want rc=0 and last line 'S2_SUMMARY ok=1 ...' (dep S2_SCRIPT; missing -> SKIP_MISSING S2_PENDING)"
  log "  S3   $PY -B $S3_SCRIPT | want rc=0 and last line 'S3_SUMMARY ok=1 ...' (dep S3_SCRIPT; missing -> SKIP_MISSING S3_PENDING)"
  exit 0
fi
log "START run_s123 ts=$TS pid=$$ only=$ONLY m1dir=$M1DIR s1dir=$S1DIR"
for st in "${STAGES[@]}"; do
  selected "$st" || { log "NOT_SELECTED $st (--only $ONLY)"; continue; }
  RUN_N=$((RUN_N+1))
  if ! declare -F "stage_$st" >/dev/null; then fail "$st" "NO_HANDLER"; continue; fi
  "stage_$st"
done
log "SUMMARY only=$ONLY stages_run=$RUN_N pass=$PASS_N skip_missing=$SKIP_N failed=$FAIL_N"
if [ "$FAIL_N" -eq 0 ]; then log "RESULT: ALL_PASS"; exit 0; fi
log "RESULT: FAILED=$FAIL_N"; exit 1
