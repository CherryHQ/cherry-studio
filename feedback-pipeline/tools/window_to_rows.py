#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""真实窗口 → 明细行生成器：把一次采集窗口的原始记录批量转成「明细行 ndjson」（一行一条），供 tools/m1_gate.py 判定。

用法:
  python3 -B tools/window_to_rows.py --run <run目录> --out <输出.ndjson> [--contract-version v1.13]
  契约目录默认 = 仓库 contract/（UF003_CONTRACT_DIR 可改指别的「带版本号件」目录）；版本取 --contract-version，未给则
  UF003_CONTRACT_VERSION，再未给则 v1.13。只认 <目录>/detail-row.<ver>.schema.json，不认裸主件 detail-row.schema.json。

输入:
  <run>/raw/{wecom,qq,telegram,discord}.json（顶层数组，元素为对象）。
  确实不存在的渠道文件跳过，记进汇总 missing（不算失败）；存在但读不了（含非严格 UTF-8：带 BOM / UTF-16）/
  顶层不是数组 / 含非对象元素 → 前置失败 rc=3。raw/ 目录不存在同样 rc=3。

输出（每条记录一行，键顺序固定）:
  record_id + 34 字段真源快照的全部字段名（workspace/user-feedback/feedback-sync/reports/
  uf003-fields-34-snapshot-20261127.json，块内逐名逐序）+ 事件类型 + 身份档（契约 required、不在 34 字段快照里，
  追加在 34 字段之后，不插入块内）。推导不出的字段写 ""，按字段计数进 underived。
  值一律字符串，唯一例外 事件序号 是 JSON 整数（契约 type=integer；conformance 对 "1" 判 seq_type_bad 硬红）。

标识族（S2-A2，按渠道分治；每一段都取自该渠道 raw 元素的同名键，缺键 / 空值 / 类型不符 → 该行 blocked，不补不猜）:
  wecom     wecom:<conv_id>:<RID>          三段，取 conv_id / RID。采集侧没有 LID 字段：任何第四段都是假值，
                                             本工具不产四段值（产出四段 wecom 即本单作废）。
  qq        qq:<group_openid>:<id>         id 必须是完整的 ROBOT1.<n>_<payload>（整段落键，不截断——真表的
                                             qq:<group>:ROBOT1.0 是 payload 已丢的截断值，194 条会塌成 5 个键）。
  telegram  telegram:<chat_id>:<message_id>
  discord   discord:<id>
  不做前缀别名映射（wc→wecom、tg→telegram 之类字符串替换一律没有）：标识由前缀字面量 + raw 键值直接拼成，
  不经过 uf003_identity.build_identity（它产 wc:<conv>:<seq> / dc:<guild>:<channel>:<message>，且要回查 Info.db /
  采集范围配置，不是 raw 原文）。各段含冒号 / 控制字符同样 blocked（否则段数可被伪造）。
  生成后逐行按契约 channel_family_patterns 复核一次，不合族的按渠道计数进汇总 ident_family_mismatch（只计数、
  不改写标识、不阻断：标识口径由本单规定，契约族正则是另一份真源，二者不一致必须如实露出，由闸门判 event_id_family）。
  2026-11-28 实测 v1.11–v1.13 契约：企微族正则要求 wecom:<conv>:[0-9]{1,20}:[0-9]{1,20}（四段）、Discord 要求
  dc:<guild>:<channel>:<message>（三段），与本单的 wecom 三段 / discord:<id> 不符 → 这两族在闸门是 event_id_family 硬红。

其余字段推导规则（只写有据可查的，其余一律 ""，不编造）:
  record_id            写前临时行标识 = 来源事件标识（真表的 record_id 是飞书 Base 写入时分配的 rec… 记录 ID，写前不存在）。
  证据                  恒 无公开链接（窗口记录没有经确认的公开 URL，不猜链接）。
  身份档                每行都写、只写 verified / unverified 之一（不空串、不 unknown、不省略；blocked 行同样写）。判定沿用本文件
                        已有的身份/校验结论：证据 恒 无公开链接、身份状态/身份原因/身份对账 恒 ""（本工具不跑身份校验），没有任何
                        一行拿得到校验结论 → 一律 unverified，不写 verified 蒙混。汇总计 身份档_verified / 身份档_unverified，
                        两者之和必须 == rows（不等即 rc=3、不写出）。
  日报键               ← user-feedback-<YYYYMMDD>，日期取 run 目录名里的 -YYYYMMDDTHHMM（窗口采集时刻）；取不到 → ""。
  对象                  ← wecom.conv_name / qq.group_name / discord.channel_name；telegram 窗口记录没有会话标题 → ""。
  原始消息ID            ← wecom.RID / qq.id / telegram.message_id / discord.id（采集器原生消息 id）。
  工作项键 / PM 工作项   两者同值 = "uf:" + 来源事件标识（业主 2026-11-27 裁定；PM 幂等身份，同一工作项的多行可重复）。
  事件类型               恒 "初报"（本工具只产初报行）；它是序号的作用域维度，也是 v1.12+ 规范化行的参与列。
  事件序号 / 明细行键    由契约版本决定（见「版本门与行键口径」）。
  来源事件标识为空的行（blocked）键列一律留空：闸门按 missing / workitem_key_empty 硬红，不补占位。

