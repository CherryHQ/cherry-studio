#!/usr/bin/env python3
"""
Build v2 roadmap from merged and open v2 PRs.
Input:  /tmp/v2_merged_prs.json, /tmp/v2_open_prs.json
Output: .context/v2_roadmap_detailed.json
"""

import json
import re
from datetime import datetime, timezone, timedelta
from collections import Counter, defaultdict
from pathlib import Path

TODAY = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
CONTEXT_DIR = Path(__file__).parent.parent / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

CATEGORY_PATTERNS = [
    ("refactor", r"\brefactor\b"),
    ("feat", r"\bfeat\b"),
    ("fix", r"\bfix\b"),
    ("chore", r"\bchore\b"),
    ("docs", r"\bdocs?\b"),
    ("perf", r"\bperf\b"),
    ("ci", r"\bci\b"),
    ("test", r"\btest\b"),
]

MODULE_PATTERNS = [
    ("agents", r"\b(agents?|agent-task|ai-service)\b"),
    ("data-layer", r"\b(data|migration|db|database|drizzle)\b"),
    ("ui", r"\b(ui|layout|renderer|react|component|tailwind)\b"),
    ("mcp", r"\b(mcp|tool-call)\b"),
    ("i18n", r"\bi18n\b"),
    ("provider", r"\b(provider|model|llm)\b"),
    ("file", r"\b(file|backup|storage)\b"),
    ("knowledge", r"\b(knowledge|rag|embedding)\b"),
    ("notes", r"\bnotes?\b"),
    ("paintings", r"\bpaintings?\b"),
    ("miniapp", r"\bminiapp\b"),
]


def extract_labels(pr: dict) -> list[str]:
    labels = pr.get("labels", [])
    if isinstance(labels, list) and labels and isinstance(labels[0], dict):
        return [lb["name"] for lb in labels]
    return [lb for lb in labels if isinstance(lb, str)]


def categorize(title: str) -> tuple[str, str]:
    t = title.lower()
    category = "other"
    for cat, pat in CATEGORY_PATTERNS:
        if re.search(pat, t):
            category = cat
            break
    module = "general"
    for mod, pat in MODULE_PATTERNS:
        if re.search(pat, t):
            module = mod
            break
    return category, module


def parse_prs(prs: list) -> list[dict]:
    result = []
    for pr in prs:
        labels = extract_labels(pr)
        category, module = categorize(pr.get("title", ""))
        result.append({
            "number": pr["number"],
            "title": pr["title"],
            "labels": labels,
            "author": (pr.get("author") or {}).get("login", pr.get("user", {}).get("login", "unknown")),
            "category": category,
            "module": module,
            "mergedAt": pr.get("mergedAt") or pr.get("merged_at"),
            "createdAt": pr.get("createdAt") or pr.get("created_at"),
            "draft": pr.get("draft", False),
        })
    return result


def main():
    with open("/tmp/v2_merged_prs.json") as f:
        merged_raw = json.load(f)
    with open("/tmp/v2_open_prs.json") as f:
        open_raw = json.load(f)

    merged = parse_prs(merged_raw)
    open_prs = parse_prs(open_raw)

    cutoff_7d = TODAY - timedelta(days=7)
    cutoff_30d = TODAY - timedelta(days=30)

    merged_7d = [p for p in merged if p["mergedAt"] and
                 datetime.fromisoformat(p["mergedAt"].replace("Z", "+00:00")) >= cutoff_7d]
    merged_30d = [p for p in merged if p["mergedAt"] and
                  datetime.fromisoformat(p["mergedAt"].replace("Z", "+00:00")) >= cutoff_30d]

    cat_dist: Counter = Counter(p["category"] for p in merged)
    mod_dist: Counter = Counter(p["module"] for p in merged)
    author_dist: Counter = Counter(p["author"] for p in merged)
    open_author_dist: Counter = Counter(p["author"] for p in open_prs)

    # Group open PRs by module
    open_by_module: dict[str, list] = defaultdict(list)
    for p in open_prs:
        open_by_module[p["module"]].append(p)

    # Monthly merge cadence
    monthly: Counter = Counter()
    for p in merged:
        if p["mergedAt"]:
            month = p["mergedAt"][:7]
            monthly[month] += 1

    roadmap = {
        "generated_at": TODAY.isoformat(),
        "v2_merged": {
            "total": len(merged),
            "last_7d": len(merged_7d),
            "last_30d": len(merged_30d),
            "by_category": dict(cat_dist.most_common()),
            "by_module": dict(mod_dist.most_common()),
            "top_contributors": dict(author_dist.most_common(10)),
            "monthly_cadence": dict(sorted(monthly.items())),
            "recent": [p for p in merged_7d],
        },
        "v2_open": {
            "total": len(open_prs),
            "drafts": sum(1 for p in open_prs if p["draft"]),
            "ready": sum(1 for p in open_prs if not p["draft"]),
            "by_module": {k: len(v) for k, v in open_by_module.items()},
            "top_contributors": dict(open_author_dist.most_common(10)),
            "prs": open_prs,
        },
        "module_progress": {
            mod: {
                "merged": mod_dist.get(mod, 0),
                "open": len(open_by_module.get(mod, [])),
            }
            for mod in set(list(mod_dist.keys()) + list(open_by_module.keys()))
        },
    }

    out = CONTEXT_DIR / "v2_roadmap_detailed.json"
    out.write_text(json.dumps(roadmap, indent=2, ensure_ascii=False))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
