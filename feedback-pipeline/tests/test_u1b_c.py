#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""U1b-C 单元自测（根因 C：退出码归一）。

C1 全路径 rc ∈ {0,2,3}：顶层兜底覆盖到 write_summary
C2 argparse 用法错 → rc=3 USAGE_FAIL（rc=2 只保留「判定完成且违规」）
C3 判定器返回 1 或其它 → 归一为 3，并带 READ_FAIL 原因

临时目录优先 TEST_TMP_ROOT；两者都不可写 → TEST_ENV_NOT_WRITABLE。退出码 0 / 3。
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
CAND = os.path.join(REPO, "candidates", "U1b-C", "tools", "mount_dryrun.py")
EXPORT = os.path.join(REPO, "b-stage", "20261127T1050", "new_rows.mapped.ndjson")
BASELINE = os.path.join(os.path.expanduser("~"), "HermesRuntime", "workspace", "user-feedback",
                        "feedback-sync", "reports", "uf003-u2.1-real743-handoff", "real743x34.ndjson")
TMPROOT = os.environ.get("TEST_TMP_ROOT") or os.path.join(REPO, "fixtures", "tmp")
MADE, RESULT = [], []


def tmpdir(tag):
    try:
        os.makedirs(TMPROOT, exist_ok=True)
        probe = os.path.join(TMPROOT, ".w-%d" % os.getpid())
        open(probe, "w").close()
        os.remove(probe)
    except OSError as exc:
        raise SystemExit("TEST_ENV_NOT_WRITABLE: %s (%s)；用 TEST_TMP_ROOT 指向可写目录再跑" % (TMPROOT, exc))
    n = 0
    while True:
        d = os.path.join(TMPROOT, "%s-%d-%d" % (tag, os.getpid(), n))
        if not os.path.exists(d):
            os.makedirs(d)
            MADE.append(d)
            return d
        n += 1


def cleanup():
    for d in MADE:
        shutil.rmtree(d, ignore_errors=True)
    try:
        os.rmdir(TMPROOT)
    except OSError:
        pass


def check(name, cond, detail=""):
    RESULT.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (("  " + detail) if detail else ""))


def load_mod():
    spec = importlib.util.spec_from_file_location("mount_u1b_c", CAND)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def stub(mod, judge_payload, rc, stdout_text="", stderr_text=""):
    ORIG = mod.run, mod.patrol

    def fake_run(cmd, cwd=None):
        if judge_payload is not None and "--json" in cmd:
            with open(cmd[cmd.index("--json") + 1], "w", encoding="utf-8") as fh:
                json.dump(judge_payload, fh, ensure_ascii=False)
        return rc, stdout_text, stderr_text

    def fake_patrol(root):
        return {"rc": 0, "records_sha": mod.EXPECT_RECORDS_SHA,
                "records_sha_short": mod.EXPECT_RECORDS_SHA[:16], "rows": mod.EXPECT_ROWS,
                "ok": True, "sha_error": None, "tail": [""]}

    mod.run, mod.patrol = fake_run, fake_patrol
    return ORIG


def run_main(mod, outdir):
    argv = sys.argv
    sys.argv = ["mount_dryrun.py", "--export", EXPORT, "--baseline", BASELINE, "--outdir", outdir]
    try:
        return mod.main()
    finally:
        sys.argv = argv


