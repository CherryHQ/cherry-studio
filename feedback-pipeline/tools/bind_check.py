#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""跨步骤字节绑定核对（只读）：自检读到的窗口字节 sha256 必须 == 行生成用到的窗口字节 sha256。

用法:
  python3 -B tools/bind_check.py --selfcheck <selfcheck.json> --gen <gen-report.json>

背景: 自检（uf003_identity.py --selfcheck → selfcheck.json，每渠道 used_bytes_sha256）与行生成
（tools/window_to_rows.py → stdout 汇总的 used_bytes_sha256）各自声明自己读到的字节 sha，此前没有任何一步
比较两者；本工具补上这一比。只读两份落盘报告，不碰窗口文件本身（窗口字节由那两步各自单次读取并记 sha）。

输入:
  --selfcheck  uf003_identity.py --selfcheck 的报告：checks[] 每项 {"source": <渠道>, "used_bytes_sha256": <sha256>, ...}
  --gen        tools/window_to_rows.py 的 stdout 汇总：{"used_bytes_sha256": {"<渠道>.json": <sha256>, ...}, ...}
               （window_to_rows.py:354 的真实形态，渠道值直接是 sha 字符串；渠道值若是对象，则必须是非空对象且含
                 used_bytes_sha256 —— 两种形态都严格校验，其它形态一律拒，不设放宽开关）

判定（PI-R12 收紧，全部 fail-closed；退出码只有 0 / 3，任何输入都不出 traceback）:
  结构与记录（改动 2/3，stderr，rc=3）
    checks[] 每项必须是非空对象、source 非空字符串、used_bytes_sha256 是 64 位小写十六进制；
    gen 的 used_bytes_sha256 每个渠道值必须是 64 位小写十六进制字符串，或含合法 used_bytes_sha256 的非空对象。
    任一不满足 → BIND_CHECK_FAIL: <原因> channel=<渠道> side=<self|gen>（不用 .get() 兜底，缺字段即报）。
    gen 键归一（去 .json 后缀）前，若同一份文件里两个键归一后相同 → BINDING_KEY_COLLISION raw=<k1> vs <k2> channel=<归一后>；
    归一后不是 wecom/qq/telegram/discord 的键一律拒并列出（不把未知键当别名吞掉）。
  渠道集合（改动 1，stdout，rc=3）
    四个固定渠道任一侧缺失或不等 → 每渠道一行 BINDING_MISMATCH <渠道> self=<sha|MISSING|INVALID> gen=<...>（原语义不变）；
    固定渠道之外，两侧渠道集合必须严格一致 → BINDING_CHANNEL_SET_MISMATCH self_only=<排序列表> gen_only=<排序列表>（空写 []）。
  全部相符 → 每渠道一行 BINDING_OK <渠道> <sha 前 16 位>，rc=0。
  参数/文件/JSON 有错 → stderr 一行 BIND_CHECK_FAIL: <异常类>: <消息>，rc=3。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

CHANNELS = ("wecom", "qq", "telegram", "discord")     # 与 tools/window_to_rows.py CHANNELS 同一组、同序
_CHANNEL_SET = frozenset(CHANNELS)
SHA_RE = re.compile(r"[0-9a-f]{64}\Z")
DETAIL_MAX = 200                                       # 错误详情回显上限

_ABSENT = object()        # 该侧根本没有这个渠道
_CONFLICT = object()      # selfcheck 同一渠道多条且 sha 不同


class _RecordError(Exception):
    """结构/记录级不合法（改动 2/3）：lines 是要落 stderr 的完整行，rc 恒 3。"""

    def __init__(self, lines):
        super().__init__(lines[0] if lines else "BIND_CHECK_FAIL")
        self.lines = list(lines)


