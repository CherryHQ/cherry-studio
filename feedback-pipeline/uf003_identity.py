#!/usr/bin/env python3
"""U1 采集侧身份：把候选/窗口记录解析成 003 契约要求的身份字段。

产出字段（契约 v1.9 口径）：
  来源渠道      契约 source 原值（企微/企业微信/QQ/Discord/Telegram/内部飞书/支持邮箱/其它/待映射）
  来源事件标识  真实消息 id，必须与渠道同族；取不到 → unknown:user-feedback-<YYYYMMDD>#<轮次>:<行号>
  证据          整列单一取值：可点开 URL 或 无公开链接，绝不混写
  说明          GitHub issue 链接、conv_id/seq、需成员权限的深链等不可点开上下文
  身份档        verified 仅当 来源事件标识 真实 且 证据 是采集侧明确标注公开的 URL

口径（U1-03 复核后收紧，逐条对应意见）：
  - 来源渠道按 channel-map.json 的 note「003 侧只写 source 原值，不做改名」写 source 原值；
    表外拼写（wecom/tg/dc/lark/qq/其他/邮箱…）归一到对应 source 值并留痕；无对应值 → 待映射。
  - 双向契约校验：本模块渠道值必须在 schema 枚举内；契约新增 source 而本模块缺族映射时启动即报错，
    绝不静默当未知族。
  - 证据不猜测：不再用 username 或数字拼链接去猜公开性（username=True 之类会造出假链接）；
    只有采集侧给出 public_url（https 且 public_confirmed=true）才写 URL 并 verified，其余一律
    无公开链接 + unverified，可能存在的深链（t.me/c、discord.com/channels）只进 说明。
  - 备用字段一律 first_present 取（跳过 None/空串）：企微 conv_id/seq 不可直接组成 id 时按
    rid/mid/rowid 回查 Info.db；TG chat/chat_id、Discord message_id/mid、QQ id/message_id 同。
  - 邮件事件 id 用 Message-ID（同一发件人的不同邮件必须可区分），发件地址只进 说明。
  - unknown: 占位要求显式轮次与行号，批次键只认 ASCII [0-9]{8}。
  - 待映射/其它 族原样保留取得的原始 id（不截断、不修剪、不加前缀），候选键覆盖所有解析器
    支持的 id 字段；严格族降级时原始 id 完整进 说明。
  - 组装后按契约族规则复核 id，不合规即抛错降级（例：seq 超过契约 12 位）。唯一例外是 QQ：
    契约 v1.9 正则与真实 id 不符（已知契约缺陷，PM v1.10 待发），该渠道改按候选正则校验，
    候选正则也不合规仍降级。
契约来源收口（r9 A）：生成侧与判定侧对同一份契约必须给同一结论。
  - 磁盘契约只在 load_contract() 读入，先过 require_shipped_qq（哈希 + 所在版本，与判定器同一函数）；
  - build_identity(contract=…) 收到外部契约时先过同一道门，再看它是否就是当前磁盘那一份（深比较）；
    两者任一不成立即「合成契约」——未显式 contract_is_synthetic=True 直接 REFUSE（rc≠0），
    显式声明也只产出 REFUSE 行（来源事件标识=REFUSE:synthetic-contract，不可入库）；
  - 生产 CLI（--selfcheck / --fixture-demo）没有通往合成入口的参数或环境变量。
版本不可判定 fail-closed（r10）：
  - 生成侧没有 --contract，所在版本只有两条**独立**线索，分开记在契约里、互不覆盖：sibling_version（目录里的
    detail-row.<版本>.schema.json 与主件整件逐字相同；否则 QQ 段逐字相同且唯一——主件其它字段被改过、但 QQ 段就是某版
    原文时按内容归该版）/ declared_version（显式 UF003_CONTRACT_VERSION，给「契约目录只带主件」的部署用），
    以及 qq_hash_tag（id_patterns 冻结表）。r9 的 contract_version 字段先记兄弟件版本、随即被哈希标签覆盖，已删。
  - 所在版本判不出（没有兄弟件 / 都不同 / 多于一个相同 / 环境变量不是已冻结版本）→ ContractVersionUnresolved：
    LOAD_FAIL 单行点名 CONTRACT_VERSION_UNRESOLVED、列出兄弟件与实际 sha256，rc=3，不写输出文件。
    不许退回「只核哈希」：主件 QQ 段换成另一版原文时任一版本都能自洽，r9 生成侧就是这样 rc=0 放行的。
  - 下游（_gate_reason / assert_assembled）核的是「sibling_version（或 declared_version）与 qq_hash_tag 都存在且相等，
    且等于**当前** QQ 段的冻结标签」：内存契约此后换段 → 版本不符；只贴了标签的手工 dict → 版本不可判定。
"""
from __future__ import annotations

import argparse
import hashlib
import copy
import json
import stat
import os
import re
import sqlite3
import sys
from urllib.parse import urlsplit
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "tools"))
import id_patterns  # noqa: E402  ID 族正则唯一真源（U2.3），与判定器 tools/conformance.py 同源
HOME = os.path.expanduser("~")
PROFILE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))  # 供报错路径展示，可能因软链层级偏移


def _find_contract_dir() -> str:
    """定位契约包：cache 与 workspace 在 HermesRuntime 下是平级软链，层级不能写死，逐一探测。"""
    env = os.environ.get("UF003_CONTRACT_DIR")
    if env:
        return env
    rel = "handoff-v1.9/uf-003-handoff-v1/contract"
    subs = ("cache/scratch", "cache/user-feedback/scratch")
    d = HERE
    for _ in range(8):
        for sub in subs:
            cand = os.path.join(d, sub, rel)
            if os.path.isdir(cand):
                return cand
        d = os.path.dirname(d)
        if d in ("/", HOME):
            break
    cand = os.path.join(HOME, "HermesRuntime/cache/user-feedback/scratch", rel)
    if os.path.isdir(cand):
        return cand
    raise ResolveError(f"找不到契约目录：从 {HERE} 及各软链位置均无 {rel}")
WECOM_DB = os.environ.get(
    "UF003_WECOM_DB",
    "/Users/cherryai003/WeCom-Agent-V2/WeCom-Agent/logs/wecom_decrypted/Info.db",
)
QQ_DB = os.environ.get(
    "UF003_QQ_DB", "/Users/cherryai003/.orca/services/qq-collector/data/messages.sqlite3"
)
NO_URL = "无公开链接"
UNKNOWN_PREFIX = "unknown:user-feedback-"
BATCH_KEY_BODY = id_patterns.BATCH_KEY_BODY   # 日报键 YYYYMMDD 段，唯一真源 tools/id_patterns.py
WECOM_SEQ_MAX = 999999999999          # 契约 wc:<conv>:<seq> 允许 seq 最多 12 位

# 待 PM 发 v1.10 的候选正则：真实 QQ 消息 id 含 '.'、'-'、'!' 且最长 161 字符。
# 只对 QQ 用于「契约缺陷」例外校验，不用于其它渠道。三条都取自 tools/id_patterns.py（U2.3 唯一真源）。
QQ_GROUP_RE = id_patterns.QQ_GROUP                     # group_openid
QQ_ID_BODY_RE = id_patterns.QQ_ID_BODY                # ROBOT1.<n>_ 之后的载荷，[1,200] 闭区间
PROPOSED_PATTERNS = {
    # 与 QQ_MSG_ID_RE 同源：同样的 group、同样的载荷长度上限，只允许主版本号漂移。
    # 两处各写一份时出现过「19X 字符解析过、族校验不过」和「ROBOT1.fake 族校验过、解析不过」，
    # 任何一种都会让自检的 rc 与真实落表行为不一致（reviewer 第 13 轮）。
    "QQ": id_patterns.QQ_EVENT_ID_BODY,
}
CONTRACT_DEFECT_CHANNELS = {"QQ"}     # 契约正则已知与真实 id 不符，改按候选正则校验
# 出厂（v1.9/v1.10）QQ 族规则的指纹集合在 id_patterns.SHIPPED_QQ_FAMILY_SHA256：只认「契约原文没被改过、且属于所在版本」这一件事。
# 不能每次去读当前契约再比较（那样正常调用时两边永远相等，例外就成了永久后门），
# 也不能把带多层转义的原文硬编码进源码（源码里数错一个反斜杠就静默失效）——用 sha256 冻结。
def qq_contract_is_shipped(contract: dict | None = None) -> bool:
    """契约里的 QQ 族规则是否仍是已发出的 v1.9/v1.10 原文，且其冻结标签 == 契约记录的所在版本（两条线索都在、相等；
    r10）。是才允许走 --allow-qq-candidate 例外。"""
    c = contract or load_contract()
    try:
        require_shipped_qq(c, "qq_contract_is_shipped")
    except QQSegmentDrift:
        return False
    return True


# QQ 消息 id 的唯一合法形态：解析器、候选族规则必须用同一条，否则 `/invalid` 这类值会在
# 解析阶段被放过、组装后才失败，把可用的备用键遮住（reviewer 第 7 轮 P1）。
QQ_MSG_ID_RE = id_patterns.QQ_MSG_ID


class ResolveError(Exception):
    """构成字段不可信/不可得。调用方据此降级或报错，绝不产出半截 id。"""


class QQSegmentDrift(ResolveError):
    """契约 QQ 段指纹漂移 / 与所在版本不符：与判定器 conformance.load_contract 同一条判定，直接拒（rc≠0），不回落 schema 正则。"""


class ContractVersionUnresolved(QQSegmentDrift):
    """所在契约版本不可判定（r10），不得退回「只核哈希」：rc=3、单行点名 CONTRACT_VERSION_UNRESOLVED、不写输出。
    情形：目录里没有 detail-row.<版本>.schema.json 且未显式声明；有但与主件整件、QQ 段都不同；与多于一个相同；
    UF003_CONTRACT_VERSION 不是已冻结版本；兄弟件枚举失败；内存契约没带 sibling_version / declared_version / qq_hash_tag。
    是 QQSegmentDrift 的子类：凡把 QQSegmentDrift 当 rc=3 的调用方对它同样处理。"""


CONTRACT_VERSION_TAG = id_patterns.CONTRACT_VERSION_UNRESOLVED_TAG
CONTRACT_VERSION_ENV = "UF003_CONTRACT_VERSION"


def _recorded_version(c: dict, where: str) -> str:
    """下游门用的所在版本：契约必须带 sibling_version（load_contract 按目录兄弟件逐字比对记录）或 declared_version
    （显式环境变量），且带 qq_hash_tag（冻结表标签），两者都存在且相等。
    缺任一（手工构造、只贴了标签）或互相矛盾 → ContractVersionUnresolved：不许拿标签自比自。"""
    sib = c.get("sibling_version")
    dec = c.get("declared_version")
    tag = c.get("qq_hash_tag")
    if sib is None and dec is None:
        raise ContractVersionUnresolved(
            "%s（%s）：契约未记录所在版本（sibling_version=%r，declared_version=%r，qq_hash_tag=%r），"
            "不得只核哈希放行；只有 load_contract() 从磁盘读入的契约才可用于生成"
            % (CONTRACT_VERSION_TAG, where, sib, dec, tag))
    if sib is not None and dec is not None and sib != dec:
        raise ContractVersionUnresolved(
            "%s（%s）：契约记录的所在版本互相矛盾（sibling_version=%s，declared_version=%s，qq_hash_tag=%s）"
            % (CONTRACT_VERSION_TAG, where, sib, dec, tag))
    bound = sib if sib is not None else dec
    if tag is None:
        raise ContractVersionUnresolved(
            "%s（%s）：契约未记录 QQ 段冻结标签（qq_hash_tag=None，所在版本 %s），不得只凭版本名放行"
            % (CONTRACT_VERSION_TAG, where, bound))
    return bound


