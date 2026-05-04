/**
 * Static reminder source — runs at message-build time, returns a
 * single block (or null) to prepend to the next user message. Pure /
 * idempotent; no agent-loop hooks. Reactive observers (bash-spiral,
 * file-churn, etc.) are a separate facility and live alongside the
 * existing internal observers under `agent/observers/`.
 */

export interface ReminderBlock {
  name: string
  content: string
}

export interface StaticReminderCtx {
  workspaceRoot: string | null
}

export type StaticReminderSource = (ctx: StaticReminderCtx) => Promise<ReminderBlock | null>
