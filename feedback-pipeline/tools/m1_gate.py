#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M1 上线闸门：只判新行，存量按 T0 冻结。

用法: python3 -B tools/m1_gate.py --rows <今日生成.ndjson> --baseline <T0 全表导出.ndjson> [--new-only]
      [--contract v1.9|v1.10|v1.11|v1.12|v1.13] [--contract-dir contract]
契约入册: --contract 收 v1.9–v1.13，默认 v1.13；只读 <contract-dir>/detail-row.<ver>.schema.json（不读 cache/contract-view 裸主件）；
  版本文件缺失 / 不可解析 → rc=3、零输出、单行报因。x-contract-version 已声明则新旧档一律须与文件名一致：新档（RECHECK_FAMILY）不一致
  → M1_CONTRACT_RULE_INCONSISTENT 且 $id 须携带完整版本串（v1.13 不认 v1.130）；旧档 v1.9–v1.12（$id 仍为遗留 v1.2）不做 $id 强校验，不一致 → M1_CONTRACT_ID_MISMATCH；
  缺失只对硬编码白名单 LEGACY_NO_XCV（v1.9 / v1.10，历史契约从未声明）放行，依据 = 文件名版本 + 遗留 $id（报告 x-contract-version_missing=true、
  contract_id_basis="filename+legacy $id"），其余缺失一律 M1_CONTRACT_ID_MISMATCH（fail-closed）；旧档通过后走「文件名版本匹配 + 可解析」旧路径，报告标 contract_id_legacy=true。
判定口径（见 GATE-POLICY.md）: 硬红（rc=3，禁止入表）= record_id_dup, record_id_missing, type_error, pending_channel, unknown_event_id,
  event_id_family, history_changed, history_missing, row_key_bad 及任何未列入 ADVISORY 的规则；告警（只记录）= missing_field（非身份列）,
  evidence_not_url；判定器自身失败（rc 既非 0/2）→ rc=3 并输出原文。
明细行键复算（与 tools/window_to_rows.py x_row_key() 同式，覆盖判定器 row_key_bad）: 契约带 x-row-key（v1.12 起）时 明细行键 =
  sha256(规范化行紧凑 JSON 的 UTF-8 字节)，规范化行 = [[列名, 规范化值], …]，列序 = x-row-key.normalized_row.columns（已剔除 exclude_columns /
  declared_but_not_output_columns），ensure_ascii=False、separators=(",", ":")；值 str→NFC、None/缺列→""、bool→true/false、int→十进制、
  容器/浮点→键排序紧凑 JSON 再 NFC；占位行（来源事件标识 以 unknown: 开头或为空）该列记 ""。无 x-row-key（v1.11 及以前）走旧式
  sha256(工作项键 + 事件类型 + 事件序号)。判定器只收到 v1.12 且 row_key_bad 对所有版本按旧式复算；v1.13 另按契约 channel_family_patterns
  复算 event_id_family 覆盖（v1.12 件不认 3 段 wecom / discord:）。
历史去重键 = 来源事件标识（不再是 record_id）：基线标识按 ':' 段前缀入册（至少 2 段），窗口标识命中即存量，冻结不判、不进合并件；完全相等而 来源渠道不一致 → M1_HISTORY_CHANGED。
覆写闸（只对 RECHECK 档生效；旧档沿用判定器原判，不覆盖不重算替换）: 只许覆写 OVERRIDE_WHITELIST 两类，其余规则 判定器计数≠闸门计数 → OVERRIDE_WHITELIST_BREACH rc=3；
  violations_total = sum(hard)+sum(advisory)（覆写后重加总），judge_violations_total = 判定器原值，overridden = {规则: 判定器−闸门}，恒等 judge == total + sum(overridden)；
  覆写须带替代证据（row_key_recheck checked=equal、mismatch=0；fam_recheck 按契约族正则逐行 checked=matched、mismatch=0），缺一 rc=3；violations_total=0 是「口径差被闸门吸收」非「行完美」，三项总量须一起读；pending 列挂账。
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata

ADVISORY = ("evidence_not_url",)          # 存量口径：证据存本地路径，不阻塞
IDENTITY_FIELDS = ("record_id", "来源渠道", "来源事件标识")  # 缺任一即硬红，不许降级
CONTRACT_VERSIONS = ("v1.9", "v1.10", "v1.11", "v1.12", "v1.13")
DEFAULT_CONTRACT = "v1.13"
CONTRACT_FILE_FMT = "detail-row.%s.schema.json"   # 只认带版本号的件，不认裸主件 detail-row.schema.json
JUDGE_CONTRACT = {"v1.13": "v1.12"}               # 判定器 --contract 只收到 v1.12；差异规则由闸门按 v1.13 契约复算覆盖
RECHECK_FAMILY = ("v1.13",)                       # 新档：event_id_family 以闸门按契约族正则复算为准；$id 严格门与覆写闸也只对这些版本生效
LEGACY_NO_XCV = ("v1.9", "v1.10")  # 硬编码白名单：仅这两档历史契约从未声明 x-contract-version
EV_FIELD = "来源事件标识"
OVERRIDE_WHITELIST = ("row_key_bad", "event_id_family")   # ⑤ 只许这两类被闸门覆写，其余规则 判定器≠闸门 → OVERRIDE_WHITELIST_BREACH
REPORT_KEYS = ("ok", "contract", "judge_contract", "contract_file", "dedup_key", "row_key_rule", "rows_total", "new_rows", "history_hits",
               "new_by_channel", "mode", "baseline_rows", "violations_total", "history_rows", "row_key_recheck", "hard", "advisory", "json")
NEW_KEYS = ("contract_id_legacy", "judge_violations_total", "overridden", "fam_recheck", "pending",
            "x-contract-version_missing", "contract_id_basis")   # 须与 REPORT_KEYS ∪ x-value-map ∪ rule_counts 互斥（①③-a⑦-a）