def require_shipped_qq(c: dict | None, where: str) -> str:
    """r8 E1 / r9 C / r10：当前 QQ 段 sha256 必须在冻结表（否则「指纹漂移」），且其标签 == 契约记录的所在版本
    （sibling_version / declared_version 与 qq_hash_tag 都存在且相等；否则「版本不符」或 CONTRACT_VERSION_UNRESOLVED）。
    两侧同源（id_patterns.require_shipped_qq）；返回当前 QQ 段的冻结标签。"""
    c = c or {}
    qq = c.get("families", {}).get("QQ")
    actual = id_patterns.qq_segment_sha256(qq)
    if id_patterns.qq_segment_tag(qq) is None:
        # 先报指纹漂移（与判定器同一措辞、同一组 sha256），版本记录的问题排在其后
        raise QQSegmentDrift(id_patterns.drift_message(actual, where))
    try:
        return id_patterns.require_shipped_qq(qq, where, version=_recorded_version(c, where))
    except id_patterns.ContractVersionUnresolved as exc:
        raise ContractVersionUnresolved(str(exc)) from exc
    except id_patterns.QQSegmentDrift as exc:
        raise QQSegmentDrift(str(exc)) from exc


def _load_json(name: str, cdir: str | None = None) -> dict:
    with open(os.path.join(cdir or _find_contract_dir(), name), encoding="utf-8") as f:
        return json.load(f)


SIBLING_SCHEMA_RE = re.compile(r"\Adetail-row\.(v[0-9][0-9A-Za-z._-]*)\.schema\.json\Z")
SIB_SAME, SIB_QQ, SIB_DIFF, SIB_UNREADABLE = "整件逐字相同", "QQ 段逐字相同", "均不同", "读取/解析失败"
SRC_BYTES, SRC_QQ, SRC_ENV = "sibling-bytes", "sibling-qq-segment", "env"


def _declared_version() -> tuple[str | None, str]:
    """显式声明的所在版本 UF003_CONTRACT_VERSION（给「契约目录只带主件」的部署用）：返回 (归一化值 | None, 原始值)。
    是否合法（已冻结版本）、是否与哈希标签一致，由 _bind_contract_version 判。"""
    raw = os.environ.get(CONTRACT_VERSION_ENV)
    if raw is None or not raw.strip():
        return None, ""
    return id_patterns.norm_version(raw), raw


def _sibling_evidence(cdir: str, main_raw: bytes | None, main_qq) -> dict:
    """生成侧「所在版本」的独立线索（r10）：同目录各 detail-row.<版本>.schema.json 与主件的关系。

    两级都是逐字比较、都要求唯一，不读冻结表（版本不是从 QQ 哈希推出来的）：
      1) 整件字节相同（最强）——恰好一个 → 就是它；多于一个 → 不唯一，不再往下看；
      2) 没有整件相同的，再看 QQ 段：主件其它字段被改过、但 QQ 段与某版兄弟件原文逐字相同且只有一个 → 按内容归该版。
    都没有 / 都不唯一 → version=None，由 load_contract fail-closed。
    返回 {"files": {兄弟件名: 关系}, "byte": […], "qq": […], "version": str | None, "source": str | None, "error": str | None}。"""
    files: dict[str, str] = {}
    byte: list[str] = []
    qq: list[str] = []
    error = None
    if main_raw is None:
        error = "主件 detail-row.schema.json 读不出"
    try:
        names = sorted(os.listdir(cdir))
    except OSError as exc:
        names = []
        error = "兄弟件枚举失败 %s: %s" % (type(exc).__name__, exc)
    for n in names:
        m = SIBLING_SCHEMA_RE.match(n)
        if not m:
            continue
        ver = m.group(1)
        try:
            with open(os.path.join(cdir, n), "rb") as fh:
                raw = fh.read()
            if main_raw is not None and raw == main_raw:
                files[n] = SIB_SAME
                byte.append(ver)
                continue
            doc = json.loads(raw.decode("utf-8"))
            sq = ((doc.get("properties") or {}).get("来源事件标识") or {}).get("channel_family_patterns", {}).get("QQ")
        except (OSError, ValueError, AttributeError, TypeError):
            files[n] = SIB_UNREADABLE
            continue
        if isinstance(sq, str) and sq == main_qq:
            files[n] = SIB_QQ
            qq.append(ver)
        else:
            files[n] = SIB_DIFF
    if len(byte) == 1:
        return {"files": files, "byte": byte, "qq": qq, "version": byte[0], "source": SRC_BYTES, "error": error}
    if not byte and len(qq) == 1:
        return {"files": files, "byte": byte, "qq": qq, "version": qq[0], "source": SRC_QQ, "error": error}
    return {"files": files, "byte": byte, "qq": qq, "version": None, "source": None, "error": error}


def _sibling_schema_versions(cdir: str, name: str = "detail-row.schema.json") -> list[str]:
    """与主件整件逐字相同的兄弟件版本（r9 口径，保留给诊断）；所在版本的判定走 _sibling_evidence + _bind_contract_version。"""
    try:
        with open(os.path.join(cdir, name), "rb") as fh:
            raw = fh.read()
    except OSError:
        return []
    return _sibling_evidence(cdir, raw, None)["byte"]


def _unresolved_reason(ev: dict, declared: str | None, raw: str) -> str:
    if ev.get("error"):
        return "主件所在版本无法判定：%s" % ev["error"]
    if declared is not None and declared not in id_patterns.frozen_versions():
        return "%s=%r 不是已冻结版本（%s）" % (CONTRACT_VERSION_ENV, raw, "/".join(id_patterns.frozen_versions()))
    if not ev["files"]:
        return "主件所在版本无法判定：目录里没有 detail-row.<版本>.schema.json，且未显式声明版本"
    if len(ev["byte"]) > 1 or len(ev["qq"]) > 1:
        return "主件所在版本无法判定：与多于 1 个兄弟件相同（%s）" % ", ".join(ev["byte"] + ev["qq"])
    return "主件所在版本无法判定：与任一兄弟件都不逐字相同、QQ 段也不同"


def _unresolved_message(where: str, ev: dict, qq, declared: str | None, raw: str, reason: str) -> str:
    """单行：点名 CONTRACT_VERSION_UNRESOLVED + 兄弟件列表（各自与主件的关系）+ 主件 QQ 段实际 sha256（及其冻结标签）+ 环境变量。"""
    files = "、".join("%s=%s" % (n, s) for n, s in sorted(ev["files"].items())) or "无"
    actual = id_patterns.qq_segment_sha256(qq)
    tag = id_patterns.qq_segment_tag(qq)
    return ("%s（%s）：%s；兄弟件 [%s]；主件 detail-row.schema.json QQ 段 sha256 %s（冻结表：%s）；%s=%s。"
            "拒绝生成/入表（不写输出文件，不退回只核哈希）：补齐与主件整件（或 QQ 段）逐字相同且唯一的 detail-row.<版本>.schema.json，"
            "或对只带主件的契约目录显式 %s=%s（须与哈希标签一致、不得与兄弟件证据矛盾）"
            % (CONTRACT_VERSION_TAG, where, reason, files, actual, tag or "未冻结", CONTRACT_VERSION_ENV,
               repr(raw) if raw else "未设置", CONTRACT_VERSION_ENV, "/".join(id_patterns.frozen_versions())))


def _bind_contract_version(c: dict, cdir: str, where: str = "生成侧 load_contract") -> None:
    """r10：把所在版本的两条独立线索分别记进契约并核对，判不出即 ContractVersionUnresolved（fail-closed）。

    c["sibling_version"]  目录兄弟件逐字比对得出的版本（可能为 None）；c["sibling_files"] 各兄弟件与主件的关系
    c["declared_version"] 显式 UF003_CONTRACT_VERSION（可能为 None）；c["version_source"] 本次实际采用的线索
    c["qq_hash_tag"]      主件 QQ 段在 id_patterns 冻结表里的标签（require_shipped_qq 的返回值）
    绑定版本 = sibling_version，没有则 declared_version；必须与 qq_hash_tag 相等（id_patterns.require_shipped_qq，
    漂移/不符的措辞与判定器同一条）；显式声明与兄弟件证据矛盾 → 版本不符。"""
    qq = c["families"].get("QQ")
    try:
        with open(os.path.join(cdir, "detail-row.schema.json"), "rb") as fh:
            main_raw = fh.read()
    except OSError:
        main_raw = None
    ev = _sibling_evidence(cdir, main_raw, qq)
    declared, raw = _declared_version()
    c["sibling_files"] = ev["files"]
    c["sibling_version"] = ev["version"]
    c["declared_version"] = declared
    c["version_source"] = None
    c["qq_hash_tag"] = None
    c["qq_sha256"] = id_patterns.qq_segment_sha256(qq)
    if id_patterns.qq_segment_tag(qq) is None:
        # 指纹漂移先行（与判定器同一措辞），不让「版本不可判定」盖掉更根本的原因
        raise QQSegmentDrift(id_patterns.drift_message(c["qq_sha256"], where))
    if ev.get("error") or (declared is not None and declared not in id_patterns.frozen_versions()):
        # 兄弟件枚举不了就不认环境变量（无法确认它与目录证据不矛盾）；版本名不在冻结表里的声明不生效
        raise ContractVersionUnresolved(_unresolved_message(where, ev, qq, declared, raw, _unresolved_reason(ev, declared, raw)))
    if declared is not None and ev["version"] is not None and declared != ev["version"]:
        match = [n for n, s in ev["files"].items() if s in (SIB_SAME, SIB_QQ)]
        raise QQSegmentDrift(
            "%s（%s）：兄弟件 %s 与主件%s，所在版本 %s，与显式 %s=%r 矛盾；QQ 段 sha256 %s（冻结表 %s；冻结 sha256 %s）。"
            "拒绝生成/入表：去掉或改正环境变量，核对后同步更新 tools/id_patterns.py"
            % (id_patterns.QQ_VERSION_TAG, where, "/".join(match), ev["files"][match[0]], ev["version"], CONTRACT_VERSION_ENV, raw,
               c["qq_sha256"], id_patterns.qq_segment_tag(qq),
               " ".join("%s=%s" % (v, h) for h, v in id_patterns.SHIPPED_QQ_FAMILY_SHA256.items())))
    bound = ev["version"] if ev["version"] is not None else declared
    c["version_source"] = ev["source"] if ev["version"] is not None else (SRC_ENV if declared is not None else None)
    try:
        c["qq_hash_tag"] = id_patterns.require_shipped_qq(qq, where, version=bound)
    except id_patterns.ContractVersionUnresolved:
        raise ContractVersionUnresolved(_unresolved_message(where, ev, qq, declared, raw, _unresolved_reason(ev, declared, raw))) from None
    except id_patterns.QQSegmentDrift as exc:
        raise QQSegmentDrift(str(exc)) from exc


