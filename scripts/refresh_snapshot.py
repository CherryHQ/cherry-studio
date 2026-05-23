#!/usr/bin/env python3
"""
refresh_snapshot.py — Cherry Studio Daily Data Refresh
Reads GitHub JSON exports from /tmp/gh_*.json and writes .context/latest_snapshot_summary.json

Usage:
    python3 scripts/refresh_snapshot.py

Prerequisites:
    gh issue list  ... > /tmp/gh_open_issues.json
    gh issue list  ... > /tmp/gh_closed_issues_30d.json
    gh pr list     ... > /tmp/gh_open_prs.json
    gh pr list     ... > /tmp/gh_closed_prs_30d.json
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

CONTEXT_DIR = Path(__file__).parent.parent / ".context"
TODAY = datetime.now(tz=timezone.utc)
CUTOFF_7D = TODAY - timedelta(days=7)
CUTOFF_30D = TODAY - timedelta(days=30)
CUTOFF_90D = TODAY - timedelta(days=90)


def load_json(path: str) -> list | dict:
    with open(path) as f:
        return json.load(f)


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


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


def extract_labels(issue: dict) -> list[str]:
    labels = issue.get("labels", [])
    if isinstance(labels, list):
        return [
            (lb["name"] if isinstance(lb, dict) else lb)
            for lb in labels
        ]
    return []


def analyze_open_issues(issues: list) -> dict:
    label_counts: dict[str, int] = {}
    age_counts = {"Active": 0, "Aging": 0, "Stale": 0, "Zombie": 0}
    unlabeled = 0
    p1_issues = []

    for issue in issues:
        labels = extract_labels(issue)
        if not labels:
            unlabeled += 1
        for lbl in labels:
            label_counts[lbl] = label_counts.get(lbl, 0) + 1
            if lbl.lower() in ("p1", "critical", "urgent", "high-priority"):
                p1_issues.append({
                    "number": issue.get("number"),
                    "title": issue.get("title"),
                    "label": lbl,
                })
        age = classify_age(issue.get("updatedAt"))
        if age in age_counts:
            age_counts[age] += 1

    total = len(issues)
    return {
        "total": total,
        "by_label": dict(sorted(label_counts.items(), key=lambda x: -x[1])[:20]),
        "unlabeled": {"count": unlabeled, "percentage": round(unlabeled / total * 100, 1) if total else 0},
        "age_distribution": age_counts,
        "p1_critical_issues": p1_issues,
    }


def analyze_closed_issues(issues: list) -> dict:
    times_to_close: list[float] = []
    weekly: dict[str, int] = {}

    for issue in issues:
        created = parse_dt(issue.get("createdAt"))
        closed = parse_dt(issue.get("closedAt"))
        if created and closed:
            hours = (closed - created).total_seconds() / 3600
            times_to_close.append(hours)
        if closed:
            week_key = closed.strftime("W%W_%b%d")
            weekly[week_key] = weekly.get(week_key, 0) + 1

    avg = round(sum(times_to_close) / len(times_to_close) / 24, 1) if times_to_close else 0
    return {
        "total": len(issues),
        "average_close_time_days": avg,
        "closed_per_week": weekly,
    }


def analyze_open_prs(prs: list) -> dict:
    by_base: dict[str, int] = {}
    age_counts = {"Active": 0, "Aging": 0, "Stale": 0, "Zombie": 0}

    for pr in prs:
        base = pr.get("baseRefName") or pr.get("base", {}).get("ref", "unknown")
        by_base[base] = by_base.get(base, 0) + 1
        age = classify_age(pr.get("updatedAt"))
        if age in age_counts:
            age_counts[age] += 1

    return {
        "total": len(prs),
        "by_base_branch": by_base,
        "age_distribution": age_counts,
    }


def main():
    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)

    open_issues_path = "/tmp/gh_open_issues.json"
    closed_issues_path = "/tmp/gh_closed_issues_30d.json"
    open_prs_path = "/tmp/gh_open_prs.json"

    if not os.path.exists(open_issues_path):
        print(f"ERROR: {open_issues_path} not found. Run gh data fetch first.", file=sys.stderr)
        sys.exit(1)

    open_issues = load_json(open_issues_path)
    closed_issues = load_json(closed_issues_path) if os.path.exists(closed_issues_path) else []
    open_prs = load_json(open_prs_path) if os.path.exists(open_prs_path) else []

    snapshot = {
        "generated_at": TODAY.isoformat(),
        "snapshot_date": TODAY.strftime("%Y-%m-%d"),
        "data_source": "gh CLI export (CherryHQ/cherry-studio)",
        "open_issues": analyze_open_issues(open_issues),
        "closed_issues_30d": analyze_closed_issues(closed_issues),
        "open_prs": analyze_open_prs(open_prs),
    }

    out_path = CONTEXT_DIR / "latest_snapshot_summary.json"
    with open(out_path, "w") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)

    print(f"✅ Snapshot written to {out_path}")
    print(f"   Open Issues: {snapshot['open_issues']['total']}")
    print(f"   Closed (30d): {snapshot['closed_issues_30d']['total']}")
    print(f"   Open PRs: {snapshot['open_prs']['total']}")


if __name__ == "__main__":
    main()
