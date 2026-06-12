#!/usr/bin/env python3
"""
Issue health check — supplements refresh_snapshot.py with deeper triage signals.
Run after refresh_snapshot.py. Reads from /tmp/gh_open_issues.json.
"""
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
CONTEXT_DIR = ROOT / ".context"

now = datetime.now(timezone.utc)


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def main():
    issues_path = "/tmp/gh_open_issues.json"
    if not os.path.exists(issues_path):
        print(f"ERROR: {issues_path} not found.")
        return

    with open(issues_path) as f:
        data = json.load(f)
    issues = data if isinstance(data, list) else data.get("issues", data.get("items", []))
    print(f"Loaded {len(issues)} open issues")

    cutoff_14d = now - timedelta(days=14)
    cutoff_30d = now - timedelta(days=30)
    cutoff_90d = now - timedelta(days=90)

    active = []
    aging = []
    stale = []
    zombie = []

    for iss in issues:
        updated = parse_dt(iss.get("updated_at") or iss.get("updatedAt"))
        created = parse_dt(iss.get("created_at") or iss.get("createdAt"))
        entry = {"number": iss["number"], "title": iss["title"], "updated_at": iss.get("updated_at") or iss.get("updatedAt")}
        if not updated:
            stale.append(entry)
        elif updated > cutoff_14d:
            active.append(entry)
        elif updated > cutoff_30d:
            aging.append(entry)
        elif created and created < cutoff_90d:
            zombie.append(entry)
        else:
            stale.append(entry)

    total = len(issues)
    print(f"\nHealth Buckets ({total} total):")
    print(f"  Active  (updated <14d):  {len(active):4d}  ({len(active)/total*100:.0f}%)")
    print(f"  Aging   (updated 14-30d):{len(aging):4d}  ({len(aging)/total*100:.0f}%)")
    print(f"  Stale   (updated 30-90d):{len(stale):4d}  ({len(stale)/total*100:.0f}%)")
    print(f"  Zombie  (created >90d):  {len(zombie):4d}  ({len(zombie)/total*100:.0f}%)")

    health_path = CONTEXT_DIR / "issue_health_report.json"
    if health_path.exists():
        with open(health_path) as f:
            report = json.load(f)
        report["health_buckets"] = {
            "Active": {"count": len(active), "pct": round(len(active) / total * 100, 1)},
            "Aging": {"count": len(aging), "pct": round(len(aging) / total * 100, 1)},
            "Stale": {"count": len(stale), "pct": round(len(stale) / total * 100, 1)},
            "Zombie": {"count": len(zombie), "pct": round(len(zombie) / total * 100, 1)},
        }
        report["generated_at"] = now.isoformat()
        with open(health_path, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"\nUpdated: {health_path}")


if __name__ == "__main__":
    main()
