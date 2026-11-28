#!/usr/bin/env python3
"""003 明细行契约自检 v1.2（无第三方依赖，Python 3.9+）。

用法:
    python3 tools/conformance.py <export.ndjson|export.json> \
        [--baseline contract/history-baseline.ndjson] \
        [--channel-map contract/channel-map.json] \
        [--contract v1.9|v1.10] [--contract-dir contract] \
        [--json report.json] [--max-samples 0] [--allow-partial]

判定口径（与 SPEC v1.2 一致）：
  - 新行（record_id 不在基线里）→ 按 R1–R4 全量判；
  - 历史行（在基线里）→ 只判「仍存在」+「基线里所有非空字段未被改动」（空/缺列/null 不保护）；
  - 基线有、导出里没有的 record_id → history_missing（失败）；
  - 基线自身不合格（有行缺 record_id / record_id 重复）→ 直接拒绝，不猜。

退出码：0 = 通过；2 = 有违规；3 = 输入读不出来或分页不完整（不是「表是空的」）。
只读本地文件，不联网、不写远端。
"""
import argparse
import hashlib
from urllib.parse import urlsplit
import json
import os
import re
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import id_patterns  # noqa: E402  ID 族正则唯一真源（U2.3），与生成器同源
# 故意不给默认基线：随包的 2026-11-23 快照只用于演练，正式验收必须现场重冻后才有效。
DEFAULT_BASELINE = None
DEFAULT_MAP = os.path.join(HERE, "..", "contract", "channel-map.json")
DEFAULT_CONTRACT = os.path.join(HERE, "..", "contract")
CONTRACT_VERSION = None  # load_channels 读到的映射版本，报告里照实回显，不写死

