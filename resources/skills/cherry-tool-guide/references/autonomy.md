# Autonomy: scheduling, notification, and channels

Covers `mcp__cherry-tools__cron`, `mcp__cherry-tools__notify`, and
`mcp__cherry-tools__config`. These three form **one channel-delivery workflow**:
`config` connects the IM channels, `cron` schedules work that can deliver to them, and
`notify` pushes messages/files through them.

Get exact argument shapes from the live tool schema — this reference gives routing,
sequencing, prerequisites, and safety only.

## Intent gate

Schedule changes, notifications, and agent/channel configuration may execute **without
an approval card**. Don't call them merely because they're available — first confirm the
user requested the effect or it's necessary to complete an already-approved task.

## Scheduling — `mcp__cherry-tools__cron`

Schedules work **inside Cherry**. Never use OS `crontab`, `at`, or a background shell
loop for user-facing schedules — Cherry owns execution, delivery, and lifecycle.

Actions:

- **`add`** — a recurring or one-time job. A job needs **exactly one trigger shape**
  (recurring expression, interval, or a single future timestamp) — consult the schema
  for which fields express that.
- **`list`** — existing jobs.
- **`remove`** — delete a job.

Jobs can deliver their results to channels (see notify/config below), so scheduling a
report that lands in Telegram is a single `cron` job, not a hand-rolled OS cron entry
plus a separate send.

## Notification — `mcp__cherry-tools__notify`

Proactively sends the user a message and/or a workspace file through **connected
channels** — use it to push a result, status update, or produced file without waiting to
be asked.

- **Requires at least one connected channel.** `notify` stays listed even with none; it
  then reports that no channel is connected. Route the user to
  `mcp__cherry-tools__config` / settings rather than retrying.
- **File support varies by channel** — some forward any file, some images only, some
  none yet. The tool reports per-channel outcomes; relay them honestly.

`notify` pushes a message/file *through a channel*. To merely register a produced file as
a deliverable in the Cherry UI (no channel send), that's `report_artifacts` — a different
tool; see [outputs.md](outputs.md).

## Channels & self-config — `mcp__cherry-tools__config`

Inspects and manages the agent's own configuration.

**Always `status` first.** It lists current channels (with connection state), the model,
and the adapter types you can add — so you act on real IDs instead of guessing.

Then:

- **`add_channel`** — connect a new IM channel (Telegram, Feishu, Discord, Slack,
  WeChat, QQ). Credential-based types need their fields; WeChat/Feishu can use QR mode.
- **`update_channel`** / **`remove_channel`** — change or delete an existing channel by
  ID.
- **`reconnect_channel`** — re-establish a dropped channel; for WeChat/Feishu this
  re-issues a QR code to re-scan (expired session or failed initial setup).
- **`rename`** the agent, or **`complete_bootstrap`** / **`reset_bootstrap`** onboarding.

**When a channel needs a QR scan**, the tool returns the QR image — display it to the
user and let them scan; the connection completes out of band. Confirm with a follow-up
`status`.

## Recovery

- **Missing configuration** (no connected channel) → tell the user to set one up via
  `mcp__cherry-tools__config` / settings; don't retry `notify` blindly.
- **Unsupported channel/file** → `notify` reports it per channel; adjust rather than
  resending the same payload.
- **Tool error result** → read the message and correct the call; don't silently retry.

## Examples

**Schedule a report and notify on completion**
> "Every weekday morning, summarize my unread items and send it to Telegram."

`mcp__cherry-tools__config` (`status`) to confirm a Telegram channel is connected →
`mcp__cherry-tools__cron` (`add`) a recurring weekday job whose prompt builds the summary,
delivering to that channel. The scheduled run does the work and delivery; you don't
hand-roll an OS cron entry.

**Connect an IM channel**
> "Hook me up to Slack so you can message me there."

`mcp__cherry-tools__config` (`status`) to see supported types and existing channels →
`mcp__cherry-tools__config` (`add_channel`, type Slack) with the required credentials from
the schema → confirm it shows connected in a follow-up `status`. Later,
`mcp__cherry-tools__notify` to message the user there.
