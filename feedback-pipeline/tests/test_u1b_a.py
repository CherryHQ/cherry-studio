#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""U1b-A（A-r2）单元自测：根因 A = 原因抽取单一入口。

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
import tokenize

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
CAND = os.path.join(REPO, "candidates", "U1b-A", "tools", "mount_dryrun.py")
EXPORT = os.path.join(REPO, "b-stage", "20261127T1050", "new_rows.mapped.ndjson")
BASELINE = os.path.join(REPO, "tests", "fixtures", "baseline_min.ndjson")   # 快照内基线，不依赖 HOME
TMPROOT = os.environ.get("TEST_TMP_ROOT") or os.path.join(REPO, "fixtures", "tmp")

KWS = ("text", "encoding", "universal_newlines")


def _sig_tokens(src):
    """tokenize 剔注释/空白后剩下的「有效令牌」。注释与文档串天然不参与语法判定。"""
    data = src.encode("utf-8", errors="surrogateescape") if isinstance(src, str) else src
    skip = (tokenize.COMMENT, tokenize.NL, tokenize.ENCODING, tokenize.INDENT,
            tokenize.DEDENT, tokenize.NEWLINE)
    return [t for t in tokenize.tokenize(io.BytesIO(data).readline) if t.type not in skip]


def _name_tokens_of_src(src):
    """语法层 NAME 令牌（注释、文档串都不在内）。仅用于负控：注释里的词不该出现。"""
    return [t.string for t in _sig_tokens(src) if t.type == tokenize.NAME]


def _callee(sig, i):
    """'(' 之前的点号链，如 subprocess.run / Popen。取不到返回 ''。"""
    parts = []
    j = i - 1
    while j >= 0 and (sig[j].type == tokenize.NAME or sig[j].string == "."):
        parts.append(sig[j].string)
        j -= 1
    return "".join(reversed(parts))


def _splitlines_calls(src):
    """只认**方法调用形态**：NAME splitlines 前一个令牌是 '.'，后一个令牌是 '('。

    赋值（splitlines=1）与属性读取（x=t.splitlines）不是调用，不得算命中。
    """
    sig = _sig_tokens(src)
    out = []
    for i, tok in enumerate(sig):
        if tok.type == tokenize.NAME and tok.string == "splitlines":
            prev = sig[i - 1].string if i else ""
            nxt = sig[i + 1].string if i + 1 < len(sig) else ""
            if prev == "." and nxt == "(":
                out.append(tok.start[0])
    return out


def _subprocess_text_kwargs(src):
    """subprocess.* 调用里让 stdout 变 str 的关键字实参：text/universal_newlines=True，encoding=非 None。

    text=False、非 subprocess 的同名参数都不算。返回 [(行号, 被调, 关键字, 取值)]。
    """
    sig = _sig_tokens(src)
    stack = []
    out = []
    for i, tok in enumerate(sig):
        if tok.string == "(":
            stack.append(_callee(sig, i))
            continue
        if tok.string == ")":
            if stack:
                stack.pop()
            continue
        if (tok.type == tokenize.NAME and tok.string in KWS and stack and i + 1 < len(sig)
                and sig[i + 1].string == "="):
            callee = stack[-1]
            if not callee.startswith("subprocess."):
                continue
            val = sig[i + 2].string if i + 2 < len(sig) else ""
            hit = (val == "True") or (tok.string == "encoding" and sig[i + 2].type == tokenize.STRING)
            if hit:
                out.append((tok.start[0], callee, tok.string, val))
    return out


def _src_of(path):
    with open(path, "rb") as fh:
        return fh.read()


def _splitlines_calls_file(path):
    return _splitlines_calls(_src_of(path))


def _subprocess_text_kwargs_file(path):
    return _subprocess_text_kwargs(_src_of(path))


def _code_name_tokens(path):
    with open(path, "rb") as fh:
        return [(tok.string, tok.start[0]) for tok in tokenize.tokenize(fh.readline)
                if tok.type == tokenize.NAME]


MADE = []
RESULT = []