# 渠道值 → 族键（族键决定解析器）。键是 schema 枚举里的 source 原值。
FAMILY_BY_CHANNEL = {
    "企微": "wecom",
    "企业微信": "wecom",
    "QQ": "qq",
    "Telegram": "telegram",
    "Discord": "discord",
    "内部飞书": "feishu",
    "支持邮箱": "mail",
    "其它": "other",
    "待映射": "unknown",
}

# 表外拼写（采集器名/英文缩写/target_enum 拼写）→ 契约 source 值。只做拼写归一，不跨族合并。
# 微信/wx 故意不在表内：无法区分企业微信与个人微信，按 待映射 处理。
ALIAS_TO_CHANNEL = {
    "wecom": "企微", "wework": "企微", "wechatwork": "企微", "qywx": "企微",
    "qq": "QQ", "qqgroup": "QQ", "qq群": "QQ",
    "telegram": "Telegram", "tg": "Telegram", "电报": "Telegram",
    "discord": "Discord", "dc": "Discord",
    "feishu": "内部飞书", "lark": "内部飞书", "飞书": "内部飞书",
    "mail": "支持邮箱", "email": "支持邮箱", "e-mail": "支持邮箱",
    "邮箱": "支持邮箱",           # target_enum 拼写，上游采集器可能在用
    "other": "其它", "其它": "其它", "其他": "其它",  # 其他 = target_enum 拼写
    "": "待映射", "unknown": "待映射", "待映射": "待映射",
}


def _target_enum(schema: dict, channels: dict) -> list:
    """目标枚举只有一个真源：schema 的 来源渠道 enum 套 channel-map 的 rules 派生。

    v1.10 起 channel-map 不再手写 target_enum（两份真源必然漂移）。旧包仍带该字段时
    只做一致性核对：不一致就拒启动（ResolveError），不选一边信任、也不静默取并集。
    """
    rules = {r["source"]: r["target"] for r in channels["rules"]}
    fallback = channels["fallback"]["target"]
    derived: list = []
    for src in schema["properties"]["来源渠道"]["enum"]:
        tgt = rules.get(src, fallback)
        if tgt not in derived:
            derived.append(tgt)
    declared = channels.get("target_enum")
    if declared is not None and sorted(declared) != sorted(derived):
        raise ResolveError(
            f"channel-map target_enum 与派生结果不一致：声明 {sorted(declared)} / 派生 {sorted(derived)}；"
            "v1.10 起该字段应删除，只保留 schema enum + rules"
        )
    return derived


def load_contract() -> dict:
    cdir = _find_contract_dir()
    schema = _load_json("detail-row.schema.json", cdir)
    channels = _load_json("channel-map.json", cdir)
    c = {
        "schema": schema,
        "families": schema["properties"]["来源事件标识"]["channel_family_patterns"],
        "identity_values": schema["properties"]["身份档"]["enum"],
        "channel_enum": schema["properties"]["来源渠道"]["enum"],
        "event_types": schema["properties"]["事件类型"]["enum"],
        "channel_map_rules": {r["source"]: r["target"] for r in channels["rules"]},
        "channel_sources": [r["source"] for r in channels["rules"]],
        "target_enum": _target_enum(schema, channels),
        "fallback_channel": channels["fallback"]["source"],
    }
    # r10：所在版本必须可判定（fail-closed）。两条独立线索分开记、互不覆盖：sibling_version / declared_version（目录、环境变量）
    # 与 qq_hash_tag（冻结表）。r9 的 contract_version 先记兄弟件版本、下一行就被哈希标签覆盖，已删。
    # 随后 require_shipped_qq 同时核「哈希在冻结表」与「哈希属于记录的所在版本」，内存契约此后被换入另一版的 QQ 段 →
    # 与记录不符 → 拒。漂移/不符/不可判定即拒，不走下面的 schema 正则。
    _bind_contract_version(c, cdir)
    # 双向校验：本模块渠道值必须在 schema 枚举内；契约新增 source 必须有解析族映射。
    missing = [ch for ch in FAMILY_BY_CHANNEL if ch not in c["channel_enum"]]
    if missing:
        raise ResolveError(f"本模块渠道值 {missing} 不在 schema 来源渠道 枚举内，拒绝启动")
    unmapped = [ch for ch in c["channel_sources"] if ch not in FAMILY_BY_CHANNEL]
    if unmapped:
        raise ResolveError(
            f"契约新增来源 {unmapped} 在本模块无解析族映射，须先补 FAMILY_BY_CHANNEL（不得静默当未知族）"
        )
    c["family_by_channel"] = {ch: FAMILY_BY_CHANNEL[ch] for ch in c["channel_sources"]}
    return c


def contract_warnings(c: dict) -> list[str]:
    """契约自身的不一致：schema 枚举与 channel-map target_enum 并存两套值。"""
    schema_vals = set(c["channel_enum"])
    target_vals = set(c["target_enum"])
    only_schema = sorted(schema_vals - target_vals)
    only_target = sorted(target_vals - schema_vals)
    out = []
    if only_schema or only_target:
        out.append(
            "契约枚举不一致：仅 schema 有 " + "/".join(only_schema)
            + "；仅 channel-map target_enum 有 " + "/".join(only_target)
            + "。本模块写 schema 内的 source 原值，映射表口径待 PM 归一"
        )
    return out


# ---------- 严格取值工具 ----------

def first_present(rec: dict, *keys: str) -> Any:
    """按顺序取第一个非 None、非空白、非容器值：键存在但为空/类型非法不算「有」。"""
    for k in keys:
        v = rec.get(k)
        if v is None or isinstance(v, bool):
            continue
        if isinstance(v, (list, dict, tuple, set)):   # 容器不能字符串化后当消息 id
            continue
        if isinstance(v, str) and v.strip() == "":
            continue
        return v
    return None


def raw_id_candidates(rec: dict) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """返回 (可用标量原始 id 列表, 类型非法字段列表)，用于降级时无损留痕。"""
    good: list[tuple[str, str]] = []
    bad: list[tuple[str, str]] = []
    for k in RAW_ID_KEYS:
        if k not in rec or rec[k] is None:
            continue
        v = rec[k]
        if isinstance(v, (list, dict, tuple, set)):
            bad.append((k, type(v).__name__))
            continue
        if isinstance(v, bool) or (isinstance(v, str) and v.strip() == ""):
            continue
        try:
            sv = str(v)
        except ValueError:
            # 只有「连格式化都做不到」的整数才弃用；2**64 这类 20 位 id 必须照常保留（R2）
            bad.append((k, f"整数位宽 {v.bit_length()}，无法安全格式化"))
            continue
        good.append((k, sv))
    return good, bad


RAW_COLUMN_MAX = 50_000      # 落表护栏：超过即降级（schema/conformance 无限制，飞书列上限未核实，v1.10 待定）
TELEGRAM_MID_MAX = 2**31 - 1     # Telegram 消息 id 是 TL int（32 位）
SQLITE_INT_MAX = 2**63 - 1
def _clean_text(value: Any) -> str:
    """把无法 UTF-8 编码的字符（孤立代理项 \\ud800 等）转成可输出的转义文本。

    JSON 允许 `"\\ud800"` 解码成功，但 `open(..., encoding="utf-8").write` 与 stdout
    严格输出都会抛 UnicodeEncodeError，整份报告丢失（reviewer 第 13 轮）。
    """
    s = value if isinstance(value, str) else str(value)
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        s = s.encode("utf-8", "backslashreplace").decode("utf-8")
    return s


NOTE_MAX = 50_000            # 说明 字段安全上限（飞书多行文本 100k，留一半余量给后续 note）


NOTE_CLIP = 2_000          # 单条 note 上限：防止一条超长值把后面的原因全挤掉
RAW_DUMP_MAX = 512         # 说明 里回显原始值的上限（完整值仍不落盘，别声称有存档）


def _dump(v: Any, limit: int = RAW_DUMP_MAX) -> str:
    """把原始值转成可读回显；超长只留头并注明**原值**长度，绝不假装完整保留。

    长度口径统一用原值（str 用 len(v)，其它用 JSON 串）：否则同一行会同时出现
    「共 50003 字符」（JSON 加了引号/转义）和「长度 50001」，被复核当成矛盾。
    """
    try:
        d = json.dumps(v, ensure_ascii=False)
    except ValueError:
        # Python 3.11+ 默认 int→str 上限 4300 位：连 JSON 都序列化不了，只能说明「无法回显」，
        # 绝不能因此让整行构建失败（reviewer 第 10 轮 P1-e）
        bits = v.bit_length() if isinstance(v, int) else None
        return (f"<{type(v).__name__} 位宽 {bits}，超出本机整数格式化上限，无法回显>" if bits
                else f"<{type(v).__name__} 无法序列化，无法回显>")
    raw_len = len(v) if isinstance(v, str) else len(d)
    if raw_len <= limit:
        return d
    return f"{d[:limit]}…（原值 {raw_len} 字符，本行只回显前 {limit} 字符）"


def _clip(text: str, limit: int = NOTE_CLIP) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}…（本条共 {len(text)} 字符，已截断）"


def _clip_tail(text: str, limit: int = 120) -> str:
    """保留尾部：长路径从头裁剪会把真正出问题的组件裁掉（reviewer 第 20 轮 P2）。"""
    if len(text) <= limit:
        return text
    return f"…{text[-(limit - 1):]}"


def _raw_column_reason(s: str) -> str | None:
    """原样写进 来源事件标识 的原始 id 过 schema + conformance 两道规则：
    非空、无控制字符/换行（conformance 的 `.+$` 不跨行）；空格保留不修剪。
    超长只受落表护栏约束，返回的原因要说清到底是哪一条，不能一律说「含控制字符」。"""
    if not s:
        return "空字符串"
    if re.search(r"[\x00-\x1f\x7f]", s):
        return "含控制字符/换行，放进 来源事件标识 会被 conformance 判 event_id_family"
    if not _encodable(s):
        return "含无法 UTF-8 编码的字符（孤立代理项），不能原样落表"
    if len(s) > RAW_COLUMN_MAX:
        return f"长度 {len(s)} 超过落表安全上限 {RAW_COLUMN_MAX}（schema/conformance 均无此限制，属本模块护栏）"
    return None


def _raw_column_ok(s: str) -> bool:
    return _raw_column_reason(s) is None


def _first_valid(rec: dict, keys: tuple[str, ...], validator, label: str) -> Any:
    """按 keys 顺序逐个过 validator：前一个键值非法不能遮住后面合法的备用键。
    返回 validator 的返回值；全失败抛 ResolveError 并汇总每个键的原因（含被拒的原值摘要）。"""
    reasons: list[str] = []
    for k in keys:
        v = rec.get(k)
        if v is None or isinstance(v, bool) or isinstance(v, (list, dict, tuple, set)):
            continue
        try:
            return validator(v, k)
        except ResolveError as exc:
            reasons.append(str(exc))
        except Exception as exc:  # noqa: BLE001
            # 转换/格式化类异常（ValueError、OverflowError…）同样只废掉这个键
            reasons.append(f"{k}={type(v).__name__} 处理失败：{exc}")
    if not reasons:
        raise ResolveError(f"{label}: 没有可用的候选键（试过 {'/'.join(keys)}）")
    raise ResolveError(f"{label}: " + "；".join(reasons))


