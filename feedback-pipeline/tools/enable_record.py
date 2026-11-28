#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成启用记录（V-8）：四件 COMBINED_SHA + 启用前后真表快照差分，全部脚本计算，人不抄数。

用法（示例）：
  python3 -B tools/enable_record.py \
     --artifact tools/conformance.py --artifact tools/mount_dryrun.py \
     --artifact PIN.json --artifact contract/detail-row.v1.11.schema.json \
     --pre snapshots/pre.ndjson --post snapshots/post.ndjson \
     --out records/ENABLE-<stamp>.md

输出（stdout + --out 文件）：
  - COMBINED_SHA = sha256( 按 artifact 顺序拼 "sha256  path\n" )，并逐件列出
  - delta_rows = post 行数 - pre 行数；delta_ids = 新增/删除的记录 id 计数
  - schema_sha：对快照里出现过的字段名集合取 sha256（前后不同即判 schema 漂移）
  - VERDICT: OK / FAIL（delta_rows!=0 或 schema 不一致或文件缺失）

退出码：0 OK，3 FAIL。缺文件不猜，直接 FAIL。
"""
import argparse
import hashlib
import json
import os
import sys


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_ndjson(path):
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                rows.append({"__unparsable__": line[:200]})
    return rows


def row_id(row):
    f = row.get("fields") if isinstance(row.get("fields"), dict) else {}
    for k in ("record_id", "event_id", "id"):
        if row.get(k):
            return str(row[k])
        if f.get(k):
            return str(f[k])
    return None


def field_names(rows):
    names = set()
    for r in rows:
        f = r.get("fields")
        if isinstance(f, dict):
            names.update(f.keys())
        names.update(k for k in r.keys() if k != "fields")
    return names


def schema_sha(rows):
    return hashlib.sha256(json.dumps(sorted(field_names(rows)), ensure_ascii=False).encode("utf-8")).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifact", action="append", default=[])
    ap.add_argument("--pre")
    ap.add_argument("--post")
    ap.add_argument("--out")
    ap.add_argument("--self-test", action="store_true",
                    help="脚本自证模式：只允许拿既有基线自比，输出标 self_test=true，禁止落 ENABLE-* 记录")
    ap.add_argument("--min-rows", type=int, default=700,
                    help="真表快照最小行数（低于此值视为快照不完整，FAIL）")
    a = ap.parse_args()

    lines = []
    fails = []
    self_test = bool(a.self_test)
    lines.append("snapshot_kind=%s" % ("self_test" if self_test else "real_table"))
    lines.append("self_test=%s" % ("true" if self_test else "false"))
    if self_test and a.out and os.path.basename(a.out).startswith("ENABLE-"):
        fails.append("自证模式禁止写 records/ENABLE-* 启用记录（用 --out 指到别处）")
    if not a.artifact:
        fails.append("没有 --artifact")
    listed = []
    for p in a.artifact:
        if not os.path.isfile(p):
            fails.append("artifact 不存在：%s" % p)
            continue
        listed.append((sha256_file(p), p))
    combined = hashlib.sha256("".join("%s  %s\n" % (s, p) for s, p in listed).encode("utf-8")).hexdigest()
    lines.append("COMBINED_SHA=%s" % combined)
    for s, p in listed:
        lines.append("  %s  %s" % (s, p))

    pre = post = None
    if not a.pre or not a.post:
        fails.append("缺 --pre / --post 快照")
    else:
        for p in (a.pre, a.post):
            if not os.path.isfile(p):
                fails.append("快照不存在：%s" % p)
        if not fails:
            pre, post = load_ndjson(a.pre), load_ndjson(a.post)
            d_rows = len(post) - len(pre)
            ids_pre = set(filter(None, (row_id(r) for r in pre)))
            ids_post = set(filter(None, (row_id(r) for r in post)))
            added, removed = len(ids_post - ids_pre), len(ids_pre - ids_post)
            s_pre, s_post = schema_sha(pre), schema_sha(post)
            lines.append("pre_rows=%d post_rows=%d delta_rows=%d" % (len(pre), len(post), d_rows))
            if self_test:
                lines.append("baseline=%d（既有基线自比，非真表快照；不得写入任何启用记录字段）" % len(pre))
            else:
                lines.append("real_table=true")
                if len(pre) < a.min_rows or len(post) < a.min_rows:
                    fails.append("真表快照行数不足 %d（pre=%d post=%d），快照不完整" % (
                        a.min_rows, len(pre), len(post)))
            lines.append("delta_ids_added=%d delta_ids_removed=%d" % (added, removed))
            lines.append("schema_sha_pre=%s" % s_pre)
            lines.append("schema_sha_post=%s" % s_post)
            lines.append("schema_drift=%s" % (s_pre != s_post))
            if d_rows != 0:
                fails.append("delta_rows=%d != 0" % d_rows)
            if s_pre != s_post:
                fails.append("schema 漂移")

    verdict = "OK" if not fails else "FAIL"
    lines.append("VERDICT: %s" % verdict)
    for f in fails:
        lines.append("  - %s" % f)
    text = "\n".join(lines) + "\n"
    print(text, end="")
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    return 0 if verdict == "OK" else 3


if __name__ == "__main__":
    sys.exit(main())
