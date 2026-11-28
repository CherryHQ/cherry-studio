#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""S2 套件（只读）：生成器 v1.13 出件 → 身份自检 → 跨步骤字节绑定核对 → 五契约版本变异负控。

用法:
  python3 -B tools/s2_suite.py [--identity P] [--generator P] [--binder P] [--fixture DIR] [--versions LIST]
                               [--gen-contract-dir DIR] [--identity-contract-version V] [--identity-contract-dir DIR]
                               [--scratch DIR] [--keep]
  环境变量覆盖：M1DIR S1DIR PY S1_IDENTITY S2_FIXTURE

六个步骤与判据（业主拆单原文，一条不放宽；任一不满足 → ok=0）:
  1 fixture：cp -Rc <fixture> $TMP/s2win（raw/<渠道>.json ×4；套件独立算每份字节 sha256）
    单上写 cp -c；macOS BSD cp 复制目录必须 -R（否则 "is a directory (not copied)"），-c 仍是 APFS clonefile，按实际参数改。
  2 生成器：python3 -B tools/window_to_rows.py --run $TMP/s2win --out $TMP/rows.ndjson --contract-version v1.13
    要 rc=0 且行数>0；stdout 汇总原样落 $TMP/gen.json；另核 gen.rows == ndjson 行数、gen.used_bytes_sha256 == 步骤 1 独立 sha。
  3 身份自检：python3 -B $S1DIR/s1_identity.py --selfcheck --run $TMP/s2win --json $TMP/self.json，要 rc=0 且报告可解析。
    argparse 实参（读脚本确认）：--run / --selfcheck / --per-source / --allow-qq-candidate / --json / --fixture-demo。
    契约目录：默认在 $TMP/contract 建 v1.13 flat 视图（detail-row.<ver>.schema.json → detail-row.schema.json，连同 channel-map.json
    均 cp -c 自 release/m1/contract 并核 sha），经 UF003_CONTRACT_DIR / UF003_CONTRACT_VERSION 传入（脚本默认探测位在本机不存在）。
    UF003_WECOM_DB / UF003_QQ_DB / UF003_DISCORD_SCOPE 指向 $TMP/unavailable/ 下不存在的路径（r13c audit.py 同款隔离），自检只依赖夹具。
  4 绑定核对：python3 -B tools/bind_check.py --selfcheck $TMP/self.json --gen $TMP/gen.json，要 rc=0 且恰 4 行 BINDING_OK（wecom/qq/telegram/discord）。
  5 负控：v1.9/v1.10/v1.11/v1.12/v1.13 各一次（v1.13 即步骤 2 那一次）：该版本生成器出件 → 先证未变异报告 bind rc=0（配对正控）
    → 复制为 gen-mut-<ver>.json，改一个渠道（四渠道轮换）used_bytes_sha256 首字符 +1（仍是 64 位小写十六进制，保证被拒原因是字节不等
    而非格式坏）→ 同一 bind_check 要 rc=3 且无 BINDING_OK。生成器在该版本出不了合法报告、或配对正控不绿、或无 self.json
    → 该版本 INCONCLUSIVE，不计入 neg（空文件被拒不算负控通过）。
  6 末行：S2_SUMMARY ok=<0|1> rows=<n> channels=<n> neg=<x>/5

退出码: 0 = ok=1；1 = 判据不过；2 = 依赖缺失/用法错；3 = 套件内部异常。任何路径末行都是 S2_SUMMARY。
只读: 除 $TMP（mktemp -d，默认建在 ~/HermesRuntime/cache/scratch/，不存在则系统 tmp）外不写任何文件；
      子进程一律 python3 -B + PYTHONDONTWRITEBYTECODE=1，不往 tools/ 或 S1DIR 落 __pycache__。
$TMP: ok=1 且未 --keep → 删除（只删本次 mkdtemp 建的目录）；否则保留并打印 S2_TMP_KEEP 供取证。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

CHANNELS = ("wecom", "qq", "telegram", "discord")          # 与 tools/bind_check.py CHANNELS 同组、同序
VERSIONS = ("v1.9", "v1.10", "v1.11", "v1.12", "v1.13")
GEN_VERSION = "v1.13"                                        # 步骤 2 的契约版本
SHA_RE = re.compile(r"[0-9a-f]{64}\Z")
HOME = os.path.expanduser("~")
M1DIR_DEFAULT = os.path.join(HOME, "HermesRuntime", "release", "m1")
S1DIR_DEFAULT = os.path.join(HOME, "HermesRuntime", "codex-tasks", "uf003-gate7-20261128", "_run")
FIXTURE_DEFAULT = os.path.join(HOME, "HermesRuntime", "codex-tasks", "r13c-review-20261128",
                               "_run", "fixtures", "full-20261127T0800")