INT_BITS_MAX = 64          # 只约束「序号/时间戳」这类整数语义；标识类按能否格式化判断，不用位宽卡真实 id


def _too_big_int(v: Any) -> bool:
    """超位宽整数不能格式化：f-string/str() 会抛 ValueError 把整条解析打断（reviewer 第 7 轮 P1）。"""
    return isinstance(v, int) and not isinstance(v, bool) and v.bit_length() > INT_BITS_MAX


def strict_int(v: Any, name: str, minimum: int = 1, maximum: int | None = None) -> int:
    """只接受真整数或纯 ASCII 数字字符串；bool / 小数 / 科学计数一律拒绝，绝不截断。"""
    if isinstance(v, bool):
        raise ResolveError(f"{name}={v!r} 是布尔值，不是序号")
    if _too_big_int(v):
        raise ResolveError(f"{name} 位宽 {v.bit_length()} 超 {INT_BITS_MAX}，不可能是平台消息序号")
    if isinstance(v, int):
        n = v
    elif isinstance(v, str) and re.fullmatch(r"-?[0-9]+", v):
        digits = len(v.lstrip("-"))
        if digits > 19:
            # Python 3.11 的 int() 对超 4300 位会抛 ValueError；且 20 位以上不可能是任何平台序号
            raise ResolveError(f"{name} 位数 {digits} 超 19，不可能是平台消息序号")
        n = int(v)
    else:
        raise ResolveError(f"{name}={v!r} 不是合法整数，拒绝截断")
    if n < minimum:
        raise ResolveError(f"{name}={n} 小于下限 {minimum}")
    if maximum is not None and n > maximum:
        raise ResolveError(f"{name}={n} 超过上限 {maximum}")
    return n


def strict_token(v: Any, name: str, pattern: str) -> str:
    if v is None or isinstance(v, bool):
        raise ResolveError(f"{name} 缺失或类型非法（{type(v).__name__}）")
    if not isinstance(v, (str, int)):
        raise ResolveError(f"{name} 类型 {type(v).__name__} 不支持")
    try:
        s = str(v)
    except ValueError as exc:
        # 只有「连格式化都做不到」的整数才拒：真实 id 可能超过 int64（reviewer 第 9 轮 P1-e）
        raise ResolveError(f"{name} 整数位宽 {v.bit_length()}，无法安全格式化（{exc}）") from exc
    if not re.fullmatch(pattern, s):
        raise ResolveError(f"{name}={s[:40]!r} 不符合 {pattern}")
    return s


def _ro(path: str, immutable: bool = False) -> sqlite3.Connection:
    uri = f"file:{path}?mode=ro" + ("&immutable=1" if immutable else "")
    return sqlite3.connect(uri, uri=True)


# ---------- 各来源的 ID 解析 ----------

WECOM_CONV_RE = r"[A-Za-z0-9_-]{1,64}"


def _wecom_decode(row, key: str, probe: int, tried: list[str]) -> tuple[str, int] | None:
    """把一行 MESSAGE 校验成 (conv_s, seq_n)；不合格就留原因返回 None，让调用方继续试下一个键。
    校验必须在这里做完：先选中候选、事后再校验，会让不合格命中遮住合法的备用键。"""
    conv_raw, seq_raw = row[0], row[1]
    try:
        conv_s = strict_token(conv_raw, "conv_id", WECOM_CONV_RE)
    except ResolveError as exc:
        tried.append(f"{key}={probe} 命中行 conv_id 不可用：{exc}")
        return None
    try:
        seq_n = strict_int(seq_raw, "seq", maximum=WECOM_SEQ_MAX)
    except ResolveError as exc:
        tried.append(f"{key}={probe} 命中 {conv_s} 的 seq 不可用：{exc}（多为系统/通知行）")
        return None
    return conv_s, seq_n


def _wecom_lookup(rec: dict, attempts: list[str] | None = None) -> tuple[str, int, int]:
    """依次尝试 rid/mid（查 RID 列）与 rowid（查 SQLite 行号，语义不同不能混用）。

    任一键的值无效、命中多行（RID 在本库不是唯一约束）、行内 conv/seq 不合格，
    都只废掉这个键，不能遮住后面的备用键；全部失败才抛错并带回逐键原因。
    """
    tried: list[str] = []
    for key, col in (("rid", "RID"), ("mid", "RID"), ("rowid", "rowid")):
        raw = rec.get(key)
        if raw is None or isinstance(raw, (bool, list, dict, tuple, set)):
            continue
        try:
            probe = strict_int(raw, key, maximum=SQLITE_INT_MAX)
        except ResolveError as exc:
            tried.append(str(exc))
            continue
        try:
            con = _ro(WECOM_DB, immutable=True)
            try:
                rows = con.execute(
                    f"select conv_id, seq from MESSAGE where {col}=? limit 2", (probe,)
                ).fetchall()
            finally:
                con.close()
        except (sqlite3.Error, OverflowError, ValueError) as exc:
            tried.append(f"{key}={probe} 回查报错：{exc}")
            continue
        if not rows:
            tried.append(f"{key}={probe} 在 MESSAGE 表（{col}）查不到")
            continue
        if len(rows) > 1:
            tried.append(f"{key}={probe} 在 {col} 上命中多行，不能猜是哪条消息")
            continue
        got = _wecom_decode(rows[0], key, probe, tried)
        if got is None:
            continue
        if attempts is not None:
            attempts.extend(tried)
        return got[0], got[1], probe
    if not tried:
        raise ResolveError("wecom: 没有 rid/mid/rowid 可回查")
    raise ResolveError("wecom 回查失败：" + "；".join(tried))


def resolve_wecom(rec: dict) -> dict:
    """企微：契约要求 wc:<conv_id>:<seq>，seq 必须是会话内真实序号（不是导出行号）。"""
    conv = first_present(rec, "conv_id")
    seq = first_present(rec, "seq")
    looked_up = False
    rid_n = None
    try:
        conv_s = strict_token(conv, "conv_id", WECOM_CONV_RE)
        seq_n = strict_int(seq, "seq", maximum=WECOM_SEQ_MAX)
    except ResolveError as first_exc:
        attempts: list[str] = []
        try:
            conv, seq, rid_n = _wecom_lookup(rec, attempts)
        except ResolveError as lookup_exc:
            no_seq = isinstance(seq, str) and seq.strip() in ("0", "")
            hint = "（seq=0 多为系统/通知消息，不能当正文 id）" if no_seq else ""
            raise ResolveError(
                f"wecom: {first_exc}；RID/mid 回查 Info.db 也失败：{lookup_exc}{hint}"
            ) from first_exc
        conv_s = strict_token(conv, "conv_id", WECOM_CONV_RE)
        seq_n = strict_int(seq, "seq", maximum=WECOM_SEQ_MAX)
        looked_up = True
    note = f"conv_id={conv_s} seq={seq_n}"
    if looked_up:
        note += f"（由 RID {rid_n} 回查 Info.db MESSAGE 表取得）"
        if attempts:
            note += "；跳过的回查键：" + "；".join(attempts)
    return {"id": f"wc:{conv_s}:{seq_n}", "url": None, "link": None, "notes": [note]}


def _qq_group_for(mid_s: str, rec: dict, reasons: list[str]) -> str | None:
    """给定消息 id 找群：优先显式 group_openid，否则回查 collector 库。找不到只留原因。"""
    group = first_present(rec, "group_openid")
    if group is not None:
        try:
            return strict_token(group, "group_openid", QQ_GROUP_RE)
        except ResolveError as exc:
            reasons.append(str(exc))
            return None
    try:
        con = _ro(QQ_DB)
        try:
            rows = con.execute(
                "select distinct group_openid from messages where id=? limit 2", (mid_s,)
            ).fetchall()
        finally:
            con.close()
    except Exception as exc:  # noqa: BLE001
        reasons.append(f"qq 回查 collector 库失败: {exc}")
        return None
    if not rows:
        reasons.append(f"id={mid_s[:24]}… 在 collector 库查不到 group_openid")
        return None
    if len(rows) > 1:
        # (group_openid,id) 是复合主键：同一 id 出现在多个群时不能任选一个
        reasons.append(f"id={mid_s[:24]}… 同时出现在多个群（{rows[0][0]}/{rows[1][0]}），缺 group_openid 时不能猜")
        return None
    try:
        return strict_token(rows[0][0], "group_openid", QQ_GROUP_RE)
    except ResolveError as exc:
        reasons.append(str(exc))
        return None


class CandidateList(list):
    """候选列表，附带「组装阶段没成候选」的尾部失败原因。

    只把原因挂在候选上会漏掉最后一个候选之后的失败键（reviewer 第 10 轮 P1-d）。
    """

    reasons: list[str]

    def __init__(self, *args, reasons=None):
        super().__init__(*args)
        self.reasons = list(reasons or [])


def resolve_qq(rec: dict) -> list[dict]:
    """QQ：契约要求 qq:<group_openid>:<ROBOT1.0_…>。

    返回**候选列表**而不是单个结果：`id` 可能过得了格式校验、却查不到群或组装后不合族，
    此时必须能退到 `message_id`/`mid`（reviewer 第 8 轮 P1）。逐个候选独立找群。
    """
    dropped: list[str] = []          # 逐个键的失败原因，按处理顺序累积
    out: list[dict] = CandidateList()
    tail_from = 0                    # dropped 里「最后一个候选取走之后」的起点
    for key in ("id", "message_id", "mid"):
        if key not in rec or rec[key] is None:
            continue
        reasons: list[str] = []
        try:
            mid_s = strict_token(rec[key], f"qq 消息 id（{key}）", QQ_MSG_ID_RE)
        except ResolveError as exc:
            reasons.append(str(exc))
        if not reasons and any(c["id"].endswith(":" + mid_s) for c in out):
            continue          # 同一 id 换个键重复出现，不必再试
        group_s = None
        if not reasons:
            group_s = _qq_group_for(mid_s, rec, reasons)
        if group_s is None:
            dropped.extend(f"{key}: {r}" for r in (reasons or ["无可用值"]))
            continue
        out.append({"id": f"qq:{group_s}:{mid_s}", "url": None, "link": None,
                    "notes": [f"group_openid={group_s}"],
                    # 只有「它之前的候选」失败时，才把原因挂到这条采用的候选上
                    "dropped_before": list(dropped)})
        tail_from = len(dropped)
    if not out:
        raise ResolveError("qq: 没有可组装的候选；" + "；".join(dropped or ["无 id/message_id/mid 字段"]))
    out.reasons = list(dropped[tail_from:])
    return out


