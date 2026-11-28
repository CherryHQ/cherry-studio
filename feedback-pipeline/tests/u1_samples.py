#!/usr/bin/env python3
"""U1 判定样例：41 个固定输入跑 build_identity，**带断言**，不符即 rc=1。

用法：python3 stage-003/tests/u1_samples.py [out.json]
只读：企微 Info.db（immutable）、QQ collector 库（ro）各取真实 id 做样例。
每条用例给 expected：渠道 / 事件 id / 证据 / 身份档 / 说明必含子串；抛错用例校验异常**类型**。
第 4 轮补充：证据四条件（合法主机、非私有深链、public_confirmed、public_url_event 绑定）、
容器类型原始 id、rid=0 不遮 mid、原样 id 跨行降级、QQ 候选正则全匹配、契约移除渠道后的漂移。
r9 A：凡在内存里构造/修改契约的用例必须显式 contract_is_synthetic=True——合成契约下生成器只能得出
REFUSE/拒绝结论（来源事件标识=U.SYNTHETIC_REFUSE_ID，不可入库）；未声明即拒（68–72 钉住）。
生产 CLI 没有通往合成入口的参数/环境变量。
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools"))
import uf003_identity as U  # noqa: E402
import id_patterns  # noqa: E402

WECOM_DB = "/Users/cherryai003/WeCom-Agent-V2/WeCom-Agent/logs/wecom_decrypted/Info.db"
QQ_DB = "/Users/cherryai003/.orca/services/qq-collector/data/messages.sqlite3"
NO_URL = U.NO_URL
BASE = {"batch_key": "20261124", "round4": 1, "allow_qq_candidate": True}
SYN = {"contract_is_synthetic": True}      # 内存构造契约的用例必带；不带即 REFUSE（见 68/71）
REFUSE = U.SYNTHETIC_REFUSE_ID


def real_ids():
    wc = sqlite3.connect(f"file:{WECOM_DB}?mode=ro&immutable=1", uri=True)
    rid, conv, seq = wc.execute(
        "select RID, conv_id, seq from MESSAGE where seq>0 order by RID desc limit 1").fetchone()
    qq = sqlite3.connect(f"file:{QQ_DB}?mode=ro", uri=True)
    qid = qq.execute("select id from messages order by rowid desc limit 1").fetchone()[0]
    group = qq.execute("select group_openid from messages where id=? limit 1", (qid,)).fetchone()[0]
    return {"rid": rid, "conv": conv, "seq": seq, "qq_id": qid, "qq_group": group}


def E(ch, ident, ev=NO_URL, lvl="unverified", notes=(), raised=None, raised_contains=None,
      notes_absent=()):
    return {"channel": ch, "id": ident, "evidence": ev, "identity": lvl,
            "notes_contains": list(notes), "notes_absent": list(notes_absent),
            "raised": raised, "raised_contains": raised_contains}


def drift_contract(remove: str):
    """内存里从契约移除某渠道，模拟契约漂移（不改磁盘文件）。"""
    c = U.load_contract()
    c = json.loads(json.dumps(c))
    c["channel_sources"] = [x for x in c["channel_sources"] if x != remove]
    c["family_by_channel"].pop(remove, None)
    c["families"].pop(remove, None)
    return c


def tightened_contract(channel: str, pattern: str):
    """模拟 PM 收紧某渠道族规则（内存副本，不改磁盘）。"""
    c = json.loads(json.dumps(U.load_contract()))
    c["families"][channel] = pattern
    return c


def v110_qq_segment():
    """v1.10 schema 的 QQ 段原文（哈希在冻结表里，但属于 v1.10）；契约目录没有该文件时为 None。"""
    try:
        return U._load_json("detail-row.v1.10.schema.json")["properties"]["来源事件标识"]["channel_family_patterns"]["QQ"]
    except (OSError, ValueError, KeyError, TypeError):
        return None


def cases(ids):
    r, conv, seq, qid, grp = ids["rid"], ids["conv"], ids["seq"], ids["qq_id"], ids["qq_group"]
    tgid = "tg:-1002184818189:273111"
    v110 = v110_qq_segment()
    table = [
        # --- 企微 ---
        ("1 真实 conv/seq", "wecom", {"conv_id": 10812375771529472, "seq": 5918929}, {**BASE, "row_no": 1},
         E("企微", "wc:10812375771529472:5918929")),
        ("2 seq=0 系统消息", "企微", {"conv_id": "10812375771529472", "seq": 0}, {**BASE, "row_no": 2},
         E("企微", "unknown:user-feedback-20261124#0001:2", notes=["seq=0"])),
        ("3 缺 seq 按 RID 回查", "wecom", {"rid": r}, {**BASE, "row_no": 3},
         E("企微", f"wc:{conv}:{seq}", notes=[f"RID {r}"])),
        ("3b 空 conv + RID", "wecom", {"conv_id": "", "rid": r}, {**BASE, "row_no": 4},
         E("企微", f"wc:{conv}:{seq}")),
        ("3c 空 conv 空 seq + RID", "wecom", {"conv_id": "", "seq": "", "rid": r}, {**BASE, "row_no": 5},
         E("企微", f"wc:{conv}:{seq}")),
        ("3d rid 缺失但 mid 在", "wecom", {"mid": r}, {**BASE, "row_no": 6},
         E("企微", f"wc:{conv}:{seq}")),
        ("3e rid=0 不遮有效 mid", "wecom", {"rid": 0, "mid": r}, {**BASE, "row_no": 7},
         E("企微", f"wc:{conv}:{seq}", notes=[f"RID {r}"])),
        ("13 seq=1.9 不截断", "企微", {"conv_id": "10812375771529472", "seq": 1.9}, {**BASE, "row_no": 13},
         E("企微", "unknown:user-feedback-20261124#0001:13", notes=["ID 解析失败"])),
        ("13b seq 13 位超契约", "企微", {"conv_id": "10812375771529472", "seq": 1234567890123},
         {**BASE, "row_no": 14}, E("企微", "unknown:user-feedback-20261124#0001:14", notes=["超过上限"])),
        ("14 空 conv 无 RID", "wework", {"conv_id": "", "seq": 5}, {**BASE, "row_no": 15},
         E("企微", "unknown:user-feedback-20261124#0001:15", notes=["回查"])),
        ("16 源值 企业微信 原样", "企业微信", {"conv_id": "10812375771529472", "seq": 7}, {},
         E("企业微信", "wc:10812375771529472:7")),
        ("20 大小写别名 WeCom", "WeCom", {"conv_id": "1", "seq": 2}, {},
         E("企微", "wc:1:2", notes=["表外拼写"])),
        # --- QQ ---
        ("4 QQ 真实 id", "qq", {"id": qid, "group_openid": grp}, {**BASE, "row_no": 16},
         E("QQ", f"qq:{grp}:{qid}", notes=["v1.10"])),
        ("15 QQ 缺 group 回查", "qq", {"id": qid}, {**BASE, "row_no": 17},
         E("QQ", f"qq:{grp}:{qid}", notes=["group_openid"])),
        ("21 QQ group 是群名不当 openid", "qq", {"id": qid, "group": "CherryStudio 官方群6"},
         {**BASE, "row_no": 28}, E("QQ", f"qq:{grp}:{qid}", notes=["group_openid"])),
        ("26 QQ 尾部 /invalid 不得前缀通过", "qq", {"id": "ROBOT1.0_valid/invalid",
                                                "group_openid": "G1"}, {**BASE, "row_no": 29},
         E("QQ", "unknown:user-feedback-20261124#0001:29", notes=["不符合"])),
        # --- Telegram ---
        ("5 TG username 字符串不造链接", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                                 "username": "cherrystudio"}, {**BASE, "row_no": 18},
         E("Telegram", tgid, notes=["t.me/c"])),
        ("5b TG username=True 布尔", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                               "username": True}, {**BASE, "row_no": 19},
         E("Telegram", tgid, notes=["t.me/c"])),
        ("5c public_url 五条件齐备", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                              "username": "cherrystudio",
                                              "public_url": "https://t.me/cherrystudio/273111",
                                              "public_confirmed": True,
                                              "public_url_event": tgid}, {**BASE, "row_no": 20},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5d public_url 未确认", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                           "public_url": "https://t.me/cherrystudio/273111",
                                           "public_url_event": tgid}, {**BASE, "row_no": 21},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5e public_url 缺事件绑定", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                               "public_url": "https://t.me/cherrystudio/273111",
                                               "public_confirmed": True}, {**BASE, "row_no": 30},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5f 无主机 https 不算 URL", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                              "public_url": "https:///missing-host",
                                              "public_confirmed": True,
                                              "public_url_event": tgid}, {**BASE, "row_no": 31},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5g 私有深链即便确认也不进证据", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                                "public_url": "https://t.me/c/123/42",
                                                "public_confirmed": True,
                                                "public_url_event": tgid}, {**BASE, "row_no": 32},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5i 大写主机私有深链", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                        "username": "cherrystudio",
                                        "public_url": "https://T.ME/c/123/42",
                                        "public_confirmed": True,
                                        "public_url_event": tgid}, {**BASE, "row_no": 37},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5j 带 443 端口的私有深链", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                            "username": "cherrystudio",
                                            "public_url": "https://t.me:443/c/123/42",
                                            "public_confirmed": True,
                                            "public_url_event": tgid}, {**BASE, "row_no": 38},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5k 大写 discordapp 深链", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                             "username": "cherrystudio",
                                             "public_url": "https://DiscordApp.com/channels/1/2/3",
                                             "public_confirmed": True,
                                             "public_url_event": tgid}, {**BASE, "row_no": 39},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5l 无关 GitHub URL 不是本事件证据", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                                   "username": "cherrystudio",
                                                   "public_url": "https://github.com/CherryHQ/cherry-studio/issues/24294",
                                                   "public_confirmed": True,
                                                   "public_url_event": tgid}, {**BASE, "row_no": 40},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5m 链接消息号不符", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                      "username": "cherrystudio",
                                      "public_url": "https://t.me/cherrystudio/999",
                                      "public_confirmed": True,
                                      "public_url_event": tgid}, {**BASE, "row_no": 41},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5n 端口 99999 非法", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                        "username": "cherrystudio",
                                        "public_url": "https://example.com:99999/event",
                                        "public_confirmed": True,
                                        "public_url_event": tgid}, {**BASE, "row_no": 42},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5o 破损 URL 不崩溃", "telegram", {"chat": "-1002184818189", "mid": 273111,
                                       "username": "cherrystudio",
                                       "public_url": "https://[broken/event",
                                       "public_confirmed": True,
                                       "public_url_event": tgid}, {**BASE, "row_no": 43},
         E("Telegram", tgid, notes=["归属未验证"])),
        ("5p Discord 频道链接属私有深链", "Discord", {"guild_id": 1, "channel_id": 2, "message_id": 3,
                                                   "public_url": "https://discord.com/channels/1/2/3",
                                                   "public_confirmed": True,
                                                   "public_url_event": "dc:1:2:3"}, {**BASE, "row_no": 44},
         E("Discord", "dc:1:2:3", notes=["归属未验证"])),
        ("5q Discord 链接群不符也不进证据", "Discord", {"guild_id": 1, "channel_id": 2, "message_id": 3,
                                                "public_url": "https://discord.com/channels/9/2/3",
                                                "public_confirmed": True,
                                                "public_url_event": "dc:1:2:3"}, {**BASE, "row_no": 45},
         E("Discord", "dc:1:2:3", notes=["归属未验证"])),
        ("5h chat=None 但 chat_id 在", "telegram", {"chat": None, "chat_id": "-1002184818189", "mid": 273111},
         {**BASE, "row_no": 22}, E("Telegram", tgid)),
        ("6 普通数字 chat", "tg", {"chat": 123456, "mid": 9}, {**BASE, "row_no": 23},
         E("Telegram", "tg:123456:9")),
        # --- Discord ---
        ("7 缺 channel_id 降级", "Discord", {"guild_id": 1, "message_id": 3}, {**BASE, "row_no": 24},
         E("Discord", "unknown:user-feedback-20261124#0001:24", notes=["原始 id"])),
        ("7b message_id=None 但 mid 在", "Discord", {"guild_id": 1, "channel_id": 2, "message_id": None, "mid": 3},
         {**BASE, "row_no": 25}, E("Discord", "dc:1:2:3")),
        ("18 guild 注入换行", "Discord", {"guild_id": "1\n说明", "channel_id": 2, "message_id": 3},
         {**BASE, "row_no": 26}, E("Discord", "unknown:user-feedback-20261124#0001:26", notes=["符合"])),
        # --- 内部飞书 / 邮箱 ---
        ("10 内部飞书 om_", "内部飞书", {"message_id": "om_abc"}, {},
         E("内部飞书", "om_abc", notes=["无对外链接"])),
        ("11 邮箱 Message-ID", "mail", {"message_id_header": "<a3f9@mail.example.com>",
                                     "from_address": "alice@example.com"}, {},
         E("支持邮箱", "mail:a3f9@mail.example.com", notes=["from=alice@example.com"])),
        ("11b 邮箱无 Message-ID", "mail", {"from_address": "alice@example.com"},
         {**BASE, "row_no": 27}, E("支持邮箱", "unknown:user-feedback-20261124#0001:27",
                                   notes=["不能以发件地址"])),
        ("23 邮箱 header 是列表", "mail", {"message_id_header": ["abc@example.com"], "from_address": "a@b.c"},
         {**BASE, "row_no": 33}, E("支持邮箱", "unknown:user-feedback-20261124#0001:33",
                                   notes=["不可用作 id（list）"])),
        # --- 待映射 / 其它 ---
        ("8 未知源带真实 id", "weibo", {"id": "wb_777"}, {}, E("待映射", "wb_777", notes=["未经归一化"])),
        ("8b 201 字符原样", "weibo", {"id": "w" * 201}, {}, E("待映射", "w" * 201)),
        ("8c 首尾空格原样", "weibo", {"id": " wb_777 "}, {}, E("待映射", " wb_777 ")),
        ("8d 只有 rfc_message_id 也保留", "weibo", {"rfc_message_id": "<x@y.z>"}, {}, E("待映射", "<x@y.z>")),
        ("8e id 与 rfc 同时存在都留痕", "weibo", {"id": "short", "rfc_message_id": "<long@example.com>"}, {},
         E("待映射", "short", notes=["另有原始 id 字段"])),
        ("22 id 是列表不能当 id", "weibo", {"id": []}, {**BASE, "row_no": 34},
         E("待映射", "unknown:user-feedback-20261124#0001:34", notes=["不可用作 id（list）"])),
        ("25 原样 id 跨行降级", "weibo", {"id": "event\n123"}, {**BASE, "row_no": 35},
         E("待映射", "unknown:user-feedback-20261124#0001:35", notes=["event\\n123"])),
        ("9 无 id 无批次键", "weibo", {}, {}, E(None, None, raised="ResolveError", raised_contains="未给批次键")),
        ("9b 有批次键无轮次", "weibo", {}, {"batch_key": "20261124"}, E(None, None, raised="ResolveError", raised_contains="轮次与行号")),
        ("9c 全角批次键", "weibo", {}, {"batch_key": "２０２６１１２４", "round4": 1, "row_no": 1},
         E(None, None, raised="ResolveError", raised_contains="批次键")),
        ("12 target 拼写 其他", "其他", {"id": "x1"}, {}, E("其它", "x1")),
        ("19 微信不并入企微", "微信", {"id": "wx_1"}, {}, E("待映射", "wx_1")),
        ("17 批次键带前缀", "telegram", {"chat": 1, "mid": 2},
         {"batch_key": "user-feedback-20261124", "round4": 1, "row_no": 17}, E("Telegram", "tg:1:2")),
        ("34 QQ 跨群重复 id 不猜群", "qq", {"id": "ROBOT1.0_dup"},
         {"_mem": "qq-dup"}, E(None, None, raised="ResolveError", raised_contains="多个群")),
        ("27 契约移除 QQ 后别名不得静默降级", "qq", {"id": qid, "group_openid": grp},
         {"contract": drift_contract("QQ"), **SYN}, E(None, None, raised="ResolveError", raised_contains="契约漂移")),
        ("28 收紧族规则后占位不合规必须显式失败", "weibo", {"id": "x1"},
         {"contract": tightened_contract("待映射", r"wb_[0-9]+"), **SYN, "batch_key": "20261124",
          "round4": 1, "row_no": 36}, E(None, None, raised="ResolveError", raised_contains="拒绝输出不合规行")),
        ("28b 合成契约下合规 id 也只给 REFUSE", "weibo", {"id": "wb_777"},
         {"contract": tightened_contract("待映射", r"wb_[0-9]+"), **SYN}, E("待映射", REFUSE)),
        ("29 rid 超 SQLite 范围不遮 mid", "wecom", {"rid": 9223372036854775808, "mid": r},
         {**BASE, "row_no": 46}, E("企微", f"wc:{conv}:{seq}", notes=[f"RID {r}"])),
        ("30 telegram mid=0 回退 message_id", "telegram", {"chat": 123, "mid": 0, "message_id": 42},
         {**BASE, "row_no": 47}, E("Telegram", "tg:123:42")),
        ("31 邮件 header 破损回退 rfc_message_id", "mail", {"message_id_header": "broken",
                                                       "rfc_message_id": "abc@example.com"},
         {**BASE, "row_no": 48}, E("支持邮箱", "mail:abc@example.com")),
        ("32 长原始 id 原样入列", "weibo", {"id": "x" * 4097}, {}, E("待映射", "x" * 4097)),
        ("35 说明长度上限", "weibo", {"id": "small"},
         {**BASE, "row_no": 50, "extra_note": ["N" * 30000, "M" * 30000]},
         E("待映射", "small", notes=["已截断"])),
        ("33 10001 字符真实 id 不丢", "weibo", {"id": "y" * 10001}, {}, E("待映射", "y" * 10001)),
        ("36 超落表护栏改占位", "weibo", {"id": "z" * 50001}, {**BASE, "row_no": 51},
         E("待映射", "unknown:user-feedback-20261124#0001:51", notes=["落表安全上限"])),
        # --- 第 6 轮返修 ---
        ("37 飞书 message_id 破损回退 om", "feishu", {"message_id": "broken", "om": "om_good1"},
         {}, E("内部飞书", "om_good1")),
        ("38 QQ id 破损回退 message_id", "qq", {"id": "broken", "message_id": "ROBOT1.0_good",
                                               "group_openid": "G1"},
         {**BASE}, E("QQ", "qq:G1:ROBOT1.0_good")),
        ("39 其它 id 跨行时用 message_id", "weibo", {"id": "bad\nvalue", "message_id": "good_123"},
         {}, E("待映射", "good_123")),
        ("40 telegram 超长数字 mid 回退", "telegram", {"chat": 123, "mid": "9" * 4301, "message_id": 42},
         {}, E("Telegram", "tg:123:42")),
        ("41 telegram mid 超 32 位回退", "telegram", {"chat": 123, "mid": 2 ** 31, "message_id": 42},
         {}, E("Telegram", "tg:123:42")),
        ("42 QQ 错前缀不冒充真实 id", "qq", {"id": "ROBOT1.bad", "group_openid": "G1"},
         {**BASE, "row_no": 52}, E("QQ", "unknown:user-feedback-20261124#0001:52")),
        ("43 合成收紧 QQ 契约后旧 id 不硬塞", "qq", {"id": "ROBOT1.0_bad", "group_openid": "G1"},
         {"contract": tightened_contract(
             "QQ", r"(qq:G1:ROBOT1\.0_good|unknown:user-feedback-[0-9]{8}#[0-9]{4}:[0-9]+)"), **SYN,
          **BASE, "row_no": 53},
         E("QQ", REFUSE, notes=["ID 解析失败", "不符合 QQ 契约族规则"])),
        ("44 QQ 不给候选开关时按契约降级", "qq", {"id": qid, "group_openid": grp},
         {"allow_qq_candidate": False, **{k: v for k, v in BASE.items() if k != "allow_qq_candidate"},
          "row_no": 54},
         E("QQ", "unknown:user-feedback-20261124#0001:54", notes=["不符合 QQ 契约族规则"])),
        ("45 企微 rid 命中 seq=0 继续试 mid", "wecom", {"rid": 1, "mid": 2},
         {"_mem": "wecom-seq0"}, E("企微", "wc:C:42", notes=["seq=0"])),
        # --- 第 7 轮返修（P1 反例）---
        ("46 企微 RID 多行不猜", "wecom", {"rid": 3, "mid": 5},
         {"_mem": "wecom-dup-rid"}, E("企微", "wc:C:42", notes=["命中多行"])),
        ("47 rowid 按行号查", "wecom", {"rowid": 1}, {"_mem": "wecom-rowid"},
         E("企微", "wc:A:1")),
        ("47b rid=10 按 RID 查不是行号", "wecom", {"rid": 10}, {"_mem": "wecom-rowid"},
         E("企微", "wc:B:2")),
        ("48 命中行 conv 非法继续试 mid", "wecom", {"rid": 4, "mid": 2},
         {"_mem": "wecom-badconv"}, E("企微", "wc:C:42", notes=["conv_id 不可用"])),
        ("49 QQ id 含 / 不遮 message_id", "qq", {"id": "ROBOT1.0_bad/invalid",
                                                 "message_id": "ROBOT1.0_good",
                                                 "group_openid": "G1"}, {"batch_key": "20261124",
                                                                         "round4": 1,
                                                                         "allow_qq_candidate": True},
         E("QQ", "qq:G1:ROBOT1.0_good")),
        ("50 mid 是超大整数回退 message_id", "telegram",
         {"chat": 123, "mid": 10 ** 5000, "message_id": 42}, {}, E("Telegram", "tg:123:42")),
        ("51 chat 是超大整数回退 chat_id", "telegram",
         {"chat": 10 ** 5000, "chat_id": 123, "mid": 42}, {}, E("Telegram", "tg:123:42")),
        ("52 长度降级占位不合规要显式失败", "telegram",
         {"chat": "1" * 50001, "mid": 42},
         {"contract": tightened_contract("Telegram", r"tg:-?[0-9]+:[0-9]+"), **SYN, **BASE, "row_no": 59},
         E(None, None, raised="ResolveError", raised_contains="拒绝输出不合规行")),
        ("53 长度降级保留原因", "telegram", {"chat": "1" * 50001, "mid": 42},
         {**BASE, "row_no": 60},
         E("Telegram", "unknown:user-feedback-20261124#0001:60", notes=["不可能是平台消息序号"])),
        ("54 飞书也有原链接线索", "feishu",
         {"om": "om_good2", "public_url": "https://example.com/event"}, {},
         E("内部飞书", "om_good2", notes=["原文链接"])),
        ("55 降级行也保留链接线索", "telegram",
         {"chat": 123, "mid": 0, "public_url": "https://t.me/some/1"},
         {**BASE, "row_no": 61},
         E("Telegram", "unknown:user-feedback-20261124#0001:61", notes=["原文链接"])),
        ("56 行号超上限拒绝", "weibo", {},
         {"batch_key": "20261124", "round4": 1, "row_no": 10 ** 8},
         E(None, None, raised="ResolveError", raised_contains="行号")),
        # --- 第 8 轮返修（P1 反例）---
        ("57 合成收紧 QQ 首选不合族退 message_id", "qq",
         {"group_openid": "G1", "id": "ROBOT1.0_bad", "message_id": "ROBOT1.0_good"},
         {"contract": tightened_contract("QQ", r"qq:G1:ROBOT1\.0_good|unknown:user-feedback-[0-9]{8}#[0-9]{4}:[0-9]+"),
          **SYN, "batch_key": "20261124", "round4": 1, "row_no": 62, "allow_qq_candidate": True},
         E("QQ", REFUSE, notes=["此前候选未采用", "group_openid=G1"], notes_absent=["qq:G1:ROBOT1.0_good"])),
        ("58 QQ 首选查不到群退 message_id", "qq",
         {"id": "ROBOT1.0_missing", "message_id": "ROBOT1.0_good"},
         {"_mem": "qq-single", **BASE, "allow_qq_candidate": True},
         E("QQ", "qq:G9:ROBOT1.0_good")),
        ("59 超大 mid 无备用键降级不崩", "telegram", {"chat": 123, "mid": 10 ** 5000},
         {**BASE, "row_no": 63}, E("Telegram", "unknown:user-feedback-20261124#0001:63")),
        ("60 超 int64 的整数 id 仍写真实 id", "其它", {"id": 2 ** 64, "message_id": "abc"}, {},
         E("其它", "18446744073709551616")),
        ("61 说明不再声称完整保留", "其它", {"id": "a", "message_id": "b"}, {},
         E("其它", "a", notes=["回显仅前"])),
        # --- 第 9 轮返修（P1-d 原因留痕、P1-e 邮箱整数、P2-g 说明口径）---
        ("62 QQ 回退成功也留首选失败原因", "qq",
         {"id": "ROBOT1.0_missing", "message_id": "ROBOT1.0_good"},
         {"_mem": "qq-single", **BASE, "allow_qq_candidate": True, "row_no": 64},
         E("QQ", "qq:G9:ROBOT1.0_good", notes=["此前候选未采用", "查不到 group_openid"])),
        ("63 合成收紧 QQ 全失败逐个留原因", "qq",
         {"id": "ROBOT1.0_missing", "message_id": "ROBOT1.0_good"},
         {"_mem": "qq-single", "contract": tightened_contract(
             "QQ", r"qq:G1:ROBOT1\.0_good|unknown:user-feedback-[0-9]{8}#[0-9]{4}:[0-9]+"),
          **SYN, "batch_key": "20261124", "round4": 1, "row_no": 65, "allow_qq_candidate": True},
         E("QQ", REFUSE,
           notes=["所有候选都不可用", "查不到 group_openid", "不符合"])),
        ("64 邮箱 from= 超大整数不崩", "mail",
         {"from_address": 10 ** 5000, "message_id": "abc@example.com"}, {},
         # 只断言 id 与 from= 留痕：超长整数的回显文本随 Python 版本不同（<3.11 截断 / ≥3.11 无法回显）
         E("支持邮箱", "mail:abc@example.com", notes=["from="])),
        ("65 说明长度只按原值口径", "其它", {"id": "a" * 50001}, {**BASE, "row_no": 66},
         E("其它", "unknown:user-feedback-20261124#0001:66",
           notes=["原值 50001 字符"], notes_absent=["50003"])),
        # --- 第 10 轮返修（P1-d 尾部失败、负号位数诊断）---
        ("66 合成收紧 QQ 尾部失败原因也不丢", "qq",
         {"id": "ROBOT1.0_good", "message_id": "ROBOT1.0_missing", "mid": "/invalid"},
         {"_mem": "qq-single", "contract": tightened_contract(
             "QQ", r"qq:G1:ROBOT1\.0_good|unknown:user-feedback-[0-9]{8}#[0-9]{4}:[0-9]+"),
          **SYN, "batch_key": "20261124", "round4": 1, "row_no": 67, "allow_qq_candidate": True},
         E("QQ", REFUSE,
           notes=["所有候选都不可用", "查不到 group_openid", "message_id", "mid"])),
        ("67 负数位数诊断不含符号", "telegram", {"chat": "-" + "1" * 20, "mid": 42},
         {**BASE, "row_no": 68}, E("Telegram", "unknown:user-feedback-20261124#0001:68",
                                   notes=["位数 20"], notes_absent=["位数 21"])),
        # --- r9 A：契约来源收口（门禁复现：内存契约放宽 QQ 段后 build_identity 曾直接产出 qq:G:ROBOT1.0_ok）---
        ("68 内存契约放宽 QQ 段未声明合成即拒", "qq", {"id": "ROBOT1.0_ok", "group_openid": "G"},
         {"contract": tightened_contract("QQ", r"\Aqq:.*\Z")},
         E(None, None, raised="QQSegmentDrift", raised_contains=id_patterns.QQ_DRIFT_TAG)),
        ("69 内存契约换入 v1.10 QQ 段：版本不符即拒", "qq", {"id": "ROBOT1.0_ok", "group_openid": "G"},
         {"contract": tightened_contract("QQ", v110)},
         E(None, None, raised="QQSegmentDrift", raised_contains=id_patterns.QQ_VERSION_TAG)) if v110 else None,
        ("70 磁盘契约的 json 往返副本仍是真契约", "qq", {"id": "ROBOT1.0_good", "group_openid": "G1"},
         {"contract": json.loads(json.dumps(U.load_contract())), **BASE}, E("QQ", "qq:G1:ROBOT1.0_good")),
        ("71 非 QQ 段收紧的内存契约未声明合成也拒", "weibo", {"id": "wb_777"},
         {"contract": tightened_contract("待映射", r"wb_[0-9]+")},
         E(None, None, raised="ResolveError", raised_contains="合成契约")),
        ("72 assert_assembled 对未冻结正则直接拒（门禁脚本原样）", "assert",
         {"c": tightened_contract("QQ", r"\Aqq:.*\Z"), "event_id": "qq:G:ROBOT1.0_ok"},
         {"allow_qq_candidate": True}, E(None, None, raised="QQSegmentDrift", raised_contains=id_patterns.QQ_DRIFT_TAG)),
        ("72b assert_assembled 对占位 id 也先过门", "assert",
         {"c": tightened_contract("QQ", r"\Aqq:.*\Z"), "event_id": "unknown:user-feedback-20261124#0001:1"},
         {}, E(None, None, raised="QQSegmentDrift", raised_contains=id_patterns.QQ_DRIFT_TAG)),
    ]
    return [x for x in table if x is not None]   # 69 依赖契约目录里的 detail-row.v1.10.schema.json，缺失则不列


class NoCloseConn(sqlite3.Connection):
    """被测代码每个键都会 close() 连接；内存库要跨调用存活，close 变空操作。"""

    def close(self):  # noqa: D401
        pass


def mem_qq_dup() -> sqlite3.Connection:
    con = sqlite3.connect(":memory:", factory=NoCloseConn)
    con.execute("create table messages (group_openid text, id text, primary key (group_openid, id))")
    con.executemany("insert into messages values (?,?)",
                    [("G1", "ROBOT1.0_dup"), ("G2", "ROBOT1.0_dup")])
    con.commit()
    return con


def mem_wecom_seq0() -> sqlite3.Connection:
    """(RID,conv,seq)=(1,'C',0) 系统行 + (2,'C',42) 正文行：rid 命中 seq=0 必须继续试 mid。"""
    con = sqlite3.connect(":memory:", factory=NoCloseConn)
    con.execute("create table MESSAGE (RID integer, conv_id text, seq integer)")
    con.executemany("insert into MESSAGE values (?,?,?)", [(1, "C", 0), (2, "C", 42)])
    con.commit()
    return con


def effective_family_ok(ch: str, event_id: str, contract: dict, allow_candidate: bool) -> bool:
    """与实现同一套判定：QQ 候选例外只在显式开关且契约仍是出厂版本时生效。"""
    if event_id.startswith(U.UNKNOWN_PREFIX):
        # 占位不在候选正则的覆盖范围里，判它只能按契约
        return U.family_ok(ch, event_id, contract)
    if ch in U.CONTRACT_DEFECT_CHANNELS and allow_candidate and U.qq_contract_is_shipped(contract):
        return U.family_ok_proposed(ch, event_id)
    return U.family_ok(ch, event_id, contract)


def _mem_wecom(rows):
    con = sqlite3.connect(":memory:", factory=NoCloseConn)
    con.execute("create table MESSAGE (RID integer, conv_id text, seq integer)")
    con.executemany("insert into MESSAGE values (?,?,?)", rows)
    con.commit()
    return con


def mem_wecom_dup_rid():
    """RID=3 命中两行：RID 在本库不是唯一约束，不能任取首行。"""
    return _mem_wecom([(3, "A", 1), (3, "B", 2), (5, "C", 42)])


def mem_wecom_rowid():
    """rowid 1 -> RID=100 / rowid 2 -> RID=10：rowid 与 RID 语义不同，不能混用。"""
    return _mem_wecom([(100, "A", 1), (10, "B", 2)])


def mem_wecom_badconv():
    """RID=4 命中 conv_id='bad.conv'（不合契约）：必须继续试 mid。"""
    return _mem_wecom([(4, "bad.conv", 42), (2, "C", 42)])


def mem_qq_single():
    """库里只有 ROBOT1.0_good(G9)：首选 id 查不到群时必须退到 message_id。"""
    con = sqlite3.connect(":memory:", factory=NoCloseConn)
    con.execute("create table messages (group_openid text, id text)")
    con.execute("insert into messages values ('G9','ROBOT1.0_good')")
    con.commit()
    return con


MEM_FACTORIES = {"qq-dup": mem_qq_dup, "qq-single": mem_qq_single, "wecom-seq0": mem_wecom_seq0,
                 "wecom-dup-rid": mem_wecom_dup_rid, "wecom-rowid": mem_wecom_rowid,
                 "wecom-badconv": mem_wecom_badconv}


def check(case, row, synthetic=False):
    """synthetic=True：合成契约行只能是 REFUSE（ID 列=REFUSE 标记），族校验对它无意义，跳过。"""
    name, src, rec, kw, exp = case
    problems = []
    if exp["raised"]:
        got = row.get("_raised", "")
        if not exp.get("raised_contains"):
            # 否则任意同类异常都能「通过」（reviewer 第 7 轮 P2）
            problems.append("抛错用例缺 raised_contains，无法排除假通过")
        if not got:
            problems.append(f"期望抛 {exp['raised']}，实际产出 {row.get('来源事件标识')!r}")
        elif not got.startswith(exp["raised"] + ":"):
            problems.append(f"异常类型不符：{got[:60]}")
        elif exp.get("raised_contains") and exp["raised_contains"] not in got:
            # 同类型异常也会假通过：必须确认是预期那条原因，而不是别的 ResolveError
            problems.append(f"异常信息缺 {exp['raised_contains']!r}：{got[:80]}")
        return problems
    if "_raised" in row:
        return [f"意外抛出 {row['_raised']}"]
    if synthetic:
        if row["来源事件标识"] != REFUSE:
            problems.append(f"合成契约产出了可入库标识 {row['来源事件标识'][:50]!r}（只能是 {REFUSE}）")
        if "不可入库" not in row["说明"]:
            problems.append("合成契约行的 说明 缺 REFUSE/不可入库 标记")
    elif row.get("_family_ok") is not True:
        problems.append("产出行未通过本案实际契约的族校验（假通过）")
    if exp["channel"] and row["来源渠道"] != exp["channel"]:
        problems.append(f"渠道 {row['来源渠道']} != {exp['channel']}")
    if exp["id"] is not None and row["来源事件标识"] != exp["id"]:
        problems.append(f"id {row['来源事件标识'][:50]!r} != {exp['id'][:50]!r}")
    if row["证据"] != exp["evidence"]:
        problems.append(f"证据 {row['证据'][:40]!r} != {exp['evidence'][:40]!r}")
    if row["身份档"] != exp["identity"]:
        problems.append(f"身份档 {row['身份档']} != {exp['identity']}")
    if len(row["说明"]) > U.NOTE_MAX:
        problems.append(f"说明长度 {len(row['说明'])} 超过上限 {U.NOTE_MAX}")
    for sub in exp["notes_contains"]:
        if sub not in row["说明"]:
            problems.append(f"说明缺 {sub!r}")
    for sub in exp.get("notes_absent") or ():
        if sub in row["说明"]:
            problems.append(f"说明不该出现 {sub!r}")
    return problems


def main() -> int:
    out_path = sys.argv[1] if len(sys.argv) > 1 else "state/uf-003/u1-samples.json"
    c = U.load_contract()
    ids = real_ids()
    table = cases(ids)
    rows, failed = [], 0
    for case in table:
        name, src, rec, kw, exp = case
        kw = dict(kw)
        synthetic = bool(kw.pop("contract_is_synthetic", False))
        mem = kw.pop("_mem", None)
        old_db, old_wc, old_ro = U.QQ_DB, U.WECOM_DB, U._ro
        if mem:
            con = MEM_FACTORIES[mem]()
            target = "mem-qq" if mem == "qq-dup" else "mem-wecom"
            U.QQ_DB = target
            U.WECOM_DB = target if mem != "qq-dup" else U.WECOM_DB
            U._ro = lambda path, immutable=False: con if path == target else old_ro(path, immutable)
        try:
            if src == "assert":     # 直接调 assert_assembled（不经 build_identity）：未冻结即拒
                try:
                    U.assert_assembled(rec["c"], "QQ", rec["event_id"], bool(kw.get("allow_qq_candidate")))
                    out = {"来源事件标识": "assert_assembled 通过"}
                except Exception as exc:  # noqa: BLE001
                    out = {"_raised": f"{type(exc).__name__}: {exc}"}
            else:
                out = U.build_identity(src, rec, **{"contract": c, "contract_is_synthetic": synthetic, **kw})
            if src != "assert" and not synthetic:
                # 族校验必须用本案实际契约，否则假通过；合成契约行固定 REFUSE，不验族
                out["_family_ok"] = effective_family_ok(out["来源渠道"], out["来源事件标识"],
                                                        kw.get("contract") or c,
                                                        bool(kw.get("allow_qq_candidate", False)))
        except Exception as exc:  # noqa: BLE001
            out = {"_raised": f"{type(exc).__name__}: {exc}"}
        finally:
            U.QQ_DB, U.WECOM_DB, U._ro = old_db, old_wc, old_ro
        out["_case"] = name
        if synthetic:
            out["_synthetic"] = True     # 合成契约行（ID 列是 REFUSE 标记）：下游样本命中统计应跳过，它不代表真契约下的 id
        out["_expected"] = exp
        problems = check(case, out, synthetic)
        out["_ok"] = not problems
        if problems:
            out["_problems"] = problems
            failed += 1
        rows.append(out)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    for r in rows:
        status = "OK  " if r["_ok"] else "FAIL"
        body = r.get("_raised") or f"{r.get('来源渠道')} | {str(r.get('来源事件标识'))[:44]} | {str(r.get('证据'))[:28]} | {r.get('身份档')}"
        print(f"[{status}] {r['_case'][:30]:30s} {body}")
        for p in r.get("_problems", []):
            print(f"        ! {p}")
    print(f"\n{len(rows) - failed}/{len(rows)} passed; real RID={ids['rid']} conv={ids['conv']} seq={ids['seq']} qq_len={len(ids['qq_id'])}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
