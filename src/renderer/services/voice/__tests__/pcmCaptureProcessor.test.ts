import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Message =
  | { type: 'pcm'; startFrame: number; samples: Float32Array }
  | { type: 'stopped'; frames: number }
  | { type: 'overflow' }
  | { type: 'limit'; frames: number }
interface Processor {
  port: { onmessage: (event: { data: { type: 'stop' } | { type: 'ack'; frames: number } }) => void }
  process(inputs: Float32Array[][]): boolean
}
let ProcessorClass: new () => Processor
let messages: Message[]
beforeEach(async () => {
  vi.resetModules()
  messages = []
  vi.stubGlobal(
    'AudioWorkletProcessor',
    class {
      port = { onmessage: () => {}, postMessage: (value: Message) => messages.push(value) }
    }
  )
  vi.stubGlobal('registerProcessor', (_name: string, constructor: typeof ProcessorClass) => {
    ProcessorClass = constructor
  })
  await import('../pcmCaptureProcessor')
})
afterEach(() => vi.unstubAllGlobals())

describe('microphone batches', () => {
  it('preserves every accepted sample across render quanta and drains the tail exactly once', () => {
    const processor = new ProcessorClass()
    const samples = Float32Array.from({ length: 3421 }, (_, i) => Math.sin(i))
    for (let offset = 0; offset < samples.length; offset += 128)
      processor.process([[samples.slice(offset, offset + 128)]])
    processor.port.onmessage({ data: { type: 'stop' } })
    processor.port.onmessage({ data: { type: 'stop' } })
    const chunks = messages.filter((message) => message.type === 'pcm')
    expect(chunks.flatMap((chunk) => [...chunk.samples])).toEqual([...samples])
    expect(chunks.map((chunk) => chunk.startFrame)).toEqual([0, 1600, 3200])
    expect(messages.filter((message) => message.type === 'stopped')).toEqual([
      { type: 'stopped', frames: samples.length }
    ])
    expect(processor.process([[new Float32Array(128)]])).toBe(false)
  })

  it('fails explicitly when consumers stall instead of silently dropping old PCM', () => {
    const processor = new ProcessorClass()
    for (let i = 0; i < 20; i++) expect(processor.process([[new Float32Array(1600)]])).toBe(true)
    expect(processor.process([[new Float32Array(1600)]])).toBe(false)
    expect(messages.at(-1)).toEqual({ type: 'overflow' })
    expect(messages.filter((message) => message.type === 'pcm')).toHaveLength(20)
  })

  it('reuses acknowledged capacity across a long stream', () => {
    const processor = new ProcessorClass()
    for (let i = 0; i < 100; i++) {
      expect(processor.process([[new Float32Array(1600)]])).toBe(true)
      processor.port.onmessage({ data: { type: 'ack', frames: (i + 1) * 1600 } })
    }
    expect(messages.some((message) => message.type === 'overflow')).toBe(false)
  })
  it('ends at the five-minute audio boundary even if the renderer timer is delayed', () => {
    const processor = new ProcessorClass()
    for (let i = 0; i < 3000; i++) {
      const running = processor.process([[new Float32Array(1600)]])
      processor.port.onmessage({ data: { type: 'ack', frames: (i + 1) * 1600 } })
      expect(running).toBe(i < 2999)
    }
    expect(messages.at(-1)).toEqual({ type: 'limit', frames: 4800000 })
    expect(processor.process([[new Float32Array(128)]])).toBe(false)
  })
})
