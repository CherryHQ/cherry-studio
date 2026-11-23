import { describe, expect, it } from 'vitest'

import { triggerToFormState } from '../scheduleTrigger'

describe('triggerToFormState', () => {
  it.each([
    [{ kind: 'cron', expr: '0 * * * *' }, 'hourly'],
    [{ kind: 'cron', expr: '30 9,18 * * *' }, 'daily'],
    [{ kind: 'cron', expr: '0 9 * * 1-5' }, 'weekdays'],
    [{ kind: 'cron', expr: '0 9 * * 3' }, 'weekly'],
    [{ kind: 'cron', expr: '0 9 1 * *' }, 'cron'],
    [{ kind: 'cron', expr: '*/5 * * * *' }, 'cron'],
    [{ kind: 'cron', expr: '0 9 * * * 2026' }, 'cron'],
    [{ kind: 'interval', ms: 90 * 60_000 }, 'interval'],
    [{ kind: 'once', at: Date.UTC(2026, 10, 17) }, 'once']
  ] as const)('classifies %o as %s', (trigger, kind) => {
    expect(triggerToFormState(trigger).kind).toBe(kind)
  })

  it('keeps the canonical sorted time list so the form never disagrees with the value it shows', () => {
    expect(triggerToFormState({ kind: 'cron', expr: '5 18,9,9 * * 2' })).toEqual({
      kind: 'weekly',
      value: '09:05,18:05',
      weekday: '2'
    })
  })
})
