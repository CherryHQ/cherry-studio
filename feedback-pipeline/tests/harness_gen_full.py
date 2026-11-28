#!/usr/bin/env python3
"""真源全量生成 harness：先断言「载入的是被审候选」，再跑生成。

背景（2026-11-27 实测）：tools/window_to_rows.py 里 `import uf003_identity` 按 sys.path 解析，
可能载到生产件而不是候选件；载错件时同一 run 目录会得到不同的 rc（实测 3 vs 0），
事后无法从输出分辨「rc=0 测的是候选还是生产件」。故把「载入对象」变成程序断言，不靠人调 PYTHONPATH。

用法：
    python3 -B tests/harness_gen_full.py \
        --identity candidates/uf003-wecom-RID-key-20261127/uf003_identity.fix1.py \
        --run ~/HermesRuntime/cache/user-feedback/scratch/m1-runwin-1127T0800 \
        --out cache/scratch/gen-verified.ndjson

输出：最后一行 JSON 含 rc / loaded_module_path / loaded_module_sha256 / expected_sha256 / rows / by_channel / used_bytes_sha256。
退出码：0 正常；3 = HARNESS_WRONG_MODULE（载入对象不符，不生成行）；其余透传生成器 rc。
"""
import argparse
import hashlib
import json
import os
import runpy
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sha256_file(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--identity", required=True, help="期望被载入的候选 identity 文件")
    ap.add_argument("--run", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--expect-sha", default=None, help="可选：额外断言候选 sha（正控用）")
    a = ap.parse_args()

    cand = os.path.abspath(a.identity)
    if not os.path.exists(cand):
        print(json.dumps({"rc": 3, "reason": "HARNESS_CANDIDATE_MISSING", "path": cand}, ensure_ascii=False))
        return 3
    want = a.expect_sha or sha256_file(cand)
    cand_dir = os.path.dirname(cand)
    # 候选目录优先；同时把仓库根放进 path 供 tools/ 内部依赖解析
    sys.path[:0] = [cand_dir, REPO, os.path.join(REPO, "tools")]
    # 同名文件必须就叫 uf003_identity.py 才能被 import；否则复制到临时目录
    import tempfile
    probe_dir = tempfile.mkdtemp(prefix="harness-mod-")
    target = os.path.join(probe_dir, "uf003_identity.py")
    with open(cand, "rb") as src, open(target, "wb") as dst:
        dst.write(src.read())
    sys.path[:0] = [probe_dir]

    import uf003_identity as U  # noqa: E402
    got_path = os.path.abspath(U.__file__)
    got_sha = sha256_file(got_path)
    in_candidate = os.path.dirname(got_path) == probe_dir
    result = {
        "loaded_module_path": got_path,
        "loaded_module_sha256": got_sha,
        "expected_sha256": want,
        "candidate_path": cand,
    }
    if not (in_candidate and got_sha == want):
        result.update(rc=3, reason="HARNESS_WRONG_MODULE",
                      detail="载入的不是期望候选件：path_in_candidate_dir=%s sha_match=%s"
                             % (in_candidate, got_sha == want))
        print(json.dumps(result, ensure_ascii=False))
        return 3

    env_keys = {"UF003_CONTRACT_DIR": os.path.join(REPO, "cache", "contract-view"),
                "UF003_CONTRACT_VERSION": "v1.11"}
    for k, v in env_keys.items():
        os.environ.setdefault(k, v)

    sys.argv = ["window_to_rows.py", "--run", a.run, "--out", a.out]
    rc = 0
    try:
        runpy.run_path(os.path.join(REPO, "tools", "window_to_rows.py"), run_name="__main__")
    except SystemExit as exc:
        rc = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 3)

    result["rc"] = rc
    out_abs = os.path.abspath(a.out)
    if os.path.exists(out_abs):
        rows = [json.loads(l) for l in open(out_abs, encoding="utf-8") if l.strip()]
        by = {}
        for r in rows:
            by[r.get("来源渠道")] = by.get(r.get("来源渠道"), 0) + 1
        result.update(rows=len(rows), by_channel=by)
    print(json.dumps(result, ensure_ascii=False))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
