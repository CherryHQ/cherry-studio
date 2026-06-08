#!/usr/bin/env python3
"""
analyze_discussions.py
Reads GraphQL discussions JSON and produces a discussion analysis summary.
Input: /tmp/gh_discussions.json
Output: /home/user/cherry-studio/.context/discussion_analysis.json
"""

import json
import os
from collections import Counter
from datetime import datetime, timezone

OUTPUT_PATH = "/home/user/cherry-studio/.context/discussion_analysis.json"
INPUT_PATH  = "/tmp/gh_discussions.json"


def load_discussions(path):
    """
    Load discussions from the GraphQL response.
    Handles several common shapes:
      - Top-level list
      - {"nodes": [...]}
      - {"data": {"repository": {"discussions": {"nodes": [...]}}}}
      - {"data": {"repository": {"discussions": {"edges": [{"node": {...}}]}}}}
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []

    if isinstance(raw, list):
        return raw

    if isinstance(raw, dict):
        # Direct nodes key
        if isinstance(raw.get("nodes"), list):
            return raw["nodes"]

        # Unwrap GraphQL envelope
        data = raw.get("data", raw)
        repo = data.get("repository", data) if isinstance(data, dict) else {}
        discussions = repo.get("discussions", {}) if isinstance(repo, dict) else {}
        if isinstance(discussions, list):
            return discussions
        if isinstance(discussions, dict):
            if isinstance(discussions.get("nodes"), list):
                return discussions["nodes"]
            edges = discussions.get("edges", [])
            if isinstance(edges, list):
                return [e["node"] for e in edges if isinstance(e, dict) and "node" in e]

    return []


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def get_category(discussion):
    cat = discussion.get("category", {})
    if isinstance(cat, dict):
        return cat.get("name") or cat.get("slug") or "unknown"
    return str(cat) if cat else "unknown"


def get_labels(discussion):
    raw = discussion.get("labels", {})
    # GraphQL returns {"nodes": [...]} or a plain list
    if isinstance(raw, dict):
        raw = raw.get("nodes", [])
    if not isinstance(raw, list):
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


def get_upvotes(discussion):
    # GraphQL field is usually "upvoteCount" or "reactionGroups"
    v = discussion.get("upvoteCount")
    if v is not None:
        return int(v)
    # Fallback: reactions count
    reactions = discussion.get("reactions", {})
    if isinstance(reactions, dict):
        return int(reactions.get("totalCount", 0))
    return 0


def get_comment_count(discussion):
    comments = discussion.get("comments", {})
    if isinstance(comments, dict):
        return int(comments.get("totalCount", 0))
    if isinstance(comments, int):
        return comments
    return 0


def is_answered(discussion):
    # GraphQL field "answer" is non-null when answered; "isAnswered" boolean also present
    if discussion.get("isAnswered") is True:
        return True
    if discussion.get("answer") is not None:
        return True
    return False


def main():
    discussions = load_discussions(INPUT_PATH)
    now = datetime.now(timezone.utc)

    total = len(discussions)
    unanswered = [d for d in discussions if not is_answered(d)]

    category_counter = Counter(get_category(d) for d in discussions)
    label_counter    = Counter()
    for d in discussions:
        label_counter.update(get_labels(d))

    # Top upvoted (top 10)
    top_upvoted = sorted(discussions, key=get_upvotes, reverse=True)[:10]
    top_upvoted_out = [
        {
            "number":   d.get("number"),
            "title":    d.get("title", ""),
            "upvotes":  get_upvotes(d),
            "category": get_category(d),
        }
        for d in top_upvoted
    ]

    # Recent unanswered: sort by createdAt descending, take top 10
    def sort_key(d):
        dt = parse_dt(d.get("createdAt"))
        return dt if dt is not None else datetime.min.replace(tzinfo=timezone.utc)

    recent_unanswered = sorted(unanswered, key=sort_key, reverse=True)[:10]
    recent_unanswered_out = [
        {
            "number":    d.get("number"),
            "title":     d.get("title", ""),
            "createdAt": d.get("createdAt", ""),
            "comments":  get_comment_count(d),
        }
        for d in recent_unanswered
    ]

    result = {
        "generated_at":        now.isoformat(),
        "total_discussions":   total,
        "unanswered_count":    len(unanswered),
        "category_distribution": dict(category_counter.most_common()),
        "top_upvoted":         top_upvoted_out,
        "recent_unanswered":   recent_unanswered_out,
        "label_distribution":  dict(label_counter.most_common()),
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Done: wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
