#!/usr/bin/env python3
"""U2.3 九例边界（r8/r9）：生成器与判定器两侧的 rc、命中规则、字段、非法值都必须逐字相符
（usage: u2_3_boundary.py [after]）。

生成器 rc：子进程 load_contract/build_identity/normalize_batch_key/_row_shape_error，原值被采用=0，
被拒/降级=2，指纹漂移/版本不符拒判=3。判定器 rc：tools/conformance.py 对单行新行的退出码。两侧都在 v1.9 与
v1.10 契约下各跑一遍（生成器按采集侧实际口径 --allow-qq-candidate）。通过条件（r8 E2，不再只比 rc）：
  - 判定器 report.rules 的规则名集合 == 期望集，每条 field/value 与期望逐字相等（rc=0 例：集合为空、overlay 生效）；
  - 生成器拒绝文本必须含凭证：ID 解析失败 + 所违反的正则 + 原值；日报键/明细行键 + 原值。
  - QQ 段尾部注入 (?#audit-noop)（r8 E1）：判定器与生成器都必须 rc=3、不出结论、单行点名「QQ 段指纹漂移」
    并带冻结/实际 sha256。
  - r9 C 跨版本：v1.10 文件的 QQ 段整段换成 v1.9 的（反之亦然）→ 判定器 rc=3、stdout 空、stderr 单行点名
    「QQ 段版本不符」并带冻结/实际 sha256；生成器在同一目录（未带版本号的副本也一并换掉）同样 rc=3。
  - r9 A 内存契约：families["QQ"] 换成 \\Aqq:.*\\Z 后 assert_assembled 抛 QQSegmentDrift、build_identity rc=3
    且不产出 id（门禁脚本原样）；显式 contract_is_synthetic=True 只得 REFUSE 行。
`before` 标签已删：包内 evidence 没有改前副本可校验 sha256，不许只当字符串。
自证注入：UF003_U23_INJECT=field|value 只改 fake 例的判定器输入。r9 B：注入值取自别的用例的输入常量
（期望值由同一构造派生，不另写字面量），且「注入必须被检出」——注入后 fake 例若仍全部相符即判 ✗。
所以无论期望是否被改成注入值，注入与不注入两种跑法都只能是 rc=1 / 8/9；未登记的注入取值直接 REFUSE。
结果追加到 evidence/u2.3-boundary.md。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import id_patterns  # noqa: E402
CONTRACT = os.path.join(ROOT, "contract")
PATCH = os.environ.get("UF003_V110_PATCH",
                       "/Users/cherryai003/HermesRuntime/cache/user-feedback/scratch/v110-patch")
OUT = os.path.join(ROOT, "state", "uf-003", "u23")
EVID = os.path.join(ROOT, "evidence", "u2.3-boundary.md")
PY = sys.executable
UNKNOWN = "unknown:user-feedback-20261124#0001:1"
ROW_KEY_BAD = "ab" * 32 + "\n"
QQ_RULE = id_patterns.QQ_MSG_ID            # 生成器解析阶段所违反的正则（= 判定器 event_id_family 的依据）
FAKE_MID = "ROBOT1.fake"                   # 裸消息 id：生成器拒绝文本回显的是它，判定器看到的是 qq:G:+它
EV_FAKE, EV_EMPTY = "qq:G:" + FAKE_MID, "qq:G:ROBOT1.0_"
PAYLOAD = {n: "qq:G:ROBOT1.0_" + "a" * n for n in (199, 200, 201)}    # 199/200/201 三例共用的构造
BK_NL, BK_CRLF, BK_SP = "user-feedback-20261124\n", "user-feedback-20261124\r\n", "user-feedback-20261124 "
# r9 B：注入只许引用上面这些常量（= 别的用例的输入）。期望值在 case() 里由同一个对象派生，不再各写一份字面量。
INJECTS = {"field": (UNKNOWN, BK_NL), "value": (PAYLOAD[201], None)}   # 注入取值 → fake 例判定器输入的 (来源事件标识, 日报键)
VERS = ("v1.9", "v1.10")


def case(name, ev=None, bk=None, rk=None, want=2, rule=None, gen_want=None):
    """期望命中的 (规则, 字段, 非法值) 直接取本例输入（同一个对象），期望值不可能与输入各写一份。"""
    if want == 0:
        rules = {}
    elif bk is not None:
        rules = {rule: ("日报键", bk)}
    elif rk is not None:
        rules = {rule: ("明细行键", rk)}
    else:
        rules = {rule: ("来源事件标识", ev)}
    return (name, ev, bk, rk, want, rules, gen_want)


MID_201 = PAYLOAD[201].split(":", 2)[2]
CASES = [
    case("fake", ev=EV_FAKE, rule="event_id_family", gen_want=("ID 解析失败", repr(FAKE_MID), QQ_RULE)),
    case("空载荷", ev=EV_EMPTY, rule="event_id_family", gen_want=("ID 解析失败", repr("ROBOT1.0_"), QQ_RULE)),
    case("199", ev=PAYLOAD[199], want=0),
    case("200", ev=PAYLOAD[200], want=0),
    case("201", ev=PAYLOAD[201], rule="event_id_family",
         gen_want=("ID 解析失败", repr(MID_201[:40]), QQ_RULE)),
    case("尾随\\n", bk=BK_NL, rule="batch_key_bad", gen_want=("批次键", repr(BK_NL))),
    case("尾随\\r\\n", bk=BK_CRLF, rule="batch_key_bad", gen_want=("批次键", repr(BK_CRLF))),
    case("尾空格", bk=BK_SP, rule="batch_key_bad", gen_want=("批次键", repr(BK_SP))),
    case("明细行键换行", ev="qq:G:ROBOT1.0_ok", rk=ROW_KEY_BAD, rule="row_key_format",
         gen_want=("明细行键", repr(ROW_KEY_BAD))),
]


def contract_dir(version):
    if version == "v1.9":
        return CONTRACT
    d = os.path.join(OUT, "contract-v110")
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(CONTRACT):
        if os.path.isfile(os.path.join(CONTRACT, f)):
            shutil.copyfile(os.path.join(CONTRACT, f), os.path.join(d, f))
    shutil.copyfile(os.path.join(PATCH, "detail-row.schema.json"), os.path.join(d, "detail-row.schema.json"))
    shutil.copyfile(os.path.join(PATCH, "channel-map.json"), os.path.join(d, "channel-map.json"))
    return d


GEN_CODE = """
import sys,json;sys.path.insert(0,%r);import uf003_identity as U
out={"why":"","ev":None}
def done(rc):
  print(json.dumps(out,ensure_ascii=False));sys.exit(rc)
