#!/usr/bin/env python3
"""合成基线逐项对账（corpus_origin=synthetic）。

对 fixtures/synthetic-60/rows.ndjson 逐行单独判定：
  临时导出 = 真表 743 行 + 该行（单行成批，避免 4a 的 READ_FAIL 吞掉整批分类）
  判 rc 与规则名，和 manifest 的 expected_rc / expected_rule 逐项比对

不一致即真发现：说明判定侧分类与本侧语义表不符（不是夹具错）。

复现：
  python3 -B tools/classify_synthetic.py \
      --baseline .../real743x34.ndjson --fixture fixtures/synthetic-60 --workdir <scratch>
产物：<fixture>/classification.json（逐行）+ stdout 汇总
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile

M1 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONF = os.path.join(M1, "tools", "conformance.py")


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout, p.stderr


def main():
    ap = argparse.ArgumentParser(description="合成基线 rc/规则 逐项对账")
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--fixture", default=os.path.join(M1, "fixtures", "synthetic-60"))
    ap.add_argument("--contract", default="v1.11")
    ap.add_argument("--contract-dir", default=os.path.join(M1, "contract"))
    ap.add_argument("--workdir", default=None)
    args = ap.parse_args()

    man = json.load(open(os.path.join(args.fixture, "manifest.json"), encoding="utf-8"))
    base_text = open(args.baseline, encoding="utf-8").read().rstrip("\n")
    rows = [l for l in open(os.path.join(args.fixture, "rows.ndjson"), encoding="utf-8").read().splitlines() if l.strip()]
    assert len(rows) == man["synthetic_rows"], (len(rows), man["synthetic_rows"])

    work = args.workdir or tempfile.mkdtemp(prefix="synth-cls-")
    os.makedirs(work, exist_ok=True)
    results = []
    for m, row in zip(man["rows"], rows):
        exp_path = os.path.join(work, "exp_%04d.ndjson" % m["ordinal"])
        with open(exp_path, "w", encoding="utf-8") as fh:
            fh.write(base_text + "\n" + row + "\n")
        js = os.path.join(work, "j_%04d.json" % m["ordinal"])
        rc, out, err = run([sys.executable, "-B", CONF, exp_path, "--baseline", args.baseline,
                            "--contract", args.contract, "--contract-dir", args.contract_dir,
                            "--role", "primary", "--json", js])
        got_rule, got_count, read_fail = [], 0, ""
        if os.path.exists(js):
            try:
                d = json.load(open(js, encoding="utf-8"))
                got_rule = sorted(k for k, v in (d.get("rules") or {}).items() if v)
                got_count = d.get("violations_total") or 0
            except Exception as exc:  # noqa: BLE001
                read_fail = "JSONUNPARSABLE:%s" % exc
        if rc == 3:
            for line in (out + err).splitlines():
                if "READ_FAIL" in line:
                    read_fail = line.strip()
                    break
        exp_rule = m.get("expected_rule")
        if exp_rule and exp_rule.startswith("READ_FAIL/"):
            match = rc == m["expected_rc"] and "READ_FAIL" in read_fail
        elif exp_rule:
            match = rc == m["expected_rc"] and exp_rule in got_rule
        else:
            match = rc == m["expected_rc"] and got_count == 0
        results.append({"ordinal": m["ordinal"], "record_id": m["record_id"],
                        "corpus_class": m["corpus_class"], "family": m["family"],
                        "expected_rc": m["expected_rc"], "expected_rule": exp_rule,
                        "actual_rc": rc, "actual_rules": got_rule,
                        "actual_rule_counts": got_count, "read_fail": read_fail,
                        "match": match})

    exp = man["expected_distribution"]
    actual = {"rc0_legal": sum(1 for r in results if r["actual_rc"] == 0),
              "rc2_violation_4b": sum(1 for r in results if r["actual_rc"] == 2),
              "rc3_undecidable_4a": sum(1 for r in results if r["actual_rc"] == 3)}
    mism = [r for r in results if not r["match"]]
    summary = {
        "corpus_origin": "synthetic",
        "note": "合成基线，不代表真实流量分布；真实 24h 分布等采集接入后再出",
        "fixture_sha256": man["fixture_sha256"],
        "baseline_sha256": man["baseline_sha256"],
        "expected_distribution": exp,
        "actual_distribution": actual,
        "distribution_match": exp == actual,
        "rows_checked": len(results),
        "mismatches": len(mism),
        "mismatch_detail": mism,
        "per_row": results,
    }
    out_path = os.path.join(args.fixture, "classification.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print("corpus_origin=synthetic  fixture_sha256=%s" % man["fixture_sha256"])
    print("期望分布 : %s" % json.dumps(exp, ensure_ascii=False))
    print("实测分布 : %s" % json.dumps(actual, ensure_ascii=False))
    print("分布一致 : %s   逐行一致 %d/%d" % (exp == actual, len(results) - len(mism), len(results)))
    for r in mism:
        print("  不一致 %s %s 期望 rc=%s/%s 实测 rc=%s rules=%s %s"
              % (r["record_id"], r["corpus_class"], r["expected_rc"], r["expected_rule"],
                 r["actual_rc"], r["actual_rules"], r["read_fail"][:110]))
    print("分类明细: %s" % out_path)
    return 0 if not mism else 1


if __name__ == "__main__":
    raise SystemExit(main())
