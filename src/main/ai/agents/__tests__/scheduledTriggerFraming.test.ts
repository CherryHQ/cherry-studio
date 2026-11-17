import { describe, expect, it } from 'vitest'

import { frameScheduledTrigger } from '../scheduledTriggerFraming'

describe('frameScheduledTrigger', () => {
  it('frames a regular task as a scheduler trigger, not a user message', () => {
    const text = frameScheduledTrigger({ kind: 'task', taskName: 'Water', instruction: '  Remind me to drink water  ' })

    expect(text).toContain('[System: Scheduled task trigger]')
    expect(text).toContain('The user is NOT sending you a new message.')
    expect(text).toContain('Task name: Water')
    expect(text).toContain('"Remind me to drink water"')
    expect(text).toContain('Do NOT thank the user for reminding you')
  })

  it('omits the task name line when no name is set', () => {
    const text = frameScheduledTrigger({ kind: 'task', taskName: null, instruction: 'Check PRs' })

    expect(text).not.toContain('Task name:')
    expect(text).toContain('"Check PRs"')
  })

  it('keeps the heartbeat framing for heartbeat triggers', () => {
    const text = frameScheduledTrigger({ kind: 'heartbeat', instruction: '- check inbox' })

    expect(text.startsWith('[Heartbeat]\n')).toBe(true)
    expect(text.endsWith('---\n- check inbox')).toBe(true)
  })
})
