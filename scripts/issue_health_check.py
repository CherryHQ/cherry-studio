#!/usr/bin/env python3
"""
issue_health_check.py
Reads open and recently-closed issues and produces an issue health report.
Input:  /tmp/gh_open_issues.json, /tmp/gh_closed_issues_30d.json
Output: /home/user/cherry-studio/.context/issue_health_report.json
"""

import json
import os
from datetime import datetime, timezone, timedelta

OUTPUT_PATH = "/home/user/cherry-studio/.context/issue_health_report.json"

INPUT_OPEN   = "/tmp/gh_open_issues.json"
INPUT_CLOSED = "/tmp/gh_closed_issues_30d.json"


def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("nodes", "items", "data"):
                if isinstance(data.get(key), list):
                    return data[key]
        return []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def get_labels(item):
    raw = item.get("labels", [])
    if not raw:
        return []
    names = []
    for lbl in raw:
        if isinstance(lbl, str):
            names.append(lbl)
        elif isinstance(lbl, dict):
            name = lbl.get("name") or lbl.get("id") or ""
            if name:
                names.append(name)
    return names


def age_bucket(created_at_str, now):
    dt = parse_dt(created_at_str)
    if dt is None:
        return "stale"
    age_days = (now - dt).days
    if age_days < 7:
        return "active"
    if age_days < 30:
        return "aging"
    if age_days < 90:
        return "stale"
    return "zombie"


def grade(score):
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 45:
        return "D"
    return "F"


def detect_bulk_triage(closed_issues):
    """
    Heuristic: if more than 20 issues were closed within the same calendar day
    (within the last 30d window), flag as bulk triage.
    """
    from collections import Counter
    day_counter = Counter()
    for issue in closed_issues:
        dt = parse_dt(issue.get("updatedAt") or issue.get("closedAt") or issue.get("createdAt"))
        if dt:
            day_counter[dt.strftime("%Y-%m-%d")] += 1
    return any(v >= 20 for v in day_counter.values())


def main():
    now = datetime.now(timezone.utc)
    cutoff_30d = now - timedelta(days=30)

    open_issues   = load_json(INPUT_OPEN)
    closed_issues = load_json(INPUT_CLOSED)

    total_open = len(open_issues)

    # Unlabeled ratio
    unlabeled = sum(1 for i in open_issues if not get_labels(i))
    unlabeled_ratio = unlabeled / total_open if total_open else 0.0

    # Age buckets
    from collections import Counter
    bucket_counter = Counter(age_bucket(i.get("createdAt"), now) for i in open_issues)
    age_dist = {
        "active":  bucket_counter.get("active", 0),
        "aging":   bucket_counter.get("aging", 0),
        "stale":   bucket_counter.get("stale", 0),
        "zombie":  bucket_counter.get("zombie", 0),
    }
    zombie_count = age_dist["zombie"]
    zombie_ratio = zombie_count / total_open if total_open else 0.0

    # P1 issues unresolved beyond 30 days
    p1_beyond_30d = 0
    p1_total = 0
    for issue in open_issues:
        lbls = get_labels(issue)
        if any("p1" in lbl.lower() or "priority" in lbl.lower() for lbl in lbls):
            p1_total += 1
            dt = parse_dt(issue.get("createdAt"))
            if dt and (now - dt).days > 30:
                p1_beyond_30d += 1

    # Average age in days
    ages = []
    for issue in open_issues:
        dt = parse_dt(issue.get("createdAt"))
        if dt:
            ages.append((now - dt).days)
    avg_age_days = round(sum(ages) / len(ages), 1) if ages else 0.0

    # Closed last 30d
    closed_last_30d = sum(
        1 for i in closed_issues
        if parse_dt(i.get("updatedAt") or i.get("createdAt")) and
           parse_dt(i.get("updatedAt") or i.get("createdAt")) >= cutoff_30d
    )

    # Closure rate (rough: closed per week over 30d window)
    if closed_last_30d:
        rate_per_week = closed_last_30d / 4.0
        closure_rate = f"{rate_per_week:.1f} issues/week (last 30d)"
    else:
        closure_rate = "0 issues/week (last 30d)"

    bulk_triage = detect_bulk_triage(closed_issues)

    # Health score
    score = 100.0
    deductions = []

    if unlabeled_ratio > 0.5:
        score -= 20
        deductions.append(f"High unlabeled ratio ({unlabeled_ratio:.0%}) — deducted 20 pts")

    if zombie_ratio > 0.3:
        score -= 15
        deductions.append(f"High zombie ratio ({zombie_ratio:.0%}) — deducted 15 pts")

    if p1_beyond_30d > 0:
        penalty = p1_beyond_30d * 10
        score -= penalty
        deductions.append(f"{p1_beyond_30d} P1 issue(s) unresolved >30d — deducted {penalty} pts")

    if total_open > 500:
        score -= 10
        deductions.append(f"Open issue count ({total_open}) exceeds 500 — deducted 10 pts")
    elif total_open > 200:
        score -= 5
        deductions.append(f"Open issue count ({total_open}) exceeds 200 — deducted 5 pts")

    score = max(0.0, round(score, 1))

    # Action items
    action_items = []
    if unlabeled > 0:
        action_items.append(f"Label {unlabeled} unlabeled open issue(s) to improve triage visibility.")
    if zombie_count > 0:
        action_items.append(f"Review {zombie_count} zombie issue(s) (>90 days old) — close or reprioritize.")
    if p1_beyond_30d > 0:
        action_items.append(f"Address {p1_beyond_30d} P1 issue(s) that have been open for more than 30 days.")
    if total_open > 500:
        action_items.append("Issue backlog exceeds 500 — consider a triage sprint to reduce open count.")
    elif total_open > 200:
        action_items.append("Issue backlog exceeds 200 — periodic grooming recommended.")
    if bulk_triage:
        action_items.append("Bulk triage event detected in the last 30 days — review closure quality.")
    if not action_items:
        action_items.append("Issue health looks good — keep up the triage cadence.")

    result = {
        "generated_at": now.isoformat(),
        "health_score": score,
        "health_grade": grade(score),
        "metrics": {
            "total_open":           total_open,
            "unlabeled_ratio":      round(unlabeled_ratio, 4),
            "zombie_ratio":         round(zombie_ratio, 4),
            "p1_count":             p1_total,
            "avg_age_days":         avg_age_days,
            "closed_last_30d":      closed_last_30d,
            "closure_rate":         closure_rate,
            "bulk_triage_detected": bulk_triage,
        },
        "age_distribution": age_dist,
        "action_items":     action_items,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Done: wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
