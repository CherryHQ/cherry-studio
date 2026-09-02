import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { app } from 'electron'

import { electronProcessAdapter } from './host/electronProcessAdapter'
import { ProcessHost, type ProcessHostDeps } from './host/ProcessHost'
import { getInstalledUtilityProcessManifest } from './installedManifest'
import type { UtilityProcessClient, UtilityProcessContract, UtilityProcessDefinition } from './types'
import { UtilityProcessError } from './UtilityProcessError'

export type UtilityProcessManagerDeps = ProcessHostDeps

/**
 * Owns one ProcessHost per installed definition and hands consumers typed clients.
 * Nothing spawns until the first `request()`; every live process is stopped on `onStop`.
 * Clients never expose forks, pids, ports, or generations (RFC §3.2).
 */
@Injectable('UtilityProcessManager')
@ServicePhase(Phase.WhenReady)
export class UtilityProcessManager extends BaseService {
  private readonly manifest: ReadonlyMap<string, UtilityProcessDefinition<any, any>>
  private readonly deps: ProcessHostDeps
  private readonly hosts = new Map<string, ProcessHost<any, any>>()
  private readonly clients = new WeakMap<UtilityProcessDefinition<any, any>, UtilityProcessClient<any>>()
  /** False outside onInit..onStop: requests fail fast instead of spawning into a shutdown. */
  private accepting = false

  constructor(deps: Partial<UtilityProcessManagerDeps> = {}) {
    super()
    this.manifest = getInstalledUtilityProcessManifest()
    this.deps = {
      adapter: deps.adapter ?? electronProcessAdapter,
      logger: deps.logger ?? loggerService.withContext('UtilityProcessManager'),
      resolveEntry: deps.resolveEntry ?? ((entry) => application.getPath('app.utility_process', `${entry}.js`)),
      getTempDir: deps.getTempDir ?? (() => application.getPath('app.temp'))
    }
  }

  /** Returns the cached client for an installed definition; accepts only the manifest's own object. */
  client<Contract extends UtilityProcessContract, InitData>(
    definition: UtilityProcessDefinition<Contract, InitData>
  ): UtilityProcessClient<Contract> {
    if (this.manifest.get(definition.id) !== definition) {
      throw new Error(`utility process '${definition.id}' is not an installed manifest definition`)
    }
    const cached = this.clients.get(definition)
    if (cached !== undefined) return cached as UtilityProcessClient<Contract>
    const client: UtilityProcessClient<Contract> = {
      request: async (method, input, options) => this.hostFor(definition).request(method, input, options),
      stop: (options) => this.hosts.get(definition.id)?.stop(options) ?? Promise.resolve(),
      withStopped: async (operation, options) =>
        this.accepting ? this.hostFor(definition).withStopped(operation, options) : operation()
    }
    this.clients.set(definition, client)
    return client
  }

  protected onInit(): void {
    this.accepting = true
    const onChildProcessGone = (_event: Electron.Event, details: Electron.Details): void => {
      if (details.type !== 'Utility') return
      for (const host of this.hosts.values()) {
        host.noteChildProcessGone({
          reason: details.reason,
          exitCode: details.exitCode,
          serviceName: details.serviceName
        })
      }
    }
    app.on('child-process-gone', onChildProcessGone)
    this.registerDisposable(() => app.off('child-process-gone', onChildProcessGone))
  }

  protected async onStop(): Promise<void> {
    await this.disposeHosts()
  }

  protected async onDestroy(): Promise<void> {
    await this.disposeHosts()
  }

  private hostFor(definition: UtilityProcessDefinition<any, any>): ProcessHost<any, any> {
    const existing = this.hosts.get(definition.id)
    if (existing !== undefined) return existing
    if (!this.accepting) {
      throw new UtilityProcessError('PROCESS_BLOCKED', `utility process '${definition.id}': manager is not running`, {
        processId: definition.id
      })
    }
    const host = new ProcessHost(definition, this.deps)
    this.hosts.set(definition.id, host)
    return host
  }

  private async disposeHosts(): Promise<void> {
    this.accepting = false
    const hosts = [...this.hosts.values()]
    this.hosts.clear()
    await Promise.allSettled(hosts.map((host) => host.dispose()))
  }
}
