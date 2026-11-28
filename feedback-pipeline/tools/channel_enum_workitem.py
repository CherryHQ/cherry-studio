#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作项表 来源渠道 白名单加载器（写入守卫的唯一值域来源）。

规则（2026-11-27 业主裁定）：
  - 写入守卫**不许硬编码** 8 个渠道值，也不许把「明细表 4 渠道 ∩ 7 项」当默认值。
    硬编码/取交集会让守卫在未知值上静默放行或误拒，两种都是事故。
  - 值域唯一来源 = contract/channel-enum-workitem.json，由**能读工作项表的人**导出，
    导出时记 sha256 与导出命令（文件内 source 段）。
  - 文件不存在 → rc=3 ENUM_SOURCE_MISSING（不降级、不 fallback 到 4 渠道）。
  - 文件形状不对/无 channels/有非字符串或空白项 → rc=3 ENUM_SOURCE_MALFORMED。

退出码只用 0 / 3（本 profile 不出现 1）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PATH = os.path.join(ROOT, "contract", "channel-enum-workitem.json")


class EnumSourceError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


def load(path=None):
    """返回 (channels:list[str], meta:dict)。失败抛 EnumSourceError，调用方按 code 起行、rc=3。"""
    path = path or DEFAULT_PATH
    if not os.path.isfile(path):
        raise EnumSourceError(
            "ENUM_SOURCE_MISSING",
            f"ENUM_SOURCE_MISSING: {path} 不存在——工作项表来源渠道值域未经导出，"
            f"守卫拒绝降级到明细表 4 渠道（不猜）",
        )
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        raise EnumSourceError("ENUM_SOURCE_MALFORMED", f"ENUM_SOURCE_MALFORMED: 读/解析失败 {exc}")
    ch = doc.get("channels")
    if not isinstance(ch, list) or not ch:
        raise EnumSourceError(
            "ENUM_SOURCE_MALFORMED", "ENUM_SOURCE_MALFORMED: channels 必须是非空列表"
        )
    bad = [x for x in ch if not isinstance(x, str) or not x.strip()]
    if bad:
        raise EnumSourceError(
            "ENUM_SOURCE_MALFORMED", f"ENUM_SOURCE_MALFORMED: channels 含非字符串/空白项 {bad[:3]}"
        )
    if len(set(ch)) != len(ch):
        raise EnumSourceError("ENUM_SOURCE_MALFORMED", "ENUM_SOURCE_MALFORMED: channels 有重复项")
    src = doc.get("source") or {}
    if not src.get("sha256") or not src.get("command"):
        raise EnumSourceError(
            "ENUM_SOURCE_MALFORMED",
            "ENUM_SOURCE_MALFORMED: source.sha256 / source.command 缺失——导出未留可核验痕迹",
        )
    return ch, src


def main(argv):
    path = argv[1] if len(argv) > 1 else None
    try:
        ch, src = load(path)
    except EnumSourceError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    print(f"ENUM_SOURCE_OK channels={len(ch)} sha256={src.get('sha256')[:16]} "
          f"exported_at={src.get('exported_at', '?')}")
    print("  " + " / ".join(ch))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