SCRATCH_DEFAULT = os.path.join(HOME, "HermesRuntime", "cache", "scratch")
SUB_TIMEOUT = 600          # 单个子进程上限（秒）；原单 1800s 看门狗
ECHO_MAX = 40              # 每个子进程每路输出最多回显行数


def say(line: str = "") -> None:
    print(line, flush=True)


def echo(tag: str, text: str) -> None:
    """回显子进程输出，每行加标签前缀；超限截断并标明。"""
    lines = text.rstrip("\n").split("\n") if text and text.strip() else []
    for ln in lines[:ECHO_MAX]:
        say("  %s| %s" % (tag, ln.rstrip()))
    if len(lines) > ECHO_MAX:
        say("  %s| ... (%d lines total, %d echoed)" % (tag, len(lines), ECHO_MAX))


def echo1(tag: str, text: str) -> None:
    """只回显首个非空行（负控用的 bind 输出）。"""
    for ln in (text or "").split("\n"):
        if ln.strip():
            say("  %s| %s" % (tag, ln.rstrip()))
            return


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def first_tag(text: str) -> str:
    """stderr 首行的标签：有 ':' 取冒号前（CONTRACT_ID_MISMATCH: …），否则取首个词（INFO/WARN 行），空则 '-'。"""
    for ln in (text or "").split("\n"):
        if ln.strip():
            head = ln.strip().split(":")[0].strip()
            return (head if ":" in ln else (head.split() or ["-"])[0])[:60] or "-"
    return "-"


def dec(b: bytes) -> str:
    return (b or b"").decode("utf-8", "backslashreplace")


class Proc(object):
    __slots__ = ("cmd", "rc", "out_b", "err_b", "timeout")

    def __init__(self, cmd, rc, out_b, err_b, timeout=False):
        self.cmd, self.rc, self.out_b, self.err_b, self.timeout = cmd, rc, out_b or b"", err_b or b"", timeout

    @property
    def out(self) -> str:
        return dec(self.out_b)

    @property
    def err(self) -> str:
        return dec(self.err_b)

    @property
    def cmdline(self) -> str:
        return shlex.join(self.cmd)


def run(cmd, env=None, cwd=None) -> Proc:
    say("$ %s" % shlex.join(cmd))
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd=cwd, timeout=SUB_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        return Proc(cmd, 124, exc.stdout, exc.stderr, True)
    except OSError as exc:                   # 可执行文件不存在等
        return Proc(cmd, 127, b"", ("%s: %s" % (type(exc).__name__, exc)).encode("utf-8"))
    return Proc(cmd, p.returncode, p.stdout, p.stderr)


def load_json_strict(path: str):
    """严格 UTF-8 + 拒重复键（与 bind_check._load_json 同口径）；任何问题抛异常，由调用方归为「报告不可用」。"""
    with open(path, "rb") as fh:
        raw = fh.read()

    def _no_dup(pairs):
        obj = {}
        for k, v in pairs:
            if k in obj:
                raise ValueError("DUPLICATE_KEY %s" % k)
            obj[k] = v
        return obj

    return json.loads(raw.decode("utf-8"), object_pairs_hook=_no_dup)


def try_load(path: str):
    """能读就返回对象，否则 None（并在 stderr 不留痕；原因由调用方按文件状态打印）。"""
    try:
        return load_json_strict(path)
    except Exception:        # noqa: BLE001
        return None


def gen_sha_table(doc) -> tuple:
    """gen 报告 → ({渠道: sha}, [错误…])。口径同 bind_check._sha_from_gen：键去 .json 后缀；只认四个规范渠道；
    值为 64 位小写十六进制字符串，或含 used_bytes_sha256 的非空对象。"""
    errs, table = [], {}
    if not isinstance(doc, dict) or not isinstance(doc.get("used_bytes_sha256"), dict):
        return {}, ["used_bytes_sha256 对象缺失"]
    norm = {}
    for key in doc["used_bytes_sha256"]:
        if not isinstance(key, str):
            errs.append("键不是字符串")
            continue
        ch = key[:-5] if key.endswith(".json") else key
        if ch in norm:
            errs.append("BINDING_KEY_COLLISION %s" % ch)
            continue
        norm[ch] = key
    for ch, raw in norm.items():
        if ch not in CHANNELS:
            errs.append("非规范渠道名 %s" % ch)
            continue
        v = doc["used_bytes_sha256"][raw]
        sha = v if isinstance(v, str) else (v.get("used_bytes_sha256") if isinstance(v, dict) and v else None)
        if not (isinstance(sha, str) and SHA_RE.match(sha)):
            errs.append("%s 值不是 64 位小写十六进制" % ch)
            continue
        table[ch] = sha
    return table, errs


