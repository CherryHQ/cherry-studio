import { loggerService } from '@logger'
import { utilityProcess } from 'electron'

import type { ProcessHandle, ProcessLogLine, UtilityProcessOptions } from './types'
import { ProcessState } from './types'

const DEFAULT_KILL_TIMEOUT_MS = 5000

export class UtilityProcessHandle implements ProcessHandle {
  readonly id: string

  private _state: ProcessState = ProcessState.Idle
  private _pid: number | undefined = undefined
  private _process: Electron.UtilityProcess | undefined = undefined
  private _exited = false
  private readonly def: UtilityProcessOptions
  private readonly logger: ReturnType<typeof loggerService.withContext>
  private readonly messageHandlers = new Set<(message: unknown) => void>()

  onStarted: ((pid: number) => void) | undefined = undefined
  onExited: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined = undefined
  onLog: ((line: ProcessLogLine) => void) | undefined = undefined

  constructor(def: UtilityProcessOptions) {
    this.def = def
    this.id = def.id
    this.logger = loggerService.withContext(`UtilityProcess:${def.id}`)
  }

  get state(): ProcessState {
    return this._state
  }

  get pid(): number | undefined {
    return this._pid
  }

  get skipOnStop(): boolean {
    return false
  }

  async start(): Promise<void> {
    if (this._state === ProcessState.Running || this._state === ProcessState.Stopping) {
      throw new Error(`Process ${this.id} is already running (state: ${this._state})`)
    }

    this.logger.info(`Starting utility process: ${this.def.modulePath}`)

    this._exited = false

    let proc: Electron.UtilityProcess
    try {
      proc = utilityProcess.fork(this.def.modulePath, this.def.args, {
        env: this.def.env
      })
    } catch (err) {
      this._state = ProcessState.Crashed
      this.logger.error(`Failed to fork utility process: ${(err as Error).message}`, err as Error)
      this.onExited?.(null, null)
      throw err
    }

    this._process = proc
    this._state = ProcessState.Running
    this._pid = proc.pid

    if (proc.pid !== undefined) {
      this.logger.info(`Utility process started with pid ${proc.pid}`)
      this.onStarted?.(proc.pid)
    }

    proc.on('message', (message: unknown) => {
      for (const handler of this.messageHandlers) {
        handler(message)
      }
    })

    proc.on('exit', (code: number) => {
      if (this._exited) return
      this._exited = true

      this._pid = undefined
      this._process = undefined

      if (this._state === ProcessState.Stopping) {
        this._state = ProcessState.Stopped
        this.logger.info(`Utility process stopped (code=${code})`)
      } else if (code !== 0) {
        this._state = ProcessState.Crashed
        this.logger.warn(`Utility process crashed (code=${code})`)
      } else {
        this._state = ProcessState.Stopped
        this.logger.info(`Utility process exited cleanly (code=${code})`)
      }

      this.onExited?.(code, null)
    })
  }

  async stop(): Promise<void> {
    if (this._state !== ProcessState.Running) {
      return
    }

    this._state = ProcessState.Stopping
    this.logger.info(`Stopping utility process (pid=${this._pid})`)

    const proc = this._process
    if (!proc) {
      this._state = ProcessState.Stopped
      return
    }

    return new Promise<void>((resolve) => {
      const killTimeoutMs = this.def.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS

      const killTimer = setTimeout(() => {
        this.logger.warn(`Kill timeout reached for utility process pid=${this._pid ?? proc.pid}, resolving`)
        this._exited = true
        this._state = ProcessState.Stopped
        this._pid = undefined
        this._process = undefined
        resolve()
      }, killTimeoutMs)

      proc.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })

      proc.kill()
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  postMessage(message: unknown): void {
    if (!this._process) {
      throw new Error(`Process ${this.id} is not running`)
    }
    this._process.postMessage(message)
  }

  onMessage(handler: (message: unknown) => void): () => void {
    this.messageHandlers.add(handler)
    return () => {
      this.messageHandlers.delete(handler)
    }
  }
}
