#!/usr/bin/env python3
"""自检防线：构建器吐出「看起来能过」的坏行时，自检必须给出非 0 rc。

背景：
- 第 8 轮 P2-h：自检曾硬编码 allow_qq_candidate=True，一条不合契约的 QQ id 也会被记成
  family_ok、rc=0。
- 第 10 轮 P2-h：只修了 QQ 开关这一条路径，其他坏行仍能假通过 ——
  ① 渠道与输入不符（QQ 窗口返回 Telegram 族 id）；② 占位符本身不合族
  （`unknown:user-feedback-malformed` 在验族前被跳过）。
- 第 10 轮还指出本测试只断言 `rc != 0`，把 rc=3（构建异常）也当通过；现在要求精确 rc。

用故障注入（替换 U.build_identity）覆盖以上三条路径，每个场景断言精确 rc。
"""
from __future__ import annotations

import json
import re
import os
import sys
import shutil
import subprocess
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import uf003_identity as U  # noqa: E402

BAD_ID = "qq:G1:ROBOT1.0_regression"          # 疑似 QQ 族但不符合 v1.9 契约正则
WRONG_CHANNEL_ID = "tg:123:456"                # 渠道不符：QQ 窗口却回 Telegram 族 id
BAD_PLACEHOLDER = "unknown:user-feedback-malformed"   # 占位符本身不合族