def main():
    mod = load_mod()
    check("前置：两 fixture 存在", os.path.isfile(EXPORT) and os.path.isfile(BASELINE))

    # C2 用法错 → rc=3（e2e 子进程），且不是 2
    p = subprocess.run([sys.executable, "-B", CAND, "--export", EXPORT, "--baseline", BASELINE,
                        "--unknown-option"], capture_output=True, text=True)
    check("C2 用法错 → rc=3", p.returncode == 3, "rc=%d" % p.returncode)
    check("C2 打 USAGE_FAIL", "USAGE_FAIL" in p.stdout, p.stdout.strip().splitlines()[:1] and p.stdout.strip().splitlines()[0][:50])
    check("C2 无 Traceback", "Traceback" not in (p.stdout + p.stderr))

    # C2 反控：缺必填参数同样 3
    p2 = subprocess.run([sys.executable, "-B", CAND, "--baseline", BASELINE],
                        capture_output=True, text=True)
    check("C2 缺必填 → rc=3", p2.returncode == 3, "rc=%d" % p2.returncode)

    # C3 判定器 rc=1 → 归一为 3 且带 READ_FAIL 原因
    d1 = tmpdir("c3")
    ORIG = stub(mod, {"violations_total": 0, "new_rows": 6, "rules": {}}, 1,
                stderr_text="some internal failure\n")
    rc1 = run_main(mod, d1)
    mod.run, mod.patrol = ORIG
    s1 = json.load(open(os.path.join(d1, "summary.json"), encoding="utf-8"))
    check("C3 判定器 rc=1 → mount rc=3", rc1 == 3, "rc=%d" % rc1)
    check("C3 summary.judge_rc 记原始 1", s1.get("judge_rc") == 1, str(s1.get("judge_rc")))
    blob = json.dumps(s1.get("metrics", {}).get("rc_reasons", []), ensure_ascii=False)
    check("C3 给出 判定器 rc=1 的原因", "判定器返回 rc=1" in blob, blob[:80])
    check("C3 rc_reason 非空", bool(s1.get("metrics", {}).get("rc_reason")), str(s1.get("metrics", {}).get("rc_reason"))[:50])

    # C3 判定器 rc=4（越界）同样归 3
    d2 = tmpdir("c3b")
    ORIG = stub(mod, {"violations_total": 0, "new_rows": 6, "rules": {}}, 4)
    rc4 = run_main(mod, d2)
    mod.run, mod.patrol = ORIG
    check("C3 越界 rc=4 → mount rc=3", rc4 == 3, "rc=%d" % rc4)

    # C1 兜底：write_summary 抛错也不得 rc=1（早期分支 + 正常分支各测一次）
    d3 = tmpdir("c1")
    ORIG = stub(mod, {"violations_total": 0, "new_rows": 6, "rules": {}}, 0)
    ORIG_WS = mod.write_summary

    def boom(*a, **k):
        raise OSError("disk full (simulated)")

    mod.write_summary = boom
    try:
        rc_ws = run_main(mod, d3)
    finally:
        mod.write_summary = ORIG_WS
    mod.run, mod.patrol = ORIG
    check("C1 write_summary 失败 → rc=3", rc_ws == 3, "rc=%d" % rc_ws)

    d4 = tmpdir("c1b")
    mod.write_summary = boom
    argv = sys.argv
    sys.argv = ["mount_dryrun.py", "--export", "/nonexistent/x.ndjson", "--baseline", BASELINE,
                "--outdir", d4]
    try:
        rc_ear = mod.main()
    finally:
        sys.argv = argv
        mod.write_summary = ORIG_WS
    check("C1 早期分支 write_summary 失败 → rc=3", rc_ear == 3, "rc=%d" % rc_ear)

    # C1 静态：源码里不得出现显式 rc=1 / exit(1)
    src = open(CAND, encoding="utf-8").read()
    bad_tokens = ["return 1", "sys.exit(1)", "SystemExit(1)", "exit(1)"]
    hits = [b for b in bad_tokens if b in src]
    check("C1 源码无 rc=1 出口", not hits, str(hits))

    # C1 全路径实测：正常 0 / 违规 2 / 判定器异常 3 三种都已覆盖
    d5 = tmpdir("c1ok")
    ORIG = stub(mod, {"violations_total": 0, "rows_total": 6, "new_rows": 6, "history_rows": 0,
                      "rules": {}}, 0)
    rc_ok = run_main(mod, d5)
    mod.run, mod.patrol = ORIG
    check("C1 正常路径仍为 0（未被归一化误伤）", rc_ok == 0, "rc=%d" % rc_ok)

    d6 = tmpdir("c1vio")
    ORIG = stub(mod, {"violations_total": 1, "rows_total": 6, "new_rows": 6, "history_rows": 0,
                      "rules": {"r1": [{"x": 1}]}}, 2)
    rc_vio = run_main(mod, d6)
    mod.run, mod.patrol = ORIG
    check("C1 违规路径仍为 2（未被归一化误伤）", rc_vio == 2, "rc=%d" % rc_vio)

    bad = [x for x in RESULT if not x[1]]
    print("\nSUMMARY total=%d pass=%d fail=%d" % (len(RESULT), len(RESULT) - len(bad), len(bad)))
    return 0 if not bad else 3


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        cleanup()
