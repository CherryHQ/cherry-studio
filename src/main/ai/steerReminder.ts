/**
 * Wrap a steer message — one the user sent while the assistant was already working — so the model
 * treats it as a mid-task redirect rather than a fresh prompt (invariant 7). Mirrors opencode's
 * `insertReminders`. Shared by both runtimes: chat wraps it into the rebuilt model history; the
 * claudeCode driver wraps it as it pushes into the live streaming-input queue.
 */
const SYSTEM_REMINDER_OPEN = '<system-reminder>'
const SYSTEM_REMINDER_CLOSE = '</system-reminder>'

export function wrapSteerReminder(text: string): string {
  // Defang any literal <system-reminder> open/close tags in the user text by escaping their `<`, so a
  // steer containing `</system-reminder>` can't terminate the wrapper and forge reminder-priority
  // instructions. Only the exact delimiter is touched; ordinary `<`/`>` in the message are preserved.
  const safe = text.replace(/<(\/?\s*system-reminder\b[^>]*)>/gi, '&lt;$1>')
  return [
    SYSTEM_REMINDER_OPEN,
    'The user sent the following message:',
    safe,
    '',
    'Please address this message and continue with your tasks.',
    SYSTEM_REMINDER_CLOSE
  ].join('\n')
}

/** Extract complete reminder bodies from a trusted SDK synthetic message. */
export function extractSystemReminderBodies(text: string): string[] {
  const bodies: string[] = []
  let searchFrom = 0

  while (searchFrom < text.length) {
    const openIndex = text.indexOf(SYSTEM_REMINDER_OPEN, searchFrom)
    if (openIndex === -1) break
    const bodyStart = openIndex + SYSTEM_REMINDER_OPEN.length
    const closeIndex = text.indexOf(SYSTEM_REMINDER_CLOSE, bodyStart)
    if (closeIndex === -1) break
    const body = text.slice(bodyStart, closeIndex).trim()
    if (body) bodies.push(body)
    searchFrom = closeIndex + SYSTEM_REMINDER_CLOSE.length
  }

  return bodies
}

function markerPrefixSuffixLength(text: string, markers: readonly string[]): number {
  const maxLength = Math.max(...markers.map((marker) => marker.length - 1))
  for (let length = Math.min(text.length, maxLength); length > 0; length--) {
    const suffix = text.slice(-length)
    if (markers.some((marker) => marker.startsWith(suffix))) return length
  }
  return 0
}

/**
 * Removes complete system-reminder segments and exact bodies observed in SDK synthetic input from
 * one streamed assistant text part. An unmatched opening tag is restored by `flush`, so ordinary or
 * truncated text is never discarded merely for resembling the internal delimiter.
 */
export class SystemReminderTextFilter {
  private pending = ''
  private insideReminder = false

  constructor(private readonly reminderBodies: ReadonlySet<string> = new Set()) {}

  write(text: string): string {
    this.pending += text
    let safe = ''

    while (this.pending) {
      if (this.insideReminder) {
        const closeIndex = this.pending.indexOf(SYSTEM_REMINDER_CLOSE)
        if (closeIndex === -1) return safe
        this.pending = this.pending.slice(closeIndex + SYSTEM_REMINDER_CLOSE.length)
        this.insideReminder = false
        continue
      }

      const markers = [SYSTEM_REMINDER_OPEN, ...this.reminderBodies].filter(Boolean)
      let marker = ''
      let markerIndex = -1
      for (const candidate of markers) {
        const candidateIndex = this.pending.indexOf(candidate)
        if (candidateIndex !== -1 && (markerIndex === -1 || candidateIndex < markerIndex)) {
          marker = candidate
          markerIndex = candidateIndex
        }
      }
      if (markerIndex !== -1) {
        safe += this.pending.slice(0, markerIndex)
        this.pending = this.pending.slice(markerIndex + marker.length)
        this.insideReminder = marker === SYSTEM_REMINDER_OPEN
        continue
      }

      const retainedLength = markerPrefixSuffixLength(this.pending, markers)
      safe += this.pending.slice(0, this.pending.length - retainedLength)
      this.pending = this.pending.slice(this.pending.length - retainedLength)
      return safe
    }

    return safe
  }

  flush(): string {
    const pending = this.insideReminder ? SYSTEM_REMINDER_OPEN + this.pending : this.pending
    this.pending = ''
    this.insideReminder = false
    return pending
  }
}
