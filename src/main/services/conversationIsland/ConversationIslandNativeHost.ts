import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import { application } from '@application'
import { loggerService } from '@logger'
import { app } from 'electron'

import {
  type ConversationIslandCommand,
  type ConversationIslandHelperEvent,
  decodeConversationIslandHelperEvent,
  encodeConversationIslandCommand,
  JsonLineDecoder
} from './conversationIslandProtocol'

const logger = loggerService.withContext('ConversationIsland:Native')
const READY_TIMEOUT_MS = 3_000
const IDLE_TIMEOUT_MS = 30_000
const SHUTDOWN_GRACE_MS = 1_000
const STDERR_MAX_LINE_LENGTH = 4_096

export type PresentCommand = Extract<ConversationIslandCommand, { type: 'present' }>
export type DismissCommand = Extract<ConversationIslandCommand, { type: 'dismiss' }>
type StateCommand = PresentCommand | DismissCommand
type SetExpandedEvent = Extract<ConversationIslandHelperEvent, { type: 'setExpanded' }>
type OpenActivityEvent = Extract<ConversationIslandHelperEvent, { type: 'openActivity' }>
type TimerHandle = ReturnType<typeof setTimeout>

type SpawnProcess = (
  executable: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; shell: false }
) => ChildProcessWithoutNullStreams

interface NativeHostCallbacks {
  onReady?: (pid: number) => void
  onSetExpanded?: (event: SetExpandedEvent) => void
  onOpenActivity?: (event: OpenActivityEvent) => void
}

interface NativeHostOptions {
  spawnProcess?: SpawnProcess
  now?: () => number
  setTimeout?: (callback: () => void, delay: number) => TimerHandle
  clearTimeout?: (timer: TimerHandle) => void
  callbacks?: NativeHostCallbacks
}

type FailureReason =
  | 'invalid-utf8'
  | 'line-too-long'
  | 'process-error'
  | 'process-exit'
  | 'ready-timeout'
  | 'spawn-error'
  | 'stdin-closed'
  | 'stdin-error'
  | 'stdin-write-error'
  | 'stdout-closed'
  | 'stdout-error'
  | 'stdout-incomplete-line'

interface Generation {
  id: number
  child: ChildProcessWithoutNullStreams
  stdoutDecoder: JsonLineDecoder
  stderrDecoder: StringDecoder
  stderrLine: string
  ready: boolean
  blocked: boolean
  stopping: boolean
  exited: boolean
  readyTimer: TimerHandle | null
  idleTimer: TimerHandle | null
  terminateTimer: TimerHandle | null
  killTimer: TimerHandle | null
  drainListener: (() => void) | null
  readonly exitPromise: Promise<void>
  resolveExit: () => void
  readonly listeners: {
    childError: () => void
    childExit: () => void
    stdinClose: () => void
    stdinError: () => void
    stdoutData: (chunk: Buffer | string) => void
    stdoutEnd: () => void
    stdoutError: () => void
    stderrData: (chunk: Buffer | string) => void
    stderrEnd: () => void
    stderrError: () => void
  }
}

function resolveExecutablePath(): string {
  if (app.isPackaged) {
    return application.getPath('app.extra_resources', 'conversation-island-helper')
  }

  return path.join(
    application.getPath('app.root.resources.binaries'),
    `darwin-${process.arch}`,
    'conversation-island-helper'
  )
}

