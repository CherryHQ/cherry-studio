import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'

import Bonjour, { type Service } from 'bonjour-service'

import { remoteDiscoveryType } from '@cherrystudio/remote-protocol'
import { loggerService } from '@logger'

const logger = loggerService.withContext('RemoteAdvertisement')

/** Owned by RemoteAccessService; never opens a remote RPC listener. */
export class RemoteAdvertisement {
  private publisher?: Bonjour
  private service?: Service
  private snapshot?: string
  private readonly name = `cherry-${randomUUID()}`

  constructor(private readonly status: (status: 'starting' | 'available' | 'unavailable') => void) {}

  update(identity: string, port: number): void {
    const addresses = Object.values(networkInterfaces())
      .flatMap((entries) =>
        (entries ?? []).filter((entry) => !entry.internal && entry.family === 'IPv4').map((entry) => entry.address)
      )
      .sort()
    const snapshot = JSON.stringify([identity, port, addresses])
    if (snapshot === this.snapshot) return
    this.stop()
    this.snapshot = snapshot
    this.status('starting')
    try {
      const publisher = new Bonjour(undefined, (error: Error) => {
        if (this.publisher !== publisher) return
        logger.warn('LAN discovery unavailable', error)
        this.stop()
        this.status('unavailable')
      })
      this.publisher = publisher
      const service = publisher.publish({
        name: this.name,
        host: `${this.name}.local`,
        type: remoteDiscoveryType,
        protocol: 'tcp',
        disableIPv6: true,
        port,
        txt: { v: '1', identity }
      })
      this.service = service
      service.on('up', () => {
        if (this.publisher === publisher) this.status('available')
      })
    } catch (error) {
      logger.warn('Could not publish remote discovery', error as Error)
      this.stop()
      this.status('unavailable')
    }
  }

  stop(): void {
    const publisher = this.publisher
    this.publisher = undefined
    if (this.service) this.service.destroyed = true
    this.service = undefined
    this.snapshot = undefined
    if (!publisher) return
    let destroyed = false
    const destroy = () => {
      if (destroyed) return
      destroyed = true
      clearTimeout(timer)
      publisher.destroy()
    }
    const timer = setTimeout(destroy, 500)
    timer.unref()
    publisher.unpublishAll(destroy)
  }
}
