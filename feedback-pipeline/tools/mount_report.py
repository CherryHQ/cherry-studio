#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M1 A 旁挂 24h 盯盘报表（release/m1/tools/mount_report.py）

人类 2026-11-27 挂载后前 24 小时只看三个分布，不看“有没有报错”：
  ① 通过 / 拦截 计数（按 rc 与 rule 名分组）
  ② rc=3 的 reason 分布（NO_SAMPLE / 形状不可判 占多数 → 生成侧形态与契约不匹配，先扩契约而非放宽规则）
  ③ 新增行的 来源事件标识 形态分布（wecom 四段 / telegram 三段 / qq 三段 各占多少）

只读 release/m1/out/**/summary.json，不写表、不写语料、不写 state；本报表按需打印，落盘可选。
"""
import argparse
import json
import os
import sys
from collections import Counter

M1 = os.path.expanduser("~/HermesRuntime/release/m1")


def load(out_root):
    rows = []
    for name in sorted(os.listdir(out_root)):
        p = os.path.join(out_root, name, "summary.json")
        if os.path.isfile(p):
            try:
                d = json.load(open(p, encoding="utf-8"))
            except Exception:
                continue
            d["_dir"] = name
            rows.append(d)
    return rows


def main():
    ap = argparse.ArgumentParser(description="A 旁挂 24h 三分布报表（只读 out/）")
    ap.add_argument("--out-root", default=os.path.join(M1, "out"))
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    rows = load(a.out_root)
    rc_c = Counter()
    rule_c = Counter()
    reason_c = Counter()
    shape_c = Counter()
    halt = 0
    truncated = 0
    for d in rows:
        rc = d.get("rc")
        rc_c[str(rc)] += 1
        if d.get("corpus_drift_halt") or d.get("halt"):
            halt += 1
        m = d.get("metrics") or {}
        # by_rule 是样本条数（每规则最多 max_samples 条），跨轮求和更不等于违规总数；
        # 只作为「哪些规则被触发」的清单，总数一律看 violations_total。
        for k, v in (m.get("by_rule_samples") or m.get("by_rule") or {}).items():
            rule_c[k] += v
        if m.get("by_rule_truncated"):
            truncated += 1
        if m.get("rc_reason"):
            reason_c[m["rc_reason"]] += 1
        for k, v in (m.get("new_event_shapes") or {}).items():
            shape_c[k] += v

    out = {
        "rounds": len(rows),
        "rc_counts": dict(rc_c),
        "rule_counts": dict(rule_c),
        "rc3_reason": dict(reason_c),
        "new_event_shapes": dict(shape_c),
        "corpus_drift_halt": halt,
        "by_rule_is_sample_count": True,
        "rounds_with_truncated_by_rule": truncated,
        "note": "rule_counts 是样本条数累加，非违规总数；违规总数看每轮 summary 的 violations_total",
    }
    print("轮次=%d  rc分布=%s  存量漂移停挂=%d" % (len(rows), json.dumps(dict(rc_c), ensure_ascii=False), halt))
    print("① 拦截按 rule=%s" % json.dumps(dict(rule_c), ensure_ascii=False))
    print("② rc=3 reason=%s" % json.dumps(dict(reason_c), ensure_ascii=False))
    print("③ 新增行形态=%s" % json.dumps(dict(shape_c), ensure_ascii=False))
    if a.json:
        json.dump(out, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("落盘=%s（仅在 out/ 之外指定路径时显式写出）" % a.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
