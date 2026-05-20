#!/usr/bin/env python3
"""
Issue health check: classify open issues by activity and label completeness.
Input:  /tmp/gh_open_issues.json
Output: .context/issue_health_report.json
"""

import json
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict
from pathlib import Path

TODAY = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
CONTEXT_DIR = Path(__file__).parent.parent / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

HEALTH_THRESHOLDS = {
    "active": 7,
    "aging": 30,
    "stale": 90,
}

PRIORITY_LABELS = {"P1", "P2", "critical", "high-priority", "urgent"}
BUG_LABELS = {"BUG", "bug", "Bug"}
NEEDS_INFO_LABELS = {"needs-repro", "needs-more-info", "needs-triage"}


def extract_labels(issue: dict) -> list[str]:
    labels = issue.get("labels", [])
    if isinstance(labels, list) and labels and isinstance(labels[0], dict):
        return [lb["name"] for lb in labels]
    return [lb for lb in labels if isinstance(lb, str)]


def classify_health(issue: dict) -> str:
    updated = issue.get("updatedAt") or issue.get("updated_at", "")
    if not updated:
        return "zombie"
    dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
    days = (TODAY - dt).days
    if days < HEALTH_THRESHOLDS["active"]:
        return "active"
    elif days < HEALTH_THRESHOLDS["aging"]:
        return "aging"
    elif days < HEALTH_THRESHOLDS["stale"]:
        return "stale"
    return "zombie"


def main():
    with open("/tmp/gh_open_issues.json") as f:
        issues = json.load(f)

    health_buckets: dict[str, list] = defaultdict(list)
    label_gaps = []
    priority_issues = []
    bug_issues = []
    needs_info_issues = []
    long_open = []
    label_dist: Counter = Counter()

    cutoff_long = TODAY - timedelta(days=180)

    for issue in issues:
        labels = extract_labels(issue)
        number = issue["number"]
        title = issue["title"]
        created = issue.get("createdAt") or issue.get("created_at", "")
        updated = issue.get("updatedAt") or issue.get("updated_at", "")
        comments = issue.get("comments", 0)

        health = classify_health(issue)
        health_buckets[health].append({
            "number": number,
            "title": title,
            "labels": labels,
            "updatedAt": updated,
            "comments": comments,
        })

        for lb in labels:
            label_dist[lb] += 1

        if not labels:
            label_gaps.append({"number": number, "title": title, "createdAt": created})

        if any(lb in PRIORITY_LABELS for lb in labels):
            priority_issues.append({"number": number, "title": title, "labels": labels})

        if any(lb in BUG_LABELS for lb in labels):
            bug_issues.append({"number": number, "title": title, "labels": labels,
                               "updatedAt": updated, "comments": comments})

        if any(lb in NEEDS_INFO_LABELS for lb in labels):
            needs_info_issues.append({"number": number, "title": title, "labels": labels})

        if created:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if dt < cutoff_long:
                long_open.append({"number": number, "title": title, "createdAt": created,
                                  "labels": labels, "comments": comments})

    total = len(issues)
    unclassified = len(label_gaps)

    report = {
        "generated_at": TODAY.isoformat(),
        "total_open_issues": total,
        "health_summary": {k: len(v) for k, v in health_buckets.items()},
        "health_pct": {
            k: f"{len(v) / max(total, 1) * 100:.1f}%"
            for k, v in health_buckets.items()
        },
        "unclassified": {
            "count": unclassified,
            "pct": f"{unclassified / max(total, 1) * 100:.1f}%",
            "issues": label_gaps[:20],
        },
        "priority_issues": priority_issues[:20],
        "bug_issues": sorted(bug_issues, key=lambda x: x["comments"], reverse=True)[:20],
        "needs_info_issues": needs_info_issues[:20],
        "long_open_issues": sorted(long_open, key=lambda x: x["createdAt"])[:20],
        "top_labels": dict(label_dist.most_common(20)),
        "health_buckets": {
            k: v[:10] for k, v in health_buckets.items()
        },
    }

    out = CONTEXT_DIR / "issue_health_report.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
