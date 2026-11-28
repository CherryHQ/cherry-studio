#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D 候选件独立验收：B(479/479 行键同源) C(469 分流) D(反例 rc=3) E(v1.11 回归)。"""
import json, subprocess, sys, os, shutil, tempfile

M1 = os.path.expanduser("~/HermesRuntime/release/m1")
sys.path.insert(0, os.path.join(M1, "tools"))
import window_to_rows as W          # builder 侧 x_row_key 真身

ROWS = "/tmp/v2c_out.ndjson"
BASE = os.path.expanduser("~/HermesRuntime/cache/scratch/baseline_detail_125.ndjson")
GATE = os.path.join(M1, "candidates/D/tools/m1_gate.py")
CONTRACT = json.load(open(os.path.join(M1, "contract/detail-row.v1.13.schema.json")))

rows = [json.loads(l) for l in open(ROWS) if l.strip()]
cols = CONTRACT["x-row-key"]["normalized_row"]["columns"]

# 契约口径列（剔 exclude_columns / declared_but_not_output_columns）
xr = CONTRACT["x-row-key"]
drop = set(xr.get("normalized_row", {}).get("exclude_columns") or [])
drop |= set(xr.get("declared_but_not_output_columns") or [])
eff_cols = [c for c in cols if c not in drop]

eq = neq = 0
samples = []
for r in rows:
    try:
        want = r["明细行键"]
    except KeyError:
        print("MISSING_KEY_COLUMN", sorted(r)[:5]); break
    got = W.x_row_key(r, eff_cols, "unknown:")
    if got == want:
        eq += 1
    else:
        neq += 1
        if len(samples) < 3:
            samples.append({"来源事件标识": r.get("来源事件标识"), "in_row": want[:12], "recomputed": got[:12]})
print("B_ROWS=%d EQ=%d NEQ=%d TOTAL=%d" % (len(rows), eq, neq, len(rows)))
print("B_SAMPLES=%s" % json.dumps(samples, ensure_ascii=False))
print("B_COLS_CONTRACT=%d EFFECTIVE=%d DROPPED=%d" % (len(cols), len(eff_cols), len(drop)))
print("B_COLS_NO_EMPTY=%d EMPTY_IN_ROW=%d" % (sum(1 for c in eff_cols if c), sum(1 for c in eff_cols if not c)))

# C: 分流明细
def ev(r):
    return r.get("来源事件标识") or ""
hist = [json.loads(l) for l in open(BASE) if l.strip()]
hkeys = {ev(r) for r in hist if ev(r)}
exact = [r for r in rows if ev(r) and ev(r) in hkeys]
def pref_hit(k):
    for h in hkeys:
        if h and h != k and (k.startswith(h + ":") or h.startswith(k + ":")):
            return h
    return None
pref = [r for r in rows if ev(r) and ev(r) not in hkeys and pref_hit(ev(r))]
print("C_EXACT=%d PREFIX=%d NEW=%d TOTAL=%d" % (len(exact), len(pref), len(rows) - len(exact) - len(pref), len(rows)))
print("C_EXACT_BY_CH=%s" % json.dumps(__import__("collections").Counter(r.get("来源渠道") for r in exact), ensure_ascii=False))
print("C_PREFIX_PAIRS=%s" % json.dumps([(pref_hit(ev(r)), ev(r)) for r in pref], ensure_ascii=False))

# D: 反例
bad = "/tmp/v2c_bad_verify.ndjson"
shutil.copy(ROWS, bad)
r0 = rows[0]
target = None
with open(bad) as fh, open(bad + ".tmp", "w") as out:
    for i, line in enumerate(fh):
        if i == 0 and line.strip():
            d = json.loads(line)
            d["来源事件标识"] = "wecom:abc"
            out.write(json.dumps(d, ensure_ascii=False) + "\n")
        else:
            out.write(line)
os.replace(bad + ".tmp", bad)
p = subprocess.run(["python3", GATE, "--rows", bad, "--baseline", BASE, "--new-only", "--contract", "v1.13"],
                   capture_output=True, text=True)
print("D_RC=%d OUT=%s" % (p.returncode, (p.stdout or "").strip().splitlines()[-1][:220] if p.stdout.strip() else ""))

# E: v1.11 回归
p = subprocess.run(["python3", GATE, "--rows", ROWS, "--baseline", BASE, "--new-only", "--contract", "v1.11"],
                   capture_output=True, text=True)
print("E_RC=%d OUT=%s" % (p.returncode, (p.stdout or "").strip().splitlines()[-1][:220] if p.stdout.strip() else (p.stderr or "").strip()[:160]))
