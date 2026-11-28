#!/usr/bin/env python3
"""ref 唯一性核查（v2）：同一 ref 是否对应多个工作项键。

语料与 tools/ref_census_v2.py 同源 —— state/ref-census/refs_clean.json
（[(kind, ref, file, field_path, shape), ...]，953 条命中），
按 field_path 回到原文件取该节点的祖先链，读最近一层工作项键。

分组：
  A same_ref_same_workitem     同一 ref + 同一工作项键（多为同表副本/同轮重复记录）
  B cross_batch_only           同一 ref + 同一主题但批次前缀不同（跨轮回采，工作项键含批次维度）
  C cross_different_topic      同一 ref + 主题都不同（真冲突：一条 ref 指向两个工作项）
  D no_workitem                同一 ref 命中的记录里根本没有工作项键

输出：state/ref-census/ref-uniqueness.json
"""
import json, os, re, collections

HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "HermesRuntime/release/m1/state/ref-census")
IN = os.path.join(BASE, "refs_clean.json")
OUT = os.path.join(BASE, "ref-uniqueness.json")
WI_KEYS = ("工作项键", "工作项", "workitem_key", "work_item_key", "workitem", "work_item")
BATCH_PREFIX = re.compile(r"^\d{4}:")
# 合成/夹具不算口径依据：业主问的是真实历史里 ref 会不会指向两个工作项
SYNTH_PATH = ("/fixtures/", "synthetic", "u1-demo")
SYNTH_WI = re.compile(r"^(uf-syn-|syn-)")

_doc_cache = {}


def load_doc(p):
    if p in _doc_cache:
        return _doc_cache[p]
    doc = None
    try:
        raw = open(p, "r", encoding="utf-8", errors="replace").read()
        try:
            doc = json.loads(raw)
        except Exception:
            rows = []
            for line in raw.splitlines():
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except Exception:
                        pass
            doc = rows
    except OSError:
        doc = None
    _doc_cache[p] = doc
    return doc


def resolve(doc, path, want=None):
    """解析 `.a.b[0].c` / `a.b.c` 形式路径，返回 (node, ancestors) 或 (None, [])。

    ndjson 文档是行数组：必须按 ref 值匹配到命中行，不能取第一行
    （否则同一文件里所有 ref 都会继承第一条记录的工作项键 —— 实测踩过）。
    """
    if isinstance(doc, list) and path and not path.startswith("["):
        for el in doc:
            n, anc = resolve(el, path)
            if n is not None and (want is None or n == want):
                return n, [doc] + anc
        return None, []
    cur, chain = doc, [doc]
    tokens = re.findall(r"\.?([^.\[\]]+)|\[(\d+)\]", path)
    for key, idx in tokens:
        try:
            if idx:
                cur = cur[int(idx)]
            else:
                if not isinstance(cur, dict) or key not in cur:
                    return None, []
                cur = cur[key]
        except Exception:
            return None, []
        chain.append(cur)
    return cur, chain


def _wi_in(d):
    if not isinstance(d, dict):
        return None
    for k in WI_KEYS:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict):
            for kk in ("key", "id", "工作项键"):
                vv = v.get(kk)
                if isinstance(vv, str) and vv.strip():
                    return vv.strip()
    return None


def workitem_of(chain):
    """最近一层优先：先看节点自身与它的 fields 子对象，再逐层向上。"""
    for node in reversed(chain):
        if not isinstance(node, dict):
            continue
        v = _wi_in(node) or _wi_in(node.get("fields"))
        if v:
            return v
    return None


def main():
    rows = json.load(open(IN))
    occ = collections.defaultdict(list)
    unresolved = 0
    for kind, ref, path, fpath, _shape in rows:
        doc = load_doc(path)
        node, chain = (None, [])
        if doc is not None:
            node, chain = resolve(doc, fpath, ref)
        if node is None:
            unresolved += 1
        wi = workitem_of(chain)
        if any(t in path for t in SYNTH_PATH):
            continue
        if wi and SYNTH_WI.match(wi):
            continue
        occ[ref].append((wi, path.replace(HOME, "~"), fpath))

    dup = {r: v for r, v in occ.items() if len(v) > 1}
    A, B, C, D = {}, {}, {}, {}
    for r, v in dup.items():
        wis = sorted(set(x[0] for x in v if x[0]))
        if not wis:
            D[r] = v
        elif len(wis) == 1:
            A[r] = v
        else:
            topics = set(BATCH_PREFIX.sub("", w) for w in wis)
            (B if len(topics) == 1 else C)[r] = v

    def brief(v, n=6):
        return [{"workitem": x[0], "file": x[1], "field_path": x[2]} for x in v[:n]]

    out = {
        "corpus": "state/ref-census/refs_clean.json",
        "occurrences": len(rows),
        "real_occurrences": sum(len(v) for v in occ.values()),
        "distinct_refs": len(occ),
        "dup_refs": len(dup),
        "path_unresolved": unresolved,
        "A_same_ref_same_workitem": len(A),
        "B_cross_batch_same_topic": len(B),
        "C_cross_different_topic": len(C),
        "D_no_workitem": len(D),
        "C_detail": [{"ref": r, "workitems": sorted(set(x[0] for x in v if x[0])),
                      "occ": brief(v)} for r, v in sorted(C.items())],
        "B_detail": [{"ref": r, "workitems": sorted(set(x[0] for x in v if x[0])),
                      "occ": brief(v)} for r, v in sorted(B.items())],
        "A_detail": [{"ref": r, "workitem": v[0][0], "n": len(v),
                      "files": sorted(set(x[1] for x in v))} for r, v in sorted(A.items())],
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: out[k] for k in ("occurrences", "real_occurrences", "distinct_refs", "dup_refs", "path_unresolved",
                                         "A_same_ref_same_workitem", "B_cross_batch_same_topic",
                                         "C_cross_different_topic", "D_no_workitem")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