EVENT_TYPES = {"初报", "补证", "复查", "阻塞"}
IDENTITY_VALUES = {"verified", "unverified"}
# \A…\Z 而非 $：$ 会放过尾随 \n（日报键 'user-feedback-20261124\n' 曾零违规 rc=0）
BATCH_RE = id_patterns.BATCH_KEY_RE
HEX64_RE = id_patterns.ROW_KEY_RE
def url_ok(line):
    """严格 URL：scheme http/https、主机名合法、端口 1-65535、无空白。"""
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029\ufeff]", line):
        return False
    if not re.match(r"^https?://\S+\Z", line):
        return False
    try:
        parts = urlsplit(line)
        host = parts.hostname
    except ValueError:
        return False
    if not host:
        return False
    if host == "localhost":
        pass
    else:
        labels = host.split(".")
        if len(labels) < 2:
            return False
        for lab in labels:
            if not re.match(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z", lab):
                return False
    if re.search(r"://[^/?#]*:(?=[/?#]|$)", line):     # 冒号后没有端口数字
        return False
    try:
        port = parts.port
    except ValueError:
        return False
    if port is not None and not (1 <= port <= 65535):
        return False
    return True
NO_URL = "无公开链接"
UNKNOWN_PREFIX = "unknown:"
# 占位 ID 必须带轮次，否则同一天多轮共用日期键会撞
UNKNOWN_RE = r"unknown:user-feedback-[0-9]{8}#[0-9]{4}:[0-9]+"
# 渠道族规则以 contract/detail-row.<version>.schema.json 的 channel_family_patterns 为唯一真源。
# 口径 1a（人类 2026-11-27 裁决）：v1.9 默认生效，v1.10 必须显式 --contract v1.10 才启用。
# 判定器不再自持一套口径：契约放宽了判定器没放（或反过来）都会让复核结论失效。
CHANNEL_PATTERNS = {}      # 由 load_contract() 按所选版本填充
FAMILY = {}
CONTRACT_SELECTED = "v1.9"
CONTRACT_SCHEMA_PATH = None
CONTRACT_SCHEMA_SHA256 = None
QQ_SEGMENT_SHA256 = None      # 实际采用的 schema QQ 段指纹（报告回显；匹配走 id_patterns 覆盖项）
QQ_SEGMENT_VERSION = None     # 该指纹绑定的契约版本（r9 C：必须与 --contract 相同，否则拒判）
ID_PATTERN_OVERLAY = {}   # 被实际采用的 id_patterns 覆盖项：渠道 → 正则（报告回显）


# ---------------- 契约版本三方核对（CONTRACT_VERSION，U2.8-CV）----------------
# 版本只能来自显式来源：契约文件名里的版本 / 文件内 x-contract-version / 调用方 --contract，
# 三者必须一致。任一不等 -> rc=3 CONTRACT_VERSION_MISMATCH（点名三个值）；
# 文件没写 x-contract-version -> rc=3 CONTRACT_VERSION_UNDECLARED。
# 唯一豁免是两份**冻结历史件**（v1.9 / v1.10，发布早于本键），用 sha256 钉死，不是按版本名开口子：
# 任何被改过字节的文件都不会命中豁免，改走 UNDECLARED。
LEGACY_NO_VERSION_KEY = {
    "475b8f0b38f404f97035cfe78fb6c58075200b6313310b6cce25c805dfee239b": "v1.9",
    "5daf972e9caf8e9560782075f72f7b36965b8eaa31074c86dd7fea2012709ed4": "v1.10",
}
FILENAME_VERSION_RE = re.compile(r"^detail-row\.(v[0-9]+(?:\.[0-9]+)*)\.schema\.json$")


ROLES = ("primary", "crosscheck")


def check_contract_version(path, caller_version, doc, raw, role="primary"):
    """三方核对；不通过一律抛 ReadError（上层统一 rc=3），成功返回实际版本号。

    角色显式指定，不做推断：
      role=primary    M1 pin 的主件，必须声明 x-contract-version；缺键 -> UNDECLARED（rc=3）。
      role=crosscheck 冻结历史件（v1.9 / v1.10）只作交叉校验，允许缺声明，
                      但仅限 sha256 命中 LEGACY_NO_VERSION_KEY 的**原字节**；改过字节仍 UNDECLARED。
                      crosscheck 不得产出放行结论（见 main 尾部：0 违规也 rc=3 CROSSCHECK_ONLY）。
    """
    m = FILENAME_VERSION_RE.match(os.path.basename(path))
    fname_version = m.group(1) if m else None
    sha = hashlib.sha256(raw).hexdigest()
    declared = doc.get("x-contract-version")
    if not isinstance(declared, str) or not declared.strip():
        legacy = LEGACY_NO_VERSION_KEY.get(sha)
        if legacy is not None and legacy == caller_version == fname_version:
            if role == "crosscheck":
                print("CONTRACT_VERSION_CROSSCHECK_NO_KEY version=%s sha256=%s file=%s"
                      % (legacy, sha, os.path.basename(path)), file=sys.stderr)
                return legacy
            print("CONTRACT_VERSION_GRANDFATHERED version=%s sha256=%s file=%s"
                  % (legacy, sha, os.path.basename(path)), file=sys.stderr)
            return legacy
        raise ReadError(
            "CONTRACT_VERSION_UNDECLARED：契约缺 x-contract-version（文件名版本=%s，x-contract-version=缺失，"
            "调用方 --contract=%s，file=%s，sha256=%s）"
            % (fname_version, caller_version, os.path.basename(path), sha))
    declared = declared.strip()
    if not (fname_version == declared == caller_version):
        raise ReadError(
            "CONTRACT_VERSION_MISMATCH：文件名版本=%s，x-contract-version=%s，调用方 --contract=%s（file=%s）"
            % (fname_version, declared, caller_version, os.path.basename(path)))
    return declared


def load_contract(version, contract_dir, role="primary"):
    """按 --contract 选定版本读 schema 并派生渠道族正则；读不出/派生不出就拒判（rc=3）。"""
    global CHANNEL_PATTERNS, FAMILY, CONTRACT_SELECTED
    global CONTRACT_SCHEMA_PATH, CONTRACT_SCHEMA_SHA256, QQ_SEGMENT_SHA256, QQ_SEGMENT_VERSION, ID_PATTERN_OVERLAY
    path = os.path.join(contract_dir, "detail-row.%s.schema.json" % version)
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        doc = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError) as exc:
        raise ReadError("契约 schema 不可用（--contract %s）：%s: %s" % (version, path, exc)) from exc
    if not isinstance(doc, dict):
        raise ReadError("契约 schema 顶层不是对象（--contract %s），拒绝判定" % version)
    VERSION_CHECKED = check_contract_version(path, version, doc, raw, role)  # 三方核对不过 -> ReadError -> rc=3
    pats = ((doc.get("properties") or {}).get("来源事件标识") or {}).get("channel_family_patterns")
    if not isinstance(pats, dict) or not pats:
        raise ReadError("契约 schema 缺 来源事件标识.channel_family_patterns（--contract %s），派生不出口径" % version)
    compiled = {}
    for cname, pat in pats.items():
        if not isinstance(pat, str) or not pat.strip():
            raise ReadError("契约 schema 的 %s 规则为空或非字符串（--contract %s），拒绝判定" % (cname, version))
        try:
            compiled[cname] = re.compile(pat)
        except re.error as exc:
            raise ReadError("契约 schema 的 %s 规则无法编译（--contract %s）：%s" % (cname, version, exc)) from exc
    # QQ 段指纹必须命中 id_patterns 冻结表**且属于 --contract 所选版本**：漂移或跨版本都拒判（rc=3，单行点名
    # 「QQ 段指纹漂移」/「QQ 段版本不符」+ 冻结/实际 sha256），不得回落 schema 正则（r8 E1：漂移后曾既放宽
    # fake/空载荷又收紧 200 载荷，且无提示；r9 C：v1.10 文件换入 v1.9 QQ 段后曾 rc=0、673 行、violations 0）。
    # 命中则按 id_patterns 判并在报告里点名；其余段逐字用契约。CHANNEL_PATTERNS 仍逐字回显 schema 原文，
    # FAMILY 才是实际用于匹配的编译结果。
    try:
        QQ_SEGMENT_VERSION = id_patterns.require_shipped_qq(pats.get("QQ"), "--contract %s" % version, version=version)
    except id_patterns.QQSegmentDrift as exc:
        raise ReadError(str(exc)) from exc
    QQ_SEGMENT_SHA256 = id_patterns.qq_segment_sha256(pats.get("QQ"))
    compiled["QQ"] = id_patterns.QQ_FAMILY_RE
    overlay = {"QQ": id_patterns.QQ_FAMILY}
    ID_PATTERN_OVERLAY.clear()
    ID_PATTERN_OVERLAY.update(overlay)
    CHANNEL_PATTERNS = dict(pats)
    FAMILY = compiled
    CONTRACT_SELECTED = version
    CONTRACT_SCHEMA_PATH = path
    CONTRACT_SCHEMA_SHA256 = hashlib.sha256(raw).hexdigest()
