#!/usr/bin/env python3
"""
Analyze GitHub Discussions data.
Input:  /tmp/gh_discussions.json (GraphQL response)
Output: .context/discussion_analysis.json
"""

import json
from datetime import datetime, timezone, timedelta
from collections import Counter
from pathlib import Path

TODAY = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
CONTEXT_DIR = Path(__file__).parent.parent / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)


def main():
    with open("/tmp/gh_discussions.json") as f:
        data = json.load(f)

    nodes = data["data"]["repository"]["discussions"]["nodes"]
    cutoff_7d = TODAY - timedelta(days=7)
    cutoff_30d = TODAY - timedelta(days=30)

    category_dist: Counter = Counter()
    unanswered = []
    hot_discussions = []
    recent_7d = recent_30d = 0

    for d in nodes:
        category = d["category"]["name"]
        category_dist[category] += 1
        updated = datetime.fromisoformat(d["updatedAt"].replace("Z", "+00:00"))
        if updated >= cutoff_7d:
            recent_7d += 1
        if updated >= cutoff_30d:
            recent_30d += 1
        if d.get("answer") is None and category not in ("Announcements",):
            unanswered.append({
                "number": d["number"],
                "title": d["title"],
                "category": category,
                "upvotes": d.get("upvoteCount", 0),
                "comments": d["comments"]["totalCount"],
                "updatedAt": d["updatedAt"],
            })
        hot_discussions.append({
            "number": d["number"],
            "title": d["title"],
            "category": category,
            "upvotes": d.get("upvoteCount", 0),
            "comments": d["comments"]["totalCount"],
            "answered": d.get("answer") is not None,
        })

    hot_discussions.sort(key=lambda x: x["upvotes"] + x["comments"], reverse=True)
    unanswered.sort(key=lambda x: x["upvotes"] + x["comments"], reverse=True)

    result = {
        "generated_at": TODAY.isoformat(),
        "total_discussions": len(nodes),
        "recent_7d": recent_7d,
        "recent_30d": recent_30d,
        "category_distribution": dict(category_dist.most_common()),
        "unanswered_count": len(unanswered),
        "top_unanswered": unanswered[:10],
        "hot_discussions": hot_discussions[:15],
    }

    out = CONTEXT_DIR / "discussion_analysis.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
