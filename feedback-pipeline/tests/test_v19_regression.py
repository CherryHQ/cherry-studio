#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v1.9 冻结历史件回归（独立回归，不走 M1 前置通道）。

为什么单列：
  M1 前置只认 primary v1.11（x-contract-version 必须存在），v1.9/v1.10 在 primary 下一律
  CONTRACT_VERSION_UNDECLARED。所以 v1.9 不能被塞回前置通道，但也不能因此丢掉。

判据不看 rc，只看 violations_total：
  conformance --role crosscheck 设计上不产出放行结论：有违规时 rc=2，零违规时 rc=3
  CROSSCHECK_ONLY（实测本 fixture：violations=4249 → rc=2）。任何用 rc=0 当通过判据的回归，在 crosscheck 下永远红——那是把"不表态"当失败，
  与 SKIP>0 却打 VERIFY-OK 是同一种镜像错误。

断言必须打两个数（实测 violations_total 与冻结期望值），不写"通过了"。

退出码：0 = 两个数相等；3 = 不等/读取失败（本 profile 只用 0/2/3，不出现 1）。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECTED = os.path.join(ROOT, "tests", "v19-expected.json")
FROZEN_EXPORT = os.path.expanduser(
    "~/HermesRuntime/workspace/user-feedback/feedback-sync/reports/"
    "uf003-u2.1-real743-handoff/real743x34.ndjson"
)
OUT_JSON = os.path.join(ROOT, "b-stage", "20261127T1050", "v19-crosscheck.json")


def main():
    if not os.path.isfile(EXPECTED):
        print(f"EXPECTED_MISSING: {EXPECTED}（冻结期望值必须先登记）", file=sys.stderr)
        return 3
    exp = json.load(open(EXPECTED, encoding="utf-8"))
    want = exp["violations_total"]
    cmd = [
        sys.executable, "-B", os.path.join(ROOT, "tools", "conformance.py"),
        FROZEN_EXPORT,
        "--baseline", "",
        "--contract", "v1.9",
        "--role", "crosscheck",
        "--channel-map", os.path.join(ROOT, "contract", "channel-map.json"),
        "--json", OUT_JSON,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    # crosscheck 恒 rc=3，这里只记录不复用
    rc = proc.returncode
    try:
        got = json.load(open(OUT_JSON, encoding="utf-8"))["violations_total"]
    except Exception as exc:  # noqa: BLE001
        print(f"READ_FAIL: 取不到 violations_total（{exc}）rc={rc}", file=sys.stderr)
        print(proc.stderr[-800:], file=sys.stderr)
        return 3
    ok = got == want
    print(f"violations_total measured={got} expected={want} rc={rc} "
          f"({'MATCH' if ok else 'MISMATCH'})")
    return 0 if ok else 3


if __name__ == "__main__":
    sys.exit(main())
