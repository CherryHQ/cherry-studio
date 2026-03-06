# Feishu Bitable Field Mapping

This document records the field schema for the v2 refactoring task table.

## Table Info

- **Wiki Token**: Configured in `.sync-tasks.config.json`
- **Table ID**: Configured in `.sync-tasks.config.json`

## Field Mapping

| Display Name | Config Key | Feishu Type | Notes |
|---|---|---|---|
| 任务描述 | `task_name` | Text | Primary field, task title |
| 进展 | `status` | SingleSelect | Status of the task |
| 对应 PR | `pr` | Url | Link to GitHub PR |
| 任务执行人 | `assignee` | Url | GitHub profile link |
| 父记录 | `parent` | Link | Parent task record link |
| 依赖于 | `dependency` | Link | Dependency record links |
| 版本 | `version` | SingleSelect | Target version |
| 任务情况总结 | `summary` | Text | Summary notes |

## Status Options

| Value | Meaning | PR State Mapping |
|---|---|---|
| 已停滞 | Stalled | PR closed without merge |
| 待开始 | Not started | No PR yet |
| 进行中 | In progress | (manual) |
| 已完成 | Completed | PR merged |
| 审核中 | Under review | PR open |
| 存在冲突 | Has conflicts | (manual / audit) |

## Field Value Formats

### URL Field (`对应 PR`, `任务执行人`)

```json
{
  "text": "PR #1234",
  "link": "https://github.com/CherryHQ/cherry-studio/pull/1234"
}
```

### Linked Record (`父记录`, `依赖于`)

```json
["recXXXXXX"]
```

### SingleSelect (`进展`, `版本`)

Plain string matching one of the allowed options.

## Notes

- Field IDs may change if the table is recreated. Use `feishu.py` CLI to re-discover:
  ```bash
  FEISHU_TENANT_TOKEN=... python feishu.py <wiki_token> <table_id>
  ```
- The `task_pr_overrides` in config maps task names to PR numbers for cases where automatic matching fails.
