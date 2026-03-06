#!/usr/bin/env python3
"""Audit report generator for Feishu Bitable task quality.

Detects anomalies in task data and generates a structured JSON report
for Claude (or a human) to review and act on.

Usage:
    python audit.py [--milestone <name>] [--config <path>]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from feishu import FeishuClient  # noqa: E402
from sync import (  # noqa: E402
    DEFAULT_CONFIG_PATH,
    build_task_index,
    fetch_prs,
    load_config,
    match_pr_to_task,
)

# ------------------------------------------------------------------
# Anomaly detectors
# ------------------------------------------------------------------


def detect_conflict_without_dependency(
    records: list[dict], field_map: dict
) -> list[dict]:
    """Tasks marked '存在冲突' but missing '依赖于' field."""
    anomalies = []
    for rec in records:
        fields = rec.get("fields", {})
        status = fields.get(field_map["status"], "")
        deps = fields.get(field_map["dependency"])
        if status == "存在冲突" and not deps:
            anomalies.append({
                "type": "conflict_no_dependency",
                "record_id": rec["record_id"],
                "task_name": _extract_text(fields.get(field_map["task_name"], "")),
                "message": "Task marked as '存在冲突' but has no '依赖于' value",
            })
    return anomalies


def detect_pending_with_open_pr(
    records: list[dict], field_map: dict, pr_index: dict[int, dict]
) -> list[dict]:
    """Tasks marked '待开始' but have an OPEN PR."""
    anomalies = []
    for rec in records:
        fields = rec.get("fields", {})
        status = fields.get(field_map["status"], "")
        if status != "待开始":
            continue

        pr_field = fields.get(field_map["pr"])
        if not pr_field:
            continue

        link = ""
        if isinstance(pr_field, dict):
            link = pr_field.get("link", "")
        elif isinstance(pr_field, str):
            link = pr_field

        if "/pull/" in link:
            try:
                pr_num = int(link.rstrip("/").split("/pull/")[-1])
                pr = pr_index.get(pr_num)
                if pr and pr.get("state") == "OPEN":
                    anomalies.append({
                        "type": "pending_with_open_pr",
                        "record_id": rec["record_id"],
                        "task_name": _extract_text(
                            fields.get(field_map["task_name"], "")
                        ),
                        "pr_number": pr_num,
                        "message": f"Task is '待开始' but PR #{pr_num} is OPEN",
                        "suggested_status": "审核中",
                    })
            except (ValueError, IndexError):
                pass
    return anomalies


def detect_completed_with_open_pr(
    records: list[dict], field_map: dict, pr_index: dict[int, dict]
) -> list[dict]:
    """Tasks marked '已完成' but PR is still OPEN."""
    anomalies = []
    for rec in records:
        fields = rec.get("fields", {})
        status = fields.get(field_map["status"], "")
        if status != "已完成":
            continue

        pr_field = fields.get(field_map["pr"])
        if not pr_field:
            continue

        link = ""
        if isinstance(pr_field, dict):
            link = pr_field.get("link", "")
        elif isinstance(pr_field, str):
            link = pr_field

        if "/pull/" in link:
            try:
                pr_num = int(link.rstrip("/").split("/pull/")[-1])
                pr = pr_index.get(pr_num)
                if pr and pr.get("state") == "OPEN":
                    anomalies.append({
                        "type": "completed_with_open_pr",
                        "record_id": rec["record_id"],
                        "task_name": _extract_text(
                            fields.get(field_map["task_name"], "")
                        ),
                        "pr_number": pr_num,
                        "message": f"Task is '已完成' but PR #{pr_num} is still OPEN",
                        "suggested_status": "审核中",
                    })
            except (ValueError, IndexError):
                pass
    return anomalies


def detect_large_pr_without_subtasks(
    records: list[dict],
    field_map: dict,
    pr_index: dict[int, dict],
    repo: str,
    threshold: int = 50,
) -> list[dict]:
    """Parent tasks with large PRs (50+ changed files) but no sub-tasks."""
    anomalies = []

    # Build set of record_ids that are parents (have children linking to them)
    parent_ids: set[str] = set()
    child_of: dict[str, list[str]] = {}  # parent_id -> [child_record_ids]
    for rec in records:
        fields = rec.get("fields", {})
        parent_field = fields.get(field_map["parent"])
        if parent_field:
            parent_links = parent_field if isinstance(parent_field, list) else []
            for link in parent_links:
                pid = link if isinstance(link, str) else link.get("record_id", "")
                if pid:
                    parent_ids.add(pid)
                    child_of.setdefault(pid, []).append(rec["record_id"])

    for rec in records:
        fields = rec.get("fields", {})
        record_id = rec["record_id"]

        # Only check tasks that have a PR link
        pr_field = fields.get(field_map["pr"])
        if not pr_field:
            continue

        link = ""
        if isinstance(pr_field, dict):
            link = pr_field.get("link", "")
        elif isinstance(pr_field, str):
            link = pr_field

        if "/pull/" not in link:
            continue

        try:
            pr_num = int(link.rstrip("/").split("/pull/")[-1])
        except (ValueError, IndexError):
            continue

        pr = pr_index.get(pr_num)
        if not pr:
            continue

        changed_files = pr.get("changedFiles", 0)
        has_children = record_id in parent_ids

        if changed_files >= threshold and not has_children:
            # Fetch diff stat for more detail
            diff_stat = _get_pr_diff_stat(repo, pr_num)
            anomalies.append({
                "type": "large_pr_no_subtasks",
                "record_id": record_id,
                "task_name": _extract_text(
                    fields.get(field_map["task_name"], "")
                ),
                "pr_number": pr_num,
                "changed_files": changed_files,
                "diff_stat": diff_stat,
                "message": (
                    f"PR #{pr_num} touches {changed_files} files but task "
                    f"has no sub-tasks. Consider breaking down."
                ),
            })

    return anomalies


def detect_unmatched_prs(
    prs: list[dict], task_index: dict, overrides: dict[str, int]
) -> list[dict]:
    """PRs with milestone but no matching task in Bitable."""
    anomalies = []
    for pr in prs:
        task = match_pr_to_task(pr, task_index, overrides)
        if not task:
            milestone = pr.get("milestone", {})
            milestone_title = (
                milestone.get("title", "") if isinstance(milestone, dict) else ""
            )
            anomalies.append({
                "type": "unmatched_pr",
                "pr_number": pr["number"],
                "pr_title": pr.get("title", ""),
                "pr_state": pr.get("state", ""),
                "milestone": milestone_title,
                "message": (
                    f"PR #{pr['number']} ({pr.get('title', '')}) has milestone "
                    f"'{milestone_title}' but no matching task in Bitable"
                ),
            })
    return anomalies


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _extract_text(value) -> str:
    """Extract plain text from a Bitable field value."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(
            seg.get("text", "") if isinstance(seg, dict) else str(seg)
            for seg in value
        )
    return str(value)


