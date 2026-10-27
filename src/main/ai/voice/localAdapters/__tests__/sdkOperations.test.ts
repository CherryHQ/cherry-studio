import { describe, expect, it } from 'vitest'

import { SpeechInputKind, SpeechOutputKind, TranscriptionInputKind } from '@shared/ai/voice'

import { speechFixture, transcriptionFixture } from '../../__tests__/voiceExecutionFixtures'
import type { TranscriptRevision } from '../../executionTypes'
import { VoiceCleanupError, VoiceRuntimeError } from '../../VoiceRuntimeError'

const wav = Uint8Array.from(
  Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000', 'hex')
)

describe('complete execution lifecycle', () => {
  it('freezes speech selection before asynchronous work starts', async () => {
    const options = { voice: 'selected', language: 'en-US', speed: 1.25 }
    const input = { kind: SpeechInputKind.Text, text: 'Original' }
    const operation = speechFixture('test', async (_id, text, selection) => {
      expect(text).toBe('Original')
      expect(selection).toEqual({ voice: 'selected', language: 'en-US', speed: 1.25 })
      return { audio: wav, mediaType: 'audio/wav' }
    })
    const execution = operation.start(input, options)
    options.voice = 'changed'
    input.text = 'Changed'
    expect(await execution.output).toEqual({ kind: SpeechOutputKind.Audio, audio: wav, mediaType: 'audio/wav' })
    await expect(execution.completed).resolves.toBeUndefined()
    await expect(execution.closed).resolves.toBeUndefined()
  })

  it('waits for aborted native work to finish cleanup and shares cancellation completion', async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const operation = speechFixture('test', async (_id, _text, _options, signal) => {
      started.resolve()
      await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }))
      await release.promise
      throw new VoiceRuntimeError('aborted')
    })
    const execution = operation.start({ kind: SpeechInputKind.Text, text: 'Hello' }, { voice: 'exact' })
    await started.promise
    const cancellation = execution.cancel()
    expect(execution.cancel()).toBe(cancellation)
    let closed = false
    void cancellation.then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    release.resolve()
    await cancellation
    expect(closed).toBe(true)
    await expect(execution.output).rejects.toMatchObject({ reason: 'aborted' })
    await expect(execution.completed).rejects.toMatchObject({ reason: 'aborted' })
  })

  it('does not start native work when cancelled before consuming output', async () => {
    let started = false
    const operation = speechFixture('test', async () => {
      started = true
      return { audio: wav, mediaType: 'audio/wav' }
    })
    const execution = operation.start({ kind: SpeechInputKind.Text, text: 'Hello' }, { voice: 'exact' })
    await execution.cancel()
    await expect(execution.output).rejects.toMatchObject({ reason: 'aborted' })
    expect(started).toBe(false)
  })

  it('reports cleanup failure separately from a cancelled result', async () => {
    const started = Promise.withResolvers<void>()
    const operation = speechFixture('test', async (_id, _text, _options, signal) => {
      started.resolve()
      await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }))
      throw new VoiceCleanupError('aborted')
    })
    const execution = operation.start({ kind: SpeechInputKind.Text, text: 'Hello' }, { voice: 'exact' })
    await started.promise
    await expect(execution.cancel()).rejects.toBeInstanceOf(VoiceCleanupError)
    await expect(execution.closed).rejects.toBeInstanceOf(VoiceCleanupError)
    await expect(execution.completed).rejects.toMatchObject({ reason: 'aborted' })
  })

  it.each([Uint8Array.from(wav), Buffer.from(wav)])(
    'freezes audio and completes without consuming updates (%#)',
    async (audio) => {
      const operation = transcriptionFixture('test', async (_id, received) => {
        expect(received).toEqual(wav)
        return { text: 'Hello 🌍', segments: [], language: 'en' }
      })
      const execution = operation.start({ kind: TranscriptionInputKind.Audio, audio }, {})
      audio.fill(0)
      expect(await execution.completed).toEqual({ text: 'Hello 🌍', segments: [], language: 'en' })
      await execution.closed
      const updates: TranscriptRevision[] = []
      for await (const update of execution.updates) updates.push(update)
      expect(updates).toEqual([{ revision: 1, text: 'Hello 🌍', provisionalStart: 8, final: true }])
    }
  )

  it('cancels a transcription iterator even before its first read', async () => {
    let started = false
    const operation = transcriptionFixture('test', async () => {
      started = true
      return { text: 'Hello', segments: [] }
    })
    const execution = operation.start({ kind: TranscriptionInputKind.Audio, audio: wav }, {})
    const iterator = execution.updates[Symbol.asyncIterator]()
    await iterator.return!()
    expect(started).toBe(false)
    await expect(execution.completed).rejects.toMatchObject({ reason: 'aborted' })
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
  })

  it('settles waiting readers on producer failure while successful cleanup remains observable', async () => {
    const failure = new Error('recognizer unavailable')
    const operation = transcriptionFixture('test', async () => {
      throw failure
    })
    const execution = operation.start({ kind: TranscriptionInputKind.Audio, audio: wav }, {})
    await expect(execution.updates[Symbol.asyncIterator]().next()).rejects.toBe(failure)
    await expect(execution.completed).rejects.toBe(failure)
    await expect(execution.closed).resolves.toBeUndefined()
  })
})
