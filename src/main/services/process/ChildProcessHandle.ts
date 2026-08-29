import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import type { ChildProcess } from 'child_process'

import type { ChildProcessOptions, ProcessHandle, ProcessLogLine } from './types'
import { DEFAULT_KILL_TIMEOUT_MS, ProcessState } from './types'

export class ChildProcessHandle implements ProcessHandle {
  readonly id: string

  private _state: ProcessState = ProcessState.Idle
  private _pid: number | undefined = undefined
  private _process: ChildProcess | undefined = undefined
  private _exited = false
  private _startPromise: Promise<void> | undefined = undefined
  private _stopPromise: Promise<void> | undefined = undefined
  private readonly def: ChildProcessOptions
  private readonly logger: ReturnType<typeof loggerService.withContext>

  onStarted: ((pid: number) => void) | undefined = undefined
  onExited: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined = undefined
  onLog: ((line: ProcessLogLine) => void) | undefined = undefined

  constructor(def: ChildProcessOptions) {
    this.def = def
    this.id = def.id
    this.logger = loggerService.withContext(`Process:${def.id}`)
  }

  get state(): ProcessState {
    return this._state
  }

  get pid(): number | undefined {
    return this._pid
  }

  get skipOnStop(): boolean {
    return this.def.skipOnStop ?? false
  }

  async start(): Promise<void> {
    if (this._state === ProcessState.Starting) {
      return this._startPromise!
    }
    if (this._state === ProcessState.Running || this._state === ProcessState.Stopping) {
      throw new Error(`Process ${this.id} is already running (state: ${this._state})`)
    }

    this.logger.info(`Starting process: ${this.def.command}`)
    this._state = ProcessState.Starting
    this._exited = false

    const startPromise = this.startProcess()
    this._startPromise = startPromise
    try {
      await startPromise
    } finally {
      if (this._startPromise === startPromise) this._startPromise = undefined
    }
  }

  private async startProcess(): Promise<void> {
    let child: ChildProcess
    try {
      const shellEnv = await getShellEnv()
      const env = this.def.env ? { ...shellEnv, ...this.def.env } : shellEnv
      child = crossPlatformSpawn(this.def.command, this.def.args ?? [], {
        cwd: this.def.cwd,
        env,
        detached: this.def.detached,
        stdio: this.def.stdio
      })
      if (this.def.detached) child.unref()

      this._process = child
      this.registerProcessListeners(child)
      await this.waitForSpawn(child)
    } catch (err) {
      if (!this._exited) this.handleProcessError(err as Error)
      throw err
    }
  }

  private waitForSpawn(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onStartupError)
        this._state = ProcessState.Running
        this._pid = child.pid
        if (child.pid !== undefined) {
          this.logger.info(`Process started with pid ${child.pid}`)
          this.onStarted?.(child.pid)
        }
        resolve()
      }
      const onStartupError = (err: Error) => {
        child.off('spawn', onSpawn)
        reject(err)
      }
      child.once('spawn', onSpawn)
      child.once('error', onStartupError)
    })
  }

  private registerProcessListeners(child: ChildProcess): void {
    child.stdout?.on('data', (data: Buffer) => this.handleLog('stdout', data))
    child.stderr?.on('data', (data: Buffer) => this.handleLog('stderr', data))
    child.on('close', (code, signal) => this.handleProcessClose(code, signal))
    child.on('error', (err) => this.handleProcessError(err))
  }

  private handleLog(stream: ProcessLogLine['stream'], data: Buffer): void {
    const line: ProcessLogLine = { processId: this.id, stream, data: data.toString(), timestamp: Date.now() }
    if (stream === 'stdout') this.logger.debug(line.data.trimEnd())
    else this.logger.warn(line.data.trimEnd())
    this.onLog?.(line)
  }

  private handleProcessClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this._exited) return
    this._exited = true
    this._pid = undefined
    this._process = undefined

    if (this._state === ProcessState.Stopping) {
      this._state = ProcessState.Stopped
      this.logger.info(`Process stopped (code=${code}, signal=${signal})`)
    } else if (code !== 0) {
      this._state = ProcessState.Crashed
      this.logger.warn(`Process crashed (code=${code}, signal=${signal})`)
    } else {
      this._state = ProcessState.Stopped
      this.logger.info(`Process exited cleanly (code=${code})`)
    }

    this.onExited?.(code, signal)
  }

  private handleProcessError(err: Error): void {
    if (this._exited) return
    this._exited = true
    this._state = ProcessState.Crashed
    this._pid = undefined
    this._process = undefined
    this.logger.error(`Process error: ${err.message}`, err)
    this.onExited?.(null, null)
  }

  stop(): Promise<void> {
    if (this._stopPromise) return this._stopPromise

    const stopPromise = this._state === ProcessState.Starting ? this.stopAfterStart() : this.stopRunningProcess()
    const trackedPromise = stopPromise.finally(() => {
      if (this._stopPromise === trackedPromise) this._stopPromise = undefined
    })
    this._stopPromise = trackedPromise
    return trackedPromise
  }

  private async stopAfterStart(): Promise<void> {
    try {
      await this._startPromise
    } catch {
      return
    }
    await this.stopRunningProcess()
  }

  private async stopRunningProcess(): Promise<void> {
    if (this._state !== ProcessState.Running && this._state !== ProcessState.Stopping) return

    if (this._state === ProcessState.Running) {
      this._state = ProcessState.Stopping
      this.logger.info(`Stopping process (pid=${this._pid})`)
    }

    const child = this._process
    if (!child) {
      this._state = ProcessState.Stopped
      return
    }

    await this.stopProcess(child)
  }

  private async stopProcess(child: ChildProcess): Promise<void> {
    const killTimeoutMs = this.def.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS
    const deadline = Date.now() + killTimeoutMs
    const gracefulTimeoutMs = Math.floor(killTimeoutMs * 0.75)

    const gracefulExit = waitForProcessExit(child, gracefulTimeoutMs)
    await this.signalProcess(child, false)
    if (await gracefulExit) {
      return
    }

    this.logger.warn(`Kill timeout reached, sending SIGKILL to pid=${this._pid ?? child.pid}`)
    const forcedExit = waitForProcessExit(child, Math.max(0, deadline - Date.now()))
    await this.signalProcess(child, true)
    if (!(await forcedExit)) {
      throw new Error(`Process ${this.id} did not exit after forced termination`)
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  private async signalProcess(child: ChildProcess, force: boolean): Promise<void> {
    if (isWin || this.def.detached) {
      await terminateProcessTree(child, force, this.id)
      return
    }

    child.kill(force ? 'SIGKILL' : 'SIGTERM')
  }
}
