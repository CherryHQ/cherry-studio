#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tools/window_to_rows.py 正负控（不依赖 pytest）。

运行: python3 -B tests/test_window_to_rows.py
退出码: 0 全过 / 3 有失败；最后一行 TESTS <通过数>/<执行数>。

正控（真实窗口 external-a-20261127T0800 → out/ 之外的临时目录，cwd 设在临时目录以证明不依赖 cwd）:
  rc==0、rows==479（2026-11-27 实测 wecom 9 + qq 194 + telegram 275 + discord 1）、每行可 json.loads、
  行键 = record_id + 34 字段真源快照（逐名逐序）、值全为字符串、身份三字段全非空且 record_id == 来源事件标识、
  record_id 唯一、underived 与文件里的空串格逐字段一致、真实 id 族前缀按渠道对得上、占位只有 Discord 1 行。
负控:
  UF003_CONTRACT_DIR 指向不存在目录 → rc==3 且 --out 不存在；
  UF003_CONTRACT_DIR 未设置          → rc==3、stderr 点名 CONTRACT_DIR_UNSET、stdout 空、--out 不存在；
  只带主件却不给 UF003_CONTRACT_VERSION → rc==3（CONTRACT_VERSION_UNRESOLVED）、--out 不存在。

契约目录：用例从真源 contract/detail-row.v1.11.schema.json + contract/channel-map.json 字节拷贝出「只带主件」
的临时目录（uf003_identity.load_contract() 只认裸主件布局；运行时 contract/ 没有主件），并以
UF003_CONTRACT_VERSION=v1.11 声明版本——这是给「契约目录只带主件」部署用的路径（BRIEF.md 要求在 NOTE 说明）。
被测生成侧的 sha 必须等于 PIN.json 的 pin：行里的身份是它的产出，换了生成侧，这里的实测数字就不再成立。
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOOL = os.path.join(ROOT, "tools", "window_to_rows.py")
PIN = os.path.join(ROOT, "PIN.json")
IDENTITY = os.path.join(ROOT, "uf003_identity.py")
PY = sys.executable

RUN_DIR = os.environ.get(
    "W2R_RUN_DIR",
    "/Users/cherryai003/HermesRuntime/workspace/user-feedback/feedback-sync/runs/external-a-20261127T0800")
SNAPSHOT = (
    "/Users/cherryai003/HermesRuntime/workspace/user-feedback/feedback-sync/reports/"
    "uf003-fields-34-snapshot-20261127.json")
PRIMARY = os.path.join(ROOT, "contract", "detail-row.v1.11.schema.json")
CHANNEL_MAP = os.path.join(ROOT, "contract", "channel-map.json")

EXPECTED_BY_CHANNEL = {"wecom": 9, "qq": 194, "telegram": 275, "discord": 1}   # 实测 2026-11-27
EXPECTED_ROWS = sum(EXPECTED_BY_CHANNEL.values())                                # 479
ALWAYS_DERIVED = ("日报键", "来源渠道", "来源事件标识", "证据", "原始消息ID")         # 本窗口每一行都推导得出
# 来源渠道 → 本窗口实测的 来源事件标识 族前缀（Discord 窗口记录没有 guild，只能是 unknown: 占位）
ID_PREFIX = {"企微": "wc:", "QQ": "qq:", "Telegram": "tg:", "Discord": "unknown:user-feedback-"}
UNKNOWN_PREFIX = "unknown:user-feedback-"

_passed = 0
_total = 0
TMP = None


def check(name, cond, detail=""):
    global _passed, _total
    _total += 1
    ok = bool(cond)
    _passed += int(ok)
    print(("PASS " if ok else "FAIL ") + name + (("  " + detail) if detail else ""))
    return ok