REQUIRED = ["工作项键", "日报键", "来源渠道", "来源事件标识", "证据", "事件序号", "事件类型", "明细行键", "身份档"]
HISTORY_FIELDS = ["工作项键", "日报键", "来源渠道", "来源事件标识", "证据"]
ALL_RULES = [
    "record_id_missing", "record_id_dup", "baseline_field_type",
    "missing_field", "workitem_key_empty", "batch_key_bad", "channel_bad", "event_id_family",
    "evidence_not_url", "evidence_leading_blank", "evidence_control_char", "event_type_bad", "seq_bad", "seq_type_bad",
    "seq_dup", "seq_gap", "row_key_format", "row_key_bad", "identity_bad", "identity_link_bad",
    "history_missing", "history_changed", "type_error",
]


class ReadError(Exception):
    pass


def load_channels(path):
    """渠道映射是判定器的白名单来源，必须整份可用；任何不合契约的地方一律拒判（rc=3）。

    第 30 轮 P1：旧实现把 rules/fallback 里读到的任何字符串直接并进白名单，
    于是「fallback.source = 非法渠道」等于把 非法渠道 加进合法枚举，`来源渠道=非法渠道`
    的行零违规通过——判定器被自己的配置关掉。这里改成：不在契约渠道枚举里的值直接拒判。
    """
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError) as exc:
        raise ReadError(f"渠道映射读不出来 {path}: {exc}") from exc
    if not isinstance(doc, dict):
        raise ReadError(f"渠道映射顶层不是对象（是 {type(doc).__name__}），拒绝判定")
    global CONTRACT_VERSION
    v = doc.get("version")
    CONTRACT_VERSION = v if isinstance(v, str) and v.strip() else None
    enum_desc = "/".join(sorted(FAMILY))
    rules = doc.get("rules", _MISSING)
    if rules is _MISSING or not isinstance(rules, list) or not rules:
        raise ReadError("渠道映射没有 rules 列表（或为空），白名单无从判定，拒绝判定")
    sources = []
    for i, rule in enumerate(rules, 1):
        if not isinstance(rule, dict):
            raise ReadError(f"rules 第 {i} 项不是对象（是 {type(rule).__name__}），拒绝判定")
        src = rule.get("source", _MISSING)
        if src is _MISSING:
            raise ReadError(f"rules 第 {i} 项缺 source：字段缺省不等于合法兜底，拒绝判定")
        if not isinstance(src, str) or not src.strip():
            # 显式 null 与 "" 都是「说了等于没说」，不能当合法 source 并进白名单
            raise ReadError(f"rules 第 {i} 项 source 不是非空字符串（{src!r}），拒绝判定")
        if src not in FAMILY:
            raise ReadError(f"rules 第 {i} 项 source={src!r} 不在契约渠道枚举里（{enum_desc}）："
                            f"把表外值并进白名单等于关掉 channel_bad，拒绝判定")
        if not isinstance(rule.get("target", _MISSING), str) or not rule["target"].strip():
            raise ReadError(f"rules 第 {i} 项 target 不是非空字符串（{rule.get('target')!r}），拒绝判定")
        if rule["target"] not in FAMILY:
            # 目标字面量同样必须落在契约枚举里：写成 邮箱/其他 这类同义差，
            # 飞书单选列里根本没有这一项，落表会被服务端按空值吞掉。
            raise ReadError(f"rules 第 {i} 项 target={rule['target']!r} 不在契约渠道枚举里（{enum_desc}）："
                            f"目标字面量必须与真表存量选项逐字相同，拒绝判定")
        sources.append(src)
    fb = doc.get("fallback", _MISSING)
    if fb is _MISSING:
        raise ReadError("渠道映射缺 fallback：兜底口径不明，拒绝判定")
    if not isinstance(fb, dict):
        raise ReadError(f"fallback 不是对象（是 {type(fb).__name__}），拒绝判定")
    fb_src = fb.get("source", _MISSING)
    if fb_src is _MISSING:
        raise ReadError("fallback 缺 source：字段缺省与显式 null 都不是合法兜底，拒绝判定")
    if not isinstance(fb_src, str) or not fb_src.strip():
        raise ReadError(f"fallback.source 不是非空字符串（{fb_src!r}）：显式 null 不算兜底，拒绝判定")
    if fb_src not in FAMILY:
        raise ReadError(f"fallback.source={fb_src!r} 不在契约渠道枚举里（{enum_desc}）："
                        f"把表外值并进白名单等于关掉 channel_bad，拒绝判定")
    fb_tgt = fb.get("target", _MISSING)
    if not isinstance(fb_tgt, str) or not fb_tgt.strip() or fb_tgt not in FAMILY:
        raise ReadError(f"fallback.target={fb_tgt!r} 不在契约渠道枚举里（{enum_desc}）：拒绝判定")
    sources.append(fb_src)
    dup = sorted({s for s in sources if sources.count(s) > 1})
    if dup:
        raise ReadError(f"rules/fallback 里 source 重复 {dup}：同一渠道两种去向，拒绝判定")
    return set(sources)