def flip_first_hex(sha: str) -> str:
    """首字符 +1（mod 16），仍为小写十六进制：c→d、9→a、f→0。"""
    return "%x%s" % ((int(sha[0], 16) + 1) % 16, sha[1:])


def binding_ok_lines(text: str) -> list:
    return [ln.split()[1] for ln in (text or "").split("\n") if ln.startswith("BINDING_OK ") and len(ln.split()) >= 2]


class _SummarizingParser(argparse.ArgumentParser):
    """用法错也保证末行 S2_SUMMARY（rc=2），不让 run_s123.sh 看到没有结论行的输出。"""

    def error(self, message):      # noqa: D401
        say("S2_USAGE %s" % message)
        say("S2_SUMMARY ok=0 rows=0 channels=0 neg=0/%d" % len(VERSIONS))
        sys.exit(2)


def parse_args(argv):
    ap = _SummarizingParser(description="S2 套件：生成器 v1.13 出件 + 身份自检 + bind_check + 五版本变异负控（只读）",
                            formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--m1dir", default=os.environ.get("M1DIR") or M1DIR_DEFAULT)
    ap.add_argument("--s1dir", default=os.environ.get("S1DIR") or S1DIR_DEFAULT)
    ap.add_argument("--python", default=os.environ.get("PY") or "python3")
    ap.add_argument("--identity", default=os.environ.get("S1_IDENTITY") or None,
                    help="身份自检脚本（默认 $S1DIR/s1_identity.py；换被测件时须在日志里按 S2_DEP 行核对 sha）")
    ap.add_argument("--generator", default=None, help="默认 $M1DIR/tools/window_to_rows.py")
    ap.add_argument("--binder", default=None, help="默认 $M1DIR/tools/bind_check.py")
    ap.add_argument("--fixture", default=os.environ.get("S2_FIXTURE") or FIXTURE_DEFAULT, help="采集窗口夹具目录（含 raw/<渠道>.json）")
    ap.add_argument("--versions", default=",".join(VERSIONS), help="负控契约版本列表（逗号分隔，默认 v1.9…v1.13）")
    ap.add_argument("--gen-contract-dir", default=None,
                    help="生成器契约目录；默认不设（并清掉继承的 UF003_CONTRACT_DIR/VERSION，让生成器用其文档默认 = 仓库 contract/）")
    ap.add_argument("--identity-contract-version", default=GEN_VERSION, help="身份自检的契约版本（默认 v1.13）")
    ap.add_argument("--identity-contract-dir", default=None,
                    help="直接指定身份自检契约目录（须 flat 名 detail-row.schema.json）；给了就不建 v1.13 flat 视图")
    ap.add_argument("--scratch", default=SCRATCH_DEFAULT, help="mktemp -d 的父目录（默认 ~/HermesRuntime/cache/scratch/）")
    ap.add_argument("--keep", action="store_true", help="ok=1 时也保留 $TMP")
    return ap.parse_args(argv)


def _deps(identity, generator, binder, fixture, contract_sources) -> list:
    """打印每个依赖的路径 + sha（TESTING_WRONG_TARGET 纪律：被测件是哪份、什么 sha，日志里可核）。返回缺失项。"""
    missing = []
    items = [("identity", identity), ("generator", generator), ("binder", binder)] + contract_sources
    for name, path in items:
        if os.path.isfile(path):
            with open(path, "rb") as fh:
                data = fh.read()
            say("S2_DEP %s path=%s sha256=%s size=%d lines=%d"
                % (name, path, hashlib.sha256(data).hexdigest()[:16], len(data), len(data.splitlines())))
        else:
            say("S2_DEP_MISSING %s path=%s" % (name, path))
            missing.append(name)
    if os.path.isdir(fixture):
        say("S2_DEP fixture path=%s type=dir" % fixture)
    else:
        say("S2_DEP_MISSING fixture path=%s" % fixture)
        missing.append("fixture")
    return missing


def _run_all(a, versions, m1dir, identity, generator, binder, fixture, tmp, st) -> int:
    py = a.python
    s2win = os.path.join(tmp, "s2win")
    gen_json = os.path.join(tmp, "gen.json")
    rows_out = os.path.join(tmp, "rows.ndjson")
    self_json = os.path.join(tmp, "self.json")

    # 身份自检的契约来源（默认 release 的 v1.13 版本化件 + channel-map，复制成 flat 视图）
    id_ver = a.identity_contract_version
    contract_dir = os.path.abspath(a.identity_contract_dir) if a.identity_contract_dir else None
    contract_sources = [] if contract_dir else [
        ("contract_schema", os.path.join(m1dir, "contract", "detail-row.%s.schema.json" % id_ver)),
        ("contract_map", os.path.join(m1dir, "contract", "channel-map.json")),
    ]
    missing = _deps(identity, generator, binder, fixture, contract_sources)
    if missing:
        say("S2_STEPS deps_missing=%s" % ",".join(missing))
        return 2

    env_base = os.environ.copy()
    env_base["PYTHONDONTWRITEBYTECODE"] = "1"
    env_base["PYTHONIOENCODING"] = "utf-8"
    gen_env = dict(env_base)
    gen_env.pop("UF003_CONTRACT_DIR", None)             # 生成器：按其文档默认（仓库 contract/）+ --contract-version，不吃继承环境
    gen_env.pop("UF003_CONTRACT_VERSION", None)
    if a.gen_contract_dir:
        gen_env["UF003_CONTRACT_DIR"] = os.path.abspath(a.gen_contract_dir)
    failed = []

    # ---- 1 fixture ----
    p = run(["cp", "-Rc", fixture, s2win], env=env_base, cwd=tmp)
    echo("cp.err", p.err)
    sha = {}
    for ch in CHANNELS:
        fp = os.path.join(s2win, "raw", ch + ".json")
        if os.path.isfile(fp):
            sha[ch] = sha256_file(fp)
    ok1 = p.rc == 0 and len(sha) == len(CHANNELS)
    say("S2_STEP1 fixture cp_rc=%s files=%d/%d %s -> %s"
        % (p.rc, len(sha), len(CHANNELS), " ".join("%s=%s" % (c, sha[c][:16]) for c in CHANNELS if c in sha), "PASS" if ok1 else "FAIL"))
    if not ok1:
        failed.append("step1")

    # ---- 2 生成器 ----
    p = run([py, "-B", generator, "--run", s2win, "--out", rows_out, "--contract-version", GEN_VERSION], env=gen_env, cwd=tmp)
    with open(gen_json, "wb") as fh:                    # stdout 原样落盘（单上「汇总落 $TMP/gen.json」）
        fh.write(p.out_b)
    rows = 0
    if os.path.isfile(rows_out):
        with open(rows_out, "rb") as fh:
            rows = sum(1 for ln in fh.read().splitlines() if ln.strip())
    doc = try_load(gen_json)
    gen_rows = doc.get("rows") if isinstance(doc, dict) else None
    table, terrs = gen_sha_table(doc) if doc is not None else ({}, ["no_report"])
    sha_match = sum(1 for c in CHANNELS if table.get(c) == sha.get(c) and c in sha)
    ok2 = (p.rc == 0 and rows > 0 and gen_rows == rows and sha_match == len(CHANNELS)
           and isinstance(doc, dict) and doc.get("ok") is True)
    st["rows"] = rows
    say("S2_STEP2 generator rc=%s rows=%d gen_rows=%s gen_ok=%s blocked=%s sha_match=%d/%d tag=%s -> %s"
        % (p.rc, rows, gen_rows, doc.get("ok") if isinstance(doc, dict) else None,
           doc.get("blocked_rows") if isinstance(doc, dict) else None, sha_match, len(CHANNELS), first_tag(p.err),
           "PASS" if ok2 else "FAIL"))
    echo("gen.err", p.err)
    gen_rc, gen_tag = p.rc, first_tag(p.err)
    if not ok2:
        failed.append("step2")

    # ---- 3 身份自检 ----
    if contract_dir is None:
        view = os.path.join(tmp, "contract")
        os.makedirs(view)
        facts = []
        for src in (contract_sources[0][1], contract_sources[1][1]):
            dst = os.path.join(view, "detail-row.schema.json" if src.endswith(".schema.json") else os.path.basename(src))
            cp = run(["cp", "-c", src, dst], env=env_base, cwd=tmp)
            s_src, s_dst = sha256_file(src), (sha256_file(dst) if cp.rc == 0 and os.path.isfile(dst) else None)
            facts.append("%s=%s%s" % (os.path.basename(dst), (s_dst or "MISSING")[:16], "" if s_src == s_dst else "!=src"))
        contract_dir = view
        say("S2_CONTRACT view=%s version=%s %s" % (contract_dir, id_ver, " ".join(facts)))
    unavailable = os.path.join(tmp, "unavailable")
    os.makedirs(unavailable, exist_ok=True)
    id_env = dict(env_base)
    id_env["UF003_CONTRACT_DIR"] = contract_dir
    id_env["UF003_CONTRACT_VERSION"] = id_ver
    id_env["UF003_WECOM_DB"] = os.path.join(unavailable, "wecom.db")
    id_env["UF003_QQ_DB"] = os.path.join(unavailable, "qq.db")
    id_env["UF003_DISCORD_SCOPE"] = os.path.join(unavailable, "discord.json")
    if os.path.lexists(self_json):
        os.remove(self_json)                             # 只清 $TMP 内上一次可能残留的同名文件
    p = run([py, "-B", identity, "--selfcheck", "--run", s2win, "--json", self_json], env=id_env, cwd=tmp)
    self_doc = try_load(self_json) if os.path.isfile(self_json) else None
    checks = self_doc.get("checks") if isinstance(self_doc, dict) else None
    n_checks = len(checks) if isinstance(checks, list) else 0
    n_sha = sum(1 for c in checks if isinstance(c, dict) and isinstance(c.get("used_bytes_sha256"), str)
                and SHA_RE.match(c["used_bytes_sha256"])) if isinstance(checks, list) else 0
    ok3 = p.rc == 0 and isinstance(self_doc, dict) and n_checks > 0
    say("S2_STEP3 identity rc=%s self_json=%s checks=%d used_bytes_sha256=%d rc_reason=%s tag=%s -> %s"
        % (p.rc, "ok" if isinstance(self_doc, dict) else "unavailable", n_checks, n_sha,
           (self_doc.get("rc_reason") if isinstance(self_doc, dict) else None), first_tag(p.err), "PASS" if ok3 else "FAIL"))
    echo("self.err", p.err)
    if not ok3:
        failed.append("step3")

    # ---- 4 绑定核对（正控）----
    if self_doc is not None and doc is not None:
        p = run([py, "-B", binder, "--selfcheck", self_json, "--gen", gen_json], env=env_base, cwd=tmp)
        oks = binding_ok_lines(p.out)
        st["channels"] = len(oks)
        ok4 = p.rc == 0 and oks == list(CHANNELS)
        echo("bind.out", p.out)
        echo("bind.err", p.err)
        say("S2_STEP4 bind rc=%s binding_ok=%d/%d -> %s" % (p.rc, len(oks), len(CHANNELS), "PASS" if ok4 else "FAIL"))
    else:
        ok4 = False
        say("S2_STEP4 bind skipped (%s) -> FAIL" % ("self.json unavailable" if self_doc is None else "gen.json unavailable"))
    if not ok4:
        failed.append("step4")

    # ---- 5 五版本变异负控 ----
    for i, ver in enumerate(versions):
        if ver == GEN_VERSION:
            base, rc_v, tag_v = gen_json, gen_rc, gen_tag        # 「各一次」：v1.13 这一次就是步骤 2
        else:
            base = os.path.join(tmp, "gen-%s.json" % ver)
            p = run([py, "-B", generator, "--run", s2win, "--out", os.path.join(tmp, "rows-%s.ndjson" % ver),
                     "--contract-version", ver], env=gen_env, cwd=tmp)
            with open(base, "wb") as fh:
                fh.write(p.out_b)
            rc_v, tag_v = p.rc, first_tag(p.err)
        bdoc = try_load(base) if os.path.isfile(base) and os.path.getsize(base) > 0 else None
        btable, berrs = gen_sha_table(bdoc) if bdoc is not None else ({}, ["no_report"])
        if bdoc is None or berrs or set(btable) != set(CHANNELS):
            say("S2_NEG %s INCONCLUSIVE generator_rc=%s tag=%s reason=no_valid_gen_report%s -> not counted"
                % (ver, rc_v, tag_v, "" if bdoc is None else " (%s)" % "; ".join(berrs)))
            continue
        if self_doc is None:
            say("S2_NEG %s INCONCLUSIVE generator_rc=%s reason=no_selfcheck -> not counted" % (ver, rc_v))
            continue
        p = run([py, "-B", binder, "--selfcheck", self_json, "--gen", base], env=env_base, cwd=tmp)
        if not (p.rc == 0 and binding_ok_lines(p.out) == list(CHANNELS)):
            echo1("pos.out", p.out)
            echo1("pos.err", p.err)
            say("S2_NEG %s INCONCLUSIVE generator_rc=%s reason=positive_control_not_green bind_rc=%s -> not counted" % (ver, rc_v, p.rc))
            continue
        ch = CHANNELS[i % len(CHANNELS)]
        raw_key = next(k for k in bdoc["used_bytes_sha256"] if (k[:-5] if k.endswith(".json") else k) == ch)
        old = btable[ch]
        new = flip_first_hex(old)
        mut = os.path.join(tmp, "gen-mut-%s.json" % ver)
        shutil.copyfile(base, mut)                       # 单上「复制 gen.json 为 gen-mut-<ver>.json」
        val = bdoc["used_bytes_sha256"][raw_key]
        if isinstance(val, dict):
            val["used_bytes_sha256"] = new
        else:
            bdoc["used_bytes_sha256"][raw_key] = new
        with open(mut, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(bdoc, ensure_ascii=False, indent=1) + "\n")
        p = run([py, "-B", binder, "--selfcheck", self_json, "--gen", mut], env=env_base, cwd=tmp)
        oks = binding_ok_lines(p.out)
        passed = p.rc == 3 and not oks and SHA_RE.match(new) is not None and new != old
        echo1("mut.out", p.out)
        echo1("mut.err", p.err)
        if passed:
            st["neg"] += 1
        say("S2_NEG %s channel=%s %s->%s gen_contract_version=%s bind_rc=%s binding_ok=%d -> %s"
            % (ver, ch, old[:16], new[:16], bdoc.get("contract_version"), p.rc, len(oks), "PASS" if passed else "FAIL"))

    ok = ok1 and ok2 and ok3 and ok4 and st["neg"] == len(versions)
    say("S2_STEPS step1=%d step2=%d step3=%d step4=%d neg=%d/%d%s"
        % (ok1, ok2, ok3, ok4, st["neg"], len(versions), (" failed=" + ",".join(failed)) if failed else ""))
    return 0 if ok else 1


def main(argv=None) -> int:
    a = parse_args(argv)
    versions = [v.strip() for v in a.versions.split(",") if v.strip()]
    m1dir, s1dir = os.path.abspath(a.m1dir), os.path.abspath(a.s1dir)
    identity = os.path.abspath(a.identity or os.path.join(s1dir, "s1_identity.py"))
    generator = os.path.abspath(a.generator or os.path.join(m1dir, "tools", "window_to_rows.py"))
    binder = os.path.abspath(a.binder or os.path.join(m1dir, "tools", "bind_check.py"))
    fixture = os.path.abspath(a.fixture)

    scratch = a.scratch if os.path.isdir(a.scratch) else None       # mktemp -d 的等价物；scratch 根不存在则落系统 tmp
    tmp = tempfile.mkdtemp(prefix="s2suite.", dir=scratch)
    say("S2_TMP %s%s" % (tmp, "" if scratch else " (scratch dir missing -> system tmp)"))
    st = {"rows": 0, "channels": 0, "neg": 0}
    try:
        rc = _run_all(a, versions, m1dir, identity, generator, binder, fixture, tmp, st)
    except Exception as exc:        # noqa: BLE001  套件自身异常也不许没有结论行
        say("S2_INTERNAL_ERROR %s: %s" % (type(exc).__name__, exc))
        rc = 3
    if rc == 0 and not a.keep:
        shutil.rmtree(tmp, ignore_errors=True)                      # 只删本次 mkdtemp 建的目录
        say("S2_TMP_REMOVED %s" % tmp)
    else:
        say("S2_TMP_KEEP %s" % tmp)
    say("S2_SUMMARY ok=%d rows=%d channels=%d neg=%d/%d" % (1 if rc == 0 else 0, st["rows"], st["channels"], st["neg"], len(versions)))
    return rc


if __name__ == "__main__":
    sys.exit(main())
