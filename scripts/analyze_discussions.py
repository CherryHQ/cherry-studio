#!/usr/bin/env python3
"""
analyze_discussions.py — Builds .context/discussion_analysis.json from
pre-fetched GitHub GraphQL data in /tmp/gh_discussions.json.
Falls back to empty structure if data unavailable (rate limit, etc.).
"""
import json
import os
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict

TODAY = datetime.now(timezone.utc).date().isoformat()
CONTEXT_DIR = os.path.join(os.path.dirname(__file__), "..", ".context")
os.makedirs(CONTEXT_DIR, exist_ok=True)


def load_discussions():
    try:
        with open("/tmp/gh_discussions.json") as f:
            d = json.load(f)
        if "data" in d:
            return d["data"]["repository"]["discussions"]["nodes"]
        return []
    except Exception:
        return []


def age_days(created_at):
    if not created_at:
        return 0
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return 0


def main():
    discussions = load_discussions()
    now = datetime.now(timezone.utc)
    cutoff_30 = now - timedelta(days=30)

    category_counts = Counter()
    answered = []
    unanswered = []
    recent_30d = []

    for d in discussions:
        cat = (d.get("category") or {}).get("name", "Unknown")
        category_counts[cat] += 1

        if d.get("answer"):
            answered.append(d)
        else:
            unanswered.append(d)

        created = d.get("createdAt", "")
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if dt >= cutoff_30:
                recent_30d.append(d)
        except Exception:
            pass

    # Top upvoted unanswered
    top_unanswered = sorted(
        unanswered, key=lambda x: x.get("upvoteCount", 0), reverse=True
    )[:10]

    analysis = {
        "generated_at": now.isoformat(),
        "date": TODAY,
        "total_discussions": len(discussions),
        "data_available": len(discussions) > 0,
        "answered": len(answered),
        "unanswered": len(unanswered),
        "answered_rate_pct": round(len(answered) / max(len(discussions), 1) * 100, 1),
        "recent_30d": len(recent_30d),
        "category_breakdown": dict(category_counts.most_common()),
        "top_unanswered": [
            {
                "number": d.get("number"),
                "title": d.get("title"),
                "category": (d.get("category") or {}).get("name"),
                "upvotes": d.get("upvoteCount", 0),
                "comments": (d.get("comments") or {}).get("totalCount", 0),
                "age_days": age_days(d.get("createdAt")),
            }
            for d in top_unanswered
        ],
        "note": "Data fetched from GitHub Discussions via GraphQL API"
        if discussions
        else "GitHub API rate limit hit — data unavailable for this run",
    }

    out_path = os.path.join(CONTEXT_DIR, "discussion_analysis.json")
    with open(out_path, "w") as f:
        json.dump(analysis, f, indent=2, ensure_ascii=False)
    print(f"[analyze_discussions] Written to {out_path}")
    print(f"  Total: {analysis['total_discussions']}, Answered: {analysis['answered']}, Unanswered: {analysis['unanswered']}")


if __name__ == "__main__":
    main()