def no_lone_surrogate(obj, where):
    """JSON 允许 \\ud800 这类孤立代理项，但它不是合法 Unicode：落表、比较、打印都无法无损。

    第 30 轮 P2：这种值会一路走到输出层，在 stdout 编码处炸成 rc=1 + traceback；
    在入口就按「读不出来」拒判，才能稳定给 rc=3。
    """
    stack = [(obj, "行")]
    while stack:
        cur, path = stack.pop()
        if isinstance(cur, str):
            for ch in cur:
                if "\ud800" <= ch <= "\udfff":
                    raise ReadError(f"{where} 的 {path} 含孤立代理项（\\u{ord(ch):04x}）："
                                    f"不是合法 Unicode，拒绝判定")
        elif isinstance(cur, dict):
            for k, v in cur.items():
                stack.append((k, path + " 的键"))
                stack.append((v, f"{path}/{k}"))
        elif isinstance(cur, list):
            for i, v in enumerate(cur):
                stack.append((v, f"{path}[{i}]"))


def flatten_row(row, where):
    """统一成「字段在顶层」的形状。

    基线导出是 {"record_id": …, "fields": {…}}，当前导出是平铺字段。
    只认这两种：既嵌套 fields 又有别的顶层字段 → 形状不支持，直接拒绝，不猜。
    """
    if isinstance(row.get("record_id"), str) and not row["record_id"].strip():
        # 列式分支早就拒空白 ID，行式必须同一口径，否则 "   " 会被当合法记录身份对上
        raise ReadError(f"{where} 的 record_id 是空白字符串（{row['record_id']!r}）：记录 ID 必须非空白")
    no_lone_surrogate(row, where)          # 孤立代理项在入口就拒，别让它走到输出层炸编码
    if "fields" not in row:
        return row                                   # 平铺导出：record_id 就在顶层
    nested = row["fields"]
    if not isinstance(nested, dict):
        raise ReadError(f"{where} 的 fields 不是对象（是 {type(nested).__name__}），形状不支持")
    extra = [k for k in row if k not in ("fields", "record_id")]
    if extra:
        raise ReadError(f"{where} 既嵌套 fields 又有顶层字段 {extra[:3]}，形状不支持（拒绝猜测）")
    flat = dict(nested)
    has_top = "record_id" in row
    top = row.get("record_id")
    if "record_id" in flat:
        # 记录元数据只认顶层；fields 里再出现同名一律按歧义拒判，
        # 否则「内层 ID 被删」这种清空永远看不见（pop 掉就等于放过）。
        raise ReadError(f"{where} 的 fields 里出现 record_id={flat['record_id']!r}："
                        f"记录元数据只认顶层，同名内嵌形状有歧义，拒绝判定")
    if has_top:
        flat["record_id"] = top
    return flat


_MISSING = object()


_EMPTY = ("", "")


def _reject_const(x):
    """JSON 里的 NaN / Infinity / -Infinity 不是标准 JSON，也无法无损落到十进制。"""
    raise ReadError(f"输入里出现非标准数值 {x}（NaN/Infinity）：无法无损比较，拒绝判定")


def _loads(text):
    """统一入口：浮点走 Decimal，避免二进制 float 丢精度后造成假通过。"""
    return json.loads(text, parse_float=Decimal, parse_constant=_reject_const)


def _dec_str(d):
    """Decimal → 规范十进制字符串（不丢精度，不出现 1E+3 这类指数、不留尾零）。"""
    if not d.is_finite():
        return None
    if d == 0:
        return "0"
    s = format(d.normalize(), "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def _unwrap_once(c):
    """把「单元素数组」当列式包装解开一层；只在跨导出形状比较时用。"""
    return c[1][0] if (c and c[0] == "list" and len(c[1]) == 1) else c


def _canon(v, md=None):
    """把单元格归一成 (类型标签, 值)；返回 ((类型, 值), 是否无法解释)。

    类型保真：`false` 与 `"false"`、`3` 与 `"3"` 不相等（改类型也算改动）。
    空值统一成 _EMPTY：None / "" / 空数组合法为空；单元素数组按列式解包（只有列式包装能解箱）；
    多元素数组逐元素递归；任一元素无法解释即整体类型错。
    """
    if v is None:
        return _EMPTY, False
    if isinstance(v, bool):
        return ("bool", "true" if v else "false"), False
    if isinstance(v, str):
        return (_EMPTY, False) if v == "" else (("str", v), False)
    if isinstance(v, int):
        return ("num", str(v)), False
    if isinstance(v, Decimal):
        # 无损：Decimal 保留原始位数，3 与 3.0 归一成同一个 "3"，2^53+1 不会并到 2^53
        d = _dec_str(v)
        return (None, True) if d is None else (("num", d), False)
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):
            return None, True
        d = _dec_str(Decimal(repr(v)))
        return (None, True) if d is None else (("num", d), False)
    if isinstance(v, list):
        if len(v) == 0:
            return _EMPTY, False
        vals, bad = [], False
        for x in v:
            if isinstance(x, list):
                # 数组里再套数组：分不清是列式包装还是业务数组，不拆、按类型错报
                return None, True
            c, b = _canon(x, md)
            vals.append(c)
            bad = bad or b          # 任一元素无法解释即整体类型错，不能只取第一层的值
        return ("list", tuple(vals)), bad
    return None, True


