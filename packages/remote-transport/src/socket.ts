import type { Logger } from '@libp2p/interface'
import { AbstractMessageStream } from '@libp2p/utils'

import { remoteLimits, uploadTransferLimits } from '@cherrystudio/remote-protocol'

export interface RemoteSocket {
  binaryType: string
  readonly bufferedAmount: number
  readonly readyState: number
  send(data: Uint8Array): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close' | 'error', listener: () => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'close' | 'error', listener: () => void): void
}

const drainPollMs = 50
const lowWaterBytes = uploadTransferLimits.queuedBytes / 2

export class RemoteSocketStream extends AbstractMessageStream {
  constructor(
    private readonly socket: RemoteSocket,
    log: Logger,
    direction: 'inbound' | 'outbound'
  ) {
    super({
      log,
      direction,
      maxMessageSize: remoteLimits.recordBytes,
      maxReadBufferLength: uploadTransferLimits.queuedBytes,
      maxWriteBufferLength: uploadTransferLimits.queuedBytes,
      inactivityTimeout: remoteLimits.idleMs
    })
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('message', this.receive)
    socket.addEventListener('close', this.closed)
    socket.addEventListener('error', this.failed)
  }

  private readonly receive = (event: { data: unknown }) => {
    if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > remoteLimits.recordBytes) {
      this.abort(new Error('Invalid remote socket frame'))
      return
    }
    this.onData(new Uint8Array(event.data))
  }

  private drainTimer: ReturnType<typeof setInterval> | undefined

  private readonly closed = () => {
    this.stopDrainWatch()
    this.socket.removeEventListener('message', this.receive)
    this.socket.removeEventListener('close', this.closed)
    this.socket.removeEventListener('error', this.failed)
    this.onTransportClosed()
  }

  private readonly failed = () => {
    this.abort(new Error('Remote socket failed'))
  }

  sendData(data: Parameters<AbstractMessageStream['sendData']>[0]) {
    if (this.socket.readyState !== 1) throw new Error('Remote socket unavailable')
    if (this.socket.bufferedAmount + data.byteLength > uploadTransferLimits.queuedBytes) {
      this.watchDrain()
      return { sentBytes: 0, canSendMore: false }
    }
    this.socket.send(data.subarray())
    return { sentBytes: data.byteLength, canSendMore: true }
  }

  private watchDrain() {
    if (this.drainTimer) return
    const stalledAt = Date.now() + remoteLimits.idleMs
    this.drainTimer = setInterval(() => {
      if (this.socket.readyState !== 1) {
        this.stopDrainWatch()
        this.abort(new Error('Remote socket unavailable'))
      } else if (this.socket.bufferedAmount <= lowWaterBytes) {
        this.stopDrainWatch()
        this.onMuxerDrain()
      } else if (Date.now() >= stalledAt) {
        this.stopDrainWatch()
        this.abort(new Error('Remote socket congested'))
      }
    }, drainPollMs)
  }

  private stopDrainWatch() {
    clearInterval(this.drainTimer)
    this.drainTimer = undefined
  }

  sendReset() {
    this.socket.close(1008, 'Remote connection closed')
    this.closed()
  }
  sendPause() {}
  sendResume() {}
  async close() {
    this.socket.close(1000)
    this.closed()
  }
}
