import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PcmProcessorInput, PcmProcessorOutput } from '../speechPlaybackTypes'

interface Processor {
  port: { onmessage: (event: { data: PcmProcessorInput }) => void }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}
let ProcessorClass: new (options: { processorOptions: { channels: number; capacityFrames: number } }) => Processor
let messages: PcmProcessorOutput[]

beforeEach(async () => {
  vi.resetModules()
  messages = []
  vi.stubGlobal(
    'AudioWorkletProcessor',
    class {
      port = { onmessage: () => {}, postMessage: (message: PcmProcessorOutput) => messages.push(message) }
    }
  )
  vi.stubGlobal('registerProcessor', (_name: string, constructor: typeof ProcessorClass) => {
    ProcessorClass = constructor
  })
  vi.stubGlobal('currentFrame', 0)
  vi.stubGlobal('sampleRate', 24000)
  await import('../pcmPlaybackProcessor')
})
afterEach(() => vi.unstubAllGlobals())

describe('worklet source-frame accounting', () => {
  it('buffers half a second before playback without acknowledging silence', () => {
    const processor = new ProcessorClass({ processorOptions: { channels: 1, capacityFrames: 24000 } })
    processor.port.onmessage({ data: { type: 'pcm', startFrame: 0, samples: new Float32Array(11999).fill(0.25) } })
    const waiting = new Float32Array(128)
    processor.process([], [[waiting]])
    expect([...waiting]).toEqual(Array(128).fill(0))
    expect(messages).toEqual([])
    processor.port.onmessage({ data: { type: 'pcm', startFrame: 11999, samples: new Float32Array([0.25]) } })
    const playing = new Float32Array(128)
    processor.process([], [[playing]])
    expect([...playing]).toEqual(Array(128).fill(0.25))
  })

  it('preserves stereo order and the partial tail, and never acknowledges underflow silence', () => {
    const processor = new ProcessorClass({ processorOptions: { channels: 2, capacityFrames: 300 } })
    const render = () => {
      const output = [new Float32Array(128), new Float32Array(128)]
      processor.process([], [output])
      return output
    }
    expect(render()[0].every((value) => value === 0)).toBe(true)
    expect(messages).toEqual([])
    const samples = Float32Array.from({ length: 514 }, (_, i) => i / 1024)
    processor.port.onmessage({ data: { type: 'pcm', startFrame: 0, samples } })
    processor.port.onmessage({ data: { type: 'end', frames: 257 } })
    const blocks = [render(), render(), render()]
    for (let channel = 0; channel < 2; channel++) {
      const actual = blocks.flatMap((block) => [...block[channel]])
      expect(actual.slice(0, 257)).toEqual([...samples].filter((_, index) => index % 2 === channel))
      expect(actual.slice(257).every((value) => value === 0)).toBe(true)
    }
    expect(messages).toContainEqual({ type: 'consumed', frames: 257, underruns: 0, peakFrames: 257 })
    expect(messages.at(-1)).toMatchObject({ type: 'drained', frames: 257 })
  })

  it('wraps the bounded ring without overwriting unread samples', () => {
    const processor = new ProcessorClass({ processorOptions: { channels: 1, capacityFrames: 200 } })
    processor.port.onmessage({ data: { type: 'pcm', startFrame: 0, samples: new Float32Array(200).fill(0.25) } })
    const first = [new Float32Array(128)]
    processor.process([], [first])
    processor.port.onmessage({ data: { type: 'pcm', startFrame: 200, samples: new Float32Array(128).fill(0.5) } })
    const second = [new Float32Array(128)]
    processor.process([], [second])
    expect([...second[0].slice(0, 72)]).toEqual(Array(72).fill(0.25))
    expect([...second[0].slice(72)]).toEqual(Array(56).fill(0.5))
  })

  it.each(['overflow', 'gap', 'eof', 'nan'] as const)('fails closed on %s', (fault) => {
    const processor = new ProcessorClass({ processorOptions: { channels: 1, capacityFrames: 128 } })
    processor.port.onmessage({
      data: {
        type: 'pcm',
        startFrame: fault === 'gap' ? 1 : 0,
        samples: new Float32Array(fault === 'overflow' ? 129 : 128).fill(fault === 'nan' ? NaN : 0.2)
      }
    })
    if (fault === 'eof') processor.port.onmessage({ data: { type: 'end', frames: 127 } })
    expect(messages).toEqual([{ type: 'error' }])
    expect(processor.process([], [[new Float32Array(128)]])).toBe(false)
  })
})
