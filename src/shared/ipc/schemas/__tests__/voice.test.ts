import { describe, expect, expectTypeOf, it } from 'vitest'

import type { EventPayload } from '../../types'
import { type VoiceSessionEvent, voiceRequestSchemas } from '../voice'

const speech = voiceRequestSchemas['ai.speech.generate'].input
const base = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  text: 'private speech',
  voice: 'voice.exact'
}

describe('Voice IPC contract', () => {
  it('aggregates one metadata-only discriminated session event', () => {
    expectTypeOf<EventPayload<'ai.voice.session_event'>>().toEqualTypeOf<VoiceSessionEvent>()
    const event: VoiceSessionEvent = {
      type: 'state',
      sessionId: base.sessionId,
      revision: 3,
      phase: 'recognizing',
      source: 'playback',
      trigger: 'auto_read'
    }
    expect(event.phase).toBe('recognizing')
    expect(Object.keys(event).sort()).toEqual(['phase', 'revision', 'sessionId', 'source', 'trigger', 'type'])

    const sensitiveEvent: VoiceSessionEvent = {
      type: 'state',
      sessionId: base.sessionId,
      revision: 4,
      phase: 'failed',
      reason: 'operation_failed',
      // @ts-expect-error Voice events must never transport content or native details.
      text: 'private-event-canary'
    }
    void sensitiveEvent
  })

  it.each([0.5, 1, 2])('accepts the supported %s× speech speed', (speed) => {
    expect(speech.parse({ ...base, speed })).toMatchObject({ speed })
  })

  it.each([0.49, 2.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1'])(
    'rejects unsupported speech speed %s at the IPC boundary',
    (speed) => {
      expect(speech.safeParse({ ...base, speed }).success).toBe(false)
    }
  )

  it('preserves controlled source, trigger, and chunk metadata', () => {
    expect(
      speech.parse({
        ...base,
        source: 'playback',
        trigger: 'auto_read',
        chunkIndex: 1,
        chunkCount: 3,
        speed: 1.25
      })
    ).toMatchObject({ source: 'playback', trigger: 'auto_read', chunkIndex: 1, chunkCount: 3, speed: 1.25 })
  })

  it('rejects unknown sources/triggers and incoherent chunk metadata', () => {
    for (const input of [
      { ...base, source: 'webview' },
      { ...base, trigger: 'automatic' },
      { ...base, chunkIndex: 0 },
      { ...base, chunkCount: 2 },
      { ...base, chunkIndex: 2, chunkCount: 2 }
    ]) {
      expect(speech.safeParse(input).success).toBe(false)
    }
  })
})
