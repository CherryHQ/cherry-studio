#!/usr/bin/env python3
"""
refresh_snapshot.py
Reads gh CLI JSON output files and produces a consolidated snapshot summary.
Input files (from /tmp/):
  gh_open_issues.json, gh_closed_issues_30d.json,
  gh_open_prs.json, gh_closed_prs_30d.json
Output: /home/user/cherry-studio/.context/latest_snapshot_summary.json
"""

import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

OUTPUT_PATH = "/home/user/cherry-studio/.context/latest_snapshot_summary.json"

INPUT_FILES = {
    "open_issues":       "/tmp/gh_open_issues.json",
    "closed_issues_30d": "/tmp/gh_closed_issues_30d.json",
    "open_prs":          "/tmp/gh_open_prs.json",
    "closed_prs_30d":    "/tmp/gh_closed_prs_30d.json",
}


def load_json(path):
    """Load a JSON file, returning an empty list on any error."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        # Some gh responses wrap results in a key
        if isinstance(data, dict):
            for key in ("nodes", "items", "data"):
                if isinstance(data.get(key), list):
                    return data[key]
        return []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def parse_dt(s):
    """Parse an ISO 8601 datetime string; return None on failure."""
    if not s:
        return None
    try:
        # Python 3.11+ handles 'Z'; older versions need replacement
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def now_utc():
    return datetime.now(timezone.utc)


def get_labels(item):
    """Return a flat list of label name strings from an issue/PR object."""
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
    """Classify an issue by age: active (<7d), aging (7-30d), stale (30-90d), zombie (>90d)."""
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


def analyze_issues(open_issues, closed_issues_30d):
    now = now_utc()
    cutoff_7d  = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)

    # Opened counts
    opened_7d  = sum(1 for i in open_issues if parse_dt(i.get("createdAt")) and parse_dt(i.get("createdAt")) >= cutoff_7d)
    opened_30d = sum(1 for i in open_issues if parse_dt(i.get("createdAt")) and parse_dt(i.get("createdAt")) >= cutoff_30d)

    # Label distribution (open issues)
    label_counter = Counter()
    unlabeled_count = 0
    for issue in open_issues:
        lbls = get_labels(issue)
        if lbls:
            label_counter.update(lbls)
        else:
            unlabeled_count += 1

    # Age buckets
    buckets = Counter(age_bucket(i.get("createdAt"), now) for i in open_issues)
    age_buckets = {
        "active":  buckets.get("active", 0),
        "aging":   buckets.get("aging", 0),
        "stale":   buckets.get("stale", 0),
        "zombie":  buckets.get("zombie", 0),
    }

    # P1 issues: any issue whose labels contain something matching "p1" (case-insensitive)
    p1_issues = []
    for issue in open_issues:
        lbls = get_labels(issue)
        if any("p1" in lbl.lower() or "priority" in lbl.lower() for lbl in lbls):
            p1_issues.append({
                "number":    issue.get("number"),
                "title":     issue.get("title", ""),
                "createdAt": issue.get("createdAt", ""),
                "updatedAt": issue.get("updatedAt", ""),
            })

    # Top commented (top 10)
    def comment_count(i):
        c = i.get("comments", 0)
        if isinstance(c, dict):
            return c.get("totalCount", 0)
        return int(c) if c else 0

    top_commented = sorted(open_issues, key=comment_count, reverse=True)[:10]
    top_commented_out = [
        {"number": i.get("number"), "title": i.get("title", ""), "comments": comment_count(i)}
        for i in top_commented
    ]

    return {
        "open_total":       len(open_issues),
        "opened_last_7d":   opened_7d,
        "opened_last_30d":  opened_30d,
        "closed_last_30d":  len(closed_issues_30d),
        "label_distribution": dict(label_counter.most_common()),
        "unlabeled_count":  unlabeled_count,
        "age_buckets":      age_buckets,
        "p1_issues":        p1_issues,
        "top_commented":    top_commented_out,
    }


def analyze_prs(open_prs, closed_prs_30d):
    now = now_utc()
    cutoff_7d  = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)

    opened_7d  = sum(1 for p in open_prs if parse_dt(p.get("createdAt")) and parse_dt(p.get("createdAt")) >= cutoff_7d)
    opened_30d = sum(1 for p in open_prs if parse_dt(p.get("createdAt")) and parse_dt(p.get("createdAt")) >= cutoff_30d)

    merged_30d = sum(
        1 for p in closed_prs_30d
        if p.get("mergedAt") and parse_dt(p.get("mergedAt")) and parse_dt(p.get("mergedAt")) >= cutoff_30d
    )
    closed_no_merge_30d = len(closed_prs_30d) - merged_30d

    draft_count = sum(1 for p in open_prs if p.get("draft", False))

    # Base branch distribution
    base_counter = Counter()
    for pr in open_prs:
        base = pr.get("baseRefName", "")
        if base == "main":
            base_counter["main"] += 1
        elif base == "v1":
            base_counter["v1"] += 1
        else:
            base_counter["other"] += 1
    base_dist = {
        "main":  base_counter.get("main", 0),
        "v1":    base_counter.get("v1", 0),
        "other": base_counter.get("other", 0),
    }

    # Label distribution (open PRs)
    label_counter = Counter()
    for pr in open_prs:
        label_counter.update(get_labels(pr))

    # V2-labeled open PRs
    v2_labeled = []
    for pr in open_prs:
        lbls = get_labels(pr)
        if any("v2" in lbl.lower() for lbl in lbls):
            author = pr.get("author", {})
            if isinstance(author, dict):
                author_login = author.get("login", "")
            else:
                author_login = str(author)
            v2_labeled.append({
                "number": pr.get("number"),
                "title":  pr.get("title", ""),
                "author": author_login,
            })

    # Stale PRs: open PRs not updated in >30 days
    stale_prs = []
    for pr in open_prs:
        updated = parse_dt(pr.get("updatedAt"))
        created = parse_dt(pr.get("createdAt"))
        ref_dt = updated or created
        if ref_dt and (now - ref_dt).days > 30:
            days_old = (now - (created or now)).days
            stale_prs.append({
                "number":   pr.get("number"),
                "title":    pr.get("title", ""),
                "days_old": days_old,
            })
    stale_prs.sort(key=lambda x: x["days_old"], reverse=True)

    # Top contributors for merged PRs in last 30d
    author_counter = Counter()
    for pr in closed_prs_30d:
        if pr.get("mergedAt") and parse_dt(pr.get("mergedAt")) and parse_dt(pr.get("mergedAt")) >= cutoff_30d:
            author = pr.get("author", {})
            if isinstance(author, dict):
                login = author.get("login", "unknown")
            else:
                login = str(author) if author else "unknown"
            author_counter[login] += 1

    top_contributors = [
        {"author": a, "count": c}
        for a, c in author_counter.most_common(10)
    ]

    return {
        "open_total":                    len(open_prs),
        "opened_last_7d":                opened_7d,
        "opened_last_30d":               opened_30d,
        "merged_last_30d":               merged_30d,
        "closed_without_merge_last_30d": closed_no_merge_30d,
        "draft_count":                   draft_count,
        "base_branch_distribution":      base_dist,
        "label_distribution":            dict(label_counter.most_common()),
        "v2_labeled_open":               v2_labeled,
        "stale_prs":                     stale_prs,
        "top_contributors_merged":       top_contributors,
    }


def main():
    open_issues       = load_json(INPUT_FILES["open_issues"])
    closed_issues_30d = load_json(INPUT_FILES["closed_issues_30d"])
    open_prs          = load_json(INPUT_FILES["open_prs"])
    closed_prs_30d    = load_json(INPUT_FILES["closed_prs_30d"])

    now = now_utc()
    result = {
        "generated_at": now.isoformat(),
        "date":         now.strftime("%Y-%m-%d"),
        "issues":       analyze_issues(open_issues, closed_issues_30d),
        "prs":          analyze_prs(open_prs, closed_prs_30d),
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Done: wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
