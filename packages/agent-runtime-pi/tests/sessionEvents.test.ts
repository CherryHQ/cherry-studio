import { SessionManager } from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'

import { type AgentRuntimeEvent, SessionEvents } from '../src/sessionEvents'

it('retains the committed compaction identity across intermediate entry flushes and resets it per attempt', () => {
  const manager = SessionManager.inMemory('/tmp/runtime-events')
  const events: AgentRuntimeEvent[] = []
  const observer = new SessionEvents(manager, (event) => events.push(event))
  const firstKeptEntryId = manager.appendMessage({ role: 'user', content: 'hello', timestamp: 1 })
  observer.handle({ type: 'compaction_start', reason: 'manual' })
  const id = manager.appendCompaction('summary', firstKeptEntryId, 100)
  observer.flush()
  manager.appendCustomEntry('unrelated', {})
  observer.flush()
  observer.handle({
    type: 'compaction_end',
    reason: 'manual',
    aborted: false,
    willRetry: false,
    result: { summary: 'summary', firstKeptEntryId, tokensBefore: 100 }
  })
  observer.handle({ type: 'compaction_start', reason: 'threshold' })
  observer.handle({
    type: 'compaction_end',
    reason: 'threshold',
    aborted: false,
    willRetry: false,
    result: undefined,
    errorMessage: 'summary unavailable'
  })
  expect(events.filter((event) => event.type === 'compaction-end')).toEqual([
    { type: 'compaction-end', reason: 'manual', entryId: id },
    { type: 'compaction-end', reason: 'threshold', error: 'summary unavailable' }
  ])
})
