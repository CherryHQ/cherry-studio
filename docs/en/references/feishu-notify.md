# Feishu Notification Script

`scripts/feishu-notify.ts` is a CLI tool for sending notifications to Feishu (Lark) Webhook. This script is primarily used in GitHub Actions workflows to enable automatic notifications.

## Features

- Subcommand-based CLI structure for different notification types
- HMAC-SHA256 signature verification
- Sends Feishu interactive card messages
- Full TypeScript type support
- Credentials via environment variables for security

## Usage

### Prerequisites

```bash
pnpm install
```

### CLI Structure

```bash
pnpm tsx scripts/feishu-notify.ts [command] [options]
```

### Environment Variables (Required)

| Variable | Description |
|----------|-------------|
| `FEISHU_WEBHOOK_URL` | Feishu Webhook URL |
| `FEISHU_WEBHOOK_SECRET` | Feishu Webhook signing secret |

## Commands

### `send` - Send Simple Notification

Send a generic notification without business-specific logic.

```bash
pnpm tsx scripts/feishu-notify.ts send [options]
```

| Option | Short | Description | Required |
|--------|-------|-------------|----------|
| `--title` | `-t` | Card title | Yes |
| `--description` | `-d` | Card description (supports markdown) | Yes |
| `--color` | `-c` | Header color template | No (default: turquoise) |

**Available colors:** `blue`, `wathet`, `turquoise`, `green`, `yellow`, `orange`, `red`, `carmine`, `violet`, `purple`, `indigo`, `grey`, `default`

#### Example

```bash
# Use $'...' syntax for proper newlines
pnpm tsx scripts/feishu-notify.ts send \
  -t "Deployment Completed" \
  -d $'**Status:** Success\n\n**Environment:** Production\n\n**Version:** v1.2.3' \
  -c green
```

```bash
# Send an error alert (red color)
pnpm tsx scripts/feishu-notify.ts send \
  -t "Error Alert" \
  -d $'**Error Type:** Connection failed\n\n**Severity:** High\n\nPlease check the system status' \
  -c red
```

**Note:** For proper newlines in the description, use bash's `$'...'` syntax. Do not use literal `\n` in double quotes, as it will be displayed as-is in the Feishu card.

### `issue` - Send GitHub Issue Notification

```bash
pnpm tsx scripts/feishu-notify.ts issue [options]
```

| Option | Short | Description | Required |
|--------|-------|-------------|----------|
| `--url` | `-u` | GitHub issue URL | Yes |
| `--number` | `-n` | Issue number | Yes |
| `--title` | `-t` | Issue title | Yes |
| `--summary` | `-m` | Issue summary | Yes |
| `--author` | `-a` | Issue author | No (default: "Unknown") |
| `--labels` | `-l` | Issue labels (comma-separated) | No |

#### Example

```bash
pnpm tsx scripts/feishu-notify.ts issue \
  -u "https://github.com/owner/repo/issues/123" \
  -n "123" \
  -t "Bug: Something is broken" \
  -m "This is a bug report about a feature" \
  -a "username" \
  -l "bug,high-priority"
```

## Usage in GitHub Actions

This script is primarily used in `.github/workflows/github-issue-tracker.yml`:

```yaml
- name: Install dependencies
  run: pnpm install

- name: Send notification
  run: |
    pnpm tsx scripts/feishu-notify.ts issue \
      -u "${{ github.event.issue.html_url }}" \
      -n "${{ github.event.issue.number }}" \
      -t "${{ github.event.issue.title }}" \
      -a "${{ github.event.issue.user.login }}" \
      -l "${{ join(github.event.issue.labels.*.name, ',') }}" \
      -m "Issue summary content"
  env:
    FEISHU_WEBHOOK_URL: ${{ secrets.FEISHU_WEBHOOK_URL }}
    FEISHU_WEBHOOK_SECRET: ${{ secrets.FEISHU_WEBHOOK_SECRET }}
```

## Feishu Card Message Format

The `issue` command sends an interactive card containing:

- **Header**: `#<issue_number> - <issue_title>`
- **Author**: Issue creator
- **Labels**: Issue labels (if any)
- **Summary**: Issue content summary
- **Action Button**: "View Issue" button linking to the GitHub Issue page

## Configuring Feishu Webhook

1. Add a custom bot to your Feishu group
2. Obtain the Webhook URL and signing secret
3. Configure them in GitHub Secrets:
   - `FEISHU_WEBHOOK_URL`: Webhook address
   - `FEISHU_WEBHOOK_SECRET`: Signing secret

## Error Handling

The script exits with a non-zero code when:

- Required environment variables are missing (`FEISHU_WEBHOOK_URL`, `FEISHU_WEBHOOK_SECRET`)
- Required command options are missing
- Feishu API returns a non-2xx status code
- Network request fails

## Extending with New Commands

The CLI is designed to support multiple notification types. To add a new command:

1. Define the command options interface
2. Create a card builder function
3. Add a new command handler
4. Register the command with `program.command()`
