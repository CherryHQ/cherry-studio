import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { describe, expect, it, vi } from 'vitest'

import type { SpeechStreamEvent } from '@shared/ai/voice'

import { VoiceStream } from '../VoiceStream'

const identity = { sessionId: 'session', requestId: 'request', attemptId: 1 }
const format = { sampleRate: 8000, channels: 1 }

describe('PCM playback credits', () => {
  it.each([
    ['attachment', 15_000, false],
    ['producer', 120_000, true],
    ['retention', 900_000, true]
  ] as const)('identifies the %s deadline without exposing PCM', async (stage, timeoutMs, attached) => {
    vi.useFakeTimers()
    mockMainLoggerService.warn.mockClear()
    const stream = new VoiceStream(
      identity,
      format,
      new AbortController().signal,
      () => {},
      () => {}
    )
    if (attached) stream.attach()
    let relay: Promise<void> | undefined
    try {
      if (stage !== 'retention') {
        relay = stream.relay(
          { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) },
          Promise.resolve()
        )
      }
      const failure = relay && expect(relay).rejects.toMatchObject({ reason: 'timeout' })
      await vi.advanceTimersByTimeAsync(timeoutMs)
      await failure
      expect(mockMainLoggerService.warn.mock.calls).toEqual([
        ['Voice stream timed out', { ...identity, stage, timeoutMs, attached, sentFrames: 0, consumedFrames: 0 }]
      ])
    } finally {
      stream.close()
      vi.useRealTimers()
    }
  })

  it('does not pull before attachment and bounds queued PCM until actual consumption', async () => {
    const events: SpeechStreamEvent[] = []
    const stream = new VoiceStream(
      identity,
      format,
      new AbortController().signal,
      (event) => events.push(event),
      () => {}
    )
    let pulled = 0
    const relay = stream.relay(
      (async function* () {
        for (let startFrame = 0; startFrame < 16000; startFrame += 4000) {
          pulled++
          yield { startFrame, samples: new Float32Array(4000).fill(0.25) }
        }
      })(),
      Promise.resolve()
    )
    try {
      await Promise.resolve()
      expect(pulled).toBe(0)
      stream.attach()
      await vi.waitFor(() => expect(events).toHaveLength(2))
      expect(pulled).toBe(2)
      expect(stream.drained).toBe(false)
      expect(() => stream.acknowledge(8001)).toThrow()
      stream.acknowledge(4000)
      await vi.waitFor(() => expect(events).toHaveLength(3))
      stream.acknowledge(4000)
      await Promise.resolve()
      expect(pulled).toBe(3)
      stream.acknowledge(12000)
      await relay
      expect(events.at(-1)).toMatchObject({ type: 'end', frames: 16000 })
      expect(stream.drained).toBe(false)
      stream.acknowledge(16000)
      expect(stream.drained).toBe(true)
    } finally {
      stream.close()
    }
  })

  it.each(['gap', 'partial', 'nonfinite', 'oversized'] as const)(
    'rejects %s PCM instead of acknowledging corrupted audio',
    async (fault) => {
      const samples = new Float32Array(fault === 'oversized' ? 8192 : 3).fill(fault === 'nonfinite' ? NaN : 0.2)
      const stream = new VoiceStream(
        identity,
        { ...format, channels: fault === 'partial' ? 2 : 1 },
        new AbortController().signal,
        () => {},
        () => {}
      )
      stream.attach()
      try {
        await expect(
          stream.relay(
            (async function* () {
              yield { startFrame: fault === 'gap' ? 1 : 0, samples }
            })(),
            Promise.resolve()
          )
        ).rejects.toMatchObject({ reason: 'invalid_audio' })
      } finally {
        stream.close()
      }
    }
  )

  it('unblocks cancellation while waiting for attachment or playback credit', async () => {
    for (const attached of [false, true]) {
      const stream = new VoiceStream(
        identity,
        format,
        new AbortController().signal,
        () => {},
        () => {}
      )
      if (attached) stream.attach()
      const relay = stream.relay(
        (async function* () {
          for (let startFrame = 0; startFrame < 12000; startFrame += 4000)
            yield { startFrame, samples: new Float32Array(4000) }
        })(),
        Promise.resolve()
      )
      const failure = expect(relay).rejects.toMatchObject({ reason: 'aborted' })
      await new Promise((resolve) => setTimeout(resolve, 0))
      stream.close()
      await failure
    }
  })
})