def resolve_telegram(rec: dict) -> dict:
    """t.me/c/<内部id> 需成员权限，不是公开证据：只进 说明，不进 证据。"""
    # chat id 是 int64 语义（可负），超位宽不可能是真实会话：按整数校验而不是按字符串
    chat_s = _first_valid(rec, ("chat", "chat_id"),
                          lambda v, k: str(strict_int(v, "chat_id", minimum=-(2 ** 63),
                                                      maximum=2 ** 63 - 1)), "telegram chat")
    mid_n = _first_valid(rec, ("mid", "message_id"),
                         lambda v, k: strict_int(v, "message_id", maximum=TELEGRAM_MID_MAX),
                         "telegram message_id")
    evid = f"tg:{chat_s}:{mid_n}"
    notes = _url_note(rec, "Telegram")
    note = f"chat_id={chat_s} message_id={mid_n}"
    link = None
    if chat_s.startswith("-100"):
        link = f"https://t.me/c/{chat_s[4:]}/{mid_n}"
        note += "；t.me/c 链接需群成员权限，非公开可点开"
    notes.insert(0, note)
    return {"id": evid, "url": None, "link": link, "notes": notes}


def resolve_discord(rec: dict) -> dict:
    g = _first_valid(rec, ("guild_id", "guild"),
                     lambda v, k: strict_token(v, "guild_id", r"[0-9]{1,32}"), "discord guild")
    ch = _first_valid(rec, ("channel_id", "channel"),
                      lambda v, k: strict_token(v, "channel_id", r"[0-9]{1,32}"), "discord channel")
    m = _first_valid(rec, ("message_id", "mid"),
                     lambda v, k: strict_token(v, "message_id", r"[0-9]{1,32}"), "discord message")
    evid = f"dc:{g}:{ch}:{m}"
    notes = _url_note(rec, "Discord")
    notes.insert(0, "Discord 频道链接需服务器成员权限，非公开可点开")
    return {"id": evid, "url": None,
            "link": f"https://discord.com/channels/{g}/{ch}/{m}", "notes": notes}


URL_RE = re.compile(r"^https?://[^\s]+\Z")


def _url_note(rec: dict, channel: str) -> list[str]:
    """public_url 只作为线索写进 说明，**永不升格为 证据**。

    第 6 轮复核用两类反例证明「链接归属」在当前离线数据上不可证：
      1) 同一 `t.me/<user>/<mid>` 配不同 `chat`/`public_url_event` 都能过旧校验——链接里的
         username 与数字 chat 之间没有任何可信绑定；
      2) `?comment=99` 这类参数会把目标改成评论，路径相同但指向不同对象。
    既然无法证明「就是这个事件」，就按规矩整列 `无公开链接`、身份档 `unverified`；
    需要可核验归属字段（平台回读校验等）属契约缺口，v1.10 提给 PM。
    """
    url = rec.get("public_url")
    if url is None:
        return []
    if not isinstance(url, str):
        return [f"public_url 类型 {type(url).__name__}，未采用"]
    if not URL_RE.match(url) or re.search(r"[\x00-\x1f\x7f]", url):
        return [f"public_url={url[:200]!r} 不是可用链接，未采用"]
    extra = []
    if not re.match(r"^https://", url):
        extra.append("非 https")
    if "?" in url or "#" in url:
        extra.append("带查询/片段参数，目标可变")
    tail = f"（{'，'.join(extra)}）" if extra else ""
    return [_clean_text(f"原文链接（归属未验证，仅作线索）{tail}：{url[:500]}")]






def resolve_feishu(rec: dict) -> dict:
    try:
        om_s = _first_valid(rec, ("om", "message_id", "mid"),
                            lambda v, k: strict_token(v, "message_id", r"om_[A-Za-z0-9_-]{1,64}"),
                            "feishu om_ 消息 id")
    except ResolveError as exc:
        raise ResolveError(f"feishu: 无 om_ 消息 id（{exc}）") from exc
    return {"id": om_s, "url": None, "link": None, "notes": ["内部飞书消息，无对外链接"]}


def resolve_mail(rec: dict) -> dict:
    """邮件事件 id 用 Message-ID：同一发件人的不同邮件必须可区分，发件地址只作上下文。"""
    def _mid_core(v, k):
        try:
            raw = str(v)
        except ValueError as exc:
            raise ResolveError(f"Message-ID {type(v).__name__} 无法格式化：{exc}") from exc
        core = raw[1:-1] if raw.startswith("<") and raw.endswith(">") else raw
        return strict_token(core, "Message-ID", r"[^@\s]+@[^\s]+")

    addr = first_present(rec, "from_address", "from", "addr")
    notes = [f"from={addr if isinstance(addr, str) else _dump(addr)}"] if addr is not None else []
    try:
        core_s = _first_valid(rec, ("message_id_header", "rfc_message_id", "message_id", "mid"),
                              _mid_core, "mail Message-ID")
    except ResolveError as exc:
        raise ResolveError(f"mail: 无可用 Message-ID（不能以发件地址充当事件 id）：{exc}") from exc
    notes.insert(0, f"Message-ID={core_s}")
    return {"id": f"mail:{core_s}", "url": None, "link": None, "notes": notes}


RESOLVERS = {
    "wecom": resolve_wecom,
    "qq": resolve_qq,
    "telegram": resolve_telegram,
    "discord": resolve_discord,
    "feishu": resolve_feishu,
    "mail": resolve_mail,
}

# 原始 id 候选键：覆盖所有解析器认的字段，降级时按此顺序取第一个可用的
RAW_ID_KEYS = ("id", "message_id", "message_id_header", "rfc_message_id", "mid", "om")


# ---------- 组装 ----------

def normalize_batch_key(batch_key: Any) -> str:
    s = str(batch_key if batch_key is not None else "")
    m = id_patterns.BATCH_KEY_RE.fullmatch(s)
    if m:
        return m.group(1)
    if re.fullmatch(BATCH_KEY_BODY, s):
        return s
    raise ResolveError(f"批次键 {batch_key!r} 既不是 user-feedback-YYYYMMDD 也不是 ASCII 8 位 YYYYMMDD")


def unknown_id(batch_key: Any, round4: Any, row_no: Any) -> str:
    if round4 is None or row_no is None:
        raise ResolveError("降级占位必须显式给轮次与行号（默认值会让同日多轮撞成同一行键）")
    bk = normalize_batch_key(batch_key)
    r = strict_int(round4, "轮次", minimum=1, maximum=9999)
    n = strict_int(row_no, "行号", minimum=1, maximum=9_999_999)
    return f"{UNKNOWN_PREFIX}{bk}#{r:04d}:{n}"


def channel_of(source: Any, c: dict) -> tuple[str, list[str]]:
    """契约 source 原值优先；表外拼写按别名归一；其余 待映射 并留痕。"""
    key = source if source is not None else ""
    notes: list[str] = []
    if key in c["channel_sources"] or key == c["fallback_channel"]:
        return key, notes
    alias = ALIAS_TO_CHANNEL.get(str(key).strip().lower())
    if alias:
        # 别名目标已被契约移除时不能静默退成 unknown 族（那会把不合族规则的原始 id 放进去）
        if alias not in c["channel_sources"] and alias != c["fallback_channel"]:
            raise ResolveError(
                f"来源键 {key!r} 归一为 {alias}，但契约 source 列已无该渠道（契约漂移，拒绝入表）"
            )
        return alias, [f"来源键 {key!r} 为表外拼写，按契约 source 值写 {alias}"]
    notes.append(f"来源键 {key!r} 不在 channel-map source 列，按契约 fallback 写 待映射（须计数告警）")
    return c["fallback_channel"], notes


def family_ok(channel: str, event_id: str, contract: dict | None = None) -> bool:
    """严格判定：契约里没有该渠道的族定义即判不合规，不默认放行。"""
    c = contract or load_contract()
    pat = c["families"].get(channel)
    if not pat:
        return False
    return re.fullmatch(pat, event_id) is not None


def family_ok_proposed(channel: str, event_id: str) -> bool:
    pat = PROPOSED_PATTERNS.get(channel)
    if not pat:
        return True
    return re.fullmatch(pat, event_id) is not None


def _family_verdict(c: dict, channel: str, event_id: str, allow_qq_candidate: bool) -> list[str]:
    """指纹门之后的规则复核（assert_assembled 的主体）；只在门已过（或合成契约的 REFUSE 流水线）后调用。

    QQ 候选正则只作为**显式开关**下的过渡，且只在契约 QQ 段仍是出厂原文时生效：默认以契约族规则为准，
    否则契约收紧后旧 id 会被候选规则永久放过（reviewer 第 6 轮）。生产路径上门已保证它是出厂原文；
    合成契约（内存改过 QQ 段）在这里一律按它自己的规则判，不走候选例外。"""
    if channel in CONTRACT_DEFECT_CHANNELS and allow_qq_candidate and qq_contract_is_shipped(c):
        if not family_ok_proposed(channel, event_id):
            raise ResolveError(f"组装结果 {event_id[:40]!r} 不符合候选正则，拒绝入表")
        return [f"契约 {channel} 正则与真实 id 不符，按候选正则校验通过（--allow-qq-candidate 显式开启，PM v1.10 待发）"]
    if not family_ok(channel, event_id, c):
        raise ResolveError(f"组装结果 {event_id[:40]!r} 不符合 {channel} 契约族规则，拒绝入表")
    return []


def assert_assembled(c: dict, channel: str, event_id: str, allow_qq_candidate: bool = False) -> list[str]:
    """组装后用契约族规则复核；不合规抛错降级。

    r9 A：先过指纹门（哈希在冻结表 + 属于契约所在版本），未冻结即拒——不再对内存契约「优先按新契约校验」
    （那正是门禁 r8 的洞：判定侧拒、生成侧放行）。占位 id 不看正则，但门照过。"""
    require_shipped_qq(c, "生成侧 assert_assembled")
    if str(event_id).startswith(UNKNOWN_PREFIX):
        return []
    return _family_verdict(c, channel, event_id, allow_qq_candidate)


SYNTHETIC_REFUSE_ID = "REFUSE:synthetic-contract"   # 合成契约行的 来源事件标识：任何契约族都不接受，不可入库
SYNTHETIC_REFUSE_NOTE = "REFUSE：合成契约（内存构造，未过指纹/同源校验）仅供测试复核，本行不可入库"


def _gate_reason(c: dict) -> str | None:
    """与判定器同一道门（require_shipped_qq）：None = 过门；否则单行原因（指纹漂移 / 版本不符 / CONTRACT_VERSION_UNRESOLVED，
    后者：外部契约没带 sibling_version / declared_version 与 qq_hash_tag，r10 不再只核哈希）。"""
    try:
        require_shipped_qq(c, "生成侧 build_identity")
    except QQSegmentDrift as exc:
        return str(exc)
    return None


