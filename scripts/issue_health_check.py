#!/usr/bin/env python3
"""
issue_health_check.py — Cherry Studio Issue Health Report Generator
Reads /tmp/gh_open_issues.json and writes .context/issue_health_report.json

Usage:
    python3 scripts/issue_health_check.py
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

CONTEXT_DIR = Path(__file__).parent.parent / ".context"
TODAY = datetime.now(tz=timezone.utc)
ISSUES_PATH = "/tmp/gh_open_issues.json"

CUTOFF_7D = TODAY - timedelta(days=7)
CUTOFF_30D = TODAY - timedelta(days=30)
CUTOFF_90D = TODAY - timedelta(days=90)

P1_LABELS = {"p1", "critical", "urgent", "high-priority", "severity: critical"}
BUG_LABELS = {"bug", "BUG", "type: bug"}
FEATURE_LABELS = {"feature", "enhancement", "type: feature", "type: enhancement"}
ACTION_LABELS = {"needs-repro", "needs-more-info", "help wanted"}


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def get_labels(issue: dict) -> list[str]:
    labels = issue.get("labels", [])
    return [(lb["name"] if isinstance(lb, dict) else lb) for lb in labels]


def classify_age(updated_at: str | None) -> str:
    dt = parse_dt(updated_at)
    if dt is None:
        return "unknown"
    if dt >= CUTOFF_7D:
        return "Active"
    if dt >= CUTOFF_30D:
        return "Aging"
    if dt >= CUTOFF_90D:
        return "Stale"
    return "Zombie"


def health_score(stats: dict) -> int:
    """Compute a 0-100 health score based on issue metrics."""
    score = 100

    # Penalize for high unlabeled ratio
    unlabeled_pct = stats.get("unlabeled_pct", 0)
    if unlabeled_pct > 20:
        score -= 20
    elif unlabeled_pct > 10:
        score -= 10
    elif unlabeled_pct > 5:
        score -= 5

    # Penalize for zombie issues
    zombie_count = stats.get("zombie_count", 0)
    total = stats.get("total", 1)
    zombie_pct = zombie_count / total * 100
    if zombie_pct > 30:
        score -= 20
    elif zombie_pct > 15:
        score -= 10
    elif zombie_pct > 5:
        score -= 5

    # Penalize for large backlog
    if total > 1000:
        score -= 15
    elif total > 500:
        score -= 8
    elif total > 200:
        score -= 3

    return max(0, min(100, score))


def main():
    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)

    if not os.path.exists(ISSUES_PATH):
        print(f"ERROR: {ISSUES_PATH} not found.", file=sys.stderr)
        sys.exit(1)

    issues = json.loads(open(ISSUES_PATH).read())

    label_counts: dict[str, int] = defaultdict(int)
    age_counts = {"Active": 0, "Aging": 0, "Stale": 0, "Zombie": 0}
    unlabeled = []
    p1_issues = []
    inferred_high_priority = []
    action_needed = []

    comment_threshold = 3  # issues with >= 3 comments get priority consideration

    for issue in issues:
        labels = get_labels(issue)
        label_set = {lb.lower() for lb in labels}
        num = issue.get("number")
        title = issue.get("title", "")
        updated = issue.get("updatedAt")
        comments = issue.get("comments", 0)
        if isinstance(comments, dict):
            comments = comments.get("totalCount", 0)

        for lbl in labels:
            label_counts[lbl] += 1

        if not labels:
            unlabeled.append({"number": num, "title": title, "updatedAt": updated})

        # P1 detection
        if label_set & P1_LABELS:
            p1_issues.append({
                "number": num,
                "title": title,
                "labels": labels,
                "priority_signal": "explicit P1 label",
            })
        elif comments >= comment_threshold and (label_set & BUG_LABELS):
            inferred_high_priority.append({
                "number": num,
                "title": title,
                "labels": labels,
                "comments": comments,
                "priority_signal": f"BUG label + {comments} comments",
            })

        # Action needed
        if label_set & {lb.lower() for lb in ACTION_LABELS}:
            action_needed.append({"number": num, "title": title, "labels": labels})

        age = classify_age(updated)
        if age in age_counts:
            age_counts[age] += 1

    total = len(issues)
    stats = {
        "total": total,
        "unlabeled_pct": round(len(unlabeled) / total * 100, 1) if total else 0,
        "zombie_count": age_counts["Zombie"],
    }
    score = health_score(stats)
    grade = (
        "A" if score >= 90 else
        "B" if score >= 80 else
        "C+" if score >= 70 else
        "C" if score >= 60 else
        "D" if score >= 50 else "F"
    )

    report = {
        "generated_at": TODAY.isoformat(),
        "snapshot_date": TODAY.strftime("%Y-%m-%d"),
        "health_score": score,
        "health_grade": grade,
        "total_open_issues": total,
        "age_distribution": age_counts,
        "label_health": {
            "unlabeled_count": len(unlabeled),
            "unlabeled_pct": stats["unlabeled_pct"],
            "top_labels": dict(sorted(label_counts.items(), key=lambda x: -x[1])[:20]),
        },
        "p1_critical_issues": p1_issues,
        "inferred_high_priority": sorted(inferred_high_priority, key=lambda x: -x["comments"])[:10],
        "action_needed_issues": action_needed[:20],
        "unlabeled_sample": unlabeled[:20],
    }

    out_path = CONTEXT_DIR / "issue_health_report.json"
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"✅ Health report written to {out_path}")
    print(f"   Health Score: {score}/100 ({grade})")
    print(f"   Active: {age_counts['Active']} | Aging: {age_counts['Aging']} | Stale: {age_counts['Stale']} | Zombie: {age_counts['Zombie']}")
    print(f"   P1 Issues: {len(p1_issues)} | Inferred High Priority: {len(inferred_high_priority)}")
    print(f"   Unlabeled: {len(unlabeled)} ({stats['unlabeled_pct']}%)")


if __name__ == "__main__":
    main()
