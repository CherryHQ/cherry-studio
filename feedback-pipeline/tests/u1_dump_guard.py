#!/usr/bin/env python3
"""`_dump` 对「无法格式化的超大整数」必须兜底，而不是让整行构建失败。

背景（第 10 轮 P1-e）：reviewer 在 Python 3.14.9 上跑样例 64 失败 ——
`json.dumps(10**5000)` 触发 CPython 3.11+ 的 int→str 4300 位上限（ValueError）。
本机是 3.9.6，默认没有这个限制，所以样例表跑不出该路径；这里用故障注入把
`json.dumps` 换成「遇到超宽整数就抛 ValueError」的版本，等价复现 3.11+ 行为。
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import uf003_identity as U  # noqa: E402

HUGE = 10 ** 5000
DIGIT_LIMIT_BITS = 14000          # 4300 位十进制 ≈ 14285 bit，取略小值确保一定会触发


REAL_DUMPS = json.dumps


def fake_dumps(obj, *a, **kw):
    """等价于 CPython 3.11+ 的默认行为：整数位数超限就抛 ValueError。"""
    def walk(o):
        if isinstance(o, bool):
            return
        if isinstance(o, int):
            if o.bit_length() > DIGIT_LIMIT_BITS:
                raise ValueError("Exceeds the limit (4300 digits) for integer string conversion")
        elif isinstance(o, (list, tuple)):
            for x in o:
                walk(x)
        elif isinstance(o, dict):
            for k, v in o.items():
                walk(k)
                walk(v)

    walk(obj)
    return REAL_DUMPS(obj, *a, **kw)      # 必须调用保存的原函数，否则替换后自递归


def main() -> int:
    problems: list[str] = []
    real = json.dumps
    json.dumps = fake_dumps  # type: ignore[assignment]
    try:
        # 对照：普通整数不能因故障注入而崩（原实现会自递归）
        try:
            if fake_dumps(123) != "123":
                problems.append(f"fake_dumps(123)={fake_dumps(123)!r}，注入器自身有问题")
            if U._dump(123) != "123":
                problems.append(f"_dump(123)={U._dump(123)!r}，正常整数被影响")
        except Exception as exc:  # noqa: BLE001
            problems.append(f"正常整数对照抛 {type(exc).__name__}: {exc}")
        try:
            got = U._dump(HUGE)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"_dump(10**5000) 抛了 {type(exc).__name__}: {exc}")
            got = ""
        if "无法回显" not in got:
            problems.append(f"_dump 没有兜底说明：{got[:80]!r}")
        try:
            row = U.build_identity("mail", {"from_address": HUGE,
                                            "message_id": "abc@example.com"})
            if row["来源事件标识"] != "mail:abc@example.com":
                problems.append(f"mail id={row['来源事件标识']!r}，有效 Message-ID 没被采用")
            if "无法回显" not in row["说明"]:
                problems.append("说明里没有标明 from= 无法回显")
        except Exception as exc:  # noqa: BLE001
            problems.append(f"build_identity(mail, from=10**5000) 抛了 {type(exc).__name__}: {exc}")
    finally:
        json.dumps = real  # type: ignore[assignment]
    for p in problems:
        print(f"        ! {p}")
    print(f"{'PASS' if not problems else 'FAIL'}: _dump 超大整数兜底")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
