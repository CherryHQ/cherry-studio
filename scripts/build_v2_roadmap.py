#!/usr/bin/env python3
"""
Build v2 roadmap from merged and open v2-base PRs.
Reads from /tmp/v2_merged_prs.json and /tmp/v2_open_prs.json.
Writes .context/v2_roadmap_detailed.json.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
CONTEXT_DIR = ROOT / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

now = datetime.now(timezone.utc)


def load_gh_json(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        data = json.load(f)
    return data if isinstance(data, list) else data.get("items", data.get("nodes", []))


def extract_track(title):
    title_lower = title.lower()
    for track in ("knowledge", "file-manager", "file-entry", "file", "data", "ui", "window", "chat", "agent", "provider", "mcp"):
        if track in title_lower:
            return track
    return "other"


def main():
    merged = load_gh_json("/tmp/v2_merged_prs.json")
    open_prs = load_gh_json("/tmp/v2_open_prs.json")
    print(f"v2 merged PRs: {len(merged)}, open PRs: {len(open_prs)}")

    tracks = {}
    for pr in merged:
        track = extract_track(pr.get("title", ""))
        if track not in tracks:
            tracks[track] = []
        tracks[track].append({"number": pr.get("number"), "title": pr.get("title"), "mergedAt": pr.get("mergedAt") or pr.get("merged_at")})

    result = {
        "generated_at": now.isoformat(),
        "v2_branch_status": {
            "open_prs": len(open_prs),
            "merged_prs_30d": len(merged),
            "note": "v2 branch merged into main; both v1 and v2 code coexist on main during refactor.",
        },
        "merged_by_track": {
            track: {"count": len(prs), "prs": prs}
            for track, prs in sorted(tracks.items(), key=lambda x: -len(x[1]))
        },
        "open_prs": [
            {"number": pr.get("number"), "title": pr.get("title"), "author": pr.get("author", {}).get("login") if isinstance(pr.get("author"), dict) else pr.get("author")}
            for pr in open_prs
        ],
        "active_tracks": [
            {"track": "Data Layer", "status": "in_progress", "replacing": ["Redux", "Dexie", "ElectronStore"], "adopting": ["Cache", "Preference", "DataApi (SQLite + Drizzle)"]},
            {"track": "UI Layer", "status": "in_progress", "replacing": ["antd", "HeroUI", "styled-components"], "adopting": ["@cherrystudio/ui (Tailwind CSS + Shadcn UI)"]},
        ],
    }

    out = CONTEXT_DIR / "v2_roadmap_detailed.json"
    with open(out, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"Written: {out}")
    print(f"Merged 30d: {len(merged)}, Open: {len(open_prs)}, Tracks: {list(tracks.keys())}")


if __name__ == "__main__":
    main()