def build_identity(
    source: str,
    rec: dict,
    *,
    batch_key: str | None = None,
    round4: int | None = None,
    row_no: int | None = None,
    issue_urls: list[str] | None = None,
    extra_note: list[str] | None = None,
    contract: dict | None = None,
    allow_qq_candidate: bool = False,
    contract_is_synthetic: bool = False,
) -> dict:
    """返回一行 003 身份字段。解析失败才降级；无合法批次键/轮次/行号时直接抛错。

    r9 A：外部传入的 contract 先过 require_shipped_qq（与判定器同一函数），再与当前磁盘契约深比较；
    任一不成立即为「合成契约」——未显式 contract_is_synthetic=True 时 REFUSE（抛错，rc≠0），显式声明时
    跑完整流水线但只产出 REFUSE 行（来源事件标识=SYNTHETIC_REFUSE_ID），不产出任何可入库标识。
    """
    gate = _gate_reason(contract) if contract is not None else None
    loaded = load_contract()
    synthetic = contract is not None and (contract_is_synthetic or gate is not None or contract != loaded)
    if synthetic and not contract_is_synthetic:
        if gate is not None:
            raise QQSegmentDrift(gate)
        raise ResolveError("REFUSE: 外部传入的契约与当前磁盘契约不一致（合成契约），未显式 contract_is_synthetic=True，拒绝产出")
    c = contract if contract is not None else loaded
    ch, notes = channel_of(source, c)
    if synthetic:
        notes.insert(0, SYNTHETIC_REFUSE_NOTE + ("；" + gate if gate else ""))
    check_assembled = _family_verdict if synthetic else assert_assembled
    # public_url 只作线索：无论解析成功、降级还是无解析器，都必须带进 说明（reviewer 第 7 轮 P2）
    url_notes = _url_note(rec, ch)
    notes.extend(url_notes)
    fam = c["family_by_channel"].get(ch, "unknown")

    out: dict[str, Any] = {"来源渠道": ch}
    resolver = RESOLVERS.get(fam)
    degraded = False
    link = None
    if resolver is None:
        degraded = True
        notes.append(f"渠道 {ch} 无 id 解析规则，只有原始 id 可保留")
    else:
        try:
            r = resolver(rec)
            cands = r if isinstance(r, list) else [r]
            # 解析器只在「没组装成候选」时才带这个字段；普通列表/字典没有，取空即可
            tail_reasons: list[str] = list(getattr(r, "reasons", None) or [])
            last_exc: ResolveError | None = None
            rejected: list[str] = []       # 逐个候选的失败原因，成功的候选也把前面失败的带上
            prior: list[str] = []          # 解析阶段就没组装的键（如 QQ 查不到群）
            for cand in cands:
                prior.extend(cand.get("dropped_before") or [])
                try:
                    cand_notes = check_assembled(c, ch, cand["id"], allow_qq_candidate)
                except ResolveError as exc:
                    last_exc = exc          # 这个候选不合族，继续试下一个，别让它遮住备用键
                    rejected.append(f"{str(cand['id'])[:40]}：{exc}")
                    continue
                out["来源事件标识"] = cand["id"]
                out["证据"] = cand.get("url") or NO_URL
                link = cand.get("link")
                notes.extend(cand.get("notes") or [])
                failed = list(dict.fromkeys(prior + rejected))
                if failed:
                    notes.append("此前候选未采用：" + "；".join(failed))
                notes.extend(cand_notes)
                break
            else:
                # 全部失败时逐条留原因：只报最后一个异常会丢掉「首选查不到群」这类关键信息
                detail = list(dict.fromkeys(prior + rejected + tail_reasons))
                raise ResolveError(("所有候选都不可用：" + "；".join(detail)) if detail
                                   else str(last_exc or "没有可用候选"))
        except ResolveError as exc:
            degraded = True
            notes.append(f"ID 解析失败：{exc}")

    if degraded:
        good, bad_types = raw_id_candidates(rec)
        for k, tname in bad_types:
            notes.append(f"原始字段 {k} 不可用作 id（{tname}），未采用")
        keep_raw = fam in ("other", "unknown")   # 只有契约族接受任意值的渠道能原样写原始 id
        # 不能只取 good[0]：首字段非法（含控制字符/超长）或不合族时，必须继续试后续候选
        chosen = None
        for k, v in good:
            reason = _raw_column_reason(v)
            if reason:
                notes.append(f"原始字段 {k}={_dump(v)}：{reason}")
                continue
            if keep_raw and family_ok(ch, v, c):
                chosen = (k, v)
                break
            if keep_raw:
                notes.append(f"原始字段 {k}={_dump(v)} 不符合 {ch} 契约族规则，跳过")
        if good and not keep_raw:
            k0, v0 = good[0]
            notes.append(f"原始 id（取自 {k0}）={_dump(v0)}：{ch} 的 id 需按族规则组装，不原样使用")
        if good and len(good) > 1:
            # 解析失败的字段也要完整留痕，不能被无关的 id 顶掉（reviewer 第 2 条）
            others = "；".join(f"{k}={_dump(v)}" for k, v in good[1:])
            notes.append(f"另有原始 id 字段（同为本行候选，回显仅前 {RAW_DUMP_MAX} 字符）：{others}")
        raw_ok = bool(chosen)
        if chosen and raw_ok:
            # 原样写出：不截断、不修剪、不加前缀（同源去重键必须稳定）
            out["来源事件标识"] = chosen[1]
            out["证据"] = NO_URL
            notes.append(f"原始 id 取自 {chosen[0]}，未经归一化；PM 映射渠道后需按新族重算")
        else:
            if chosen:
                why = _raw_column_reason(chosen[1]) or f"{ch} 契约族规则不接受该值"
                notes.append(f"原始 id（取自 {chosen[0]}）={_dump(chosen[1])}：{why}")
            if not batch_key:
                raise ResolveError(
                    "解析失败且未给批次键，不能生成合规 id（见 说明 里的原始 id）"
                    + (f"；最近一条原因：{next((n for n in notes if n.startswith('ID 解析失败')), notes[-1] if notes else '')}")
                )
            placeholder = unknown_id(batch_key, round4, row_no)
            # 占位也必须过（可能已被 PM 收紧的）契约族规则：不合规就显式失败，不能输出不合规行
            if not family_ok(ch, placeholder, c):
                raise ResolveError(
                    f"降级占位 {placeholder!r} 不符合收紧后的 {ch} 契约族规则，拒绝输出不合规行"
                )
            out["来源事件标识"] = placeholder
            out["证据"] = NO_URL

    # 统一可编码护栏：任何渠道都不许把不可 UTF-8 编码的 id 落表（否则报告/落表全崩）
    cur0 = str(out["来源事件标识"])
    if not cur0.startswith(UNKNOWN_PREFIX) and not _encodable(cur0):
        notes.append("来源事件标识 含无法 UTF-8 编码的字符（孤立代理项），改为占位")
        if not batch_key:
            raise ResolveError("真实 id 含不可编码字符且未给批次键，不能生成合规 id")
        ph = unknown_id(batch_key, round4, row_no)
        # 与长度降级同一条复验：占位也必须过（可能已被 PM 收紧的）契约族规则
        if not family_ok(ch, ph, c):
            raise ResolveError(f"降级占位 {ph!r} 不符合收紧后的 {ch} 契约族规则，拒绝输出不合规行")
        out["来源事件标识"] = ph
        out["证据"] = NO_URL

    # 统一长度护栏：任何渠道、任何来源的真实 id 超限都降级（resolver 路径也不例外）
    cur = str(out["来源事件标识"])
    if not cur.startswith(UNKNOWN_PREFIX) and len(cur) > RAW_COLUMN_MAX:
        notes.append(f"来源事件标识 长度 {len(cur)} 超过落表护栏 {RAW_COLUMN_MAX}"
                     f"（schema/conformance 无此限制，属本模块护栏），改为占位")
        if not batch_key:
            raise ResolveError("真实 id 超长且未给批次键，不能生成合规 id")
        placeholder = unknown_id(batch_key, round4, row_no)
        # 长度降级同样不能输出不合规行（reviewer 第 7 轮 P1）
        if not family_ok(ch, placeholder, c):
            raise ResolveError(
                f"长度降级占位 {placeholder!r} 不符合 {ch} 契约族规则，拒绝输出不合规行"
            )
        out["来源事件标识"] = placeholder
        out["证据"] = NO_URL

    if link:
        notes.append(f"深链（需成员权限，非公开可点开）：{link}")
    if issue_urls:
        notes.extend(issue_urls)
    if extra_note:
        notes.extend(extra_note)
    merged = _clean_text("\n".join(dict.fromkeys(_clip(n) for n in notes if n)))
    if len(merged) > NOTE_MAX:
        tail = (f"\n…说明超过 {NOTE_MAX} 字符已截断（超出部分未随本行保留，"
                f"需从采集窗口复核，本模块不做存档承诺）")
        merged = merged[:NOTE_MAX - len(tail)] + tail
    assert len(merged) <= NOTE_MAX
    out["说明"] = merged

    real_id = not str(out["来源事件标识"]).startswith(UNKNOWN_PREFIX)
    # 证据列当前恒为 无公开链接（见 _url_note：离线无法证明链接归属），故 verified 暂不可达；
    # 保留该判定，等 v1.10 给出可核验归属字段后自动生效。
    has_public_url = str(out["证据"]).startswith("https://")
    out["身份档"] = "verified" if (real_id and has_public_url) else "unverified"
    if out["身份档"] not in c["identity_values"]:
        raise ResolveError(f"身份档 {out['身份档']} 不在契约枚举内")
    if synthetic:
        # 合成契约只能得出 REFUSE 结论：流水线结果只留在 说明 里供测试核对，ID 列一律是不可入库的标记
        out["来源事件标识"], out["证据"], out["身份档"] = SYNTHETIC_REFUSE_ID, NO_URL, "unverified"
    return out


# ---------- 自检 ----------

def _sanitize_report(obj: Any) -> Any:
    """递归清洗报告里的字符串：任一层残留孤立代理项都会让整份报告写不出去。"""
    if isinstance(obj, str):
        return _clean_text(obj)
    if isinstance(obj, dict):
        return {(_clean_text(k) if isinstance(k, str) else k): _sanitize_report(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_report(v) for v in obj]
    return obj


# C0(0x00-0x1F，允许的 \n 在外层按行分隔处理)、DEL、C1(0x80-0x9F)、U+2028/U+2029、BOM
CONTROL_RE = r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029\ufeff]"


def _is_full_url(line: str) -> bool:
    """严格 URL，规则逐条对齐 `tools/conformance.py:url_ok`（同一验收标准，不能各写一套）。

    `http://`、`http://:80`、`http://[`、`https://a.test:0`、`https://a.test:`、
    `https://-bad.test` 全部 False；`localhost` 允许单标签。
    """
    if not line or re.search(CONTROL_RE, line):
        return False          # C0/C1/DEL 与行段分隔符 \S 都不排除，两侧同禁
    if not re.match(r"^https?://\S+\Z", line):
        return False
    try:
        parts = urlsplit(line)
        host = parts.hostname
    except ValueError:
        return False
    if not host:
        return False
    if host != "localhost":
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


def _encodable(s: Any) -> bool:
    try:
        str(s).encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


_open = open          # 探针专用入口：守卫可替换它注入 PermissionError