def sha16(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def under(path, root):
    p, r = os.path.realpath(path), os.path.realpath(root)
    return p == r or p.startswith(r + os.sep)


def run_tool(out, contract_dir, version, run_dir=RUN_DIR):
    """子进程跑工具：环境里先摘掉两个契约变量再按参数显式给；cwd 设在临时目录。"""
    env = {k: v for k, v in os.environ.items()
           if k not in ("UF003_CONTRACT_DIR", "UF003_CONTRACT_VERSION")}
    if contract_dir is not None:
        env["UF003_CONTRACT_DIR"] = contract_dir
    if version is not None:
        env["UF003_CONTRACT_VERSION"] = version
    p = subprocess.run([PY, "-B", TOOL, "--run", run_dir, "--out", out],
                       capture_output=True, text=True, env=env, cwd=TMP)
    return p.returncode, p.stdout, p.stderr


def last_json(stdout):
    lines = [ln for ln in stdout.splitlines() if ln.strip()]
    return json.loads(lines[-1]) if lines else None


def make_contract_view():
    """只带主件的契约目录（真源字节拷贝）。负控也要用它，所以必须在两组用例之前建好一次。"""
    cv = os.path.join(TMP, "contract")
    os.makedirs(cv)
    shutil.copyfile(PRIMARY, os.path.join(cv, "detail-row.schema.json"))
    shutil.copyfile(CHANNEL_MAP, os.path.join(cv, "channel-map.json"))
    return cv


def positive(cv):
    # 被测生成侧必须是 PIN 的那一份（行里的身份是它的产出）
    try:
        want = next(p["sha256"] for p in json.load(open(PIN, encoding="utf-8"))["pins"]
                    if p["path"] == "uf003_identity.py")
        got = sha16(IDENTITY)
        check("前置: 生成侧 sha256 == PIN.json", got == want, "got=%s want=%s" % (got[:16], want[:16]))
    except (OSError, ValueError, StopIteration, KeyError) as exc:
        check("前置: 生成侧 sha256 == PIN.json", False, "%s: %s" % (type(exc).__name__, exc))
    check("前置: 真实窗口目录存在", os.path.isdir(os.path.join(RUN_DIR, "raw")), RUN_DIR)

    out = os.path.join(TMP, "rows.ndjson")
    rc, stdout, stderr = run_tool(out, cv, "v1.11")
    check("pos rc==0", rc == 0, "rc=%d stderr=%s" % (rc, stderr[-300:]))

    s = last_json(stdout) if rc == 0 else None
    check("pos stdout 最后一行是汇总 JSON", isinstance(s, dict), repr(stdout[-120:]))
    if not s:
        return
    for k in ("ok", "rows", "by_channel", "underived", "blocked_rows", "out", "missing"):
        check("pos 汇总含 %s" % k, k in s)
    check("pos ok is True / blocked_rows==0", s.get("ok") is True and s.get("blocked_rows") == 0,
          "ok=%r blocked_rows=%r" % (s.get("ok"), s.get("blocked_rows")))
    check("pos rows==%d（实测 9+194+275+1）" % EXPECTED_ROWS, s.get("rows") == EXPECTED_ROWS, "rows=%r" % (s.get("rows"),))
    check("pos by_channel 逐渠道等于实测", s.get("by_channel") == EXPECTED_BY_CHANNEL, repr(s.get("by_channel")))
    check("pos missing==[]（四个渠道文件都在）", s.get("missing") == [], repr(s.get("missing")))
    check("pos out 即传入路径，且在 out/ 之外", s.get("out") == out and not under(out, os.path.join(ROOT, "out")), repr(s.get("out")))
    check("pos --out 文件已写出", os.path.isfile(out))

    rows, bad_json = [], 0
    with open(out, encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.strip()
            if not ln:
                continue
            try:
                rows.append(json.loads(ln))
            except ValueError:
                bad_json += 1
    check("pos 每行都能 json.loads", bad_json == 0 and len(rows) == s.get("rows"),
          "parsed=%d bad=%d" % (len(rows), bad_json))

    # 34 字段真源快照：逐名逐序
    try:
        names = [f["name"] for f in json.load(open(SNAPSHOT, encoding="utf-8"))["fields"]]
        check("前置: 34 字段快照可读且恰 34 个", len(names) == 34, SNAPSHOT)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        names = None
        check("前置: 34 字段快照可读且恰 34 个", False, "%s: %s" % (type(exc).__name__, exc))
    if names:
        want_keys = ["record_id"] + names
        shape_bad = sum(1 for r in rows if list(r.keys()) != want_keys)
        check("pos 每行键 = record_id + 34 字段（逐名逐序）", rows and shape_bad == 0, "shape_bad=%d" % shape_bad)
    check("pos 每行值全为字符串", all(isinstance(v, str) for r in rows for v in r.values()))

    id_empty = sum(1 for r in rows if not all(r[f] for f in ("record_id", "来源渠道", "来源事件标识")))
    check("pos 身份三字段全非空", rows and id_empty == 0, "empty=%d" % id_empty)
    check("pos record_id == 来源事件标识（写前临时行标识）", all(r["record_id"] == r["来源事件标识"] for r in rows))
    check("pos record_id 唯一", len({r["record_id"] for r in rows}) == len(rows))

    # underived：汇总里的计数必须等于文件里该字段的空串格数
    recomputed = {f: sum(1 for r in rows if r.get(f) == "") for f in (names or [])}
    recomputed = {f: c for f, c in recomputed.items() if c}
    check("pos underived 与文件空串格逐字段一致", s.get("underived") == recomputed,
          "summary=%d 字段 / file=%d 字段" % (len(s.get("underived") or {}), len(recomputed)))
    if names:
        derived = set(names) - set(recomputed)
        check("pos 本窗口每行都推导得出的字段恰为 %s" % (ALWAYS_DERIVED,), derived == set(ALWAYS_DERIVED),
              repr(sorted(derived)))

    # 身份族：真实 id 的前缀按渠道对得上；占位只有 Discord 1 行
    fam_bad = [r["来源事件标识"][:40] for r in rows if not r["来源事件标识"].startswith(ID_PREFIX[r["来源渠道"]])]
    check("pos 来源事件标识 族前缀按渠道对得上", not fam_bad, repr(fam_bad[:3]))
    ph = [r for r in rows if r["来源事件标识"].startswith(UNKNOWN_PREFIX)]
    check("pos 占位恰 1 行且为 Discord（窗口记录无 guild）", len(ph) == 1 and ph[0]["来源渠道"] == "Discord"
          and s.get("placeholder_rows") == 1, "placeholder_rows=%r" % (s.get("placeholder_rows"),))
    check("pos 占位 行号=479、轮次=0800、批次=20261127（取自 run 目录名）",
          bool(ph) and ph[0]["来源事件标识"] == UNKNOWN_PREFIX + "20261127#0800:479",
          repr(ph[0]["来源事件标识"]) if ph else "无占位行")


def negative(cv):
    out = os.path.join(TMP, "neg.ndjson")

    rc, stdout, stderr = run_tool(out, os.path.join(TMP, "does-not-exist"), "v1.11")
    check("neg 契约目录不存在 → rc==3", rc == 3, "rc=%d" % rc)
    check("neg 契约目录不存在 → --out 不存在", not os.path.exists(out))
    check("neg 契约目录不存在 → stderr 点名 CONTRACT_DIR_MISSING", "CONTRACT_DIR_MISSING" in stderr, repr(stderr[:120]))

    rc, stdout, stderr = run_tool(out, None, None)
    check("neg UF003_CONTRACT_DIR 未设置 → rc==3", rc == 3, "rc=%d" % rc)
    check("neg 未设置 → stderr 点名 CONTRACT_DIR_UNSET", "CONTRACT_DIR_UNSET" in stderr, repr(stderr[:120]))
    check("neg 未设置 → stdout 空、--out 不存在", stdout.strip() == "" and not os.path.exists(out))

    rc, stdout, stderr = run_tool(out, cv, None)
    check("neg 只带主件无 UF003_CONTRACT_VERSION → rc==3", rc == 3, "rc=%d" % rc)
    check("neg 无版本 → stderr 点名 CONTRACT_VERSION_UNRESOLVED",
          "CONTRACT_VERSION_UNRESOLVED" in stderr, repr(stderr[:160]))
    check("neg 无版本 → --out 不存在", not os.path.exists(out))

    leftovers = [f for f in os.listdir(TMP) if f.startswith(".window_to_rows.")]
    check("neg 临时目录无 .window_to_rows.* 残留", not leftovers, repr(leftovers))


def main():
    global TMP
    print("TOOL=%s" % TOOL)
    print("RUN_DIR=%s" % RUN_DIR)
    TMP = tempfile.mkdtemp(prefix="w2r-test.")
    print("TMP=%s（out/ 之外）" % TMP)
    try:
        cv = make_contract_view()
        negative(cv)   # 负控先跑：此时 --out 还不存在，能直接验证「未创建」而不是「未改动」
        positive(cv)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    print("TESTS %d/%d" % (_passed, _total))
    return 0 if _passed == _total else 3


if __name__ == "__main__":
    sys.exit(main())