版本门与行键口径（S2-A2 收紧；2026-11-28 起按显式版本从 contract/ 解析。任一不符 rc=3、不碰 --out、不回落旧版本）:
  支持集 SUPPORTED_VERSIONS = {v1.11: sha256(工作项键+事件类型+事件序号), v1.12: x-row-key, v1.13: x-row-key}。
  1) 版本串 ver = --contract-version > UF003_CONTRACT_VERSION > 默认 v1.13；不在支持集 → CONTRACT_VERSION_UNSUPPORTED rc=3
     （v1.99 / v9.9 之类不猜邻近版本、不按 x-row-key 有无反推版本）。
  2) 契约文件 = <契约目录>/detail-row.<ver>.schema.json（一次读入，sha256 与 JSON 都从同一份字节算）。不存在 →
     CONTRACT_FILE_MISSING；读不了 / 非严格 UTF-8 / 坏 JSON / 顶层非对象 → CONTRACT_FILE_INVALID；均 rc=3。
     不认裸主件 detail-row.schema.json（旧路径读 cache/contract-view 的 v1.11 副本，声明不符也照跑、版本门静默失效，本单起
     废除）；不再经 uf003_identity.load_contract()（其 QQ 段冻结表只到 v1.12，v1.13 在那里必拒）。
  3) 主件自述必须等于 ver：$id 须携带完整版本串（按 [./#] 切词，v1 / 13 两段连续出现且后一段不是数字：v1.13 不认
     v1.130、v1.11 不认 v1.1），否则 CONTRACT_ID_MISMATCH；x-contract-version ≠ ver → CONTRACT_VERSION_MISMATCH；均 rc=3。
     实测 contract/ 里 v1.11 / v1.12 件的 $id=uf-003-detail-row.v1.2.json，过不了这道门（如实露出，不改契约件）。
  4) required 核对生成侧产出：required 须为非空字符串数组，且每一列都在生成侧可产列（record_id + 34 字段 + 事件类型 +
     身份档）内，否则 CONTRACT_REQUIRED_UNSUPPORTED rc=3（契约新增生成侧不会产的必需列时，不再写空串蒙混）；required 含
     身份档 时其 enum 须含 unverified（生成侧唯一可落的值）。
  5) 行键口径 = SUPPORTED_VERSIONS[ver]，须与 x-row-key 键存在性相符：v1.11 不得带 x-row-key，v1.12/v1.13 必须带；
     否则 CONTRACT_RULE_INCONSISTENT rc=3。缺 properties.来源事件标识.channel_family_patterns 或其正则编译不过，同样 rc=3。
  6) <契约目录>/channel-map.json 的 rules[].source 须含本工具四个渠道的来源值，否则 CHANNEL_MAP_FAIL rc=3。
  实际采用的 version / 文件 / sha256（前 12 位）写进汇总 contract_version / contract_file / contract_sha256。
  x-row-key 口径（契约 x-row-key，v1.12 起；按契约文字实现，不 import 判定器）:
    明细行键 = sha256(规范化行的紧凑 JSON 的 UTF-8 字节)，紧凑 JSON = ensure_ascii=false、separators=(",", ":")；
    规范化行 = [[列名, 规范化值], …]，列序 = x-row-key.normalized_row.columns（本工具按契约文字从 properties 声明序 +
    appended_columns 派生一遍并与 columns 逐项核对，不等即 rc=3），exclude_columns / declared_but_not_output_columns 不参与；
    值规范化：str→NFC；null→""；bool→true/false；int→十进制；容器/浮点→键排序紧凑 JSON 再 NFC；缺列→""；
    占位行（来源事件标识 以 unknown: 开头或为空）的 来源事件标识 记 "" 后参与哈希；
    事件序号：作用域 (工作项键, 事件类型) 内按 明细行键 字典序 1-based 编号，规范化行完全相同的行共用同一 明细行键
    与同一序号（same_row_key_shares_sequence=true）；事件序号 不进行键。

环境变量:
  UF003_CONTRACT_DIR      契约目录（须含 detail-row.<ver>.schema.json 与 channel-map.json，如仓库 contract/）。
                          未设置/空白 → 仓库 contract/；设置了但不存在 → CONTRACT_DIR_MISSING rc=3。
  UF003_CONTRACT_VERSION  版本声明（--contract-version 优先）；两者都缺 → v1.13。

退出码:
  0  行已写出，且身份三字段（record_id / 来源渠道 / 来源事件标识）无一为空。
  3  前置失败（环境变量、契约、版本门、窗口、--out 不可写）：在创建/截断 --out 之前返回，stdout 不出汇总；
     或存在 blocked 行（身份三字段任一为空）：行文件照写（blocked 行保留在文件里供复核），ok=false、blocked_rows>0。

rc=0 只表示「转换完成、身份三字段非空」，不等于能过闸门。闸门现状（2026-11-28，m1_gate 7eca78e7 / conformance f32710d8）:
  --contract 只收 v1.9–v1.12；row_key_bad 对所有版本都按 sha256(工作项键+事件类型+事件序号) 复算——x-row-key 产物
  （v1.12/v1.13）送进现有闸门会整表 row_key_bad，判定器的 x-row-key 口径不在本单范围。
tests/test_window_to_rows.py 未随改（本单只改本文件，禁改 tests/）：2026-11-28 本单前实测 33/39（6 条 FAIL 编码更早的行为）；
  本单后 7/14——它用「裸主件临时目录 + UF003_CONTRACT_VERSION=v1.11」跑正控（现为 CONTRACT_FILE_MISSING rc=3，正控在 rc 处短路），
  且把「UF003_CONTRACT_DIR 未设置 / 未声明版本」当负控（现为默认 contract/ + v1.13 正常出件）。须随本单重写：契约目录用仓库 contract/
  或带版本号件的拷贝，负控改用 --contract-version v9.9 / 改错 $id / required 加生成侧产不出的列。run-m1.sh 仍 export
  UF003_CONTRACT_DIR=cache/contract-view（裸主件软链）+ v1.11，对本工具即为 CONTRACT_FILE_MISSING，须改为不 export 或改指 contract/ + v1.13。
  汇总 JSON 自本单起不再带 placeholder_rows / discord_guild_from_scope（不再产 unknown: 占位、不再读 Discord 采集范围），
  新增 contract_version / row_key_rule / ident_family_mismatch / ident_lid4seg；tools/bind_check.py 只读 used_bytes_sha256，不受影响。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

