#!/usr/bin/env python3
"""Deterministic sync: match GitHub PRs to Feishu Bitable tasks.

Runs standalone (no Claude needed). Updates PR links, status, and assignees.

Usage:
    python sync.py [--milestone <name>] [--dry-run] [--config <path>]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Allow importing feishu.py from the same directory
sys.path.insert(0, str(Path(__file__).parent))

from feishu import FeishuClient  # noqa: E402

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[4] / ".sync-tasks.config.json"


def load_config(config_path: str | None = None) -> dict:
    """Load config from file, falling back to env vars."""
    path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
    if path.exists():
        with open(path) as f:
            return json.load(f)

    # Fallback: build config from env vars
    return {
        "feishu": {
            "wiki_token": os.environ.get("FEISHU_WIKI_TOKEN", ""),
            "table_id": os.environ.get("FEISHU_TABLE_ID", ""),
        },
        "github": {
            "repo": os.environ.get("GITHUB_REPO", "CherryHQ/cherry-studio"),
        },
        "field_mapping": {
            "task_name": "任务描述",
            "status": "进展",
            "pr": "对应 PR",
            "assignee": "任务执行人",
            "parent": "父记录",
            "dependency": "依赖于",
            "version": "版本",
            "summary": "任务情况总结",
        },
        "status_options": [
            "已停滞", "待开始", "进行中", "已完成", "审核中", "存在冲突",
        ],
        "task_pr_overrides": {},
    }


# ------------------------------------------------------------------
# GitHub PR fetching
# ------------------------------------------------------------------

def fetch_prs(repo: str, milestone: str | None = None) -> list[dict]:
    """Fetch PRs from GitHub using `gh pr list`."""
    cmd = [
        "gh", "pr", "list",
        "--repo", repo,
        "--state", "all",
        "--limit", "500",
        "--json", "number,title,state,author,url,milestone,changedFiles",
    ]
    if milestone:
        cmd.extend(["--search", f"milestone:{milestone}"])

    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    prs = json.loads(result.stdout)

    # Filter to only PRs with a milestone (unless searching specific one)
    if not milestone:
        prs = [pr for pr in prs if pr.get("milestone")]

    return prs


# ------------------------------------------------------------------
# Matching logic
# ------------------------------------------------------------------

def build_task_index(records: list[dict], field_map: dict) -> dict:
    """Build lookup indices from Bitable records.

    Returns dict with:
        by_name: {task_name_lower: record}
        by_pr_number: {pr_number: record}
        all: [records]
    """
    by_name: dict[str, dict] = {}
    by_pr_number: dict[int, dict] = {}

    for rec in records:
        fields = rec.get("fields", {})
        name = fields.get(field_map["task_name"], "")
        if isinstance(name, list):
            # Text fields can be [{type, text}] in Bitable
            name = "".join(
                seg.get("text", "") if isinstance(seg, dict) else str(seg)
                for seg in name
            )
        name = str(name).strip()

        if name:
            by_name[name.lower()] = rec

        # Index by existing PR link
        pr_field = fields.get(field_map["pr"])
        if pr_field:
            link = ""
            if isinstance(pr_field, dict):
                link = pr_field.get("link", "")
            elif isinstance(pr_field, str):
                link = pr_field
            if "/pull/" in link:
                try:
                    pr_num = int(link.rstrip("/").split("/pull/")[-1])
                    by_pr_number[pr_num] = rec
                except (ValueError, IndexError):
                    pass

    return {"by_name": by_name, "by_pr_number": by_pr_number, "all": records}


def match_pr_to_task(
    pr: dict,
    task_index: dict,
    overrides: dict[str, int],
) -> dict | None:
    """Try to match a PR to a Bitable task record.

    Priority:
    1. Existing PR link in Bitable matches this PR number
    2. Override mapping (task_name -> PR number)
    3. PR title keyword match against task names
    """
    pr_number = pr["number"]

    # 1. Already linked
    if pr_number in task_index["by_pr_number"]:
        return task_index["by_pr_number"][pr_number]

    # 2. Override mapping (reverse: find task name for this PR number)
    for task_name, mapped_pr in overrides.items():
        if mapped_pr == pr_number:
            key = task_name.lower()
            if key in task_index["by_name"]:
                return task_index["by_name"][key]

    # 3. Keyword match: check if any task name appears in PR title
    pr_title = pr.get("title", "").lower()
    for task_name_lower, record in task_index["by_name"].items():
        # Skip very short task names to avoid false matches
        if len(task_name_lower) < 3:
            continue
        if task_name_lower in pr_title:
            return record

    return None


# ------------------------------------------------------------------
# Status mapping
# ------------------------------------------------------------------

PR_STATE_TO_STATUS = {
    "MERGED": "已完成",
    "OPEN": "审核中",
    "CLOSED": "已停滞",
}


def compute_status(pr: dict) -> str:
    """Map PR state to Bitable status."""
    state = pr.get("state", "OPEN")
    return PR_STATE_TO_STATUS.get(state, "进行中")


# ------------------------------------------------------------------
# Sync engine
# ------------------------------------------------------------------

def compute_changes(
    prs: list[dict],
    task_index: dict,
    field_map: dict,
    overrides: dict[str, int],
    repo: str,
) -> list[dict]:
    """Compute the list of record updates needed.

    Returns list of {record_id, fields, pr, reason} dicts.
    """
    changes: list[dict] = []
    unmatched: list[dict] = []

    for pr in prs:
        task = match_pr_to_task(pr, task_index, overrides)
        if not task:
            unmatched.append(pr)
            continue

        record_id = task["record_id"]
        fields = task.get("fields", {})
        updates: dict = {}
        reasons: list[str] = []

        # Update PR link if missing or different
        pr_url = pr.get("url", f"https://github.com/{repo}/pull/{pr['number']}")
        existing_pr = fields.get(field_map["pr"])
        existing_link = ""
        if isinstance(existing_pr, dict):
            existing_link = existing_pr.get("link", "")
        elif isinstance(existing_pr, str):
            existing_link = existing_pr

        if existing_link != pr_url:
            updates[field_map["pr"]] = FeishuClient.url_field(
                f"PR #{pr['number']}", pr_url
            )
            reasons.append("set PR link")

        # Update status
        new_status = compute_status(pr)
        current_status = fields.get(field_map["status"], "")
        # Don't downgrade 已完成 to other states, and don't override 存在冲突
        if current_status not in ("已完成", "存在冲突") and current_status != new_status:
            updates[field_map["status"]] = new_status
            reasons.append(f"status: {current_status} -> {new_status}")

        # Update assignee
        author = pr.get("author", {})
        author_login = author.get("login", "") if isinstance(author, dict) else ""
        if author_login:
            author_url = f"https://github.com/{author_login}"
            existing_assignee = fields.get(field_map["assignee"])
            existing_assignee_link = ""
            if isinstance(existing_assignee, dict):
                existing_assignee_link = existing_assignee.get("link", "")
            elif isinstance(existing_assignee, str):
                existing_assignee_link = existing_assignee

            if existing_assignee_link != author_url:
                updates[field_map["assignee"]] = FeishuClient.url_field(
                    f"@{author_login}", author_url
                )
                reasons.append(f"assignee: @{author_login}")

        if updates:
            changes.append({
                "record_id": record_id,
                "fields": updates,
                "pr": pr["number"],
                "reasons": reasons,
            })

    return changes


def run_sync(
    config: dict,
    milestone: str | None = None,
    dry_run: bool = False,
) -> dict:
    """Execute the full sync flow. Returns a report dict."""
    repo = config["github"]["repo"]
    field_map = config["field_mapping"]
    overrides = config.get("task_pr_overrides", {})
    wiki_token = config["feishu"]["wiki_token"]
    table_id = config["feishu"]["table_id"]

    # 1. Fetch PRs
    print(f"Fetching PRs from {repo}...")
    prs = fetch_prs(repo, milestone)
    print(f"  Found {len(prs)} PRs" + (f" for milestone '{milestone}'" if milestone else ""))

    # 2. Fetch Bitable records
    print("Connecting to Feishu Bitable...")
    client = FeishuClient()
    app_token = client.get_bitable_app_token(wiki_token)
    records = client.list_records(app_token, table_id)
    print(f"  Found {len(records)} task records")

    # 3. Build index and compute changes
    task_index = build_task_index(records, field_map)
    changes = compute_changes(prs, task_index, field_map, overrides, repo)

    # 4. Find unmatched PRs
    matched_pr_numbers = {c["pr"] for c in changes}
    # Also include PRs already correctly linked
    for pr in prs:
        if pr["number"] in task_index["by_pr_number"]:
            matched_pr_numbers.add(pr["number"])
    unmatched_prs = [pr for pr in prs if pr["number"] not in matched_pr_numbers]

    report = {
        "total_prs": len(prs),
        "total_tasks": len(records),
        "changes": [
            {
                "record_id": c["record_id"],
                "pr": c["pr"],
                "reasons": c["reasons"],
                "fields": {k: str(v)[:100] for k, v in c["fields"].items()},
            }
            for c in changes
        ],
        "unmatched_prs": [
            {"number": pr["number"], "title": pr.get("title", "")}
            for pr in unmatched_prs
        ],
        "dry_run": dry_run,
    }

    # 5. Apply changes
    if changes and not dry_run:
        print(f"\nApplying {len(changes)} updates...")
        update_records = [
            {"record_id": c["record_id"], "fields": c["fields"]}
            for c in changes
        ]
        # Batch update in chunks of 500 (Feishu limit)
        for i in range(0, len(update_records), 500):
            batch = update_records[i:i + 500]
            client.batch_update(app_token, table_id, batch)
        print("  Done.")
    elif changes:
        print(f"\n[DRY RUN] Would apply {len(changes)} updates:")
        for c in changes:
            print(f"  PR #{c['pr']}: {', '.join(c['reasons'])}")
    else:
        print("\nNo changes needed.")

    if unmatched_prs:
        print(f"\n{len(unmatched_prs)} PRs could not be matched to tasks:")
        for pr in unmatched_prs[:10]:
            print(f"  #{pr['number']}: {pr.get('title', '')}")
        if len(unmatched_prs) > 10:
            print(f"  ... and {len(unmatched_prs) - 10} more")

    return report


# ------------------------------------------------------------------
# CLI
# ------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Sync GitHub PRs with Feishu Bitable task table"
    )
    parser.add_argument("--milestone", help="Filter PRs by milestone name")
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without writing"
    )
    parser.add_argument(
        "--config", help="Path to config file (default: .sync-tasks.config.json)"
    )
    parser.add_argument(
        "--json-output", help="Write report to JSON file"
    )

    args = parser.parse_args()
    config = load_config(args.config)
    report = run_sync(config, milestone=args.milestone, dry_run=args.dry_run)

    if args.json_output:
        with open(args.json_output, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"\nReport written to {args.json_output}")

    # Exit with non-zero if there were unmatched PRs (useful for CI)
    if report["unmatched_prs"]:
        sys.exit(0)  # Non-fatal, just informational


if __name__ == "__main__":
    main()
