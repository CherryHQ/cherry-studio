#!/usr/bin/env python3
"""
build_v2_roadmap.py
Reads v2-labeled merged and open PRs and produces a detailed v2 roadmap snapshot.
Input:  /tmp/v2_merged_prs.json, /tmp/v2_open_prs.json
Output: /home/user/cherry-studio/.context/v2_roadmap_detailed.json
"""

import json
import os
from collections import Counter
from datetime import datetime, timezone, timedelta

OUTPUT_PATH   = "/home/user/cherry-studio/.context/v2_roadmap_detailed.json"
INPUT_MERGED  = "/tmp/v2_merged_prs.json"
INPUT_OPEN    = "/tmp/v2_open_prs.json"


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


def get_labels(pr):
    raw = pr.get("labels", [])
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


def get_author_login(pr):
    author = pr.get("author", {})
    if isinstance(author, dict):
        return author.get("login", "unknown")
    return str(author) if author else "unknown"


def compute_velocity(merged_prs, now):
    """
    Compute average merged PRs per week over the last 4 weeks.
    """
    cutoff_4w = now - timedelta(weeks=4)
    recent = [
        p for p in merged_prs
        if p.get("mergedAt") and parse_dt(p.get("mergedAt")) and parse_dt(p.get("mergedAt")) >= cutoff_4w
    ]
    # 4 weeks = 4 buckets
    return round(len(recent) / 4.0, 2)


def main():
    now = now_utc = datetime.now(timezone.utc)
    cutoff_7d  = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)

    merged_prs = load_json(INPUT_MERGED)
    open_prs   = load_json(INPUT_OPEN)

    # Summary counts
    merged_7d  = sum(
        1 for p in merged_prs
        if p.get("mergedAt") and parse_dt(p.get("mergedAt")) and parse_dt(p.get("mergedAt")) >= cutoff_7d
    )
    merged_30d = sum(
        1 for p in merged_prs
        if p.get("mergedAt") and parse_dt(p.get("mergedAt")) and parse_dt(p.get("mergedAt")) >= cutoff_30d
    )

    # Merged PRs list (sorted newest first)
    def merged_sort_key(p):
        dt = parse_dt(p.get("mergedAt"))
        return dt if dt is not None else datetime.min.replace(tzinfo=timezone.utc)

    merged_sorted = sorted(merged_prs, key=merged_sort_key, reverse=True)
    merged_out = [
        {
            "number":   p.get("number"),
            "title":    p.get("title", ""),
            "mergedAt": p.get("mergedAt", ""),
            "labels":   get_labels(p),
        }
        for p in merged_sorted
    ]

    # Open PRs list (sorted newest first)
    def created_sort_key(p):
        dt = parse_dt(p.get("createdAt"))
        return dt if dt is not None else datetime.min.replace(tzinfo=timezone.utc)

    open_sorted = sorted(open_prs, key=created_sort_key, reverse=True)
    open_out = [
        {
            "number":    p.get("number"),
            "title":     p.get("title", ""),
            "createdAt": p.get("createdAt", ""),
            "author":    get_author_login(p),
            "labels":    get_labels(p),
        }
        for p in open_sorted
    ]

    # Combined label distribution (merged + open)
    label_counter = Counter()
    for p in merged_prs + open_prs:
        label_counter.update(get_labels(p))

    velocity = compute_velocity(merged_prs, now)

    result = {
        "generated_at": now.isoformat(),
        "summary": {
            "merged_total":     len(merged_prs),
            "open_total":       len(open_prs),
            "merged_last_7d":   merged_7d,
            "merged_last_30d":  merged_30d,
        },
        "merged_prs":       merged_out,
        "open_prs":         open_out,
        "label_distribution": dict(label_counter.most_common()),
        "velocity": {
            "prs_per_week_last_4w": velocity,
        },
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Done: wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
