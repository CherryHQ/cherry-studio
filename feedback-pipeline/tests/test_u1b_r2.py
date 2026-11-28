#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""U1b-r2 门禁五条（3 blocking + 3 提级）的自测矩阵。

覆盖：
  B1 前缀放宽：X1: bad / Read_Fail: x / read_fail: x 三种原样带出
  B2 逐行 reasons：多行不合并、four_numbers 缺失为 null（不是 "None"）
  B3 STALE_JUDGE：输出目录预置 judge.json → rc=3 且不出 rc/judged_rows；run_id 不符同样拒
      JUDGE_MISSING：判定器没写 judge.json → rc=3（不得读成 0 违规）
  E1 后置巡检失败不得落 rc=0（桩驱动：patrol 前 OK 后不 OK，判定器输出正常）
  E2 export 不存在 → rc=3 READ_FAIL，不抛栈
  E3 halt 时 summary 必须带 metrics + rc_reason

桩驱动的用例在注释里标注「stub」，真实子进程用例标注「e2e」。
退出码：0 全过 / 3 有失败（只用 0、3）。
"""
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CAND = os.path.join(HERE, "..", "candidates", "U1b", "tools", "mount_dryrun.py")
ROOT = os.path.abspath(os.path.join(HERE, ".."))
RESULT = []


def load_mod():
    spec = importlib.util.spec_from_file_location("mount_dryrun_u1b_r2", CAND)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check(name, cond, detail=""):
    RESULT.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (("  " + detail) if detail else ""))


def main():
    mod = load_mod()

    # ---------- B1 前缀放宽（stub，纯函数） ----------
    for raw, want in (("X1: bad", "X1"), ("Read_Fail: x", "Read_Fail"), ("read_fail: x", "read_fail")):
        items = mod.rc_reasons_from(raw)
        check("B1 前缀原样保留 " + raw, items[0]["prefix"] == want and items[0]["raw"] == raw,
              "got=%r" % (items[0]["prefix"],))
    # `http://…` 不算 reason 前缀（冒号后非空白）
    items = mod.rc_reasons_from("http://example.com:80/x")
    check("B1 反控 http:// 不被当前缀", items[0]["prefix"] == "NO_PREFIX", items[0]["prefix"])

    # ---------- B2 逐行 reasons（stub，纯函数） ----------
    text = ("READ_FAIL: old warning\n"
            "INPUT_INCOMPLETE: 应有 >= 743 行，实得 6 行，基线行命中 0/743（缺 743）\n"
            "X1: 未知前缀样例")
    items = mod.rc_reasons_from(text)
    check("B2 三条各自成项（不合并）", len(items) == 3, "len=%d" % len(items))
    check("B2 顺序与原文一致", [x["prefix"] for x in items] == ["READ_FAIL", "INPUT_INCOMPLETE", "X1"],
          str([x["prefix"] for x in items]))
    four = items[1]["four_numbers"]
    check("B2 四数结构化", four == {"baseline_rows": 743, "export_rows": 6, "baseline_hit": 0,
                                 "baseline_total": 743, "baseline_missing": 743}, str(four))
    check("B2 无四数写 null", items[0]["four_numbers"] is None)
    js = json.dumps(items, ensure_ascii=False)
    check("B2 不出现字符串 None", "None" not in js)
    check("B2 rc_reason 非空且优先已知前缀", mod.summarize_reasons(items).startswith("READ_FAIL"),
          mod.summarize_reasons(items))
    unk = mod.summarize_reasons(mod.rc_reasons_from("X9: whatever"))
    check("B2 未知前缀进 UNMAPPED_REASON 且留原前缀", unk.startswith("UNMAPPED_REASON:X9"), unk)

    # ---------- B3 judge 归属（stub，纯函数） ----------
    tmp = tempfile.mkdtemp(prefix="u1b-r2-b3-")
    ok, code, _ = mod.check_judge_binding(tmp, "run-A")
    check("B3 缺 judge.json → JUDGE_MISSING", (not ok and code == "JUDGE_MISSING"), str(code))
    json.dump({"violations_total": 0, "run_id": "run-OLD"}, open(os.path.join(tmp, "judge.json"), "w"))
    ok, code, _ = mod.check_judge_binding(tmp, "run-A")
    check("B3 run_id 不符 → STALE_JUDGE", (not ok and code == "STALE_JUDGE"), str(code))
    json.dump({"violations_total": 0}, open(os.path.join(tmp, "judge.json"), "w"))
    old = os.path.join(tmp, "judge.json")
    ok, code, _ = mod.check_judge_binding(tmp, "run-A", started_ns=(os.path.getmtime(old) + 100) * 1e9)
    check("B3 mtime 早于本次 → STALE_JUDGE", (not ok and code == "STALE_JUDGE"), str(code))
    shutil.rmtree(tmp)

    # ---------- E2 export 不存在（e2e 子进程） ----------
    outroot = tempfile.mkdtemp(prefix="u1b-r2-e2-")
    p = subprocess.run([sys.executable, "-B", CAND, "--export", "/nonexistent/xx.ndjson",
                        "--baseline", "/nonexistent/base.ndjson", "--out-root", outroot],
                       capture_output=True, text=True)
    check("E2 不存在 → rc=3", p.returncode == 3, "rc=%d" % p.returncode)
    check("E2 无 Traceback", "Traceback" not in (p.stdout + p.stderr), (p.stderr or "")[:80])
    last = sorted(os.listdir(outroot))[-1] if os.listdir(outroot) else None
    s = json.load(open(os.path.join(outroot, last, "summary.json"), encoding="utf-8")) if last else {}
    check("E2 summary 带 rc_reason", str(s.get("rc_reason", "")).startswith("READ_FAIL"), str(s.get("rc_reason"))[:60])

    # ---------- B3 STALE_JUDGE（e2e：--outdir 预置旧 judge.json） ----------
    seed = tempfile.mkdtemp(prefix="u1b-r2-stale-")
    json.dump({"violations_total": 0, "new_rows": 6, "rules": {}},
              open(os.path.join(seed, "judge.json"), "w"))
    export = os.path.join(ROOT, "b-stage", "20261127T1050", "new_rows.mapped.ndjson")
    p = subprocess.run([sys.executable, "-B", CAND, "--export", export, "--baseline", export,
                        "--out-root", outroot, "--outdir", seed], capture_output=True, text=True)
    s = json.load(open(os.path.join(seed, "summary.json"), encoding="utf-8"))
    check("B3 预置旧 judge.json → rc=3 STALE_JUDGE",
          p.returncode == 3 and "STALE_JUDGE" in p.stdout, "rc=%d" % p.returncode)
    check("B3 不出 rc/judged_rows 读数",
          "judged_rows" not in json.dumps(s.get("metrics", {}), ensure_ascii=False),
          json.dumps(s.get("metrics", {}), ensure_ascii=False)[:80])

    # ---------- E1 / E3（stub：替换 patrol / run） ----------
    ORIG_RUN, ORIG_PATROL = mod.run, mod.patrol

    def run_case(pre_ok, post_ok):
        d = tempfile.mkdtemp(prefix="u1b-r2-stub-")
        judged = {"n": 0}

        def fake_run(cmd, cwd=None):
            if "--json" in cmd:
                path = cmd[cmd.index("--json") + 1]
                json.dump({"violations_total": 0, "rows_total": 6, "new_rows": 6,
                           "history_rows": 0, "rules": {}}, open(path, "w"))
                judged["n"] += 1
            return 0, "OK", ""

        state = {"i": 0}

        def fake_patrol(root):
            state["i"] += 1
            ok = pre_ok if state["i"] == 1 else post_ok
            return {"rc": 0 if ok else 3, "records_sha": mod.EXPECT_RECORDS_SHA if ok else "0" * 64,
                    "records_sha_short": (mod.EXPECT_RECORDS_SHA if ok else "0" * 64)[:16],
                    "rows": mod.EXPECT_ROWS if ok else 0, "ok": ok, "sha_error": None, "tail": [""]}

        mod.run = fake_run
        mod.patrol = fake_patrol
        argv = sys.argv
        sys.argv = ["mount_dryrun.py", "--export", export, "--baseline", export, "--outdir", d]
        try:
            rc = mod.main()
        finally:
            sys.argv = argv
        s = json.load(open(os.path.join(d, "summary.json"), encoding="utf-8"))
        # 还原被替换的函数（后续用例还需要真 run）：直接赋值，不 reload（reload 要求模块已入 sys.modules）
        mod.run, mod.patrol = ORIG_RUN, ORIG_PATROL
        return rc, s

    rc, s = run_case(True, False)
    check("E1 后置巡检失败 → rc=3", rc == 3, "rc=%d" % rc)
    check("E1 summary.rc 同步为 3（不落 0）", s.get("rc") == 3, "summary.rc=%r" % (s.get("rc"),))
    check("E1 verdict=UNDECIDABLE", s.get("verdict") == "UNDECIDABLE-无法判定", str(s.get("verdict")))
    check("E1 rc_reason=POST_PATROL_DRIFT", str(s.get("metrics", {}).get("rc_reason", "")).startswith("POST_PATROL_DRIFT"),
          str(s.get("metrics", {}).get("rc_reason"))[:60])

    rc, s = run_case(False, False)
    check("E3 halt rc=3", rc == 3, "rc=%d" % rc)
    check("E3 halt summary 带 metrics", isinstance(s.get("metrics"), dict) and bool(s["metrics"]),
          str(type(s.get("metrics"))))
    check("E3 halt 带 rc_reason", bool(s.get("metrics", {}).get("rc_reason")),
          str(s.get("metrics", {}).get("rc_reason"))[:60])

    bad = [x for x in RESULT if not x[1]]
    print("\nSUMMARY total=%d pass=%d fail=%d" % (len(RESULT), len(RESULT) - len(bad), len(bad)))
    return 0 if not bad else 3


if __name__ == "__main__":
    sys.exit(main())
