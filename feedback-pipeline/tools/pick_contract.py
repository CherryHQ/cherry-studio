#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pick_contract.py —— 契约取件：写死路径 + sha 断言（不扫目录、不按名挑件）

背景：detail-row.v1.13.schema.json 在仓库内有十余份同名异内容副本（清单见
state/CONTRACT-COPY-DIVERGENCE-20261129.md），任何「扫目录挑同名件 / 挑最新」的取法都可能取到坏件。
本脚本是被禁退回路径 PICK_BY_NAME 的替代物：路径写死、内容断言、取不到就拒绝。

规则：
  * 入参只有 --version（如 v1.13）；不接受目录 / 文件名 / 通配。路径只来自常量表 CONTRACT_PATH，
    以脚本自身 __file__ 上溯两级到 release/m1、再上溯两级到仓库根后拼成绝对路径；与 cwd 无关。
  * 不做目录扫描；不按 mtime / 文件名 / 「最新」挑件。
  * 取件后三重断言，任一不符 → 末行 PICK_ASSERT_FAIL <哪一条>: <实测值>，rc=3：
      1) 文件存在、普通文件（lstat 口径，符号链接不算）、可读
      2) sha256 == EXPECTED_SHA256[version]
      3) 字节数 == EXPECTED_SIZE[version]；JSON 顶层是对象；$id 携带完整版本串（按 [./#] 切词，
         v1.13 不认 v1.130，与 m1_gate.py 同口径、独立实现）；x-contract-version == version
  * 启动先自检：读本文件源码，搜目录扫描一族的被禁词；命中 → 末行 PICK_BY_NAME，rc=4，不取件。

退出码：0 取件成功；
        2 用法 / 环境错（缺参数、多参数、未知版本、日志目录不可写、常量表与脚本位置不自洽）；
        3 PICK_ASSERT_FAIL；
        4 PICK_BY_NAME（自检命中，或无法自检）。
输出：stdout 只有末行结果（PICK_OK / PICK_ASSERT_FAIL / PICK_BY_NAME / FATAL）；过程行走 stderr；
      两者逐行同步写入 <仓库根>/logs/m1/pick-<ts>.log（同秒连跑加 -n 后缀，不覆盖）。
只读：除上述日志外不写、不改、不删任何文件。

用法：python3 -B tools/pick_contract.py --version v1.13
"""
import argparse
import hashlib
import json
import os
import re
import stat
import sys
import time

# ===== 写死常量表（唯一事实源；新增版本 = 三张表各加一行，不扫目录、不猜文件名）=====
CONTRACT_PATH = {
    "v1.13": "release/m1/contract/detail-row.v1.13.schema.json",
}
EXPECTED_SHA256 = {
    "v1.13": "a46bfcf4143f3ecd2bfd062ff988ece671b14fbafa2a739ea0f858cf08d3668f",
}
EXPECTED_SIZE = {
    "v1.13": 10774,
}

# ===== 路径推导：基于脚本自身 __file__，与 cwd 无关 =====
_HERE = os.path.abspath(__file__)                    # .../HermesRuntime/release/m1/tools/pick_contract.py
_TOOLS_DIR = os.path.dirname(_HERE)                  # .../release/m1/tools
_M1_DIR = os.path.dirname(_TOOLS_DIR)                # 上溯两级 → .../release/m1
_REPO = os.path.dirname(os.path.dirname(_M1_DIR))    # 再上溯两级 → .../HermesRuntime（CONTRACT_PATH 以此为根）
_LOGDIR = os.path.join(_REPO, "logs", "m1")

# 目录扫描一族的被禁词（源码里出现即等价 PICK_BY_NAME）。拆成两段拼接：源码里不出现整词，自检才不会命中自己。
_FORBIDDEN = ("li" + "stdir", "gl" + "ob", "sc" + "andir", "wa" + "lk")


class PickFail(Exception):
    """三重断言之一不符。label = 哪一条，detail = 实测值。"""

    def __init__(self, label, detail):
        Exception.__init__(self, label)
        self.label = label
        self.detail = detail


class Emitter(object):
    """过程行 → stderr，结果行 → stdout；两者都逐行追加到日志文件。"""

    def __init__(self, fh):
        self.fh = fh

    def _write(self, line, stream):
        self.fh.write(line + "\n")
        self.fh.flush()
        stream.write(line + "\n")
        stream.flush()

    def diag(self, line):
        self._write(line, sys.stderr)

    def result(self, line):
        self._write(line, sys.stdout)


def open_log():
    """在 _LOGDIR 下以 O_EXCL 新建 pick-<ts>.log（同秒已存在则加 -n 后缀），返回 (handle, path, err)。"""
    ts = time.strftime("%Y%m%dT%H%M%S")
    try:
        os.makedirs(_LOGDIR, exist_ok=True)
    except OSError as exc:
        return None, None, "LOGDIR_UNWRITABLE %s (%s)" % (_LOGDIR, exc)
    n = 0
    while True:
        name = "pick-%s.log" % ts if n == 0 else "pick-%s-%d.log" % (ts, n)
        path = os.path.join(_LOGDIR, name)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        except FileExistsError:
            n += 1
            continue
        except OSError as exc:
            return None, None, "LOG_OPEN_FAIL %s (%s)" % (path, exc)
        return os.fdopen(fd, "a", encoding="utf-8"), path, None


def self_scan():
    """读本文件源码，逐行搜被禁词。返回命中列表 [(行号, 词)]；读不到源码时抛 OSError（调用方按无法自检处理）。"""
    with open(_HERE, "r", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    return [(no, tok) for no, line in enumerate(lines, 1) for tok in _FORBIDDEN if tok in line]


def id_carries_version(sid, version):
    """$id 须携带完整版本串：按 [./#] 切词后出现 ["v1", "13"]，且其后一个词不是数字（v1.13 不认 v1.130）。
    与 m1_gate.py 契约入册段的判定同口径，此处独立实现、不 import 闸门。"""
    if not isinstance(sid, str):
        return False
    toks = re.split(r"[./#]", sid)
    want = version.split(".")
    for i in range(len(toks) - len(want) + 1):
        if toks[i:i + len(want)] == want:
            rest = toks[i + len(want):i + len(want) + 1]
            if not rest or not rest[0].isdigit():
                return True
    return False


def pick(path, version):
    """取件 + 三重断言。任一不符抛 PickFail；全部通过返回 (sha256_hex, size)。"""
    # ① 存在 / 普通文件 / 可读
    try:
        st = os.lstat(path)
    except (FileNotFoundError, NotADirectoryError):
        raise PickFail("文件不存在", path)
    except OSError as exc:
        raise PickFail("非普通文件", "%s (%s)" % (path, exc))
    if stat.S_ISLNK(st.st_mode):
        raise PickFail("非普通文件", "%s 是符号链接 -> %s" % (path, os.readlink(path)))
    if not stat.S_ISREG(st.st_mode):
        raise PickFail("非普通文件", "%s mode=%s" % (path, stat.filemode(st.st_mode)))
    if not os.access(path, os.R_OK):
        raise PickFail("不可读", path)
    try:
        with open(path, "rb") as fh:
            fst = os.fstat(fh.fileno())               # 绑定到已打开的那个 fd，再核一次普通文件
            if not stat.S_ISREG(fst.st_mode):
                raise PickFail("非普通文件", "%s (fstat mode=%s)" % (path, stat.filemode(fst.st_mode)))
            data = fh.read()
    except OSError as exc:
        raise PickFail("不可读", "%s (%s)" % (path, exc))

    # ② sha256
    sha = hashlib.sha256(data).hexdigest()
    if sha != EXPECTED_SHA256[version]:
        raise PickFail("sha256", "actual=%s expected=%s" % (sha, EXPECTED_SHA256[version]))

    # ③ 字节数 / $id / x-contract-version
    size = len(data)
    if size != EXPECTED_SIZE[version]:
        raise PickFail("字节数", "actual=%d expected=%d" % (size, EXPECTED_SIZE[version]))
    try:
        schema = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise PickFail("json", "%s (%s)" % (path, exc))
    if not isinstance(schema, dict):
        raise PickFail("json", "%s 顶层不是对象" % path)
    sid = schema.get("$id")
    if not id_carries_version(sid, version):
        raise PickFail("$id", "actual=%r 需携带版本串 %s" % (sid, version))
    xcv = schema.get("x-contract-version")
    if xcv != version:
        raise PickFail("x-contract-version", "actual=%r expected=%s" % (xcv, version))
    return sha, size


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="pick_contract.py", allow_abbrev=False,
        description="契约取件：写死路径 + sha 断言。只认 --version，不接受目录 / 文件名 / 通配。")
    ap.add_argument("--version", required=True, choices=sorted(CONTRACT_PATH), metavar="VER",
                    help="契约版本，如 v1.13（只认常量表 CONTRACT_PATH 内已登记的版本）")
    a = ap.parse_args(argv)                           # 用法错：argparse 自行打 usage 到 stderr，exit 2
    ver = a.version

    fh, logp, err = open_log()
    if err:
        sys.stdout.write("FATAL %s rc=2\n" % err)
        return 2
    em = Emitter(fh)
    em.diag("START pick_contract ts=%s pid=%d cwd=%s argv=[%s] script=%s log=%s"
            % (time.strftime("%Y-%m-%dT%H:%M:%S"), os.getpid(), os.getcwd(),
               " ".join(sys.argv[1:]), _HERE, logp))

    # 自检：先 grep 自己一遍并打印结果；命中即 PICK_BY_NAME，不取件
    try:
        hits = self_scan()
    except OSError as exc:
        em.result("PICK_BY_NAME self_scan=unreadable file=%s error=%s rc=4" % (_HERE, exc))
        return 4
    for no, tok in hits:
        em.diag("HIT line=%d token=%s" % (no, tok))
    em.diag("SELF_SCAN file=%s tokens=%s hits=%d result=%s"
            % (_HERE, "|".join(_FORBIDDEN), len(hits), "HIT" if hits else "CLEAN"))
    if hits:
        em.result("PICK_BY_NAME file=%s hits=%d rc=4" % (_HERE, len(hits)))
        return 4

    # 常量表自洽：写死路径必须就是脚本所在 release/m1/contract/ 下那一件（防止常量表被改指向镜像 / 缓存件）
    rel = CONTRACT_PATH[ver]
    path = os.path.normpath(os.path.join(_REPO, rel))
    must = os.path.join(_M1_DIR, "contract", "detail-row.%s.schema.json" % ver)
    if path != must:
        em.result("FATAL CONTRACT_PATH_MISMATCH version=%s table=%s must_be=%s rc=2" % (ver, path, must))
        return 2

    # 取件 + 三重断言
    try:
        sha, size = pick(path, ver)
    except PickFail as pf:
        em.result("PICK_ASSERT_FAIL %s: %s rc=3" % (pf.label, pf.detail))
        return 3
    em.result("PICK_OK version=%s path=%s sha256=%s size=%d rc=0" % (ver, path, sha, size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