try:
  c=U.load_contract();bk=%r;ev=%r;rk=%r
  if bk is not None:
    U.normalize_batch_key(bk);done(0)
  row=U.build_identity('qq',{'id':ev.split(':',2)[2],'group_openid':'G'},batch_key='user-feedback-20261124',
                       round4=1,row_no=1,contract=c,allow_qq_candidate=True)
  out["ev"]=row.get("来源事件标识")
  if rk is not None:
    row["明细行键"]=rk;out["why"]=U._row_shape_error(row,'QQ',c) or "";done(2 if out["why"] else 0)
  if out["ev"]!=ev:
    out["why"]=str(row.get("说明"));done(2)
  done(0)
except U.QQSegmentDrift as e:
  out["why"]=str(e);done(3)
except U.ResolveError as e:
  out["why"]=str(e);done(2)
"""

# r9 A 门禁脚本原样：内存契约把 QQ 族规则放宽成 \\Aqq:.*\\Z；syn=1 时显式走合成入口
GEN_TAMPER = """
import sys,json;sys.path.insert(0,%r);import uf003_identity as U
out={"why":"","ev":None,"assert":None}
def done(rc):
  print(json.dumps(out,ensure_ascii=False));sys.exit(rc)
try:
  c=json.loads(json.dumps(U.load_contract()));c['families']['QQ']=r'\\Aqq:.*\\Z'
  try:
    U.assert_assembled(c,'QQ','qq:G:ROBOT1.0_ok',True)
  except U.QQSegmentDrift:
    out['assert']='QQSegmentDrift'
  row=U.build_identity('qq',{'id':'ROBOT1.0_ok','group_openid':'G'},batch_key='user-feedback-20261124',
                       round4=1,row_no=1,contract=c,allow_qq_candidate=True,contract_is_synthetic=bool(%d))
  out["ev"]=row.get("来源事件标识");done(0)
except U.QQSegmentDrift as e:
  out["why"]=str(e);done(3)
except U.ResolveError as e:
  out["why"]=str(e);done(2)