def _as_text(val):
    """内存文件系统里字节与文本混存：统一按 surrogateescape 还原成文本再比较。"""
    if isinstance(val, (bytes, bytearray)):
        return bytes(val).decode("utf-8", errors="surrogateescape")
    return val


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
    def __init__(self, fs, path, binary=False):
        self.fs, self.path, self.parts, self.binary = fs, path, [], binary

    def write(self, s):
        if self.binary and isinstance(s, str):
            s = s.encode("utf-8", errors="surrogateescape")
        elif not self.binary and isinstance(s, (bytes, bytearray)):
            s = bytes(s).decode("utf-8", errors="surrogateescape")
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
        if self.binary:
            return b"".join(x if isinstance(x, bytes) else x.encode("utf-8") for x in self.parts)
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
        binary = "b" in mode
        if "w" in mode or "a" in mode or "x" in mode or "+" in mode:
            w = MemWriter(self, p, binary=binary)
            self.writers[p] = w
            return w
        val = self.writers[p].value() if p in self.writers else self.files.get(p)
        if binary:
            return io.BytesIO(val if isinstance(val, (bytes, bytearray)) else str(val).encode("utf-8"))
        return io.StringIO(val if isinstance(val, str) else bytes(val).decode("utf-8", errors="surrogateescape"))
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
    spec = importlib.util.spec_from_file_location("mount_u1b_a_r2", CAND)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


II_LINE = "INPUT_INCOMPLETE: 应有 >= 743 行，实得 6 行，基线行命中 0/743（缺 743）"
LONG_PREFIX = "P" * 81


