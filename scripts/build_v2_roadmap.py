#!/usr/bin/env python3
"""
build_v2_roadmap.py — Builds .context/v2_roadmap_detailed.json from
v2-branch PR data, grouping by label/area and tracking merge velocity.
"""
import json
import os
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict

TODAY = datetime.now(timezone.utc).date().isoformat()
CONTEXT_DIR = os.path.join(os.path.dirname(__file__), "..", ".context")
os.makedirs(CONTEXT_DIR, exist_ok=True)


def load_json(path):
    try:
        with open(path) as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except Exception:
        return []


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def label_names(pr):
    return [lb["name"] for lb in pr.get("labels", [])]


def categorize_pr(pr):
    """Assign a work area from PR labels or title keywords."""
    labels = [l.lower() for l in label_names(pr)]
    title = pr.get("title", "").lower()

    area_map = [
        (["feat", "feature"], "feature"),
        (["fix", "bug"], "bugfix"),
        (["refactor", "refactoring"], "refactor"),
        (["docs", "documentation"], "docs"),
        (["test", "tests"], "tests"),
        (["ci", "workflow", "github-actions"], "ci/cd"),
        (["i18n", "translation", "locale"], "i18n"),
        (["deps", "dependencies", "chore"], "chore"),
        (["perf", "performance"], "perf"),
        (["ui", "ux", "style"], "ui/ux"),
    ]
    for keywords, area in area_map:
        if any(kw in l for l in labels for kw in keywords):
            return area
        if any(kw in title for kw in keywords):
            return area
    return "other"


def velocity_by_week(prs, weeks=8):
    """Count merges per calendar week for last N weeks."""
    now = datetime.now(timezone.utc)
    weekly = defaultdict(int)
    for pr in prs:
        merged_at = parse_dt(pr.get("merged_at"))
        if not merged_at:
            continue
        diff = (now - merged_at).days
        if diff < weeks * 7:
            week_num = diff // 7
            label = f"W-{week_num}" if week_num > 0 else "This week"
            weekly[label] += 1
    return dict(sorted(weekly.items()))


def main():
    v2_closed = load_json("/tmp/gh_v2_closed_prs.json")
    v2_open = load_json("/tmp/gh_v2_open_prs.json")

    now = datetime.now(timezone.utc)
    cutoff_30 = now - timedelta(days=30)
    cutoff_7 = now - timedelta(days=7)

    # Merged PRs
    merged = [pr for pr in v2_closed if pr.get("merged_at")]
    merged_30d = [pr for pr in merged if (parse_dt(pr.get("merged_at")) or now) >= cutoff_30]
    merged_7d = [pr for pr in merged if (parse_dt(pr.get("merged_at")) or now) >= cutoff_7]

    # Area breakdown for merged
    area_counter = Counter(categorize_pr(pr) for pr in merged)
    area_counter_30d = Counter(categorize_pr(pr) for pr in merged_30d)

    # Open PR details
    open_pr_list = [
        {
            "number": pr["number"],
            "title": pr["title"],
            "author": (pr.get("user") or {}).get("login", ""),
            "labels": label_names(pr),
            "area": categorize_pr(pr),
            "created_at": pr.get("created_at"),
            "url": pr.get("html_url", ""),
            "age_days": (now - (parse_dt(pr.get("created_at")) or now)).days,
        }
        for pr in v2_open
    ]
    open_pr_list.sort(key=lambda x: x["age_days"], reverse=True)

    # Recent merged (last 30d)
    recent_merged = [
        {
            "number": pr["number"],
            "title": pr["title"],
            "author": (pr.get("user") or {}).get("login", ""),
            "labels": label_names(pr),
            "area": categorize_pr(pr),
            "merged_at": pr.get("merged_at"),
        }
        for pr in sorted(merged_30d, key=lambda x: x.get("merged_at", ""), reverse=True)
    ]

    roadmap = {
        "generated_at": now.isoformat(),
        "date": TODAY,
        "v2_branch_summary": {
            "total_merged_prs": len(merged),
            "merged_last_30d": len(merged_30d),
            "merged_last_7d": len(merged_7d),
            "open_prs": len(v2_open),
        },
        "area_breakdown_all_time": dict(area_counter.most_common()),
        "area_breakdown_30d": dict(area_counter_30d.most_common()),
        "weekly_merge_velocity": velocity_by_week(merged, weeks=8),
        "open_prs": open_pr_list,
        "recent_merged_30d": recent_merged[:50],
        "top_v2_contributors": dict(
            Counter(
                (pr.get("user") or {}).get("login", "unknown") for pr in merged
            ).most_common(10)
        ),
    }

    out_path = os.path.join(CONTEXT_DIR, "v2_roadmap_detailed.json")
    with open(out_path, "w") as f:
        json.dump(roadmap, f, indent=2, ensure_ascii=False)

    s = roadmap["v2_branch_summary"]
    print(f"[build_v2_roadmap] Written to {out_path}")
    print(f"  Total merged: {s['total_merged_prs']}, last 30d: {s['merged_last_30d']}, last 7d: {s['merged_last_7d']}, open: {s['open_prs']}")


if __name__ == "__main__":
    main()
