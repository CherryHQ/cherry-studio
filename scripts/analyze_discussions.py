#!/usr/bin/env python3
"""
analyze_discussions.py — Cherry Studio Discussions Analyzer
Reads /tmp/gh_discussions.json (GitHub Discussions GraphQL export) and writes
.context/discussion_analysis.json

Usage:
    python3 scripts/analyze_discussions.py

Prerequisites:
    gh api graphql -f query='...' > /tmp/gh_discussions.json
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

CONTEXT_DIR = Path(__file__).parent.parent / ".context"
TODAY = datetime.now(tz=timezone.utc)
DISCUSSIONS_PATH = "/tmp/gh_discussions.json"


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main():
    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)

    if not os.path.exists(DISCUSSIONS_PATH):
        print(f"ERROR: {DISCUSSIONS_PATH} not found. Run gh discussions fetch first.", file=sys.stderr)
        # Write empty placeholder
        out = {
            "generated_at": TODAY.isoformat(),
            "snapshot_date": TODAY.strftime("%Y-%m-%d"),
            "fetch_status": "missing",
            "fetch_note": f"Source file {DISCUSSIONS_PATH} not found. Run gh api graphql fetch.",
        }
        out_path = CONTEXT_DIR / "discussion_analysis.json"
        with open(out_path, "w") as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
        print(f"⚠️  Placeholder written to {out_path}")
        sys.exit(0)

    raw = json.loads(open(DISCUSSIONS_PATH).read())
    nodes = raw.get("data", {}).get("repository", {}).get("discussions", {}).get("nodes", [])

    by_category: dict[str, int] = defaultdict(int)
    unanswered = []
    answered = []
    high_vote = []
    recent = []

    cutoff_7d = TODAY - timedelta(days=7)

    for disc in nodes:
        cat = disc.get("category", {}).get("name", "Unknown")
        by_category[cat] += 1

        upvotes = disc.get("upvoteCount", 0)
        comment_count = disc.get("comments", {}).get("totalCount", 0)
        answer = disc.get("answer")
        updated_at = parse_dt(disc.get("updatedAt"))

        entry = {
            "number": disc.get("number"),
            "title": disc.get("title"),
            "category": cat,
            "author": (disc.get("author") or {}).get("login"),
            "createdAt": disc.get("createdAt"),
            "updatedAt": disc.get("updatedAt"),
            "upvotes": upvotes,
            "comments": comment_count,
            "answered": answer is not None,
        }

        if answer is None:
            unanswered.append(entry)
        else:
            answered.append(entry)

        if upvotes >= 5:
            high_vote.append(entry)

        if updated_at and updated_at >= cutoff_7d:
            recent.append(entry)

    # Sort by upvotes
    high_vote.sort(key=lambda x: -x["upvotes"])
    unanswered.sort(key=lambda x: -x["upvotes"])

    total = len(nodes)
    result = {
        "generated_at": TODAY.isoformat(),
        "snapshot_date": TODAY.strftime("%Y-%m-%d"),
        "data_source": "GitHub Discussions API (CherryHQ/cherry-studio)",
        "fetch_status": "ok",
        "total_discussions": total,
        "answered": len(answered),
        "unanswered": len(unanswered),
        "answer_rate_pct": round(len(answered) / total * 100, 1) if total else 0,
        "by_category": dict(by_category),
        "active_7d_count": len(recent),
        "high_upvote_discussions": high_vote[:10],
        "top_unanswered": unanswered[:10],
    }

    out_path = CONTEXT_DIR / "discussion_analysis.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"✅ Discussion analysis written to {out_path}")
    print(f"   Total: {total} | Answered: {len(answered)} | Unanswered: {len(unanswered)}")
    print(f"   Answer rate: {result['answer_rate_pct']}%")


if __name__ == "__main__":
    main()
