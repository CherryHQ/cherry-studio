#!/usr/bin/env python3
"""全历史 ref 形态普查 v2（结构化重解析）。

为什么要有 v2：第一遍用 ref.split(':') 统计「段数/段类型」，把 ISO8601 里的冒号
当成分隔符，`wecom:<conv>:2026-11-06T09:58:09+08:00` 被切成 5 段、`wecom:<conv>:22:10:42`
被切成 4 段，段数直方图不可用于 v1.12 覆盖判断。本脚本先摘出时间串、再对剩余部分
分词，输出「前缀 + 结构角色序列 + 时间格式变体」，并区分数据来源桶。

只读输入：state/ref-census/refs_clean.json（[(kind, ref, file, fieldpath, shape_old), ...]）
输出：state/ref-census/census-v2.json
"""
import json
import os
import re
import collections

BASE = os.path.expanduser("~/HermesRuntime/release/m1/state/ref-census")
IN = os.path.join(BASE, "refs_clean.json")
OUT = os.path.join(BASE, "census-v2.json")

# 时间串变体（位置敏感，长的先匹配）
TS_PATTERNS = [
    ("iso_full_off_sec", re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")),
    ("iso_full_off_min", re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})")),
    ("iso_full_nooff_sec", re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?")),
    ("iso_full_nooff_min", re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?!:)")),
    ("iso_noyear_sec", re.compile(r"\b\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")),
    ("placeholder", re.compile(r"T\([^)]*\)")),
    ("clock_only", re.compile(r"\b\d{2}:\d{2}:\d{2}\b")),
    ("clock_hm", re.compile(r"\b\d{2}:\d{2}\b")),
]


def bucket(path):
    p = path or ""
    if any(k in p for k in ("/fixtures/", "u1-demo", "synthetic", "/b-stage/", "scratch")):
        return "fixture_or_local"
    if "real743" in p or "dev-table" in p or "written.json" in p:
        return "real_table_743"
    return "collect_real"


def split_prefix(ref):
    m = re.match(r"^([A-Za-z]+)([:/@])", ref)
    if not m:
        return "?", ref
    return m.group(1).lower(), ref[m.end():]


def classify_ts(ts):
    for name, pat in TS_PATTERNS:
        if pat.fullmatch(ts):
            return name
    return "other"


def parse_body(body):
    """返回 (roles, ts_variants)。

    roles 是对「非时间部分」的角色序列；时间部分单独记变体，不混进段数。
    """
    ts_hits = []
    work = body
    for name, pat in TS_PATTERNS:
        for m in list(pat.finditer(work)):
            if any(a <= m.start() < b for a, b, _ in ts_hits):
                continue
            ts_hits.append((m.start(), m.end(), m.group(0)))
    ts_hits.sort()
    # 去掉被更长匹配包含的短匹配
    kept = []
    for s, e, t in ts_hits:
        if kept and s < kept[-1][1]:
            continue
        kept.append((s, e, t))
    rest = []
    cursor = 0
    for s, e, t in kept:
        rest.append(work[cursor:s])
        cursor = e
    rest.append(work[cursor:])
    non_ts = " ".join(rest)

    ts_variants = [classify_ts(t) for _, _, t in kept]

    roles = []
    if "//" in non_ts:
        roles.append("urlpath")
    for tok in re.split(r"[:/|,\s]+", non_ts):
        tok = tok.strip()
        if not tok:
            continue
        if "=" in tok:
            roles.append("kv")
        elif tok.isdigit():
            roles.append("num")
        elif re.fullmatch(r"[0-9a-fA-F]{16,}", tok):
            roles.append("hex")
        elif tok.startswith("ROBOT"):
            roles.append("robot_token")
        elif tok.startswith("LID"):
            roles.append("lid_alias")
        elif re.fullmatch(r"[A-Za-z0-9_.\-@]{8,}", tok):
            roles.append("opaque")
        else:
            roles.append("str")
    return roles, ts_variants


def main():
    rows = json.load(open(IN))
    shapes = collections.Counter()          # (bucket, label) -> n
    prefix_counts = collections.Counter()   # (bucket, prefix) -> n
    ts_variants = collections.Counter()     # (bucket, variant) -> n
    ts_combo = collections.Counter()        # (bucket, tuple(variants)) -> n
    samples = collections.defaultdict(list)
    distinct = collections.defaultdict(set)
    noprefix = []
    unparsed = []

    for item in rows:
        kind, ref, path, fieldpath, old_shape = item[0], item[1], item[2], item[3], item[4]
        b = bucket(path)
        prefix, body = split_prefix(ref)
        if prefix == "?":
            noprefix.append((ref, path, fieldpath))
        roles, tsv = parse_body(body)
        if not roles and not tsv:
            unparsed.append((ref, path, fieldpath))
        label = "%s+%s" % (prefix, "-".join(roles) if roles else "EMPTY")
        if tsv:
            label += "{%s}" % ",".join(tsv)
        shapes[(b, label)] += 1
        prefix_counts[(b, prefix)] += 1
        for v in tsv:
            ts_variants[(b, v)] += 1
        ts_combo[(b, tuple(tsv) or ("none",))] += 1
        distinct[(b, label)].add(ref)
        if len(samples[(b, label)]) < 3 and ref not in samples[(b, label)]:
            samples[(b, label)].append(ref)

    out = {
        "input": IN,
        "rows": len(rows),
        "prefix_counts": {"%s|%s" % k: v for k, v in sorted(prefix_counts.items())},
        "shapes": [
            {
                "bucket": b,
                "shape": lab,
                "n": n,
                "distinct": len(distinct[(b, lab)]),
                "samples": samples[(b, lab)],
            }
            for (b, lab), n in sorted(shapes.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "ts_variants": {"%s|%s" % k: v for k, v in sorted(ts_variants.items())},
        "ts_combos": {"%s|%s" % (k[0], ",".join(k[1])): v for k, v in sorted(ts_combo.items())},
        "no_prefix": noprefix[:20],
        "unparsed": unparsed[:20],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # 控制台摘要（不打印全量，避免降级）
    print("rows", len(rows), "->", OUT)
    for b in ("collect_real", "real_table_743", "fixture_or_local"):
        tot = sum(n for (bb, _), n in prefix_counts.items() if bb == b)
        print("\n## %s  total=%d" % (b, tot))
        pc = {p: n for (bb, p), n in prefix_counts.items() if bb == b}
        print("  prefixes:", dict(sorted(pc.items(), key=lambda kv: -kv[1])))
        tv = {v: n for (bb, v), n in ts_variants.items() if bb == b}
        print("  ts:", dict(sorted(tv.items(), key=lambda kv: -kv[1])))
        for (bb, lab), n in sorted(shapes.items(), key=lambda kv: -kv[1]):
            if bb == b:
                print("   %4d  %s" % (n, lab))
    print("\nno_prefix", len(noprefix), noprefix[:5])
    print("unparsed", len(unparsed), unparsed[:5])


if __name__ == "__main__":
    main()
