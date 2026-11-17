import { describe, expect, it, vi } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { AutoReadService } from '../AutoReadService'
import type { SpeechPlaybackStartInput } from '../SpeechPlaybackService'

const snapshot = (text: string, enabled = true, attemptId = 1) => ({
  enabled,
  attemptId,
  scope: 'topic',
  message: {
    id: 'answer',
    role: 'assistant',
    parts: [
      { type: 'reasoning', text: 'private thoughts.' },
      { type: 'text', text }
    ]
  } as CherryUIMessage
})

function harness(streaming = true) {
  const starts: SpeechPlaybackStartInput[] = []
  const spoken: string[] = []
  const drained = Promise.withResolvers<void>()
  const reportError = vi.fn()
  const service = new AutoReadService({
    supportsStreaming: async () => streaming,
    reportError,
    playback: {
      start: async (input) => {
        starts.push(input)
        spoken.push(input.text)
        if (input.textInput) {
          const source = input.textInput
          void (async () => {
            try {
              for await (const event of source) if (event.type === 'text') spoken.push(event.text)
              drained.resolve()
            } catch {
              drained.resolve()
            } finally {
              source.cancel()
            }
          })()
        }
        return { status: 'started' }
      },
      stopAutoRead: async () => {
        starts.forEach((input) => input.textInput?.cancel())
        return true
      }
    }
  })
  return { service, starts, spoken, drained, reportError }
}

describe('incremental automatic reading', () => {
  it('starts before completion, excludes reasoning and never repeats the completion callback', async () => {
    const h = harness()
    h.service.update(snapshot('Hello. unfinished'))
    await vi.waitFor(() => expect(h.spoken).toEqual(['Hello.']))
    h.service.update(snapshot('Hello. unfinished'))
    await h.service.consume({ ...snapshot('Hello. Final tail'), isAbort: false, isError: false })
    await h.drained.promise
    expect(h.spoken.join('')).toBe('Hello.\nFinal tail')
    await h.service.consume({ ...snapshot('Hello. Final tail'), isAbort: false, isError: false })
    expect(h.starts).toHaveLength(1)
  })

  it('keeps the existing completion path when the selected model has no text-stream operation', async () => {
    const h = harness(false)
    h.service.update(snapshot('Hello. '))
    await h.service.consume({ ...snapshot('Hello. Complete.'), isAbort: false, isError: false })
    expect(h.spoken).toEqual(['Hello. Complete.'])
    expect(h.starts[0].textInput).toBeUndefined()
  })

  it.each(['abort', 'error', 'leave', 'disable', 'revision'])(
    'invalidates a %s attempt so late snapshots cannot restart it',
    async (reason) => {
      const h = harness()
      h.service.update(snapshot('Hello. '))
      await vi.waitFor(() => expect(h.spoken).toEqual(['Hello.']))
      if (reason === 'leave') h.service.cancelScope('topic')
      else if (reason === 'disable') {
        await h.service.setEnabled(true)
        await h.service.setEnabled(false)
        await h.service.setEnabled(true)
      } else if (reason === 'revision') h.service.update(snapshot('Replaced. '))
      else await h.service.consume({ ...snapshot('Hello. '), isAbort: reason === 'abort', isError: reason === 'error' })
      await h.drained.promise
      h.service.update(snapshot('Hello. Late text. '))
      await Promise.resolve()
      expect(h.spoken).toEqual(['Hello.'])
      expect(h.starts).toHaveLength(1)
      expect(h.starts[0].signal?.aborted).toBe(true)
    }
  )

  it('reports cumulative overflow at EOF without reporting successful playback or restarting', async () => {
    const h = harness()
    h.service.update(snapshot('Hello. '))
    await vi.waitFor(() => expect(h.spoken).toEqual(['Hello.']))
    const result = await h.service.consume({
      ...snapshot('Hello. ' + 'a'.repeat(5000)),
      isAbort: false,
      isError: false
    })
    expect(result).toMatchObject({ status: 'skipped', reason: 'too_long' })
    expect(h.reportError.mock.calls).toEqual([['text_limit']])
    await h.drained.promise
    h.service.update(snapshot('Hello. Late. '))
    expect(h.spoken).toEqual(['Hello.'])
    expect(h.starts[0].signal?.aborted).toBe(true)
  })

  it('does not start after leaving while capability discovery is pending', async () => {
    const capability = Promise.withResolvers<boolean>()
    const start = vi.fn()
    const service = new AutoReadService({
      supportsStreaming: () => capability.promise,
      playback: { start, stopAutoRead: async () => true }
    })
    service.update(snapshot('Hello. '))
    const completion = service.consume({ ...snapshot('Hello. Tail'), isAbort: false, isError: false })
    service.cancelScope('topic')
    capability.resolve(true)
    await expect(completion).resolves.toMatchObject({ status: 'skipped', reason: 'aborted' })
    expect(start.mock.calls).toEqual([])
  })

  it('does not replay a disabled attempt when enabled midway', async () => {
    const h = harness()
    h.service.update(snapshot('Hidden. ', false))
    h.service.update(snapshot('Hidden. More. ', true))
    await h.service.consume({ ...snapshot('Hidden. More.'), isAbort: false, isError: false })
    expect(h.spoken).toEqual([])
    h.service.update(snapshot('Retry. ', true, 2))
    await vi.waitFor(() => expect(h.spoken).toEqual(['Retry.']))
    h.service.cancelScope('topic')
  })
})