def _esc(v) -> str:
    """可控转义：孤立代理项 → \\udXXX、控制字符 → \\xNN、折叠空白、超长截断。任何输入都不抛。"""
    try:
        s = v if isinstance(v, str) else str(v)
    except Exception:      # noqa: BLE001  str() 本身也可能抛（罕见），兜住
        s = "<unprintable %s>" % type(v).__name__
    s = " ".join(s.split())
    s = s.encode("utf-8", "backslashreplace").decode("utf-8")
    buf = []
    for ch in s:
        o = ord(ch)
        buf.append(ch if o >= 32 and o != 127 else "\\x%02x" % o)
    s = "".join(buf)
    return s[:DETAIL_MAX] + ("..." if len(s) > DETAIL_MAX else "")


_EMIT_FAILED = False   # 模块级标记：_emit 最终没把行写出去（含 ascii 兜底重试也失败）即置 True，__main__ 收尾据此把 rc 0 改 3


def _emit(stream, line: str) -> None:
    """只写一行；编码/管道问题都不抛（否则 rc=3 会被 traceback 变成 rc=1）。

    唯独 stream is None（fd 1/2 被关闭）要抛：判定结果送不出去时不能默默返回 0，交由上层归 3（fail-closed）。
    写失败同理：首写失败但 ascii 兜底成功 = 行已交付，不算失败；兜底也失败 = 一行都没送出去，
    置 _EMIT_FAILED，由 __main__ 在 code==0 时改 3，不许 rc=0 而无任何 BINDING_OK 交付。
    """
    global _EMIT_FAILED
    if stream is None:
        raise ValueError("stdout/stderr 不可用（文件描述符已关闭）")
    try:
        stream.write(line + "\n")
        stream.flush()
        return
    except (UnicodeEncodeError, OSError):
        pass
    try:
        stream.write(line.encode("ascii", "backslashreplace").decode("ascii") + "\n")
        stream.flush()
    except Exception:      # noqa: BLE001
        _EMIT_FAILED = True


def _fail_line(reason: str, channel, side: str) -> str:
    return "BIND_CHECK_FAIL: %s channel=%s side=%s" % (reason, _esc(channel), side)


class _ArgParser(argparse.ArgumentParser):
    def error(self, message):      # 用法错也归 3，不透出 argparse 的 rc=2
        _emit(sys.stderr, "BIND_CHECK_FAIL: USAGE %s" % _esc(message))
        sys.exit(3)


def _load_json(path: str, label: str):
    """严格 UTF-8 解码后 json.loads；任何问题都抛（由 _run 归 3）。

    同一对象内出现重复键（嵌套对象同样生效）→ ValueError("DUPLICATE_KEY <label>: <key>")。
    json.loads 默认让后者覆盖前者，先写非法 used_bytes_sha256 再写合法值就能把非法值洗成合法（fail-open），
    这里用 object_pairs_hook 在成键前直接拒，不吞异常。
    """
    if not os.path.isfile(path):
        raise ValueError("%s 不存在或不是文件 %s" % (label, path))
    with open(path, "rb") as fh:
        raw = fh.read()

    def _no_duplicate_keys(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError("DUPLICATE_KEY %s: %s" % (label, key))
            obj[key] = value
        return obj

    return json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys)


def _sha_from_selfcheck(doc) -> dict:
    """selfcheck.json → {渠道: sha}。每项必须是非空对象且字段齐全、类型正确（改动 2）。"""
    if not isinstance(doc, dict) or "checks" not in doc or not isinstance(doc["checks"], list):
        raise ValueError("selfcheck 顶层不是对象或缺 checks 数组")
    out = {}
    errs = []
    for idx, item in enumerate(doc["checks"]):
        if not isinstance(item, dict) or not item:
            errs.append(_fail_line("checks[%d] 不是非空对象（%s）" % (idx, type(item).__name__), "?", "self"))
            continue
        if "source" not in item:
            errs.append(_fail_line("checks[%d] 缺 source" % idx, "?", "self"))
            continue
        src = item["source"]
        if not isinstance(src, str) or not src:
            errs.append(_fail_line("checks[%d].source 不是非空字符串（%s）" % (idx, type(src).__name__), "?", "self"))
            continue
        if "used_bytes_sha256" not in item:
            errs.append(_fail_line("checks[%d] 缺 used_bytes_sha256" % idx, src, "self"))
            continue
        sha = item["used_bytes_sha256"]
        if not isinstance(sha, str) or SHA_RE.match(sha) is None:
            errs.append(_fail_line("used_bytes_sha256 不是 64 位小写十六进制（%s）" % type(sha).__name__, src, "self"))
            continue
        if src in out and out[src] != sha:
            out[src] = _CONFLICT
        else:
            out.setdefault(src, sha)
    if errs:
        raise _RecordError(errs)
    return out


