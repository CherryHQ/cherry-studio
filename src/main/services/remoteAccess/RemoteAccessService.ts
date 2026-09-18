import { createHash } from 'node:crypto'

import { application } from '@application'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { loggerService } from '@logger'
import { createLatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { RemoteAgentConnectionInfo } from '@shared/ipc/schemas/apiGateway'

import { assertWritable } from './agentAccess'
import { loadIdentity, type RemoteIdentity } from './identity'
import { RequestRouter } from './requestRouter'
import { RemoteServer } from './server'

const logger = loggerService.withContext('RemoteAccessService')

@Injectable('RemoteAccessService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiGatewayService', 'AiStreamManager', 'AgentSessionRuntimeService', 'FileManager'])
export class RemoteAccessService extends BaseService implements Activatable {
  private server?: RemoteServer
  private identity?: RemoteIdentity
  private holds = 0
  private readonly routers = new Set<RequestRouter>()
  private readonly reconciler = createLatestReconciler({
    name: 'remoteAccess',
    getSnapshot: () => ({
      desired: this.isReady && this.holds === 0 && this.isLanEnabled(),
      actual: this.server?.isListening ?? false
    }),
    isSettled: ({ desired, actual }) => desired === actual,
    apply: async ({ desired }) => {
      await this.deactivate()
      if (desired) await this.activate()
    },
    onError: (error) =>
      logger.warn('Remote Agent access could not start', { code: (error as NodeJS.ErrnoException).code })
  })

  protected onInit(): void {
    this.registerDisposable(application.get('ApiGatewayService').onLanServingChanged(() => this.reconciler.request()))
    this.registerDisposable(apiGatewayPairedDeviceService.onDeleted((id) => this.server?.disconnect(id)))
    this.registerInterval(() => this.server?.sweep(), 20_000)
  }

  protected async onReady(): Promise<void> {
    this.reconciler.request()
    await this.reconciler.flush()
  }

  private isLanEnabled(): boolean {
    return application.get('ApiGatewayService').isLanServing()
  }

  async onActivate(): Promise<void> {
    const identity = await loadIdentity()
    const server = new RemoteServer({
      host: '0.0.0.0',
      port: 0,
      identity,
      authenticate: (auth) => {
        assertWritable()
        if (this.holds || !this.isLanEnabled()) throw new Error('AUTH_FAILED')
        const device = apiGatewayPairedDeviceService.findByTokenHash(
          createHash('sha256').update(auth.token).digest('hex')
        )
        if (!device) throw new Error('AUTH_FAILED')
        return { deviceId: device.id }
      },
      connected: (deviceId, send, close) => {
        let active = true
        const router = new RequestRouter(
          { deviceId, isActive: () => active && this.holds === 0 && this.isLanEnabled() },
          identity.instanceId,
          send,
          close
        )
        this.routers.add(router)
        return {
          receive: (value) => router.receive(value),
          dispose: () => {
            active = false
            router.dispose()
            void router.drain().finally(() => this.routers.delete(router))
          }
        }
      },
      failed: (error) => {
        logger.warn('Remote listener failed', { code: (error as NodeJS.ErrnoException).code })
        this.reconciler.request()
      }
    })
    try {
      await server.start()
    } catch (error) {
      await server.stop()
      identity.secretKey.fill(0)
      throw error
    }
    this.identity = identity
    this.server = server
  }

  async onDeactivate(): Promise<void> {
    const server = this.server
    this.server = undefined
    await server?.stop()
    this.identity?.secretKey.fill(0)
    this.identity = undefined
  }

  protected async onStop(): Promise<void> {
    this.reconciler.request()
    await this.reconciler.flush()
    await this.onDeactivate()
  }

  /** Waits for the listener to follow the current settings; for trusted desktop callers only. */
  async getConnectionInfo(): Promise<RemoteAgentConnectionInfo | undefined> {
    this.reconciler.request()
    await this.reconciler.flush()
    return this.peekConnectionInfo()
  }

  /** Reads the current state without starting anything, so unauthenticated LAN callers cannot drive retries. */
  peekConnectionInfo(): RemoteAgentConnectionInfo | undefined {
    if (!this.server?.isListening || !this.identity || this.holds || !this.isLanEnabled()) return undefined
    return {
      protocolVersion: 1,
      instanceId: this.identity.instanceId,
      port: this.server.port,
      path: '/remote/v1/connect',
      serverPublicKey: this.identity.publicKey
    }
  }

  async suspendForBackup() {
    this.holds++
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      this.reconciler.request()
      await this.reconciler.flush()
      await Promise.race([
        Promise.all([...this.routers].map((router) => router.drain())),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('REMOTE_ACCESS_BUSY')), 15_000)
        })
      ])
    } catch (error) {
      this.holds--
      this.reconciler.request()
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
    let released = false
    return {
      dispose: () => {
        if (released) return
        released = true
        this.holds--
        this.reconciler.request()
      }
    }
  }
}