def load_rows(path, allow_partial=False):
    """返回 (rows, mode)。mode: 'rows' | 'columnar'。"""
    try:
        with open(path, encoding="utf-8", newline="") as fh:   # 保留原始换行，别让通用换行把裸 CR 洗成 LF
            text = fh.read()
    except (OSError, UnicodeDecodeError) as exc:
        raise ReadError(f"打不开/解不开输入 {path}: {exc}") from exc
    if re.search(r"\r(?!\n)", text):
        raise ReadError("含裸 CR（后面没有 LF）的行分隔：无法确认真实换行，只接受 LF 或 CRLF")
    stripped = text.lstrip()
    if stripped.startswith("["):
        try:
            rows = _loads(stripped)
        except json.JSONDecodeError as exc:
            raise ReadError(f"JSON 数组解析失败: {exc}") from exc
        if not isinstance(rows, list):
            raise ReadError("顶层 JSON 不是数组")
        bad = [i for i, r in enumerate(rows, 1) if not isinstance(r, dict)]
        if bad:
            raise ReadError(f"数组第 {bad[:3]} 项不是对象（拒绝混合类型）")
        if not rows:
            raise ReadError("输入为空数组，无法判定（空导出不等于通过）")
        return [flatten_row(r, f"数组第 {i} 项") for i, r in enumerate(rows, 1)], "rows"
    if stripped.startswith("{"):
        try:
            doc = _loads(stripped)
        except json.JSONDecodeError:
            doc = None
        if doc is not None:
            data = doc.get("data") if isinstance(doc, dict) else None
            if isinstance(data, dict) and isinstance(data.get("fields"), list) and isinstance(data.get("data"), list):
                if "has_more" not in data:
                    raise ReadError("列式返回缺少 has_more 字段，无法判断是否取全：补成 false 再跑")
                hm = data.get("has_more")
                # 只认布尔 False；true / null / "false" / 1 都算「没取全或不可判」——字符串能骗过真假判断
                if hm is not False:
                    raise ReadError(f"分页状态不明（has_more={hm!r}）：必须是布尔 false 才算取全，先翻页取全再来")
                total = data.get("total")
                if total is not None:
                    if isinstance(total, bool) or not isinstance(total, int):
                        raise ReadError(f"total 类型不对（{total!r}，{type(total).__name__}）："
                                        f"必须是整数行数，2.0 / \"2\" 这类都不算取全证据")
                    if total < 0:
                        raise ReadError(f"total={total} 为负数，元数据不可信")
                    got = len(data.get("data") or [])
                    if total != got:
                        raise ReadError(f"分页不完整：total={total} ≠ 实际 {got} 行")
                fields = data["fields"]
                if not all(isinstance(x, str) for x in fields):
                    raise ReadError("列式返回的 fields 不是纯字符串数组")
                if len(set(fields)) != len(fields):
                    raise ReadError("列式返回的 fields 有重复列名")
                ids = data.get("record_id_list")
                if "record_id" in fields:
                    why = "没给 record_id_list，元数据来源不明" if ids is None else "record_id_list 会静默覆盖同名的业务列"
                    raise ReadError(f"列式返回的 fields 里出现 record_id（{why}）：拒绝歧义形状，请把记录 ID 只放在 record_id_list")
                if ids is not None and (not isinstance(ids, list) or len(ids) != len(data["data"])):
                    raise ReadError("record_id_list 与 data 行数不一致")
                if ids is not None:
                    for i, x in enumerate(ids, 1):
                        if not isinstance(x, str) or not x.strip():
                            raise ReadError(f"record_id_list 第 {i} 项不是非空字符串（{x!r}）："
                                            f"记录 ID 不做单元格解箱，也不接受数字/数组")
                out = []
                for i, line in enumerate(data["data"], 1):
                    if not isinstance(line, list):
                        raise ReadError(f"列式返回第 {i} 行不是数组")
                    if len(line) != len(fields):
                        raise ReadError(f"列式返回第 {i} 行有 {len(line)} 个单元格，fields 有 {len(fields)} 个")
                    row = {fields[j]: line[j] for j in range(len(fields))}
                    if ids is not None:
                        row["record_id"] = ids[i - 1]
                    out.append(row)
                if not out:
                    raise ReadError("列式返回 0 行，无法判定（空导出不等于通过）")
                return [flatten_row(r, "列式返回") for r in out], "columnar"
            if isinstance(doc, dict) and isinstance(doc.get("data"), dict) and "fields" in doc["data"]:
                raise ReadError("列式返回结构不完整（fields/data 形状不对）")
            return [flatten_row(doc, "单对象输入")], "rows"
    rows = []
    # 只按真实换行切：splitlines() 会在 U+0085/U+2028/U+2029 处断开，把合法行拆碎后
    # 直接 READ_FAIL（reviewer 第 20 轮 P2）。这些字符留在行内交给证据规则判脏。
    for no, line in enumerate(text.split("\n"), 1):
        line = line.rstrip("\r").strip(" \t")
        if not line:
            continue
        try:
            obj = _loads(line)
        except json.JSONDecodeError as exc:
            raise ReadError(f"第 {no} 行不是合法 JSON: {exc}") from exc
        if not isinstance(obj, dict):
            raise ReadError(f"第 {no} 行不是对象（ndjson 每行必须是对象）")
        rows.append(obj)
    if not rows:
        raise ReadError("输入为空，无法判定（空导出不等于通过）")
    return [flatten_row(r, f"第 {i} 行") for i, r in enumerate(rows, 1)], "rows"


