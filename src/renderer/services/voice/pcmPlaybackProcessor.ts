import type { PcmProcessorInput, PcmProcessorOutput } from './speechPlaybackTypes'

declare const AudioWorkletProcessor: {
  new (): { port: MessagePort }
}
declare function registerProcessor(name: string, processor: typeof PcmPlaybackProcessor): void
declare const currentFrame: number
declare const sampleRate: number

class PcmPlaybackProcessor extends AudioWorkletProcessor {
  private readonly ring: Float32Array
  private readonly channels: number
  private readonly capacity: number
  private received = 0
  private consumed = 0
  private reported = 0
  private end?: number
  private stopped = false
  private started = false
  private underruns = 0
  private peakFrames = 0

  constructor(options: { processorOptions: { channels: number; capacityFrames: number } }) {
    super()
    this.channels = options.processorOptions.channels
    this.capacity = options.processorOptions.capacityFrames
    this.ring = new Float32Array(this.capacity * this.channels)
    this.port.onmessage = ({ data }: MessageEvent<PcmProcessorInput>) => {
      if (this.stopped) return
      if (data.type === 'end') {
        if (this.end !== undefined || data.frames !== this.received) return this.fail()
        this.end = data.frames
        return
      }
      const frames = data.samples.length / this.channels
      if (
        this.end !== undefined ||
        data.startFrame !== this.received ||
        !Number.isInteger(frames) ||
        frames <= 0 ||
        this.received - this.consumed + frames > this.capacity ||
        !data.samples.every(Number.isFinite)
      )
        return this.fail()
      for (let frame = 0; frame < frames; frame++) {
        const offset = ((this.received + frame) % this.capacity) * this.channels
        for (let channel = 0; channel < this.channels; channel++)
          this.ring[offset + channel] = data.samples[frame * this.channels + channel]
      }
      this.received += frames
      this.peakFrames = Math.max(this.peakFrames, this.received - this.consumed)
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.stopped) return false
    const output = outputs[0]
    if (!this.started) {
      if (this.end === undefined && this.received < Math.min(this.capacity, Math.ceil(sampleRate / 2))) return true
      this.started = true
    }
    const available = Math.min(output[0].length, this.received - this.consumed)
    for (let channel = 0; channel < output.length; channel++) {
      output[channel].fill(0)
      for (let frame = 0; frame < available; frame++)
        output[channel][frame] = this.ring[((this.consumed + frame) % this.capacity) * this.channels + channel]
    }
    this.consumed += available
    if (available < output[0].length && this.end === undefined && this.received > 0) this.underruns++
    if (this.consumed > this.reported && (this.consumed - this.reported >= 1024 || this.consumed === this.received)) {
      this.send({ type: 'consumed', frames: this.consumed, underruns: this.underruns, peakFrames: this.peakFrames })
      this.reported = this.consumed
    }
    if (this.end === this.consumed) {
      this.send({ type: 'drained', frames: this.consumed, contextTime: (currentFrame + available) / sampleRate })
      this.stopped = true
      return false
    }
    return true
  }

  private fail(): void {
    this.stopped = true
    this.send({ type: 'error' })
  }
  private send(message: PcmProcessorOutput): void {
    this.port.postMessage(message)
  }
}

registerProcessor('cherry-pcm-playback', PcmPlaybackProcessor)
