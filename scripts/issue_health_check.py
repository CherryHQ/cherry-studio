#!/usr/bin/env python3
"""
issue_health_check.py — Issue health scorer for Cherry Studio.

Reads /tmp/gh_open_issues.json and /tmp/gh_closed_issues_30d.json and produces
.context/issue_health_report.json with lifecycle metrics, P1 bugs, and
triage recommendations.

Usage:
    python3 scripts/issue_health_check.py
"""

import json
import sys
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

CONTEXT_DIR = Path(__file__).parent.parent / ".context"
CONTEXT_DIR.mkdir(exist_ok=True)

NOW = datetime.now(timezone.utc)
CUTOFF_30D = NOW - timedelta(days=30)

BUG_LABELS = {"BUG", "bug", "type: bug", "P1", "urgent", "priority: critical"}
REPRO_LABELS = {"needs-repro", "needs-more-info"}


def load_json(path: str) -> list:
    p = Path(path)
    if not p.exists():
        print(f"[WARN] {path} not found", file=sys.stderr)
        return []
    with open(p) as f:
        return json.load(f)


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def label_names(raw: list) -> list[str]:
    return [l["name"] if isinstance(l, dict) else l for l in raw]


def health_bucket(age_days: int) -> str:
    if age_days <= 7:
        return "Active"
    if age_days <= 30:
        return "Aging"
    if age_days <= 90:
        return "Stale"
    return "Zombie"


def main() -> None:
    open_issues = load_json("/tmp/gh_open_issues.json")
    closed_issues = load_json("/tmp/gh_closed_issues_30d.json")

    health: Counter = Counter()
    label_dist: Counter = Counter()
    unlabeled_issues = []
    bug_issues = []
    repro_needed = []

    for iss in open_issues:
        labels = label_names(iss.get("labels", iss.get("label", [])))
        created_key = "createdAt" if "createdAt" in iss else "created_at"
        created = parse_dt(iss[created_key])
        age_days = (NOW - created).days
        bucket = health_bucket(age_days)
        health[bucket] += 1

        for lb in labels:
            label_dist[lb] += 1

        if not labels:
            unlabeled_issues.append({
                "number": iss["number"],
                "title": iss["title"][:80],
                "age_days": age_days,
            })

        if BUG_LABELS & set(labels):
            updated_key = "updatedAt" if "updatedAt" in iss else "updated_at"
            inactive = (NOW - parse_dt(iss[updated_key])).days
            bug_issues.append({
                "number": iss["number"],
                "title": iss["title"][:80],
                "labels": labels,
                "age_days": age_days,
                "inactive_days": inactive,
            })

        if REPRO_LABELS & set(labels):
            repro_needed.append({"number": iss["number"], "title": iss["title"][:80]})

    total = len(open_issues)
    # Closure velocity
    closed_by_day: Counter = Counter()
    for iss in closed_issues:
        updated_key = "updatedAt" if "updatedAt" in iss else "updated_at"
        day = iss.get(updated_key, "")[:10]
        if day:
            closed_by_day[day] += 1

    report = {
        "generated_at": NOW.isoformat(),
        "date": NOW.strftime("%Y-%m-%d"),
        "summary": {
            "open_total": total,
            "closed_30d": len(closed_issues),
            "daily_close_avg": round(len(closed_issues) / 30, 1),
            "health_score": "MODERATE" if health["Zombie"] / max(total, 1) < 0.6 else "POOR",
        },
        "health_distribution": {
            bucket: {
                "count": health[bucket],
                "pct": f"{health[bucket] / max(total, 1) * 100:.1f}%",
            }
            for bucket in ["Active", "Aging", "Stale", "Zombie"]
        },
        "label_health": {
            "unlabeled_count": len(unlabeled_issues),
            "unlabeled_pct": f"{len(unlabeled_issues) / max(total, 1) * 100:.1f}%",
            "sample_unlabeled": unlabeled_issues[:10],
            "top_labels": dict(label_dist.most_common(20)),
        },
        "bug_analysis": {
            "bug_labeled_count": len(bug_issues),
            "needs_repro_count": len(repro_needed),
            "recent_bugs": sorted(bug_issues, key=lambda x: x["inactive_days"])[:10],
        },
        "closure_velocity": {
            "closed_30d": len(closed_issues),
            "by_recent_day": dict(sorted(closed_by_day.items(), reverse=True)[:14]),
        },
        "recommendations": _recommendations(health, total, len(unlabeled_issues), bug_issues),
    }

    out = CONTEXT_DIR / "issue_health_report.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"[OK] Written: {out}")
    print(f"     Health: Active={health['Active']} Aging={health['Aging']} Stale={health['Stale']} Zombie={health['Zombie']}")
    print(f"     Bugs: {len(bug_issues)}, NeedsRepro: {len(repro_needed)}, Unlabeled: {len(unlabeled_issues)}")


def _recommendations(health: Counter, total: int, unlabeled: int, bugs: list) -> list[str]:
    recs = []
    zombie_pct = health["Zombie"] / max(total, 1)
    if zombie_pct > 0.4:
        recs.append(f"High zombie ratio ({zombie_pct:.0%}): consider bulk-closing 90d+ inactive issues with v2 timeline note")
    if unlabeled / max(total, 1) > 0.10:
        recs.append(f"{unlabeled} unlabeled issues ({unlabeled / total * 100:.0f}%) — triage needed")
    stale_bugs = [b for b in bugs if b["inactive_days"] > 14]
    if stale_bugs:
        recs.append(f"{len(stale_bugs)} BUG-labeled issues inactive 14+ days — review for closure or escalation")
    recs.append("Apply 'Blocked: v2' to feature requests deferred to v2 milestone")
    recs.append("Consider P1/P2/P3 priority labels for severity tracking")
    return recs


if __name__ == "__main__":
    main()