CONTRACT_DIR_ENV = "UF003_CONTRACT_DIR"
CONTRACT_VERSION_ENV = "UF003_CONTRACT_VERSION"
DEFAULT_CONTRACT_VERSION = "v1.13"                        # 未声明版本时的唯一默认（不探测目录、不按文件名反推）
CONTRACT_DIR_DEFAULT = os.path.join(ROOT, "contract")      # 未声明契约目录时的唯一默认：仓库 contract/（带版本号的件）
CONTRACT_FILE_FMT = "detail-row.%s.schema.json"            # 契约文件名 = 版本串显式落名；不认裸主件 detail-row.schema.json
CHANNEL_MAP_FILE = "channel-map.json"
CONTRACT_SHA_LEN = 12                                      # 汇总里 contract_sha256 只带前 12 位

# 34 字段真源快照的字段名与顺序（no 1…34）。真源文件不随工具运行时读取：输出 schema 不能随一份
# 报告文件悄悄变化；tests/test_window_to_rows.py 逐名逐序核对两者一致。
FIELDS_34 = [
    "工作项键", "日报键", "日期", "profile", "工作项", "类型", "对象", "输入", "输出", "状态",
    "tokens", "调用数", "工具摘要", "委派次数（含 Codex）", "飞书次数", "GitHub次数", "置信度", "需人判断",
    "待决事项", "证据", "失败原因", "来源渠道", "置信度分", "置信度理由", "查重次数", "重复命中数",
    "明细行键", "事件序号", "来源事件标识", "原始消息ID", "PM 工作项", "身份状态", "身份原因", "身份对账",
]
# 契约 required、但不在 34 字段快照里的两列：追加在 34 字段之后（块内逐名逐序不变）
EXTRA_FIELDS = ("事件类型", "身份档")
OUTPUT_FIELDS = FIELDS_34 + list(EXTRA_FIELDS)        # 每行 34 字段之后的全部输出列（underived 按它计数）
PRODUCIBLE_FIELDS = ("record_id",) + tuple(OUTPUT_FIELDS)   # 生成侧有推导规则、可落表的全部列；契约 required 必须是其子集
IDENTITY_FIELDS = ("record_id", "来源渠道", "来源事件标识")     # 与 tools/m1_gate.py IDENTITY_FIELDS 同一组
DAILY_KEY_PREFIX = "user-feedback-"                           # 日报键 = 该前缀 + 8 位日期
NO_URL = "无公开链接"
# 身份档（契约 required；v1.13 enum 含 unknown，但生成侧只落 verified / unverified 两个值）。判定沿用本文件已有的结论：
# 证据 恒 无公开链接（没有经确认的公开 URL），身份状态 / 身份原因 / 身份对账 恒 ""（本工具不跑身份校验，那是
# uf003_identity.py 自检关的结论，不在窗口记录里）。契约规则：证据 为空或 无公开链接 → 必须 unverified；只有真实 ID +
# 真实 URL 才可 verified。没有任何一行拿得到校验结论 → 一律 unverified；blocked 行同样写（不留空、不写 unknown、不写 verified 蒙混）。
IDENTITY_TIERS = ("verified", "unverified")
IDENTITY_TIER = "unverified"

# 键列口径（契约 v1.11 / SPEC R1；业主 2026-11-27 裁定 工作项键 = "uf:" + 事件标识）
WORKITEM_PREFIX = "uf:"            # 工作项键 = PM 工作项 = "uf:" + 来源事件标识（PM 幂等身份，同一反馈的多行可重复）
EVENT_TYPE_FIRST = "初报"           # 本工具只产初报行；事件类型 是序号的作用域维度，与序号、行键一起写出才可被判定器复核

# 支持集：契约版本 → 行键口径。只认显式登记的版本，不猜邻近版本、不按 x-row-key 有无反推版本。
ROW_KEY_V1 = "sha256(工作项键+事件类型+事件序号)"     # v1.11 / SPEC R1
ROW_KEY_X = "x-row-key"                               # v1.12 起：sha256(规范化行)，序号按行键字典序、同键共序号
SUPPORTED_VERSIONS = {"v1.11": ROW_KEY_V1, "v1.12": ROW_KEY_X, "v1.13": ROW_KEY_X}

# 窗口文件名 → 契约 source 原值（contract/channel-map.json 的 rules[].source）；启动时对账，不在表内即拒
CHANNELS = ("wecom", "qq", "telegram", "discord")
CHANNEL_SOURCE = {"wecom": "企微", "qq": "QQ", "telegram": "Telegram", "discord": "Discord"}
# 各渠道窗口记录里的原生消息 id 字段 / 会话名称字段（只认这几个键，不做模糊匹配）
RAW_ID_FIELD = {"wecom": "RID", "qq": "id", "telegram": "message_id", "discord": "id"}
OBJECT_FIELD = {"wecom": "conv_name", "qq": "group_name", "discord": "channel_name"}   # telegram 无会话标题

# 标识族：渠道 → (前缀字面量, 逐段取值的 raw 键名)。前缀与键名都是写死的字面量，不存在任何别名替换表。
#   wecom 三段：采集侧只有 conv_id / RID，没有 LID，也不回查 Info.db 取 seq。
IDENT_FAMILY = {
    "wecom": ("wecom", ("conv_id", "RID")),
    "qq": ("qq", ("group_openid", "id")),
    "telegram": ("telegram", ("chat_id", "message_id")),
    "discord": ("discord", ("id",)),
}
# QQ 裸消息 id 必须是完整的 ROBOT1.<n>_<payload>（与 tools/id_patterns.QQ_MSG_ID 同式）；截断值 / 假版本号一律 blocked
QQ_RAW_ID_RE = re.compile(r"ROBOT1\.[0-9]+_[A-Za-z0-9._!-]{1,200}\Z")
WECOM_LID_RE = re.compile(r"wecom:[^:]+:[^:]+:[^:]+")     # 四段 wecom = 第三段之后多出一段（LID 造假）；产出前最后一道断言

