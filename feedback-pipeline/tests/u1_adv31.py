#!/usr/bin/env python3
"""第 31 轮判据 C1/C2 的对抗用例：判定器自身不能被配置或畸形输入关掉。

每条用例都真实起进程跑 tools/conformance.py，断言「退出码 + 是否出现 traceback +
结论是否可解析」。退出码口径：3 = 结论不可信，2 = 真不合契约，1 = 一律不允许出现。

C1（P1 判定器可被绕过）：渠道映射里的 rules/fallback 任何表外值、空串、null、
缺键、重复，都必须 rc=3，而不是把非法值并进白名单让 channel_bad 失效；
同时保留对照组：配置合法时，数据里出现表外 来源渠道 必须 rc=2。
C2（P2 结构化退出）：1200 层嵌套、孤立代理项、ascii 严格编码都必须 rc=3/2 且无
traceback，报告仍可被 json 解析。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "tools", "conformance.py")
MAP = os.path.join(ROOT, "contract", "channel-map.json")
BASE = os.path.join(ROOT, "state", "uf-003", "baseline-20261124T105021.ndjson")
OUT = os.path.join(ROOT, "state", "uf-003", "adv")
PY = sys.executable

rows_total = 0
fails = 0


def case(name, expect_rc, *, path=None, chan=None, env=None, forbid_tb=True,
         want_text=None, want_json=False, baseline="", expect=None):
    """跑一次判定器，断言退出码/无 traceback/报告可解析。

    默认 --baseline ''（明确放弃历史检查），因为这些用例关心的是新行/配置判定；
    传 baseline=BASE 时才做历史比对。
    """
    global rows_total, fails
    rows_total += 1
    e = dict(os.environ)
    if env:
        e.update(env)
    cmd = [PY, TOOL, "--channel-map", chan or MAP, "--baseline", baseline,
           "--max-samples", "3", path or os.path.join(OUT, "row.ndjson")]
    p = subprocess.run(cmd, capture_output=True, text=True, env=e, cwd=ROOT)
    err = p.stderr or ""
    out = p.stdout or ""
    problems = []
    if p.returncode != expect_rc:
        problems.append(f"rc={p.returncode} 期望 {expect_rc}")
    if forbid_tb and ("Traceback (most recent call last)" in err or "Traceback (most recent call last)" in out):
        problems.append("出现 traceback")
    if want_text and not any(t in err for t in want_text):
        problems.append(f"stderr 未含 {want_text!r}：{err.strip()[:160]}")
    parsed = None
    if want_json:
        try:
            parsed = json.loads(out)
        except ValueError as exc:
            problems.append(f"stdout 不是合法 JSON（{exc}）：{out.strip()[:120]}")
    if expect_rc == 1:
        problems.append("rc=1 不允许作为结论")
    if expect:
        rule, field, needle = expect
        parsed_ok = parsed is not None
        if not parsed_ok:
            try:
                parsed = json.loads(out)
                parsed_ok = True
            except ValueError:
                problems.append(f"要核 expect 但 stdout 不是 JSON：{out.strip()[:120]}")
        if parsed_ok:
            entries = (parsed.get("rules") or {}).get(rule) or []
            hit_ok = any(e.get("field") == field and needle in str(e.get("value", ""))
                         for e in entries)
            if not hit_ok:
                problems.append(
                    f"{rule} 必须点名 field={field!r} 并回显被拒值 {needle!r}；实得 {entries[:2]}")
    status = "OK  " if not problems else "FAIL"
    if problems:
        fails += 1
    detail = ""
    if parsed is not None:
        detail = f" ok={parsed.get('ok')} violations={parsed.get('violations_total')} rules={parsed.get('rules')}"
    print(f"[{status}] {name}: rc={p.returncode}{detail}")
    for pr in problems:
        print(f"        ! {pr}")
        print(f"        ! stderr={err.strip()[:300]!r}")
    return p


def dump_map(mutate, fname):
    """基于真契约复制一份渠道映射，按 mutate 改一处，落盘后返回路径。"""
    with open(MAP, encoding="utf-8") as fh:
        doc = json.load(fh)
    mutate(doc)
    path = os.path.join(OUT, fname)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    return path


def dump_rows(fname, mutate, rec_id=None):
    """从真基线取第 1 行做一份单行导出，按 mutate 改 fields 里的字段。

    只改 fields 内部：顶层再塞业务字段会被判定器按「形状不支持」拒掉（这是对的），
    用例本身不能靠造畸形形状来绕开被测逻辑。
    """
    with open(BASE, encoding="utf-8") as fh:
        first = json.loads(fh.readline())
    fields = first["fields"] if isinstance(first.get("fields"), dict) else first
    mutate(fields)
    if rec_id:
        first["record_id"] = rec_id
    path = os.path.join(OUT, fname)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(first, ensure_ascii=False) + "\n")
    return path


def main() -> int:
    global rows_total, fails
    os.makedirs(OUT, exist_ok=True)
    with open(BASE, encoding="utf-8") as fh:
        base_rows = sum(1 for _ in fh)

    # ---------- 对照组：配置合法时，数据里的表外渠道必须被抓 ----------
    clean_map = dump_map(lambda d: None, "map-clean.json")
    bad_row = dump_rows("row-bad-channel.ndjson", lambda r: r.update(
        {"来源渠道": "非法渠道", "来源事件标识": "not-a-valid-source-id"}),
        rec_id="rec-adv-1")
    # 维持者加严判据（2026-11-26）：不能只靠 rc=2 + violations>=1，
    # 必须点名到字段路径，并回显被拒的那个值，否则「堵死」可能只是换个地方静默。
    case("C1-0 对照：合法配置 + 表外渠道行（点名+回显）", 2, path=bad_row,
         chan=clean_map, want_json=True, want_text=(),
         expect=("channel_bad", "来源渠道", "非法渠道"))

    fam_row = dump_rows("row-bad-family.ndjson", lambda r: r.update(
        {"来源渠道": "企微", "来源事件标识": "qq:G:ROBOT1.0_ab"}), rec_id="rec-adv-fam")
    case("C1-0b 族不符（点名+回显）", 2, path=fam_row, chan=clean_map,
         expect=("event_id_family", "来源事件标识", "qq:G:ROBOT1.0_ab"))

    ctrl_row = dump_rows("row-bad-evidence.ndjson", lambda r: r.update(
        {"证据": "https://a.test/path?q=1\u0007x"}), rec_id="rec-adv-ctrl")
    case("C1-0c 证据控制字符（点名+回显）", 2, path=ctrl_row, chan=clean_map,
         expect=("evidence_control_char", "证据", "\u0007"))

    bk_row = dump_rows("row-bad-batch.ndjson", lambda r: r.update(
        {"日报键": "跑偏的批次键"}), rec_id="rec-adv-bk")
    case("C1-0d 批次键不合契约（点名+回显）", 2, path=bk_row, chan=clean_map,
         expect=("batch_key_bad", "日报键", "跑偏的批次键"))

    # ---------- C1：渠道映射自身被污染，必须拒判 ----------
    def fb_bad(d):
        d["fallback"]["source"] = "非法渠道"
    case("C1-a fallback.source=非法渠道", 3, path=bad_row,
         chan=dump_map(fb_bad, "map-fb-bad.json"),
         want_text=["不在契约渠道枚举"])

    def rule_bad(d):
        d["rules"][0]["source"] = "非法渠道"
    case("C1-b rules[0].source=非法渠道", 3, path=bad_row,
         chan=dump_map(rule_bad, "map-rule-bad.json"),
         want_text=["不在契约渠道枚举"])

    def fb_null(d):
        d["fallback"]["source"] = None
    case("C1-c fallback.source=null", 3, path=bad_row,
         chan=dump_map(fb_null, "map-fb-null.json"),
         want_text=["fallback.source"])

    def fb_empty(d):
        d["fallback"]["source"] = "  "
    case("C1-d fallback.source=空白", 3, path=bad_row,
         chan=dump_map(fb_empty, "map-fb-blank.json"))

    def fb_missing(d):
        del d["fallback"]["source"]
    case("C1-e fallback 缺 source", 3, path=bad_row,
         chan=dump_map(fb_missing, "map-fb-missing.json"))

    def fb_absent(d):
        del d["fallback"]
    case("C1-f 整段缺 fallback", 3, path=bad_row,
         chan=dump_map(fb_absent, "map-fb-absent.json"))

    def rules_empty(d):
        d["rules"] = []
    case("C1-g rules=[]", 3, path=bad_row,
         chan=dump_map(rules_empty, "map-rules-empty.json"))

    def rules_absent(d):
        del d["rules"]
    case("C1-h 缺 rules", 3, path=bad_row,
         chan=dump_map(rules_absent, "map-rules-absent.json"))

    def rule_src_missing(d):
        del d["rules"][1]["source"]
    case("C1-i rules[1] 缺 source", 3, path=bad_row,
         chan=dump_map(rule_src_missing, "map-rule-src-missing.json"))

    def rule_dup(d):
        d["rules"][1]["source"] = d["rules"][0]["source"]
    case("C1-j rules source 重复", 3, path=bad_row,
         chan=dump_map(rule_dup, "map-rule-dup.json"))

    def rule_not_obj(d):
        d["rules"].append("QQ")
    case("C1-k rules 混入字符串", 3, path=bad_row,
         chan=dump_map(rule_not_obj, "map-rule-strobj.json"))

    # 映射文件本身坏了（截断 JSON）也不能 rc=1
    broken = os.path.join(OUT, "map-broken.json")
    with open(broken, "w", encoding="utf-8") as fh:
        fh.write('{"rules": [')
    case("C1-l 映射不是合法 JSON", 3, path=bad_row, chan=broken)

    # ---------- C2：畸形但「读得出来」的输入，必须结构化退出 ----------
    deep = os.path.join(OUT, "row-deep.ndjson")
    with open(deep, "w", encoding="utf-8") as fh:
        # 手工拼文本，避免造用例时自己先撞递归上限
        fh.write('{"record_id": "rec1", "fields": {"说明": ' + "[" * 1200 + "]" * 1200 + "}}\n")
    case("C2-a 说明嵌套 1200 层", 3, path=deep, want_text=["READ_FAIL"])

    sur = os.path.join(OUT, "row-surrogate.ndjson")
    with open(sur, "w", encoding="utf-8") as fh:
        fh.write('{"record_id": "rec1", "fields": {"说明": "x\\ud800y"}}\n')
    case("C2-b 孤立代理项 \\ud800", 3, path=sur, want_text=["READ_FAIL"])

    sur_key = os.path.join(OUT, "row-surrogate-key.ndjson")
    with open(sur_key, "w", encoding="utf-8") as fh:
        fh.write('{"record_id": "rec1", "fields": {"x\\ud800": "y"}}\n')
    case("C2-c 字段名含孤立代理项", 3, path=sur_key, want_text=["READ_FAIL"])

    # 报告要打印中文/表外值；ascii:strict 下不能崩
    case("C2-d ascii:strict + 真实违规（应 rc=2）", 2, path=bad_row, chan=clean_map,
         env={"PYTHONIOENCODING": "ascii:strict"}, want_json=True)
    case("C2-e ascii:strict + 代理项（应 rc=3）", 3, path=sur,
         env={"PYTHONIOENCODING": "ascii:strict"}, want_text=["READ_FAIL"])

    # ---------- 三档退出码互斥：同一批输入里 2/3 不能混 ----------
    case("C2-f 空输入不是通过", 3, path=os.path.join(OUT, "row-empty.ndjson"))
    with open(os.path.join(OUT, "row-empty.ndjson"), "w", encoding="utf-8") as fh:
        fh.write("")
    case("C2-g 空文件（真为空）", 3, path=os.path.join(OUT, "row-empty.ndjson"))

    # 历史保护不能因为放宽配置被绕过：基线里已有值的行，改一个字段必须 rc=2
    # 必须改「基线里已有值」的字段：R7 新增的 说明 在基线上还是空，改了不算改历史
    hist_row = dump_rows("row-hist.ndjson",
                         lambda r: r.update({"工作项键": (r.get("工作项键") or "") + "X"}))
    hp = case("C3-a 历史行被改（应 rc=2）", 2, path=hist_row, chan=clean_map,
              baseline=BASE, want_json=True)
    try:
        hrep = json.loads(hp.stdout)
        if not (hrep.get("rules") or {}).get("history_changed"):
            fails += 1
            print(f"        ! 违规分类里没有 history_changed：{hrep.get('rule_counts')}")
    except ValueError:
        pass

    # 用法错误不能冒充「真不合契约」（需另起 argv，这里单独跑两条）
    for label, argv in (("C3-b 未知参数", ["--nope"]),
                        ("C3-c 缺位置参数", [])):
        rows_total += 1
        p = subprocess.run([PY, TOOL] + argv, capture_output=True, text=True, cwd=ROOT)
        ok = p.returncode == 3 and "Traceback" not in (p.stderr or "")
        if not ok:
            fails += 1
        print(f"[{'OK  ' if ok else 'FAIL'}] {label}: rc={p.returncode}")
        if not ok:
            print(f"        ! 期望 rc=3 且无 traceback：{(p.stderr or '').strip()[:200]!r}")

    print(f"\n{rows_total - fails}/{rows_total} passed（基线 {base_rows} 行，用例退出码互斥校验已开）")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
