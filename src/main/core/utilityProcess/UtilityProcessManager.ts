import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { app } from 'electron'

import { validateUtilityProcessDefinition } from './defineUtilityProcess'
import { electronProcessAdapter } from './host/electronProcessAdapter'
import { ProcessHost, type ProcessHostDeps } from './host/ProcessHost'
import type { UtilityProcessClient, UtilityProcessContract, UtilityProcessDefinition } from './types'
import { UtilityProcessError } from './UtilityProcessError'

export type UtilityProcessManagerDeps = ProcessHostDeps

/**
 * Owns one ProcessHost per registered definition and hands consumers typed clients.
 * Nothing spawns until the first `request()`; every live process is stopped on `onStop`.
 * Clients never expose forks, pids, ports, or generations (RFC §3.2).
 */
@Injectable('UtilityProcessManager')
@ServicePhase(Phase.WhenReady)
export class UtilityProcessManager extends BaseService {
  private readonly definitions = new Map<string, UtilityProcessDefinition<any, any>>()
  private readonly deps: ProcessHostDeps
  /** Kept until the confirmed exit — across onStop and a restart — so stop barriers stay truthful. */
  private readonly hosts = new Map<string, ProcessHost<any, any>>()
  private readonly clients = new WeakMap<UtilityProcessDefinition<any, any>, UtilityProcessClient<any>>()
  /** False outside onInit..onStop: requests fail fast instead of spawning into a shutdown. */
  private accepting = false

  constructor(deps: Partial<UtilityProcessManagerDeps> = {}) {
    super()
    this.deps = {
      adapter: deps.adapter ?? electronProcessAdapter,
      logger: deps.logger ?? loggerService.withContext('UtilityProcessManager'),
      resolveEntry: deps.resolveEntry ?? ((entry) => application.getPath('app.utility_process', `${entry}.js`)),
      getTempDir: deps.getTempDir ?? (() => application.getPath('app.temp'))
    }
  }

  /**
   * Registers a definition, normally from the consumer service's `onInit` (declare
   * `@DependsOn(['UtilityProcessManager'])`). The same object again is a no-op, so a service
   * restart is safe; a different object with the same id is refused.
   */
  register<Contract extends UtilityProcessContract, InitData>(
    definition: UtilityProcessDefinition<Contract, InitData>
  ): void {
    validateUtilityProcessDefinition(definition)
    const existing = this.definitions.get(definition.id)
    if (existing === definition) return
    if (existing !== undefined) {
      throw new Error(`utility process '${definition.id}' is already registered with a different definition object`)
    }
    this.definitions.set(definition.id, definition)
  }

  /** Returns the cached client for a registered definition; accepts only the registered object itself. */
  client<Contract extends UtilityProcessContract, InitData>(
    definition: UtilityProcessDefinition<Contract, InitData>
  ): UtilityProcessClient<Contract> {
    if (this.definitions.get(definition.id) !== definition) {
      throw new Error(
        `utility process '${definition.id}' is not registered; call register() from the consumer's onInit`
      )
    }
    const cached = this.clients.get(definition)
    if (cached !== undefined) return cached as UtilityProcessClient<Contract>
    const client: UtilityProcessClient<Contract> = {
      request: async (method, input, options) => this.hostFor(definition).request(method, input, options),
      stop: (options) => this.hosts.get(definition.id)?.stop(options) ?? Promise.resolve(),
      withStopped: async (operation, options) => {
        const host = this.hosts.get(definition.id) ?? (this.accepting ? this.hostFor(definition) : null)
        return host === null ? operation() : host.withStopped(operation, options)
      }
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

  /** Each host leaves the map only at its confirmed exit; a stuck child keeps its slot and blocks a successor. */
  private async disposeHosts(): Promise<void> {
    this.accepting = false
    const hosts = [...this.hosts.entries()]
    for (const [id, host] of hosts) {
      void host.whenQuiescent().then(() => {
        if (this.hosts.get(id) === host) this.hosts.delete(id)
      })
    }
    await Promise.allSettled(hosts.map(([, host]) => host.dispose()))
  }
}
