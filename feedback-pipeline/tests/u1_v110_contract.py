#!/usr/bin/env python3
"""契约 v1.10 的两条改动必须可复算：QQ 段放宽 + 枚举单一真源。

用真语料（runs 里的 QQ 私聊原文）当判据，不用手造样本：
  1) 随包 v1.9 schema 的 QQ 段对 1188 个真实 id 命中 0 —— 这是缺陷本身；
  2) v1.10 补丁命中 1188/1188，且 4 条负例（裸前缀/超长/含空格/尾随换行）全拒；
  3) channel-map 删掉 target_enum 后，派生结果必须与 v1.9 手写数组逐值相同（零行为变化）；
  4) uf003_identity 在 v1.10 契约下能正常加载（不再 KeyError），且派生枚举一致；
  5) 若旧包仍带 target_enum 但与派生结果不一致，必须拒启动（ResolveError），不猜。
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT = os.path.join(ROOT, "contract")
PATCH = os.environ.get(
    "UF003_V110_PATCH",
    "/Users/cherryai003/HermesRuntime/cache/user-feedback/scratch/v110-patch")
CORPUS_GLOB = ("/Users/cherryai003/HermesRuntime/workspace/user-feedback/feedback-sync"
               "/runs/*/qq-private.json")
SIGNED_RUN = ("/Users/cherryai003/HermesRuntime/workspace/user-feedback/feedback-sync"
              "/runs/external-a-20261126T2200/qq-private.json")
PY = sys.executable

total = 0
bad = 0


def check(name, ok, detail=""):
    global total, bad
    total += 1
    print(f"[{'OK  ' if ok else 'FAIL'}] {name}" + (f": {detail}" if detail else ""))
    if not ok:
        bad += 1


def qq_ids(pattern=None):
    """真语料里的全部 ROBOT1.0_ 标识（去重）。pattern 给定时只扫那一批。"""
    seen = []
    for path in sorted(glob.glob(pattern or CORPUS_GLOB)):
        with open(path, encoding="utf-8") as fh:
            txt = fh.read()
        for m in re.finditer(r"ROBOT1\.0_[A-Za-z0-9_.!\-]+", txt):
            if m.group(0) not in seen:
                seen.append(m.group(0))
    return seen


def fam(path):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    pat = doc["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"]
    return pat, re.compile(pat)


def derived_enum(schema_path, map_path):
    with open(schema_path, encoding="utf-8") as fh:
        schema = json.load(fh)
    with open(map_path, encoding="utf-8") as fh:
        cmap = json.load(fh)
    rules = {r["source"]: r["target"] for r in cmap["rules"]}
    fb = cmap["fallback"]["target"]
    out = []
    for src in schema["properties"]["来源渠道"]["enum"]:
        t = rules.get(src, fb)
        if t not in out:
            out.append(t)
    return out


def run_identity(contract_dir):
    """在子进程里加载 uf003_identity，避开模块级缓存。"""
    code = (
        "import json,os,sys;"
        "sys.path.insert(0, %r);"
        "import uf003_identity as U;"
        "c=U.load_contract();"
        "print(json.dumps({'target_enum': c['target_enum'],"
        "'fallback': c['fallback_channel'],"
        "'warnings': U.contract_warnings(c)}, ensure_ascii=False))" % ROOT
    )
    env = dict(os.environ, UF003_CONTRACT_DIR=contract_dir)
    p = subprocess.run([PY, "-c", code], capture_output=True, text=True, env=env, cwd=ROOT)
    return p


def main() -> int:
    signed = qq_ids(SIGNED_RUN)
    print(f"受签语料（external-a-20261126T2200）：{len(signed)} 个唯一 QQ id；"
          f"长度 {sorted({len(i) for i in signed})}")
    ids = qq_ids()
    print(f"全量语料（runs/*）：{len(ids)} 个唯一 QQ id；"
          f"长度 {min(len(i) for i in ids)}…{max(len(i) for i in ids)}")
    if not signed:
        check("受签语料存在", False, SIGNED_RUN)
        return 1

    # 1) 随包 v1.9：缺陷本身
    old_pat, old_re = fam(os.path.join(CONTRACT, "detail-row.schema.json"))
    hits = sum(1 for i in signed if old_re.match("qq:G:" + i))
    check("v1.9 QQ 段对受签语料命中 0（缺陷复现）", hits == 0, f"{hits}/{len(signed)}")

    # 2) v1.10 补丁
    new_pat, new_re = fam(os.path.join(PATCH, "detail-row.schema.json"))
    hits = sum(1 for i in signed if new_re.match("qq:G:" + i))
    check("v1.10 QQ 段命中受签语料 1188/1188", hits == len(signed) == 1188,
          f"{hits}/{len(signed)}")
    hits_all = sum(1 for i in ids if new_re.match("qq:G:" + i))
    check("v1.10 QQ 段命中全部 runs 语料", hits_all == len(ids), f"{hits_all}/{len(ids)}")
    negatives = ["qq:G:ROBOT1.", "qq:G:ROBOT1.0_" + "a" * 201,
                 "qq:G:ROBOT1.0_ab cd", "qq:G:ROBOT1.0_ab\n"]
    rejected = [not new_re.match(n) for n in negatives]
    check("v1.10 负例全拒（裸前缀/201 字符/含空格/尾随换行）", all(rejected), str(rejected))
    check("v1.10 收尾用 \\Z 不用 $", new_pat.endswith("\\Z"), new_pat[-12:])

    # 3) 枚举单一真源：派生 == v1.9 手写数组
    with open(os.path.join(CONTRACT, "channel-map.json"), encoding="utf-8") as fh:
        old_map = json.load(fh)
    old_enum = sorted(old_map["target_enum"])
    der = derived_enum(os.path.join(PATCH, "detail-row.schema.json"),
                       os.path.join(PATCH, "channel-map.json"))
    check("派生枚举与 v1.9 target_enum 逐值相同（零行为变化）",
          sorted(der) == old_enum, f"{der} vs {old_enum}")
    with open(os.path.join(PATCH, "channel-map.json"), encoding="utf-8") as fh:
        new_map = json.load(fh)
    check("v1.10 不再手写 target_enum", "target_enum" not in new_map)
    check("v1.10 指明派生来源", new_map.get("target_enum_from", "").endswith(
        "#/properties/来源渠道/enum"), str(new_map.get("target_enum_from")))

    # 4) 加载器在 v1.10 契约下可用
    v110 = os.path.join(ROOT, "state", "uf-003", "contract-v110")
    os.makedirs(v110, exist_ok=True)
    for f in os.listdir(CONTRACT):
        src = os.path.join(CONTRACT, f)
        if os.path.isfile(src):
            shutil.copyfile(src, os.path.join(v110, f))
    for f in ("detail-row.schema.json", "channel-map.json"):
        shutil.copyfile(os.path.join(PATCH, f), os.path.join(v110, f))
    p = run_identity(v110)
    ok = p.returncode == 0
    detail = p.stderr.strip()[:200]
    if ok:
        try:
            out = json.loads(p.stdout)
            detail = f"target_enum={out['target_enum']}"
            ok = sorted(out["target_enum"]) == old_enum and out["fallback"] == old_map["fallback"]["source"]
        except ValueError as exc:
            ok, detail = False, f"stdout 不是 JSON: {exc}"
    check("uf003_identity 在 v1.10 契约下加载成功且枚举一致", ok, detail)

    # 5) 旧包带不一致 target_enum → 拒启动
    stale = os.path.join(ROOT, "state", "uf-003", "contract-stale")
    os.makedirs(stale, exist_ok=True)
    for f in os.listdir(v110):
        shutil.copyfile(os.path.join(v110, f), os.path.join(stale, f))
    with open(os.path.join(stale, "channel-map.json"), encoding="utf-8") as fh:
        sm = json.load(fh)
    sm["target_enum"] = ["企微", "QQ"]        # 故意与派生结果不一致
    with open(os.path.join(stale, "channel-map.json"), "w", encoding="utf-8") as fh:
        json.dump(sm, fh, ensure_ascii=False, indent=1)
    p = run_identity(stale)
    check("target_enum 与派生不一致时拒启动",
          p.returncode != 0 and "ResolveError" in p.stderr + p.stdout,
          (p.stderr or p.stdout).strip().splitlines()[-1][:120] if (p.stderr or p.stdout) else "")

    with open(os.path.join(CONTRACT, "detail-row.schema.json"), encoding="utf-8") as fh:
        old_pats = json.load(fh)["properties"]["来源事件标识"]["channel_family_patterns"]
    with open(os.path.join(PATCH, "detail-row.schema.json"), encoding="utf-8") as fh:
        new_pats = json.load(fh)["properties"]["来源事件标识"]["channel_family_patterns"]
    old_by_ch = {k: re.compile(v) for k, v in old_pats.items()}
    new_by_ch = {k: re.compile(v) for k, v in new_pats.items()}

    # 6b) 97 条样本覆盖不到的两处真实差异，单独钉住（否则「修好了」无从证）
    pairs = [
        # v1.9 只有 QQ 段是坏的（反斜杠多转义 + 长度 80），其余 8 段转义正常
        ("支持邮箱", "mail:smith@example.com", True, True),
        ("其它", "x1", True, True),
        # 9 段统一 $ -> \Z：$ 会放过尾随换行（v1.9 里 om_abc\n 能过）
        ("内部飞书", "om_abc\n", True, False),
        ("企微", "wc:10812375771529472:5920847\n", True, False),
        ("Discord", "dc:1:2:3\n", True, False),
        # 待映射/其它 是「原样保留」族（[\s\S]+），换行本来就允许，两版都过
        ("待映射", "wb_777\n", True, True),
    ]
    wrong = []
    for ch, sid, want_old, want_new in pairs:
        got_old = bool(old_by_ch[ch].match(sid))
        got_new = bool(new_by_ch[ch].match(sid))
        if (got_old, got_new) != (want_old, want_new):
            wrong.append((ch, sid, want_old, want_new, got_old, got_new))
    check("差异逐条钉住（邮箱不受影响、尾随换行被收紧）", not wrong, str(wrong))

    # 6) 契约与判定器必须逐字同源：conformance 自持一份族规则就迟早分叉
    #    U2.1 起判定器不再在源码里自持口径，改为按 --contract 从 schema 派生；
    #    因此本项从「比模块级常量」改成「调 load_contract 后比派生结果」，并断言派生前的空态。
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import conformance as C  # noqa: E402
    check("判定器源码不再自持族规则（派生前为空）", C.CHANNEL_PATTERNS == {}, str(len(C.CHANNEL_PATTERNS)))
    C.load_contract("v1.9", os.path.join(ROOT, "contract"))
    drift_old = {k: (v, old_pats.get(k)) for k, v in C.CHANNEL_PATTERNS.items() if old_pats.get(k) != v}
    check("v1.9 派生与随包 v1.9 schema 逐字相同", not drift_old, str(list(drift_old)[:3]))
    C.load_contract("v1.10", os.path.join(ROOT, "contract"))
    drift = {k: (v, new_pats.get(k)) for k, v in C.CHANNEL_PATTERNS.items() if new_pats.get(k) != v}
    check("判定器族规则与 v1.10 schema 逐字相同", not drift, str(list(drift)[:3]))
    check("判定器覆盖 schema 全部渠道", set(C.CHANNEL_PATTERNS) == set(new_pats),
          f"{sorted(set(new_pats) - set(C.CHANNEL_PATTERNS))}")
    import id_patterns  # noqa: E402
    check("QQ 段两版均按 id_patterns 覆盖且报告回显（U2.3）",
          C.FAMILY["QQ"].pattern == id_patterns.QQ_FAMILY and set(C.ID_PATTERN_OVERLAY) == {"QQ"},
          str(sorted(C.ID_PATTERN_OVERLAY)))
    check("判定器报告回显 QQ 段绑定的版本（r9 C）", C.QQ_SEGMENT_VERSION == "v1.10"
          and C.QQ_SEGMENT_SHA256 in id_patterns.SHIPPED_QQ_FAMILY_SHA256, str(C.QQ_SEGMENT_VERSION))

    # 6c) r9 C 指纹绑版本：两版 QQ 段整段互换后，哈希仍在冻结表，但所在文件版本不符 → 必须拒判（rc=3 的来源）
    import tempfile  # noqa: E402
    qq = {v: json.load(open(os.path.join(CONTRACT, "detail-row.%s.schema.json" % v), encoding="utf-8"))
          ["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"] for v in ("v1.9", "v1.10")}
    with tempfile.TemporaryDirectory() as tmp:
        for dst, src in (("v1.10", "v1.9"), ("v1.9", "v1.10")):
            doc = json.load(open(os.path.join(CONTRACT, "detail-row.%s.schema.json" % dst), encoding="utf-8"))
            doc["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"] = qq[src]
            with open(os.path.join(tmp, "detail-row.%s.schema.json" % dst), "w", encoding="utf-8") as fh:
                json.dump(doc, fh, ensure_ascii=False)
            err = None
            try:
                C.load_contract(dst, tmp)
            except C.ReadError as exc:
                err = str(exc)
            check("--contract %s 配 %s QQ 段 → 拒判并点名版本不符" % (dst, src),
                  err is not None and id_patterns.QQ_VERSION_TAG in err and src in err and dst in err
                  and "\n" not in err and C.QQ_SEGMENT_VERSION in ("v1.9", "v1.10"),
                  (err or "未拒").strip()[:110])
    C.load_contract("v1.10", os.path.join(ROOT, "contract"))     # 恢复为真 v1.10，免得影响后续用例

    # 7) 样本命中表：以 97 条真样本里「应当通过」的 id 为准，逐渠道统计
    with open(os.path.join(ROOT, "state", "uf-003", "u1-samples.json"), encoding="utf-8") as fh:
        samples = json.load(fh)
    table = {}
    for row in samples:
        if not row.get("_ok") or row.get("_synthetic"):
            continue                            # 合成契约行（r9 A）的 ID 列是 REFUSE 标记，不是任何契约下的 id
        ch, sid = row.get("来源渠道"), row.get("来源事件标识")
        if ch not in new_by_ch or not sid:
            continue
        t = table.setdefault(ch, [0, 0, 0])       # [应过, v1.9 命中, v1.10 命中]
        t[0] += 1
        t[1] += 1 if old_by_ch[ch].match(sid) else 0
        t[2] += 1 if new_by_ch[ch].match(sid) else 0
    print("渠道        应过  v1.9命中  v1.10命中")
    for ch, (n, o, nw) in sorted(table.items()):
        print(f"{ch:<10} {n:>4} {o:>8} {nw:>9}")
    short = {ch: (n, o, nw) for ch, (n, o, nw) in table.items()
             if ch in ("QQ", "支持邮箱", "其它", "待映射")}
    check("四类受影响渠道样本 v1.10 全命中",
          all(nw == n and n > 0 for n, o, nw in short.values()), str(short))
    check("v1.10 未让任何渠道的既有样本从「能过」变成「不能过」",
          all(nw >= o for n, o, nw in table.values()),
          str({ch: t for ch, t in table.items() if t[2] < t[1]}))

    print(f"\n{total - bad}/{total} passed")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
