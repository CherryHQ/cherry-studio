#!/usr/bin/env python3
"""
Analyze GitHub Discussions data and write .context/discussion_analysis.json.
Reads from /tmp/gh_discussions.json fetched via:
  gh api graphql -f query='...' > /tmp/gh_discussions.json
"""
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
CONTEXT_DIR = ROOT / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

now = datetime.now(timezone.utc)


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def main():
    path = "/tmp/gh_discussions.json"
    if not os.path.exists(path):
        print(f"ERROR: {path} not found. Fetch data first with gh api graphql.")
        return

    with open(path) as f:
        raw = json.load(f)

    discussions = (
        raw.get("data", {})
        .get("repository", {})
        .get("discussions", {})
        .get("nodes", [])
    )
    if not discussions:
        print("No discussions found. Check the file format.")
        return

    print(f"Loaded {len(discussions)} discussions")
    cutoff_7d = now - timedelta(days=7)

    category_counts = {}
    unanswered = []
    recent_active = []

    for d in discussions:
        cat = d.get("category", {}).get("name", "Unknown")
        category_counts[cat] = category_counts.get(cat, 0) + 1
        updated = parse_dt(d.get("updatedAt"))
        if not d.get("answer"):
            unanswered.append(d)
        if updated and updated > cutoff_7d:
            recent_active.append(d)

    top_upvoted = sorted(discussions, key=lambda x: x.get("upvoteCount", 0), reverse=True)[:10]

    result = {
        "generated_at": now.isoformat(),
        "total": len(discussions),
        "by_category": [
            {"category": c, "count": n}
            for c, n in sorted(category_counts.items(), key=lambda x: -x[1])
        ],
        "unanswered_count": len(unanswered),
        "unanswered_sample": [
            {
                "number": d.get("number"),
                "title": d.get("title"),
                "category": d.get("category", {}).get("name"),
                "updatedAt": d.get("updatedAt"),
                "comments": d.get("comments", {}).get("totalCount", 0),
            }
            for d in unanswered[:10]
        ],
        "recent_active_7d": len(recent_active),
        "top_upvoted": [
            {
                "number": d.get("number"),
                "title": d.get("title"),
                "upvoteCount": d.get("upvoteCount", 0),
                "comments": d.get("comments", {}).get("totalCount", 0),
                "answered": bool(d.get("answer")),
            }
            for d in top_upvoted
        ],
    }

    out = CONTEXT_DIR / "discussion_analysis.json"
    with open(out, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"Written: {out}")
    print(f"Total: {result['total']}, Unanswered: {result['unanswered_count']}, Active 7d: {result['recent_active_7d']}")


if __name__ == "__main__":
    main()