def _sha_from_gen(doc) -> dict:
    """gen-report.json → {渠道: sha}。键归一冲突/未知键/值类型错都拒（改动 2/3）。"""
    if not isinstance(doc, dict) or "used_bytes_sha256" not in doc or not isinstance(doc["used_bytes_sha256"], dict):
        raise ValueError("gen 顶层不是对象或缺 used_bytes_sha256 对象")
    table = doc["used_bytes_sha256"]

    # 第一遍：只做键归一 + 冲突检测（按文件出现顺序，先出现者记为 raw 的前者）
    norm_of = {}
    for key in table:
        if not isinstance(key, str):
            raise _RecordError([_fail_line("used_bytes_sha256 的键不是字符串（%s）" % type(key).__name__, "?", "gen")])
        ch = key[:-5] if key.endswith(".json") else key
        if ch in norm_of:
            raise _RecordError(["BINDING_KEY_COLLISION raw=%s vs %s channel=%s"
                                % (_esc(norm_of[ch]), _esc(key), _esc(ch))])
        norm_of[ch] = key

    # 第二遍：归一后仍不是四个规范渠道名的键一律拒，全部列出
    unknown = sorted(ch for ch in norm_of if ch not in _CHANNEL_SET)
    if unknown:
        raise _RecordError([_fail_line("归一后不是规范渠道名（wecom/qq/telegram/discord）raw=%s" % _esc(norm_of[ch]), ch, "gen")
                            for ch in unknown])

    # 第三遍：每个渠道值必须严格合法。两种形态都认，其它一律拒（不设放宽开关）：
    #   形态一（window_to_rows.py:354 的真实输出）：渠道值直接是 64 位小写十六进制字符串；
    #   形态二：渠道值是非空对象，且其 used_bytes_sha256 是 64 位小写十六进制字符串。
    out = {}
    errs = []
    for ch, raw in norm_of.items():
        v = table[raw]
        if isinstance(v, str):
            if SHA_RE.match(v) is None:
                errs.append(_fail_line("渠道值不是 64 位小写十六进制（str 长度 %d）" % len(v), ch, "gen"))
                continue
            out[ch] = v
            continue
        if not isinstance(v, dict) or not v:
            errs.append(_fail_line("渠道值既不是 64 位小写十六进制字符串，也不是非空对象（%s）"
                                   % ("空 dict" if isinstance(v, dict) else type(v).__name__), ch, "gen"))
            continue
        if "used_bytes_sha256" not in v:
            errs.append(_fail_line("渠道对象缺 used_bytes_sha256", ch, "gen"))
            continue
        sha = v["used_bytes_sha256"]
        if not isinstance(sha, str) or SHA_RE.match(sha) is None:
            errs.append(_fail_line("used_bytes_sha256 不是 64 位小写十六进制（%s）" % type(sha).__name__, ch, "gen"))
            continue
        out[ch] = sha
    if errs:
        raise _RecordError(errs)
    return out


def _valid(v) -> bool:
    return isinstance(v, str) and SHA_RE.match(v) is not None


def _show(v) -> str:
    if v is _ABSENT:
        return "MISSING"
    if _valid(v):
        return v
    return "INVALID:%s" % ("CONFLICT" if v is _CONFLICT else type(v).__name__)


def _lst(items) -> str:
    return "[%s]" % ",".join(_esc(x) for x in items)


