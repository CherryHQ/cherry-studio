import type { SpeechPcmChunk } from '@shared/ai/voice'

import { VoiceDomainError } from './VoiceService'

/** Owns the microphone and graph; the browser continuously resamples and downmixes to mono 16 kHz. */
export class PcmCapture {
  private readonly context = new AudioContext({ sampleRate: 16000 })
  readonly analyser = this.context.createAnalyser()
  private stream?: MediaStream
  private source?: MediaStreamAudioSourceNode
  private node?: AudioWorkletNode
  private sending = Promise.resolve()
  private closed = false
  private stopping?: Promise<number>
  private resolveTail?: (frames: number) => void
  private rejectTail?: (error: unknown) => void
  private closing?: Promise<void>
  private failure?: unknown
  private limitFrames?: number

  constructor(
    private readonly write: (chunk: SpeechPcmChunk) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly onLimit: () => void
  ) {
    this.analyser.fftSize = 1024
  }

  async start(mediaDevices: Pick<MediaDevices, 'getUserMedia'>, deviceId: string | null): Promise<void> {
    await this.context.suspend()
    const { default: processorUrl } = await import('./pcmCaptureProcessor.ts?worker&url')
    if (this.closed) return
    await this.context.audioWorklet.addModule(processorUrl)
    if (this.closed) return
    if (this.context.sampleRate !== 16000) throw new VoiceDomainError('invalid_audio')
    const stream = await mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false
    })
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    this.stream = stream
    stream.getTracks().forEach((track) => {
      track.onended = () => this.fail(new VoiceDomainError('microphone_unavailable'))
    })
    this.node = new AudioWorkletNode(this.context, 'cherry-pcm-capture', {
      channelCount: 1,
      channelCountMode: 'explicit',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    })
    this.node.onprocessorerror = () => this.fail(new VoiceDomainError('recording_failed'))
    this.node.port.onmessage = ({
      data
    }: MessageEvent<
      | { type: 'pcm'; startFrame: number; samples: Float32Array }
      | { type: 'stopped'; frames: number }
      | { type: 'overflow' }
      | { type: 'limit'; frames: number }
    >) => {
      if (this.closed) return
      if (data.type === 'limit') {
        this.limitFrames = data.frames
        this.onLimit()
        return
      }
      if (data.type === 'overflow') return this.fail(new VoiceDomainError('recording_failed'))
      if (data.type === 'stopped') {
        this.resolveTail?.(data.frames)
        return
      }
      this.sending = this.sending.then(async () => {
        if (this.closed) return
        await this.write({ startFrame: data.startFrame, samples: data.samples })
        this.node?.port.postMessage({ type: 'ack', frames: data.startFrame + data.samples.length })
      })
      void this.sending.catch((error: unknown) => this.fail(error))
    }
    this.source = this.context.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    this.source.connect(this.node)
    this.node.connect(this.context.destination)
    await this.context.resume()
  }

  stop(): Promise<number> {
    return (this.stopping ??= this.drain())
  }

  private async drain(): Promise<number> {
    if (this.closed) throw this.failure ?? new VoiceDomainError('aborted')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const tail = new Promise<number>((resolve, reject) => {
        if (this.limitFrames !== undefined) {
          resolve(this.limitFrames)
          return
        }
        this.resolveTail = resolve
        this.rejectTail = reject
        timer = setTimeout(() => reject(new VoiceDomainError('timeout')), 5000)
      })
      this.stopTracks()
      this.node?.port.postMessage({ type: 'stop' })
      const frames = await tail
      await this.sending
      if (this.failure) throw this.failure
      return frames
    } finally {
      clearTimeout(timer)
      await this.cancel()
    }
  }

  cancel(): Promise<void> {
    this.closed = true
    this.rejectTail?.(new VoiceDomainError('aborted'))
    this.stopTracks()
    this.source?.disconnect()
    this.analyser.disconnect()
    this.node?.disconnect()
    this.node?.port.close()
    return (this.closing ??= this.context.close())
  }

  private stopTracks(): void {
    this.stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    this.stream = undefined
  }

  private fail(error: unknown): void {
    if (this.closed || this.failure) return
    this.failure = error
    this.rejectTail?.(error)
    void this.cancel().catch(() => undefined)
    this.onError(error)
  }
}
