#!/usr/bin/env python3
"""
Refresh the latest snapshot summary from GitHub data files.
Input:  /tmp/gh_open_issues.json, /tmp/gh_closed_issues_30d.json,
        /tmp/gh_open_prs.json,    /tmp/gh_closed_prs_30d.json
Output: .context/latest_snapshot_summary.json
"""

import json
import os
from datetime import datetime, timezone, timedelta
from collections import Counter
from pathlib import Path

TODAY = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
CONTEXT_DIR = Path(__file__).parent.parent / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)


def load(path: str) -> list | dict:
    with open(path) as f:
        return json.load(f)


def age_bucket(updated_at: str) -> str:
    dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    days = (TODAY - dt).days
    if days < 7:
        return "active"
    elif days < 30:
        return "aging"
    elif days < 90:
        return "stale"
    return "zombie"


def extract_labels(issue: dict) -> list[str]:
    labels = issue.get("labels", [])
    if isinstance(labels, list) and labels and isinstance(labels[0], dict):
        return [lb["name"] for lb in labels]
    return [lb for lb in labels if isinstance(lb, str)]


def analyze_issues(issues: list) -> dict:
    label_dist: Counter = Counter()
    age_dist: Counter = Counter()
    unclassified = 0
    p1 = []
    bug_count = 0

    for issue in issues:
        labels = extract_labels(issue)
        if not labels:
            unclassified += 1
        for lb in labels:
            label_dist[lb] += 1
        bucket = age_bucket(issue.get("updatedAt", issue.get("updated_at", TODAY.isoformat())))
        age_dist[bucket] += 1
        if "P1" in labels:
            p1.append({"number": issue["number"], "title": issue["title"],
                       "labels": labels, "updatedAt": issue.get("updatedAt", "")})
        if any(lb.upper() in ("BUG", "P1") for lb in labels):
            bug_count += 1

    return {
        "label_distribution": dict(label_dist.most_common(20)),
        "age_buckets": dict(age_dist),
        "unclassified_count": unclassified,
        "unclassified_pct": f"{unclassified / max(len(issues), 1) * 100:.1f}%",
        "p1_issues": p1,
        "bug_count": bug_count,
    }


def analyze_prs(prs: list) -> dict:
    base_dist: Counter = Counter()
    label_dist: Counter = Counter()
    merged_7d = merged_30d = 0
    cutoff_7d = TODAY - timedelta(days=7)
    cutoff_30d = TODAY - timedelta(days=30)

    for pr in prs:
        base_dist[pr.get("baseRefName", pr.get("base", {}).get("ref", "unknown"))] += 1
        for lb in extract_labels(pr):
            label_dist[lb] += 1
        merged_at = pr.get("mergedAt") or pr.get("merged_at")
        if merged_at:
            dt = datetime.fromisoformat(merged_at.replace("Z", "+00:00"))
            if dt >= cutoff_7d:
                merged_7d += 1
            if dt >= cutoff_30d:
                merged_30d += 1

    return {
        "base_branch_distribution": dict(base_dist),
        "label_distribution": dict(label_dist.most_common(15)),
        "merged_last_7d": merged_7d,
        "merged_last_30d": merged_30d,
    }


def main():
    open_issues = load("/tmp/gh_open_issues.json")
    closed_issues = load("/tmp/gh_closed_issues_30d.json")
    open_prs = load("/tmp/gh_open_prs.json")
    closed_prs = load("/tmp/gh_closed_prs_30d.json")

    issue_analysis = analyze_issues(open_issues)
    closed_analysis = analyze_issues(closed_issues)
    pr_open_analysis = analyze_prs(open_prs)
    pr_closed_analysis = analyze_prs(closed_prs)

    # Top commented
    top_commented = sorted(open_issues, key=lambda x: x.get("comments", 0), reverse=True)[:10]

    snapshot = {
        "generated_at": TODAY.isoformat(),
        "open_issues": {
            "total": len(open_issues),
            **issue_analysis,
            "top_commented": [
                {"number": i["number"], "title": i["title"], "comments": i.get("comments", 0)}
                for i in top_commented
            ],
        },
        "closed_issues_30d": {
            "total": len(closed_issues),
            "label_distribution": closed_analysis["label_distribution"],
        },
        "open_prs": {
            "total": len(open_prs),
            **pr_open_analysis,
        },
        "merged_prs_30d": {
            "total": pr_closed_analysis["merged_last_30d"],
            "last_7d": pr_closed_analysis["merged_last_7d"],
        },
    }

    out = CONTEXT_DIR / "latest_snapshot_summary.json"
    out.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
