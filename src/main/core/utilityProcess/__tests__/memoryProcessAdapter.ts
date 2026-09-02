/**
 * Test-only in-memory ProcessAdapter. Frames cross a fake port pair through `structuredClone`
 * (real DataCloneError, no aliasing) and are delivered on microtasks, so plain `await`s and
 * `vi.advanceTimersByTimeAsync` both drain them deterministically.
 *
 * Two child modes: `child.serve(options)` binds the real child runtime; the scripted helpers
 * (`awaitConnect` / `reply` / `post` / `onFrame`) drive raw frames for fault injection.
 */

import type { ProcessAdapter, ProcessHandle, ProcessSpawnOptions } from '../host/processAdapter'
import { createLineDecoder } from '../host/stdioRelay'
import type { ChildFrame, ConnectFrame, FrameIdentity, MainFrame, Unstamped } from '../protocol/frames'
import {
  createUtilityProcessServer,
  type ParentPortLike,
  type PortLike,
  type ServeUtilityProcessOptions
} from '../runtime/utilityProcessServer'
import type { UtilityProcessContract } from '../types'

class FakePort implements PortLike {
  peer!: FakePort
  closed = false
  private started = false
  private flushScheduled = false
  private readonly queue: unknown[] = []
  private readonly messageListeners: Array<(event: { data: unknown }) => void> = []
  private readonly closeListeners: Array<() => void> = []

  on(event: 'message', listener: (event: { data: unknown }) => void): void
  on(event: 'close', listener: () => void): void
  on(event: 'message' | 'close', listener: ((event: { data: unknown }) => void) | (() => void)): void {
    if (event === 'message') this.messageListeners.push(listener as (event: { data: unknown }) => void)
    else this.closeListeners.push(listener as () => void)
  }

  start(): void {
    this.started = true
    this.scheduleFlush()
  }

  postMessage(message: unknown): void {
    if (this.closed) return
    this.peer.enqueue(structuredClone(message))
  }

  enqueue(data: unknown): void {
    if (this.closed) return
    this.queue.push(data)
    this.scheduleFlush()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const peer = this.peer
    queueMicrotask(() => {
      if (peer.closed) return
      peer.closed = true
      for (const listener of peer.closeListeners) listener()
    })
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushScheduled = false
      this.flush()
    })
  }

  private flush(): void {
    if (!this.started) return
    while (this.queue.length > 0) {
      const data = this.queue.shift()
      for (const listener of [...this.messageListeners]) listener({ data })
    }
  }
}

class FakeParentPort implements ParentPortLike {
  private listener: ((event: { data: unknown; ports: PortLike[] }) => void) | null = null

  once(_event: 'message', listener: (event: { data: unknown; ports: PortLike[] }) => void): void {
    this.listener = listener
  }

  deliver(data: unknown, ports: PortLike[]): void {
    const listener = this.listener
    this.listener = null
    listener?.({ data, ports })
  }
}

export interface MemoryConnection {
  frame: ConnectFrame
  port: PortLike
}

let nextPid = 1000

export class MemoryChild {
  readonly parentPort = new FakeParentPort()
  readonly childPort = new FakePort()
  readonly mainPort = new FakePort()
  /** Every main→child frame, in order, as the child received it. */
  readonly frames: MainFrame[] = []
  readonly pid = nextPid++
  connectFrame: ConnectFrame | null = null
  exited = false
  exitCode: number | null = null
  killed = false
  exitListener: ((code: number) => void) | null = null
  stdoutListener: ((line: string, truncated: boolean) => void) | null = null
  stderrListener: ((line: string, truncated: boolean) => void) | null = null
  private killHandler: (() => void) | null = null
  private fatalHandler: ((error: unknown) => void) | null = null
  private readonly connectWaiters: Array<(connection: MemoryConnection) => void> = []
  private readonly stdout = createLineDecoder((line, truncated) => this.stdoutListener?.(line, truncated))
  private readonly stderr = createLineDecoder((line, truncated) => this.stderrListener?.(line, truncated))

  constructor() {
    this.childPort.peer = this.mainPort
    this.mainPort.peer = this.childPort
  }

  /** Binds the real child runtime to this fake process. */
  serve<Contract extends UtilityProcessContract, InitData = void>(
    options: ServeUtilityProcessOptions<Contract, InitData>
  ): void {
    createUtilityProcessServer(options, {
      parentPort: this.parentPort,
      exit: (code) => this.exit(code),
      onFatal: (handler) => {
        this.fatalHandler = handler
      }
    })
  }

  awaitConnect(): Promise<MemoryConnection> {
    if (this.connectFrame !== null) return Promise.resolve({ frame: this.connectFrame, port: this.childPort })
    return new Promise((resolve) => this.connectWaiters.push(resolve))
  }

  get identity(): FrameIdentity {
    if (this.connectFrame === null) throw new Error('child has not been connected yet')
    const { protocol, version, processId, generation } = this.connectFrame
    return { protocol, version, processId, generation }
  }