# run 目录名里的窗口采集时刻，如 external-a-20261127T0800 / external-a-20261020T0800Z
RUN_NAME_RE = re.compile(r"-(\d{8})T(\d{4})(?![0-9])")
REASON_MAX = 200          # 汇总/告警里单条原因的回显上限


class PreconditionError(Exception):
    """前置失败：带一个单行标签（CONTRACT_FILE_MISSING 等），调用方据此 rc=3 且不碰 --out。"""

    def __init__(self, tag: str, msg: str):
        super().__init__(msg)
        self.tag = tag
        self.msg = msg


class WindowError(Exception):
    """窗口文件存在但不可用（读不了 / 不是数组 / 含非对象元素）。"""


class IdentError(Exception):
    """标识段取值失败：raw 元素缺同名键 / 空值 / 类型不符 / 段内含冒号或控制字符 / QQ id 不是完整 ROBOT1.<n>_<payload>。"""


class _ArgParser(argparse.ArgumentParser):
    def error(self, message):      # 用法错也归 3，不透出 argparse 的 rc=2
        print("USAGE_FAIL: %s" % message, file=sys.stderr)
        sys.exit(3)


def fail(tag: str, msg: str) -> int:
    """前置失败：单行点名原因到 stderr，stdout 不出汇总，返回 3。"""
    print("%s: %s" % (tag, msg), file=sys.stderr)
    return 3


def emit(line: str) -> None:
    """stdout 兜底：按 stdout 实际编码转义，不能让汇总行因编码崩在文件写出之后。"""
    try:
        print(line)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        print(line.encode(enc, "backslashreplace").decode(enc, "replace"))


def _utf8(s: str) -> bool:
    try:
        s.encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


def _text(v) -> str:
    """窗口记录里的标量 → 可落表的字符串。None / 布尔 / 容器 / 浮点 / 空白 / 不可 UTF-8 编码一律 ""
    （不截断、不修剪、不猜：放不进 来源事件标识 之类列的值，同样不放别的列）。"""
    if v is None or isinstance(v, (bool, list, dict, tuple, set, float)):
        return ""
    try:
        s = str(v)
    except ValueError:
        return ""
    if not s.strip() or not _utf8(s):
        return ""
    return s


def _id_text(v) -> str:
    """id 类字段 → 文本：只认非空白字符串与 int（JSON 大整数在 Python 里无损）；bool / float / 容器 / None 一律 ""。"""
    if isinstance(v, bool) or v is None:
        return ""
    if isinstance(v, int):
        return str(v)
    if isinstance(v, str):
        return v if v.strip() else ""
    return ""


def _norm_version(v) -> str:
    return str(v).strip() if str(v).strip()[:1] == "v" else "v" + str(v).strip()


def _under(path: str, root: str) -> bool:
    p, r = os.path.realpath(path), os.path.realpath(root)
    return p == r or p.startswith(r + os.sep)


def window_keys(run_dir: str):
    """(批次日期 YYYYMMDD | None, 轮次 HHMM 的整数 | None)：只取 run 目录名自带的采集时刻，取不到就是 None。"""
    m = RUN_NAME_RE.search(os.path.basename(os.path.abspath(run_dir)))
    if not m:
        return None, None
    return m.group(1), int(m.group(2))


def precheck(run: str, out: str):
    """所有「开写之前」的外部条件。任何一条不成立都抛 PreconditionError，此时还没碰 --out。
    返回 (out_abs, 契约目录绝对路径, run_abs)；契约目录 = UF003_CONTRACT_DIR，未设置/空白则为仓库 contract/（唯一默认，不探测）。"""
    env = os.environ.get(CONTRACT_DIR_ENV, "").strip()
    contract_dir = os.path.abspath(env or CONTRACT_DIR_DEFAULT)
    if not os.path.isdir(contract_dir):
        raise PreconditionError(
            "CONTRACT_DIR_MISSING", "契约目录不存在 %s（%s=%r；未设置时默认 %s）"
            % (contract_dir, CONTRACT_DIR_ENV, env, CONTRACT_DIR_DEFAULT))
    if not os.path.isdir(run):
        raise PreconditionError("RUN_DIR_MISSING", "--run 目录不存在 %s" % run)

    out_abs = os.path.abspath(out)
    if os.path.isdir(out_abs):
        raise PreconditionError("OUT_IS_DIR", "--out 是目录，不是文件 %s" % out_abs)
    parent = os.path.dirname(out_abs)
    if not os.path.isdir(parent):
        raise PreconditionError("OUT_DIR_MISSING", "--out 的父目录不存在 %s（本工具不代建目录）" % parent)
    # 绝不覆盖输入：窗口原始文件与契约目录都不许当 --out
    for label, root in (("窗口 raw/ 目录", os.path.join(os.path.abspath(run), "raw")), ("契约目录", contract_dir)):
        if _under(out_abs, root):
            raise PreconditionError("OUT_OVERWRITES_INPUT", "--out 落在%s内，拒绝（%s）" % (label, out_abs))
    return out_abs, contract_dir, os.path.abspath(run)


def resolve_version(cli_version) -> str:
    """实际采用的版本串（归一化为 vX.Y）：--contract-version > UF003_CONTRACT_VERSION > 默认 v1.13。"""
    raw = cli_version if isinstance(cli_version, str) and cli_version.strip() else os.environ.get(CONTRACT_VERSION_ENV)
    if raw is None or not str(raw).strip():
        return DEFAULT_CONTRACT_VERSION
    return _norm_version(raw)


