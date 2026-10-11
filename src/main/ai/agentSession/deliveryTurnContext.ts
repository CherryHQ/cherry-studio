import type { AgentSessionDelivery } from '@shared/ai/agentSessionDelivery'

import { defangSystemReminderTags, sanitizeUntrustedText } from '../untrustedContent'

/**
 * Host-authored context for the runtime user message of a delivery-triggered turn.
 *
 * The durable delivery row keeps the sender's content verbatim (it is what the renderer and
 * `session_deliveries` show), so the receiver model would otherwise see a bare user message and
 * have no way to learn the delivery contract: that delegation tools are denied in this turn and
 * that a `completion` request returns this turn's final output to the sender automatically.
 * Observed behavior without it: the receiver calls `session_send` to answer, is denied by the
 * headless guard, then burns further channels (built-in messengers, notifications) before
 * falling back to asking the human user to intervene.
 *
 * The text is materialized only when a driver builds its runtime input
 * (`wrapAgentSessionDeliveryContent`), from the host-owned `delivery` metadata on the row — it is
 * never written into the message parts, so persistence, naming, and trace keep reading raw
 * sender content.
 */
export function buildDeliveryTurnContextText(delivery: AgentSessionDelivery): string {
  // Names are user-editable display snapshots placed inside a trusted reminder boundary, so
  // normalize first (sanitize maps fullwidth angle brackets to ASCII) and then defang the
  // reminder delimiters themselves.
  const senderAgent = defangSystemReminderTags(
    sanitizeUntrustedText(delivery.senderSnapshot?.agentName?.trim() || delivery.sender.agentId)
  )
  const senderSession = defangSystemReminderTags(
    sanitizeUntrustedText(delivery.senderSnapshot?.sessionName?.trim() || delivery.sender.sessionId)
  )
  const replyContract =
    delivery.replyPolicy === 'completion'
      ? "Reply policy: completion — the sender asked for this turn's result, and your final assistant output is returned to the sender's Session automatically as the delivery result. That output is the reply channel: write your answer as this turn's normal output."
      : "Reply policy: none — nothing is returned to the sender's Session automatically."
  return [
    '<system-reminder>',
    `This turn was started by a cross-Session delivery, not by the human user. Sender: Agent "${senderAgent}" / Session "${senderSession}" (sessionId ${delivery.sender.sessionId}).`,
    replyContract,
    "Cross-Session delegation tools (session_send, session_create) are denied in delivery-triggered turns: this turn has no interactive responder to grant their required live per-call user approval, so calling them cannot succeed. Do not try them, built-in messengers, or other cross-Session channels to answer — everything the sender needs goes into this turn's final output.",
    '</system-reminder>'
  ].join('\n')
}