  /** Posts a child→main frame stamped with this generation's identity. */
  reply(frame: Unstamped<ChildFrame>): void {
    this.childPort.postMessage({ ...this.identity, ...frame })
  }

  /** Posts an arbitrary (possibly malformed) value to main. */
  post(raw: unknown): void {
    this.childPort.postMessage(raw)
  }

  /** Scripted mode: receive main→child frames (starts the port). */
  onFrame(listener: (frame: MainFrame) => void): void {
    this.childPort.on('message', ({ data }) => listener(data as MainFrame))
    this.childPort.start()
  }

  /** Replaces the default kill behaviour (exit 143 on the next microtask). */
  onKill(handler: () => void): void {
    this.killHandler = handler
  }

  writeStdout(chunk: string | Buffer): void {
    this.stdout.push(chunk)
  }

  writeStderr(chunk: string | Buffer): void {
    this.stderr.push(chunk)
  }

  triggerFatal(error: unknown): void {
    this.fatalHandler?.(error)
  }

  exit(code: number): void {
    if (this.exited) return
    this.exited = true
    this.exitCode = code
    this.stdout.end()
    this.stderr.end()
    this.childPort.close()
    this.mainPort.close()
    queueMicrotask(() => this.exitListener?.(code))
  }

  receiveConnect(frame: ConnectFrame): void {
    this.connectFrame = frame
    this.parentPort.deliver(frame, [this.childPort])
    for (const waiter of this.connectWaiters.splice(0)) waiter({ frame, port: this.childPort })
  }

  handleKill(): void {
    this.killed = true
    if (this.killHandler !== null) this.killHandler()
    else queueMicrotask(() => this.exit(143))
  }
}

export interface MemorySpawn extends ProcessSpawnOptions {
  child: MemoryChild
}

export type MemoryChildScript = (
  child: MemoryChild,
  spawnIndex: number,
  spawnOptions: ProcessSpawnOptions
) => void | Promise<void>

export interface MemoryAdapterOptions {
  /** Make `spawn()` throw synchronously (an Error or `true` for a generic one). */
  spawnThrows?: boolean | Error
  /** Never emit the `spawn` event (models a launch that hangs before connect). */
  noSpawnEvent?: boolean
}

export interface MemoryProcessAdapter extends ProcessAdapter {
  readonly spawns: MemorySpawn[]
}

function createHandle(child: MemoryChild, options: MemoryAdapterOptions): ProcessHandle {
  let spawnListener: (() => void) | null = null
  let messageListener: ((data: unknown) => void) | null = null
  let errorListener: ((info: { type: string; location: string; report: string }) => void) | null = null
  void errorListener
  child.mainPort.on('message', ({ data }) => messageListener?.(data))
  child.mainPort.start()
  queueMicrotask(() => {
    if (!options.noSpawnEvent && !child.exited) spawnListener?.()
  })
  return {
    get pid() {
      return child.exited ? undefined : child.pid
    },
    connect(frame) {
      const cloned = structuredClone(frame)
      queueMicrotask(() => {
        if (!child.exited) child.receiveConnect(cloned)
      })
    },
    send(frame) {
      const cloned = structuredClone(frame)
      child.frames.push(cloned)
      child.childPort.enqueue(cloned)
    },
    kill() {
      child.handleKill()
    },
    onSpawn(listener) {
      spawnListener = listener
    },
    onMessage(listener) {
      messageListener = listener
    },
    onExit(listener) {
      child.exitListener = listener
    },
    onStdoutLine(listener) {
      child.stdoutListener = listener
    },
    onStderrLine(listener) {
      child.stderrListener = listener
    },
    onError(listener) {
      errorListener = listener
    }
  }
}

export function createMemoryProcessAdapter(
  script?: MemoryChildScript,
  options: MemoryAdapterOptions = {}
): MemoryProcessAdapter {
  const spawns: MemorySpawn[] = []
  return {
    spawns,
    spawn(spawnOptions) {
      if (options.spawnThrows) {
        throw options.spawnThrows instanceof Error ? options.spawnThrows : new Error('spawn failed')
      }
      const child = new MemoryChild()
      const index = spawns.length
      spawns.push({ ...spawnOptions, child })
      const handle = createHandle(child, options)
      const result = script?.(child, index, spawnOptions)
      if (result instanceof Promise) {
        // Surface script bugs loudly instead of as a silent test timeout.
        result.catch((error) => {
          queueMicrotask(() => {
            throw error
          })
        })
      }
      return handle
    }
  }
}

/** Drains pending microtasks so in-memory frames land; safe under fake timers. */
export async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

/** Polls `predicate` across microtask drains; throws instead of hanging when it never holds. */
export async function waitUntil(predicate: () => boolean, label = 'condition'): Promise<void> {
  for (let round = 0; round < 200; round += 1) {
    if (predicate()) return
    await flushMicrotasks(10)
  }
  throw new Error(`waitUntil: ${label} never held`)
}
