/**
 * Framing for messages the scheduler injects into an agent session.
 *
 * Scheduled triggers are not user messages. Without framing, the agent reads the
 * stored instruction as a fresh user request and replies in the wrong perspective
 * (e.g. "Thanks for the reminder" for "Remind me to drink water"). Heartbeat and
 * regular scheduled tasks share this helper so the framing stays consistent.
 */

export type ScheduledTriggerKind = 'task' | 'heartbeat'

export function frameScheduledTrigger(input: {
  kind: ScheduledTriggerKind
  taskName?: string | null
  instruction: string
}): string {
  const instruction = input.instruction.trim()

  if (input.kind === 'heartbeat') {
    return [
      '[Heartbeat]',
      'This is a periodic heartbeat. The instructions below are from your heartbeat.md file.',
      'Process each item, take action where possible, and use the notify tool to alert the user of important results.',
      '',
      '---',
      instruction
    ].join('\n')
  }

  const lines = [
    '[System: Scheduled task trigger]',
    '',
    'This is an automated notification fired by the scheduler. The user is NOT sending you a new message.',
    'The user previously set up this task and asked you to do the following at this time:',
    ''
  ]
  if (input.taskName?.trim()) lines.push(`  Task name: ${input.taskName.trim()}`)
  lines.push(`  User's instruction: "${instruction}"`, '')
  lines.push(
    "Now is the scheduled time. Carry out the user's instruction directly: speak to the user in your own voice and deliver the reminder or perform the action.",
    'Do NOT thank the user for reminding you, and do NOT address them as if they just messaged you; you are initiating this turn on their behalf.'
  )
  return lines.join('\n')
}
