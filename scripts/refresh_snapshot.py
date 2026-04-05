#!/usr/bin/env python3
"""
refresh_snapshot.py — Builds .context/latest_snapshot_summary.json from
pre-fetched GitHub API data in /tmp/gh_*.json files.
"""
import json
import os
from datetime import datetime, timezone, timedelta

TODAY = datetime.now(timezone.utc).date().isoformat()
CONTEXT_DIR = os.path.join(os.path.dirname(__file__), "..", ".context")
os.makedirs(CONTEXT_DIR, exist_ok=True)


def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def load_issues():
    pages = [
        "/tmp/gh_open_issues_p1.json",
        "/tmp/gh_open_issues_p2.json",
        "/tmp/gh_open_issues_p3.json",
        "/tmp/gh_open_issues_p4.json",
    ]
    items = []
    for p in pages:
        d = load_json(p)
        if isinstance(d, list):
            items += d
    return [i for i in items if "pull_request" not in i]


def load_closed_issues():
    pages = ["/tmp/gh_closed_issues_p1.json", "/tmp/gh_closed_issues_p2.json"]
    items = []
    for p in pages:
        d = load_json(p)
        if isinstance(d, list):
            items += [i for i in d if "pull_request" not in i]
    return items


def load_open_prs():
    pages = ["/tmp/gh_open_prs_p1.json", "/tmp/gh_open_prs_p2.json"]
    items = []
    for p in pages:
        d = load_json(p)
        if isinstance(d, list):
            items += d
    return items


def load_v2_prs():
    closed = load_json("/tmp/gh_v2_closed_prs.json")
    opened = load_json("/tmp/gh_v2_open_prs.json")
    return (
        closed if isinstance(closed, list) else [],
        opened if isinstance(opened, list) else [],
    )


def label_names(issue):
    return [lb["name"] for lb in issue.get("labels", [])]


def is_p1(issue):
    labels = label_names(issue)
    return any(l.lower() in ("p1", "priority: critical", "critical", "urgent") for l in labels)


def is_bug(issue):
    labels = label_names(issue)
    return any("bug" in l.lower() for l in labels)


def is_unlabeled(issue):
    return len(issue.get("labels", [])) == 0


def age_days(issue):
    created = issue.get("createdAt") or issue.get("created_at", "")
    if not created:
        return 0
    try:
        dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return 0


def label_distribution(issues):
    from collections import Counter
    counter = Counter()
    for i in issues:
        for lb in i.get("labels", []):
            counter[lb["name"]] += 1
    return dict(counter.most_common(20))


def top_contributors(issues, n=10):
    from collections import Counter
    counter = Counter()
    for i in issues:
        author = (i.get("user") or {}).get("login") or (i.get("author") or {}).get("login", "unknown")
        if author:
            counter[author] += 1
    return dict(counter.most_common(n))


def main():
    open_issues = load_issues()
    closed_issues = load_closed_issues()
    open_prs = load_open_prs()
    v2_closed_prs, v2_open_prs = load_v2_prs()

    p1_issues = [i for i in open_issues if is_p1(i)]
    bug_issues = [i for i in open_issues if is_bug(i)]
    unlabeled = [i for i in open_issues if is_unlabeled(i)]

    # Age buckets
    now = datetime.now(timezone.utc)
    cutoff_30 = now - timedelta(days=30)
    cutoff_7 = now - timedelta(days=7)

    new_7d = [i for i in open_issues if age_days(i) <= 7]
    aged_30_90 = [i for i in open_issues if 30 <= age_days(i) < 90]
    stale_90 = [i for i in open_issues if age_days(i) >= 90]

    # v2 merged PRs (last 30d)
    v2_merged_30d = []
    for pr in v2_closed_prs:
        merged_at = pr.get("merged_at")
        if merged_at:
            try:
                dt = datetime.fromisoformat(merged_at.replace("Z", "+00:00"))
                if dt >= cutoff_30:
                    v2_merged_30d.append(pr)
            except Exception:
                pass

    snapshot = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "date": TODAY,
        "open_issues": {
            "total": len(open_issues),
            "p1_critical": len(p1_issues),
            "bugs": len(bug_issues),
            "unlabeled": len(unlabeled),
            "unlabeled_pct": round(len(unlabeled) / max(len(open_issues), 1) * 100, 1),
            "new_7d": len(new_7d),
            "aged_30_90d": len(aged_30_90),
            "stale_90d_plus": len(stale_90),
            "label_distribution": label_distribution(open_issues),
            "top_reporters": top_contributors(open_issues),
        },
        "closed_issues_30d": {
            "total": len(closed_issues),
        },
        "open_prs": {
            "total": len(open_prs),
            "to_main": len([p for p in open_prs if p.get("base", {}).get("ref") == "main"]),
            "to_v2": len([p for p in open_prs if p.get("base", {}).get("ref") == "v2"]),
        },
        "v2_branch": {
            "open_prs": len(v2_open_prs),
            "merged_prs_total": len(v2_closed_prs),
            "merged_prs_30d": len(v2_merged_30d),
        },
        "p1_issues_list": [
            {
                "number": i["number"],
                "title": i["title"],
                "labels": label_names(i),
                "age_days": age_days(i),
                "url": i.get("html_url", ""),
            }
            for i in p1_issues
        ],
    }

    out_path = os.path.join(CONTEXT_DIR, "latest_snapshot_summary.json")
    with open(out_path, "w") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)
    print(f"[refresh_snapshot] Written to {out_path}")
    print(f"  Open issues: {snapshot['open_issues']['total']}, Open PRs: {snapshot['open_prs']['total']}")
    print(f"  P1 critical: {snapshot['open_issues']['p1_critical']}, Unlabeled: {snapshot['open_issues']['unlabeled']} ({snapshot['open_issues']['unlabeled_pct']}%)")


if __name__ == "__main__":
    main()
