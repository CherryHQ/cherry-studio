import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SpeechStreamEvent } from '@shared/ai/voice'

import { PcmPlayback } from '../PcmPlayback'
import type { PcmProcessorInput, PcmProcessorOutput } from '../speechPlaybackTypes'

class Context {
  static current: Context
  readonly sampleRate: number
  state = 'running'
  destination = {}
  outputTime = 0
  closed = Promise.withResolvers<void>()
  audioWorklet = { addModule: async () => {} }
  constructor(options: { sampleRate: number }) {
    this.sampleRate = options.sampleRate
    Context.current = this
  }
  createAnalyser() {
    return { fftSize: 0, connect() {}, disconnect() {} }
  }
  async suspend() {
    this.state = 'suspended'
  }
  async resume() {
    this.state = 'running'
  }
  close() {
    this.state = 'closed'
    return this.closed.promise
  }
  getOutputTimestamp() {
    return { contextTime: this.outputTime }
  }
}
class Node {
  static current: Node
  frames: PcmProcessorInput[] = []
  port = {
    onmessage: undefined as ((event: { data: PcmProcessorOutput }) => void) | undefined,
    postMessage: (input: PcmProcessorInput) => {
      this.frames.push(input)
    },
    close() {}
  }
  constructor() {
    Node.current = this
  }
  connect() {}
  disconnect() {}
}
const identity = { sessionId: 'session', requestId: 'request', attemptId: 2 }

beforeEach(() => {
  vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('AudioWorkletNode', Node)
})
afterEach(() => vi.unstubAllGlobals())

describe('PCM playback lifecycle', () => {
  it('isolates old attempts, acknowledges consumption rather than receipt, and waits for device output before drain', async () => {
    let listener!: (event: SpeechStreamEvent) => void
    const attached = Promise.withResolvers<void>()
    const acknowledgements: number[] = []
    const player = new PcmPlayback(identity, { sampleRate: 24000, channels: 1 }, 24000, {
      subscribe: (callback) => {
        listener = callback
        return () => {}
      },
      attach: async () => {
        attached.resolve()
      },
      acknowledge: async (_, frames) => {
        acknowledgements.push(frames)
      }
    })
    const context = Context.current
    try {
      await attached.promise
      const pcm = { type: 'pcm', chunk: { startFrame: 0, samples: new Float32Array(128) } } as const
      listener({ ...identity, ...pcm, attemptId: 1 })
      expect(Node.current.frames).toEqual([])
      listener({ ...identity, ...pcm })
      expect(acknowledgements).toEqual([])
      await player.play()
      expect(context.state).toBe('running')
      await player.pause()
      expect(context.state).toBe('suspended')
      Node.current.port.onmessage!({ data: { type: 'consumed', frames: 128, underruns: 0, peakFrames: 128 } })
      await vi.waitFor(() => expect(acknowledgements).toEqual([128]))
      let drained = false
      player.addEventListener('ended', () => {
        drained = true
      })
      Node.current.port.onmessage!({ data: { type: 'drained', frames: 128, contextTime: 0.01 } })
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(drained).toBe(false)
      await player.play()
      context.outputTime = 0.02
      await vi.waitFor(() => expect(drained).toBe(true))
    } finally {
      context.closed.resolve()
      await player.close()
    }
  })

  it('invalidates before asynchronous cleanup and shares the same observable close result', async () => {
    let detached = false
    const player = new PcmPlayback(identity, { sampleRate: 24000, channels: 1 }, 24000, {
      subscribe: () => () => {
        detached = true
      },
      attach: async () => {},
      acknowledge: async () => {}
    })
    await player.play()
    const closing = player.close()
    expect(player.close()).toBe(closing)
    expect(detached).toBe(true)
    let closed = false
    void closing.then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    Context.current.closed.resolve()
    await closing
    expect(closed).toBe(true)
    await player.play()
    expect(Context.current.state).toBe('closed')
  })
})
