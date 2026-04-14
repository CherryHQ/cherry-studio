#!/usr/bin/env python3
"""
build_v2_roadmap.py — V2 branch roadmap builder for Cherry Studio.

Reads /tmp/v2_merged_prs.json and /tmp/v2_open_prs.json and produces
.context/v2_roadmap_detailed.json with contributor stats, merge velocity,
and open PR categorization.

Usage:
    python3 scripts/build_v2_roadmap.py
"""

import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

CONTEXT_DIR = Path(__file__).parent.parent / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

NOW = datetime.now(timezone.utc)
CUTOFF_30D = NOW - timedelta(days=30)

COMMIT_TYPE_RE = re.compile(r"^(feat|fix|refactor|docs|chore|perf|test|ci|build|style|revert)[\(!:]")


def load_json(path: str) -> list:
    p = Path(path)
    if not p.exists():
        print(f"[WARN] {path} not found", file=sys.stderr)
        return []
    with open(p) as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def commit_type(title: str) -> str:
    m = COMMIT_TYPE_RE.match(title.strip().lower())
    return m.group(1) if m else "other"


def author_login(pr: dict) -> str:
    if "author" in pr and isinstance(pr["author"], dict):
        return pr["author"].get("login", "?")
    if "user" in pr and isinstance(pr["user"], dict):
        return pr["user"].get("login", "?")
    return "?"


def label_names(raw: list) -> list[str]:
    return [l["name"] if isinstance(l, dict) else l for l in raw]


def main() -> None:
    merged_prs = load_json("/tmp/v2_merged_prs.json")
    open_prs = load_json("/tmp/v2_open_prs.json")

    # Merged in last 30 days
    merged_30d = []
    contributor_counts: Counter = Counter()
    type_counts: Counter = Counter()

    for pr in merged_prs:
        merged_at_raw = pr.get("mergedAt", pr.get("merged_at"))
        if not merged_at_raw:
            continue
        merged_at = parse_dt(merged_at_raw)
        if merged_at < CUTOFF_30D:
            continue
        login = author_login(pr)
        contributor_counts[login] += 1
        ctype = commit_type(pr.get("title", ""))
        type_counts[ctype] += 1
        merged_30d.append({
            "number": pr["number"],
            "title": pr["title"][:80],
            "merged_at": merged_at_raw[:10],
            "author": login,
            "type": ctype,
            "labels": label_names(pr.get("labels", [])),
        })

    # Open PRs
    drafts = []
    ready = []
    for pr in open_prs:
        is_draft = pr.get("isDraft", pr.get("draft", False))
        created = parse_dt(pr.get("createdAt", pr.get("created_at", NOW.isoformat())))
        age_days = (NOW - created).days
        labels = label_names(pr.get("labels", []))
        entry = {
            "number": pr["number"],
            "title": pr["title"][:80],
            "age_days": age_days,
            "author": author_login(pr),
            "labels": labels,
            "draft": is_draft,
        }
        (drafts if is_draft else ready).append(entry)

    roadmap = {
        "generated_at": NOW.isoformat(),
        "date": NOW.strftime("%Y-%m-%d"),
        "branch": "v2",
        "summary": {
            "merged_last_30d": len(merged_30d),
            "open_prs": len(open_prs),
            "open_ready": len(ready),
            "open_draft": len(drafts),
            "velocity": f"{len(merged_30d) / 30:.1f} PRs/day",
        },
        "recent_merges_30d": sorted(merged_30d, key=lambda x: x["merged_at"], reverse=True),
        "open_ready_for_review": sorted(ready, key=lambda x: x["age_days"]),
        "open_drafts": sorted(drafts, key=lambda x: x["age_days"]),
        "contributor_activity_30d": dict(contributor_counts.most_common(20)),
        "merge_type_breakdown_30d": dict(type_counts.most_common()),
        "roadmap_themes": _extract_themes(merged_30d + ready + drafts),
    }

    out = CONTEXT_DIR / "v2_roadmap_detailed.json"
    out.write_text(json.dumps(roadmap, indent=2, ensure_ascii=False))
    print(f"[OK] Written: {out}")
    print(f"     Merged 30d: {len(merged_30d)}, Open: {len(open_prs)} ({len(ready)} ready, {len(drafts)} draft)")
    print(f"     Top contributors: {dict(contributor_counts.most_common(5))}")


def _extract_themes(prs: list) -> list[str]:
    """Naive keyword-based theme extraction from PR titles."""
    theme_keywords = {
        "Data layer migration": ["migration", "migrat", "schema", "db", "database", "dataapi"],
        "UI / shadcn migration": ["shadcn", "tailwind", "radix", "heroui", "component", "ui"],
        "Sidebar & tab system": ["sidebar", "tab", "split-view", "layout"],
        "MCP & Agent SDK": ["mcp", "agent", "sdk", "tool-loop"],
        "Knowledge base & files": ["knowledge", "rag", "file", "processing"],
        "Provider / Model registry": ["provider", "model", "registry", "llm"],
        "AI streaming pipeline": ["streaming", "blocks", "pipeline", "ai-core"],
        "Settings & preferences": ["preference", "shortcut", "setting"],
        "Web search": ["websearch", "web search", "search"],
    }
    title_blob = " ".join(p["title"].lower() for p in prs)
    themes = []
    for theme, keywords in theme_keywords.items():
        if any(kw in title_blob for kw in keywords):
            themes.append(theme)
    return themes


if __name__ == "__main__":
    main()