export class ConversationIslandNativeHost {
  private readonly spawnProcess: SpawnProcess
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delay: number) => TimerHandle
  private readonly clearTimer: (timer: TimerHandle) => void
  private readonly callbacks: NativeHostCallbacks
  private generationSequence = 0
  private current: Generation | null = null
  private desired: StateCommand | null = null
  private pending: StateCommand | null = null
  private terminateAfterHiddenRevision: number | null = null
  private closed = false
  private shutdownPromise: Promise<void> | null = null

  constructor(options: NativeHostOptions = {}) {
    this.spawnProcess =
      options.spawnProcess ?? ((executable, args, spawnOptions) => spawn(executable, args, spawnOptions))
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay))
    this.clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer))
    this.callbacks = options.callbacks ?? {}
  }

  public present(command: PresentCommand): void {
    if (this.closed || !this.updateDesired(command)) return

    if (this.current) this.clearIdleTimer(this.current)
    this.terminateAfterHiddenRevision = null

    if (!this.current) this.start()
    this.flushPending()
  }

  public dismiss(command: DismissCommand, terminateAfterHidden = false): void {
    if (this.closed || !this.updateDesired(command)) return

    this.terminateAfterHiddenRevision = terminateAfterHidden ? command.revision : null
    this.flushPending()
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise

    this.closed = true
    this.pending = null
    this.desired = null
    this.terminateAfterHiddenRevision = null

    const generation = this.current
    this.shutdownPromise = generation ? this.stopGeneration(generation) : Promise.resolve()
    return this.shutdownPromise
  }

  private updateDesired(command: StateCommand): boolean {
    if (this.desired && command.revision < this.desired.revision) return false

    this.desired = command
    this.pending = command
    return true
  }

  private start(): void {
    let child: ChildProcessWithoutNullStreams

    try {
      child = this.spawnProcess(resolveExecutablePath(), [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      })
    } catch {
      this.handleUnexpectedFailure('spawn-error')
      return
    }

    let resolveExit: () => void = () => {}
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const generation: Generation = {
      id: ++this.generationSequence,
      child,
      stdoutDecoder: new JsonLineDecoder(),
      stderrDecoder: new StringDecoder('utf8'),
      stderrLine: '',
      ready: false,
      blocked: false,
      stopping: false,
      exited: false,
      readyTimer: null,
      idleTimer: null,
      terminateTimer: null,
      killTimer: null,
      drainListener: null,
      exitPromise,
      resolveExit,
      listeners: {
        childError: () => this.handleUnexpectedFailure('process-error', generation),
        childExit: () => this.handleExit(generation),
        stdinClose: () => this.handleUnexpectedFailure('stdin-closed', generation),
        stdinError: () => this.handleUnexpectedFailure('stdin-error', generation),
        stdoutData: (chunk: Buffer | string) => this.handleStdoutData(generation, chunk),
        stdoutEnd: () => this.handleStdoutEnd(generation),
        stdoutError: () => this.handleUnexpectedFailure('stdout-error', generation),
        stderrData: (chunk: Buffer | string) => this.handleStderrData(generation, chunk),
        stderrEnd: () => this.handleStderrEnd(generation),
        stderrError: () => undefined
      }
    }

    this.current = generation
    this.attachListeners(generation)
    generation.readyTimer = this.createTimer(READY_TIMEOUT_MS, () => {
      this.handleUnexpectedFailure('ready-timeout', generation)
    })
  }

  private attachListeners(generation: Generation): void {
    const { child, listeners } = generation
    child.on('error', listeners.childError)
    child.on('exit', listeners.childExit)
    child.stdin.on('close', listeners.stdinClose)
    child.stdin.on('error', listeners.stdinError)
    child.stdout.on('data', listeners.stdoutData)
    child.stdout.on('end', listeners.stdoutEnd)
    child.stdout.on('error', listeners.stdoutError)
    child.stderr.on('data', listeners.stderrData)
    child.stderr.on('end', listeners.stderrEnd)
    child.stderr.on('error', listeners.stderrError)
  }

  private handleStdoutData(generation: Generation, chunk: Buffer | string): void {
    if (!this.isActive(generation)) return

    for (const frame of generation.stdoutDecoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
      if (frame.kind === 'error') {
        this.handleUnexpectedFailure(frame.reason, generation)
        return
      }

      let event: ConversationIslandHelperEvent
      try {
        event = decodeConversationIslandHelperEvent(frame.line)
      } catch {
        logger.warn('Ignored invalid Conversation Island helper event')
        continue
      }

      this.handleHelperEvent(generation, event)
      if (!this.isActive(generation)) return
    }
  }

  private handleStdoutEnd(generation: Generation): void {
    if (!this.isActive(generation)) return

    const { hadIncompleteLine } = generation.stdoutDecoder.end()
    this.handleUnexpectedFailure(hadIncompleteLine ? 'stdout-incomplete-line' : 'stdout-closed', generation)
  }

  private handleHelperEvent(generation: Generation, event: ConversationIslandHelperEvent): void {
    if (event.type === 'ready') {
      if (generation.ready) return

      generation.ready = true
      this.clearReadyTimer(generation)
      this.callbacks.onReady?.(event.pid)
      this.flushPending()
      return
    }

    if (!generation.ready || event.revision !== this.desired?.revision) return

    switch (event.type) {
      case 'setExpanded':
        this.callbacks.onSetExpanded?.(event)
        break
      case 'openActivity':
        this.callbacks.onOpenActivity?.(event)
        break
      case 'hidden':
        if (this.desired.type !== 'dismiss') return
        if (this.terminateAfterHiddenRevision === event.revision) {
          void this.stopGeneration(generation)
          return
        }
        this.scheduleIdleShutdown(generation, event.revision)
        break
    }
  }

  private flushPending(): void {
    const generation = this.current
    if (!generation || !this.isActive(generation) || !generation.ready || generation.blocked || !this.pending) return

    const command = this.pending
    this.pending = null

    try {
      if (!generation.child.stdin.write(encodeConversationIslandCommand(command))) {
        generation.blocked = true
        const onDrain = () => {
          if (generation.drainListener === onDrain) generation.drainListener = null
          if (!this.isActive(generation)) return
          generation.blocked = false
          this.flushPending()
        }
        generation.drainListener = onDrain
        generation.child.stdin.once('drain', onDrain)
      }
    } catch {
      this.handleUnexpectedFailure('stdin-write-error', generation)
    }
  }

  private scheduleIdleShutdown(generation: Generation, revision: number): void {
    this.clearIdleTimer(generation)
    generation.idleTimer = this.createTimer(IDLE_TIMEOUT_MS, () => {
      generation.idleTimer = null
      if (this.isActive(generation) && this.desired?.type === 'dismiss' && this.desired.revision === revision) {
        void this.stopGeneration(generation)
      }
    })
  }

  private stopGeneration(generation: Generation): Promise<void> {
    if (generation.stopping || generation.exited) return generation.exitPromise

    generation.stopping = true
    if (this.current === generation) {
      this.pending = null
      generation.blocked = false
    }
    this.clearReadyTimer(generation)
    this.clearIdleTimer(generation)
    this.removeDataListeners(generation)

    try {
      generation.child.stdin.end(encodeConversationIslandCommand({ version: 1, type: 'shutdown' }))
    } catch {
      // Signal escalation below still guarantees a bounded graceful-shutdown attempt.
    }

    generation.terminateTimer = this.createTimer(SHUTDOWN_GRACE_MS, () => {
      generation.terminateTimer = null
      if (generation.exited) return
      this.signal(generation, 'SIGTERM')
      if (generation.exited) return
      generation.killTimer = this.createTimer(SHUTDOWN_GRACE_MS, () => {
        generation.killTimer = null
        if (!generation.exited) this.signal(generation, 'SIGKILL')
      })
    })

    return generation.exitPromise
  }

  private signal(generation: Generation, signal: NodeJS.Signals): void {
    try {
      generation.child.kill(signal)
    } catch {
      logger.warn('Failed to signal Conversation Island native helper', { signal })
    }
  }

  private handleUnexpectedFailure(reason: FailureReason, generation: Generation | null = this.current): void {
    if (generation && (this.current !== generation || generation.stopping)) return

    logger.warn('Conversation Island native helper failed', { reason })
    if (generation && !generation.exited) void this.stopGeneration(generation)
  }

  private handleExit(generation: Generation): void {
    if (generation.exited) return

    const expected = generation.stopping
    generation.exited = true
    if (!expected && this.current === generation) this.handleUnexpectedFailure('process-exit', generation)
    this.finishGeneration(generation)
  }

  private finishGeneration(generation: Generation): void {
    this.clearReadyTimer(generation)
    this.clearIdleTimer(generation)
    this.clearGenerationTimer(generation, 'terminateTimer')
    this.clearGenerationTimer(generation, 'killTimer')
    this.flushStderrLine(generation, generation.stderrDecoder.end())
    this.removeAllListeners(generation)

    if (this.current === generation) {
      this.current = null
      this.pending = null
    }
    generation.resolveExit()
  }

  private handleStderrData(generation: Generation, chunk: Buffer | string): void {
    if (!this.isCurrent(generation)) return
    const decoded = typeof chunk === 'string' ? chunk : generation.stderrDecoder.write(chunk)
    this.consumeStderr(generation, decoded)
  }

  private handleStderrEnd(generation: Generation): void {
    if (!this.isCurrent(generation)) return
    this.consumeStderr(generation, generation.stderrDecoder.end())
    this.flushStderrLine(generation)
  }

  private consumeStderr(generation: Generation, text: string): void {
    let offset = 0
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset)
      const end = newline === -1 ? text.length : newline
      const remaining = STDERR_MAX_LINE_LENGTH - generation.stderrLine.length
      if (remaining > 0) generation.stderrLine += text.slice(offset, end).slice(0, remaining)

      if (newline === -1) return
      this.flushStderrLine(generation)
      offset = newline + 1
    }
  }

  private flushStderrLine(generation: Generation, tail = ''): void {
    if (tail) this.consumeStderr(generation, tail)
    if (!generation.stderrLine) return

    logger.warn('Conversation Island native helper stderr', { line: generation.stderrLine.replace(/\r$/, '') })
    generation.stderrLine = ''
  }

  private removeDataListeners(generation: Generation): void {
    const { child, listeners } = generation
    child.stdin.removeListener('close', listeners.stdinClose)
    child.stdout.removeListener('data', listeners.stdoutData)
    child.stdout.removeListener('end', listeners.stdoutEnd)
    child.stderr.removeListener('data', listeners.stderrData)
    child.stderr.removeListener('end', listeners.stderrEnd)
    if (generation.drainListener) {
      child.stdin.removeListener('drain', generation.drainListener)
      generation.drainListener = null
    }
  }

  private removeAllListeners(generation: Generation): void {
    this.removeDataListeners(generation)
    const { child, listeners } = generation
    child.removeListener('error', listeners.childError)
    child.removeListener('exit', listeners.childExit)
    child.stdin.removeListener('error', listeners.stdinError)
    child.stdout.removeListener('error', listeners.stdoutError)
    child.stderr.removeListener('error', listeners.stderrError)
  }

  private clearReadyTimer(generation: Generation): void {
    this.clearGenerationTimer(generation, 'readyTimer')
  }

  private clearIdleTimer(generation: Generation): void {
    this.clearGenerationTimer(generation, 'idleTimer')
  }

  private clearGenerationTimer(
    generation: Generation,
    key: 'readyTimer' | 'idleTimer' | 'terminateTimer' | 'killTimer'
  ): void {
    const timer = generation[key]
    if (!timer) return
    this.clearTimer(timer)
    generation[key] = null
  }

  private createTimer(delay: number, callback: () => void): TimerHandle {
    const deadline = this.now() + delay
    return this.setTimer(callback, Math.max(0, deadline - this.now()))
  }

  private isCurrent(generation: Generation): boolean {
    return this.current?.id === generation.id
  }

  private isActive(generation: Generation): boolean {
    return this.isCurrent(generation) && !generation.stopping && !generation.exited
  }
}
