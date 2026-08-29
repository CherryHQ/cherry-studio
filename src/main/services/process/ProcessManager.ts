import { loggerService } from '@logger'
import { BaseService, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { ChildProcessHandle } from './ChildProcessHandle'
import type {
  ChildProcessOptions,
  ProcessExitedEvent,
  ProcessHandle,
  ProcessLogLine,
  ProcessStartedEvent,
  UtilityProcessOptions
} from './types'
import { ProcessState } from './types'
import { UtilityProcessHandle } from './UtilityProcessHandle'

@Injectable('ProcessManager')
@ServicePhase(Phase.WhenReady)
export class ProcessManager extends BaseService {
  private readonly _onProcessStarted = this.registerDisposable(new Emitter<ProcessStartedEvent>())
  readonly onProcessStarted: Event<ProcessStartedEvent> = this._onProcessStarted.event

  private readonly _onProcessExited = this.registerDisposable(new Emitter<ProcessExitedEvent>())
  readonly onProcessExited: Event<ProcessExitedEvent> = this._onProcessExited.event

  private readonly _onProcessLog = this.registerDisposable(new Emitter<ProcessLogLine>())
  readonly onProcessLog: Event<ProcessLogLine> = this._onProcessLog.event

  private readonly handles = new Map<string, ProcessHandle>()
  private readonly logger = loggerService.withContext('ProcessManager')

  register(options: ChildProcessOptions): ChildProcessHandle
  register(options: UtilityProcessOptions): UtilityProcessHandle
  register(options: ChildProcessOptions | UtilityProcessOptions): ChildProcessHandle | UtilityProcessHandle {
    if (this.handles.has(options.id)) {
      throw new Error(`Process '${options.id}' is already registered`)
    }

    const handle = 'modulePath' in options ? new UtilityProcessHandle(options) : new ChildProcessHandle(options)

    handle.onStarted = (pid) => this._onProcessStarted.fire({ id: options.id, pid })
    handle.onExited = (code, signal) => this._onProcessExited.fire({ id: options.id, code, signal })
    handle.onLog = (line) => this._onProcessLog.fire(line)

    this.handles.set(options.id, handle)
    return handle
  }

  get(id: string): ProcessHandle | undefined {
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
    this.logger.info('ProcessManager initialized')
  }

  protected async onStop(): Promise<void> {
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
