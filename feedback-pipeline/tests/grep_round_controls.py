#!/usr/bin/env python3
"""验收第 8 条：禁止「从工作项键解析/推断轮次」——正控 + 负控双向验证。

为什么不用 grep：macOS 自带 BSD grep 在 UTF-8 下对 `工作项键[^\\n]{0,80}轮次`
这类含多字节字符、又带字节上限的量词并不可靠（实测同一模式在中文与 ASCII 混排的行上漏报），
这本身就是一次"工具给出假绿"。故扫描器用 Python re（Unicode 语义），并对模式清单逐条报命中。

为什么要正控：非零命中/零命中在"扫错路径或模式写错"时输出一模一样。没有正控的"0 命中"不成立。

跑法：python3 tests/grep_round_controls.py   退出码 0 = 正控命中且负控干净
"""
import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SELF = os.path.basename(__file__)
WORK = os.path.join(ROOT, "cache", "scratch", "grep-ctrl")

PATTERNS = {
    # 用正则/字符串处理从「工作项键」里取东西
    "regex_on_workitem": re.compile(r"(?:re\.(?:search|match|findall|compile|sub)|\bsplit\(|\bpartition\()"
                                    r"[^\n]{0,120}工作项键"),
    "workitem_to_regex": re.compile(r"工作项键[^\n]{0,120}(?:re\.|\.group\()"),
    # 工作项键与「轮次」同处一行（自然语言口径）
    "workitem_with_round_cn": re.compile(r"工作项键[^\n]{0,80}轮次|轮次[^\n]{0,80}工作项键"),
    # ASCII 口径
    "workitem_round_ascii": re.compile(r"workitem[^\n]{0,80}round|round[^\n]{0,80}workitem",
                                       re.IGNORECASE),
    # 用四位数字从工作项键抽段
    "digits_from_workitem": re.compile(r"工作项键[^\n]{0,80}\\d\{4\}|\\d\{4\}[^\n]{0,80}工作项键"),
    # ASCII 形态：字段名写成 workitem_key 一类（同一违规、不同写法）
    "regex_on_workitem_ascii": re.compile(r"(?:re\.(?:search|match|findall|compile|sub))[^\n]{0,120}workitem",
                                          re.IGNORECASE),
    "workitem_after_parse_ascii": re.compile(r"workitem[^\n]{0,120}(?:\.group\(|\.split\(|re\.)",
                                             re.IGNORECASE),
}

PLANTED = '''import re
def a(row):
    return re.search(r"(\\d{4})", str(row["工作项键"])).group(1)
def b(row):
    return row["工作项键"].split(":")[0]   # 轮次 前缀
def c(row):
    workitem_key = row.get("工作项键") or ""
    return re.match(r"(\\d{4})", workitem_key)
def d(row):
    key = row.get("workitem_key") or ""
    return re.search(r"(\\d{4})", key).group(1)
'''

SCAN_EXT = (".py", ".sh", ".js", ".mjs", ".ts")
SKIP_DIRS = {"cache", "out", "scratch", "node_modules", ".git"}


def scan_file(path):
    hits = []
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return hits
    for name, pat in PATTERNS.items():
        for m in pat.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            hits.append((name, line, text.splitlines()[line - 1].strip()[:120]))
    return hits


def scan_tree(root, extra_skip=()):
    found = []
    scanned = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if not fn.endswith(SCAN_EXT) or fn in extra_skip:
                continue
            p = os.path.join(dirpath, fn)
            scanned += 1
            for h in scan_file(p):
                found.append((p, *h))
    return found, scanned