class _Parser(argparse.ArgumentParser):
    """用法错误也必须是「结论不可信」，不能和「真不合契约」撞码。

    argparse 默认 --bad-arg / 缺位置参数 走 exit(2)，与「有真实不合契约」的 rc=2 同码，
    复核方和上游脚本就会把「参数打错」读成「表里确实有违规」。
    """

    def error(self, message):
        self.print_usage(sys.stderr)
        print(f"READ_FAIL: 参数不可用（{message}）：无法判定，拒绝出结论", file=sys.stderr)
        raise SystemExit(3)


def main():
    # 输出层兜底：PYTHONIOENCODING=ascii:strict 时，报告里的中文/偏远字符会让 print 抛
    # UnicodeEncodeError（rc=1 + traceback，复核方无法按码分流）。这里让编码不可表示时转义，不改编码。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="backslashreplace")
        except (AttributeError, ValueError):
            pass
    ap = _Parser()
    ap.add_argument("export")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE,
                    help="T0 上线前一刻重冻的全表导出；传空串 '' 表示明确放弃历史检查")
    ap.add_argument("--channel-map", default=DEFAULT_MAP)
    ap.add_argument("--contract", choices=("v1.9", "v1.10", "v1.11", "v1.12"), default="v1.9",
                    help="判定所用契约版本：v1.9 默认生效；v1.10 必须显式指定（人类裁决 1a）")
    ap.add_argument("--role", choices=ROLES, default="primary",
                    help="primary = M1 pin 的主件（必须声明版本键）；crosscheck = 冻结历史件交叉校验（不得放行）")
    ap.add_argument("--contract-dir", default=DEFAULT_CONTRACT,
                    help="契约目录，取 detail-row.<版本>.schema.json")
    ap.add_argument("--json", dest="json_out")
    ap.add_argument("--max-samples", type=int, default=0, help="0 = 输出全部违规明细")
    ap.add_argument("--allow-partial", action="store_true")
    args = ap.parse_args()

    try:
        if args.baseline is None:
            raise ReadError("必须显式给 --baseline <T0 前重冻的全表导出>；"
                            "随包 contract/history-baseline.ndjson 只是演练快照，不能直接当正式基线。"
                            "确要跳过历史检查请写 --baseline ''")
        rows, mode = load_rows(args.export, args.allow_partial)
        if args.baseline:
            if not os.path.exists(args.baseline):
                raise ReadError(f"基线文件不存在: {args.baseline}（历史检查不能跳过）")
            # 基线同样必须取全：未翻完页的基线会漏掉历史行，等于给历史检查开后门
            baseline_rows, base_mode = load_rows(args.baseline, allow_partial=False)
        else:
            baseline_rows, base_mode = [], mode
    except ReadError as exc:
        print(f"READ_FAIL: {exc}", file=sys.stderr)
        return 3
    except RecursionError:
        print("READ_FAIL: 输入嵌套过深（超过解析器递归上限），无法可靠解析，拒绝判定", file=sys.stderr)
        return 3

    def as_str(row, key, md=None):
        v = row.get(key)
        if v is None:
            return None, False
        if isinstance(v, str):
            return v, False
        if (md or mode) == "columnar" and isinstance(v, list) and len(v) == 1 and isinstance(v[0], str):
            return v[0], False           # 只有列式返回才拆单选/文本包装
        return None, True

    def as_int(row, key, md=None):
        v = row.get(key)
        if v is None:
            return None, False
        if isinstance(v, bool):
            return None, True
        if isinstance(v, int):
            return v, False
        if (md or mode) == "columnar" and isinstance(v, list) and len(v) == 1 and isinstance(v[0], int) and not isinstance(v[0], bool):
            return v[0], False
        return None, True               # 1.9 / "1" / 全角都算类型错

    try:
        load_contract(args.contract, args.contract_dir, args.role)
        channels = load_channels(args.channel_map)
    except ReadError as exc:
        # 契约/渠道映射不可用 = 白名单无从判定：必须 rc=3，不能让它冒成 traceback（rc=1）
        print(f"READ_FAIL: {exc}", file=sys.stderr)
        return 3

    baseline = {}
    for i, r in enumerate(baseline_rows, 1):
        rid = as_str(r, "record_id", base_mode)[0]
        if not rid:
            print(f"READ_FAIL: 基线第 {i} 行没有 record_id，拒绝判定", file=sys.stderr)
            return 3
        if rid in baseline:
            print(f"READ_FAIL: 基线 record_id 重复: {rid}", file=sys.stderr)
            return 3
        baseline[rid] = r

    V = {}

    def hit(rule, payload):
        V.setdefault(rule, []).append(payload)

    seen_ids = set()
    new_rows = 0
    history_rows = 0
    pending_channel = 0
    unknown_event_id = 0
    seq_scope = {}

    for idx, row in enumerate(rows, 1):
        rid_v, rid_bad = as_str(row, "record_id")
        rid = rid_v or f"row#{idx}"
        if rid_bad:
            hit("type_error", {"record_id": rid, "field": "record_id", "rule": "must be string"})
        if not rid_v:
            hit("record_id_missing", {"row": idx})
        elif rid_v in seen_ids:
            hit("record_id_dup", {"record_id": rid_v})
        else:
            seen_ids.add(rid_v)

        if rid in baseline:
            history_rows += 1
            base = baseline[rid]
            # 保护范围：基线里所有「有值」的字段（SPEC §1.3「不得清空任何已落数据」），
            # 不只五个；基线为空/缺列/null 的字段不保护——五字段与其余字段同一口径。
            for f in list(base.keys()) + [k for k in HISTORY_FIELDS if k not in base]:
                if f == "record_id":
                    continue
                cur, cur_bad = _canon(row.get(f), mode)
                old, old_bad = _canon(base.get(f), base_mode)
                if (not old_bad) and old == _EMPTY:
                    continue            # 基线本来就没有值 → 不保护（含 T0 前合法为空的列）
                if old_bad:
                    hit("baseline_field_type", {"record_id": rid, "field": f})
                    continue
                if cur_bad:
                    hit("type_error", {"record_id": rid, "field": f, "scope": "history"})
                    continue
                if cur != old:
                    # 只有跨导出形状（列式 vs 行式）才承认「单元素数组 = 列式包装」解一层；
                    # 同一形状下 ["a"] 与 "a" 是真实差异，静默拆包会放过类型/形状改动。
                    if mode != base_mode:
                        cur, old = _unwrap_once(cur), _unwrap_once(old)
                    if cur != old:
                        hit("history_changed", {"record_id": rid, "field": f, "before": old, "after": cur})
            continue

        new_rows += 1
        for f in REQUIRED:
            v = row.get(f)
            sv, sbad = as_str(row, f) if f != "事件序号" else (None, False)
            if f == "事件序号":
                iv, _ = as_int(row, f)
                empty = iv is None
            else:
                empty = (not sbad) and (sv is None or not sv.strip())
            if v is None or empty:
                hit("missing_field", {"record_id": rid, "field": f})

        wk, wk_bad = as_str(row, "工作项键")
        if wk_bad:
            hit("type_error", {"record_id": rid, "field": "工作项键"})
        if wk is not None and not wk.strip():
            hit("workitem_key_empty", {"record_id": rid})

        bk, bk_bad = as_str(row, "日报键")
        if bk_bad:
            hit("type_error", {"record_id": rid, "field": "日报键"})
        elif bk and not BATCH_RE.match(bk):
            hit("batch_key_bad", {"record_id": rid, "field": "日报键", "value": bk})

        ch, ch_bad = as_str(row, "来源渠道")
        ch_known = False
        if ch_bad:
            hit("type_error", {"record_id": rid, "field": "来源渠道"})
        elif ch is not None and ch.strip():
            if ch == "待映射":
                pending_channel += 1
                ch_known = True
            elif ch not in channels:
                hit("channel_bad", {"record_id": rid, "field": "来源渠道", "value": ch})
            else:
                ch_known = True

        ev, ev_bad = as_str(row, "来源事件标识")
        if ev_bad:
            hit("type_error", {"record_id": rid, "field": "来源事件标识"})
        if ev:
            if ev.startswith(UNKNOWN_PREFIX):
                unknown_event_id += 1
            fam = FAMILY.get(ch or "")
            if ch_known and fam is not None and not fam.match(ev):
                hit("event_id_family", {"record_id": rid, "field": "来源事件标识", "channel": ch, "value": ev})

        evd, evd_bad = as_str(row, "证据")
        if evd_bad:
            hit("type_error", {"record_id": rid, "field": "证据"})
        if evd:
            # 先整体拒控制字符：splitlines() 会把 U+0085/U+2028/U+2029 当换行吞掉，
            # 尾部这类字符就"看起来干净"了（reviewer 第 19 轮 P1）
            if re.search(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029\ufeff]", evd):
                hit("evidence_control_char", {"record_id": rid, "field": "证据", "value": evd})
            if evd[:1] in ("\n", "\r") or evd.startswith(" "):
                hit("evidence_leading_blank", {"record_id": rid, "field": "证据", "value": evd})
            raw_lines = evd.splitlines()
            lines = [x.strip() for x in raw_lines]
            if lines == [NO_URL]:
                pass
            elif not [x for x in lines if x]:
                hit("missing_field", {"record_id": rid, "field": "证据"})
            else:
                if any(not x for x in lines):          # 中间空行也算格式错
                    hit("evidence_leading_blank", {"record_id": rid, "field": "证据", "value": evd, "note": "证据里有空行"})
                for ln in [x for x in lines if x]:
                    if not url_ok(ln):
                        hit("evidence_not_url", {"record_id": rid, "line": ln})

        et, et_bad = as_str(row, "事件类型")
        if et_bad:
            hit("type_error", {"record_id": rid, "field": "事件类型"})
        elif et and et not in EVENT_TYPES:
            hit("event_type_bad", {"record_id": rid, "value": et})

        seq, seq_bad = as_int(row, "事件序号")
        if seq_bad:
            hit("seq_type_bad", {"record_id": rid, "value": repr(row.get("事件序号"))})
        elif seq is not None:
            if seq < 1:
                hit("seq_bad", {"record_id": rid, "value": seq})
            elif wk and et in EVENT_TYPES:
                seq_scope.setdefault((wk, et), []).append((seq, rid))

        rk, rk_bad = as_str(row, "明细行键")
        if rk_bad:
            hit("type_error", {"record_id": rid, "field": "明细行键"})
        if rk:
            if not HEX64_RE.match(rk):
                hit("row_key_format", {"record_id": rid, "field": "明细行键", "value": rk})
            elif wk and et in EVENT_TYPES and seq is not None and seq >= 1:
                want = hashlib.sha256(f"{wk}{et}{seq}".encode("utf-8")).hexdigest()
                if rk != want:
                    hit("row_key_bad", {"record_id": rid, "got": rk, "want": want})

        ident, ident_bad = as_str(row, "身份档")
        if ident_bad:
            hit("type_error", {"record_id": rid, "field": "身份档"})
        elif ident:
            if ident not in IDENTITY_VALUES:
                hit("identity_bad", {"record_id": rid, "value": ident})
            else:
                downgraded = (
                    (ev or "").startswith(UNKNOWN_PREFIX)
                    or not (evd or "").strip()
                    or (evd or "").strip() == NO_URL
                )
                if downgraded:
                    if ident != "unverified":
                        hit("identity_link_bad", {"record_id": rid, "reason": "降级值（unknown ID / 无证据）必须 unverified", "身份档": ident})
                elif ident == "verified" and not ev:
                    hit("identity_link_bad", {"record_id": rid, "reason": "verified 缺真实来源 ID"})

    for (wk, et), pairs in seq_scope.items():
        nums = sorted(n for n, _ in pairs)
        for n, rid in pairs:
            if nums.count(n) > 1:
                hit("seq_dup", {"工作项键": wk, "事件类型": et, "事件序号": n, "record_id": rid})
        expect = list(range(1, len(nums) + 1))
        if len(nums) == len(set(nums)) and nums != expect:
            hit("seq_gap", {"工作项键": wk, "事件类型": et, "got": nums, "expect": expect,
                            "record_ids": [rid for _, rid in pairs]})

    history_missing = sorted(set(baseline) - seen_ids)
    for rid in history_missing:
        hit("history_missing", {"record_id": rid})

    total = sum(len(v) for v in V.values())
    report = {
        "ok": total == 0,
        "contract": ("v" + CONTRACT_VERSION) if CONTRACT_VERSION else "unknown",
        "role": args.role,
        "contract_version": CONTRACT_SELECTED,
        "contract_schema": os.path.basename(CONTRACT_SCHEMA_PATH or ""),
        "contract_schema_sha256": CONTRACT_SCHEMA_SHA256,
        "qq_segment_sha256": QQ_SEGMENT_SHA256,
        "qq_segment_version": QQ_SEGMENT_VERSION,
        "input_mode": mode,
        "rows_total": len(rows),
        "new_rows": new_rows,
        "history_rows": history_rows,
        "history_missing": len(history_missing),
        "pending_channel": pending_channel,
        "unknown_event_id": unknown_event_id,
        "id_patterns_overlay": dict(ID_PATTERN_OVERLAY),
        "violations_total": total,
        "rules": {k: (v if args.max_samples <= 0 else v[: args.max_samples]) for k, v in V.items()},
        "rule_counts": {k: len(v) for k, v in V.items()},
        "pass_rules": [r for r in ALL_RULES if r not in V],
    }
    print("contract_version: %s (schema=%s sha256=%s)" % (
        CONTRACT_SELECTED, os.path.basename(CONTRACT_SCHEMA_PATH or "?"), CONTRACT_SCHEMA_SHA256),
        file=sys.stderr)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
    if args.role == "crosscheck":
        # 交叉校验件不得产出放行结论：即使 0 违规也不能 rc=0（上游只读 rc 会把它当「已通过」）。
        if total == 0:
            print("CROSSCHECK_ONLY: role=crosscheck 不产出放行结论（violations=0，"
                  "schema=%s sha256=%s）；要放行请用 --role primary"
                  % (os.path.basename(CONTRACT_SCHEMA_PATH or "?"), CONTRACT_SCHEMA_SHA256),
                  file=sys.stderr)
            return 3
        return 2
    return 0 if total == 0 else 2


if __name__ == "__main__":
    # 兜底：判定阶段（_canon 深数组递归等）也可能 RecursionError / 编码失败，
    # 这些都属于「结论不可信」，必须稳定给 rc=3 而不是 traceback + rc=1。
    try:
        sys.exit(main())
    except RecursionError:
        print("READ_FAIL: 输入嵌套过深（超过解析器递归上限），无法可靠判定", file=sys.stderr)
        sys.exit(3)
    except (UnicodeError, MemoryError) as exc:
        print(f"READ_FAIL: 输入规模或编码超出处理能力（{type(exc).__name__}）：结论不可信", file=sys.stderr)
        sys.exit(3)