def main():
    mod = load_mod()
    print("MODE=%s  TMPROOT=%s" % (MODE, TMPROOT if MODE == "disk" else "<memory>"))

    # ---------- A2 前缀：原文保留，不限长/字符集/大小写 ----------
    check("A2 X-FAIL 原样保留", mod.extract_reasons([("stderr", "X-FAIL: bad")])[0]["prefix"] == "X-FAIL")
    check("A2 大小写不改", mod.extract_reasons([("stderr", "Read_Fail: x")])[0]["prefix"] == "Read_Fail")
    check("A2 全小写保留", mod.extract_reasons([("stderr", "read_fail: x")])[0]["prefix"] == "read_fail")
    it_long = mod.extract_reasons([("stderr", LONG_PREFIX + ": bad")])[0]
    check("A2 81 字符前缀完整保留（不设上限）", it_long["prefix"] == LONG_PREFIX, "len=%d" % len(it_long["prefix"]))
    it_colon = mod.extract_reasons([("stderr", ": bad")])[0]
    check("A2 冒号起始 → EMPTY_PREFIX 且 prefix 为空",
          it_colon["prefix"] == "" and it_colon["prefix_type"] == "EMPTY_PREFIX",
          "%r/%s" % (it_colon["prefix"], it_colon["prefix_type"]))
    it_pc = mod.extract_reasons([("stderr", ":")])[0]
    check("A2 纯冒号行 → EMPTY_PREFIX", it_pc["prefix_type"] == "EMPTY_PREFIX", it_pc["prefix_type"])
    it_nc = mod.extract_reasons([("stderr", "pure prose line")])[0]
    check("A2 无冒号 → NO_PREFIX", it_nc["prefix"] == "NO_PREFIX" and it_nc["prefix_type"] == "NO_PREFIX")
    check("A2 冒号前整段 token", mod.extract_reasons([("stderr", "http://x/y:80")])[0]["prefix"] == "http")

    # ---------- A1 逐行抽取：只按 \n 切 ----------
    out_nl = "READ_FAIL: old warning"            # 故意无尾换行
    items = mod.extract_reasons([("stdout", out_nl), ("stderr", II_LINE)])
    check("A1 两流两条不合并", len(items) == 2, "len=%d" % len(items))
    check("A1 未出现拼接串", "warningINPUT_INCOMPLETE" not in json.dumps(items, ensure_ascii=False))
    check("A1 流标号保留", [x["stream"] for x in items] == ["stdout", "stderr"])
    check("A1 四数只挂 INPUT_INCOMPLETE",
          items[0]["four_numbers"] is None and items[1]["four_numbers"]["baseline_missing"] == 743)
    check("A1 无字符串 None", "None" not in json.dumps(items, ensure_ascii=False))

    u2028 = "INPUT_INCOMPLETE: detail\u2028应有 >= 743 行，实得 6 行，基线行命中 0/743（缺 743）"
    one = mod.extract_reasons([("stderr", u2028)])
    check("A1 U+2028 不拆行（一条）", len(one) == 1, "len=%d" % len(one))
    check("A1 U+2028 保留在 raw 内", "\u2028" in one[0]["raw"])
    check("A1 U+2029 不拆行", len(mod.extract_reasons([("stderr", "A: x\u2029B: y")])) == 1)
    crlf_items = mod.extract_reasons([("stderr", "READ_FAIL: a\r\nX-FAIL: b")])
    check("A1 CRLF 拆两条、首行标 crlf", len(crlf_items) == 2 and [x["crlf"] for x in crlf_items] == [True, False],
          str([x["crlf"] for x in crlf_items]))
    check("A1 \\r 不留在行内容里", not any("\r" in x["raw"] for x in crlf_items))
    check("A1 index 保持物理顺序", [x["index"] for x in crlf_items] == [0, 1])

    # ---------- 原文不静默截断 ----------
    long_raw = "READ_FAIL: " + ("Z" * 400) + " ROOT_CAUSE_UNIQUE"
    it_lr = mod.extract_reasons([("stderr", long_raw)])[0]
    check("A4 超长 raw 标 truncated", it_lr["raw_truncated"] is True and len(it_lr["raw"]) == mod.RAW_INLINE_MAX,
          "raw_len=%s" % it_lr["raw_len"])
    check("A4 超长 raw 记 raw_len", it_lr["raw_len"] == len(long_raw), str(it_lr["raw_len"]))
    check("A4 超长 raw 记全文 sha256",
          it_lr["raw_full_sha256"] == hashlib.sha256(long_raw.encode("utf-8")).hexdigest())
    it_sr = mod.extract_reasons([("stderr", "READ_FAIL: short")])[0]
    check("A4 短 raw 不标 truncated 且无 sha",
          it_sr["raw_truncated"] is False and it_sr["raw_full_sha256"] is None)
    check("A4 被截断字段必带 truncated+sha（全表扫描）",
          all((not x.get("raw_truncated")) or (x.get("raw_full_sha256") and x.get("raw_len"))
              for x in [it_lr, it_sr]))

    # ---------- sidecar：写入成功 / 不可写 必须分得清（禁止静默） ----------
    it_no_dir = mod.extract_reasons([("stderr", long_raw)])[0]     # 未给 sidecar_dir
    check("A4 无 sidecar 目录 → 显式 unavailable（不静默）",
          it_no_dir["raw_sidecar_unavailable"] is True and it_no_dir["raw_sidecar_status"] == "unavailable"
          and it_no_dir["raw_full_sha256"] == it_lr["raw_full_sha256"],
          str(it_no_dir["raw_sidecar_status"]))
    unwritable = os.path.join("/dev/null", "no-sidecar")
    it_bad = mod.make_reason(long_raw, "stderr", 0, unwritable)
    check("A4 sidecar 写不出 → unavailable + 仍给全文 sha256",
          it_bad["raw_sidecar_unavailable"] is True and it_bad["raw_full_sha256"] == it_lr["raw_full_sha256"],
          "%s/%s" % (it_bad["raw_sidecar_status"], (it_bad["raw_full_sha256"] or "")[:8]))

    # ---------- 摘要有序：已知前缀优先，未知带原前缀 ----------
    both = mod.extract_reasons([("stderr", "READ_FAIL: a\nX-FAIL: b")])
    check("A2 可识别+不可识别都在", [x["prefix"] for x in both] == ["READ_FAIL", "X-FAIL"])
    check("A2 摘要优先已知前缀", mod.summarize_reasons(both) == "READ_FAIL: a")
    check("A2 未知前缀带原前缀", mod.summarize_reasons([("stderr", "X-FAIL: b")] and
                                                mod.extract_reasons([("stderr", "X-FAIL: b")])).startswith("UNMAPPED_REASON:X-FAIL"))
    check("A2 空前缀摘要用占位名",
          mod.summarize_reasons(mod.extract_reasons([("stderr", ": oops")])).startswith("UNMAPPED_REASON:<EMPTY_PREFIX>"))

    # ---------- 哨兵 vs 真前缀 ----------
    both_empty = mod.extract_reasons([("stdout", ""), ("stderr", "")])
    check("A5 两流 0 字节 → 哨兵", both_empty[0].get("sentinel") is True and both_empty[0]["prefix"] == "EMPTY_OUTPUT")
    check("A5 哨兵不算诊断", mod.has_diagnostics(both_empty) is False)
    # ⑤ 纯空白 ≠ 完全无输出：有字节、无诊断内容，必须保留原文并给 reason
    ws = mod.extract_reasons([("stdout", "   "), ("stderr", "")])
    check("A5 三空格 → WHITESPACE_ONLY 不落哨兵",
          ws[0]["prefix"] == "WHITESPACE_ONLY" and ws[0].get("sentinel") is False and ws[0]["state"] == "WHITESPACE_ONLY",
          str(ws[0]))
    check("A5 三空格保留原文", ws[0]["raw_present"] is True and ws[0]["raw"] == "   " and ws[0]["raw_len"] == 3)
    check("A5 三空格 has_diagnostics=False", mod.has_diagnostics(ws) is False)
    check("A5 逐流三态可分", ws[0]["stream_states"] == {"stdout": "WHITESPACE_ONLY", "stderr": "NO_OUTPUT"},
          str(ws[0].get("stream_states")))

    # ① 字节层：真实子进程的 CRLF 与单 CR 不得被改写
    rc_p, out_p, err_p = mod.run(["/usr/bin/printf", "%s", "A: x\r\nB: y\rC"])
    check("A6 run 返回 bytes（不经文本层）", isinstance(out_p, bytes) and isinstance(err_p, bytes),
          "%r/%r" % (type(out_p), type(err_p)))
    check("A6 run 产出保留 CR", b"\r" in out_p and out_p.count(b"\n") == 1, repr(out_p))
    rs = mod.extract_reasons([("stdout", out_p)])
    check("A6 CRLF 标 crlf", [(x["raw"], x["crlf"]) for x in rs] == [("A: x", True), ("B: y\rC", False)],
          str([(x["raw"], x["crlf"]) for x in rs]))
    check("A6 末尾单 CR 不拆行、不标 CRLF", mod._split_physical_lines(b"A: x\r") == [(b"A: x\r", False)],
          str(mod._split_physical_lines(b"A: x\r")))
    # ③ 非法字节不得抛 UnicodeEncodeError：哈希与落盘都按 bytes
    bad_byte = b"READ_FAIL: \xff\xfe tail"
    try:
        bad_item = mod.extract_reasons([("stdout", bad_byte)])[0]
        bad_ok = (bad_item["raw_len"] == len(bad_byte)
                  and bad_item["raw_sha256"] == hashlib.sha256(bad_byte).hexdigest())
        bad_err = ""
    except Exception as exc:  # noqa: BLE001
        bad_ok, bad_err = False, "%s: %s" % (type(exc).__name__, exc)
    check("A7 非法字节贯穿证据链不抛", bad_ok, bad_err or str(bad_item.get("raw_len")))
    long_bad = b" " * 401 + b"READ_FAIL: \xff"
    try:
        li = mod.extract_reasons([("stdout", long_bad)])[0]
        long_ok = (li["raw_len"] == len(long_bad) and li["raw_truncated"] is True
                   and li["raw_full_sha256"] == hashlib.sha256(long_bad).hexdigest())
        long_err = ""
    except Exception as exc:  # noqa: BLE001
        long_ok, long_err = False, "%s: %s" % (type(exc).__name__, exc)
    check("A7 超长非法字节也能算哈希/截断标记", long_ok, long_err)

    # ② 长度先于 strip：raw_len 必须 >= len(raw)，且留下 strip 前后两个数
    padded = " " * 401 + "READ_FAIL: x"
    rp = mod.extract_reasons([("stdout", padded)])[0]
    check("A7 raw_len 是原始长度", rp["raw_len"] == len(padded), "%d vs %d" % (rp["raw_len"], len(padded)))
    check("A7 原文未 strip", rp["raw"] == padded[:400] and rp["raw_truncated"] is True)
    check("A7 同时给 stripped 长度", rp["raw_len_stripped"] == len(padded.strip()), str(rp["raw_len_stripped"]))
    bad = [x for x in mod.extract_reasons([("stdout", "  READ_FAIL: y  ")]) if x["raw_len"] < len(x["raw"])]
    check("A7 raw_len < len(raw) 即 FAIL", bad == [], str(bad))

    # ① 静态正负控：检测式基于 tokenize 剔除 COMMENT，只对 NAME 令牌判定，
    #    不再等价于「文本里还有没有这个词」——注释/文档串提到它不算违规，代码真调用才算。
    check("A6 可执行代码 splitlines 调用为 0 处", _splitlines_calls_file(CAND) == [],
          str(_splitlines_calls_file(CAND)))
    check("A6 可执行代码无 subprocess 文本模式实参", _subprocess_text_kwargs_file(CAND) == [],
          str(_subprocess_text_kwargs_file(CAND)))
    # 正控：三种等价写法都必须命中（text / universal_newlines / encoding）
    check("A6 正控：text=True 命中", _splitlines_calls("x = t.splitlines()\n") == [1])
    check("A6 正控：subprocess text=True 命中",
          [x[2] for x in _subprocess_text_kwargs("subprocess.run(c, text=True)\n")] == ["text"])
    check("A6 正控：universal_newlines=True 命中",
          [x[2] for x in _subprocess_text_kwargs("subprocess.run(c, universal_newlines=True)\n")] == ["universal_newlines"],
          str(_subprocess_text_kwargs("subprocess.run(c, universal_newlines=True)\n")))
    check("A6 正控：encoding=\"utf-8\" 命中",
          [x[2] for x in _subprocess_text_kwargs('subprocess.run(c, encoding="utf-8")\n')] == ["encoding"],
          str(_subprocess_text_kwargs('subprocess.run(c, encoding="utf-8")\n')))
    # 负控：赋值 / 属性读取 / 注释 / 文档串 / text=False / 非 subprocess ---
    check("A6 负控：splitlines=1 不算调用", _splitlines_calls("splitlines=1\n") == [])
    check("A6 负控：x=t.splitlines 属性读取不算调用", _splitlines_calls("x=t.splitlines\n") == [])
    check("A6 负控：注释里的 splitlines 不误报", _name_tokens_of_src("# 不要用 splitlines()\n") == [],
          str(_name_tokens_of_src("# 不要用 splitlines()\n")))
    check("A6 负控：文档串里的 splitlines 不误报", _name_tokens_of_src('"""禁止 splitlines"""\n') == [],
          str(_name_tokens_of_src('"""禁止 splitlines"""\n')))
    check("A6 负控：text=False 不算", _subprocess_text_kwargs("subprocess.run(c, text=False)\n") == [],
          str(_subprocess_text_kwargs("subprocess.run(c, text=False)\n")))
    check("A6 负控：foo(text=True) 非 subprocess 不算",
          _subprocess_text_kwargs("foo(text=True)\n") == [],
          str(_subprocess_text_kwargs("foo(text=True)\n")))
    real_eo = mod.extract_reasons([("stderr", "EMPTY_OUTPUT: real failure")])
    check("A5 真 EMPTY_OUTPUT 前缀是诊断", mod.has_diagnostics(real_eo) is True and real_eo[0].get("sentinel") is None,
          str(real_eo[0].get("sentinel")))

    # ---------- 调用方不拼字符串 ----------
    code = "\n".join(l for l in open(CAND, encoding="utf-8").read().split("\n")
                     if not l.lstrip().startswith("#"))
    check("A2 调用处无 out + err 拼接", re.search(r"\bout\s*\+\s*err\b", code) is None)

    # ---------- A3 main：诊断优先于 JUDGE_MISSING ----------
    def stub_case(stdout_text, stderr_text, judge_written=False, outdir=None):
        d = outdir or tmpdir("a3")
        captured = {}

        def fake_run(cmd, cwd=None):
            if judge_written and "--json" in cmd:
                with open(cmd[cmd.index("--json") + 1], "w") as fh:
                    json.dump({"violations_total": 0, "rules": {}}, fh)
            return 3, stdout_text, stderr_text

        def fake_patrol(root):
            return {"rc": 0, "records_sha": mod.EXPECT_RECORDS_SHA,
                    "records_sha_short": mod.EXPECT_RECORDS_SHA[:16], "rows": mod.EXPECT_ROWS,
                    "ok": True, "sha_error": None, "tail": [""]}

        def fake_write_summary(outdir, summary, txt_lines=None):
            captured["summary"] = summary
            captured["txt"] = txt_lines

        ORIG = (mod.run, mod.patrol, mod.write_summary)
        mod.run, mod.patrol, mod.write_summary = fake_run, fake_patrol, fake_write_summary
        argv = sys.argv
        sys.argv = ["mount_dryrun.py", "--export", EXPORT, "--baseline", BASELINE, "--outdir", d]
        try:
            rc = mod.main()
        finally:
            sys.argv = argv
            mod.run, mod.patrol, mod.write_summary = ORIG
        return rc, captured

    check("前置：fixture 存在（快照内）", os.path.isfile(EXPORT) and os.path.isfile(BASELINE),
          "%s / %s" % (os.path.basename(EXPORT), os.path.basename(BASELINE)))

    runner = memfs_env() if MODE == "memory" else None
    if runner:
        seeded = {}                            # 先进内存再装，避免被自己的 memfs 拦到
        for _p in (EXPORT, BASELINE):
            with open(_p, encoding="utf-8") as _fh:
                seeded[_p] = _fh.read()
        fs = runner.__enter__()
        fs.files.update(seeded)                # 内存模式也要能读到快照内 fixture
        fs.dirs.add(os.path.dirname(EXPORT))
        fs.dirs.add(os.path.dirname(BASELINE))
    try:
        rc, cap = stub_case("", "READ_FAIL: 契约文件不存在 x.json\n" + II_LINE)
        s = cap.get("summary", {})
        check("A3 有诊断时不写 JUDGE_MISSING", "JUDGE_MISSING" not in str(s.get("rc_reason", "")),
              str(s.get("rc_reason"))[:60])
        check("A3 诊断被完整列出（2 条）", len(s.get("metrics", {}).get("rc_reasons", [])) == 2,
              str([x["prefix"] for x in s.get("metrics", {}).get("rc_reasons", [])]))
        check("A3 halt=JUDGE_MISSING_AFTER_DIAGNOSTICS", s.get("halt") == "JUDGE_MISSING_AFTER_DIAGNOSTICS")
        check("A3 rc_reason 取 READ_FAIL", str(s.get("rc_reason", "")).startswith("READ_FAIL"))
        check("A3 diagnostics_take_priority=True",
              s.get("judge_binding", {}).get("diagnostics_take_priority") is True)

        _rc, cap2 = stub_case("", "")
        s2 = cap2.get("summary", {})
        check("A3 无诊断且无文件才 JUDGE_MISSING", s2.get("halt") == "JUDGE_MISSING", str(s2.get("halt")))
        check("A3 该路径 rc_reason 非空", bool(s2.get("rc_reason")))

        _rc, cap3 = stub_case("", "EMPTY_OUTPUT: real failure")
        s3 = cap3.get("summary", {})
        check("A5 真 EMPTY_OUTPUT 不被 JUDGE_MISSING 覆盖", s3.get("halt") != "JUDGE_MISSING", str(s3.get("halt")))
        check("A5 真 EMPTY_OUTPUT 诊断保留", str(s3.get("rc_reason", "")).startswith("EMPTY_OUTPUT"))

        # ① 主流程三态：纯空白 ≠ 无输出（门禁 blocking 1 的回归）
        _rcw, capw = stub_case("   ", "")
        sw = capw.get("summary", {})
        check("A5 主流程：纯空白 → halt=WHITESPACE_ONLY", sw.get("halt") == "WHITESPACE_ONLY", str(sw.get("halt")))
        check("A5 主流程：纯空白 rc_reason 以 WHITESPACE_ONLY 开头",
              str(sw.get("rc_reason", "")).startswith("WHITESPACE_ONLY"), str(sw.get("rc_reason"))[:60])
        check("A5 主流程：纯空白原文被保留",
              any(x.get("raw") == "   " and x.get("raw_present") is True
                  for x in sw.get("metrics", {}).get("rc_reasons", [])),
              str([(x.get("prefix"), x.get("raw")) for x in sw.get("metrics", {}).get("rc_reasons", [])]))
        check("A5 主流程：纯空白与无输出结论不同", sw.get("halt") != s2.get("halt"),
              "%s vs %s" % (sw.get("halt"), s2.get("halt")))

        # ② 所有 rc_reasons 项统一由 make_reason 构造：长度字段必须齐（门禁 blocking 2 的回归）
        for _name, _cap in (("纯空白", capw), ("无输出", cap2), ("有诊断", cap)):
            _items = _cap.get("summary", {}).get("metrics", {}).get("rc_reasons", [])
            _miss = [(x.get("prefix"), [k for k in ("raw_len", "raw_len_stripped", "raw_present",
                                                   "state", "raw_sha256") if k not in x]) for x in _items]
            check("A7 rc_reasons 字段齐全（%s）" % _name, bool(_items) and all(not m[1] for m in _miss), str(_miss))

        # 证据分流：stdout / stderr 各自落盘，内容不互相混入
        d = tmpdir("streams")
        p1 = mod.write_stream(d, "judge.stdout", "READ_FAIL: warning")
        p2 = mod.write_stream(d, "judge.stderr", II_LINE)
        if MODE == "memory":
            v1 = _as_text(runner.fs.read(p1)) if p1 else None
            v2 = _as_text(runner.fs.read(p2)) if p2 else None
        else:
            v1 = open(p1, encoding="utf-8").read() if p1 else None
            v2 = open(p2, encoding="utf-8").read() if p2 else None
        check("A2 stdout/stderr 证据分开落盘", v1 == "READ_FAIL: warning" and v2 == II_LINE,
              "%r / %r" % ((v1 or "")[:20], (v2 or "")[:20]))

        d_side = tmpdir("sidecar")
        it_w = mod.make_reason(long_raw, "stderr", 7, d_side)
        if MODE == "memory":
            side_txt = _as_text(runner.fs.read(os.path.join(d_side, it_w["raw_sidecar"]))) if it_w["raw_sidecar"] else None
        else:
            side_txt = open(os.path.join(d_side, it_w["raw_sidecar"]), encoding="utf-8").read() if it_w["raw_sidecar"] else None
        check("A4 sidecar 写入成功标 written 且全文可回读",
              it_w["raw_sidecar_status"] == "written" and side_txt == long_raw,
              "%s / len=%s" % (it_w["raw_sidecar_status"], len(side_txt or "")))

        # 报告层：全文未落盘必须计数并写进 txt（禁止只在 items 里留一个字段）
        check("A4 helper 认出未落盘项", mod.unlanded_reasons([it_no_dir, it_sr]) == [it_no_dir["raw_full_sha256"]])
        check("A4 helper 生成未落盘告警", "全文未落盘" in (mod.unlanded_note(1) or ""))
        ORIG_EX = mod.extract_reasons

        def ex_no_sidecar(streams, sidecar_dir=None):
            return ORIG_EX(streams, sidecar_dir=None)     # 强制模拟「写不出去」

        mod.extract_reasons = ex_no_sidecar
        try:
            _rcu, capu = stub_case("", long_raw)
        finally:
            mod.extract_reasons = ORIG_EX
        su = capu.get("summary", {})
        check("A4 metrics 记 reasons_fulltext_unlanded_count",
              su.get("metrics", {}).get("reasons_fulltext_unlanded_count") == 1,
              str(su.get("metrics", {}).get("reasons_fulltext_unlanded_count")))
        check("A4 报告 txt 明写「全文未落盘」",
              any("全文未落盘" in x for x in (capu.get("txt") or [])), str((capu.get("txt") or [])[-2:]))
    finally:
        if runner:
            runner.__exit__(None, None, None)

    bad = [x for x in RESULT if not x[1]]
    print("\nSUMMARY mode=%s total=%d pass=%d fail=%d" % (MODE, len(RESULT), len(RESULT) - len(bad), len(bad)))
    return 0 if not bad else 3


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        cleanup()
