#!/usr/bin/env python3
"""
Daily snapshot refresh script.
Reads pre-fetched GitHub data from /tmp/gh_*.json files and writes
.context/latest_snapshot_summary.json and .context/issue_health_report.json.

Usage:
  # First fetch data with gh CLI:
  gh issue list -R CherryHQ/cherry-studio --state open --limit 1000 \
    --json number,title,state,labels,createdAt,updatedAt,author,comments \
    > /tmp/gh_open_issues.json
  gh pr list -R CherryHQ/cherry-studio --state open --limit 500 \
    --json number,title,state,labels,createdAt,updatedAt,mergedAt,author,base \
    > /tmp/gh_open_prs.json
  # Then:
  python3 scripts/refresh_snapshot.py
"""
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
CONTEXT_DIR = ROOT / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

now = datetime.now(timezone.utc)
cutoff_14d = now - timedelta(days=14)
cutoff_30d = now - timedelta(days=30)
cutoff_90d = now - timedelta(days=90)


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def load_gh_json(path):
    """Load a gh CLI JSON output file. Handles both array and object forms."""
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    for key in ("issues", "items", "nodes", "data", "results"):
        if key in data and isinstance(data[key], list):
            return data[key]
    return []


def get_label_names(issue):
    return [
        lbl.get("name", "") if isinstance(lbl, dict) else str(lbl)
        for lbl in issue.get("labels", [])
    ]


def compute_snapshot(issues, prs, closed_issues_total, closed_prs_total, v2_merged_30d):
    label_counts = {}
    no_label = 0
    for iss in issues:
        lbls = get_label_names(iss)
        if not lbls:
            no_label += 1
        for lbl in lbls:
            label_counts[lbl] = label_counts.get(lbl, 0) + 1

    top_labels = [
        {"label": lbl, "count": c}
        for lbl, c in sorted(label_counts.items(), key=lambda x: -x[1])[:20]
    ]
    unlabeled_pct = round(no_label / max(len(issues), 1) * 100, 1)

    p1_set = {"P1", "p1", "P0", "p0", "critical", "Critical", "urgent", "Urgent"}
    p1_issues = [
        {
            "number": iss["number"],
            "title": iss["title"],
            "labels": get_label_names(iss),
            "url": iss.get("html_url", f"https://github.com/CherryHQ/cherry-studio/issues/{iss['number']}"),
        }
        for iss in issues
        if set(get_label_names(iss)) & p1_set
    ]

    pr_by_base = {}
    for pr in prs:
        base = pr.get("base", {})
        ref = base.get("ref", "") if isinstance(base, dict) else str(base)
        pr_by_base[ref] = pr_by_base.get(ref, 0) + 1

    def comments_count(x):
        c = x.get("comments", 0)
        return c if isinstance(c, int) else 0

    top_comments = sorted(issues, key=comments_count, reverse=True)[:10]

    return {
        "generated_at": now.isoformat(),
        "open_issues": {"count": len(issues), "total_in_repo": None},
        "open_prs": {"count": len(prs), "by_base": pr_by_base},
        "closed_issues_30d": closed_issues_total,
        "closed_prs_30d": closed_prs_total,
        "label_distribution": top_labels,
        "unlabeled_pct": unlabeled_pct,
        "p1_issues": p1_issues,
        "v2_prs": {"open": pr_by_base.get("v2", 0), "merged_30d": v2_merged_30d},
        "top_issues_by_comments": [
            {
                "number": i["number"],
                "title": i["title"],
                "comments": comments_count(i),
                "url": i.get("html_url", f"https://github.com/CherryHQ/cherry-studio/issues/{i['number']}"),
            }
            for i in top_comments
        ],
    }


def compute_health(issues):
    active = aging = stale = zombie = 0
    unlabeled = []

    for iss in issues:
        updated = parse_dt(iss.get("updated_at") or iss.get("updatedAt"))
        created = parse_dt(iss.get("created_at") or iss.get("createdAt"))
        if not updated:
            stale += 1
        elif updated > cutoff_14d:
            active += 1
        elif updated > cutoff_30d:
            aging += 1
        elif created and created < cutoff_90d:
            zombie += 1
        else:
            stale += 1

        if not get_label_names(iss):
            unlabeled.append(
                {
                    "number": iss["number"],
                    "title": iss["title"],
                    "created_at": iss.get("created_at") or iss.get("createdAt"),
                }
            )

    total = max(len(issues), 1)
    p1_set = {"P1", "p1", "P0", "p0", "critical", "Critical", "urgent", "Urgent"}
    p1_issues = [
        {
            "number": i["number"],
            "title": i["title"],
            "labels": get_label_names(i),
            "url": i.get("html_url", f"https://github.com/CherryHQ/cherry-studio/issues/{i['number']}"),
        }
        for i in issues
        if set(get_label_names(i)) & p1_set
    ]

    def comments_count(x):
        c = x.get("comments", 0)
        return c if isinstance(c, int) else 0

    high_comment = sorted(issues, key=comments_count, reverse=True)[:10]

    return {
        "generated_at": now.isoformat(),
        "health_buckets": {
            "Active": {"count": active, "pct": round(active / total * 100, 1)},
            "Aging": {"count": aging, "pct": round(aging / total * 100, 1)},
            "Stale": {"count": stale, "pct": round(stale / total * 100, 1)},
            "Zombie": {"count": zombie, "pct": round(zombie / total * 100, 1)},
        },
        "p1_issues": p1_issues,
        "high_comment_issues": [
            {"number": i["number"], "title": i["title"], "comments": comments_count(i)}
            for i in high_comment
        ],
        "unlabeled_issues": unlabeled[:20],
    }


def main():
    issues_path = "/tmp/gh_open_issues.json"
    prs_path = "/tmp/gh_open_prs.json"
    closed_issues_path = "/tmp/gh_closed_issues_30d.json"
    closed_prs_path = "/tmp/gh_closed_prs_30d.json"
    v2_merged_path = "/tmp/v2_merged_prs.json"

    issues = load_gh_json(issues_path) if os.path.exists(issues_path) else []
    prs = load_gh_json(prs_path) if os.path.exists(prs_path) else []
    closed_issues = load_gh_json(closed_issues_path) if os.path.exists(closed_issues_path) else []
    closed_prs = load_gh_json(closed_prs_path) if os.path.exists(closed_prs_path) else []
    v2_merged = load_gh_json(v2_merged_path) if os.path.exists(v2_merged_path) else []

    print(f"Loaded: {len(issues)} open issues, {len(prs)} open PRs, "
          f"{len(closed_issues)} closed issues (30d), {len(closed_prs)} closed PRs (30d), "
          f"{len(v2_merged)} v2 merged PRs")

    snapshot = compute_snapshot(issues, prs, len(closed_issues), len(closed_prs), len(v2_merged))
    health = compute_health(issues)

    out1 = CONTEXT_DIR / "latest_snapshot_summary.json"
    out2 = CONTEXT_DIR / "issue_health_report.json"

    with open(out1, "w") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
    with open(out2, "w") as f:
        json.dump(health, f, indent=2, ensure_ascii=False)

    print(f"Written: {out1}")
    print(f"Written: {out2}")
    print(f"Open issues: {len(issues)}, Open PRs: {len(prs)}")
    print(f"Closed issues (30d): {len(closed_issues)}, Closed PRs (30d): {len(closed_prs)}")
    print(f"V2 merged PRs (30d): {len(v2_merged)}")
    print(f"Unlabeled: {snapshot['unlabeled_pct']}%")
    print(f"P1 issues: {len(snapshot['p1_issues'])}")


if __name__ == "__main__":
    main()
