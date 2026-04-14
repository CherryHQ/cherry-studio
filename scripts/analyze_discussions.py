#!/usr/bin/env python3
"""
analyze_discussions.py — GitHub Discussions analyzer for Cherry Studio.

Reads /tmp/gh_discussions.json (from `gh api graphql`) and produces
.context/discussion_analysis.json.

Usage:
    python3 scripts/analyze_discussions.py
"""

import json
import sys
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

CONTEXT_DIR = Path(__file__).parent.parent / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

NOW = datetime.now(timezone.utc)


def load_json(path: str) -> dict | None:
    p = Path(path)
    if not p.exists():
        print(f"[WARN] {path} not found", file=sys.stderr)
        return None
    with open(p) as f:
        return json.load(f)


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main() -> None:
    raw = load_json("/tmp/gh_discussions.json")
    if raw is None:
        # Write a placeholder
        out = CONTEXT_DIR / "discussion_analysis.json"
        out.write_text(json.dumps({
            "generated_at": NOW.isoformat(),
            "date": NOW.strftime("%Y-%m-%d"),
            "data_note": "gh_discussions.json not found. Run the GraphQL query first.",
        }, indent=2))
        print("[WARN] No discussions data; wrote placeholder.")
        return

    nodes = raw.get("data", {}).get("repository", {}).get("discussions", {}).get("nodes", [])
    print(f"[INFO] Loaded {len(nodes)} discussions")

    category_counts: Counter = Counter()
    unanswered = []
    top_upvoted = []
    recent_active = []

    for d in nodes:
        cat = d.get("category", {}).get("name", "Unknown")
        category_counts[cat] += 1
        upvotes = d.get("upvoteCount", 0)
        comments = d.get("comments", {}).get("totalCount", 0)
        answered = d.get("answer") is not None
        updated = parse_dt(d["updatedAt"]) if d.get("updatedAt") else NOW
        inactive_days = (NOW - updated).days

        entry = {
            "number": d["number"],
            "title": d["title"][:80],
            "category": cat,
            "upvotes": upvotes,
            "comments": comments,
            "answered": answered,
            "inactive_days": inactive_days,
            "author": d.get("author", {}).get("login", "?"),
        }

        if not answered and cat not in ("Announcements",):
            unanswered.append(entry)
        if upvotes >= 5:
            top_upvoted.append(entry)
        if inactive_days <= 7:
            recent_active.append(entry)

    analysis = {
        "generated_at": NOW.isoformat(),
        "date": NOW.strftime("%Y-%m-%d"),
        "total_discussions": len(nodes),
        "category_breakdown": dict(category_counts.most_common()),
        "unanswered_count": len(unanswered),
        "unanswered_top10": sorted(unanswered, key=lambda x: -x["upvotes"])[:10],
        "top_upvoted": sorted(top_upvoted, key=lambda x: -x["upvotes"])[:10],
        "recent_active_7d": sorted(recent_active, key=lambda x: x["inactive_days"])[:10],
    }

    out = CONTEXT_DIR / "discussion_analysis.json"
    out.write_text(json.dumps(analysis, indent=2, ensure_ascii=False))
    print(f"[OK] Written: {out}")
    print(f"     Total: {len(nodes)}, Unanswered: {len(unanswered)}, Top upvoted: {len(top_upvoted)}")


if __name__ == "__main__":
    main()
