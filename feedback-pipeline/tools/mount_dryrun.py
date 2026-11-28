#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M1 A 旁挂 dry-run 挂载层（release/m1/tools/mount_dryrun.py）

人类 2026-11-27 挂载三条件（原文口径，逐条落在这里）：
  ① 只读输入、只写本地：判定结果落 release/m1/out/<日期>/，不触碰正式表、不改语料、不写 state
  ② RC 语义：rc=0 放行；rc=2 违规；rc=3 无法判定（4a / 契约 / 装配）→ 三者都不进表
  ③ 存量零变化的独立证据：每轮前后各跑一次 corpus_patrol，RECORDS_SHA 必须 6d8204e0…、rows=743；
     不等 → 立即停挂（rc=3 CORPUS_DRIFT_HALT），不继续判定

回滚：删除对本层的调用即可；本层无状态，不做数据修复。
本文件不写任何路径以外的位置；out 目录之外只读。
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time

HOME = os.path.expanduser("~")
RT = os.path.join(HOME, "HermesRuntime")
M1 = os.path.join(RT, "release", "m1")
PATROL = os.path.join(RT, "candidates", "uf003-u2-mvp", "tools", "corpus_patrol.py")
EXPECT_RECORDS_SHA = ("6d8204e0ce88decb9f8283527dbbe097f28fe6608c09dd9aa00273080cd40852")  # 全 64 位，比较层只用整串
EXPECT_ROWS = 743
RC_TEXT = {0: "PASS-放行", 2: "VIOLATION-违规", 3: "UNDECIDABLE-无法判定"}


def run(cmd, cwd=None):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def sha_equal(got, expect):
    """全 64 位全等比较。任一侧长度不是 64 → 不算相等，且报 SHA_LENGTH_INVALID。

    显式拒绝前缀/截断比较：截断值当判据会把误报换成漏报（44/44 里含 4/44 那种病）。
    """
    if not isinstance(got, str) or not isinstance(expect, str) or len(got) != 64 or len(expect) != 64:
        return False, "SHA_LENGTH_INVALID got=%d expect=%d" % (
            len(got) if isinstance(got, str) else -1, len(expect) if isinstance(expect, str) else -1)
    return got == expect, None


def patrol(root):
    rc, out, err = run([sys.executable, "-B", PATROL, "--root", root])
    sha = rows = None
    for line in (out + err).splitlines():
        m = re.search(r"RECORDS_SHA\s*=\s*([0-9a-f]{64})", line)   # 只认全 64 位
        if m:
            sha = m.group(1)
        m = re.search(r"\brows=(\d+)", line)
        if m:
            rows = int(m.group(1))
    same, sha_err = sha_equal(sha, EXPECT_RECORDS_SHA)
    ok = rc == 0 and same and rows == EXPECT_ROWS
    return {"rc": rc, "records_sha": sha, "records_sha_short": (sha or "")[:16],
            "rows": rows, "ok": ok, "sha_error": sha_err,
            "tail": (out + err).strip().splitlines()[-1:] or [""]}


def load_rows(path):
    """容忍坏 JSON：坏行不抛异常，记成 __unparsable__ 占位（4a 整批停判时要靠它数停判影响面）"""
    rows = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                rows.append({"__unparsable__": line[:40]})
    return rows


def flat_field(row, name):
    if name in row:
        return row.get(name)
    f = row.get("fields")
    if isinstance(f, dict):
        return f.get(name)
    return None


def event_shape(value):
    v = str(value or "")
    if not v:
        return "空"
    parts = v.split(":")
    head = parts[0]
    lens = "-".join(str(len(x)) for x in parts[1:])
    return "%s[%d段:%s]" % (head, len(parts), lens)


def metrics(judge_json, export, baseline, max_samples=3):
    m = {"by_rule_samples": {}, "violations_total": None, "rows_total": None,
         "new_rows": None, "history_rows": None, "rc_reason": None,
         "new_event_shapes": {},
         # by_rule_samples 是「样本条数」不是「违规总数」：判定器每条规则最多留 max_samples 条样本。
         # 打上 cap/truncated 标记，避免下一个人把 3 当总数（同类事故已出过两次：23 vs 26、# COUNT 47）。
         "by_rule_sample_cap": int(max_samples), "by_rule_truncated": False,
         "violations_total_field": "violations_total（唯一可信总数）",
         "judged_rows": None, "unjudged_rows": None, "total_new_rows": None}
    base_ids = {r.get("record_id") for r in load_rows(baseline)} if baseline and os.path.isfile(baseline) else set()
    export_rows = load_rows(export)
    m["total_new_rows"] = len([r for r in export_rows if r.get("record_id") not in base_ids])
    try:
        d = json.load(open(judge_json, encoding="utf-8"))
    except Exception:
        return m
    for k in ("violations_total", "rows_total", "new_rows", "history_rows"):
        m[k] = d.get(k)
    for rule, items in (d.get("rules") or {}).items():
        if items:
            m["by_rule_samples"][rule] = len(items)
            if len(items) >= int(max_samples):
                m["by_rule_truncated"] = True
    base_ids = {r.get("record_id") for r in load_rows(baseline)} if baseline and os.path.isfile(baseline) else set()
    for r in load_rows(export):
        if r.get("record_id") in base_ids:
            continue
        s = event_shape(flat_field(r, "来源事件标识"))
        m["new_event_shapes"][s] = m["new_event_shapes"].get(s, 0) + 1
    return m


