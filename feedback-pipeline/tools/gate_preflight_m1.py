#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M1 重跑前置闸：① 快照 pin 比对 ② 版本来源收敛（人类 2026-11-27 裁决）。

用法:
  python3 -B tools/gate_preflight_m1.py --root . [--contract v1.11]
  不给位置参数。给任何位置参数 → rc=3 USAGE_FAIL（本轮回溯：argv 静默忽略已禁用）。

退出码: 0 = SNAPSHOT_OK 且版本来源合规；3 = SNAPSHOT_MISMATCH / CONTRACT_VERSION_* / USAGE_FAIL

裁决落地（逐条对应）:
  ① BRIEF 必须 pin 两侧被审对象 sha；每次重跑前先打 MEASURED_SHA 与 pin 逐字比对。
  ② 版本判定只认两处：主件 x-contract-version / argv --contract。两者都无 → rc=3 CONTRACT_VERSION_UNRESOLVED。
     - env(UF003_CONTRACT_VERSION) 只是白名单选择器：与主件声明不一致 → rc=3 CONTRACT_VERSION_MISMATCH（点三个值）
     - QQ 段字节等同不作版本来源，只记 qq_segment_sha 供事后比对
  ③ version_source ∈ {header, argv}；不出现 env / qq_segment，故不产生 PASS-WITH-VERSION-INFERENCE。
"""
import argparse
import hashlib
import json
import os
import sys

ENV_KEY = "UF003_CONTRACT_VERSION"


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if sys.argv[1:2] and not sys.argv[1].startswith("-"):
        sys.stderr.write("USAGE_FAIL: 不接受位置参数，收到 %s\n"
                         % json.dumps(sys.argv[1:], ensure_ascii=False))
        return 3
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--contract", default=None)
    ap.add_argument("--pin", default="PIN.json")
    a, unknown = ap.parse_known_args()
    if unknown:
        sys.stderr.write("USAGE_FAIL: 未识别参数 %s\n" % json.dumps(unknown, ensure_ascii=False))
        return 3

    root = os.path.abspath(a.root)
    pin_path = a.pin if os.path.isabs(a.pin) else os.path.join(root, a.pin)
    if not os.path.isfile(pin_path):
        print("PREFLIGHT_READ_FAIL: PIN 不存在 %s" % pin_path)
        return 3
    pin = json.load(open(pin_path, encoding="utf-8"))

    # ---- ① 快照 pin ----
    bad = []
    for item in pin.get("pins", []):
        p = os.path.join(root, item["path"])
        if not os.path.isfile(p):
            bad.append((item["path"], "MISSING", item["sha256"][:12], "-"))
            continue
        got = sha256_of(p)
        size = os.path.getsize(p)
        ok = got == item["sha256"] and (item.get("bytes") in (None, size))
        print("MEASURED_SHA %-24s %s %d B  pin=%s %s  %s"
              % (item["path"], got, size, item["sha256"][:12], item.get("bytes"),
                 "OK" if ok else "MISMATCH"))
        if not ok:
            bad.append((item["path"], "DRIFT", item["sha256"], got))
    if bad:
        print("VERDICT: SNAPSHOT_MISMATCH  重跑不算数（审的不是候选）")
        for row in bad:
            print("  - %s %s pin=%s got=%s" % row)
        return 3

    # ---- ①b 组装检查（人类 2026-11-27：布局一次定死）----
    cdir = os.path.join(root, "contract")
    if os.path.isdir(cdir):
        names = sorted(n for n in os.listdir(cdir) if n.endswith(".json"))
        maps = [n for n in names if n.startswith("channel-map")]
        if len(maps) != 1:
            print("VERDICT: ASSEMBLY_FAIL  channel-map 必须唯一，实得 %d 份：%s"
                  % (len(maps), " / ".join(os.path.join("contract", n) for n in maps)))
            return 3
        if "detail-row.schema.json" in names:
            print("VERDICT: ASSEMBLY_FAIL  禁止运行时加载的裸主件仍在：contract/detail-row.schema.json（应改名到 legacy/）")
            return 3
    print("assembly: channel-map 唯一、裸 detail-row.schema.json 已移出（legacy/ 不参与加载）")


    declared = None
    hits = []
    for name in sorted(os.listdir(os.path.join(root, "contract"))) if os.path.isdir(os.path.join(root, "contract")) else []:
        if not name.endswith(".schema.json"):
            continue
        p = os.path.join(root, "contract", name)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        v = d.get("x-contract-version")
        if v:
            # 主件 = 与 x-contract-version 同版本命名的文件；兄弟件也算声明来源
            hits.append((v, name, sha256_of(p)[:12]))
    # 主件 = 文件名与自身 x-contract-version 同版本的那份；兄弟件不算主件
    mains = [(v, name, s) for v, name, s in hits if name == "detail-row.%s.schema.json" % v]
    if a.contract:
        # argv 是合法版本来源（人类裁决：只认 header / argv 两处）
        if not os.path.isfile(os.path.join(root, "contract", "detail-row.%s.schema.json" % a.contract)):
            print("VERDICT: CONTRACT_VERSION_UNRESOLVED  argv=%s 但本树无 detail-row.%s.schema.json"
                  % (a.contract, a.contract))
            return 3
        main_decl = next((t for t in mains if t[0] == a.contract), None)
        # 声明优先：主件 header 与 argv 一致时，来源记为 header（argv 只是确认同一版本）
        version_source = "header" if main_decl else "argv"
        declared = a.contract
    else:
        if not mains:
            print("VERDICT: CONTRACT_VERSION_UNRESOLVED  主件无 x-contract-version 且未给 --contract")
            return 3
        if len({t[0] for t in mains}) > 1:
            print("VERDICT: CONTRACT_VERSION_UNRESOLVED  主件多版本共存 %s，未给 --contract 不能猜"
                  % sorted({t[0] for t in mains}))
            return 3
        main_decl = mains[0]
        version_source = "header"
        declared = main_decl[0]
    if main_decl and a.contract and main_decl[0] != a.contract:
        print("VERDICT: CONTRACT_VERSION_MISMATCH  header=%s argv=%s env=%s"
              % (main_decl[0], a.contract, os.environ.get(ENV_KEY) or "(unset)"))
        return 3

    env_v = os.environ.get(ENV_KEY)
    if env_v and env_v != declared:
        print("VERDICT: CONTRACT_VERSION_MISMATCH  env=%s header=%s argv=%s"
              % (env_v, main_decl[0] if main_decl else "(none)", a.contract or "(none)"))
        return 3

    print("contract_version: %s (version_source=%s%s)"
          % (declared, version_source,
             ", env 仅作白名单选择器且与声明一致" if env_v else ""))
    print("VERDICT: SNAPSHOT_OK  pin 逐字命中，版本来源为声明（非推断）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