def _id_carries_version(id_str: str, ver: str) -> bool:
    """主件 $id 是否按完整版本串自述：按 [./#] 切词后，ver 的各段（v1 / 13）须连续出现，且紧随其后的一段不得是数字
    （v1.13 不认 v1.130，v1.11 不认 v1.1）。"""
    toks = re.split(r"[./#]", id_str)
    want = ver.split(".")
    n = len(want)
    for i in range(len(toks) - n + 1):
        if toks[i:i + n] == want:
            nxt = toks[i + n] if i + n < len(toks) else None
            if nxt is None or not nxt.isdigit():
                return True
    return False


def _load_json_file(path: str, tag: str, what: str):
    """一次 open、一次 read：sha256 与 JSON 都从同一份字节算（与 read_window 同一纪律）；严格 UTF-8、不剥 BOM。
    任何读不了 / 非 UTF-8 / 坏 JSON → PreconditionError(tag)。"""
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        obj = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError, RecursionError) as exc:
        raise PreconditionError(tag, "%s不可用 %s（%s: %s）" % (what, path, type(exc).__name__, exc))
    return raw, obj


def _display_path(path: str) -> str:
    """汇总里的路径：仓库内 → 相对仓库根（contract/detail-row.v1.13.schema.json），仓库外 → 绝对路径。"""
    ap = os.path.abspath(path)
    rel = os.path.relpath(ap, ROOT)
    return ap if rel == ".." or rel.startswith(".." + os.sep) else rel


def bind_contract(ver: str, contract_dir: str) -> dict:
    """版本门（全部在开写之前；任一不符抛 PreconditionError → rc=3、不碰 --out、不回落其它版本、不认裸主件）。

    返回绑定结果：schema / families（已编译的契约族正则）/ channel_sources / rule / columns / unknown_prefix /
    version / file（展示路径）/ path（实际路径）/ sha256（前 12 位）。核对项见模块说明「版本门与行键口径」1)–6)。
    """
    if ver not in SUPPORTED_VERSIONS:
        raise PreconditionError(
            "CONTRACT_VERSION_UNSUPPORTED",
            "声明版本 %s 不在生成侧支持集 %s 内，拒绝（不猜邻近版本、不按 x-row-key 有无反推版本；契约文件须为 %s）"
            % (ver, "/".join(SUPPORTED_VERSIONS), os.path.join(contract_dir, CONTRACT_FILE_FMT % ver)))
    path = os.path.join(contract_dir, CONTRACT_FILE_FMT % ver)
    if not os.path.isfile(path):
        missing = not os.path.lexists(path)
        raise PreconditionError(
            "CONTRACT_FILE_MISSING" if missing else "CONTRACT_FILE_INVALID",
            "版本 %s 的契约文件%s %s（只认 detail-row.<ver>.schema.json；不认裸主件 detail-row.schema.json、不回落其它版本）"
            % (ver, "不存在" if missing else "不是常规文件", path))
    raw, schema = _load_json_file(path, "CONTRACT_FILE_INVALID", "契约文件")
    if not isinstance(schema, dict):
        raise PreconditionError("CONTRACT_FILE_INVALID", "契约顶层不是对象 %s（是 %s）" % (path, type(schema).__name__))
    rel = _display_path(path)
    sha12 = hashlib.sha256(raw).hexdigest()[:CONTRACT_SHA_LEN]

    id_raw = schema.get("$id")
    if not isinstance(id_raw, str) or not _id_carries_version(id_raw, ver):
        raise PreconditionError("CONTRACT_ID_MISMATCH", "契约 %s 的 $id=%r 与声明版本 %s 不一致，拒绝" % (rel, id_raw, ver))
    xc = schema.get("x-contract-version")
    if not isinstance(xc, str) or _norm_version(xc) != ver:
        raise PreconditionError("CONTRACT_VERSION_MISMATCH", "契约 %s 的 x-contract-version=%r 与声明版本 %s 不一致，拒绝" % (rel, xc, ver))

    required = schema.get("required")
    if not isinstance(required, list) or not required or not all(isinstance(c, str) for c in required):
        raise PreconditionError("CONTRACT_REQUIRED_INVALID",
                                "契约 %s 的 required=%r 不是非空字符串数组，无法核对生成侧产出，拒绝" % (rel, required))
    unproducible = [c for c in required if c not in PRODUCIBLE_FIELDS]
    if unproducible:
        raise PreconditionError(
            "CONTRACT_REQUIRED_UNSUPPORTED",
            "契约 %s 的 required 含生成侧产不出的列 %s（可产列 = record_id + 34 字段 + %s），拒绝（不写空串蒙混）"
            % (rel, unproducible, "/".join(EXTRA_FIELDS)))
    props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    tier_prop = props.get("身份档") if isinstance(props.get("身份档"), dict) else {}
    tier_enum = tier_prop.get("enum")
    if "身份档" in required and isinstance(tier_enum, list) and IDENTITY_TIER not in tier_enum:
        raise PreconditionError(
            "CONTRACT_REQUIRED_UNSUPPORTED",
            "契约 %s required 含 身份档，但其 enum %r 不含生成侧唯一可落的 %s，拒绝" % (rel, tier_enum, IDENTITY_TIER))

    rule = SUPPORTED_VERSIONS[ver]
    has_x = isinstance(schema.get("x-row-key"), dict)
    if has_x != (rule == ROW_KEY_X) or ("x-row-key" in schema) != has_x:
        raise PreconditionError(
            "CONTRACT_RULE_INCONSISTENT",
            "契约 %s 的行键口径应为 %s，但 x-row-key 键%s，拒绝按不明口径写键"
            % (ver, rule, "存在" if has_x else "不存在或不是对象"))
    columns, unknown_prefix = None, "unknown:"
    if rule == ROW_KEY_X:
        columns = x_row_key_columns(schema)
        ph = schema["x-row-key"].get("placeholder_row")
        unknown_prefix = (ph.get("unknown_prefix") if isinstance(ph, dict) else None) or "unknown:"

    ident_prop = props.get("来源事件标识") if isinstance(props.get("来源事件标识"), dict) else {}
    families = ident_prop.get("channel_family_patterns")
    if not isinstance(families, dict) or not families or not all(isinstance(p, str) for p in families.values()):
        raise PreconditionError(
            "CONTRACT_RULE_INCONSISTENT",
            "契约 %s 缺 properties.来源事件标识.channel_family_patterns（或其不是非空字符串正则表），无法按契约族正则复核标识，拒绝" % rel)
    try:
        family_re = {ch: re.compile(p) for ch, p in families.items()}
    except re.error as exc:
        raise PreconditionError("CONTRACT_RULE_INCONSISTENT", "契约 %s 的 channel_family_patterns 编译失败（%s），拒绝" % (rel, exc))

    _, cmap = _load_json_file(os.path.join(contract_dir, CHANNEL_MAP_FILE), "CHANNEL_MAP_FAIL", "渠道映射")
    rules = cmap.get("rules") if isinstance(cmap, dict) else None
    if not isinstance(rules, list):
        raise PreconditionError("CHANNEL_MAP_FAIL", "%s 的 rules 不是数组，拒绝" % _display_path(os.path.join(contract_dir, CHANNEL_MAP_FILE)))
    sources = [r.get("source") for r in rules if isinstance(r, dict)]
    off_map = [s for s in CHANNEL_SOURCE.values() if s not in sources]
    if off_map:
        raise PreconditionError("CHANNEL_MAP_FAIL", "窗口渠道映射 %s 不在契约 source 列 %s 内，拒绝" % (off_map, sources))

    return {"schema": schema, "families": family_re, "channel_sources": sources, "rule": rule,
            "columns": columns, "unknown_prefix": unknown_prefix,
            "version": ver, "file": rel, "path": path, "sha256": sha12}