def _get_pr_diff_stat(repo: str, pr_number: int) -> str:
    """Get `--stat` output for a PR diff."""
    try:
        result = subprocess.run(
            ["gh", "pr", "diff", str(pr_number), "--repo", repo, "--stat"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            # Return last few lines (summary)
            lines = result.stdout.strip().split("\n")
            return "\n".join(lines[-5:]) if len(lines) > 5 else result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return ""


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------


def run_audit(
    config: dict,
    milestone: str | None = None,
) -> dict:
    """Run all anomaly detectors and return structured report."""
    repo = config["github"]["repo"]
    field_map = config["field_mapping"]
    overrides = config.get("task_pr_overrides", {})
    wiki_token = config["feishu"]["wiki_token"]
    table_id = config["feishu"]["table_id"]

    # Fetch data
    print("Fetching PRs...")
    prs = fetch_prs(repo, milestone)
    print(f"  Found {len(prs)} PRs")

    print("Fetching Bitable records...")
    client = FeishuClient()
    app_token = client.get_bitable_app_token(wiki_token)
    records = client.list_records(app_token, table_id)
    print(f"  Found {len(records)} records")

    # Build indices
    task_index = build_task_index(records, field_map)
    pr_index = {pr["number"]: pr for pr in prs}

    # Run detectors
    print("\nRunning anomaly detectors...")
    anomalies: list[dict] = []

    detectors = [
        ("conflict_no_dependency", lambda: detect_conflict_without_dependency(records, field_map)),
        ("pending_with_open_pr", lambda: detect_pending_with_open_pr(records, field_map, pr_index)),
        ("completed_with_open_pr", lambda: detect_completed_with_open_pr(records, field_map, pr_index)),
        ("large_pr_no_subtasks", lambda: detect_large_pr_without_subtasks(records, field_map, pr_index, repo)),
        ("unmatched_prs", lambda: detect_unmatched_prs(prs, task_index, overrides)),
    ]

    for name, detector in detectors:
        results = detector()
        anomalies.extend(results)
        if results:
            print(f"  {name}: {len(results)} issues found")

    report = {
        "summary": {
            "total_prs": len(prs),
            "total_tasks": len(records),
            "total_anomalies": len(anomalies),
            "by_type": {},
        },
        "anomalies": anomalies,
    }

    # Count by type
    for a in anomalies:
        t = a["type"]
        report["summary"]["by_type"][t] = report["summary"]["by_type"].get(t, 0) + 1

    print(f"\nTotal anomalies: {len(anomalies)}")
    return report


def main():
    parser = argparse.ArgumentParser(
        description="Audit Feishu Bitable task data for anomalies"
    )
    parser.add_argument("--milestone", help="Filter PRs by milestone name")
    parser.add_argument("--config", help="Path to config file")
    parser.add_argument(
        "--output", "-o", default="-",
        help="Output file (default: stdout)"
    )

    args = parser.parse_args()
    config = load_config(args.config)
    report = run_audit(config, milestone=args.milestone)

    output = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output == "-":
        print(output)
    else:
        with open(args.output, "w") as f:
            f.write(output)
        print(f"\nReport written to {args.output}")


if __name__ == "__main__":
    main()