def make_run(tmp: str, elems=None) -> str:
    os.makedirs(os.path.join(tmp, "raw"), exist_ok=True)
    rows = elems if elems is not None else [{"content": "hi", "group_openid": "G1", "id": "ROBOT1.0_regression"}]
    with open(os.path.join(tmp, "raw", "qq-window.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)
    return tmp


def row(channel: str, evid: str) -> dict:
    return {"来源渠道": channel, "来源事件标识": evid, "证据": U.NO_URL,
            "身份档": "unverified", "说明": "故障注入"}


def run_with(builder, flag: bool, elems=None, per_source: int = 1,
             stat_denied: str | None = None, dup_qq: bool = False,
             open_denied: str | None = None, dangling: str | None = None,
             dangling_dir: str | None = None, drop_dir: str | None = None) -> tuple[dict, int, str]:
    real = U.build_identity
    try:
        U.build_identity = builder  # type: ignore[assignment]
        with tempfile.TemporaryDirectory() as tmp:
            make_run(tmp, elems)
            if dup_qq:
                # 备用同名窗口：优先名无权限、备用名可读（真实 run 目录里两种命名都出现过）
                import shutil
                shutil.copyfile(os.path.join(tmp, "raw", "qq-window.json"),
                                os.path.join(tmp, "qq-window.json"))
            if dangling:
                tgt = os.path.join(tmp, dangling)
                if os.path.exists(tgt):
                    os.remove(tgt)
                os.symlink(os.path.join(tmp, "no-such-target.json"), tgt)
            if drop_dir:
                d = os.path.join(tmp, drop_dir)
                if os.path.isdir(d):
                    shutil.rmtree(d)
            if dangling_dir:
                # 中间目录整体换成悬空软链：lstat(raw/x.json) 只会报 ENOENT，必须靠逐段探测发现
                d = os.path.join(tmp, dangling_dir)
                if os.path.isdir(d):
                    shutil.rmtree(d)
                elif os.path.exists(d):
                    os.remove(d)
                os.symlink(os.path.join(tmp, "no-such-dir"), d)
            real_stat, real_lstat = os.stat, os.lstat
            real_open = U._open
            if open_denied:
                def deny_open(p, *a, **kw):
                    if open_denied in str(p):
                        raise PermissionError(13, "Permission denied", str(p))
                    return real_open(p, *a, **kw)
                U._open = deny_open
            if stat_denied:
                def deny_lstat(p, *a, **kw):
                    if stat_denied in str(p):
                        raise PermissionError(13, "Permission denied", str(p))
                    return real_lstat(p, *a, **kw)

                def deny_stat(p, *a, **kw):
                    if stat_denied in str(p):
                        raise PermissionError(13, "Permission denied", str(p))
                    return real_stat(p, *a, **kw)
                # 探针用 os.lstat 判软链、os.stat 跟目标：两者都要注入才等价于「目录项不可访问」。
                # 注意 os.stat 的兜底必须是 real_stat 而不是 real_lstat，否则 /var 这类系统软链
                # 会被当成「不是目录」，把根目录逐段探测整体带偏。
                os.lstat = deny_lstat
                os.stat = deny_stat
            try:
                rep = U.selfcheck(tmp, per_source=per_source, allow_qq_candidate=flag)
            finally:
                os.stat, os.lstat = real_stat, real_lstat
                U._open = real_open
    finally:
        U.build_identity = real  # type: ignore[assignment]
    rc, reason = U._selfcheck_rc(rep)
    qq = next(c for c in rep["checks"] if c["source"] == "qq")
    return qq, rc, reason


def main() -> int:
    problems: list[str] = []

    # 1) 不合契约的 QQ id：候选开关关闭时必须 rc=2（不是 3、不是 0）
    for flag, want_rc in ((False, 2), (True, 0)):
        qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", BAD_ID), flag)
        tag = f"不合族 QQ id / allow_qq_candidate={flag}"
        if qq.get("contract_family_bad") != 1:
            problems.append(f"{tag}: contract_family_bad={qq.get('contract_family_bad')}，未识别契约违规")
        if flag:
            if qq.get("family_ok") != 1 or qq.get("qq_family_ok_under_proposed_pattern") != 1:
                problems.append(f"{tag}: family_ok={qq.get('family_ok')}，候选认可路径没生效")
        else:
            if qq.get("family_ok") != 0:
                problems.append(f"{tag}: family_ok={qq.get('family_ok')}，不合契约的 id 被记成通过")
            if qq.get("family_bad") != 1:
                problems.append(f"{tag}: family_bad={qq.get('family_bad')}，违规没进失败计数")
        if rc != want_rc:
            problems.append(f"{tag}: rc={rc}（要 {want_rc}；{reason}）")
        print(f"[{'OK  ' if not problems else 'FAIL'}] {tag}: family_ok={qq.get('family_ok')} "
              f"family_bad={qq.get('family_bad')} contract_bad={qq.get('contract_family_bad')} rc={rc}")

    # 2) 渠道不符：QQ 窗口回 Telegram 族 id —— 必须精确 rc=3（构建异常、统计不完整）
    qq, rc, reason = run_with(lambda s, r, **kw: row("Telegram", WRONG_CHANNEL_ID), False)
    if rc != 3:
        problems.append(f"渠道不符: rc={rc}（要 3；{reason}）")
    if qq.get("family_ok") != 0:
        problems.append(f"渠道不符: family_ok={qq.get('family_ok')}，渠道不符仍计入 ok（或字段缺失）")
    if not any("渠道不符" in e for e in (qq.get("build_errors") or [])):
        problems.append(f"渠道不符: build_errors={qq.get('build_errors')}，没有记录原因")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] 渠道不符: rc={rc} ({reason})")

    # 2b) 行结构非法（缺 来源事件标识）：不能抛 KeyError，必须 rc=3 并留错误
    def missing_key(src, rec, **kw):
        return {"来源渠道": "QQ", "证据": U.NO_URL, "身份档": "unverified", "说明": "缺字段注入"}

    qq, rc, reason = run_with(missing_key, False)
    if rc != 3:
        problems.append(f"缺字段行: rc={rc}（要 3；{reason}）")
    if not qq.get("build_errors"):
        problems.append("缺字段行: build_errors 为空，KeyError 没有被兜住")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] 缺字段行: rc={rc} ({reason})")

    # 2c) 二次构建不得绕过校验：构建器第一次合格、第二次给坏行，样本必须复用已校验行
    calls = {"n": 0}

    def flip_flop(src, rec, **kw):
        calls["n"] += 1
        return row("QQ", "qq:G1:ROBOT1.0_good") if calls["n"] == 1 else row("Telegram", WRONG_CHANNEL_ID)

    qq, rc, reason = run_with(flip_flop, True)
    if calls["n"] != 1:
        problems.append(f"二次构建: 构建器被调 {calls['n']} 次（应为 1，样本应复用已校验行）")
    if rc != 0:
        problems.append(f"二次构建: rc={rc}（合格首行应 rc=0；{reason}）")
    if (qq.get("sample") or {}).get("来源渠道") != "QQ":
        problems.append(f"二次构建: sample 渠道={((qq.get('sample') or {}).get('来源渠道'))}，不是已校验的首行")
    print(f"[{'OK  ' if rc == 0 and calls['n'] == 1 else 'FAIL'}] 二次构建: calls={calls['n']} rc={rc}")

    # 2d) 窗口读取失败（3.11+ 的 4300 位限制会在 json.load 抛 ValueError）：必须 rc=3、留 read_error
    real_load = json.load

    def bad_load(fp, *a, **kw):
        # 只让窗口文件失败；契约文件照常读（否则连自检都起不来）
        if "window" in str(getattr(fp, "name", fp)):
            raise ValueError("Exceeds the limit (4300 digits) for integer string conversion")
        return real_load(fp, *a, **kw)

    json.load = bad_load  # type: ignore[assignment]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            make_run(tmp)
            rep = U.selfcheck(tmp, per_source=1, allow_qq_candidate=False)
        rc, reason = U._selfcheck_rc(rep)
    finally:
        json.load = real_load  # type: ignore[assignment]
    qq = next((c for c in rep["checks"] if c["source"] == "qq"), {})
    if rc != 3:
        problems.append(f"读取失败: rc={rc}（要 3；{reason}）")
    if not qq.get("read_error"):
        problems.append("读取失败: 没有 read_error，CLI 会把崩溃掩盖成空报告")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] 读取失败: rc={rc}")

    # 2e) 非对象元素（`[null]`）：不能抛 AttributeError，必须 rc=3
    qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", "qq:G1:ROBOT1.0_good"), False,
                              elems=[{"content": "hi"}, None])
    if rc != 3:
        problems.append(f"非对象元素: rc={rc}（要 3；{reason}）")
    if not any("非对象元素" in e for e in (qq.get("build_errors") or [])):
        problems.append(f"非对象元素: build_errors={qq.get('build_errors')}，没记录结构问题")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] 非对象元素: rc={rc}")

    # 2f) 结构非法（int id / 缺证据 / 身份档越界）：都必须 rc=3，不得靠 re.fullmatch 抛 TypeError
    cases = [
        ("int id", {"来源渠道": "QQ", "来源事件标识": 123, "证据": U.NO_URL, "身份档": "unverified"}),
        ("缺证据", {"来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good", "身份档": "unverified"}),
        ("身份档越界", {"来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good", "证据": U.NO_URL,
                        "身份档": "invalid"}),
    ]
    for tag, bad in cases:
        qq, rc, reason = run_with(lambda s, r, _b=bad, **kw: dict(_b), False)
        if rc != 3:
            problems.append(f"{tag}: rc={rc}（要 3；{reason}）")
        if not qq.get("build_errors"):
            problems.append(f"{tag}: build_errors 为空，结构问题被当成合格行")
        print(f"[{'OK  ' if rc == 3 else 'FAIL'}] {tag}: rc={rc}")

    # 2g) 共享字典被构建器改写：样本必须是冻结副本，不能被后续行带歪
    shared = row("QQ", "qq:G1:ROBOT1.0_good")
    state = {"n": 0}

    def mutate_shared(src, rec, **kw):
        state["n"] += 1
        if state["n"] > 1:
            shared["来源渠道"] = "Telegram"
        return shared

    qq, rc, reason = run_with(mutate_shared, False,
                              elems=[{"content": "a"}, {"content": "b"}], per_source=2)
    if (qq.get("sample") or {}).get("来源渠道") != "QQ":
        problems.append(f"共享字典: sample 渠道={((qq.get('sample') or {}).get('来源渠道'))}，样本未被冻结")
    if rc != 3:
        problems.append(f"共享字典: rc={rc}（要 3；{reason}），第二行渠道已变却不报结构错")
    print(f"[{'OK  ' if (qq.get('sample') or {}).get('来源渠道') == 'QQ' and rc == 3 else 'FAIL'}] "
          f"共享字典: sample={((qq.get('sample') or {}).get('来源渠道'))} rc={rc}")

    # 2h) stat 权限异常：QQ 窗口访问不了、企微正常 → 必须 rc=3（不能算 skipped 后 rc=0）
    qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", "qq:G1:ROBOT1.0_good"), False,
                              stat_denied="qq")
    if rc != 3:
        problems.append(f"stat 权限: rc={rc}（要 3；{reason}），无权访问被当成缺失")
    if not any("无法读取" in str(c.get("read_error")) for c in [qq]):
        problems.append(f"stat 权限: read_error={qq.get('read_error')!r}，没记录访问失败")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] stat 权限: rc={rc}")

    # 2i) 孤立代理项：报告必须能按 UTF-8 写出（不能 UnicodeEncodeError 吞掉整份报告）
    # 走真实 build_identity 太绕，直接注入含代理项的行；候选族校验开/关不影响本项目的（可编码性）
    qq, rc, reason = run_with(
        lambda s, r, **kw: {"来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good",
                            "证据": U.NO_URL, "身份档": "unverified", "说明": "x\ud800y"}, True)
    try:
        json.dumps(qq, ensure_ascii=False).encode("utf-8")
        enc_err = None
    except UnicodeEncodeError as exc:
        enc_err = exc
    if enc_err:
        problems.append(f"孤立代理项: 报告仍无法 UTF-8 编码（{enc_err}）")
    if rc != 0:
        problems.append(f"孤立代理项: rc={rc}（要 0；{reason}），可编码的坏字符不该判坏行")
    note = ((qq.get("sample") or {}).get("说明") or "")
    print(f"[{'OK  ' if not enc_err and rc == 0 else 'FAIL'}] 孤立代理项: rc={rc} note={note[:24]!r}")

    # 2j) 结构校验剩下的洞：光有 scheme 的 URL / 说明=null / verified 配 无公开链接
    cases2 = [
        ("证据=http://", {"来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good",
                          "证据": "http://", "身份档": "unverified"}),
        ("说明=null", {"来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good",
                       "证据": U.NO_URL, "身份档": "unverified", "说明": None}),
        ("verified+无公开链接", {"来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good",
                                 "证据": U.NO_URL, "身份档": "verified"}),
    ]
    for tag, bad in cases2:
        qq, rc, reason = run_with(lambda s, r, _b=bad, **kw: dict(_b), False)
        if rc != 3:
            problems.append(f"{tag}: rc={rc}（要 3；{reason}）")
        print(f"[{'OK  ' if rc == 3 else 'FAIL'}] {tag}: rc={rc}")

    # 2l) 优先窗口无权限、备用窗口可读：不能被备用文件掩盖成 rc=0
    qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", "qq:G1:ROBOT1.0_good"), True,
                              stat_denied="raw/qq-window", dup_qq=True)
    if rc != 3:
        problems.append(f"备用窗口掩盖: rc={rc}（要 3；{reason}），无权限的优先窗口被跳过")
    if not any("无法读取" in str(c.get("read_error")) for c in [qq]):
        problems.append(f"备用窗口掩盖: read_error={qq.get('read_error')!r}")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] 备用窗口掩盖: rc={rc}")

    # 2l2) stat 成功但 open 报权限；悬空软链 —— 都不能用备用文件顶上
    qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", "qq:G1:ROBOT1.0_good"), True,
                              open_denied="raw/qq-window", dup_qq=True)
    if rc != 3:
        problems.append(f"open 权限: rc={rc}（要 3；{reason}）")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] open 权限: rc={rc}")

    qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", "qq:G1:ROBOT1.0_good"), True,
                              dangling="raw/qq-window.json", dup_qq=True)
    if rc != 3:
        problems.append(f"悬空软链: rc={rc}（要 3；{reason}）")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] 悬空软链: rc={rc}")

    # 2l4) 中间目录（run/raw）本身是悬空软链：lstat 只报 ENOENT，不能被备用窗口顶掉
    qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", "qq:G1:ROBOT1.0_good"), True,
                              dup_qq=True, dangling_dir="raw")
    if rc != 3:
        problems.append(f"中间目录悬空软链: rc={rc}（要 3；{reason}）")
    print(f"[{'OK  ' if rc == 3 else 'FAIL'}] 中间目录悬空软链: rc={rc}")

    # 2l6) raw 整个不存在、根目录备用窗口可读：这是「确实不存在」，必须放行（rc=0）
    qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", "qq:G1:ROBOT1.0_good"), True,
                              dup_qq=True, drop_dir="raw")
    if rc != 0:
        problems.append(f"缺失目录误判: rc={rc}（要 0；{reason}）")
    print(f"[{'OK  ' if rc == 0 else 'FAIL'}] 缺失目录误判: rc={rc}")

    # 2l5) 长 run_dir + 首选不可读 + 备用可读：错误长度有界，且尾部提示完整
    with tempfile.TemporaryDirectory() as tmp:
        deep = os.path.join(tmp, "r" * 90, "s" * 90, "t" * 40, "u" * 60, "raw")
        os.makedirs(deep)
        cand = os.path.join(deep, "qq-window.json")
        open(cand, "w").write("[]")
        alt = os.path.join(tmp, "r" * 90, "s" * 90, "t" * 40, "u" * 60, "qq-window.json")
        shutil.copyfile(cand, alt)
        real = U._open
        def _deny(path, *a, **kw):
            if str(path) == cand:
                raise PermissionError(13, "denied", str(path))
            return real(path, *a, **kw)
        U._open = _deny
        try:
            _p, err = U._probe_window(os.path.join(tmp, "r" * 90, "s" * 90, "t" * 40, "u" * 60),
                                      ["raw/qq-window.json", "qq-window.json"])
        finally:
            U._open = real
    if _p is not None:
        problems.append(f"提示边界: 期望报错，实际返回 {_p!r}")
    if not err or not err.endswith("不能确认是同一窗口"):
        problems.append(f"提示边界: 尾部提示被截断 err={err!r}")
    if err and len(err) > 900:
        problems.append(f"提示边界: 错误 {len(err)} 字符，超出逐项截断后的上限")
    if err and alt in err:
        problems.append(f"提示边界: 可读候选路径未裁剪（整条 {len(alt)} 字符路径被带出）")
    ok_bound = bool(err) and err.endswith("不能确认是同一窗口") and len(err) <= 900 and alt not in err
    print(f"[{'OK  ' if ok_bound else 'FAIL'}] 提示边界: len={len(err) if err else 0}")

    # 2l7) --run 根目录本身是悬空软链：裸路径 / 尾斜杠 / 子路径都必须报「悬空」，
    #      真缺失仍要放行（rc 由调用方按「不存在」处理）
    root_cases = {}
    with tempfile.TemporaryDirectory() as tmp:
        link = os.path.join(tmp, "run-link")
        os.symlink(os.path.join(tmp, "gone"), link)
        for name, path in (("plain", link), ("trailing", link + os.sep),
                           ("child", os.path.join(link, "raw"))):
            _p, err = U._probe_window(path, ["raw/qq-window.json"])
            root_cases[name] = (_p, err)
        root_cases["missing"] = U._probe_window(os.path.join(tmp, "nope"), ["raw/qq-window.json"])
        root_cases["missing_child"] = U._probe_window(os.path.join(tmp, "nope", "raw"),
                                                     ["raw/qq-window.json"])
    bad = [k for k in ("plain", "trailing", "child")
           if root_cases[k][0] is not None or not root_cases[k][1] or "悬空" not in root_cases[k][1]]
    bad += [k for k in ("missing", "missing_child")
            if root_cases[k][0] is not None or root_cases[k][1]]
    if bad:
        problems.append(f"根目录悬空软链: {bad} → { {k: root_cases[k] for k in bad} }")
    print(f"[{'OK  ' if not bad else 'FAIL'}] 根目录悬空软链: 3 报错 + 2 放行 {list(root_cases)}")

    # 2l8) 四个 120 字符中间组件悬空：每项都要裁剪，整条错误有界
    with tempfile.TemporaryDirectory() as tmp:
        comps = ["x" * 120] * 4
        cur = tmp
        for c in comps[:-1]:
            os.makedirs(os.path.join(cur, c), exist_ok=True)
            cur = os.path.join(cur, c)
        os.symlink(os.path.join(tmp, "gone-dir"), os.path.join(cur, comps[-1]))
        rel = "/".join(comps + ["qq-window.json"])
        _p, err = U._probe_window(tmp, [rel])
    long_bad = []
    if not err:
        long_bad.append("期望报错，实际 None")
    else:
        if len(err) > 900:
            long_bad.append(f"错误 {len(err)} 字符")
        if any(c in err for c in comps):
            long_bad.append("未裁剪组件名")
    if long_bad:
        problems.append("长组件: " + "；".join(long_bad))
    print(f"[{'OK  ' if not long_bad else 'FAIL'}] 长组件: len={len(err) if err else 0}"
          f"{'' if not long_bad else ' → ' + '；'.join(long_bad)}")

    # 2l11b) conformance 历史核验：基线是 {record_id, fields} 嵌套、当前导出是平铺；
    #        以及每个文件各自的列式 mode、裸 CR 拒绝、混合形状拒绝
    conf2 = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "tools", "conformance.py")
    demo2 = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "u1-demo.ndjson")
    hist_bad = []
    hist_n = [0]

    def conf_run(export_payload, baseline_payload):
        hist_n[0] += 1
        with tempfile.TemporaryDirectory() as tmp:
            ep, bp, op = (os.path.join(tmp, x) for x in ("e.ndjson", "b.ndjson", "o.json"))
            open(ep, "w", encoding="utf-8").write(export_payload)
            open(bp, "w", encoding="utf-8").write(baseline_payload)
            proc = subprocess.run([sys.executable, conf2, ep, "--baseline", bp, "--json", op],
                                  capture_output=True, text=True)
            rep = json.load(open(op, encoding="utf-8")) if os.path.exists(op) else {}
        return proc.returncode, (rep.get("rule_counts") or {}), proc.stderr.strip()

    if not (os.path.exists(conf2) and os.path.exists(demo2)):
        hist_bad.append(f"缺 conformance.py / u1-demo.ndjson")
    else:
        brow = json.loads(open(demo2, encoding="utf-8").read().split("\n")[0])
        brow["record_id"] = "recHIST"
        nested = {"record_id": brow["record_id"],
                  "fields": {k: v for k, v in brow.items() if k != "record_id"}}
        flat_payload = json.dumps(brow, ensure_ascii=False) + "\n"
        nested_payload = json.dumps(nested, ensure_ascii=False) + "\n"
        rc, counts, err = conf_run(flat_payload, nested_payload)
        if rc != 0 or counts.get("history_changed"):
            hist_bad.append(f"嵌套基线同值: rc={rc} {counts} {err[:40]}")
        for f in ("工作项键", "日报键", "来源渠道", "来源事件标识", "证据"):
            mut = json.loads(json.dumps(brow))
            mut[f] = "https://a.test/other" if f == "证据" else str(mut.get(f, "")) + "X"
            rc, counts, err = conf_run(json.dumps(mut, ensure_ascii=False) + "\n", nested_payload)
            if rc != 2 or counts.get("history_changed") != 1:
                hist_bad.append(f"改 {f}: rc={rc} history_changed={counts.get('history_changed')} {err[:40]}")
        col = {"data": {"fields": [k for k in nested["fields"]],
                        "data": [[nested["fields"][k] for k in nested["fields"]]],
                        "has_more": False, "record_id_list": ["recHIST"]}}
        rc, counts, err = conf_run(flat_payload, json.dumps(col, ensure_ascii=False) + "\n")
        if rc != 0 or counts.get("history_changed"):
            hist_bad.append(f"列式基线同值: rc={rc} {counts} {err[:40]}")
        rc, _c, err = conf_run(json.dumps(brow, ensure_ascii=False) + "\r"
                               + json.dumps(brow, ensure_ascii=False) + "\r", nested_payload)
        if rc != 3 or "裸 CR" not in err:
            hist_bad.append(f"裸 CR: rc={rc} err={err[:40]}")
        rc, _c, err = conf_run(json.dumps(brow, ensure_ascii=False) + "\r\n"
                               + json.dumps(brow, ensure_ascii=False) + "\r\n", nested_payload)
        if rc == 3 or "READ_FAIL" in err:      # 两行同 record_id 会命中 record_id_dup → rc=2 也算解析成功
            hist_bad.append(f"CRLF: rc={rc} err={err[:40]}")
        mixed = dict(brow)
        mixed["fields"] = {"x": 1}
        rc, _c, err = conf_run(json.dumps(mixed, ensure_ascii=False) + "\n", nested_payload)
        if rc != 3 or "形状不支持" not in err:
            hist_bad.append(f"混合形状: rc={rc} err={err[:40]}")
    if hist_bad:
        problems.append("历史核验/换行口径: " + "；".join(hist_bad))
    print(f"[{'OK  ' if not hist_bad else 'FAIL'}] 历史核验/换行口径: {hist_n[0]} 例"
          f"{'' if not hist_bad else ' → ' + '；'.join(hist_bad)}")

    # 2l11c) 形状旁路：JSON 数组、record_id 内外冲突、只用嵌套 ID、fields=null、
    #         基线字段类型错误、None/"" 口径
    shape_bad = []
    shape_n = [0]

    def conf_run2(export_payload, baseline_payload):
        shape_n[0] += 1
        return conf_run(export_payload, baseline_payload)

    if os.path.exists(conf2) and os.path.exists(demo2):
        brow2 = json.loads(open(demo2, encoding="utf-8").read().split("\n")[0])
        brow2["record_id"] = "recHIST"
        nested2 = {"record_id": "recHIST",
                   "fields": {k: v for k, v in brow2.items() if k != "record_id"}}
        base_payload2 = json.dumps(nested2, ensure_ascii=False) + "\n"

        # a) 数组形状必须在拍平之后比较：改一个历史字段要报 1 条
        mut2 = json.loads(json.dumps(brow2))
        mut2["工作项键"] = str(mut2.get("工作项键", "")) + "X"
        rc, counts, err = conf_run2(json.dumps([mut2], ensure_ascii=False) + "\n", base_payload2)
        if rc != 2 or counts.get("history_changed") != 1:
            shape_bad.append(f"数组同值比较: rc={rc} history_changed={counts.get('history_changed')} {err[:40]}")

        # a2) 两侧都是 JSON 数组（嵌套行）时同样要比较：改一个字段要报 1 条
        mut2b = json.loads(json.dumps(nested2["fields"]))
        mut2b["工作项键"] = str(mut2b.get("工作项键", "")) + "X"
        rc, counts, err = conf_run2(json.dumps([{"record_id": "recHIST", "fields": mut2b}], ensure_ascii=False) + "\n",
                                    json.dumps([nested2], ensure_ascii=False) + "\n")
        if rc != 2 or counts.get("history_changed") != 1:
            shape_bad.append(f"数组×数组: rc={rc} history_changed={counts.get('history_changed')} {err[:40]}")

        # b) 顶层 ID 与 fields.record_id 冲突 → 拒（同名内嵌一律按歧义拒判）
        conflict = {"record_id": "recHIST",
                    "fields": dict(nested2["fields"], record_id="recOTHER")}
        rc, _c, err = conf_run2(json.dumps(conflict, ensure_ascii=False) + "\n", base_payload2)
        if rc != 3 or "歧义" not in err:
            shape_bad.append(f"ID 冲突: rc={rc} err={err[:40]}")

        # c) 只有 fields.record_id（值与顶层相同也一样）→ 拒，不得静默丢掉内层
        only_nest = {"fields": dict(nested2["fields"], record_id="recHIST")}
        rc, counts, err = conf_run2(json.dumps(only_nest, ensure_ascii=False) + "\n", base_payload2)
        if rc != 3 or "歧义" not in err:
            shape_bad.append(f"仅在 fields 里的 ID: rc={rc} {counts} {err[:40]}")

        # d) fields=null → 拒
        rc, _c, err = conf_run2(json.dumps({"record_id": "recMAL", "fields": None}) + "\n",
                                json.dumps({"record_id": "recMAL", "fields": None}) + "\n")
        if rc != 3 or "不是对象" not in err:
            shape_bad.append(f"fields=null: rc={rc} err={err[:40]}")

        # e) 基线字段类型错（列表）→ 报 baseline_field_type，不得静默当同值
        # 单元素数组是列式合法形态，不算法型错；用对象（无法解释成单元格）测类型错
        bad_base = {"record_id": "recHIST", "fields": dict(nested2["fields"], 工作项键={"a": 1})}
        rc, counts, err = conf_run2(json.dumps(brow2, ensure_ascii=False) + "\n",
                                    json.dumps(bad_base, ensure_ascii=False) + "\n")
        if rc != 2 or counts.get("baseline_field_type") != 1:
            shape_bad.append(f"基线类型错: rc={rc} {counts} {err[:40]}")

        # f) 缺列 vs 空串：契约口径为「空值等价」，不得报变化
        none_base = {"record_id": "recHIST", "fields": {k: v for k, v in nested2["fields"].items() if k != "来源事件标识"}}
        rc, counts, err = conf_run2(json.dumps(dict(brow2, 来源事件标识=""), ensure_ascii=False) + "\n",
                                    json.dumps(none_base, ensure_ascii=False) + "\n")
        if rc != 0 or counts.get("history_changed"):
            shape_bad.append(f"缺列 vs 空串: rc={rc} {counts} {err[:40]}")
    if shape_bad:
        problems.append("形状旁路: " + "；".join(shape_bad))
    print(f"[{'OK  ' if not shape_bad else 'FAIL'}] 形状旁路: {shape_n[0]} 例"
          f"{'' if not shape_bad else ' → ' + '；'.join(shape_bad)}")

    # 2l11d) 历史保护范围 / 列式 ID 来源 / null 口径
    scope_bad = []
    scope_n = [0]

    def conf_run3(export_payload, baseline_payload):
        scope_n[0] += 1
        return conf_run(export_payload, baseline_payload)

    if os.path.exists(conf2) and os.path.exists(demo2):
        brow3 = json.loads(open(demo2, encoding="utf-8").read().split("\n")[0])
        brow3["record_id"] = "recHIST"
        brow3["工作项"] = "历史原有列的值"          # 非五字段，但基线有值 → 受保护
        base3 = {"record_id": "recHIST", "fields": {k: v for k, v in brow3.items() if k != "record_id"}}
        base3_payload = json.dumps(base3, ensure_ascii=False) + "\n"

        # a) 清空非五字段的历史非空列 → 必须报
        cleared = json.loads(json.dumps(brow3))
        cleared["工作项"] = ""
        rc, counts, err = conf_run3(json.dumps(cleared, ensure_ascii=False) + "\n", base3_payload)
        if rc != 2 or counts.get("history_changed") != 1:
            scope_bad.append(f"清空历史非五字段列: rc={rc} {counts} {err[:40]}")

        # b) 列式省略 record_id_list、record_id 混在业务列 → 拒
        cols = {"data": {"fields": list(base3["fields"]) + ["record_id"],
                         "data": [[base3["fields"][k] for k in base3["fields"]] + ["recHIST"]],
                         "has_more": False}}
        rc, _c, err = conf_run3(json.dumps(cols, ensure_ascii=False) + "\n", base3_payload)
        if rc != 3 or "元数据来源不明" not in err:
            scope_bad.append(f"列式无 record_id_list: rc={rc} err={err[:40]}")

        # c) 顶层 ID 与 fields.record_id=null → 拒
        nullnest = {"record_id": "recHIST", "fields": dict(base3["fields"], record_id=None)}
        rc, _c, err = conf_run3(json.dumps(nullnest, ensure_ascii=False) + "\n", base3_payload)
        if rc != 3 or "歧义" not in err:
            scope_bad.append(f"顶层 ID vs 嵌套 null: rc={rc} err={err[:40]}")

        # d) 类型不同（"1" vs 1）→ 拒
        typenest = {"record_id": "1", "fields": dict(base3["fields"], record_id=1)}
        rc, _c, err = conf_run3(json.dumps(typenest, ensure_ascii=False) + "\n", base3_payload)
        if rc != 3 or "歧义" not in err:
            scope_bad.append(f"ID 类型不同: rc={rc} err={err[:40]}")

        # e) 基线 null vs 导出 "" → 等价空值，不报
        base_null = json.loads(json.dumps(base3))
        base_null["fields"]["来源事件标识"] = None
        export_empty = json.loads(json.dumps(brow3))
        export_empty["来源事件标识"] = ""
        rc, counts, err = conf_run3(json.dumps(export_empty, ensure_ascii=False) + "\n",
                                    json.dumps(base_null, ensure_ascii=False) + "\n")
        if rc != 0 or counts.get("history_changed"):
            scope_bad.append(f"基线 null vs 导出空串: rc={rc} {counts} {err[:40]}")

        # f) 基线非空 vs 导出 null → 报
        export_null = json.loads(json.dumps(brow3))
        export_null["工作项"] = None
        rc, counts, err = conf_run3(json.dumps(export_null, ensure_ascii=False) + "\n", base3_payload)
        if rc != 2 or counts.get("history_changed") != 1:
            scope_bad.append(f"基线非空 vs 导出 null: rc={rc} {counts} {err[:40]}")
    if scope_bad:
        problems.append("历史保护范围: " + "；".join(scope_bad))
    print(f"[{'OK  ' if not scope_bad else 'FAIL'}] 历史保护范围/列式 ID/null 口径: {scope_n[0]} 例"
          f"{'' if not scope_bad else ' → ' + '；'.join(scope_bad)}")

    # 2l11e) 数组内类型错传播 / 列式同名覆盖 / 空字段不保护
    e_bad = []
    e_n = [0]

    def conf_run4(export_payload, baseline_payload):
        e_n[0] += 1
        return conf_run(export_payload, baseline_payload)

    if os.path.exists(conf2) and os.path.exists(demo2):
        hist = {"record_id": "recHIST", "fields": {"工作项": "历史值", "证据": "https://example.com/a"}}

        # a) 基线数组里含对象（无法解释成单元格）→ baseline_field_type
        b_a = json.dumps({"record_id": "recHIST", "fields": {"工作项": "历史值", "证据": ["tag", {"a": 1}]}},
                         ensure_ascii=False) + "\n"
        e_a = json.dumps({"record_id": "recHIST", "fields": {"工作项": "历史值", "证据": ["tag", {"a": 2}]}},
                         ensure_ascii=False) + "\n"
        rc, counts, err = conf_run4(e_a, b_a)
        if rc != 2 or counts.get("baseline_field_type") != 1:
            e_bad.append(f"基线数组含对象: rc={rc} {counts} {err[:40]}")

        # b) 导出侧数组里含对象 → type_error（基线是合法数组，不报改动）
        b_b = json.dumps(hist, ensure_ascii=False) + "\n"
        e_b = json.dumps({"record_id": "recHIST",
                          "fields": {"工作项": "历史值", "证据": ["tag", {"a": 2}]}},
                         ensure_ascii=False) + "\n"
        rc, counts, err = conf_run4(e_b, b_b)
        if rc != 2 or counts.get("type_error") != 1:
            e_bad.append(f"导出数组含对象: rc={rc} {counts} {err[:40]}")

        # c) 列式给了 record_id_list，但业务列里也有 record_id → 拒（不得静默覆盖）
        cols = {"data": {"fields": ["record_id", "工作项", "证据"],
                         "data": [["old", "历史值", "https://example.com/a"]],
                         "record_id_list": ["recHIST"], "has_more": False}}
        rc, _c, err = conf_run4(json.dumps(cols, ensure_ascii=False) + "\n", b_b)
        if rc != 3 or "静默覆盖" not in err:
            e_bad.append(f"列式含业务 record_id+ids: rc={rc} err={err[:40]}")

        # d) 基线该字段为空/缺列，导出补成非空 → 不保护、不报
        b_d = json.dumps({"record_id": "recHIST", "fields": {"工作项": "历史值"}}, ensure_ascii=False) + "\n"
        e_d = json.dumps({"record_id": "recHIST",
                          "fields": {"工作项": "历史值", "来源渠道": "wecom"}}, ensure_ascii=False) + "\n"
        rc, counts, err = conf_run4(e_d, b_d)
        if rc != 0 or counts.get("history_changed"):
            e_bad.append(f"基线空字段补值: rc={rc} {counts} {err[:40]}")

        # e) 基线非空 → 改成另一个非空值（工作项）→ 仍报，等 PM 决定是否豁免
        e_e = json.dumps({"record_id": "recHIST", "fields": {"工作项": "另一个值", "证据": "https://example.com/a"}},
                         ensure_ascii=False) + "\n"
        rc, counts, err = conf_run4(e_e, b_b)
        if rc != 2 or counts.get("history_changed") != 1:
            e_bad.append(f"非空改非空: rc={rc} {counts} {err[:40]}")
    if e_bad:
        problems.append("数组类型传播/空字段: " + "；".join(e_bad))
    print(f"[{'OK  ' if not e_bad else 'FAIL'}] 数组类型传播/列式同名/空字段不保护: {e_n[0]} 例"
          f"{'' if not e_bad else ' → ' + '；'.join(e_bad)}")

    # 2l11f) 类型保真 / 嵌套 ID 拒判 / 列式 ID 不解箱 / 空数组口径
    t_bad = []
    t_n = [0]

    def conf_run5(export_payload, baseline_payload):
        t_n[0] += 1
        return conf_run(export_payload, baseline_payload)

    if os.path.exists(conf2):
        hist = {"record_id": "recHIST",
                "fields": {"工作项": "历史值", "需人判断": False, "事件序号": 3}}
        b_p = json.dumps(hist, ensure_ascii=False) + "\n"

        # a) 布尔 false → 字符串 "false"（类型变了）→ 必须报
        e_a = {"record_id": "recHIST",
               "fields": {"工作项": "历史值", "需人判断": "false", "事件序号": 3}}
        rc, counts, err = conf_run5(json.dumps(e_a, ensure_ascii=False) + "\n", b_p)
        if rc != 2 or counts.get("history_changed") != 1:
            t_bad.append(f"bool→str: rc={rc} {counts} {err[:40]}")

        # b) 数字 3 → 字符串 "3" → 必须报
        e_b = {"record_id": "recHIST",
               "fields": {"工作项": "历史值", "需人判断": False, "事件序号": "3"}}
        rc, counts, err = conf_run5(json.dumps(e_b, ensure_ascii=False) + "\n", b_p)
        if rc != 2 or counts.get("history_changed") != 1:
            t_bad.append(f"num→str: rc={rc} {counts} {err[:40]}")

        # c) 跨导出形状（列式 vs 行式）时，单元素数组按列式包装解一层 → 合法，不报
        b_c = json.dumps({"record_id": "recHIST", "fields": {"工作项": "历史值"}}, ensure_ascii=False) + "\n"
        e_c = json.dumps({"data": {"fields": ["工作项"], "data": [["历史值"]],
                                   "record_id_list": ["recHIST"], "has_more": False, "total": 1}},
                         ensure_ascii=False) + "\n"
        rc, counts, err = conf_run5(e_c, b_c)
        if rc != 0 or counts.get("history_changed"):
            t_bad.append(f"跨形状包装: rc={rc} {counts} {err[:40]}")
        # c2) 同一形状下行式数组 vs 标量 → 真实形状改动，必须报（不许静默拆包）
        rc, counts, err = conf_run5(
            json.dumps({"record_id": "recHIST", "fields": {"工作项": ["历史值"]}}, ensure_ascii=False) + "\n",
            b_c)
        if rc != 2 or counts.get("history_changed") != 1:
            t_bad.append(f"同形状数组vs标量: rc={rc} {counts} {err[:40]}")

        # d) 基线 fields 里带 record_id（与顶层同值）→ 歧义，拒判
        b_d = json.dumps({"record_id": "recHIST", "fields": {"record_id": "recHIST", "工作项": "历史值"}},
                         ensure_ascii=False) + "\n"
        e_d = json.dumps({"record_id": "recHIST", "fields": {"工作项": "历史值"}}, ensure_ascii=False) + "\n"
        rc, _c, err = conf_run5(e_d, b_d)
        if rc != 3 or "歧义" not in err:
            t_bad.append(f"嵌套 ID 基线: rc={rc} err={err[:40]}")

        # e) record_id_list 给嵌套数组 → 不解箱，拒
        b_e = json.dumps({"record_id": "recHIST", "fields": {"工作项": "历史值"}}, ensure_ascii=False) + "\n"
        cols = {"data": {"fields": ["工作项"], "data": [["历史值"]],
                         "record_id_list": [["recHIST"]], "has_more": False}}
        rc, _c, err = conf_run5(json.dumps(cols, ensure_ascii=False) + "\n", b_e)
        if rc != 3 or "不是非空字符串" not in err:
            t_bad.append(f"ids 嵌套数组: rc={rc} err={err[:40]}")

        # f) 空数组 = 空值：基线 [] 补成非空 → 不报
        b_f = json.dumps({"record_id": "recHIST", "fields": {"工作项": []}}, ensure_ascii=False) + "\n"
        e_f = json.dumps({"record_id": "recHIST", "fields": {"工作项": "值"}}, ensure_ascii=False) + "\n"
        rc, counts, err = conf_run5(e_f, b_f)
        if rc != 0 or counts.get("history_changed"):
            t_bad.append(f"基线空数组补值: rc={rc} {counts} {err[:40]}")
    if t_bad:
        problems.append("类型保真/ID 解箱/空数组: " + "；".join(t_bad))
    print(f"[{'OK  ' if not t_bad else 'FAIL'}] 类型保真/嵌套 ID/列式 ID/空数组: {t_n[0]} 例"
          f"{'' if not t_bad else ' → ' + '；'.join(t_bad)}")

    # 2l11g) 无损数值 / 分页 total 类型 / 行式空白 ID / 数组套数组
    g_bad = []
    g_n = [0]

    def conf_run6(export_payload, baseline_payload):
        g_n[0] += 1
        return conf_run(export_payload, baseline_payload)

    if os.path.exists(conf2):
        one_b = '{"record_id":"recH","fields":{"k":"v"}}\n'

        # a) 2^53 附近的两个不同浮点不得并成同一个值
        rc, _c, err = conf_run6('{"record_id":"recH","fields":{"k":9007199254740992.0}}\n',
                                '{"record_id":"recH","fields":{"k":9007199254740993.0}}\n')
        if rc != 2:
            g_bad.append(f"精度: rc={rc} {err[:40]}")

        # b) 3 与 3.0 是同一个 JSON 数值 → 相等，不报
        rc, counts, err = conf_run6('{"record_id":"recH","fields":{"k":3}}\n',
                                    '{"record_id":"recH","fields":{"k":3.0}}\n')
        if rc != 0 or counts.get("history_changed"):
            g_bad.append(f"3vs3.0: rc={rc} {counts} {err[:40]}")

        # c) 数组里套数组 → 不拆包，按类型错报
        rc, counts, err = conf_run6('{"record_id":"recH","fields":{"k":["a",["b"]]}}\n',
                                    '{"record_id":"recH","fields":{"k":["a","b"]}}\n')
        # 导出侧解释不了 → type_error；基线侧解释不了 → baseline_field_type；两者都算检出
        if rc != 2 or (counts.get("type_error", 0) + counts.get("baseline_field_type", 0)) != 1:
            g_bad.append(f"数组套数组: rc={rc} {counts} {err[:40]}")

        # d) 分页 total 必须是整数且等于行数：2.0 / "2" 拒判，1 通过
        col = ('{"data":{"fields":["k"],"data":[["v"]],"record_id_list":["recH"],'
               '"has_more":false,"total":%s}}\n')
        for bad_total in ('2.0', '"2"'):
            rc, _c, err = conf_run6(col % bad_total, one_b)
            if rc != 3 or "total" not in err:
                g_bad.append(f"total={bad_total}: rc={rc} {err[:40]}")
        rc, _c, err = conf_run6(col % '1', one_b)
        if rc != 0:
            g_bad.append(f"total=1: rc={rc} {err[:40]}")

        # e) 行式空白 record_id → 与列式同口径拒判
        rc, _c, err = conf_run6('{"record_id":" ","fields":{"k":"v"}}\n',
                                '{"record_id":" ","fields":{"k":"v"}}\n')
        if rc != 3 or "空白" not in err:
            g_bad.append(f"行式空白ID: rc={rc} {err[:40]}")

        # f) [""] → [] 属真实改动（非空数组变成空），不得当空值放过
        rc, counts, err = conf_run6('{"record_id":"recH","fields":{"k":[]}}\n',
                                    '{"record_id":"recH","fields":{"k":[""]}}\n')
        if rc != 2 or counts.get("history_changed") != 1:
            g_bad.append(f"单空串→空数组: rc={rc} {counts} {err[:40]}")
    if g_bad:
        problems.append("无损数值/total/空白ID/嵌套数组: " + "；".join(g_bad))
    print(f"[{'OK  ' if not g_bad else 'FAIL'}] 无损数值/分页 total/空白 ID/数组套数组: {g_n[0]} 例"
          f"{'' if not g_bad else ' → ' + '；'.join(g_bad)}")

    # 2l10) 走查遇到 ENOENT 必须回查：第一次「不存在」、第二次读成悬空软链 → 报「发生变化」
    with tempfile.TemporaryDirectory() as tmp:
        os.symlink(os.path.join(tmp, "gone"), os.path.join(tmp, "link"))
        real_walk = U._walk_root
        seen = {"n": 0}

        def fake_walk(p):
            seen["n"] += 1
            if seen["n"] == 1:
                return None, True        # 模拟「当时确实读不到」
            return real_walk(p)

        U._walk_root = fake_walk
        try:
            _p, err = U._probe_window(os.path.join(tmp, "link"), ["raw/qq-window.json"])
        finally:
            U._walk_root = real_walk
    race_ok = bool(err) and "发生变化" in err and seen["n"] >= 2
    if not race_ok:
        problems.append(f"探测期间变化: err={err!r} walks={seen['n']}")
    print(f"[{'OK  ' if race_ok else 'FAIL'}] 探测期间变化: walks={seen['n']} err={str(err)[:40]!r}")

    # 2l11) 长 ./ 前缀 + 悬空组件：错误里必须还能看到故障组件本身，且有界
    with tempfile.TemporaryDirectory() as tmp:
        os.symlink(os.path.join(tmp, "gone"), os.path.join(tmp, "docker"))
        longp = os.path.join(tmp, "./" * 40, "docker")
        err = U._probe_root(longp)
    long_ok = bool(err) and "docker" in err and len(err) <= 900
    if not long_ok:
        problems.append(f"长路径定位: err={err!r}")
    print(f"[{'OK  ' if long_ok else 'FAIL'}] 长路径定位: len={len(err) if err else 0}")

    # 2l9) 证据控制字符必须被 conformance 整链拦下（splitlines 会吞 U+0085/2028/2029）
    conf_script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "tools", "conformance.py")
    demo = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "u1-demo.ndjson")
    if not (os.path.exists(conf_script) and os.path.exists(demo)):
        problems.append(f"证据控制字符: 缺 conformance.py({conf_script}) 或 u1-demo.ndjson({demo})")
    else:
        demo_lines = open(demo, encoding="utf-8").read().split("\n")
        base = json.loads(demo_lines[0])
        second = json.loads([x for x in demo_lines[1:] if x.strip()][0])
        e2e_bad = []

        def run_conf(payload):
            with tempfile.TemporaryDirectory() as tmp:
                inp = os.path.join(tmp, "x.ndjson")
                out = os.path.join(tmp, "o.json")
                with open(inp, "w", encoding="utf-8") as fh:
                    fh.write(payload)
                proc = subprocess.run([sys.executable, conf_script, inp, "--baseline", "", "--json", out],
                                      capture_output=True, text=True)
                rep = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else {}
            return proc.returncode, (rep.get("rules") or {}), (rep.get("pass_rules") or [])

        for label, ch, esc in (("u2028", "\u2028", False), ("u0085", "\u0085", False),
                               ("cr", "\r", False), ("nul", "\x00", False),
                               ("u2028-esc", "\u2028", True), ("u0085-esc", "\u0085", True)):
            case_row = dict(base)
            case_row["证据"] = "https://a.test/ok" + ch
            payload = (json.dumps(case_row) if esc else json.dumps(case_row, ensure_ascii=False)) + "\n"
            rc, rules, _ = run_conf(payload)
            if rc == 0 or "evidence_control_char" not in rules:
                e2e_bad.append(f"{label} 单行: rc={rc} rules={list(rules)}")
        for label, ch in (("u2028", "\u2028"), ("u0085", "\u0085")):
            case_row = dict(base)
            case_row["证据"] = "https://a.test/ok" + ch
            payload = (json.dumps(case_row, ensure_ascii=False) + "\n"
                       + json.dumps(second, ensure_ascii=False) + "\n")
            rc, rules, _ = run_conf(payload)
            if rc != 2 or "evidence_control_char" not in rules or "read_error" in rules:
                e2e_bad.append(f"{label} 两行: rc={rc} rules={list(rules)}")
        rc, rules, pass_rules = run_conf("".join(json.dumps(json.loads(x), ensure_ascii=False) + "\n"
                                                 for x in demo_lines if x.strip()))
        if rc != 2 or "evidence_control_char" not in pass_rules or "evidence_control_char" in rules:
            e2e_bad.append(f"干净报告: rc={rc} rules={list(rules)} pass_has={('evidence_control_char' in pass_rules)}")
        if e2e_bad:
            problems.append("证据控制字符端到端: " + "；".join(e2e_bad))
        print(f"[{'OK  ' if not e2e_bad else 'FAIL'}] 证据控制字符端到端: 6 单行 + 2 两行 + 干净报告")

    # 2m) URL：`:80` 无主机、`http://[` 解析异常、多份换行证据
    url_cases = [("http://:80", False), ("http://[", False), ("http://", False),
                 ("https://a.test", True), ("https://a.test/path?q=1", True),
                 ("https://a.test\nhttps://b.test", False)]   # 单行函数不认多行，多行在行级拆
    bad_url = [(u, w) for u, w in url_cases if U._is_full_url(u) != w]
    if bad_url:
        problems.append(f"URL 校验: {bad_url}")
    print(f"[{'OK  ' if not bad_url else 'FAIL'}] URL 校验: {[(u, U._is_full_url(u)) for u, _ in url_cases]}")

    # 2m3) 与 conformance.url_ok 逐条对齐（两套 URL 规则是历来最容易漂的地方）
    import importlib.util as _ilu
    _spec = _ilu.spec_from_file_location(
        "uf003_conformance", os.path.join(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__))), "tools", "conformance.py"))
    _conf = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_conf)
    url_table = [
        ("https://a.test", True), ("https://a.test/path?q=1", True),
        ("http://a.test:8080/x", True), ("http://localhost:8080/x", True),
        ("http://a.test:65535/x", True),
        ("http://", False), ("http://:80", False), ("http://[", False),
        ("https://a.test:0", False), ("https://a.test:", False),
        ("https://-bad.test", False), ("https://a_b.test", False),
        ("ftp://a.test", False), ("https://a.test/x y", False),
        ("https://a.test.", False), ("https://" + "a" * 70 + ".test", False),
        # 下面四条是「两侧同时回退成 $」也抓不住的反例，必须断言期望值 False
        ("https://a.test\n", False), ("https://a.test\n\n", False),
        ("https://a.test/ok\x00evil", False), ("https://a.test/ok\x07", False),
        ("https://a.test/ok\x80evil", False), ("https://a.test/ok\x9f", False),
        ("https://a.test/ok\u2028x", False), ("https://a.test/ok\ufeffx", False),
    ]
    mismatch = [(u, U._is_full_url(u), _conf.url_ok(u), want) for u, want in url_table
                if U._is_full_url(u) != want or _conf.url_ok(u) != want]
    if mismatch:
        problems.append(f"URL 规则与期望值不符（实现, conformance, 期望）: {mismatch}")
    print(f"[{'OK  ' if not mismatch else 'FAIL'}] URL 规则断言期望值: {len(url_table)} 例"
          + (f" 不符={mismatch}" if mismatch else ""))

    # 2m4) 证据首行前置空格 / 尾部 \t、\r 必须拒
    for tag, evd, want in [("前置空格", " https://a.test", 3), ("尾部回车", "https://a.test\r", 3),
                           ("行内制表", "https://a.test\n\thttps://b.test", 3)]:
        qq, rc, reason = run_with(lambda s, r, _e=evd, **kw: {
            "来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good", "证据": _e,
            "身份档": "unverified"}, True)
        if rc != want:
            problems.append(f"{tag}: rc={rc}（要 {want}；{reason}）")
        print(f"[{'OK  ' if rc == want else 'FAIL'}] 证据{tag}: rc={rc}")

    # 2m2) 多份证据换行分隔：行级通过即整行合法；含非链接行必须 rc=3
    for tag, evd, want_rc in [("多份证据", "https://a.test\nhttps://b.test", 0),
                              ("含非链接行", "https://a.test\n不是链接", 3),
                              ("尾部空行", "https://a.test\n", 3)]:
        qq, rc, reason = run_with(lambda s, r, _e=evd, **kw: {
            "来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good", "证据": _e,
            "身份档": "unverified"}, True)
        if rc != want_rc:
            problems.append(f"{tag}: rc={rc}（要 {want_rc}；{reason}）")
        print(f"[{'OK  ' if rc == want_rc else 'FAIL'}] {tag}: rc={rc}")

    # 2n) 身份档联动对任何 unknown: 前缀都成立（不只 unknown:user-feedback-）
    qq, rc, reason = run_with(lambda s, r, **kw: {"来源渠道": "QQ", "来源事件标识": "unknown:external",
                                                  "证据": "https://a.test/1", "身份档": "verified"}, False)
    if rc != 3 or "身份档" not in str(reason):
        problems.append(f"unknown:external+verified: rc={rc}（要 3）、reason={reason!r}（要含 身份档 联动）")
    print(f"[{'OK  ' if rc == 3 and '身份档' in str(reason) else 'FAIL'}] "
          f"unknown:external+verified: rc={rc} reason={str(reason)[:60]!r}")

    # 2o) 报告里的孤立代理项出现在「键」上也要能写出
    qq, rc, reason = run_with(lambda s, r, **kw: {"来源渠道": "QQ", "来源事件标识": "qq:G1:ROBOT1.0_good",
                                                  "证据": U.NO_URL, "身份档": "unverified",
                                                  "\ud800k": "v"}, True)
    try:
        json.dumps(qq, ensure_ascii=False).encode("utf-8")
        key_err = None
    except UnicodeEncodeError as exc:
        key_err = exc
    if key_err:
        problems.append(f"代理项键: 报告仍不可 UTF-8 编码（{key_err}）")
    print(f"[{'OK  ' if not key_err else 'FAIL'}] 代理项键: {'ok' if not key_err else key_err}")

    # 2p) 其它渠道的原始 id 含孤立代理项：必须降级占位并留因，不能原样落表
    c = U.load_contract()
    orow = U.build_identity("other", {"id": "x\ud800y"}, batch_key="20261124", round4=1, row_no=1, contract=c)
    if U._encodable(orow["来源事件标识"]) is False:
        problems.append(f"其它渠道代理项 id: 仍保留不可编码 id {orow['来源事件标识']!r}")
    if not str(orow["来源事件标识"]).startswith("unknown:"):
        problems.append(f"其它渠道代理项 id: 期望降级占位，实际 {orow['来源事件标识']!r}")
    print(f"[{'OK  ' if str(orow['来源事件标识']).startswith('unknown:') else 'FAIL'}] "
          f"其它渠道代理项 id: {orow['来源事件标识']}")

    # 2r) 可编码降级产生的占位也必须过契约族（模拟 PM 把邮箱族收紧成只认 mail:...）
    #     r9 A：内存改过的契约是合成契约，必须显式 contract_is_synthetic=True；否则未声明即 REFUSE（先于流水线）
    import copy as _copy
    tight = _copy.deepcopy(U.load_contract())
    tight["families"]["支持邮箱"] = r"^(mail:[^@\s]+@[^\s]+)$"     # 故意不给 unknown 占位
    undeclared = None
    try:
        U.build_identity("支持邮箱", {"message_id": "x\ud800y@example.com"}, batch_key="20261124",
                         round4=1, row_no=1, contract=tight)
    except Exception as exc:  # noqa: BLE001
        undeclared = exc
    ok_undeclared = isinstance(undeclared, U.ResolveError) and not isinstance(undeclared, U.QQSegmentDrift) \
        and "合成契约" in str(undeclared) and "contract_is_synthetic" in str(undeclared)
    if not ok_undeclared:
        problems.append(f"合成契约未声明: 期望 ResolveError(合成契约)，实际 "
                        f"{type(undeclared).__name__ if undeclared else '未报错'}: {undeclared}")
    print(f"[{'OK  ' if ok_undeclared else 'FAIL'}] 合成契约未声明: "
          f"{type(undeclared).__name__ if undeclared else '未报错'} {str(undeclared)[:60]!r}")
    raised = None
    try:
        # 必须用解析器真读的字段（message_id）：用 "id" 走不到解析分支，等于没测
        U.build_identity("支持邮箱", {"message_id": "x\ud800y@example.com"}, batch_key="20261124",
                         round4=1, row_no=1, contract=tight, contract_is_synthetic=True)
    except Exception as exc:  # noqa: BLE001
        raised = exc
    ok_2r = isinstance(raised, U.ResolveError) and "契约族" in str(raised)
    if not ok_2r:
        problems.append(f"占位复验: 期望 ResolveError + 契约族原因，实际 "
                        f"{type(raised).__name__ if raised else '未报错'}: {raised}")
    print(f"[{'OK  ' if ok_2r else 'FAIL'}] 占位复验: "
          f"{type(raised).__name__ if raised else '未报错'} {str(raised)[:60]!r}")

    # 2q) stdout 为 ascii:strict 时仍要出报告（不能 rc=1、stdout 空）
    with tempfile.TemporaryDirectory() as tmp:
        make_run(tmp)
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "ascii:strict"
        env["UF003_CONTRACT_DIR"] = os.environ.get("UF003_CONTRACT_DIR", "")
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uf003_identity.py"), "--selfcheck",
                            "--run", tmp, "--allow-qq-candidate"],
                           capture_output=True, text=True, env=env)
    parsed = None
    try:
        parsed = json.loads(r.stdout)
    except Exception:  # noqa: BLE001
        parsed = None
    ok_ascii = r.returncode == 0 and isinstance(parsed, dict) and parsed.get("checks")
    if not ok_ascii:
        problems.append(f"ascii stdout: rc={r.returncode}、JSON={'ok' if isinstance(parsed, dict) else 'bad'}，"
                        f"stdout={r.stdout[:80]!r}，stderr={r.stderr[-120:]!r}")
    print(f"[{'OK  ' if ok_ascii else 'FAIL'}] ascii stdout: rc={r.returncode} JSON={'ok' if isinstance(parsed, dict) else 'bad'}")

    # 2k) QQ 解析正则与候选族正则必须同边界（长度上限、格式容忍一致）
    body200 = "a" * 200
    pairs = [
        ("200 字符载荷", "qq:G1:ROBOT1.0_" + body200, True),
        ("201 字符载荷", "qq:G1:ROBOT1.0_" + body200 + "a", False),
        ("缺版本号 ROBOT1.fake", "qq:G1:ROBOT1.fake", False),
    ]
    for tag, eid, want in pairs:
        got = bool(U.family_ok_proposed("QQ", eid))
        parsed = bool(re.fullmatch(U.QQ_MSG_ID_RE, eid.split(":", 2)[2])) if ":" in eid else False
        if got != want or parsed != want:
            problems.append(f"{tag}: 候选={got} 解析={parsed}，期望 {want}（两处口径必须一致）")
        print(f"[{'OK  ' if got == want and parsed == want else 'FAIL'}] {tag}: 候选={got} 解析={parsed}")

    # 3) 占位符本身不合族：降级行不能跳过验族
    qq, rc, reason = run_with(lambda s, r, **kw: row("QQ", BAD_PLACEHOLDER), False)
    if rc != 2:
        problems.append(f"坏占位符: rc={rc}（要 2；{reason}）")
    if qq.get("contract_family_bad") != 1:
        problems.append(f"坏占位符: contract_family_bad={qq.get('contract_family_bad')}，验族被跳过")
    print(f"[{'OK  ' if rc == 2 else 'FAIL'}] 坏占位符: rc={rc} contract_bad={qq.get('contract_family_bad')}")

    for p in problems:
        print(f"        ! {p}")
    print(f"\n{'PASS' if not problems else 'FAIL'}: 自检对故障注入的防线")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