def x_row_key_columns(schema: dict) -> list:
    """按契约文字派生规范化行的列序，并与 x-row-key.normalized_row.columns 逐项核对（不等即拒）：
    properties 声明序在前（去掉 exclude_columns 与 declared_but_not_output_columns），appended_columns 声明序在后。"""
    xk = schema.get("x-row-key")
    nr = xk.get("normalized_row") if isinstance(xk, dict) else None
    if not isinstance(nr, dict):
        raise PreconditionError("CONTRACT_RULE_INCONSISTENT", "x-row-key.normalized_row 缺失或不是对象，拒绝按不明口径写键")
    excl = set(nr.get("exclude_columns") or [])
    not_out = set(nr.get("declared_but_not_output_columns") or [])
    props = [k for k, v in (schema.get("properties") or {}).items() if isinstance(v, dict)]
    derived = [c for c in props if c not in excl and c not in not_out]
    derived += [c for c in (nr.get("appended_columns") or []) if c not in excl and c not in not_out]
    declared = list(nr.get("columns") or [])
    if not declared or derived != declared:
        raise PreconditionError(
            "CONTRACT_RULE_INCONSISTENT",
            "x-row-key.normalized_row.columns 与按契约文字派生的列序不一致（派生 %d 列 / 声明 %d 列），拒绝"
            % (len(derived), len(declared)))
    return declared


