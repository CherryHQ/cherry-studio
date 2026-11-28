# RUN（U2.3，纯本地；cwd = 本目录；详见 NOTE-r9.md）

```
python3 tests/u2_3_boundary.py after       # 9/9；指纹漂移/跨版本拒判两侧一致；内存契约已收口；追加写 evidence/u2.3-boundary.md
python3 tests/u1_adv31.py                  # 26/26（基线 state/uf-003/baseline-20261124T105021.ndjson，673 行）
export UF003_CONTRACT_DIR=$PWD/contract
python3 tests/u1_samples.py                # 103/103（含 r9 契约来源收口 68–72b）；写 state/uf-003/u1-samples.json，下一条要读它，故排在前
python3 tests/u1_v110_contract.py          # 21/21（受签 1188/1188；含 QQ 段跨版本拒判）
python3 tests/u1_selfcheck_guard.py        # PASS
python3 tests/u1_dump_guard.py             # PASS
# V1 自比：rc=0，673/673，violations_total=0
python3 tools/conformance.py state/uf-003/baseline-20261124T105021.ndjson --channel-map contract/channel-map.json --baseline state/uf-003/baseline-20261124T105021.ndjson --json state/uf-003/u23-selfcompare.json >/dev/null 2>&1; echo rc=$?
# r9 C 自证：v1.10 文件的 QQ 段换成 v1.9 的 → rc=3、stdout 空、stderr 单行「QQ 段版本不符」（目录由第一条的边界测试生成）
python3 tools/conformance.py state/uf-003/baseline-20261124T105021.ndjson --channel-map contract/channel-map.json --baseline '' --contract v1.10 --contract-dir state/uf-003/u23/xver-v1.10 >/dev/null 2>state/uf-003/u23/xver-v1.10.err; echo rc=$?; wc -l < state/uf-003/u23/xver-v1.10.err
```

注入自证（两种都必须 rc=1 / 8/9；未登记取值直接 REFUSE）：`UF003_U23_INJECT=field|value python3 tests/u2_3_boundary.py after`
