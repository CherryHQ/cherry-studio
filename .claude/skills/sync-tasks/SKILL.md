---
name: sync-tasks
description: >
  Sync GitHub PRs with Feishu Bitable task management table. Use when asked to
  sync tasks, update task status from PRs, audit task breakdown, or run /sync-tasks.
  Supports milestone-based filtering. Handles: PR-to-task matching, status sync,
  author assignment, sub-task creation, and task quality audit.
---

# Sync Tasks

Sync GitHub PRs with the Feishu (Lark) Bitable v2 refactoring task table.

## Prerequisites

- `FEISHU_TENANT_TOKEN` env var must be set (2h TTL, refresh via Feishu auth API)
- `gh` CLI authenticated with access to the repo
- `.sync-tasks.config.json` in project root (copy from `.sync-tasks.config.example.json`)
- Python 3.9+ (stdlib only, no pip deps)

## Scripts

All scripts are in `.agents/skills/sync-tasks/scripts/`:

| Script | Purpose | Claude needed? |
|---|---|---|
| `feishu.py` | Feishu Bitable API client | No |
| `sync.py` | Deterministic PR-to-task sync | No |
| `audit.py` | Anomaly detection report | No (but Claude reviews output) |

## Workflow

### Step 1: Verify Environment

```bash
# Check token is set
echo "Token set: $([ -n \"$FEISHU_TENANT_TOKEN\" ] && echo yes || echo no)"

# Check config exists
ls .sync-tasks.config.json
```

### Step 2: Preview Changes (Dry Run)

```bash
python .agents/skills/sync-tasks/scripts/sync.py --dry-run [--milestone <name>]
```

Review the output. The script will show:
- How many PRs and tasks were found
- What changes would be made (PR links, status updates, assignee updates)
- Which PRs could not be matched to tasks

### Step 3: Confirm and Apply

**Interactive mode**: Ask the user to confirm before applying.
**CI mode**: Skip confirmation, apply directly.

```bash
python .agents/skills/sync-tasks/scripts/sync.py [--milestone <name>]
```

### Step 4: Run Audit

```bash
python .agents/skills/sync-tasks/scripts/audit.py [--milestone <name>] -o /tmp/audit-report.json
```

### Step 5: Review Audit Report

Read the audit report JSON. For each anomaly type:

- **conflict_no_dependency**: Ask user which task this conflicts with, update `依赖于` field
- **pending_with_open_pr**: Update status to `审核中`
- **completed_with_open_pr**: Verify PR state, update status if needed
- **large_pr_no_subtasks**: Read the PR diff (`gh pr diff <number> --stat`), evaluate if sub-tasks are needed, propose breakdown
- **unmatched_pr**: Propose creating a new task in Bitable, or adding to `task_pr_overrides` in config

### Step 6: Apply Audit Fixes

For status fixes and new tasks, use `feishu.py` directly:

```python
import sys
sys.path.insert(0, '.agents/skills/sync-tasks/scripts')
from feishu import FeishuClient

client = FeishuClient()
app_token = client.get_bitable_app_token(wiki_token)

# Update a record
client.batch_update(app_token, table_id, [
    {"record_id": "recXXX", "fields": {"进展": "审核中"}}
])

# Create a new task
client.batch_create(app_token, table_id, [
    {"fields": {"任务描述": "New task name", "进展": "待开始"}}
])
```

## Reference

See `references/field-mapping.md` for field IDs, types, and status options.

## CI Mode

When running in GitHub Actions (via `sync-tasks.yml` workflow):
- Skip all interactive confirmations
- Apply deterministic changes directly
- For audit findings requiring judgment, apply recommendations automatically
- Token is refreshed via the workflow's pre-step using `FEISHU_APP_ID` + `FEISHU_APP_SECRET`
