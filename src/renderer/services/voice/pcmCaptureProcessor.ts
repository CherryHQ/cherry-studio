declare const AudioWorkletProcessor: { new (): { port: MessagePort } }
declare function registerProcessor(name: string, processor: typeof PcmCaptureProcessor): void

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private batch = new Float32Array(1600)
  private size = 0
  private sent = 0
  private acknowledged = 0
  private stopped = false

  constructor() {
    super()
    this.port.onmessage = ({ data }) => {
      if (data.type === 'ack') this.acknowledged = data.frames
      if (data.type === 'stop' && !this.stopped) {
        this.flush()
        this.stopped = true
        this.port.postMessage({ type: 'stopped', frames: this.sent })
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false
    const samples = inputs[0]?.[0]
    if (!samples) return true
    for (const sample of samples) {
      this.batch[this.size++] = sample
      if (this.size === this.batch.length && !this.flush()) return false
      if (this.sent === 16000 * 300) {
        this.stopped = true
        this.port.postMessage({ type: 'limit', frames: this.sent })
        return false
      }
    }
    return true
  }

  private flush(): boolean {
    if (!this.size) return true
    if (this.sent - this.acknowledged + this.size > 32000) {
      this.stopped = true
      this.port.postMessage({ type: 'overflow' })
      return false
    }
    const samples = this.batch.slice(0, this.size)
    this.port.postMessage({ type: 'pcm', startFrame: this.sent, samples }, [samples.buffer])
    this.sent += this.size
    this.size = 0
    return true
  }
}

registerProcessor('cherry-pcm-capture', PcmCaptureProcessor)

export {}
