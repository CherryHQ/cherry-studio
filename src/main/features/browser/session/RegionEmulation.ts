import type { Protocol } from 'devtools-protocol'

import { loggerService } from '@logger'
import type { MiniAppRegionProfile } from '@shared/types/miniAppRegion'

const logger = loggerService.withContext('RegionEmulation')

/** Owns emulation for one borrowed guest; GuestSession retains debugger ownership. */
export class RegionEmulation {
  private disposed = false
  private failed = false
  private readonly transport: Electron.Debugger
  private readonly pendingChecks = new Set<() => void>()
  private readonly childSessions = new Set<string>()

  constructor(
    private readonly guest: Electron.WebContents,
    private readonly profile: MiniAppRegionProfile,
    private readonly onFailure: () => void
  ) {
    this.transport = guest.debugger
    this.transport.on('message', this.onMessage)
    this.transport.on('detach', this.onDetach)
  }

  async start(): Promise<void> {
    await this.configure()
  }

  private async configure(sessionId?: string, targetType?: string): Promise<void> {
    const send = (method: string, params: object) => this.transport.sendCommand(method, params, sessionId)
    let sharedLocale = false
    await Promise.all([
      send('Emulation.setUserAgentOverride', {
        // Preserve the native UA metadata; the session and app own the UA string.
        userAgent: '',
        acceptLanguage: this.profile.languages.join(',')
      }),
      send('Emulation.setLocaleOverride', { locale: this.profile.locale.replace('-', '_') }).catch((error: Error) => {
        if (!error.message.includes('Another locale override is already in effect')) throw error
        sharedLocale = true
      }),
      send('Emulation.setTimezoneOverride', { timezoneId: this.profile.timeZone }),
      ...(!sessionId || targetType === 'iframe'
        ? [
            send('Emulation.setGeolocationOverride', {
              latitude: this.profile.latitude,
              longitude: this.profile.longitude,
              accuracy: 1000
            })
          ]
        : []),
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
    ])
    if (sharedLocale && !this.disposed && (!sessionId || this.childSessions.has(sessionId)))
      await this.validateSharedLocale(sessionId)
  }

  private async validateSharedLocale(sessionId?: string): Promise<void> {
    let contextId: number | undefined
    let cancelled = false
    let resolveContext!: (value: number | undefined) => void
    const contextReady = new Promise<number | undefined>((resolve) => {
      resolveContext = resolve
    })
    const cancel = () => {
      cancelled = true
      resolveContext(undefined)
    }
    const onContext = (
      _: Electron.Event,
      method: string,
      params: {
        context?: Protocol.Runtime.ExecutionContextDescription
        sessionId?: string
        executionContextId?: number
      },
      eventSessionId?: string
    ) => {
      if (sessionId && method === 'Target.detachedFromTarget' && params.sessionId === sessionId) cancel()
      if ((eventSessionId || undefined) !== sessionId) return
      if (method === 'Runtime.executionContextCreated' && params.context?.auxData?.isDefault !== false) {
        contextId ??= params.context?.id
        if (contextId !== undefined) resolveContext(contextId)
      } else if (
        contextId !== undefined &&
        (method === 'Runtime.executionContextsCleared' ||
          (method === 'Runtime.executionContextDestroyed' && params.executionContextId === contextId))
      ) {
        cancel()
      }
    }
    this.pendingChecks.add(cancel)
    this.transport.on('message', onContext)
    try {
      await this.transport.sendCommand('Runtime.enable', {}, sessionId)
      // New iframes need to commit a document before their default context exists.
      if (contextId === undefined && sessionId) this.resume(sessionId)
      const readyContextId = await contextReady
      if (cancelled || this.disposed || readyContextId === undefined) return
      const { result } = await this.transport.sendCommand(
        'Runtime.evaluate',
        {
          expression: 'Intl.DateTimeFormat().resolvedOptions().locale',
          contextId: readyContextId,
          returnByValue: true
        },
        sessionId
      )
      if (result.value !== this.profile.locale) throw new Error('Conflicting regional locale in shared renderer')
    } catch (error) {
      if (!cancelled && !this.disposed) throw error
    } finally {
      this.pendingChecks.delete(cancel)
      this.transport.removeListener('message', onContext)
    }
  }

  private readonly onMessage = (
    _: Electron.Event,
    method: string,
    params: Protocol.Target.AttachedToTargetEvent | Protocol.Target.DetachedFromTargetEvent
  ) => {
    if (this.disposed) return
    if (method === 'Target.detachedFromTarget') {
      this.childSessions.delete(params.sessionId)
      return
    }
    if (method !== 'Target.attachedToTarget') return
    const { sessionId, targetInfo } = params as Protocol.Target.AttachedToTargetEvent
    this.childSessions.add(sessionId)
    const configured = this.configure(sessionId, targetInfo.type)
    // Service workers cannot acknowledge queued emulation commands until resumed.
    if (targetInfo.type === 'service_worker') this.resume(sessionId)
    void configured
      .catch((error) => {
        if (this.childSessions.has(sessionId)) this.fail(error)
      })
      .finally(() => this.resume(sessionId))
  }

  private resume(sessionId: string): void {
    if (
      !this.disposed &&
      this.childSessions.has(sessionId) &&
      !this.guest.isDestroyed() &&
      this.transport.isAttached()
    ) {
      void this.transport.sendCommand('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
    }
  }

  private readonly onDetach = () => {
    this.childSessions.clear()
    for (const cancel of this.pendingChecks) cancel()
    // Electron emits detach before destroyed; navigating during teardown can crash the guest.
    setImmediate(() => this.fail(new Error('Regional emulation debugger detached')))
  }

  private fail(error: unknown): void {
    if (this.disposed || this.failed || this.guest.isDestroyed()) return
    this.failed = true
    logger.warn('Regional emulation stopped', { error })
    this.onFailure()
  }

  dispose(): void {
    this.disposed = true
    this.childSessions.clear()
    for (const cancel of this.pendingChecks) cancel()
    this.pendingChecks.clear()
    this.transport.removeListener('message', this.onMessage)
    this.transport.removeListener('detach', this.onDetach)
  }
}