def _probe_window(run_dir: str, rels) -> tuple[str | None, str | None]:
    """返回 (可用路径, 错误原因)。

    三种状态都要分清：确实不存在（可安全跳过）/ 悬空软链 / 访问失败（无权限、不是普通文件、
    打不开）。后两种一律报错，即使另有可读候选 —— 备用文件不能掩盖优先窗口（reviewer 第 14/15 轮）。
    只 stat 不够：stat 成功而 open 抛 PermissionError 的情况确实存在。
    中间路径组件也要逐段 lstat：`run/raw` 本身是悬空软链时，`lstat(run/raw/x.json)` 只报 ENOENT，
    会被当成「窗口不存在」而被备用文件顶掉（reviewer 第 16 轮 P1）。
    """
    root_err = _probe_root(run_dir)
    if root_err:
        return None, root_err
    problems: list[str] = []
    readable: list[str] = []
    for rel in rels:
        err = _probe_one(run_dir, rel, readable)
        if err:
            problems.append(err)
    if problems:
        shown = "；".join(problems[:4])
        if len(problems) > 4:
            shown += f"；…共 {len(problems)} 处"
        note = (f"；另有可读候选 {_clip(readable[0], 200)}，但其余候选不可访问，不能确认是同一窗口"
                if readable else "")
        # 不截断提示：逐项 clip 已把长度压住，截断会把「不能确认是同一窗口」这句吃掉
        return None, ("窗口存在但无法读取：" + shown + note)
    return (readable[0], None) if readable else (None, None)


def _walk_root(run_dir: str) -> tuple[str | None, bool]:
    """走查一次：返回 (错误, 是否遇到 ENOENT)。ENOENT 只说明「当时不存在」。"""
    if not run_dir:
        return "run 目录为空", False
    absolute = run_dir.startswith(os.sep)
    comps = [c for c in run_dir.split(os.sep) if c]
    cur = os.sep if absolute else ""
    for idx, comp in enumerate(comps):
        cur = os.path.join(cur, comp) if cur else comp
        last = idx == len(comps) - 1
        where = "根" if last else "上级"
        try:
            info = os.lstat(cur)
        except FileNotFoundError:
            return None, True
        except OSError as exc:
            return (f"run 目录 {_clip_tail(run_dir)!r}: {where}段 {_clip(comp, 40)!r} lstat "
                    f"{type(exc).__name__}: {_clip(str(exc), 80)}"), False
        if stat.S_ISLNK(info.st_mode):
            try:
                info = os.stat(cur)
            except FileNotFoundError:
                return (f"run 目录 {_clip_tail(run_dir)!r}: {where}段 {_clip(comp, 40)!r} 是悬空软链"
                        f"（{_clip_tail(cur, 120)!r}）"), False
            except OSError as exc:
                return (f"run 目录 {_clip_tail(run_dir)!r}: {where}段 {_clip(comp, 40)!r} 软链目标 "
                        f"{type(exc).__name__}: {_clip(str(exc), 80)}"), False
        if not stat.S_ISDIR(info.st_mode):
            return (f"run 目录 {_clip_tail(run_dir)!r}: {where}段 {_clip(comp, 40)!r} 不是目录"
                    f"（mode={oct(info.st_mode)}）"), False
    try:
        os.listdir(cur)
    except OSError as exc:
        return (f"run 目录 {_clip_tail(run_dir)!r}: 无法读取 {type(exc).__name__}: {_clip(str(exc), 80)}"), False
    return None, False


def _probe_root(run_dir: str) -> str | None:
    """--run 根目录自身：逐段 lstat，悬空软链出现在哪一段都要报出来。

    判定口径：任何一段是「悬空软链 / 非目录 / 不可读」→ 报错（不能被压平成「全部 skipped」）；
    任何一段确实不存在 → 视为 run 目录不存在，放行给候选判定。
    走查遇到 ENOENT 时**立即回查一次**：若第二次走查能读出悬空软链/非目录，说明路径在探测期间
    被替换，按「探测期间发生变化」报错（reviewer 第 20 轮 P1 的并发置换）。
    残余风险：没有目录句柄/快照，两次走查之间仍可能被原子替换，这一点不假装能防住。
    """
    first, hit_enoent = _walk_root(run_dir)
    if first or not hit_enoent:
        return first
    second, _ = _walk_root(run_dir)
    if second:
        return f"路径在探测期间发生变化，无法确认是同一窗口：{second}"
    return None


def _probe_one(run_dir: str, rel: str, readable: list[str]) -> str | None:
    """探测一个候选窗口；返回错误文本或 None。逐段 lstat 覆盖中间组件的悬空软链。"""
    cur = run_dir
    parts = [x for x in rel.split("/") if x not in ("", ".")]
    for idx, part in enumerate(parts):
        cur = os.path.join(cur, part)
        last = idx == len(parts) - 1
        try:
            info = os.lstat(cur)
        except FileNotFoundError:
            # lstat 不跟软链：中间组件 ENOENT 就是真不存在（悬空软链会在上一步以 S_ISLNK 命中），
            # 整个候选窗口不可能存在，按「确实不存在」跳过（reviewer 第 17 轮 P1）
            return None
        except OSError as exc:
            return f"{_clip(rel, 80)}: lstat {type(exc).__name__}: {_clip(str(exc), 80)}"
        if last:
            if stat.S_ISLNK(info.st_mode):
                try:
                    info = os.stat(cur)
                except FileNotFoundError:
                    return f"{_clip(rel, 80)}: 悬空软链（目标不存在）"
                except OSError as exc:
                    return f"{_clip(rel, 80)}: 软链目标 {type(exc).__name__}: {_clip(str(exc), 80)}"
            if not stat.S_ISREG(info.st_mode):
                return f"{_clip(rel, 80)}: 不是普通文件（mode={oct(info.st_mode)}）"
            try:
                with _open(cur, "rb") as fh:
                    fh.read(1)
            except OSError as exc:
                return f"{_clip(rel, 80)}: 打开失败 {type(exc).__name__}: {_clip(str(exc), 80)}"
            readable.append(cur)
            return None
        # 中间组件：软链要跟到真实目录，悬空即报错；非目录也报错
        if stat.S_ISLNK(info.st_mode):
            try:
                info = os.stat(cur)
            except FileNotFoundError:
                return f"{_clip(rel, 80)}: 中间目录 {_clip(part, 40)!r} 是悬空软链"
            except OSError as exc:
                return f"{_clip(rel, 80)}: 中间目录 {_clip(part, 40)!r} {type(exc).__name__}: {_clip(str(exc), 80)}"
        if not stat.S_ISDIR(info.st_mode):
            return f"{_clip(rel, 80)}: 中间组件 {_clip(part, 40)!r} 不是目录（mode={oct(info.st_mode)}）"
    return f"{_clip(rel, 80)}: 路径为空"


def _row_shape_error(row: Any, ch_expected: str, c: dict) -> str | None:
    """校验构建结果的结构与类型；返回错误原因，合法返回 None。

    没有这层时：整数 id 会让 `re.fullmatch` 抛 TypeError（整轮无报告）；
    缺 `证据`、`身份档=invalid` 的行却能算出 rc=0（reviewer 第 12 轮）。
    """
    if not isinstance(row, dict):
        return f"构建结果不是字典（{type(row).__name__}）"
    for k in ("来源渠道", "来源事件标识", "证据", "身份档"):
        if k not in row:
            return f"缺字段 {k}"
    ch = row["来源渠道"]
    if not isinstance(ch, str) or not ch:
        return f"来源渠道 类型/空值非法（{type(ch).__name__}）"
    if ch != ch_expected:
        return f"渠道不符：期望 {ch_expected}，实际 {ch!r}"
    ev = row["来源事件标识"]
    if not isinstance(ev, str) or not ev.strip():
        return f"来源事件标识 必须是非空字符串（{type(ev).__name__}）"
    if re.search(r"[\x00-\x1f\x7f]", ev):
        return "来源事件标识 含控制字符/换行"
    evd = row["证据"]
    if not isinstance(evd, str) or not evd.strip():
        return f"证据 必须是非空字符串（{type(evd).__name__}）"
    if evd != NO_URL:
        # SPEC R3：多份证据换行分隔，每一行都必须是完整 URL（`http://`、`http://:80`、
        # `http://[` 这类都要拒；urlsplit 对坏 IPv6 会抛 ValueError）
        if re.search(r"[\x00-\x08\x09\x0b\x0c\x0d\x0e-\x1f\x7f]", evd):
            return "证据 含控制字符（只允许 \\n 分隔多份，不允许 \\t/\\r）"
        if evd != evd.strip():
            return "证据 首尾有空白（conformance 判 evidence_leading_blank）"
        for line in evd.split("\n"):
            if line != line.strip():
                return f"证据行 {line[:40]!r} 首尾有空白"
            if not _is_full_url(line):
                return f"证据行 {line[:40]!r} 不是完整 URL（需 http(s):// + 主机），也不是 {NO_URL}"
    ident = row["身份档"]
    if ident not in (c.get("identity_values") or []):
        return f"身份档 {ident!r} 不在契约枚举内"
    # 身份档联动（SPEC R3）：`unknown:` 或 `无公开链接` 必须 unverified；两者都真实才可 verified
    if ident == "verified" and (evd == NO_URL or ev.startswith("unknown:")):
        return f"身份档=verified 与证据/id 不匹配（证据={evd!r}，id 降级={ev.startswith('unknown:')}）"
    # 明细行键（写入侧才有这一列，存在才查）：与判定器 row_key_format 同一条正则；$ 会放过尾随 \n
    if "明细行键" in row and (not isinstance(row["明细行键"], str)
                              or not id_patterns.ROW_KEY_RE.fullmatch(row["明细行键"])):
        return f"明细行键 不是 64 位小写十六进制（{str(row['明细行键'])[:80]!r}）"
    if "说明" in row and not isinstance(row["说明"], str):
        return f"说明 存在但不是字符串（{type(row['说明']).__name__}）"
    return None

