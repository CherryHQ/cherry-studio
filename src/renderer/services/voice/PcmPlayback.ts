/// <reference types="vite/client" />
import type { SpeechPcmFormat, SpeechStreamEvent, SpeechStreamIdentity } from '@shared/ai/voice'

import type { PcmProcessorInput, PcmProcessorOutput, SpeechPlayback } from './speechPlaybackTypes'

interface StreamTransport {
  subscribe(listener: (event: SpeechStreamEvent) => void): () => void
  attach(identity: SpeechStreamIdentity): Promise<void>
  acknowledge(identity: SpeechStreamIdentity, frames: number): Promise<void>
}

export class PcmPlayback extends EventTarget implements SpeechPlayback {
  readonly analyser: AnalyserNode
  readonly metrics = { consumedFrames: 0, underruns: 0, peakFrames: 0 }
  private readonly context: AudioContext
  private readonly ready: Promise<void>
  private readonly unsubscribe: () => void
  private node?: AudioWorkletNode
  private stopped = false
  private paused = true
  private closing?: Promise<void>
  private acknowledged = 0
  private acknowledging?: Promise<void>
  private drainTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly identity: SpeechStreamIdentity,
    format: SpeechPcmFormat,
    capacityFrames: number,
    private readonly transport: StreamTransport
  ) {
    super()
    this.context = new AudioContext({ sampleRate: format.sampleRate })
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 1024
    this.unsubscribe = transport.subscribe((event) => {
      if (
        this.stopped ||
        event.sessionId !== identity.sessionId ||
        event.requestId !== identity.requestId ||
        event.attemptId !== identity.attemptId
      )
        return
      if (!this.node) {
        this.fail()
        return
      }
      const message: PcmProcessorInput =
        event.type === 'pcm' ? { type: 'pcm', ...event.chunk } : { type: 'end', frames: event.frames }
      this.node.port.postMessage(message)
    })
    this.ready = this.initialize(format, capacityFrames)
    void this.ready.catch(() => this.fail())
  }

  private async initialize(format: SpeechPcmFormat, capacityFrames: number): Promise<void> {
    await this.context.suspend()
    const { default: processorUrl } = await import('./pcmPlaybackProcessor.ts?worker&url')
    if (this.stopped) return
    await this.context.audioWorklet.addModule(processorUrl)
    if (this.stopped) return
    if (this.context.sampleRate !== format.sampleRate) throw new Error('Unexpected PCM sample rate')
    const node = new AudioWorkletNode(this.context, 'cherry-pcm-playback', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [format.channels],
      processorOptions: { channels: format.channels, capacityFrames }
    })
    this.node = node
    node.onprocessorerror = () => this.fail()
    node.port.onmessage = ({ data }: MessageEvent<PcmProcessorOutput>) => {
      if (this.stopped) return
      if (data.type === 'error') {
        this.fail()
        return
      }
      this.metrics.consumedFrames = data.frames
      if (data.type === 'consumed') {
        this.metrics.underruns = data.underruns
        this.metrics.peakFrames = data.peakFrames
      }
      void this.acknowledge()
        .then(() => {
          if (data.type === 'drained' && !this.stopped) this.waitForOutput(data.contextTime)
        })
        .catch(() => this.fail())
    }
    node.connect(this.analyser)
    this.analyser.connect(this.context.destination)
    await this.transport.attach(this.identity)
  }

  async play(): Promise<void> {
    this.paused = false
    await this.ready
    if (!this.stopped && !this.paused) await this.context.resume()
  }

  async pause(): Promise<void> {
    this.paused = true
    await this.ready
    if (!this.stopped) await this.context.suspend()
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.stopped = true
    clearTimeout(this.drainTimer)
    this.unsubscribe()
    this.node?.disconnect()
    if (this.node) {
      this.node.port.onmessage = null
      this.node.port.close()
      this.node.onprocessorerror = null
    }
    this.analyser.disconnect()
    return (this.closing = this.context.close())
  }

  private acknowledge(): Promise<void> {
    if (this.acknowledging) return this.acknowledging
    this.acknowledging = (async () => {
      while (!this.stopped && this.acknowledged < this.metrics.consumedFrames) {
        const frames = this.metrics.consumedFrames
        await this.transport.acknowledge(this.identity, frames)
        this.acknowledged = frames
      }
    })().finally(() => {
      this.acknowledging = undefined
    })
    return this.acknowledging
  }

  private fail(): void {
    if (this.stopped) return
    this.dispatchEvent(new Event('error'))
    void this.close().catch(() => undefined)
  }

  private waitForOutput(contextTime: number): void {
    if (this.stopped) return
    if (this.context.getOutputTimestamp().contextTime! >= contextTime) {
      this.dispatchEvent(new Event('ended'))
    } else {
      this.drainTimer = setTimeout(() => this.waitForOutput(contextTime), 20)
    }
  }
}
