import { loggerService } from '@logger'
import type { LocalTransferPeer, LocalTransferState } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { Browser, Service } from 'bonjour-service'
import Bonjour from 'bonjour-service'

import { windowService } from './WindowService'

const SERVICE_TYPE = 'cherrystudio'
const SERVICE_PROTOCOL = 'tcp' as const

const logger = loggerService.withContext('LocalTransferService')

type StartDiscoveryOptions = {
  resetList?: boolean
}

class LocalTransferService {
  private static instance: LocalTransferService
  private bonjour: Bonjour | null = null
  private browser: Browser | null = null
  private services = new Map<string, LocalTransferPeer>()
  private isScanning = false
  private lastScanStartedAt?: number
  private lastUpdatedAt = Date.now()
  private lastError?: string

  private constructor() {}

  public static getInstance(): LocalTransferService {
    if (!LocalTransferService.instance) {
      LocalTransferService.instance = new LocalTransferService()
    }
    return LocalTransferService.instance
  }

  public startDiscovery(options?: StartDiscoveryOptions): LocalTransferState {
    if (options?.resetList) {
      this.services.clear()
    }

    this.isScanning = true
    this.lastScanStartedAt = Date.now()
    this.lastUpdatedAt = Date.now()
    this.lastError = undefined
    this.restartBrowser()
    this.broadcastState()
    return this.getState()
  }

  public stopDiscovery(): LocalTransferState {
    if (this.browser) {
      try {
        this.browser.stop()
      } catch (error) {
        logger.warn('Failed to stop local transfer browser', error as Error)
      }
    }
    this.isScanning = false
    this.lastUpdatedAt = Date.now()
    this.broadcastState()
    return this.getState()
  }

  public getState(): LocalTransferState {
    const services = Array.from(this.services.values()).sort((a, b) => a.name.localeCompare(b.name))
    return {
      services,
      isScanning: this.isScanning,
      lastScanStartedAt: this.lastScanStartedAt,
      lastUpdatedAt: this.lastUpdatedAt,
      lastError: this.lastError
    }
  }

  public getPeerById(id: string): LocalTransferPeer | undefined {
    return this.services.get(id)
  }

  public dispose(): void {
    this.stopDiscovery()
    this.services.clear()
    this.browser?.removeAllListeners()
    this.browser = null
    if (this.bonjour) {
      try {
        this.bonjour.destroy()
      } catch (error) {
        logger.warn('Failed to destroy Bonjour instance', error as Error)
      }
      this.bonjour = null
    }
  }

  private getBonjour(): Bonjour {
    if (!this.bonjour) {
      this.bonjour = new Bonjour()
    }
    return this.bonjour
  }

  private restartBrowser(): void {
    // Clean up existing browser
    if (this.browser) {
      this.browser.removeAllListeners()
      try {
        this.browser.stop()
      } catch (error) {
        logger.warn('Error while stopping Bonjour browser', error as Error)
      }
      this.browser = null
    }

    // Destroy and recreate Bonjour instance to prevent socket leaks
    if (this.bonjour) {
      try {
        this.bonjour.destroy()
      } catch (error) {
        logger.warn('Error while destroying Bonjour instance', error as Error)
      }
      this.bonjour = null
    }

    const browser = this.getBonjour().find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL })
    this.browser = browser
    this.bindBrowserEvents(browser)

    try {
      browser.start()
      logger.info('Local transfer discovery started')
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.lastError = err.message
      logger.error('Failed to start local transfer discovery', err)
    }
  }

  private bindBrowserEvents(browser: Browser) {
    browser.on('up', (service) => {
      const peer = this.normalizeService(service)
      logger.info(`LAN peer detected: ${peer.name} (${peer.addresses.join(', ')})`)
      this.services.set(peer.id, peer)
      this.lastUpdatedAt = Date.now()
      this.broadcastState()
    })

    browser.on('down', (service) => {
      const key = this.buildServiceKey(service.fqdn || service.name, service.host, service.port)
      if (this.services.delete(key)) {
        logger.info(`LAN peer removed: ${service.name}`)
        this.lastUpdatedAt = Date.now()
        this.broadcastState()
      }
    })

    browser.on('error', (error) => {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Local transfer discovery error', err)
      this.lastError = err.message
      this.broadcastState()
    })
  }

  private normalizeService(service: Service): LocalTransferPeer {
    const addressCandidates = [...(service.addresses || []), service.referer?.address].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    const addresses = Array.from(new Set(addressCandidates))
    const txtEntries = Object.entries(service.txt || {})
    const txt =
      txtEntries.length > 0
        ? Object.fromEntries(
            txtEntries.map(([key, value]) => [key, value === undefined || value === null ? '' : String(value)])
          )
        : undefined

    const peer: LocalTransferPeer = {
      id: this.buildServiceKey(service.fqdn || service.name, service.host, service.port),
      name: service.name,
      host: service.host,
      fqdn: service.fqdn,
      port: service.port,
      type: service.type,
      protocol: service.protocol,
      addresses,
      txt,
      updatedAt: Date.now()
    }

    return peer
  }

  private buildServiceKey(name?: string, host?: string, port?: number): string {
    const raw = [name, host, port?.toString()].filter(Boolean).join('-')
    return raw || `service-${Date.now()}`
  }

  private broadcastState() {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send(IpcChannel.LocalTransfer_ServicesUpdated, this.getState())
  }
}

export const localTransferService = LocalTransferService.getInstance()