def selfcheck(run_dir: str, per_source: int = 5, allow_qq_candidate: bool = False) -> dict:
    c = load_contract()
    checks: list[dict] = []
    windows = {
        "wecom": ("raw/wecom-window.json", "wecom-window.json"),
        "qq": ("raw/qq-window.json", "qq-window.json"),
        "telegram": ("raw/telegram-window.json", "raw/tg-window.json", "telegram-window.json"),
    }
    for src, rels in windows.items():
        # os.path.exists() 把 PermissionError 也当「不存在」→ 整渠道 skipped、整体 rc=0。
        # 必须区分「确实没有」与「访问不了」（reviewer 第 13 轮）。
        path, probe_err = _probe_window(run_dir, rels)
        if probe_err:
            checks.append({"source": src, "read": False, "read_error": probe_err})
            continue
        if path is None:
            checks.append({"source": src, "skipped": f"缺 {'/'.join(rels)}"})
            continue
        ok = bad = qq_proposed_ok = degraded = verified = 0
        first_row = None
        bad_rows: list[dict] = []
        errors: list[str] = []
        contract_bad = 0
        ch_expected = channel_of(src, c)[0]
        try:
            with open(path, encoding="utf-8") as fh:
                recs = json.load(fh)
        except (ValueError, OSError, RecursionError) as exc:
            # ValueError：3.11+ 的 4300 位限制；OSError：权限/文件损坏；RecursionError：深嵌套 JSON。
            # 任何一种都必须落成结构化报告 + rc=3，不能整轮崩掉（reviewer 第 11/12 轮）
            checks.append({"source": src, "read": False,
                           "read_error": f"窗口无法读取：{type(exc).__name__}: {exc}"[:300]})
            continue
        if not isinstance(recs, list):
            checks.append({"source": src, "read": False,
                           "read_error": f"窗口顶层不是数组（{type(recs).__name__}）"})
            continue
        # 元素必须是对象：`[null]` 会让 r.get() 抛 AttributeError（reviewer 第 12 轮）
        bad_elems = [i for i, r in enumerate(recs) if not isinstance(r, dict)]
        if bad_elems:
            errors.append(f"窗口含 {len(bad_elems)} 个非对象元素（首个下标 {bad_elems[0]}，"
                          f"类型 {type(recs[bad_elems[0]]).__name__}），已跳过")
        picked = [r for r in recs
                  if isinstance(r, dict) and str(r.get("content") or r.get("text") or "").strip()][:per_source]
        for i, r in enumerate(picked, 1):
            # 采集侧实际以 --allow-qq-candidate 跑（QQ v1.9 正则缺陷的过渡开关），自检同步
            try:
                row = build_identity(src, r, batch_key="20261124", round4=1, row_no=i, contract=c,
                                     allow_qq_candidate=allow_qq_candidate)
            except Exception as exc:  # noqa: BLE001
                # 单条输入导致整轮自检崩掉就看不到报告，记一条错误继续
                errors.append(f"row#{i} {type(exc).__name__}: {exc}"[:300])
                continue
            # 结构校验：字段类型/枚举/证据都要对，否则后面的 family_ok 会拿 int 去 re.fullmatch
            # 抛 TypeError，或「缺证据 + 身份档非法」的行被算成 ok（reviewer 第 12 轮）
            shape_err = _row_shape_error(row, ch_expected, c)
            if shape_err:
                errors.append(f"row#{i} 行结构非法：{shape_err}"[:300])
                continue
            evid = str(row["来源事件标识"])
            ch_row = row["来源渠道"]
            ident = row["身份档"]
            if i == 1:
                # 冻结副本：样本不能与构建器共享可变字典（reviewer 第 12 轮）
                first_row = copy.deepcopy(row)
            is_degraded = evid.startswith(UNKNOWN_PREFIX)
            if is_degraded:
                degraded += 1
            if ident == "verified":
                verified += 1
            # 占位也要验族：`unknown:user-feedback-malformed` 这种混进来同样是坏行，
            # 不能因为「是降级行」就在验族前跳过（reviewer 第 10 轮 P2-h）。
            if is_degraded:
                if not family_ok(ch_row, evid, c):
                    contract_bad += 1
                    bad += 1
                    bad_rows.append({"id": evid[:60], "channel": ch_row})
                continue
            if not family_ok(ch_row, evid, c):
                contract_bad += 1
            # 判定必须与采集侧同一套：QQ 在契约未漂移、且采集确实开了候选时才按候选正则认可，
            # 否则自检会一边收下这些 id、一边报 family_bad，rc 永远等于 2（reviewer 第 7 轮 P2）。
            if family_ok(ch_row, evid, c):
                ok += 1
            elif (ch_row in CONTRACT_DEFECT_CHANNELS and allow_qq_candidate
                  and qq_contract_is_shipped(c)
                  and family_ok_proposed(ch_row, evid)):
                ok += 1
                qq_proposed_ok += 1
            else:
                bad += 1
                bad_rows.append({"id": evid[:60], "channel": ch_row})
        # 样本直接复用循环里已校验的第一行：二次构建会绕过渠道/族校验（reviewer 第 11 轮）
        sample = first_row if picked else None
        entry = {"source": src, "sampled": len(picked), "family_ok": ok, "family_bad": bad,
                 "degraded": degraded, "verified": verified, "bad_rows": bad_rows, "sample": sample,
                 "contract_family_bad": contract_bad}
        entry["read"] = True
        if errors:
            entry["build_errors"] = errors
        if qq_proposed_ok:
            entry["qq_family_ok_under_proposed_pattern"] = qq_proposed_ok
            entry["note"] = "契约 v1.9 QQ 正则与真实 id 不符，按候选正则校验（PM v1.10 待发）"
        checks.append(entry)
    # 报告出口统一清洗：孤立代理项在 json.dumps 里能过、在 UTF-8 写出时崩（reviewer 第 13 轮）
    return _sanitize_report({"contract_warnings": contract_warnings(c), "checks": checks})


DEMO_CASES = [
    ("wecom", {"conv_id": 10812375771529472, "seq": 5918929}),
    ("企微", {"conv_id": "10812375771529472", "seq": "0"}),
    ("企业微信", {"conv_id": "10812375771529472", "seq": 1.9}),
    ("wework", {"conv_id": "", "seq": 5}),
    ("qq", {"id": "ROBOT1.0_demo", "group_openid": "EF88687F23B9917E3685E4872C6AADAE"}),
    ("Telegram", {"chat": "-1002184818189", "mid": 273111}),
    ("tg", {"chat": 123456, "mid": 9}),
    ("Discord", {"guild_id": 1180000000000000000, "channel_id": 1180000000000000001,
                 "message_id": 1180000000000000002}),
    ("内部飞书", {"message_id": "om_demo123"}),
    ("weibo", {"id": "wb_777"}),
]


def write_fixture(path: str, contract: dict | None = None) -> dict:
    """生成 demo ndjson。contract 由 main() 先加载（加载失败在那一层就是 LOAD_FAIL/rc=3）；
    这里再抛的 ResolveError 只会是 demo 用例本身构建失败，属缺陷，照常 traceback（rc=1），不冒充加载失败。"""
    c = contract or load_contract()
    rows = []
    for i, (src, rec) in enumerate(DEMO_CASES, 1):
        ident = build_identity(src, rec, batch_key="20261124", round4=1, row_no=i,
                               issue_urls=["https://github.com/CherryHQ/cherry-studio/issues/24294"],
                               contract=c)
        et, seq = "初报", 1
        rk = hashlib.sha256(f"demo:{i}{et}{seq}".encode()).hexdigest()
        ident.update({"工作项键": f"demo:{i}", "日报键": "user-feedback-20261124", "事件类型": et,
                      "事件序号": seq, "明细行键": rk})
        rows.append(ident)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return {"written": path, "rows": len(rows)}


def _selfcheck_rc(report: dict) -> tuple[int, str]:
    """自检退出码：0 全部合格 / 2 有真实 id 不合族（违规）/ 3 结论不可信。

    3 的三种情形都不能当成功：没有任何有效采样；某个已读到的窗口一条都没解析；
    出现构建异常或样本重解析异常（说明有输入把解析打崩了，统计不完整）。
    """
    checks = report["checks"]
    read_err = [f"{x.get('source')}:{x['read_error']}" for x in checks if x.get("read_error")]
    if read_err:
        return 3, f"窗口读取失败，统计不完整：{read_err[0]}（共 {len(read_err)} 个窗口）"
    errs = [f"{x.get('source')}:{e}" for x in checks for e in (x.get("build_errors") or [])]
    # 异常与违规同时出现时判 3：统计本身不完整，此时报 2 会把「漏算」说成「只错这些」
    if errs:
        return 3, f"行结构/构建异常导致统计不完整：{errs[0]}（共 {len(errs)} 条）"
    bad_sample = [x["source"] for x in checks if (x.get("sample") or {}).get("_error")]
    if bad_sample:
        return 3, f"样本重解析失败：{','.join(bad_sample)}"
    bad = sum(x.get("family_bad", 0) for x in checks)
    if bad > 0:
        return 2, f"{bad} 条 id 未通过族校验（含不合族的降级占位符）"
    valid = [x for x in checks if x.get("sampled")]
    if not valid or sum(x["sampled"] for x in valid) == 0:
        return 3, "无有效采样（全部 skipped 或采样数为 0）"
    empty = [x["source"] for x in checks if x.get("read") and not x.get("sampled")]
    if empty:
        return 3, f"已读到窗口但一条有效正文都没有：{','.join(empty)}"
    pure = [x["source"] for x in valid if x.get("family_ok", 0) == 0 and x.get("family_bad", 0) == 0]
    if pure:
        return 3, f"未产生任何真实 id 完成族校验的渠道：{','.join(pure)}"
    return 0, ""


def main() -> int:
    ap = argparse.ArgumentParser(description="U1 采集侧身份解析")
    ap.add_argument("--run", help="run 目录（含 raw/*-window.json）")
    ap.add_argument("--selfcheck", action="store_true")
    ap.add_argument("--per-source", type=int, default=5)
    ap.add_argument("--allow-qq-candidate", action="store_true",
                    help="与采集侧同一开关；不开时自检按契约判 QQ（默认关闭，避免自检比采集更宽松）")
    ap.add_argument("--json", help="自检报告输出路径")
    ap.add_argument("--fixture-demo", help="生成 003 合规 demo ndjson")
    args = ap.parse_args()

    if args.selfcheck:
        if not args.run:
            ap.error("--selfcheck 需要 --run")
        try:
            report = selfcheck(args.run, args.per_source, args.allow_qq_candidate)
        except ResolveError as exc:      # 含 QQSegmentDrift / ContractVersionUnresolved：selfcheck 里只有 load_contract 会把 ResolveError 抛到这里
            return _load_fail(exc)       # （逐行构建异常已按行记进报告），所以逃出来的一定是契约加载失败
        report["allow_qq_candidate"] = args.allow_qq_candidate
        rc, reason = _selfcheck_rc(report)
        if reason:
            report["rc_reason"] = reason
        report = _sanitize_report(report)
        text = json.dumps(report, ensure_ascii=False, indent=1)
        if args.json:
            with open(args.json, "w", encoding="utf-8", errors="backslashreplace") as fh:
                fh.write(text + "\n")
        try:
            print(text)
        except UnicodeEncodeError:
            # 兜底：按 stdout 实际编码（可能是 ASCII）转义，不能用 utf-8 再转一次
            enc = getattr(sys.stdout, "encoding", None) or "ascii"
            print(text.encode(enc, "backslashreplace").decode(enc, "replace"))
        return rc

    if args.fixture_demo:
        try:
            c = load_contract()
        except ResolveError as exc:      # 含 QQSegmentDrift / ContractVersionUnresolved：到这里就还没碰过输出路径，不会落文件
            return _load_fail(exc)
        print(json.dumps(write_fixture(args.fixture_demo, contract=c), ensure_ascii=False))
        return 0

    ap.print_help()
    return 1


def _load_fail(exc: ResolveError) -> int:
    """契约加载失败（指纹漂移 / 版本不符 / 版本不可判定 CONTRACT_VERSION_UNRESOLVED / 枚举或来源映射不一致）：
    与判定器 READ_FAIL 同码，单行、不出结论，不写任何输出文件。

    r8 时这里是 traceback + rc=1，复核方无法按码分流，也看不到单行结论（r9 A：不一致就单行 LOAD_FAIL/rc=3）。"""
    print(f"LOAD_FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
    return 3


if __name__ == "__main__":
    sys.exit(main())
