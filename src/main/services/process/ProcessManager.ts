import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { ChildProcessHandle } from './ChildProcessHandle'
import type { ChildProcessOptions } from './types'
import { ProcessState } from './types'

@Injectable('ProcessManager')
@ServicePhase(Phase.WhenReady)
export class ProcessManager extends BaseService {
  private readonly handles = new Map<string, ChildProcessHandle>()
  private readonly logger = loggerService.withContext('ProcessManager')
  private acceptingProcesses = true

  register(options: ChildProcessOptions): ChildProcessHandle {
    if (!this.acceptingProcesses) {
      throw new Error('ProcessManager is not accepting new processes')
    }
    if (this.handles.has(options.id)) {
      throw new Error(`Process '${options.id}' is already registered`)
    }

    const handle = new ChildProcessHandle(options, () => this.acceptingProcesses)
    this.handles.set(options.id, handle)
    return handle
  }

  get(id: string): ChildProcessHandle | undefined {
    return this.handles.get(id)
  }

  async unregister(id: string): Promise<void> {
    const handle = this.handles.get(id)
    if (!handle) {
      return
    }

    if (handle.state === ProcessState.Starting) {
      try {
        await handle.start()
      } catch {
        // A failed start is terminal and safe to unregister.
      }
    }

    if (
      handle.state === ProcessState.Starting ||
      handle.state === ProcessState.Running ||
      handle.state === ProcessState.Stopping
    ) {
      throw new Error(`Cannot unregister process '${id}': process is currently active (${handle.state})`)
    }

    this.handles.delete(id)
  }

  protected async onInit(): Promise<void> {
    this.acceptingProcesses = true
    this.logger.info('ProcessManager initialized')
  }

  protected async onStop(): Promise<void> {
    this.acceptingProcesses = false
    const activeHandles = Array.from(this.handles.values()).filter(
      (handle) =>
        !handle.skipOnStop &&
        (handle.state === ProcessState.Starting ||
          handle.state === ProcessState.Running ||
          handle.state === ProcessState.Stopping)
    )

    this.logger.info(`Stopping ${activeHandles.length} active process(es)`)

    await Promise.all(
      activeHandles.map(async (handle) => {
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
