#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""契约版本前置校验 v2（M1 上线闸门第一关，独立于生成侧实现）。

对齐人类 2026-11-27 裁决（版本来源收敛，见 tools/gate_preflight_m1.py 同源说明）：
  * 版本只认两处：契约文件 x-contract-version / argv --expect；QQ 段字节等同不作版本来源。
  * 运行时不再有「裸主件」contract/detail-row.schema.json（已移入 legacy/），出现即 ASSEMBLY_FAIL。
  * QQ 段只做防漂移校验：sha256 必须在 id_patterns 冻结表内；沿用（carry-over）登记过的版本允许同 sha。

规则（fail-closed，任一不满足即 rc=3，不写任何输出）：
  1. contract/ 下不得存在裸主件 detail-row.schema.json；
  2. channel-map 必须唯一；
  3. --expect 必给，且 contract/detail-row.<V>.schema.json 必须存在；
  4. 该文件自带 x-contract-version 必须等于 V（声明与 argv 一致，否则 CONTRACT_VERSION_MISMATCH）；
  5. 该文件 QQ 段 sha256 必须在冻结表内；若该 sha 归属版本不是 V，则 V 必须在该 sha 的沿用登记里。

用法: python3 -B tools/contract_preflight.py --expect v1.11 [--contract-dir contract]
退出码: 0 通过（打印 CONTRACT_OK <V>）；3 拒绝（单行点名原因）。
"""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import id_patterns  # noqa: E402

BARE_MAIN = "detail-row.schema.json"
QQ_PATH = ("properties", "来源事件标识", "channel_family_patterns", "QQ")


def dig(d, path):
    for k in path:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--contract-dir", default="contract")
    ap.add_argument("--expect", default=None)
    a = ap.parse_args()

    cdir = a.contract_dir
    if not os.path.isdir(cdir):
        print("CONTRACT_MISSING: 契约目录不存在 %s，拒绝" % cdir)
        return 3

    names = sorted(os.listdir(cdir))
    if BARE_MAIN in names:
        print("CONTRACT_ASSEMBLY_FAIL: 运行时不应存在裸主件 %s（应改名到 legacy/），拒绝"
              % os.path.join(cdir, BARE_MAIN))
        return 3

    maps = [n for n in names if n.startswith("channel-map") and n.endswith(".json")]
    if len(maps) != 1:
        print("CONTRACT_ASSEMBLY_FAIL: channel-map 必须唯一，实得 %d 份（%s），拒绝"
              % (len(maps), " / ".join(maps) or "无"))
        return 3

    ver = a.expect
    if not ver:
        print("CONTRACT_VERSION_UNRESOLVED: 未给 --expect（版本只认 header/argv），拒绝")
        return 3

    sib = os.path.join(cdir, "detail-row.%s.schema.json" % ver)
    if not os.path.isfile(sib):
        print("CONTRACT_VERSION_UNRESOLVED: 无 detail-row.%s.schema.json（现有 %s），拒绝"
              % (ver, " ".join(n for n in names if n.startswith("detail-row.")) or "无"))
        return 3
    try:
        doc = json.load(open(sib, encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("CONTRACT_READ_FAIL: %s（%s），拒绝" % (sib, exc))
        return 3

    declared = doc.get("x-contract-version")
    if declared != ver:
        print("CONTRACT_VERSION_MISMATCH: argv=%s 但 %s 声明 x-contract-version=%s，拒绝"
              % (ver, os.path.basename(sib), declared))
        return 3

    qq = dig(doc, QQ_PATH)
    if qq is None:
        print("CONTRACT_QQ_MISSING: %s 缺少 QQ 族段，拒绝" % os.path.basename(sib))
        return 3
    sha = id_patterns.qq_segment_sha256(qq)
    owner = id_patterns.SHIPPED_QQ_FAMILY_SHA256.get(sha)
    carried = id_patterns.SHIPPED_QQ_CARRY_OVER.get(sha, (None, ()))[1]
    if owner is None:
        print("CONTRACT_QQ_DRIFT: QQ 段 sha256 %s 不在冻结表（%s），拒绝"
              % (sha[:16], id_patterns._frozen()))
        return 3
    if owner != ver and ver not in carried:
        print("CONTRACT_QQ_VERSION_MISMATCH: QQ 段属于 %s 且未登记 %s 沿用，拒绝"
              % (owner, ver))
        return 3

    print("CONTRACT_OK %s qq_sha256=%s qq_owner=%s file_sha256=%s bytes=%d"
          % (ver, sha[:16], owner, sha_file(sib)[:16], os.path.getsize(sib)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
