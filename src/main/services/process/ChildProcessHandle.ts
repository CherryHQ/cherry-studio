import { loggerService } from '@logger'
import { crossPlatformSpawn } from '@main/utils/process'
import getShellEnv from '@main/utils/shell-env'
import type { ChildProcess } from 'child_process'

import type { ChildProcessOptions, ProcessHandle, ProcessLogLine } from './types'
import { ProcessState } from './types'

const DEFAULT_KILL_TIMEOUT_MS = 5000

export class ChildProcessHandle implements ProcessHandle {
  readonly id: string

  private _state: ProcessState = ProcessState.Idle
  private _pid: number | undefined = undefined
  private _process: ChildProcess | undefined = undefined
  private _exited = false
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
    if (this._state === ProcessState.Running || this._state === ProcessState.Stopping) {
      throw new Error(`Process ${this.id} is already running (state: ${this._state})`)
    }

    this.logger.info(`Starting process: ${this.def.command}`)

    const shellEnv = await getShellEnv()
    const env = this.def.env ? { ...shellEnv, ...this.def.env } : shellEnv

    this._exited = false

    let child: ChildProcess
    try {
      child = crossPlatformSpawn(this.def.command, this.def.args ?? [], {
        cwd: this.def.cwd,
        env,
        detached: this.def.detached,
        stdio: this.def.stdio
      })
    } catch (err) {
      this._state = ProcessState.Crashed
      this.logger.error(`Failed to spawn process: ${(err as Error).message}`, err as Error)
      this.onExited?.(null, null)
      throw err
    }

    if (this.def.detached) {
      child.unref()
    }

    this._process = child
    this._state = ProcessState.Running
    this._pid = child.pid

    if (child.pid !== undefined) {
      this.logger.info(`Process started with pid ${child.pid}`)
      this.onStarted?.(child.pid)
    }

    child.stdout?.on('data', (data: Buffer) => {
      const line: ProcessLogLine = {
        processId: this.id,
        stream: 'stdout',
        data: data.toString(),
        timestamp: Date.now()
      }
      this.logger.debug(line.data.trimEnd())
      this.onLog?.(line)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const line: ProcessLogLine = {
        processId: this.id,
        stream: 'stderr',
        data: data.toString(),
        timestamp: Date.now()
      }
      this.logger.warn(line.data.trimEnd())
      this.onLog?.(line)
    })

    child.on('close', (code, signal) => {
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
    })

    child.on('error', (err) => {
      if (this._exited) return
      this._exited = true

      this._state = ProcessState.Crashed
      this._pid = undefined
      this._process = undefined
      this.logger.error(`Process error: ${err.message}`, err)
      this.onExited?.(null, null)
    })
  }

  async stop(): Promise<void> {
    if (this._state !== ProcessState.Running) {
      return
    }

    this._state = ProcessState.Stopping
    this.logger.info(`Stopping process (pid=${this._pid})`)

    const child = this._process
    if (!child) {
      this._state = ProcessState.Stopped
      return
    }

    return new Promise<void>((resolve) => {
      const killTimeoutMs = this.def.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS

      const killTimer = setTimeout(() => {
        this.logger.warn(`Kill timeout reached, sending SIGKILL to pid=${this._pid ?? child.pid}`)
        child.kill('SIGKILL')
        resolve()
      }, killTimeoutMs)

      child.once('close', () => {
        clearTimeout(killTimer)
        resolve()
      })

      child.kill('SIGTERM')
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }
}