def main():
    fail = 0
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)
    planted = os.path.join(WORK, "planted.py")
    open(planted, "w", encoding="utf-8").write(PLANTED)

    print("== 正控：临时副本植入 4 种违规写法（中文 3 + ASCII 1），模式必须命中")
    pos, _ = scan_tree(WORK)
    kinds = {p[1] for p in pos}
    print(f"  命中 {len(pos)} 处，覆盖模式 {sorted(kinds)}")
    for p in pos:
        print(f"    {os.path.basename(p[0])}:{p[2]} [{p[1]}] {p[3]}")
    cjk_re = re.compile(r"[\u4e00-\u9fff]")
    hit_lines = {p[2] for p in pos}
    src = open(planted, encoding="utf-8").read().splitlines()
    cjk_hit = any(cjk_re.search(src[ln - 1]) for ln in hit_lines if ln <= len(src))
    ascii_hit = any(not cjk_re.search(src[ln - 1]) for ln in hit_lines if ln <= len(src))
    print(f"  中文行命中={cjk_hit}  ASCII 行命中={ascii_hit}")
    if len(pos) < 3:
        print("  FAIL 正控命中不足 3 → 模式覆盖不全，负控的干净不算数")
        fail = 1
    elif not (cjk_hit and ascii_hit):
        print("  FAIL 正控缺中文行或 ASCII 行命中 → 多字节/命名两种写法覆盖不全")
        fail = 1
    else:
        print("  PASS 正控命中（中文行与 ASCII 行均命中）")

    print("== 负控 A（日常判定）：排除扫描器自身，必须 0 命中")
    neg, scanned = scan_tree(ROOT, extra_skip={SELF})
    print(f"  扫描根={ROOT}  排除目录=sorted(SKIP_DIRS)  排除文件={SELF}  files_scanned={scanned}")
    print(f"  hits={len(neg)}")
    if neg:
        print(f"  FAIL 负控 A 命中 {len(neg)} 处：")
        for p in neg:
            print(f"    {p[0]}:{p[2]} [{p[1]}] {p[3]}")
        fail = 1
    else:
        print("  PASS 负控 A 0 命中")
    # 扫描规模下限来自 PIN 登记值，不写死数字；偏差 >10% 即 rc=3 SCAN_SCOPE_DRIFT
    pin_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan-scope-pin.json")
    if "--write-pin" in sys.argv:
        import json
        json.dump({"files_scanned": scanned,
                   "scan_root": ROOT,
                   "excluded_dirs": sorted(SKIP_DIRS),
                   "excluded_files": [SELF]},
                  open(pin_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  已登记 PIN：{pin_path}（files_scanned={scanned}）")
    elif not os.path.exists(pin_path):
        print("  FAIL rc=3 SCAN_SCOPE_UNDECLARED：缺少 PIN 登记值，扫描下限无从判定（先核数再 --write-pin）")
        return 3
    else:
        import json
        pin = json.load(open(pin_path, encoding="utf-8"))["files_scanned"]
        drift = abs(scanned - pin) / pin if pin else 1.0
        print(f"  PIN files_scanned={pin}  实测={scanned}  偏差={drift:.1%}（阈值 10%）")
        if drift > 0.10:
            print(f"  FAIL rc=3 SCAN_SCOPE_DRIFT：登记 files_scanned={pin}，实测={scanned}"
                  f"（偏差 {drift:.1%} > 10%）→ 树变了或扫描根写错，先核因再更新 PIN")
            return 3
        print("  PASS 扫描规模与 PIN 一致（未超 10% 偏差）")

    print("== 负控 B（一次性留存）：不排除任何文件，自指命中逐条列出，落盘 full 文件")
    full, full_scanned = scan_tree(ROOT, extra_skip=set())
    print(f"  files_scanned={full_scanned}  hits={len(full)}（全部来自按名排除的扫描器自身：{sum(1 for p in full if os.path.basename(p[0]) == SELF)} 处）")
    for p in full:
        print(f"    {p[0]}:{p[1]} [{p[2]}] {p[3]}")
    full_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "grep-round-controls-full.txt")
    with open(full_path, "w", encoding="utf-8") as fh:
        fh.write(f"# 负控 B 完整扫描（不排除任何文件）\n")
        fh.write(f"# 命令: python3 tests/grep_round_controls.py\n")
        fh.write(f"# 扫描根={ROOT}  排除目录={sorted(SKIP_DIRS)}  files_scanned={full_scanned}  hits={len(full)}\n")
        for p in full:
            fh.write(f"{p[0]}:{p[2]} [{p[1]}] {p[3]}\n")
    print(f"  已落盘 {full_path}")
    # B 不进自动判定：只要存在且可读即算成立（列出后人工核）

    print("---- " + ("PASS 正控+负控均成立" if fail == 0 else "FAIL"))
    return fail


if __name__ == "__main__":
    sys.exit(main())
