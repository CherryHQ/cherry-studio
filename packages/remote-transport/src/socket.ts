import type { Logger } from '@libp2p/interface'
import { AbstractMessageStream } from '@libp2p/utils'

import { remoteLimits } from '@cherrystudio/remote-protocol'

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
      maxReadBufferLength: remoteLimits.queuedBytes,
      maxWriteBufferLength: remoteLimits.queuedBytes,
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

  private readonly closed = () => {
    this.socket.removeEventListener('message', this.receive)
    this.socket.removeEventListener('close', this.closed)
    this.socket.removeEventListener('error', this.failed)
    this.onTransportClosed()
  }

  private readonly failed = () => {
    this.abort(new Error('Remote socket failed'))
  }

  sendData(data: Parameters<AbstractMessageStream['sendData']>[0]) {
    if (this.socket.readyState !== 1 || this.socket.bufferedAmount + data.byteLength > remoteLimits.queuedBytes)
      throw new Error('Remote socket unavailable or congested')
    this.socket.send(data.subarray())
    return { sentBytes: data.byteLength, canSendMore: true }
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