def main():
    ap = argparse.ArgumentParser(description="M1 A 旁挂 dry-run 挂载层：只读输入，只写 out/")
    ap.add_argument("--export", required=True)
    ap.add_argument("--baseline", required=True, help="T0 基线导出；不存在则历史检查为空")
    ap.add_argument("--out-root", default=os.path.join(M1, "out"))
    ap.add_argument("--contract", default="v1.11")
    ap.add_argument("--contract-dir", default=os.path.join(M1, "contract"))
    ap.add_argument("--role", default="primary")
    ap.add_argument("--max-samples", default="3")
    ap.add_argument("--root", default=RT, help="巡检根目录（只读用）")
    ap.add_argument("--corpus-origin", default="real", choices=["real", "synthetic"],
                    help="语料来源：real=真实导出；synthetic=合成基线（报告必须显式标注）")
    ap.add_argument("--fixture-sha256", default=None, help="合成夹具 sha256（corpus_origin=synthetic 时必填）")
    a = ap.parse_args()

    stamp = time.strftime("%Y%m%d_%H%M%S")
    outdir = os.path.join(a.out_root, stamp)
    os.makedirs(outdir, exist_ok=True)

    pre = patrol(a.root)
    if not pre["ok"]:
        summary = {"stage": "pre_patrol", "rc": 3, "halt": "CORPUS_DRIFT_HALT",
                   "corpus_origin": a.corpus_origin, "fixture_sha256": a.fixture_sha256,
                   "patrol": pre, "expect": {"records_sha": EXPECT_RECORDS_SHA, "rows": EXPECT_ROWS}}
        json.dump(summary, open(os.path.join(outdir, "summary.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        if pre.get("sha_error"):
            print("MOUNT rc=3 %s（比较层只用 64 位整串，不接受前缀）" % pre["sha_error"].split()[0])
            return 3
        print("MOUNT rc=3 CORPUS_DRIFT_HALT  pre-patrol RECORDS_SHA=%s rows=%s 期望 %s/%s"
              % (pre["records_sha_short"], pre["rows"], EXPECT_RECORDS_SHA[:16], EXPECT_ROWS))
        return 3

    cmd = [sys.executable, "-B", os.path.join(M1, "tools", "conformance.py"), a.export,
           "--baseline", a.baseline, "--contract", a.contract, "--contract-dir", a.contract_dir,
           "--role", a.role, "--max-samples", str(a.max_samples),
           "--json", os.path.join(outdir, "judge.json")]
    rc, out, err = run(cmd)
    open(os.path.join(outdir, "judge.stdout"), "w", encoding="utf-8").write(out + err)

    post = patrol(a.root)
    drift = not post["ok"]

    met = metrics(os.path.join(outdir, "judge.json"), a.export, a.baseline, a.max_samples)
    if rc == 3:
        for line in (out + err).splitlines():
            if line.startswith("READ_FAIL"):
                met["rc_reason"] = line.split(":", 1)[-1].strip()[:80]
                break
        # rc=3 是整批停判（fail-closed），必须报停判影响面：多少新行压根没被判
        met["judged_rows"] = met.get("new_rows") or 0
        met["unjudged_rows"] = max(0, (met.get("total_new_rows") or 0) - met["judged_rows"])
    else:
        met["judged_rows"] = met.get("new_rows")
        met["unjudged_rows"] = 0
    summary = {
        "ts": stamp, "export": a.export, "baseline": a.baseline,
        "contract": a.contract, "role": a.role,
        "rc": rc, "verdict": RC_TEXT.get(rc, "UNKNOWN"), "enters_table": False,
        "corpus_origin": a.corpus_origin, "fixture_sha256": a.fixture_sha256,
        "pre_patrol": pre, "post_patrol": post, "corpus_drift_halt": drift,
        "metrics": met, "rollback": "删除对 mount_dryrun.py 的调用即可；无状态、无数据修复",
    }
    json.dump(summary, open(os.path.join(outdir, "summary.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    with open(os.path.join(outdir, "summary.txt"), "w", encoding="utf-8") as fh:
        fh.write("ts=%s rc=%d %s  进表=%s\n" % (stamp, rc, RC_TEXT.get(rc, "?"), "否"))
        fh.write("patrol pre RECORDS_SHA=%s rows=%s | post RECORDS_SHA=%s rows=%s\n"
                 % (pre["records_sha_short"], pre["rows"], post["records_sha_short"], post["rows"]))
        fh.write("by_rule_samples=%s（样本条数，非总数；cap=%s truncated=%s；总数看 violations_total=%s）\n"
                 % (json.dumps(met["by_rule_samples"], ensure_ascii=False), met["by_rule_sample_cap"],
                    met["by_rule_truncated"], met["violations_total"]))
        fh.write("judged_rows=%s unjudged_rows=%s\n" % (met["judged_rows"], met["unjudged_rows"]))
        fh.write("rc_reason=%s\n" % met["rc_reason"])
        fh.write("new_event_shapes=%s\n" % json.dumps(met["new_event_shapes"], ensure_ascii=False))

    print("MOUNT rc=%d %s  进表=否  证据=%s" % (rc, RC_TEXT.get(rc, "?"), outdir))
    print("patrol pre=%s/%s post=%s/%s%s"
          % (pre["records_sha_short"], pre["rows"], post["records_sha_short"], post["rows"],
             "  <-- 存量漂移，停挂" if drift else ""))
    print("by_rule_samples=%s（样本条数非总数，cap=%s truncated=%s）  violations_total=%s  judged=%s unjudged=%s"
          % (json.dumps(met["by_rule_samples"], ensure_ascii=False), met["by_rule_sample_cap"],
             met["by_rule_truncated"], met["violations_total"], met["judged_rows"], met["unjudged_rows"]))
    print("new_event_shapes=%s" % json.dumps(met["new_event_shapes"], ensure_ascii=False))
    if drift:
        print("MOUNT rc=3 CORPUS_DRIFT_HALT  旁挂路径碰到不该碰的东西，立即停挂")
        return 3
    return rc


if __name__ == "__main__":
    sys.exit(main())
