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
- **`update`** — edit an existing job by ID. Supply only changed fields; omitted fields
  keep their values. Use this to edit prompts instead of removing and re-creating jobs.
- **`list`** — existing jobs owned by the current Agent.
- **`remove`** — delete a job.

`reuse_session` on `add` / `update` controls whether executions continue in the same
session. It defaults to false on add; omission on update preserves the setting.
For delivery, omitting `channel_ids` on update preserves recipients; `[]` clears them.

Names are unique across all Agents, including disabled jobs. If a name conflict is
not visible in `list`, choose a different name or inspect Settings > Scheduled Tasks.
Use `update` with an owned job ID when editing an existing task.

Jobs can deliver their results to channels (see notify/config below), so scheduling a
report that lands in Telegram is a single `cron` job, not a hand-rolled OS cron entry
plus a separate send.

Omit `channel_ids` to save this turn's configured recipients on the task; use `[]` for
no channel delivery. Explicit IDs follow the same recipient policy as `notify` below.
A task created without channels has no notification recipients until the user adds
channels in the scheduled-task editor's "Send to Channels" field.

## Notification — `mcp__cherry-tools__notify`

Proactively sends the user a message and/or a workspace file through **connected
channels** — use it to push a result, status update, or produced file without waiting to
be asked.

- **Requires configured recipients for this turn.** `notify` is absent otherwise:
  desktop turns and brand-new Sessions have none. A channel-originated Session uses
  its source channel; a scheduled run uses exactly the task's configured channels,
  snapshotted at run start. An offline configured channel does not hide the tool,
  but delivery requires a connection.
- **Omit `channel_id` to deliver to all configured recipients**, listed in the tool
  description. An explicit ID outside that set is refused with a policy error, never
  silently redirected. Only a channel-originated Session may additionally select
  another live channel owned by the same Agent.
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

- **`notify` absent** → this session/turn has no configured recipients; don't seek a
  workaround. To route scheduled results to a channel, create the task from that
  channel's conversation: omit `channel_ids` to save its source channel, or supply
  explicit `channel_ids` from a channel-originated Session. A desktop turn cannot
  authorize explicit channel IDs. Alternatively, ask the user to set the task's
  channels in the scheduled-task editor's "Send to Channels" field; it lists the
  owning Agent's channels.
  Use `mcp__cherry-tools__config` (`status`) to inspect owned channels and connection state.
- **Recipient policy error naming a channel** → the ID is outside this turn's allowed
  recipients; select a configured one or omit `channel_id` (`channel_ids` for `cron`).
- **Configured recipient unavailable** → inspect its connection with `config` (`status`)
  and reconnect it; an offline recipient remains configured.
- **Unsupported channel/file** → `notify` reports it per channel; adjust rather than
  resending the same payload.
- **Tool error result** → read the message and correct the call; don't silently retry.

## Examples

**Schedule a report and notify on completion**
> "Every weekday morning, summarize my unread items and send it to Telegram."

From the Telegram channel's conversation, use `mcp__cherry-tools__config` (`status`)
to confirm the channel is connected →
`mcp__cherry-tools__cron` (`add`) a recurring weekday job whose prompt builds the summary,
omitting `channel_ids` to save that channel as its recipient. The scheduled run does the
work and delivery; you don't hand-roll an OS cron entry.

**Connect an IM channel**
> "Hook me up to Slack so you can message me there."

`mcp__cherry-tools__config` (`status`) to see supported types and existing channels →
`mcp__cherry-tools__config` (`add_channel`, type Slack) with the required credentials from
the schema → confirm it shows connected in a follow-up `status`. Continue from that
channel's conversation to use `mcp__cherry-tools__notify` there; connecting a channel
does not grant a desktop turn notification recipients.
