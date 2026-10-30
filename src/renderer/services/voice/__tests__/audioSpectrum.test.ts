import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAudioSpectrum } from '../audioSpectrum'

class AudioNodeDouble {
  readonly connections = new Set<unknown>()
  connect(destination: unknown) {
    this.connections.add(destination)
  }
  disconnect() {
    this.connections.clear()
  }
}

class AudioContextDouble {
  static instances: AudioContextDouble[] = []
  state = 'suspended'
  readonly destination = {}
  readonly source = new AudioNodeDouble()
  readonly analyser = Object.assign(new AudioNodeDouble(), { fftSize: 0, smoothingTimeConstant: 0 })
  constructor() {
    AudioContextDouble.instances.push(this)
  }
  createAnalyser() {
    return this.analyser
  }
  createMediaStreamSource() {
    return this.source
  }
  createMediaElementSource() {
    return this.source
  }
  async resume() {
    this.state = 'running'
  }
  async close() {
    this.state = 'closed'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  AudioContextDouble.instances = []
})

describe('audio spectrum ownership', () => {
  it('keeps playback audible while analysing it, and releases the audio graph on disposal', async () => {
    vi.stubGlobal('AudioContext', AudioContextDouble)
    const spectrum = createAudioSpectrum({} as HTMLAudioElement)!
    const context = AudioContextDouble.instances[0]

    expect(context.source.connections).toEqual(new Set([context.destination, spectrum.analyser]))
    await spectrum.resume()
    expect(context.state).toBe('running')
    await spectrum.dispose()
    expect(context.state).toBe('closed')
    expect(context.source.connections.size).toBe(0)
  })

  it('analyses the borrowed microphone without monitoring or stopping its recording tracks', async () => {
    vi.stubGlobal('AudioContext', AudioContextDouble)
    const track = { readyState: 'live' }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    const spectrum = createAudioSpectrum(stream)!
    const context = AudioContextDouble.instances[0]

    expect(context.source.connections).toEqual(new Set([spectrum.analyser]))
    await spectrum.dispose()
    expect(track.readyState).toBe('live')
    expect(context.state).toBe('closed')
  })

  it('leaves recording and playback available when Web Audio cannot be allocated', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new DOMException('Audio device unavailable', 'NotSupportedError')
        }
      }
    )
    expect(createAudioSpectrum({} as HTMLAudioElement)).toBeUndefined()
  })
})