def _norm_cell(v) -> str:
    """契约 value_normalization：str→NFC；None→""；bool→true/false；int→十进制；容器/浮点→键排序紧凑 JSON 再 NFC。"""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return unicodedata.normalize("NFC", v)
    if isinstance(v, int):
        return str(v)
    return unicodedata.normalize(
        "NFC", json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


def x_row_key(row: dict, columns: list, unknown_prefix: str) -> str:
    """明细行键 = sha256(规范化行的紧凑 JSON 的 UTF-8 字节)。规范化行 = [[列名, 规范化值], …]，列序 = columns。
    占位行（来源事件标识 以 unknown: 开头或为空）的 来源事件标识 记 "" 后参与哈希。"""
    norm = []
    for col in columns:
        v = row.get(col)
        if col == "来源事件标识" and (not isinstance(v, str) or v == "" or v.startswith(unknown_prefix)):
            v = ""
        norm.append([col, _norm_cell(v)])
    return hashlib.sha256(json.dumps(norm, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def row_key(workitem_key: str, event_type: str, seq: int) -> str:
    """v1.11 明细行键 = sha256(工作项键 + 事件类型 + 事件序号) 原样拼接的 64 位小写十六进制（契约 v1.11 / SPEC R1，
    与 tools/conformance.py row_key_bad 同式）。"""
    return hashlib.sha256((workitem_key + event_type + str(seq)).encode("utf-8")).hexdigest()


def assign_key_columns(rows, rule: str, columns=None, unknown_prefix: str = "unknown:") -> dict:
    """全窗口收齐后统一分配键列（序号要看同一 (工作项键, 事件类型) 作用域内的全部行）。

    工作项键 = PM 工作项 = "uf:" + 来源事件标识；事件类型 = 初报；
    rule == ROW_KEY_V1：事件序号 = 作用域内按输入序 1..n 连续（JSON 整数），明细行键 = row_key(工作项键, 事件类型, 事件序号)；
    rule == ROW_KEY_X：明细行键 = x_row_key(行)，事件序号 = 作用域内按 明细行键 字典序 1-based，同键共序号。
    来源事件标识为空的行（blocked）键列一律留空，由闸门按 missing / workitem_key_empty 硬红，不补占位。
    """
    keyed = []
    for row in rows:
        ev = row["来源事件标识"]
        if not ev:
            continue
        wk = WORKITEM_PREFIX + ev
        row["工作项键"] = wk
        row["PM 工作项"] = wk
        row["事件类型"] = EVENT_TYPE_FIRST          # 参与规范化行：必须在算行键之前写定
        keyed.append(row)
    if rule == ROW_KEY_V1:
        next_seq = {}                  # (工作项键, 事件类型) → 该作用域已分配到的最大序号
        for row in keyed:
            seq = next_seq.get((row["工作项键"], row["事件类型"]), 0) + 1
            next_seq[(row["工作项键"], row["事件类型"])] = seq
            row["事件序号"] = seq             # JSON 整数，不是 "1"
            row["明细行键"] = row_key(row["工作项键"], row["事件类型"], seq)
        return {"workitems": len({wk for wk, _ in next_seq}),
                "max_seq": max(next_seq.values()) if next_seq else 0}
    scopes = {}                        # (工作项键, 事件类型) → 该作用域的行
    for row in keyed:
        row["明细行键"] = x_row_key(row, columns, unknown_prefix)
        scopes.setdefault((row["工作项键"], row["事件类型"]), []).append(row)
    max_seq = 0
    for pair in scopes:
        group = sorted(scopes[pair], key=lambda r: r["明细行键"])     # 按 明细行键 字典序
        seq, prev = 0, None
        for row in group:
            if row["明细行键"] != prev:                                   # 同键共序号：键变了才递增
                seq += 1
                prev = row["明细行键"]
            row["事件序号"] = seq
        max_seq = max(max_seq, seq)
    return {"workitems": len(scopes), "max_seq": max_seq}


def build_ident(src: str, rec: dict) -> str:
    """按渠道从 raw 原文逐段取值拼标识：每一段都必须在该渠道 raw 元素里有同名键且值可用，否则 IdentError。

    不做任何前缀别名映射、不回查任何库、不补任何段；段内含冒号 / 控制字符同样拒（否则段数可被伪造）。
    """
    prefix, keys = IDENT_FAMILY[src]
    segs = []
    for k in keys:
        v = _id_text(rec.get(k))
        if not v:
            raise IdentError("%s: raw 元素缺可用键 %s（值 %r）" % (src, k, rec.get(k) if k in rec else "<缺键>"))
        if ":" in v or re.search(r"[\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff]", v):
            raise IdentError("%s: 键 %s 的值含冒号或控制字符，段数/落表不可信" % (src, k))
        segs.append(v)
    if src == "qq" and not QQ_RAW_ID_RE.fullmatch(segs[1]):
        raise IdentError("qq: 键 id 不是完整的 ROBOT1.<n>_<payload>（长度 %d）" % len(segs[1]))
    ident = ":".join((prefix,) + tuple(segs))
    if src == "wecom" and WECOM_LID_RE.match(ident):
        raise IdentError("wecom: 组装出四段标识（第三段之后多出一段 = LID 造假），拒绝")   # 两段取值走不到这里，留作断言
    return ident


def read_window(path: str, sha_out: dict):
    """返回记录数组；None = 文件确实不存在（跳过）。其余任何问题都是 WindowError，不当「缺失」。

    B4 绑定：只 open 一次、只 read 一次，sha256 与 json 都从这同一份内存字节算；sha 记进调用方传入的
    sha_out[<路径>]（每次运行新建，不留在模块级：同进程上一次运行的 sha 不得混进这一次的汇总）。
    解码严格：raw.decode("utf-8") 不带 errors=、不剥 BOM，再 json.loads(text)。UTF-8 BOM → JSONDecodeError、
    UTF-16 → UnicodeDecodeError，都与坏 JSON 同归 WindowError。不用 json.loads(bytes)：它会自动认 BOM / UTF-16，
    等于放宽冻结版的接受范围。文件在读取之后被替换只能影响下一次运行。
    """
    if not os.path.lexists(path):
        return None
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        digest = hashlib.sha256(raw).hexdigest()
        text = raw.decode("utf-8")                           # 严格解码：同一份字节，不认 BOM / UTF-16
        recs = json.loads(text)                              # 从同一份字节解出的文本解析，不二次开文件
    except (OSError, ValueError, RecursionError) as exc:      # 悬空软链/目录/无权限/非 UTF-8/坏 JSON/深嵌套
        raise WindowError("窗口无法读取 %s（%s: %s）" % (path, type(exc).__name__, exc))
    sha_out[path] = digest
    if not isinstance(recs, list):
        raise WindowError("窗口顶层不是数组 %s（是 %s）" % (path, type(recs).__name__))
    bad = [i for i, r in enumerate(recs) if not isinstance(r, dict)]
    if bad:
        raise WindowError("窗口含非对象元素 %s（首个下标 %d，类型 %s）"
                          % (path, bad[0], type(recs[bad[0]]).__name__))
    return recs


def write_rows(path: str, rows) -> None:
    """temp + os.replace 原子落盘（V-CHECKS V-7）：中途失败不留半截文件，也不动已有的 --out。"""
    fd, tmp = tempfile.mkstemp(prefix=".window_to_rows.", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        um = os.umask(0)
        os.umask(um)
        os.chmod(tmp, 0o666 & ~um)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def main() -> int:
    ap = _ArgParser(description="真实窗口 → 明细行 ndjson（一行一条），供 tools/m1_gate.py 判定")
    ap.add_argument("--run", required=True, help="采集窗口目录（含 raw/<渠道>.json）")
    ap.add_argument("--out", required=True, help="输出 ndjson 路径（父目录须已存在）")
    ap.add_argument("--contract-version", default=None,
                    help="契约版本 vX.Y（默认取 UF003_CONTRACT_VERSION，再默认 v1.13）；只认 <契约目录>/detail-row.<ver>.schema.json")
    a = ap.parse_args()

    try:
        out_abs, contract_dir, run_abs = precheck(a.run, a.out)
        contract = bind_contract(resolve_version(a.contract_version), contract_dir)   # 版本门：全部在开写之前，不符即 rc=3
    except PreconditionError as exc:
        return fail(exc.tag, exc.msg)
    rule, columns, unknown_prefix = contract["rule"], contract["columns"], contract["unknown_prefix"]

    raw_dir = os.path.join(run_abs, "raw")
    if not os.path.isdir(raw_dir):
        tag = "RUN_RAW_DIR_INVALID" if os.path.lexists(raw_dir) else "RUN_RAW_DIR_MISSING"
        return fail(tag, "窗口原始目录不可用 %s" % raw_dir)

    batch_key, round4 = window_keys(run_abs)
    rows, by_channel, missing = [], {}, []
    window_sha = {}                  # 本次运行读到的窗口字节 sha（raw/<渠道>.json 路径 → sha256）；每次 main() 新建
    blocked_reasons = {}
    family_mismatch = {}             # 契约来源值 → 按契约族正则复核不通过的行数（只计数，不改写标识）
    family_re = contract["families"]   # 契约来源值 → 已编译的契约族正则（bind_contract 已核过存在且可编译）
    lid4 = 0                         # 四段 wecom（LID 造假）产出数；必须恒为 0，非 0 即本单作废

    for src in CHANNELS:
        try:
            recs = read_window(os.path.join(raw_dir, src + ".json"), window_sha)
        except WindowError as exc:
            return fail("WINDOW_READ_FAIL", str(exc))
        if recs is None:
            missing.append(src)                       # 确实不存在：跳过，不算失败
            continue
        by_channel[src] = 0
        source = CHANNEL_SOURCE[src]
        for rec in recs:
            by_channel[src] += 1
            row = {"record_id": ""}
            for f in OUTPUT_FIELDS:
                row[f] = ""
            row["身份档"] = IDENTITY_TIER                 # 每行都写：blocked 行同样是 unverified，不留空、不写 unknown
            try:
                ev = build_ident(src, rec)            # 每一段都来自 raw 原文的同名键
            except IdentError as exc:
                ev = ""
                key = (src, str(exc))
                blocked_reasons[key] = blocked_reasons.get(key, 0) + 1
            if ev:
                row["来源渠道"] = source
                row["来源事件标识"] = ev
                row["证据"] = NO_URL
                row["record_id"] = ev                 # 写前临时行标识 = 来源事件标识
                if WECOM_LID_RE.match(ev):
                    lid4 += 1
                pat = family_re.get(source)
                if pat is not None and not pat.fullmatch(ev):
                    family_mismatch[source] = family_mismatch.get(source, 0) + 1
            if batch_key:
                row["日报键"] = DAILY_KEY_PREFIX + batch_key
            row["对象"] = _text(rec.get(OBJECT_FIELD[src])) if src in OBJECT_FIELD else ""
            row["原始消息ID"] = _text(rec.get(RAW_ID_FIELD[src]))
            rows.append(row)

    key_stat = assign_key_columns(rows, rule, columns, unknown_prefix)   # 键列：全窗口收齐后统一算

    blocked = sum(1 for r in rows if any(not r[f] for f in IDENTITY_FIELDS))
    underived = {}
    for f in OUTPUT_FIELDS:
        k = sum(1 for r in rows if r[f] == "")
        if k:
            underived[f] = k

    tier = {"身份档_" + t: 0 for t in IDENTITY_TIERS}     # 身份档_verified / 身份档_unverified：开写之前核，不符即 rc=3
    for i, r in enumerate(rows, 1):
        t = r["身份档"]
        if t not in IDENTITY_TIERS:
            return fail("IDENTITY_TIER_INVALID", "第 %d 行 身份档=%r 不在 %s 内，拒绝写出" % (i, t, "/".join(IDENTITY_TIERS)))
        tier["身份档_" + t] += 1
    if sum(tier.values()) != len(rows):
        return fail("IDENTITY_TIER_COUNT_BAD", "身份档 计数 %s 之和 ≠ rows=%d，拒绝写出" % (tier, len(rows)))

    try:
        write_rows(out_abs, rows)
    except OSError as exc:
        return fail("OUT_WRITE_FAIL", "%s（%s: %s）" % (out_abs, type(exc).__name__, exc))

    print("INFO contract_dir=%s contract_version=%s contract_file=%s contract_sha256=%s row_key_rule=%s batch_key=%s round4=%s "
          "workitems=%d max_seq=%d 身份档_verified=%d 身份档_unverified=%d"
          % (contract_dir, contract["version"], contract["file"], contract["sha256"], rule, batch_key, round4,
             key_stat["workitems"], key_stat["max_seq"], tier["身份档_verified"], tier["身份档_unverified"]), file=sys.stderr)
    for (src, reason), cnt in blocked_reasons.items():
        print("WARN blocked %s x%d: %s" % (src, cnt, reason[:REASON_MAX]), file=sys.stderr)
    for ch, cnt in family_mismatch.items():
        print("WARN ident_family_mismatch %s x%d：标识按本单口径（raw 同名键逐段）组装，不符合契约 %s 族正则，闸门将判 event_id_family"
              % (ch, cnt, contract["version"]), file=sys.stderr)
    emit(json.dumps({
        "ok": blocked == 0, "rows": len(rows), "by_channel": by_channel, "underived": underived,
        "blocked_rows": blocked, "out": a.out, "missing": missing,
        "contract_version": contract["version"], "contract_file": contract["file"], "contract_sha256": contract["sha256"],
        "row_key_rule": rule,
        "身份档_verified": tier["身份档_verified"], "身份档_unverified": tier["身份档_unverified"],
        "ident_family_mismatch": family_mismatch, "ident_lid4seg": lid4,
        "used_bytes_sha256": {os.path.basename(k): v for k, v in window_sha.items()},
    }, ensure_ascii=False))
    return 0 if blocked == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
