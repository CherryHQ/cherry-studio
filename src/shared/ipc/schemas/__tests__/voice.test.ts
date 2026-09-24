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
  it('returns only supported and installed transcription locale tags', () => {
    const locales = voiceRequestSchemas['ai.transcription.locales.list'].output
    expect(locales.parse({ supported: ['en-US', 'zh-CN'], installed: ['en-US'] })).toEqual({
      supported: ['en-US', 'zh-CN'],
      installed: ['en-US']
    })
    expect(locales.safeParse({ supported: ['en-US'], installed: ['en-US'], transcript: 'private' }).success).toBe(false)
    expect(locales.safeParse({ supported: ['auto'], installed: [] }).success).toBe(false)
  })
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

  it.each(['auto', 'AUTO', 'Auto'])('rejects the automatic-language sentinel %s at the IPC boundary', (language) => {
    expect(speech.safeParse({ ...base, language }).success).toBe(false)
    expect(
      voiceRequestSchemas['ai.voice.model.status'].input.safeParse({
        modelId: 'local-voice::apple-system-asr',
        language
      }).success
    ).toBe(false)
    expect(
      voiceRequestSchemas['ai.transcription.asset.install'].input.safeParse({
        sessionId: base.sessionId,
        requestId: base.requestId,
        source: 'settings',
        language
      }).success
    ).toBe(false)
  })

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

  it('accepts a bounded opaque source entity only on session admission routes', () => {
    const sourceEntityId = 'message-1'
    expect(speech.parse({ ...base, sourceEntityId })).toMatchObject({ sourceEntityId })
    expect(
      voiceRequestSchemas['ai.voice.recording.start'].input.parse({
        sessionId: base.sessionId,
        requestId: base.requestId,
        source: 'dictation',
        sourceEntityId
      })
    ).toMatchObject({ sourceEntityId })

    for (const value of ['', ' ', `x${'y'.repeat(256)}`, 1]) {
      expect(speech.safeParse({ ...base, sourceEntityId: value }).success).toBe(false)
    }
    expect(
      voiceRequestSchemas['ai.transcription.generate'].input.safeParse({
        sessionId: base.sessionId,
        requestId: base.requestId,
        fileEntryId: 'file-entry',
        sourceEntityId
      }).success
    ).toBe(false)
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

  it('declares the complete strict Voice coordination surface', () => {
    expect(Object.keys(voiceRequestSchemas)).toEqual(
      expect.arrayContaining([
        'ai.voice.session.state',
        'ai.voice.recording.start',
        'ai.voice.output.read',
        'ai.voice.output.release',
        'ai.voice.playback.update',
        'ai.voice.playback.control',
        'ai.voice.microphone.status',
        'ai.voice.microphone.open_settings'
      ])
    )
    for (const route of [
      'ai.voice.recording.start',
      'ai.voice.output.read',
      'ai.voice.output.release',
      'ai.voice.playback.update',
      'ai.voice.playback.control'
    ] as const) {
      const schema = (
        voiceRequestSchemas as Record<string, { input: { safeParse(value: unknown): { success: boolean } } }>
      )[route].input
      expect(
        schema.safeParse({ ...base, ownerWindowId: 'forged', path: '/private/audio', base64: 'YQ==' }).success
      ).toBe(false)
    }
  })

  it('models idle without a session and active snapshots without private media', () => {
    const stateRoute = (
      voiceRequestSchemas as Record<
        string,
        { output: { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean } } }
      >
    )['ai.voice.session.state']
    expect(stateRoute.output.parse({ phase: 'idle', revision: 0 })).toEqual({ phase: 'idle', revision: 0 })
    expect(
      stateRoute.output.parse({
        phase: 'recording',
        revision: 1,
        sessionId: base.sessionId,
        source: 'dictation'
      })
    ).toEqual({ phase: 'recording', revision: 1, sessionId: base.sessionId, source: 'dictation' })
    expect(
      stateRoute.output.safeParse({
        phase: 'recording',
        revision: 1,
        sessionId: base.sessionId,
        source: 'dictation',
        sourceEntityId: 'private-source-entity-canary'
      }).success
    ).toBe(false)
    expect(
      stateRoute.output.safeParse({
        phase: 'ready',
        revision: 2,
        sessionId: base.sessionId,
        text: 'private-state-canary',
        path: '/private/output-canary.wav'
      }).success
    ).toBe(false)
  })

  it('accepts only controlled playback updates and commands', () => {
    const routes = voiceRequestSchemas as Record<string, { input: { safeParse(value: unknown): { success: boolean } } }>
    const update = routes['ai.voice.playback.update'].input
    const control = routes['ai.voice.playback.control'].input
    expect(update.safeParse({ sessionId: base.sessionId, phase: 'playing' }).success).toBe(true)
    expect(update.safeParse({ sessionId: base.sessionId, phase: 'generating' }).success).toBe(false)
    expect(control.safeParse({ sessionId: base.sessionId, command: 'pause' }).success).toBe(true)
    expect(control.safeParse({ sessionId: base.sessionId, command: 'seek', seconds: 3 }).success).toBe(false)
  })

  it('returns output bytes with a fixed MIME and never a path', () => {
    const output = (
      voiceRequestSchemas as Record<string, { output: { safeParse(value: unknown): { success: boolean } } }>
    )['ai.voice.output.read'].output
    expect(output.safeParse({ audio: new Uint8Array([1]), mimeType: 'audio/wav' }).success).toBe(true)
    expect(
      output.safeParse({ audio: new Uint8Array([1]), mimeType: 'audio/wav', path: '/private/output-canary.wav' })
        .success
    ).toBe(false)
  })

  it('requires a bounded integer recording duration as metadata', () => {
    const input = voiceRequestSchemas['file.voice_recording.create'].input
    const recording = {
      sessionId: base.sessionId,
      audio: new Uint8Array([1]),
      mimeType: 'audio/webm;codecs=opus'
    }
    for (const durationMs of [0, 1, 300_000]) {
      expect(input.safeParse({ ...recording, durationMs }).success).toBe(true)
    }
    for (const durationMs of [-1, 0.5, 300_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(input.safeParse({ ...recording, durationMs }).success).toBe(false)
    }
    expect(input.safeParse(recording).success).toBe(false)
  })
})
