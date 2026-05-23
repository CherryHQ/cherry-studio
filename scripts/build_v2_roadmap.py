#!/usr/bin/env python3
"""
build_v2_roadmap.py — Cherry Studio V2 Roadmap Builder
Reads /tmp/v2_merged_prs.json and /tmp/v2_open_prs.json and writes
.context/v2_roadmap_detailed.json

Usage:
    python3 scripts/build_v2_roadmap.py
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict
import re

CONTEXT_DIR = Path(__file__).parent.parent / ".context"
TODAY = datetime.now(tz=timezone.utc)
MERGED_PATH = "/tmp/v2_merged_prs.json"
OPEN_PATH = "/tmp/v2_open_prs.json"


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def classify_pr_type(title: str) -> str:
    """Infer PR type from conventional commit title prefix."""
    title_lower = title.lower().strip()
    for prefix in ("refactor", "feat", "fix", "chore", "docs", "test", "style", "perf", "ci", "build"):
        if title_lower.startswith(prefix):
            return prefix
    return "uncategorized"


def week_label(dt: datetime) -> str:
    return dt.strftime("W%W_%b%d")


def main():
    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)

    merged_prs = []
    open_prs = []

    if os.path.exists(MERGED_PATH):
        merged_prs = json.loads(open(MERGED_PATH).read())
    else:
        print(f"⚠️  {MERGED_PATH} not found — merged PR stats will be empty.", file=sys.stderr)

    if os.path.exists(OPEN_PATH):
        open_prs = json.loads(open(OPEN_PATH).read())
    else:
        print(f"⚠️  {OPEN_PATH} not found — open PR list will be empty.", file=sys.stderr)

    # Analyze merged PRs
    by_category: dict[str, int] = defaultdict(int)
    by_author: dict[str, int] = defaultdict(int)
    by_week: dict[str, int] = defaultdict(int)
    recently_merged = []

    for pr in merged_prs:
        title = pr.get("title", "")
        merged_at = parse_dt(pr.get("mergedAt"))
        author = (pr.get("author") or {}).get("login", "unknown")

        pr_type = classify_pr_type(title)
        by_category[pr_type] += 1
        by_author[author] += 1

        if merged_at:
            by_week[week_label(merged_at)] += 1

        recently_merged.append({
            "number": pr.get("number"),
            "title": title,
            "type": pr_type,
            "author": author,
            "mergedAt": pr.get("mergedAt"),
            "labels": [(lb["name"] if isinstance(lb, dict) else lb) for lb in pr.get("labels", [])],
        })

    recently_merged.sort(key=lambda x: x.get("mergedAt") or "", reverse=True)

    total_merged = len(merged_prs)
    top_contributors = sorted(by_author.items(), key=lambda x: -x[1])

    # Analyze open v2 PRs
    long_running = []
    active_open = []

    for pr in open_prs:
        created_at = parse_dt(pr.get("createdAt"))
        age_days = (TODAY - created_at).days if created_at else 0
        author = (pr.get("author") or {}).get("login", "unknown")

        entry = {
            "number": pr.get("number"),
            "title": pr.get("title", ""),
            "author": author,
            "created": pr.get("createdAt"),
            "age_days": age_days,
            "labels": [(lb["name"] if isinstance(lb, dict) else lb) for lb in pr.get("labels", [])],
        }

        if age_days >= 30:
            long_running.append(entry)
        else:
            active_open.append(entry)

    long_running.sort(key=lambda x: -x["age_days"])
    active_open.sort(key=lambda x: x.get("created") or "", reverse=True)

    roadmap = {
        "generated_at": TODAY.isoformat(),
        "snapshot_date": TODAY.strftime("%Y-%m-%d"),
        "v2_branch_status": "ACTIVE",
        "merged_30d": {
            "total": total_merged,
            "by_category": {
                k: {"count": v, "pct": round(v / total_merged * 100, 1) if total_merged else 0}
                for k, v in sorted(by_category.items(), key=lambda x: -x[1])
            },
            "by_week": dict(by_week),
            "top_contributors": [{"author": a, "count": c} for a, c in top_contributors[:10]],
            "recently_merged_20": recently_merged[:20],
        },
        "open_v2_prs": {
            "total": len(open_prs),
            "long_running_30d_plus": long_running,
            "active_recent": active_open[:15],
        },
    }

    out_path = CONTEXT_DIR / "v2_roadmap_detailed.json"
    with open(out_path, "w") as f:
        json.dump(roadmap, f, indent=2, ensure_ascii=False)

    print(f"✅ V2 roadmap written to {out_path}")
    print(f"   Merged (30d): {total_merged} | Open: {len(open_prs)} | Long-running: {len(long_running)}")
    print(f"   Category breakdown:")
    for cat, count in sorted(by_category.items(), key=lambda x: -x[1]):
        pct = round(count / total_merged * 100, 1) if total_merged else 0
        print(f"     {cat}: {count} ({pct}%)")
    print(f"   Top contributor: {top_contributors[0][0]} ({top_contributors[0][1]} PRs)" if top_contributors else "")


if __name__ == "__main__":
    main()