def _run(argv=None) -> int:
    ap = _ArgParser(description="自检与行生成的窗口字节 sha256 绑定核对（只读）")
    ap.add_argument("--selfcheck", required=True, help="uf003_identity.py --selfcheck 的报告 JSON")
    ap.add_argument("--gen", required=True, help="tools/window_to_rows.py stdout 汇总落盘的 JSON")
    a = ap.parse_args(argv)

    try:
        sc = _sha_from_selfcheck(_load_json(a.selfcheck, "--selfcheck"))
        gen = _sha_from_gen(_load_json(a.gen, "--gen"))
    except _RecordError as exc:
        for line in exc.lines:
            _emit(sys.stderr, line)
        return 3
    except Exception as exc:        # noqa: BLE001  参数/文件/解码/JSON/结构任何问题都归 3，不出 traceback
        _emit(sys.stderr, "BIND_CHECK_FAIL: %s: %s" % (type(exc).__name__, _esc(exc)))
        return 3

    # 四个固定渠道：任一侧缺失或 sha 不等，仍走原 BINDING_MISMATCH … MISSING 语义（文案不变）
    bad = []
    for ch in CHANNELS:
        s, g = sc.get(ch, _ABSENT), gen.get(ch, _ABSENT)
        if not (_valid(s) and _valid(g) and s == g):
            bad.append((ch, s, g))
    if bad:
        for ch, s, g in bad:
            _emit(sys.stdout, "BINDING_MISMATCH %s self=%s gen=%s" % (_esc(ch), _show(s), _show(g)))
        return 3

    # 固定渠道之外：两侧集合必须严格一致（改动 1，两个方向都比）
    self_only = sorted(set(sc) - set(gen))
    gen_only = sorted(set(gen) - set(sc))
    if self_only or gen_only:
        _emit(sys.stdout, "BINDING_CHANNEL_SET_MISMATCH self_only=%s gen_only=%s"
              % (_lst(self_only), _lst(gen_only)))
        return 3

    # 集合已一致：剩下的非规范渠道名两侧都有，也不许当别名收下（改动 3）
    extra = sorted(set(sc) | set(gen))
    extra = [c for c in extra if c not in _CHANNEL_SET]
    if extra:
        for ch in extra:
            _emit(sys.stderr, _fail_line("非规范渠道名（不在 wecom/qq/telegram/discord 内）", ch, "both"))
        return 3

    for ch in CHANNELS:
        _emit(sys.stdout, "BINDING_OK %s %s" % (_esc(ch), gen[ch][:16]))
    return 0


def main(argv=None) -> int:
    try:
        return _run(argv)
    except SystemExit:
        raise
    except Exception as exc:        # noqa: BLE001  双保险：本文件任何路径都不得以 rc=1 结束
        _emit(sys.stderr, "BIND_CHECK_FAIL: %s: %s" % (type(exc).__name__, _esc(exc)))
        return 3


if __name__ == "__main__":
    # 收尾：退出码只允许 0 / 3。输出端故障（/dev/full、被提前关闭的管道等）不是判定结果，
    # 不能让解释器退出时的 flush 把 rc 变成 1/120，故显式 flush 后用 os._exit 固化退出码。
    code = 3
    try:
        code = main()
    except SystemExit as exc:        # argparse 的 sys.exit(3) 等
        code = exc.code if isinstance(exc.code, int) else 3
    except Exception as exc:        # noqa: BLE001  双保险：本文件任何路径都不得以 rc=1 结束
        try:
            _emit(sys.stderr, "BIND_CHECK_FAIL: %s: %s" % (type(exc).__name__, _esc(exc)))
        except Exception:  # noqa: BLE001  连 stderr 都不可用时只能静默，退出码仍为 3
            pass
        code = 3
    if code == 0 and _EMIT_FAILED:     # 判定为 OK 但结果一行都没写出去（管道读端已关 / /dev/full 等）→ 不是 0
        code = 3
    if code not in (0, 3):
        code = 3
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:  # noqa: BLE001
            pass
    os._exit(code)
