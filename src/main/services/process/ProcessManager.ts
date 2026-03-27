import EventEmitter from 'node:events'

import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { ChildProcessHandle } from './ChildProcessHandle'
import type { ChildProcessOptions, ProcessHandle, ProcessManagerEvents, UtilityProcessOptions } from './types'
import { ProcessState } from './types'
import { UtilityProcessHandle } from './UtilityProcessHandle'

@Injectable('ProcessManager')
@ServicePhase(Phase.WhenReady)
export class ProcessManager extends BaseService {
  private readonly emitter = new EventEmitter()
  private readonly handles = new Map<string, ProcessHandle>()
  private readonly logger = loggerService.withContext('ProcessManager')

  register(options: ChildProcessOptions): ChildProcessHandle
  register(options: UtilityProcessOptions): UtilityProcessHandle
  register(options: ChildProcessOptions | UtilityProcessOptions): ChildProcessHandle | UtilityProcessHandle {
    if (this.handles.has(options.id)) {
      throw new Error(`Process '${options.id}' is already registered`)
    }

    const handle = 'modulePath' in options ? new UtilityProcessHandle(options) : new ChildProcessHandle(options)

    handle.onStarted = (pid) => this.emitter.emit('process:started', options.id, pid)
    handle.onExited = (code, signal) => this.emitter.emit('process:exited', options.id, code, signal)
    handle.onLog = (line) => this.emitter.emit('process:log', line)

    this.handles.set(options.id, handle)
    return handle
  }

  get(id: string): ProcessHandle | undefined {
    return this.handles.get(id)
  }

  unregister(id: string): void {
    const handle = this.handles.get(id)
    if (!handle) {
      return
    }

    if (handle.state === ProcessState.Running) {
      throw new Error(`Cannot unregister process '${id}': process is currently running`)
    }

    this.handles.delete(id)
  }

  on<K extends keyof ProcessManagerEvents>(event: K, listener: ProcessManagerEvents[K]): void {
    this.emitter.on(event, listener as (...args: any[]) => void)
  }

  off<K extends keyof ProcessManagerEvents>(event: K, listener: ProcessManagerEvents[K]): void {
    this.emitter.off(event, listener as (...args: any[]) => void)
  }

  protected async onInit(): Promise<void> {
    this.logger.info('ProcessManager initialized')
  }

  protected async onStop(): Promise<void> {
    const runningHandles = Array.from(this.handles.values()).filter(
      (h) => h.state === ProcessState.Running && !h.skipOnStop
    )

    this.logger.info(`Stopping ${runningHandles.length} running process(es)`)

    await Promise.all(
      runningHandles.map(async (handle) => {
        try {
          await handle.stop()
        } catch (err) {
          this.logger.error(`Failed to stop process '${handle.id}'`, err as Error)
        }
      })
    )

    this.logger.info('All processes stopped')
  }
}