def _load_rows(path):
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def _x_row_key(row, columns, unknown_prefix):
    """明细行键 = sha256(规范化行紧凑 JSON 的 UTF-8 字节)，与 tools/window_to_rows.py x_row_key() 同式。"""
    def norm(c, v):
        if c == EV_FIELD and (not isinstance(v, str) or v == "" or v.startswith(unknown_prefix)):
            v = ""                                   # 占位行：来源事件标识 记 ""
        if v is None:
            return ""
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, str):
            return unicodedata.normalize("NFC", v)
        if isinstance(v, int):
            return str(v)
        return unicodedata.normalize("NFC", json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    norm_row = [[c, norm(c, row.get(c))] for c in columns]
    return hashlib.sha256(json.dumps(norm_row, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def _split_new_only(rows_path, baseline_path, scratch):
    """M1 收敛口径：只判窗口新行，存量按基线冻结；历史去重键 = 来源事件标识（不是 record_id）。
    基线标识按 ':' 段前缀入册（至少 2 段）：wecom:a:b:c 同时登记 wecom:a:b；窗口行完全相等 → 存量（来源渠道 须与基线一致，否则 M1_HISTORY_CHANGED）；
    只命中段前缀（基线 4 段 / 窗口 3 段）→ 存量，冻结。基线原文 + 窗口新行合并成「全量导出」、基线文件原样作比对基准：存量恒等于基线（不回溯修），
    新行照常过全部红线。返回 (合并文件, 基线文件, 新行数, 存量行数, 命中键集)；无新行时合并文件为 None。不修改入参文件，临时文件只写 scratch。
    """
    base_full, base_prefix, base_n = {}, {}, 0
    with open(baseline_path, encoding="utf-8") as fh:
        for line in fh:
            if not (line := line.strip()):
                continue
            base_n += 1
            row = json.loads(line) or {}
            ev = row.get(EV_FIELD)
            if not (isinstance(ev, str) and ev.strip()):
                continue
            base_full[ev] = row.get("来源渠道")
            segs = ev.split(":")
            for n in range(2, len(segs)):                    # 至少 2 段
                base_prefix.setdefault(":".join(segs[:n]), ev)
    if not base_full:
        raise SystemExit("M1_BASELINE_UNUSABLE: 基线没有可用 来源事件标识，拒绝只判新行")
    new_rows, hits, changed = [], set(), []
    for row in _load_rows(rows_path):
        ev = (row or {}).get(EV_FIELD)
        if isinstance(ev, str) and ev in base_full:
            hits.add(ev)
            if row.get("来源渠道") != base_full[ev]:
                changed.append(ev)          # 存量行被改写：不回溯，必须报出来
            continue
        if isinstance(ev, str) and ev in base_prefix:
            hits.add(ev)                    # 基线长标识覆盖窗口短标识：同一事件，冻结
            continue
        new_rows.append(row)
    if changed:
        raise SystemExit("M1_HISTORY_CHANGED: 窗口内 %d 条记录改写了存量行（如 %s），存量冻结不回改，拒绝"
                         % (len(changed), changed[0]))
    if not new_rows:
        return None, None, 0, base_n, hits
    os.makedirs(scratch, exist_ok=True)
    merged_file = os.path.join(scratch, "m1-new-only-merged-%d.ndjson" % os.getpid())
    with open(merged_file, "w", encoding="utf-8") as out:
        with open(baseline_path, encoding="utf-8") as fh:      # 存量：基线原文照搬
            for line in fh:
                if line.strip():
                    out.write(line if line.endswith("\n") else line + "\n")
        for row in new_rows:                                   # 增量：本窗口新行
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
    return merged_file, baseline_path, len(new_rows), base_n, hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--contract", choices=CONTRACT_VERSIONS, default=DEFAULT_CONTRACT)
    ap.add_argument("--contract-dir", default="contract")
    ap.add_argument("--json", dest="json_out", default=None)
    ap.add_argument("--new-only", dest="new_only", action="store_true",
                    help="只判窗口新行，存量按基线冻结（不进 history_missing/history_changed）")
    ap.add_argument("--scratch", dest="scratch", default=os.environ.get("UF003_GATE_SCRATCH") or os.path.join(
        os.path.expanduser("~"), "HermesRuntime", "cache", "user-feedback", "scratch", "m1-gate"))
    a = ap.parse_args()
    # ① 契约入册：只读 <contract-dir>/detail-row.<ver>.schema.json。x-contract-version 已声明则须 == 文件名版本（缺失只对 LEGACY_NO_XCV 白名单旧档放行，其余缺失 fail-closed 拒、不进 conformance）：
    # 新档（RECHECK_FAMILY）不一致 → M1_CONTRACT_RULE_INCONSISTENT 且 $id 须携带完整版本串（v1.13 不认 v1.130）；旧档 $id 仍为遗留 v1.2 不做 $id 强校验，不一致 → M1_CONTRACT_ID_MISMATCH，通过走旧路径（contract_id_legacy=true）。
    cpath = os.path.join(a.contract_dir, CONTRACT_FILE_FMT % a.contract)
    recheck = a.contract in RECHECK_FAMILY
    if not os.path.isfile(cpath):
        print("M1_CONTRACT_FILE_MISSING: 契约文件不存在 %s（只认 detail-row.<ver>.schema.json，不读裸主件）" % cpath)
        return 3
    try:
        with open(cpath, "rb") as fh:
            schema = json.loads(fh.read().decode("utf-8"))
        if not isinstance(schema, dict):
            raise ValueError("契约顶层不是对象")
    except (OSError, ValueError) as exc:
        print("M1_CONTRACT_UNREADABLE: 契约文件不可用 %s（%s）" % (cpath, exc))
        return 3
    xcv, legacy_id = schema.get("x-contract-version"), not recheck
    xcv_missing = xcv is None and legacy_id and a.contract in LEGACY_NO_XCV   # 仅白名单旧档（历史契约从未声明）按「文件名版本 + 遗留 $id」入册；其余缺失一律 fail-closed
    if xcv is None and not xcv_missing:   # 缺失且（档位 ∉ 白名单 或 非旧档）→ 不降级、不进 conformance（含「被人删了」，与「历史没有」区分）
        print("M1_CONTRACT_ID_MISMATCH: 契约 %s 缺 x-contract-version 且 %s 不在历史白名单 %s，拒绝" % (cpath, a.contract, LEGACY_NO_XCV))
        return 3
    if xcv is not None and xcv != a.contract:   # 已声明 → 新旧档一律须 == 文件名版本（旧档码 ID_MISMATCH，新档码 RULE_INCONSISTENT）
        print(("M1_CONTRACT_ID_MISMATCH: 契约 " if legacy_id else "M1_CONTRACT_RULE_INCONSISTENT: ")
              + "%s 的 x-contract-version=%r 与文件名版本 %s 不一致，拒绝" % (cpath, xcv, a.contract))
        return 3
    sid = schema.get("$id")
    toks = re.split(r"[./#]", sid if isinstance(sid, str) else "")
    want = a.contract.split(".")
    if not legacy_id and not any(toks[i:i + len(want)] == want and (i + len(want) >= len(toks) or not toks[i + len(want)].isdigit())
               for i in range(len(toks) - len(want) + 1)):
        print("M1_CONTRACT_ID_MISMATCH: 契约 %s 的 $id=%r 未携带版本串 %s，拒绝" % (cpath, sid, a.contract))
        return 3
    xk = schema.get("x-row-key") if isinstance(schema.get("x-row-key"), dict) else None
    columns, unknown_prefix = None, "unknown:"
    if xk:
        nr = xk.get("normalized_row") if isinstance(xk.get("normalized_row"), dict) else {}
        excl = set(nr.get("exclude_columns") or []) | set(nr.get("declared_but_not_output_columns") or [])
        derived = [c for c, v in (schema.get("properties") or {}).items() if isinstance(v, dict) and c not in excl]
        derived += [c for c in nr.get("appended_columns") or [] if c not in excl]
        columns = list(nr.get("columns") or [])
        if not columns or derived != columns:
            print("M1_CONTRACT_RULE_INCONSISTENT: %s 的 x-row-key.normalized_row.columns 与契约文字派生列序不一致，拒绝" % cpath)
            return 3
        unknown_prefix = (xk.get("placeholder_row") or {}).get("unknown_prefix") or "unknown:"
    fam_raw = ((schema.get("properties") or {}).get(EV_FIELD) or {}).get("channel_family_patterns") or {}
    try:
        fam = {ch: re.compile(p) for ch, p in fam_raw.items()}
    except (re.error, TypeError) as exc:
        print("M1_CONTRACT_RULE_INCONSISTENT: %s 的 channel_family_patterns 编译失败（%s），拒绝" % (cpath, exc))
        return 3
    if not all(os.path.isfile(p) for p in (a.rows, a.baseline)):
        print("M1_READ_FAIL: 文件不存在 %s" % [p for p in (a.rows, a.baseline) if not os.path.isfile(p)][0])
        return 3
    out = a.json_out or os.path.join("/tmp", "m1-gate-%d.json" % os.getpid())
    rows_path, base_path, new_n, base_n, hits, by_channel = a.rows, a.baseline, None, None, set(), {}
    if a.new_only:
        try:
            rows_path, base_path, new_n, base_n, hits = _split_new_only(a.rows, a.baseline, a.scratch)
        except SystemExit as exc:
            print(str(exc))
            return 3
        except (json.JSONDecodeError, OSError) as exc:
            print("M1_READ_FAIL: 只判新行时读取失败 %s" % exc)
            return 3
        if rows_path is None:
            print("M1_NO_NEW_ROWS: 窗口内没有超出基线的记录（新行 0 / 基线 %d），拒绝出空跑绿" % base_n)
            return 3
    judge_ver = JUDGE_CONTRACT.get(a.contract, a.contract)
    cmd = [sys.executable, "-B", "tools/conformance.py", rows_path, "--contract-dir", a.contract_dir,
           "--contract", judge_ver, "--baseline", base_path, "--json", out]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode not in (0, 1, 2):
        print("M1_JUDGE_FAIL rc=%d\n%s\n%s" % (p.returncode, p.stdout[-800:], p.stderr[-800:]))
        return 3
    if not os.path.isfile(out):
        print("M1_JUDGE_FAIL: 判定器未产出 JSON，拒绝放行")
        return 3
    d = json.load(open(out, encoding="utf-8"))
    counts = d.get("rule_counts") or {}
    rules = d.get("rules") or {}
    hard = {k: v for k, v in counts.items() if k not in ADVISORY and k != "missing_field"}
    adv = {k: v for k, v in counts.items() if k in ADVISORY}
    mf_items = rules.get("missing_field") or []      # 身份三字段缺一律硬红，其余只告警
    mf_hard = [it for it in mf_items if it.get("field") in IDENTITY_FIELDS]
    mf_adv = len(mf_items) - len(mf_hard)
    if mf_hard:
        hard["missing_identity_field"] = len(mf_hard)
    if mf_adv:
        adv["missing_field"] = mf_adv
    # ②③ 闸门复算（只数本轮新行；存量一律豁免）：明细行键按契约口径逐行复算；占位/空标识显式再数一遍；族正则按契约 channel_family_patterns 逐行匹配。
    # 复算结果只对 RECHECK 档覆写进 hard（④）；旧档只作 row_key_recheck / fam_recheck 证据面展示，hard 沿用判定器原判。
    try:
        base_rids = {(json.loads(l) or {}).get("record_id") for l in open(a.baseline, encoding="utf-8") if l.strip()}
        checked = equal = key_bad = fam_bad = bad_ids = f_chk = f_ok = 0
        samples, fsamples = [], []
        for row in _load_rows(a.rows):
            ev, rid, ch = row.get(EV_FIELD), row.get("record_id"), row.get("来源渠道")
            frozen = (isinstance(ev, str) and ev in hits) or (isinstance(rid, str) and rid in base_rids)
            checked += 1
            if columns:   # ② 契约 x-row-key 口径
                got = _x_row_key(row, columns, unknown_prefix)
            else:         # v1.11 及以前：旧式 sha256(工作项键 + 事件类型 + 事件序号)
                got = hashlib.sha256((str(row.get("工作项键") or "") + str(row.get("事件类型") or "")
                                      + str(row.get("事件序号") or "")).encode("utf-8")).hexdigest()
            if got == row.get("明细行键"):
                equal += 1
            elif not frozen:
                key_bad += 1
                if len(samples) < 3:
                    samples.append({"来源事件标识": ev, "recomputed": got, "in_row": row.get("明细行键")})
            pat, f_chk = fam.get(ch), f_chk + 1
            fam_ok = isinstance(ev, str) and bool(ev.strip()) and pat is not None and pat.match(ev) is not None
            if fam_ok: f_ok += 1
            elif len(fsamples) < 3: fsamples.append({"来源渠道": ch, "来源事件标识": ev})
            if frozen:
                continue
            by_channel[ch] = by_channel.get(ch, 0) + 1
            if not fam_ok: fam_bad += 1
            bad_ids += not (isinstance(ev, str) and ev.strip()) or ev.strip().lower().startswith("unknown")   # 占位/空标识（非 str 时短路不会取 .strip）
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        print("M1_RECHECK_FAIL: 闸门复算失败 %s" % exc)
        return 3
    if recheck:   # ④ 覆写只对新档生效：row_key_bad / event_id_family 以闸门复算为准；旧档沿用判定器原判，不覆盖、不重算替换
        hard.pop("row_key_bad", None); hard.pop("event_id_family", None)
        hard.update({"row_key_bad": key_bad} if key_bad else {}); hard.update({"event_id_family": fam_bad} if fam_bad else {})
        if bad_ids:
            hard["unknown_event_id"] = max(bad_ids, int(hard.get("unknown_event_id") or 0))
    overridden = {r: g for r in sorted(set(counts) | set(hard) | set(adv)) if r != "missing_identity_field"   # ⑤ 判定器 − 闸门（missing_field 拆分总量不变）
                  and (g := counts.get(r, 0) - hard.get(r, 0) - adv.get(r, 0) - (hard.get("missing_identity_field", 0) if r == "missing_field" else 0))}
    if [r for r in overridden if not (recheck and r in OVERRIDE_WHITELIST)]:   # 白名单外（或旧档）规则 判定器≠闸门 → 不许 PASS
        print("M1_OVERRIDE_WHITELIST_BREACH: 判定器≠闸门 %s，含白名单 %s 之外或旧档规则，拒绝放行" % (overridden, OVERRIDE_WHITELIST)); return 3
    if recheck and not hard and (not checked or equal != checked or not f_chk or f_ok != f_chk):   # ⑥ 覆写欲放行须带替代证据（行键 checked=equal、族正则 checked=matched），缺证据即纯放宽，不许进件；硬红非空则照常出报告拦截
        print("M1_RECHECK_EVIDENCE_FAIL: row_key_recheck 相等 %d/%d、fam_recheck 匹配 %d/%d，覆写缺替代证据，拒绝放行" % (equal, checked, f_ok, f_chk)); return 3
    clash = [k for k in NEW_KEYS if k in REPORT_KEYS or k in (schema.get("x-value-map") or {}) or k in counts]   # ①③-a⑦-a 键名空间互斥
    if clash: print("M1_REPORT_KEY_CLASH: 新增报告键撞名 %s，拒绝出报告" % clash); return 3
    v_tot = sum(hard.values()) + sum(adv.values())   # ③ 覆写后重加总；恒等 judge_violations_total == v_tot + sum(overridden)
    print(json.dumps({
        "ok": not hard, "contract": a.contract, "judge_contract": judge_ver, "contract_file": cpath, "dedup_key": EV_FIELD,
        "row_key_rule": "x-row-key" if columns else "sha256(工作项键+事件类型+事件序号)", "rows_total": d.get("rows_total"),
        "new_rows": new_n if a.new_only else d.get("new_rows"), "history_hits": len(hits), "new_by_channel": by_channel,
        "mode": "new-only" if a.new_only else "full", "baseline_rows": base_n if a.new_only else d.get("history_rows"),
        "violations_total": v_tot, "history_rows": d.get("history_rows"),
        "row_key_recheck": {"checked": checked, "equal": equal, "mismatch": checked - equal, "samples": samples},
        "hard": hard, "advisory": adv, "json": out,
        "contract_id_legacy": legacy_id, "judge_violations_total": d.get("violations_total"), "overridden": overridden,
        "x-contract-version_missing": xcv_missing, "contract_id_basis": "filename+legacy $id" if xcv_missing else "x-contract-version",
        "fam_recheck": {"checked": f_chk, "matched": f_ok, "mismatch": f_chk - f_ok, "samples": fsamples},
        "pending": ["PENDING_CONFORMANCE_SAME_SOURCE"],
    }, ensure_ascii=False))
    if mf_hard:
        print("M1_BLOCK 明细: %s" % json.dumps(mf_hard[:5], ensure_ascii=False))
    if hard:
        print("M1_BLOCK: 硬红 %d 类 %s，禁止入表" % (len(hard), sorted(hard)))
        return 3
    print("M1_PASS: 硬红 0，告警 %d 类；判定器 %s 条 → 闸门 %d 条（覆写吸收 %s；挂账 1 项）——口径差被闸门吸收，非行完美"
          % (len(adv), d.get("violations_total"), v_tot, overridden))
    return 0


if __name__ == "__main__":
    sys.exit(main())
