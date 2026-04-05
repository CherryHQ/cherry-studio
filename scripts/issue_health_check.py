#!/usr/bin/env python3
"""
issue_health_check.py — Builds .context/issue_health_report.json classifying
open issues into Active / Aging / Stale / Zombie by age + comment activity.
"""
import json
import os
from datetime import datetime, timezone, timedelta
from collections import defaultdict, Counter

TODAY = datetime.now(timezone.utc).date().isoformat()
CONTEXT_DIR = os.path.join(os.path.dirname(__file__), "..", ".context")
os.makedirs(CONTEXT_DIR, exist_ok=True)


def load_issues():
    pages = [
        "/tmp/gh_open_issues_p1.json",
        "/tmp/gh_open_issues_p2.json",
        "/tmp/gh_open_issues_p3.json",
        "/tmp/gh_open_issues_p4.json",
    ]
    items = []
    for p in pages:
        try:
            with open(p) as f:
                d = json.load(f)
            if isinstance(d, list):
                items += d
        except Exception:
            pass
    return [i for i in items if "pull_request" not in i]


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def classify(issue, now):
    """
    Health categories based on age + comment count:
      Active  : updated within 14d  OR  has >= 3 comments and age < 60d
      Aging   : 14d < last_update <= 60d
      Stale   : 60d < last_update <= 180d
      Zombie  : last_update > 180d
    """
    created = parse_dt(issue.get("created_at") or issue.get("createdAt", ""))
    updated = parse_dt(issue.get("updated_at") or issue.get("updatedAt", ""))
    comments = issue.get("comments", 0)

    if updated is None:
        updated = created
    if created is None:
        return "Unknown"

    update_age = (now - updated).days
    create_age = (now - created).days

    if update_age <= 14 or (create_age < 60 and comments >= 3):
        return "Active"
    elif update_age <= 60:
        return "Aging"
    elif update_age <= 180:
        return "Stale"
    else:
        return "Zombie"


def label_names(issue):
    return [lb["name"] for lb in issue.get("labels", [])]


def main():
    issues = load_issues()
    now = datetime.now(timezone.utc)

    buckets = defaultdict(list)
    for issue in issues:
        cat = classify(issue, now)
        buckets[cat].append(issue)

    # Build detailed lists (top 20 per bucket by age desc)
    def summarize(issue_list, limit=20):
        sorted_list = sorted(
            issue_list,
            key=lambda i: (parse_dt(i.get("updated_at") or i.get("updatedAt", "")) or now),
        )[:limit]
        return [
            {
                "number": i["number"],
                "title": i["title"],
                "labels": label_names(i),
                "created_at": i.get("created_at") or i.get("createdAt"),
                "updated_at": i.get("updated_at") or i.get("updatedAt"),
                "comments": i.get("comments", 0),
                "url": i.get("html_url", ""),
                "author": (i.get("user") or {}).get("login", ""),
                "update_age_days": (now - (parse_dt(i.get("updated_at") or i.get("updatedAt", "")) or now)).days,
            }
            for i in sorted_list
        ]

    total = len(issues)
    report = {
        "generated_at": now.isoformat(),
        "date": TODAY,
        "total_open_issues": total,
        "health_summary": {
            "Active": len(buckets["Active"]),
            "Aging": len(buckets["Aging"]),
            "Stale": len(buckets["Stale"]),
            "Zombie": len(buckets["Zombie"]),
        },
        "health_pct": {
            k: round(len(v) / max(total, 1) * 100, 1)
            for k, v in buckets.items()
        },
        "zombie_issues": summarize(buckets["Zombie"], 30),
        "stale_issues": summarize(buckets["Stale"], 20),
        "aging_issues": summarize(buckets["Aging"], 20),
        "health_score": round(
            (len(buckets["Active"]) * 1.0 + len(buckets["Aging"]) * 0.5)
            / max(total, 1)
            * 100,
            1,
        ),
    }

    out_path = os.path.join(CONTEXT_DIR, "issue_health_report.json")
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    h = report["health_summary"]
    print(f"[issue_health_check] Written to {out_path}")
    print(f"  Active: {h['Active']}, Aging: {h['Aging']}, Stale: {h['Stale']}, Zombie: {h['Zombie']}")
    print(f"  Health score: {report['health_score']}%")


if __name__ == "__main__":
    main()