"""


def gen(version, ev=None, bk=None, rk=None, cdir=None, code=GEN_CODE, args=None):
    """生成器侧：rc + 拒绝文本/结果 id（JSON 一行）。args 是 code 的格式化参数，默认 GEN_CODE 的 (ROOT, bk, ev, rk)。"""
    p = subprocess.run([PY, "-c", code % ((ROOT, bk, ev, rk) if args is None else args)], capture_output=True, text=True,
                       cwd=ROOT, env=dict(os.environ, UF003_CONTRACT_DIR=cdir or contract_dir(version)))
    try:
        info = json.loads(p.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return 3, {"why": (p.stderr or p.stdout)[-160:], "ev": None}
    return p.returncode, info


def judge(version, ev, bk, rk, base_row, cdir=None):
    """判定器侧：rc + report（读不出报告为 None）+ stdout/stderr。"""
    row = json.loads(base_row)
    row["record_id"] = "rec-u23-%s" % version
    for k, v in (("来源事件标识", ev), ("日报键", bk), ("明细行键", rk)):
        if v is not None:
            row[k] = v
    path = os.path.join(OUT, "judge-%s.ndjson" % version)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    cmd = [PY, os.path.join(ROOT, "tools", "conformance.py"), path, "--baseline", "",
           "--contract", version, "--channel-map", os.path.join(CONTRACT, "channel-map.json")]
    if cdir:
        cmd += ["--contract-dir", cdir]
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
    try:
        return p.returncode, json.loads(p.stdout), p.stdout, p.stderr
    except ValueError:
        return p.returncode, None, p.stdout, p.stderr


def drifted_dir(version):
    """在契约副本的 QQ 段尾部注入无语义的 (?#audit-noop)：判定器读 detail-row.<版本>，生成器读 detail-row.schema.json。"""
    src = contract_dir(version)
    d = os.path.join(OUT, "drift-%s" % version)
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(src, d)
    doc = json.load(open(os.path.join(d, "detail-row.%s.schema.json" % version), encoding="utf-8"))
    doc["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"] += "(?#audit-noop)"
    for name in ("detail-row.%s.schema.json" % version, "detail-row.schema.json"):
        with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
    return d, id_patterns.qq_segment_sha256(doc["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"])


def xver_dir(version, other):
    """r9 C：把 detail-row.<version>.schema.json 的 QQ 段整段换成 <other> 版的（哈希仍在冻结表，但属于别的版本）。

    未带版本号的 detail-row.schema.json 也一并换掉：生成器靠「它与哪个 detail-row.<版本> 逐字相同」认所在版本。"""
    d = os.path.join(OUT, "xver-%s" % version)
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(contract_dir("v1.10"), d)
    src = json.load(open(os.path.join(d, "detail-row.%s.schema.json" % other), encoding="utf-8"))
    doc = json.load(open(os.path.join(d, "detail-row.%s.schema.json" % version), encoding="utf-8"))
    doc["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"] = \
        src["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"]
    for name in ("detail-row.%s.schema.json" % version, "detail-row.schema.json"):
        with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
    return d, id_patterns.qq_segment_sha256(doc["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"])


def show_val(ev, bk, rk):
    if bk is not None:
        return repr(bk)
    if rk is not None:
        return "%s…(%d hex+\\n)" % (rk[:6], len(rk) - 1)
    return ev if len(ev) < 30 else "%s…(%d 个 a)" % (ev[:14], len(ev) - 14)


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "after"
    if tag != "after":
        print("REFUSE: 只有 after 一种标签；before 标签已删（包内 evidence 无改前副本可校验 sha256，不许只当字符串）")
        return 1
    inject = os.environ.get("UF003_U23_INJECT", "")
    if inject and inject not in INJECTS:
        print("REFUSE: UF003_U23_INJECT=%r 不是已登记的注入（%s）；未知取值不跑，"
              "免得把「没注入」的 9/9 当成「注入后通过」" % (inject, "/".join(INJECTS)))
        return 1
    os.makedirs(OUT, exist_ok=True)
    demo = os.path.join(OUT, "demo.ndjson")
    subprocess.run([PY, os.path.join(ROOT, "uf003_identity.py"), "--fixture-demo", demo], check=True,
                   capture_output=True, text=True, cwd=ROOT, env=dict(os.environ, UF003_CONTRACT_DIR=CONTRACT))
    with open(demo, encoding="utf-8") as fh:
        base = next(l for l in fh if json.loads(l)["来源渠道"] == "QQ")

    lines = ["", "## after（改后；断言 rc + 规则名 + 字段 + 非法值；UF003_U23_INJECT=%r）" % inject, "",
             "| 例 | 值 | 期望 | 生成器 v1.9 | 生成器 v1.10 | 判定器 v1.9 | 判定器 v1.10 | 判定器命中 规则(字段=值) | 生成器凭证 |",
             "|---|---|---|---|---|---|---|---|---|"]
    fails = []
    bad_cases = set()
    injected_detected = None
    for name, ev, bk, rk, want, want_rules, gen_want in CASES:
        j_ev, j_bk = ev, bk
        injected = name == "fake" and inject in INJECTS     # 门禁复现：只改 fake 例的判定器输入
        if injected:
            j_ev = INJECTS[inject][0]
            j_bk = INJECTS[inject][1] if INJECTS[inject][1] is not None else j_bk
        g = [gen(v, ev, bk, rk) for v in VERS]
        j = [judge(v, j_ev, j_bk, rk, base) for v in VERS]
        rcs = [x[0] for x in g] + [x[0] for x in j]
        case_fails = []
        if rcs != [want] * 4:
            case_fails.append("%s: rc 生成器%s 判定器%s ≠ 期望 %d" % (name, rcs[:2], rcs[2:], want))
        hit_txt = []
        for v, (rc, rep, so, se) in zip(VERS, j):
            if rep is None:
                case_fails.append("%s/判定器 %s: 无报告 rc=%d %s" % (name, v, rc, (se or so)[-100:]))
                continue
            got = {k: [(x.get("field"), x.get("value")) for x in xs] for k, xs in (rep.get("rules") or {}).items()}
            exp = {k: [fv] for k, fv in want_rules.items()}      # 判定器每条规则是一个 (field, value) 列表
            if got != exp:
                case_fails.append("%s/判定器 %s: 命中 %s ≠ 期望 %s" % (name, v, got, exp))
            if want == 0 and (rep["violations_total"] != 0 or rep["new_rows"] != 1):
                case_fails.append("%s/判定器 %s: rc=0 但 violations_total=%s new_rows=%s" % (name, v, rep["violations_total"], rep["new_rows"]))
            if rep["id_patterns_overlay"] != {"QQ": id_patterns.QQ_FAMILY}:
                case_fails.append("%s/判定器 %s: overlay 未生效 %s" % (name, v, sorted(rep["id_patterns_overlay"])))
            if rep.get("qq_segment_version") != v:
                case_fails.append("%s/判定器 %s: qq_segment_version=%r ≠ --contract %s" % (name, v, rep.get("qq_segment_version"), v))
            hit_txt.append(",".join("%s(%s)" % (k, fv[0]) for k, fv in want_rules.items()) or "-")
        for v, (rc, info) in zip(VERS, g):
            if gen_want:
                miss = [t for t in gen_want if t not in info["why"]]
                if miss:
                    case_fails.append("%s/生成器 %s: rc=%d 拒绝文本缺 %s：%s" % (name, v, rc, miss[:1], info["why"][:100]))
        if injected:
            # r9 B：注入是故障注入自证——判定器输入已换，fake 例必须 ✗。若仍全部相符，说明期望被改成了注入值（救绿）。
            injected_detected = bool(case_fails)
            if not case_fails:
                case_fails.append("%s: 注入 %r 未被检出（判定器输入已换成 %r，期望却仍相符：期望被改成了注入值？）"
                                  % (name, inject, j_ev))
        fails += case_fails
        if case_fails:
            bad_cases.add(name)
        gen_txt = "ok" if (gen_want and all(x[0] == want for x in g)) else ("-" if not gen_want else "✗")
        lines.append("| %s | `%s` | %d | %s | %s | %s |" % (name, show_val(ev, bk, rk), want, " | ".join(map(str, rcs)),
                     " / ".join(hit_txt), gen_txt))
    drift = []
    for v in VERS:
        d, actual = drifted_dir(v)
        rc_j, _, so_j, se_j = judge(v, "qq:G:ROBOT1.0_ok", None, None, base, cdir=d)
        rc_g, info_g = gen(v, "qq:G:ROBOT1.0_ok", cdir=d)
        for side, rc, text, extra in (("判定器", rc_j, se_j, so_j.strip()), ("生成器", rc_g, info_g["why"], "")):
            need = [id_patterns.QQ_DRIFT_TAG] + list(id_patterns.SHIPPED_QQ_FAMILY_SHA256) + [actual]
            miss = [t for t in need if t not in text]
            if rc != 3 or miss or extra or len(text.strip().splitlines()) != 1 or (side == "生成器" and info_g["ev"] is not None):
                fails.append("指纹漂移/%s %s: rc=%d 缺=%s 有结论=%s" % (v, side, rc, miss[:1], bool(extra)))
        drift.append("- %s：判定器 rc=%d、生成器 rc=%d，均单行点名「%s」且带冻结/实际 sha256，不出结论"
                     % (v, rc_j, rc_g, id_patterns.QQ_DRIFT_TAG))
    xver = []
    other = {"v1.9": "v1.10", "v1.10": "v1.9"}
    for v in VERS:
        d, actual = xver_dir(v, other[v])
        rc_j, _, so_j, se_j = judge(v, "qq:G:ROBOT1.0_ok", None, None, base, cdir=d)
        rc_g, info_g = gen(v, "qq:G:ROBOT1.0_ok", cdir=d)
        for side, rc, text, extra in (("判定器", rc_j, se_j, so_j.strip()), ("生成器", rc_g, info_g["why"], "")):
            need = [id_patterns.QQ_VERSION_TAG, actual, other[v], v] + list(id_patterns.SHIPPED_QQ_FAMILY_SHA256)
            miss = [t for t in need if t not in text]
            if rc != 3 or miss or extra or len(text.strip().splitlines()) != 1 or (side == "生成器" and info_g["ev"] is not None):
                fails.append("跨版本/%s %s: rc=%d 缺=%s 有结论=%s" % (v, side, rc, miss[:1], bool(extra)))
        xver.append("- %s 文件换入 %s QQ 段：判定器 rc=%d、生成器 rc=%d，均单行点名「%s」且带冻结/实际 sha256，不出结论"
                    % (v, other[v], rc_j, rc_g, id_patterns.QQ_VERSION_TAG))
    tamper = []
    for syn, want_rc, want_ev in ((0, 3, None), (1, 0, "REFUSE:synthetic-contract")):
        rc, info = gen("v1.9", code=GEN_TAMPER, args=(ROOT, syn))
        ok = (rc == want_rc and info["ev"] == want_ev and info.get("assert") == "QQSegmentDrift"
              and (syn or id_patterns.QQ_DRIFT_TAG in info["why"]))
        if not ok:
            fails.append("内存契约/syn=%d: rc=%d ev=%r assert=%r" % (syn, rc, info["ev"], info.get("assert")))
        tamper.append("- 内存契约 families[QQ]=\\Aqq:.*\\Z（%s）：assert_assembled 抛 QQSegmentDrift；build_identity rc=%d、%s"
                      % ("contract_is_synthetic=True" if syn else "未声明合成", rc,
                         "不产出 id，单行点名「%s」" % id_patterns.QQ_DRIFT_TAG if not syn else "只产出 %r" % info["ev"]))
    ok = len(CASES) - len(bad_cases)
    lines += ["", "after: %d/%d 例两侧 rc 一致且规则名/字段/非法值逐字相符（UF003_U23_INJECT=%r%s）"
              % (ok, len(CASES), inject,
                 "" if not inject else "；注入%s被检出" % ("" if injected_detected else "未")),
              "", "QQ 段指纹漂移拒判（注入 `(?#audit-noop)`）："] + drift
    lines += ["", "QQ 段跨版本拒判（整段互换，哈希仍在冻结表）："] + xver
    lines += ["", "内存契约不得绕过指纹（r9 A）："] + tamper
    lines += ["", "before 标签：已删（脚本拒绝；无改前副本可校验 sha256）"]
    with open(EVID, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines[-(6 + len(drift) + len(xver) + len(tamper)):-2]))
    for f in fails:
        print("✗ " + f)
    print("after: %d/%d；指纹漂移拒判 %s；跨版本拒判 %s；内存契约收口 %s"
          % (ok, len(CASES),
             "两侧一致" if not any(f.startswith("指纹漂移") for f in fails) else "✗",
             "两侧一致" if not any(f.startswith("跨版本") for f in fails) else "✗",
             "已收口" if not any(f.startswith("内存契约") for f in fails) else "✗"))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
