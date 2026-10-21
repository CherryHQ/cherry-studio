import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { type AgentRuntimeEvent, SessionEvents } from '../src/sessionEvents'

describe('compaction observation', () => {
  it.each([true, false])('preserves native cancellation independently of an error message (aborted: %s)', (aborted) => {
    const events: AgentRuntimeEvent[] = []
    const observer = new SessionEvents(SessionManager.inMemory(), (event) => events.push(event))

    observer.handle({ type: 'compaction_end', reason: 'threshold', result: undefined, aborted, willRetry: false })

    expect(events).toEqual([{ type: 'compaction-end', reason: 'threshold', aborted }])
  })
})
