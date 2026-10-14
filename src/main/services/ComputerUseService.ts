import { Mutex } from 'async-mutex'

import { application } from '@application'
import {
  type Action,
  type AppInfo,
  type AppSession,
  ComputerUse,
  type ComputerUseClient,
  type ObserveInput,
  type PermissionStatus
} from '@cherrystudio/computer-use'
import { loggerService } from '@logger'
import { BaseService, Emitter, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('ComputerUseService')

export interface ComputerUseTask {
  readonly id: string
  readonly ownerId: string
  readonly label: string
  readonly signal?: AbortSignal
  closed: boolean
}

type ControlStatus = 'opening' | 'active' | 'stopping' | 'stopped' | 'unconfirmed'

export interface ComputerUseControl {
  ownerId: string
  label: string
  appId?: string
  appName?: string
  status: ControlStatus
}

interface AppControl {
  app: AppInfo
  status: ControlStatus
  session: Promise<AppSession>
  sessionId?: string
  stopping?: Promise<void>
}

interface ControlTask {
  context: ComputerUseTask
  abort: AbortController
  apps: Map<string, AppControl>
  client?: Promise<ComputerUseClient>
  closing?: Promise<void>
  cleanupUnconfirmed?: boolean
  detach: () => void
}

interface ControlOwner {
  label: string
  stopped: boolean
  blockedApps: Map<string, AppInfo>
}

export class ComputerUseControlError extends Error {
  readonly effect = 'none'

  constructor(readonly code: 'CONTROL_DISABLED' | 'USER_STOPPED' | 'APP_BUSY' | 'TASK_CLOSED' | 'UNKNOWN_APP_SESSION') {
    super(
      {
        CONTROL_DISABLED: 'Desktop control is disabled in Computer Use settings.',
        USER_STOPPED:
          'The user stopped desktop control. Do not retry or reopen it; only the user can allow it again from the tray.',
        APP_BUSY: 'Another control task owns this application. Do not bypass its ownership.',
        TASK_CLOSED: 'This control task has ended. Its application sessions and snapshots are no longer usable.',
        UNKNOWN_APP_SESSION: 'This application session does not belong to the current control task.'
      }[code]
    )
    this.name = 'ComputerUseControlError'
  }
}

@Injectable('ComputerUseService')
@ServicePhase(Phase.WhenReady)
export class ComputerUseService extends BaseService {
  private readonly permissionMutex = new Mutex()
  private shutdown = new AbortController()
  private readonly tasks = new Map<string, ControlTask>()
  private readonly owners = new Map<string, ControlOwner>()
  private readonly appOwners = new Map<string, ControlTask>()
  private readonly changed = new Emitter<void>()
  readonly onControlsChanged = this.changed.event

  protected onInit(): void {
    this.shutdown = new AbortController()
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('app.computer_use.agent_control.enabled', (enabled) => {
        if (!enabled) void this.stopAll()
      })
    )
  }

  createTask(ownerId: string, label: string, signal?: AbortSignal): ComputerUseTask {
    return { id: crypto.randomUUID(), ownerId, label, signal, closed: false }
  }

  async listApps(context: ComputerUseTask, signal?: AbortSignal) {
    const task = this.getTask(context)
    const client = await this.getClient(task)
    this.assertAvailable(task)
    const options = { signal: this.signal(task, signal) }
    const [apps, capabilities] = await Promise.all([client.listApps(options), client.getCapabilities(options)])
    return { apps, capabilities }
  }

  async openApp(context: ComputerUseTask, appId: string, signal?: AbortSignal): Promise<AppSession> {
    const task = this.getTask(context)
    this.assertAvailable(task, appId)
    const current = this.appOwners.get(appId)
    if (current && current !== task) throw new ComputerUseControlError('APP_BUSY')
    let control = task.apps.get(appId)
    if (!control) {
      const pending = Promise.withResolvers<AppSession>()
      control = { app: { id: appId, name: appId }, status: 'opening', session: pending.promise }
      task.apps.set(appId, control)
      this.appOwners.set(appId, task)
      this.changed.fire()
      const opening = control
      void (async () => {
        try {
          const client = await this.getClient(task)
          this.assertAvailable(task, appId)
          const session = await client.openAppSession({ appId }, { signal: this.signal(task, signal) })
          opening.app = session.app
          opening.sessionId = session.id
          if (opening.status === 'opening') opening.status = 'active'
          pending.resolve(session)
        } catch (error) {
          pending.reject(error)
          if (opening.status === 'opening') this.releaseApp(task, appId)
        } finally {
          this.changed.fire()
        }
      })()
    }
    const session = await control.session
    this.assertAvailable(task, appId)
    return session
  }

  async getAppState(context: ComputerUseTask, input: ObserveInput, signal?: AbortSignal) {
    const task = this.getTask(context)
    const control = this.getApp(task, input.appSessionId)
    const client = await this.getClient(task)
    this.assertAvailable(task, control.app.id)
    return client.getAppState({ ...input, activation: 'never' }, { signal: this.signal(task, signal) })
  }

  async act(context: ComputerUseTask, action: Action, signal?: AbortSignal) {
    const task = this.getTask(context)
    const control = this.getApp(task, action.appSessionId)
    const client = await this.getClient(task)
    this.assertAvailable(task, control.app.id)
    return client.act({ ...action, allowGlobalInput: false }, { signal: this.signal(task, signal) })
  }

  getControls(): ComputerUseControl[] {
    const controls: ComputerUseControl[] = []
    for (const [ownerId, owner] of this.owners) {
      const apps = new Map<string, ComputerUseControl>()
      for (const app of owner.blockedApps.values())
        apps.set(app.id, { ownerId, label: owner.label, appId: app.id, appName: app.name, status: 'stopped' })
      for (const task of this.tasks.values()) {
        if (task.context.ownerId !== ownerId) continue
        for (const control of task.apps.values())
          apps.set(control.app.id, {
            ownerId,
            label: owner.label,
            appId: control.app.id,
            appName: control.app.name,
            status: control.status
          })
      }
      if (owner.stopped) {
        const tasks = [...this.tasks.values()].filter((task) => task.context.ownerId === ownerId)
        controls.push({
          ownerId,
          label: owner.label,
          status: tasks.some((task) => task.cleanupUnconfirmed)
            ? 'unconfirmed'
            : tasks.some((task) => task.closing)
              ? 'stopping'
              : 'stopped'
        })
      }
      controls.push(...apps.values())
    }
    return controls
  }

  async stopApp(ownerId: string, appId: string): Promise<void> {
    const owner = this.owners.get(ownerId)
    if (!owner) return
    const task = this.appOwners.get(appId)
    const control = task?.context.ownerId === ownerId ? task.apps.get(appId) : undefined
    owner.blockedApps.set(appId, control?.app ?? { id: appId, name: appId })
    if (!task || !control) return
    if (control.stopping) return control.stopping
    control.status = 'stopping'
    this.changed.fire()
    control.stopping = (async () => {
      try {
        const session = await control.session.catch(() => undefined)
        if (session) {
          const client = await this.getClient(task)
          await client.stopAppSession({ appSessionId: session.id })
        }
        this.releaseApp(task, appId)
      } catch (error) {
        control.status = 'unconfirmed'
        logger.error('Application control cleanup unconfirmed', { ownerId, appId, error })
        await this.finishTask(task.context)
      } finally {
        this.changed.fire()
      }
    })()
    return control.stopping
  }

  async stopAll(): Promise<void> {
    const tasks = [...this.tasks.values()]
    for (const task of tasks) this.owners.get(task.context.ownerId)!.stopped = true
    await Promise.all(tasks.map((task) => this.finishTask(task.context)))
    this.changed.fire()
  }

  allowControl(ownerId: string, appId?: string): void {
    const owner = this.owners.get(ownerId)
    if (!owner) return
    if (
      [...this.tasks.values()].some(
        (task) =>
          task.context.ownerId === ownerId &&
          (task.closing ||
            [...task.apps.values()].some(
              (app) => (!appId || app.app.id === appId) && (app.status === 'stopping' || app.status === 'unconfirmed')
            ))
      )
    )
      return
    if (appId) owner.blockedApps.delete(appId)
    else {
      owner.stopped = false
      owner.blockedApps.clear()
    }
    this.changed.fire()
  }

  finishTask(context: ComputerUseTask): Promise<void> {
    context.closed = true
    const task = this.tasks.get(context.id)
    if (!task) return Promise.resolve()
    if (task.closing) return task.closing
    task.detach()
    task.abort.abort()
    for (const control of task.apps.values()) if (control.status !== 'unconfirmed') control.status = 'stopping'
    task.closing = (async () => {
      try {
        const client = await task.client?.catch(() => undefined)
        await client?.close()
        this.releaseTask(task, true)
      } catch (error) {
        this.releaseTask(task, false)
        logger.error('Computer Use task cleanup unconfirmed', { ownerId: context.ownerId, error })
      }
    })()
    this.changed.fire()
    return task.closing
  }

  private getTask(context: ComputerUseTask): ControlTask {
    if (context.closed) throw new ComputerUseControlError('TASK_CLOSED')
    context.signal?.throwIfAborted()
    let task = this.tasks.get(context.id)
    if (!task) {
      task = { context, abort: new AbortController(), apps: new Map(), detach: () => {} }
      if (!this.owners.has(context.ownerId))
        this.owners.set(context.ownerId, { label: context.label, stopped: false, blockedApps: new Map() })
      this.assertAvailable(task)
      this.tasks.set(context.id, task)
      const abort = () => {
        void this.finishTask(context)
      }
      context.signal?.addEventListener('abort', abort, { once: true })
      task.detach = () => context.signal?.removeEventListener('abort', abort)
    }
    this.assertAvailable(task)
    return task
  }

  private getApp(task: ControlTask, appSessionId: string): AppControl {
    const control = [...task.apps.values()].find((app) => app.sessionId === appSessionId)
    if (!control) throw new ComputerUseControlError('UNKNOWN_APP_SESSION')
    this.assertAvailable(task, control.app.id)
    return control
  }

  private assertAvailable(task: ControlTask, appId?: string): void {
    this.shutdown.signal.throwIfAborted()
    if (!application.get('PreferenceService').get('app.computer_use.agent_control.enabled'))
      throw new ComputerUseControlError('CONTROL_DISABLED')
    const owner = this.owners.get(task.context.ownerId)
    if (owner?.stopped || (appId && owner?.blockedApps.has(appId))) throw new ComputerUseControlError('USER_STOPPED')
    if (task.context.closed) throw new ComputerUseControlError('TASK_CLOSED')
    task.abort.signal.throwIfAborted()
  }

  private signal(task: ControlTask, call?: AbortSignal): AbortSignal {
    return AbortSignal.any([task.abort.signal, this.shutdown.signal, ...(call ? [call] : [])])
  }

  private getClient(task: ControlTask): Promise<ComputerUseClient> {
    task.client ??= ComputerUse.start(
      { runtimePath: application.getPath('feature.computer_use.runtime') },
      { signal: this.signal(task) }
    ).then((client) => {
      client.onClosed(({ cleanup }) => {
        task.context.closed = true
        task.abort.abort()
        this.releaseTask(task, cleanup === 'complete')
      })
      return client
    })
    return task.client
  }

  private releaseApp(task: ControlTask, appId: string): void {
    task.apps.delete(appId)
    if (this.appOwners.get(appId) === task) this.appOwners.delete(appId)
  }

  private releaseTask(task: ControlTask, confirmed: boolean): void {
    task.detach()
    if (confirmed) {
      for (const appId of task.apps.keys()) this.releaseApp(task, appId)
      this.tasks.delete(task.context.id)
      const owner = this.owners.get(task.context.ownerId)
      if (
        owner &&
        !owner.stopped &&
        !owner.blockedApps.size &&
        ![...this.tasks.values()].some((other) => other.context.ownerId === task.context.ownerId)
      )
        this.owners.delete(task.context.ownerId)
    } else {
      task.cleanupUnconfirmed = true
      this.owners.get(task.context.ownerId)!.stopped = true
      for (const control of task.apps.values()) control.status = 'unconfirmed'
    }
    this.changed.fire()
  }

  getPermissionStatus(): Promise<PermissionStatus> {
    return this.withPermissionSession((client) => client.getPermissionStatus({ signal: this.shutdown.signal }))
  }

  requestPermissions(ids: [string, ...string[]]): Promise<PermissionStatus> {
    return this.withPermissionSession((client) => client.requestPermissions({ ids }, { signal: this.shutdown.signal }))
  }

  protected async onStop(): Promise<void> {
    this.shutdown.abort()
    await Promise.all([this.permissionMutex.waitForUnlock(), this.stopAll()])
  }

  protected onDestroy(): void {
    this.changed.dispose()
  }

  private withPermissionSession(
    run: (client: ComputerUseClient) => Promise<PermissionStatus>
  ): Promise<PermissionStatus> {
    return this.permissionMutex.runExclusive(async () => {
      this.shutdown.signal.throwIfAborted()
      // Requests retain the helper until onboarding closes; later queries use fresh permission preflight.
      const client = await ComputerUse.start(
        { runtimePath: application.getPath('feature.computer_use.runtime') },
        { signal: this.shutdown.signal }
      )
      try {
        return await run(client)
      } finally {
        await client.close()
      }
    })
  }
}
