#!/usr/bin/env python3
"""ref 唯一性核查：同一 ref 是否对应多个工作项键。

输入：与 tools/ref_census_v2.py 同一语料（历史导出 + 采集批次 + 夹具）
输出：state/ref-census/ref-uniqueness.json（分组明细 + 计数）
口径：
  ref 字段名 ∈ {ref, 来源事件标识, event_id, source_ref}
  工作项键字段名 ∈ {工作项键, 工作项, work_item_key, workitem_key, workitem, work_item}
  同一 dict 内取工作项键；取不到则沿父链向上找最近一层。
"""
import json, os, re, sys, collections

HOME = os.path.expanduser("~")
ROOTS = [
    os.path.join(HOME, "HermesRuntime/workspace/user-feedback/feedback-sync"),
    os.path.join(HOME, "HermesRuntime/release/m1"),
]
SKIP_DIR = {"cache", "backups", ".git", "node_modules", "__pycache__", "pruned"}
# 语料收窄：排除合成夹具与本地产物，只留真实采集/导出（业主口径：真实形态才作口径依据）
SKIP_PATH_PAT = ("synthetic", "/fixtures/", "u1-demo", "/scratch/", "pruned")
SKIP_WI_PAT = re.compile(r"^(uf-syn-|syn-)")
REF_KEYS = ("来源事件标识", "ref", "event_id", "source_ref")
WI_KEYS = ("工作项键", "工作项", "work_item_key", "workitem_key", "workitem", "work_item")
MAX_BYTES = 8 * 1024 * 1024
OUT = os.path.join(HOME, "HermesRuntime/release/m1/state/ref-census/ref-uniqueness.json")


def walk_files():
    for root in ROOTS:
        for dirpath, dirnames, names in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR]
            for n in names:
                if not n.lower().endswith((".json", ".ndjson", ".jsonl")):
                    continue
                p = os.path.join(dirpath, n)
                if any(t in p for t in SKIP_PATH_PAT):
                    continue
                try:
                    if os.path.getsize(p) > MAX_BYTES:
                        continue
                except OSError:
                    continue
                yield p


def load_any(p):
    try:
        raw = open(p, "r", encoding="utf-8", errors="replace").read()
    except OSError:
        return None
    if p.lower().endswith((".ndjson", ".jsonl")):
        out = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                pass
        return out
    try:
        return [json.loads(raw)]
    except Exception:
        out = []
        for line in raw.splitlines():
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except Exception:
                    pass
        return out


def scan(node, path, inherited_wi, found):
    wi = inherited_wi
    if isinstance(node, dict):
        for k in WI_KEYS:
            v = node.get(k)
            if isinstance(v, str) and v.strip():
                wi = v.strip()
                break
            if isinstance(v, dict):
                for kk in ("key", "id", "工作项键"):
                    vv = v.get(kk)
                    if isinstance(vv, str) and vv.strip():
                        wi = vv.strip()
                        break
        for k in REF_KEYS:
            v = node.get(k)
            if isinstance(v, str) and v.strip():
                found.append((v.strip(), wi, path + "." + k if path else k))
        for k, v in node.items():
            scan(v, path + "." + k if path else k, wi, found)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            scan(v, "%s[%d]" % (path, i), wi, found)


def main():
    occurrences = collections.defaultdict(list)   # ref -> [(wi, path, jsonpath)]
    n_files = n_occ = 0
    for p in walk_files():
        docs = load_any(p)
        if not docs:
            continue
        found = []
        for d in docs:
            scan(d, "", None, found)
        if found:
            n_files += 1
        for ref, wi, jp in found:
            if wi and SKIP_WI_PAT.match(wi):
                continue
            n_occ += 1
            occurrences[ref].append((wi, p, jp))

    dup_refs = {r: v for r, v in occurrences.items() if len(v) > 1}
    same_wi, cross_wi, no_wi = {}, {}, {}
    for r, v in dup_refs.items():
        wis = set(x[0] for x in v if x[0])
        if not wis:
            no_wi[r] = v
        elif len(wis) == 1:
            same_wi[r] = v
        else:
            cross_wi[r] = v

    def brief(v):
        return [{"workitem": x[0], "file": x[1].replace(HOME, "~"), "json_path": x[2]} for x in v[:8]]

    out = {
        "generated_by": "tools/ref_uniqueness.py",
        "files_with_refs": n_files,
        "occurrences": n_occ,
        "distinct_refs": len(occurrences),
        "dup_refs": len(dup_refs),
        "same_ref_same_workitem": len(same_wi),
        "same_ref_cross_workitem": len(cross_wi),
        "same_ref_no_workitem": len(no_wi),
        "cross_batch_only": sum(1 for r, v in cross_wi.items()
                                if len(set(re.sub(r"^\d{4}:", "", x[0]) for x in v if x[0])) == 1),
        "cross_different_topic": sum(1 for r, v in cross_wi.items()
                                     if len(set(re.sub(r"^\d{4}:", "", x[0]) for x in v if x[0])) > 1),
        "cross_workitem_detail": [{"ref": r, "workitems": sorted(set(x[0] for x in v if x[0])),
                                   "occurrences": brief(v)} for r, v in sorted(cross_wi.items())],
        "same_workitem_detail": [{"ref": r, "workitem": v[0][0], "n": len(v),
                                  "files": sorted(set(x[1].replace(HOME, "~") for x in v))}
                                 for r, v in sorted(same_wi.items())],
        "no_workitem_detail": [{"ref": r, "n": len(v), "files": sorted(set(x[1].replace(HOME, "~") for x in v))}
                               for r, v in sorted(no_wi.items())][:50],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: out[k] for k in ("files_with_refs", "occurrences", "distinct_refs", "dup_refs",
                                         "same_ref_same_workitem", "same_ref_cross_workitem",
                                         "same_ref_no_workitem")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
