#!/usr/bin/env python3
"""channel-map.json 单一加载器（uf003 U2.2，口径 2a）：读 json → 规范化 → 返回 dict。

两侧同时 import 本模块：tools/conformance.py（判定侧）与 uf003_identity.py（生成侧）。
本模块不 import 这两者（无循环依赖）；零业务判定（不看任何数据行）、零网络。

加载期校验四类字段取值都在 closed_set（契约 来源渠道 枚举）内，越界/缺失/类型错一律抛
EnumError（消息含字段路径与非法值；数组下标从 0 起，与 JSON/Python 一致）：
  rules[*].source / rules[*].target / fallback.source / fallback.target / target_enum

target_enum 单一真源（U2.2 r8，业主裁定「乙 + 防静默」）：映射文件必须显式声明派生方式，二选一，缺声明即拒——
  "target_enum_mode": "explicit"  必须手写 target_enum，且与派生结果逐项相等（顺序、元素数）；不等 → MAPPING_TARGET_ENUM_MISMATCH
  "target_enum_mode": "derived"   禁止手写 target_enum（写了 → MAPPING_TARGET_ENUM_FORBIDDEN，防两份真源）；运行时派生
  缺键 → MAPPING_DECL_MISSING；取值非法 / explicit 却没手写 → MAPPING_DECL_INVALID。
  以上四类都是 DeclError：消息自带首 token MAPPING_*，调用方原样起行（不加 READ_FAIL: 前缀），stderr 恰 1 行、rc=3。
派生口径（observed − excluded，由程序算出，不在代码里硬编码列表）：按 closed_set（schema properties.来源渠道.enum）
顺序逐项经 rules 归一（别名如 企业微信 并入 企微，不单列），fallback 目标殿后，去重；派生结果 ⊆ 来源渠道.enum。
校验顺序：rules → fallback → source 重复 → 声明（mode）→ target_enum（按 mode）。

闭集同源（U2.2 r7）：两侧的 closed_set 一律是 schema properties.来源渠道.enum；channel_family_patterns
只用于识别 来源事件标识 的族，不再当目标值白名单，其键必须是 enum 的子集（family_subset_check）。
契约一致性（U2.2 r8）：schema_enum / schema_patterns 统一取值与形状校验（畸形 schema 单行拒，不 traceback）；
随包各份 schema 副本的 来源渠道.enum 必须相同（read_schema_copy + enum_drift_check → CONTRACT_DRIFT：enum 是两侧单一闭集，不按版本分叉）。
闭集先定齐：两侧都先核各副本 enum 的形状与不漂移，再核族规则（漂移没定之前，族规则的缺键 / 编译只是它的后果，先报漂移；两侧同一契约目录才报同一个原因）。
族规则 fail-closed（U2.2 r9）：来源渠道.enum 的每个成员都必须在 channel_family_patterns 里有键——没有族规则 ≠ 该渠道无需校验
  （r7 把缺键当「无需校验」：Discord 行写 not-a-discord-id 也判过，rc=0 / ok=true）；任一条规则编译不了同样拒。入口唯一：family_rules_check
  （判定侧对所选版本那份 + 生成侧那份各调一次，生成侧对自己那份调一次）。两类都是 LoadFailError：消息自带首 token
  LOAD_FAIL: CHANNEL_PATTERN_MISSING: <渠道> / LOAD_FAIL: CHANNEL_PATTERN_INVALID: <渠道>，调用方原样起行（stderr 恰 1 行、rc=3）。
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Sequence


class EnumError(Exception):
    """渠道映射/契约四类字段越界/缺失/类型错。调用方必须据此 rc=3，不得落到 ok=true。"""


class DeclError(EnumError):
    """渠道映射声明错误（U2.2 r8）：消息自带首 token MAPPING_*，调用方原样起行（stderr 恰 1 行、rc=3）。"""


class LoadFailError(EnumError):
    """契约族规则加载失败（U2.2 r9）：消息自带首 token LOAD_FAIL: CHANNEL_PATTERN_*，调用方原样起行（stderr 恰 1 行、rc=3）。"""


MODES = ("explicit", "derived")       # target_enum_mode 的全部合法取值


_MISSING = object()


def _fail(msg: str) -> None:
    raise EnumError(msg)  # 唯一抛出点（变异测试靶心：本行改成 return 即关掉全部校验）


def _decl_fail(msg: str) -> None:
    raise DeclError(msg)  # 声明类错误唯一抛出点：消息首 token = MAPPING_*


def _load_fail(msg: str) -> None:
    # 压成一行再抛：re.error 文案 / 渠道名里的换行不得把「stderr 恰 1 行」撑破
    raise LoadFailError(" ".join(msg.split()))


def _in_set(v: Any, path: str, closed: Sequence[str]) -> str:
    """非空字符串且在闭集内，否则 EnumError；消息带字段路径与非法值。"""
    if not isinstance(v, str) or not v.strip():
        _fail(f"{path} 不是非空字符串（{v!r}），拒绝")
    if v not in closed:
        _fail(f"{path}={v!r} 不在契约渠道枚举里（{'/'.join(closed)}）：把表外值并进白名单等于关掉 channel_bad，拒绝")
    return v  # type: ignore[return-value]


def family_subset_check(closed: Sequence[str], patterns: Any, name: str) -> list[str]:
    """U2.2 r7 契约一致性：channel_family_patterns 的键必须是 来源渠道.enum（closed）的子集。

    表外键 → EnumError（单行 CONTRACT_INCONSISTENT，点名文件 name 与差集）；按 enum 顺序返回「enum 里有、patterns 里没有」
    的成员——r7 把它写进报告不打红，r9 起非空即致命（见 family_rules_check）。只看键：不读文件、不编译、不看数据行。
    """
    keys = list(patterns) if isinstance(patterns, dict) else []
    extra = [k for k in keys if k not in closed]
    if extra:
        _fail(f"CONTRACT_INCONSISTENT {name}：channel_family_patterns 多出 来源渠道.enum 之外的键 {extra}"
              f"（enum={'/'.join(closed)}），拒绝判定")
    return [c for c in closed if c not in keys]


def family_rules_check(closed: Sequence[str], patterns: Any, name: str) -> dict:
    """一份 schema 的族规则入口（U2.2 r9，两侧共用；判定侧所选那份 + 生成侧那份、生成侧自己那份都经此）：
    patterns 键 ⊆ enum（r7，表外键即拒）→ enum ⊆ patterns 键（r9，缺即拒）→ 逐条编译（r9，编不了即拒）。
    缺键 / 编译失败 → LoadFailError（单行 LOAD_FAIL: CHANNEL_PATTERN_MISSING: <渠道> / CHANNEL_PATTERN_INVALID: <渠道>，
    点名文件 name；缺多个按 enum 顺序用「、」连接）。返回 {渠道: 编译好的正则}，调用方拿去判行，不再自己编译。
    """
    missing = family_subset_check(closed, patterns, name)
    if missing:
        _load_fail(f"LOAD_FAIL: CHANNEL_PATTERN_MISSING: {'、'.join(missing)}：{name} 的 channel_family_patterns 缺 来源渠道.enum 成员"
                   f" {missing} 的族规则（没有规则不等于无需校验），拒绝")
    compiled = {}
    for cname, pat in patterns.items():
        try:
            compiled[cname] = re.compile(pat)
        except re.error as exc:
            _load_fail(f"LOAD_FAIL: CHANNEL_PATTERN_INVALID: {cname}：{name} 的 channel_family_patterns.{cname} 编译失败（{exc}），拒绝")
    return compiled


def _props(doc: Any, name: str) -> dict:
    if not isinstance(doc, dict):
        _fail(f"CONTRACT_MALFORMED {name}：schema 顶层不是对象（是 {type(doc).__name__}），拒绝")
    props = doc.get("properties")
    if not isinstance(props, dict):
        _fail(f"CONTRACT_MALFORMED {name}：properties 不是对象（是 {type(props).__name__}），拒绝")
    return props


def schema_enum(doc: Any, name: str) -> list[str]:
    """schema properties.来源渠道.enum = 两侧唯一闭集：非空、无重复、非空白字符串列表；形状不对即 EnumError（点名字段路径）。"""
    col = _props(doc, name).get("来源渠道")
    if not isinstance(col, dict):
        _fail(f"CONTRACT_MALFORMED {name}：properties.来源渠道 不是对象（是 {type(col).__name__}），拒绝")
    enum = col.get("enum")
    if (not isinstance(enum, list) or not enum
            or not all(isinstance(x, str) and x.strip() for x in enum) or len(set(enum)) != len(enum)):
        _fail(f"CONTRACT_MALFORMED {name}：properties.来源渠道.enum 不是非空、无重复的字符串列表，闭集无从判定，拒绝")
    return list(enum)


def schema_patterns(doc: Any, name: str) -> dict:
    """schema properties.来源事件标识.channel_family_patterns：非空对象、值为非空字符串；形状不对即 EnumError（点名字段路径）。"""
    col = _props(doc, name).get("来源事件标识")
    if not isinstance(col, dict):
        _fail(f"CONTRACT_MALFORMED {name}：properties.来源事件标识 不是对象（是 {type(col).__name__}），拒绝")
    pats = col.get("channel_family_patterns")
    if not isinstance(pats, dict) or not pats:
        _fail(f"CONTRACT_MALFORMED {name}：缺 properties.来源事件标识.channel_family_patterns（须为非空对象），拒绝")
    bad = [k for k, v in pats.items() if not isinstance(v, str) or not v.strip()]
    if bad:
        _fail(f"CONTRACT_MALFORMED {name}：channel_family_patterns 里 {bad} 的规则为空或非字符串，拒绝")
    return dict(pats)


def read_schema_copy(contract_dir: str, name: str):
    """读一份随包 schema 副本（U2.2 r7 生成侧那份 + r8 各版本副本）：缺席不算错（契约目录可以只带一份）→ None；
    读不出 / 不是 JSON → EnumError（单行 CONTRACT_DRIFT，点名文件与路径）。返回副本原文，形状交给 schema_enum / schema_patterns。
    """
    path = os.path.join(contract_dir, name)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        _fail(f"CONTRACT_DRIFT {name} 读不出来（{path}: {exc}），拒绝")


def enum_drift_check(enum: Sequence[str], name: str, reference_enum: Sequence[str], reference_name: str) -> None:
    """一份副本的 来源渠道.enum 必须与参考份逐项相同（含顺序；U2.2 r8）：不一致 = CONTRACT_DRIFT——enum 是两侧单一闭集，
    单一生成器不可能按版本写不同的渠道值，不按版本分叉。单行点名两份文件与两侧差集（enum_diff 口径）。
    """
    only_ref = [x for x in reference_enum if x not in enum]
    only_this = [x for x in enum if x not in reference_enum]
    reorder = not only_ref and not only_this and list(enum) != list(reference_enum)
    if only_ref or only_this or reorder:
        _fail(f"CONTRACT_DRIFT 来源渠道.enum 不一致 {reference_name} vs {name}：仅 {reference_name} 有 {only_ref} / "
              f"仅 {name} 有 {only_this}{' / 顺序不同' if reorder else ''}（enum 是两侧单一闭集，不按版本分叉），拒绝")


def _result(doc: dict, rules: list, rule_targets: dict, sources: list, fb_src: str, fb_tgt: str,
            derived: list, mode: str) -> dict:
    v = doc.get("version")
    return {"version": v if isinstance(v, str) and v.strip() else None, "rules": rules,
            "rule_targets": rule_targets, "sources": sources, "whitelist": sources + [fb_src],
            "fallback_source": fb_src, "fallback_target": fb_tgt,
            "target_enum": derived,            # explicit：已逐项核对过的手写值（== 派生）；derived：运行时派生
            "target_enum_mode": mode}


def load_channel_map(path: str, closed_set: Sequence[str]) -> dict:
    """读 channel-map.json，校验 + 规范化后返回：
    version / rules(原样) / rule_targets{source:target} / sources(rules 顺序，不含 fallback)
    / whitelist(sources + fallback.source，判定侧白名单) / fallback_source / fallback_target
    / target_enum(派生结果；explicit 模式下与手写值逐项相等) / target_enum_mode(explicit|derived)"""
    closed = list(closed_set)
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError) as exc:
        _fail(f"渠道映射读不出来 {path}: {exc}")
    if not isinstance(doc, dict):
        _fail(f"渠道映射顶层不是对象（是 {type(doc).__name__}），拒绝")
    rules = doc.get("rules", _MISSING)
    if rules is _MISSING or not isinstance(rules, list) or not rules:
        _fail("渠道映射没有 rules 列表（或为空），白名单无从判定，拒绝")
    rule_targets: dict = {}
    sources: list = []
    for i, rule in enumerate(rules):
        if not isinstance(rule, dict):
            _fail(f"rules[{i}] 不是对象（是 {type(rule).__name__}），拒绝")
        if rule.get("source", _MISSING) is _MISSING:
            _fail(f"rules[{i}] 缺 source：字段缺省不等于合法兜底，拒绝")
        src = _in_set(rule["source"], f"rules[{i}].source", closed)
        if rule.get("target", _MISSING) is _MISSING:
            _fail(f"rules[{i}] 缺 target，拒绝")
        rule_targets[src] = _in_set(rule["target"], f"rules[{i}].target", closed)
        sources.append(src)
    fb = doc.get("fallback", _MISSING)
    if fb is _MISSING:
        _fail("渠道映射缺 fallback：兜底口径不明，拒绝")
    if not isinstance(fb, dict):
        _fail(f"fallback 不是对象（是 {type(fb).__name__}），拒绝")
    if fb.get("source", _MISSING) is _MISSING:
        _fail("fallback 缺 source：字段缺省与显式 null 都不是合法兜底，拒绝")
    fb_src = _in_set(fb["source"], "fallback.source", closed)
    if fb.get("target", _MISSING) is _MISSING:
        _fail("fallback 缺 target，拒绝")
    fb_tgt = _in_set(fb["target"], "fallback.target", closed)
    whitelist = sources + [fb_src]
    dup = sorted({s for s in whitelist if whitelist.count(s) > 1})
    if dup:
        _fail(f"rules/fallback 里 source 重复 {dup}：同一渠道两种去向，拒绝")
    derived: list = []                      # 规范化：按闭集顺序派生，企业微信 经 rules 并入 企微（observed − excluded）
    for s in closed:
        t = rule_targets.get(s, fb_tgt)
        if t not in derived:
            derived.append(t)
    # ---- U2.2 r8：target_enum 单一真源 —— 先看声明，再按声明处理手写值；显式 null 不是缺键 ----
    mode = doc.get("target_enum_mode", _MISSING)
    if mode is _MISSING:
        _decl_fail(f"MAPPING_DECL_MISSING: {path} 缺顶层键 target_enum_mode：必须显式声明 'explicit'（手写 target_enum 且与派生结果"
                   f"逐项相等）或 'derived'（不手写，由 schema 来源渠道.enum 派生 {derived}）；缺声明即派生等于静默，拒绝")
    if mode not in MODES:
        _decl_fail(f"MAPPING_DECL_INVALID: {path} target_enum_mode={mode!r} 非法：只许 {' / '.join(repr(m) for m in MODES)}，拒绝")
    declared = doc.get("target_enum", _MISSING)
    if mode == "derived":
        if declared is not _MISSING:
            _decl_fail(f"MAPPING_TARGET_ENUM_FORBIDDEN: {path} mode=derived 却手写了 target_enum（两份真源）：删除该键，"
                       f"由 schema 来源渠道.enum 派生（派生结果 {derived}），拒绝")
        return _result(doc, rules, rule_targets, sources, fb_src, fb_tgt, derived, mode)
    # mode == explicit：必须手写，且与派生结果逐项相等（顺序、元素数）
    if declared is _MISSING:
        _decl_fail(f"MAPPING_DECL_INVALID: {path} mode=explicit 必须手写 target_enum，但该键缺失（派生结果 {derived}），拒绝")
    if not isinstance(declared, list) or not declared:
        _decl_fail(f"MAPPING_DECL_INVALID: {path} target_enum 不是非空列表（是 {type(declared).__name__}），拒绝")
    lost = [t for t in derived if t not in declared]         # 缺：派生有、手写没有
    more = [t for t in declared if t not in derived]         # 多：手写有、派生没有（含表外值）
    repeated: list = []                                     # 重复：同一值出现多次（不去重地按首次出现顺序列出）
    for t in declared:
        if declared.count(t) > 1 and t not in repeated:
            repeated.append(t)
    order_diff = not lost and not more and not repeated and declared != derived
    if lost or more or repeated or order_diff:
        _decl_fail(f"MAPPING_TARGET_ENUM_MISMATCH: {path} target_enum 与派生结果不一致（派生口径：schema 来源渠道.enum 顺序，"
                   f"经 rules/fallback 归一）—— 缺 {lost} / 多 {more} / 重复 {repeated}"
                   f"{' / 顺序不同' if order_diff else ''}；手写 {declared} / 派生 {derived}，拒绝")
    return _result(doc, rules, rule_targets, sources, fb_src, fb_tgt, derived, mode)
