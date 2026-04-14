#!/usr/bin/env python3
"""
refresh_snapshot.py — Daily GitHub snapshot builder for Cherry Studio.

Reads from /tmp/gh_*.json files (written by `gh` CLI or MCP tool output) and
produces .context/latest_snapshot_summary.json.

Usage:
    python3 scripts/refresh_snapshot.py
"""

import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

CONTEXT_DIR = Path(__file__).parent.parent / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

NOW = datetime.now(timezone.utc)
CUTOFF_30D = NOW - timedelta(days=30)
CUTOFF_7D = NOW - timedelta(days=7)


def load_json(path: str) -> dict | list | None:
    p = Path(path)
    if not p.exists():
        print(f"[WARN] {path} not found, skipping.", file=sys.stderr)
        return None
    with open(p) as f:
        return json.load(f)


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def label_names(raw: list) -> list[str]:
    return [l["name"] if isinstance(l, dict) else l for l in raw]


def analyze_issues(issues: list) -> dict:
    health = {"Active": 0, "Aging": 0, "Stale": 0, "Zombie": 0}
    label_counts: dict[str, int] = {}
    unlabeled = 0

    for iss in issues:
        labels = label_names(iss.get("labels", []))
        created = parse_dt(iss["createdAt"] if "createdAt" in iss else iss["created_at"])
        age_days = (NOW - created).days

        if age_days <= 7:
            health["Active"] += 1
        elif age_days <= 30:
            health["Aging"] += 1
        elif age_days <= 90:
            health["Stale"] += 1
        else:
            health["Zombie"] += 1

        for lb in labels:
            label_counts[lb] = label_counts.get(lb, 0) + 1
        if not labels:
            unlabeled += 1

    return {
        "health": health,
        "label_counts": dict(sorted(label_counts.items(), key=lambda x: -x[1])[:30]),
        "unlabeled": unlabeled,
        "total": len(issues),
    }


def analyze_prs(prs: list) -> dict:
    v2_open = [p for p in prs if p.get("baseRefName", p.get("base", {}).get("ref", "")) == "v2"]
    draft = [p for p in prs if p.get("isDraft", p.get("draft", False))]
    stale = []
    for p in prs:
        created = parse_dt(p.get("createdAt", p.get("created_at", NOW.isoformat())))
        if (NOW - created).days > 30:
            stale.append(p["number"])
    return {
        "total": len(prs),
        "v2_count": len(v2_open),
        "draft_count": len(draft),
        "stale_over_30d": len(stale),
    }


def analyze_v2_merged(prs: list) -> dict:
    merged = []
    for p in prs:
        merged_at = p.get("mergedAt", p.get("merged_at"))
        if merged_at and parse_dt(merged_at) >= CUTOFF_30D:
            merged.append({
                "number": p["number"],
                "title": p["title"][:80],
                "merged_at": merged_at[:10],
                "author": p.get("author", {}).get("login", p.get("user", {}).get("login", "?")),
            })
    return {
        "merged_30d_count": len(merged),
        "top_merges": merged[:20],
    }


def main() -> None:
    open_issues_raw = load_json("/tmp/gh_open_issues.json") or []
    closed_issues_raw = load_json("/tmp/gh_closed_issues_30d.json") or []
    open_prs_raw = load_json("/tmp/gh_open_prs.json") or []
    closed_prs_raw = load_json("/tmp/gh_closed_prs_30d.json") or []
    v2_merged_raw = load_json("/tmp/v2_merged_prs.json") or []
    v2_open_raw = load_json("/tmp/v2_open_prs.json") or []

    issue_stats = analyze_issues(open_issues_raw)
    open_pr_stats = analyze_prs(open_prs_raw)
    v2_merged_stats = analyze_v2_merged(v2_merged_raw)

    snapshot = {
        "generated_at": NOW.isoformat(),
        "date": NOW.strftime("%Y-%m-%d"),
        "source": "GitHub CLI / MCP (cherryhq/cherry-studio)",
        "issues": {
            "open_total": len(open_issues_raw),
            "closed_last_30d": len(closed_issues_raw),
            "unlabeled_pct": f"{issue_stats['unlabeled'] / max(issue_stats['total'], 1) * 100:.1f}%",
            "label_distribution": issue_stats["label_counts"],
            "health_distribution": issue_stats["health"],
        },
        "pull_requests": {
            "open_total": open_pr_stats["total"],
            "open_v2": len(v2_open_raw),
            "open_v2_draft": sum(1 for p in v2_open_raw if p.get("isDraft", p.get("draft", False))),
            "stale_prs_over_30d": open_pr_stats["stale_over_30d"],
            "merged_to_v2_last_30d": v2_merged_stats["merged_30d_count"],
        },
        "v2_branch": {
            "merged_30d_count": v2_merged_stats["merged_30d_count"],
            "top_recent_merges": v2_merged_stats["top_merges"],
        },
    }

    out = CONTEXT_DIR / "latest_snapshot_summary.json"
    out.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))
    print(f"[OK] Written: {out}")
    print(f"     Open Issues: {snapshot['issues']['open_total']}")
    print(f"     Closed 30d:  {snapshot['issues']['closed_last_30d']}")
    print(f"     Open PRs:    {snapshot['pull_requests']['open_total']}")
    print(f"     v2 merged:   {snapshot['v2_branch']['merged_30d_count']}")


if __name__ == "__main__":
    main()
