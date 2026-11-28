#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run-m1.sh --run 模式 正负控（不依赖 pytest）。

运行: python3 -B tests/test_run_mode.py            # M1_BASELINE 未设置 → 正控跳过（SKIP_NO_BASELINE，不算失败）
      M1_BASELINE=<743 基线.ndjson> python3 -B tests/test_run_mode.py

负控: ./run-m1.sh --run /nonexistent-dir --baseline <任意>
        → rc==3（不得透出 python 的 1/2），最后一行 RUN_M1_RUN_RESULT RC=3，且 out/<今天>/ 不新建、不改动
正控: ./run-m1.sh --run <真实窗口目录> --baseline $M1_BASELINE
        → rc==0，stdout 含 RUN_M1_RUN_RESULT RC=0 且为最后一行，四关各一行 STAGE=n <名称> RC=0
退出码: 0 全过 / 1 有失败；最后一行 TESTS <通过数>/<执行数>（被跳过的正控不计入分母）
"""
import datetime
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(ROOT, "run-m1.sh")
TODAY = datetime.date.today().strftime("%Y%m%d")
OUT_TODAY = os.path.join(ROOT, "out", TODAY)
# 真实采集窗口目录（raw/ 下 wecom.json 9 / qq.json 194 / telegram.json 275 / discord.json 1）
RUN_DIR = os.environ.get(
    "M1_RUN_DIR",
    "/Users/cherryai003/HermesRuntime/workspace/user-feedback/feedback-sync/runs/external-a-20261127T0800")
BASELINE = os.environ.get("M1_BASELINE") or ""
BAD_DIR = "/nonexistent-dir"
EXPECT_STAGES = ["STAGE=1 契约前置校验 RC=0", "STAGE=2 身份自检 RC=0", "STAGE=3 行源 RC=0", "STAGE=4 判定 RC=0"]

_passed = 0
_total = 0


def check(name, cond, detail=""):
    global _passed, _total
    _total += 1
    ok = bool(cond)
    if ok:
        _passed += 1
    print(("PASS " if ok else "FAIL ") + name + ((" | " + detail) if detail else ""))
    return ok


def run(args):
    p = subprocess.run([SCRIPT] + args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       universal_newlines=True)
    return p.returncode, p.stdout, p.stderr


def last_line(text):
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


def snapshot(path):
    """目录不存在 → None；存在 → {条目名: (类型, 大小, mtime_ns)}。用来证明「没新建、没改动」。"""
    if not os.path.isdir(path):
        return None
    snap = {}
    for n in sorted(os.listdir(path)):
        full = os.path.join(path, n)
        st = os.lstat(full)
        snap[n] = ("dir" if os.path.isdir(full) else "file", st.st_size, st.st_mtime_ns)
    return snap


def negative():
    print("== 负控: --run %s ==" % BAD_DIR)
    if os.path.exists(BAD_DIR):
        check("neg 前置: %s 不存在" % BAD_DIR, False, "该路径竟存在，负控无效")
        return
    before = snapshot(OUT_TODAY)
    rc, out, err = run(["--run", BAD_DIR, "--baseline", "/nonexistent-baseline.ndjson"])
    after = snapshot(OUT_TODAY)
    check("neg rc==3", rc == 3, "rc=%d" % rc)
    check("neg 最后一行 RUN_M1_RUN_RESULT RC=3", last_line(out).startswith("RUN_M1_RUN_RESULT RC=3 out="),
          last_line(out))
    if before is None:
        check("neg 未新建 out/%s/" % TODAY, after is None, "after=%s" % (sorted(after) if after else after))
    else:
        check("neg out/%s/ 未改动" % TODAY, before == after,
              "before=%d 项 after=%d 项" % (len(before), len(after or {})))
    if err.strip():
        print("neg stderr: " + err.strip()[-300:])


def positive():
    print("== 正控: --run %s --baseline $M1_BASELINE ==" % RUN_DIR)
    if not BASELINE:
        print("SKIP_NO_BASELINE")
        print("（M1_BASELINE 未设置：正控未执行，不计失败）")
        return
    if not os.path.isdir(RUN_DIR):
        check("pos 前置: 窗口目录存在", False, RUN_DIR)
        return
    rc, out, err = run(["--run", RUN_DIR, "--baseline", BASELINE])
    check("pos rc==0", rc == 0, "rc=%d" % rc)
    check("pos stdout 含 RUN_M1_RUN_RESULT RC=0", "RUN_M1_RUN_RESULT RC=0" in out, last_line(out))
    check("pos 最后一行是结果行", last_line(out) == "RUN_M1_RUN_RESULT RC=0 out=out/%s" % TODAY, last_line(out))
    stages = [ln for ln in out.splitlines() if ln.startswith("STAGE=")]
    check("pos 四关各一行 STAGE=n <名称> RC=0", stages == EXPECT_STAGES, " | ".join(stages))
    if rc != 0:
        print("---- run-m1.sh stdout ----\n%s---- stderr ----\n%s" % (out, err))


def main():
    print("SCRIPT=%s" % SCRIPT)
    print("RUN_DIR=%s" % RUN_DIR)
    print("M1_BASELINE=%s" % (BASELINE or "<unset>"))
    # 负控先跑：此时 out/<今天>/ 多半还不存在，能直接验证「未新建」而不只是「未改动」
    negative()
    positive()
    print("TESTS %d/%d" % (_passed, _total))
    return 0 if _passed == _total else 1


if __name__ == "__main__":
    sys.exit(main())
