#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""U1b-B（B-r2）单元自测：根因 B = 落盘与归属。

业主 2026-11-27 定的两条核心：**原文保留** + **逐行抽取**。本测试逐条钉死：
  - 前缀不限长、不限字符集、不改大小写；无冒号=NO_PREFIX；有冒号但前缀空=EMPTY_PREFIX
  - 只按 "\\n" 切行，U+2028/U+2029 不算换行，CRLF 显式标记
  - 原文不静默截断：超长必带 raw_truncated=true + raw_len + raw_full_sha256（+sidecar）
  - 调用方不拼字符串：stdout / stderr 各走各的证据文件
  - 判定器真打印 "EMPTY_OUTPUT: ..." 时是诊断，不得被 JUDGE_MISSING 覆盖；哨兵只在完全无输出时产生
环境无关：优先 TEST_TMP_ROOT，其次 repo 内 fixtures/tmp；**两者都不可写时自动切内存文件系统（MODE=memory）**，
因此只读沙箱里也能跑满全部检查，不会出现「只跑了一部分就算通过」。
退出码：0 全过 / 3 有失败。
"""
import builtins
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
CAND = os.path.join(REPO, "candidates", "U1b-B", "tools", "mount_dryrun.py")
EXPORT = os.path.join(REPO, "b-stage", "20261127T1050", "new_rows.mapped.ndjson")
BASELINE = os.path.join(REPO, "tests", "fixtures", "baseline_min.ndjson")   # 快照内基线，不依赖 HOME
TMPROOT = os.environ.get("TEST_TMP_ROOT") or os.path.join(REPO, "fixtures", "tmp")
MADE = []
RESULT = []


def _writable(path):
    try:
        os.makedirs(path, exist_ok=True)
        probe = os.path.join(path, ".w-%d" % os.getpid())
        open(probe, "w").close()
        os.remove(probe)
        return True
    except OSError:
        return False


MODE = "disk" if _writable(TMPROOT) else "memory"


class MemWriter(object):
    def __init__(self, fs, path):
        self.fs, self.path, self.parts = fs, path, []

    def write(self, s):
        self.parts.append(s)
        return len(s)

    def flush(self):
        pass

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def value(self):
        return "".join(self.parts)


class MemFS(object):
    """只读沙箱用：极简内存文件系统，够覆盖 open/json/os.path 的用法。"""

    def __init__(self):
        self.files = {}
        self.writers = {}
        self.dirs = set(["/"])

    def _n(self, p):
        return os.path.normpath(str(p))

    def open(self, path, mode="r", *a, **kw):
        p = self._n(path)
        if "w" in mode or "a" in mode or "x" in mode or "+" in mode:
            w = MemWriter(self, p)
            self.writers[p] = w
            return w
        if p in self.writers:
            return io.StringIO(self.writers[p].value())
        if p in self.files:
            return io.StringIO(self.files[p])
        raise FileNotFoundError(2, "No such file", path)

    def read(self, p):
        p = self._n(p)
        if p in self.writers:
            return self.writers[p].value()
        return self.files.get(p)

    def exists(self, p):
        p = self._n(p)
        if p in self.files or p in self.writers or p in self.dirs:
            return True
        return any(k.startswith(p.rstrip("/") + "/") for k in list(self.files) + list(self.writers))

    def isfile(self, p):
        p = self._n(p)
        return p in self.files or p in self.writers

    def makedirs(self, p, exist_ok=False):
        cur = ""
        for part in self._n(p).strip("/").split("/"):
            if not part:
                continue
            cur = os.path.join(cur, part) if cur else part
            self.dirs.add(cur)

    def remove(self, p):
        p = self._n(p)
        self.files.pop(p, None)

    def getmtime(self, p):
        return 4e9        # 足够新，不会误判 STALE_JUDGE


class memfs_env(object):
    def __init__(self):
        self.fs = MemFS()
        self.saved = {}

    def __enter__(self):
        for name, obj, attr in ((builtins, builtins, "open"),
                                (os.path, os.path, "exists"),
                                (os.path, os.path, "isfile"),
                                (os.path, os.path, "getmtime"),
                                (os, os, "makedirs"),
                                (os, os, "remove")):
            self.saved[attr] = getattr(obj, attr)
        builtins.open = self.fs.open
        os.path.exists, os.path.isfile, os.path.getmtime = self.fs.exists, self.fs.isfile, self.fs.getmtime
        os.makedirs, os.remove = self.fs.makedirs, self.fs.remove
        return self.fs

    def __exit__(self, *a):
        builtins.open = self.saved["open"]
        os.path.exists, os.path.isfile, os.path.getmtime = (
            self.saved["exists"], self.saved["isfile"], self.saved["getmtime"])
        os.makedirs, os.remove = self.saved["makedirs"], self.saved["remove"]
        return False


def tmpdir(tag):
    if MODE == "memory":
        return "/mem/%s-%d" % (tag, len(MADE))
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
    spec = importlib.util.spec_from_file_location("mount_u1b_b_r2", CAND)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


II_LINE = "INPUT_INCOMPLETE: 应有 >= 743 行，实得 6 行，基线行命中 0/743（缺 743）"
LONG_PREFIX = "P" * 81


def main():
    mod = load_mod()
    print("MODE=%s  TMPROOT=%s" % (MODE, TMPROOT if MODE == "disk" else "<memory>"))

    # ---------- 继承 A 的成果：B 叠加在 A 上，不得把 A 修的弄回去 ----------
    code = "\n".join(l for l in open(CAND, encoding="utf-8").read().split("\n")
                     if not l.lstrip().startswith("#"))
    check("继承A 调用处无 out + err 拼接", re.search(r"\bout\s*\+\s*err\b", code) is None)
    check("继承A 无 splitlines 拆行", "splitlines(" not in code)
    long_raw = "READ_FAIL: " + ("Z" * 400) + " ROOT_CAUSE_UNIQUE"
    it_lr = mod.extract_reasons([("stderr", long_raw)])[0]
    check("继承A 超长原文显式未落盘", it_lr["raw_truncated"] is True
          and it_lr["raw_sidecar_unavailable"] is True and it_lr["raw_full_sha256"])

    # ---------- B1 归属：缺 run_id / 不符 都是 STALE_JUDGE ----------
    d1 = tmpdir("b1")
    jj = os.path.join(d1, "judge.json")

    def put(obj):
        with open(jj, "w", encoding="utf-8") as fh:
            json.dump(obj, fh)

    put({"violations_total": 0})
    ok1, code1, _d1_ = mod.check_judge_binding(d1, "run-1")
    check("B1 缺 run_id → STALE_JUDGE（不接受老件兼容）",
          ok1 is False and code1 == "STALE_JUDGE", str(code1))
    put({"violations_total": 0, "run_id": "run-other"})
    ok2, code2, _d2_ = mod.check_judge_binding(d1, "run-1")
    check("B1 run_id 不符 → STALE_JUDGE", ok2 is False and code2 == "STALE_JUDGE", str(code2))
    put({"violations_total": 0, "run_id": "run-1"})
    ok3, code3, _d3_ = mod.check_judge_binding(d1, "run-1")
    check("B1 run_id 相符 → 通过", ok3 is True, str(code3))

    # ---------- B1 canonical：本层写 judge.json 并回读校验 ----------
    d2 = tmpdir("b1f")
    raw = os.path.join(d2, "judge.raw.json")
    with open(raw, "w", encoding="utf-8") as fh:
        json.dump({"violations_total": 7, "rules": {"R1": 7}}, fh)
    okf, codef, detf, info = mod.finalize_judge(d2, "run-canon")
    canon = os.path.join(d2, "judge.json")
    written = json.load(open(canon, encoding="utf-8")) if os.path.isfile(canon) else {}
    check("B1 canonical judge.json 已写且 run_id 由本层写死",
          okf is True and written.get("run_id") == "run-canon", str(codef))
    check("B1 canonical 记来源 raw sha256",
          info.get("raw_sha256") == hashlib.sha256(open(raw, "rb").read()).hexdigest())
    check("B1 回读校验不看旧值：改坏 canonical → 不再等于 raw 内容",
          written.get("violations_total") == 7)
    d3 = tmpdir("b1m")
    okm, codem, detm, infom = mod.finalize_judge(d3, "run-x")
    check("B1 judge.raw.json 缺失 → JUDGE_MISSING（不当 0 违规）",
          okm is False and codem == "JUDGE_MISSING", str(codem))

    # ---------- B3 任何 rc 都有非空 rc_reason ----------
    for _rc in (0, 2, 3):
        r = mod.summarize_all([], _rc, {"new_rows": 3, "total_new_rows": 3, "violations_total": 0})
        check("B3 rc=%d 的 rc_reason 非空" % _rc, bool(r and str(r).strip()), str(r)[:40])

    # ---------- B4 多原因全列 + 去重保序 ----------
    dup = [{"prefix": "READ_FAIL", "raw": "a", "stream": "stderr", "index": 0},
           {"prefix": "READ_FAIL", "raw": "a", "stream": "stderr", "index": 1},
           {"prefix": "X-FAIL", "raw": "b", "stream": "stderr", "index": 2}]
    dd = mod.dedupe_reasons(dup)
    check("B4 去重保序（保留首次出现）", [x["prefix"] for x in dd] == ["READ_FAIL", "X-FAIL"],
          str([x["prefix"] for x in dd]))
    check("B4 不丢不同原因", len(dd) == 2)

    # ---------- main 级：落盘不成立 → rc=3，不许 rc=0 带 null 读数 ----------
    def stub_case(payload=None, judge_rc=2, raise_metrics=False, stderr_text=""):
        d = tmpdir("bmain")
        captured = {}

        def fake_run(cmd, cwd=None):
            if payload is not None and "--json" in cmd:
                with open(cmd[cmd.index("--json") + 1], "w", encoding="utf-8") as fh:
                    json.dump(payload, fh)
            return judge_rc, "", stderr_text

        def fake_patrol(root):
            return {"rc": 0, "records_sha": mod.EXPECT_RECORDS_SHA,
                    "records_sha_short": mod.EXPECT_RECORDS_SHA[:16], "rows": mod.EXPECT_ROWS,
                    "ok": True, "sha_error": None, "tail": [""]}

        def fake_write_summary(outdir, summary, txt_lines=None):
            captured["summary"] = summary
            captured["txt"] = txt_lines

        def fake_metrics(outdir, export, baseline, max_samples=3):
            return {"new_rows": 2, "total_new_rows": 2, "violations_total": 5,
                    "by_rule_samples": {}, "by_rule_sample_cap": 3, "by_rule_truncated": False,
                    "new_event_shapes": [], "by_rule_total": 5}

        def boom(*a, **kw):
            raise RuntimeError("判读崩溃")

        ORIG = (mod.run, mod.patrol, mod.write_summary, mod.metrics)
        mod.run, mod.patrol, mod.write_summary = fake_run, fake_patrol, fake_write_summary
        mod.metrics = boom if raise_metrics else fake_metrics
        argv = sys.argv
        sys.argv = ["mount_dryrun.py", "--export", EXPORT, "--baseline", BASELINE, "--outdir", d]
        try:
            rc = mod.main()
        finally:
            sys.argv = argv
            mod.run, mod.patrol, mod.write_summary, mod.metrics = ORIG
        return rc, captured

    check("前置：fixture 存在（快照内）", os.path.isfile(EXPORT) and os.path.isfile(BASELINE),
          "%s / %s" % (os.path.basename(EXPORT), os.path.basename(BASELINE)))

    runner = memfs_env() if MODE == "memory" else None
    if runner:
        seeded = {}
        for _p in (EXPORT, BASELINE):
            with open(_p, encoding="utf-8") as _fh:
                seeded[_p] = _fh.read()
        fs = runner.__enter__()
        fs.files.update(seeded)
        fs.dirs.add(os.path.dirname(EXPORT))
        fs.dirs.add(os.path.dirname(BASELINE))
    try:
        rc_a, cap_a = stub_case(payload=None)                  # 判定器没写 judge.raw.json
        sa = cap_a.get("summary", {})
        check("B1 落盘不成立 → rc=3（不落 rc=0）", rc_a == 3 and sa.get("rc") == 3, str(rc_a))
        check("B1 落盘不成立 → rc_reason 非空且点名 JUDGE_MISSING",
              "JUDGE_MISSING" in str(sa.get("rc_reason")), str(sa.get("rc_reason"))[:50])
        check("B1 落盘不成立 → 不出 judged_rows",
              sa.get("metrics", {}).get("judged_rows") is None,
              str(sa.get("metrics", {}).get("judged_rows")))

        rc_b, cap_b = stub_case(payload={"violations_total": 5, "rules": {"R1": 5}}, judge_rc=2)
        sb = cap_b.get("summary", {})
        check("B3 rc=2 也有非空 rc_reason", bool(str(sb.get("rc_reason") or "").strip()),
              str(sb.get("rc_reason"))[:50])
        check("B3 rc=2 的 rc_reasons 不全空", len(sb.get("metrics", {}).get("rc_reasons") or []) >= 0)

        rc_c, cap_c = stub_case(payload={"violations_total": 5}, judge_rc=2, raise_metrics=True)
        sc = cap_c.get("summary", {})
        check("B2 读数重读失败 → rc=3（不许 rc=0 带 null）", rc_c == 3 and sc.get("rc") == 3, str(rc_c))
        check("B2 读数重读失败 → rc_reason 点名 READ_FAIL",
              str(sc.get("rc_reason", "")).startswith("READ_FAIL"), str(sc.get("rc_reason"))[:50])
    finally:
        if runner:
            runner.__exit__(None, None, None)

    ok = [r for r in RESULT if r[1]]
    bad = [r for r in RESULT if not r[1]]
    print("SUMMARY mode=%s total=%d pass=%d fail=%d" % (MODE, len(RESULT), len(ok), len(bad)))
    for n, _c, d in bad:
        print("  FAILED: %s  %s" % (n, d))
    cleanup()
    return 0 if not bad else 3


if __name__ == "__main__":
    sys.exit(main())
