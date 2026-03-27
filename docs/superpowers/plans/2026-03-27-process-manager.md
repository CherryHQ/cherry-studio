# ProcessManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a unified ProcessManagerService that manages child processes and Electron utility processes, plus a TaskExecutor composite for parallel task execution.

**Architecture:** Two-layer design — a primitive layer (`ProcessManagerService`) managing individual `ChildProcessHandle` and `UtilityProcessHandle` instances via a single `register()` API, and a composite layer (`TaskExecutor`) that internally uses ProcessManagerService to spawn ephemeral utility process workers for parallel task dispatch.

**Tech Stack:** Electron 38 (`utilityProcess`), Node.js `child_process`, TypeScript, Vitest, lifecycle system (`BaseService` + decorators)

**Design Doc:** `docs/en/references/process-manager/README.md`

---

## File Structure

```
src/main/services/process/
  types.ts                      # ProcessState, ProcessHandle, definitions, events, ProcessLogLine
  ProcessManagerService.ts      # Lifecycle service: registry, event hub, graceful shutdown
  ChildProcessHandle.ts         # ChildProcess implementation of ProcessHandle
  UtilityProcessHandle.ts       # Electron utilityProcess implementation of ProcessHandle
  TaskExecutor.ts               # Composite: task dispatch, ephemeral workers, auto-scaling
  index.ts                      # Barrel exports (public API)
  __tests__/
    types.test.ts               # Enum/interface compile-time checks
    ChildProcessHandle.test.ts  # Unit tests for child process lifecycle
    ProcessManagerService.test.ts # Service integration tests
    UtilityProcessHandle.test.ts # Unit tests for utility process handle
    TaskExecutor.test.ts        # Unit tests for task executor
```

**Modifications to existing files:**
- `src/main/core/application/serviceRegistry.ts` — add ProcessManagerService registration

---

## Task 1: Types and Interfaces

**Files:**
- Create: `src/main/services/process/types.ts`
- Test: `src/main/services/process/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/services/process/__tests__/types.test.ts
import { describe, expect, it } from 'vitest'

import { ProcessState } from '../types'

describe('ProcessState', () => {
  it('should have all expected states', () => {
    expect(ProcessState.Idle).toBe('idle')
    expect(ProcessState.Running).toBe('running')
    expect(ProcessState.Stopping).toBe('stopping')
    expect(ProcessState.Stopped).toBe('stopped')
    expect(ProcessState.Crashed).toBe('crashed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/process/__tests__/types.test.ts`
Expected: FAIL — module `../types` not found

- [ ] **Step 3: Implement types.ts**

```typescript
// src/main/services/process/types.ts
import type { ChildProcess, SpawnOptions } from 'child_process'

/**
 * Process lifecycle states
 */
export enum ProcessState {
  /** Registered but not started */
  Idle = 'idle',
  /** Process is alive and running */
  Running = 'running',
  /** Graceful shutdown in progress */
  Stopping = 'stopping',
  /** Exited cleanly (code 0 or explicit stop) */
  Stopped = 'stopped',
  /** Exited with error (non-zero code or signal) */
  Crashed = 'crashed',
}

/**
 * Unified handle for managing a single process.
 * Returned by ProcessManagerService.register().
 */
export interface ProcessHandle {
  readonly id: string
  readonly state: ProcessState
  readonly pid: number | undefined

  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

/**
 * Extended handle for utility processes — adds MessagePort communication.
 */
export interface UtilityProcessHandle extends ProcessHandle {
  postMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): () => void
}

/**
 * Log line emitted from process stdout/stderr.
 */
export interface ProcessLogLine {
  processId: string
  stream: 'stdout' | 'stderr'
  data: string
  timestamp: number
}

/**
 * Events emitted by ProcessManagerService.
 */
export interface ProcessManagerEvents {
  'process:started': (id: string, pid: number) => void
  'process:exited': (id: string, code: number | null, signal: NodeJS.Signals | null) => void
  'process:log': (line: ProcessLogLine) => void
}

/**
 * Definition for registering a child process (external binary).
 */
export interface ChildProcessDefinition {
  type: 'child'
  id: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  /** ms to wait for SIGTERM before SIGKILL. Default: 5000 */
  killTimeoutMs?: number
}

/**
 * Definition for registering an Electron utility process.
 */
export interface UtilityProcessDefinition {
  type: 'utility'
  id: string
  modulePath: string
  args?: string[]
  env?: Record<string, string>
  killTimeoutMs?: number
}

/** Union of all process definitions accepted by register() */
export type ProcessDefinition = ChildProcessDefinition | UtilityProcessDefinition
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/process/__tests__/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/process/types.ts src/main/services/process/__tests__/types.test.ts
git commit --signoff -m "feat(process-manager): add types and interfaces"
```

---

## Task 2: ChildProcessHandle

**Files:**
- Create: `src/main/services/process/ChildProcessHandle.ts`
- Test: `src/main/services/process/__tests__/ChildProcessHandle.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/services/process/__tests__/ChildProcessHandle.test.ts
import EventEmitter from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChildProcessDefinition } from '../types'
import { ProcessState } from '../types'

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// Mock crossPlatformSpawn
vi.mock('@main/utils/process', () => ({
  crossPlatformSpawn: vi.fn(),
}))

// Mock shell-env
vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn().mockResolvedValue({ PATH: '/usr/bin' }),
}))

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

function createMockChildProcess() {
  const cp = new EventEmitter() as any
  cp.pid = 1234
  cp.stdout = new EventEmitter()
  cp.stderr = new EventEmitter()
  cp.kill = vi.fn().mockReturnValue(true)
  return cp
}

async function loadModules() {
  const { crossPlatformSpawn } = await import('@main/utils/process')
  const { ChildProcessHandle } = await import('../ChildProcessHandle')
  return { crossPlatformSpawn: crossPlatformSpawn as any, ChildProcessHandle }
}

const baseDef: ChildProcessDefinition = {
  type: 'child',
  id: 'test-proc',
  command: '/usr/bin/test',
  args: ['--flag'],
}

describe('ChildProcessHandle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should start in Idle state', async () => {
    const { ChildProcessHandle } = await loadModules()
    const handle = new ChildProcessHandle(baseDef)
    expect(handle.state).toBe(ProcessState.Idle)
    expect(handle.id).toBe('test-proc')
    expect(handle.pid).toBeUndefined()
  })

  it('should transition to Running on start()', async () => {
    const mockCp = createMockChildProcess()
    const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
    ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

    const handle = new ChildProcessHandle(baseDef)
    const onStarted = vi.fn()
    handle.onStarted = onStarted

    await handle.start()

    expect(handle.state).toBe(ProcessState.Running)
    expect(handle.pid).toBe(1234)
    expect(crossPlatformSpawn).toHaveBeenCalledWith(
      '/usr/bin/test',
      ['--flag'],
      expect.objectContaining({ env: expect.any(Object) }),
    )
  })

  it('should reject start() if already running', async () => {
    const mockCp = createMockChildProcess()
    const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
    ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

    const handle = new ChildProcessHandle(baseDef)
    await handle.start()
    await expect(handle.start()).rejects.toThrow(/already running/)
  })

  it('should transition to Crashed on unexpected exit', async () => {
    const mockCp = createMockChildProcess()
    const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
    ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

    const handle = new ChildProcessHandle(baseDef)
    const onExited = vi.fn()
    handle.onExited = onExited

    await handle.start()
    mockCp.emit('close', 1, null) // non-zero exit

    expect(handle.state).toBe(ProcessState.Crashed)
    expect(onExited).toHaveBeenCalledWith(1, null)
  })

  it('should transition to Stopped on stop()', async () => {
    const mockCp = createMockChildProcess()
    const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
    ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

    const handle = new ChildProcessHandle(baseDef)
    await handle.start()

    // stop() sends SIGTERM, process exits
    const stopPromise = handle.stop()
    mockCp.emit('close', 0, 'SIGTERM')
    await stopPromise

    expect(handle.state).toBe(ProcessState.Stopped)
    expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('should SIGKILL after killTimeoutMs', async () => {
    vi.useFakeTimers()

    const mockCp = createMockChildProcess()
    const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
    ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

    const handle = new ChildProcessHandle({ ...baseDef, killTimeoutMs: 100 })
    await handle.start()

    const stopPromise = handle.stop()

    expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM')
    expect(mockCp.kill).not.toHaveBeenCalledWith('SIGKILL')

    // Advance past kill timeout
    vi.advanceTimersByTime(150)
    expect(mockCp.kill).toHaveBeenCalledWith('SIGKILL')

    // Process finally exits
    mockCp.emit('close', null, 'SIGKILL')
    await stopPromise

    expect(handle.state).toBe(ProcessState.Stopped)

    vi.useRealTimers()
  })

  it('should emit log lines on stdout/stderr', async () => {
    const mockCp = createMockChildProcess()
    const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
    ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

    const handle = new ChildProcessHandle(baseDef)
    const logLines: any[] = []
    handle.onLog = (line) => logLines.push(line)

    await handle.start()
    mockCp.stdout.emit('data', Buffer.from('hello stdout'))
    mockCp.stderr.emit('data', Buffer.from('hello stderr'))

    expect(logLines).toHaveLength(2)
    expect(logLines[0].stream).toBe('stdout')
    expect(logLines[0].data).toBe('hello stdout')
    expect(logLines[1].stream).toBe('stderr')
  })

  it('should restart (stop + start)', async () => {
    const mockCp1 = createMockChildProcess()
    const mockCp2 = createMockChildProcess()
    mockCp2.pid = 5678

    const { crossPlatformSpawn, ChildProcessHandle } = await loadModules()
    ;(crossPlatformSpawn as any).mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2)

    const handle = new ChildProcessHandle(baseDef)
    await handle.start()

    const restartPromise = handle.restart()
    mockCp1.emit('close', 0, 'SIGTERM')
    await restartPromise

    expect(handle.state).toBe(ProcessState.Running)
    expect(handle.pid).toBe(5678)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/process/__tests__/ChildProcessHandle.test.ts`
Expected: FAIL — `../ChildProcessHandle` not found

- [ ] **Step 3: Implement ChildProcessHandle.ts**

```typescript
// src/main/services/process/ChildProcessHandle.ts
import type { ChildProcess } from 'child_process'

import { loggerService } from '@logger'
import { crossPlatformSpawn } from '@main/utils/process'
import getShellEnv from '@main/utils/shell-env'

import type { ChildProcessDefinition, ProcessLogLine } from './types'
import { ProcessState } from './types'

const DEFAULT_KILL_TIMEOUT_MS = 5000

export class ChildProcessHandle {
  readonly id: string

  private _state: ProcessState = ProcessState.Idle
  private _pid: number | undefined
  private _process: ChildProcess | undefined
  private readonly def: ChildProcessDefinition
  private readonly logger = loggerService.withContext(`Process:${this.def?.id ?? 'unknown'}`)

  /** Callbacks set by ProcessManagerService to bridge events */
  onStarted: ((pid: number) => void) | undefined
  onExited: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  onLog: ((line: ProcessLogLine) => void) | undefined

  constructor(def: ChildProcessDefinition) {
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

  async start(): Promise<void> {
    if (this._state === ProcessState.Running) {
      throw new Error(`Process '${this.id}' is already running`)
    }

    const env = this.def.env
      ? { ...(await getShellEnv()), ...this.def.env }
      : await getShellEnv()

    const cp = crossPlatformSpawn(this.def.command, this.def.args ?? [], {
      cwd: this.def.cwd,
      env,
    })

    this._process = cp
    this._pid = cp.pid
    this._state = ProcessState.Running

    this.logger.info(`Started, pid=${cp.pid}`)
    this.onStarted?.(cp.pid!)

    cp.stdout?.on('data', (chunk: Buffer) => {
      const line: ProcessLogLine = {
        processId: this.id,
        stream: 'stdout',
        data: chunk.toString(),
        timestamp: Date.now(),
      }
      this.logger.debug(line.data.trimEnd())
      this.onLog?.(line)
    })

    cp.stderr?.on('data', (chunk: Buffer) => {
      const line: ProcessLogLine = {
        processId: this.id,
        stream: 'stderr',
        data: chunk.toString(),
        timestamp: Date.now(),
      }
      this.logger.warn(line.data.trimEnd())
      this.onLog?.(line)
    })

    cp.on('error', (err) => {
      this.logger.error(`Spawn error`, err)
      this._state = ProcessState.Crashed
      this._process = undefined
    })

    cp.on('close', (code, signal) => {
      this._process = undefined

      if (this._state === ProcessState.Stopping) {
        this._state = ProcessState.Stopped
      } else if (code !== 0) {
        this._state = ProcessState.Crashed
        this.logger.warn(`Exited unexpectedly: code=${code}, signal=${signal}`)
      } else {
        this._state = ProcessState.Stopped
      }

      this.onExited?.(code, signal as NodeJS.Signals | null)
    })
  }

  async stop(): Promise<void> {
    if (!this._process || this._state !== ProcessState.Running) {
      return
    }

    this._state = ProcessState.Stopping
    const cp = this._process
    const killTimeout = this.def.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS

    return new Promise<void>((resolve) => {
      const onClose = () => {
        clearTimeout(timer)
        resolve()
      }

      cp.once('close', onClose)
      cp.kill('SIGTERM')

      const timer = setTimeout(() => {
        this.logger.warn(`SIGTERM timeout (${killTimeout}ms), sending SIGKILL`)
        cp.kill('SIGKILL')
      }, killTimeout)
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }
}
```

- [ ] **Step 4: Run tests and iterate until they pass**

Run: `pnpm vitest run src/main/services/process/__tests__/ChildProcessHandle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/process/ChildProcessHandle.ts src/main/services/process/__tests__/ChildProcessHandle.test.ts
git commit --signoff -m "feat(process-manager): implement ChildProcessHandle with lifecycle and logging"
```

---

## Task 3: ProcessManagerService

**Files:**
- Create: `src/main/services/process/ProcessManagerService.ts`
- Test: `src/main/services/process/__tests__/ProcessManagerService.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/services/process/__tests__/ProcessManagerService.test.ts
import EventEmitter from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProcessState } from '../types'

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// Mock crossPlatformSpawn
vi.mock('@main/utils/process', () => ({
  crossPlatformSpawn: vi.fn(),
}))

// Mock shell-env
vi.mock('@main/utils/shell-env', () => ({
  default: vi.fn().mockResolvedValue({ PATH: '/usr/bin' }),
}))

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

// Mock electron (for utilityProcess)
vi.mock('electron', () => ({
  utilityProcess: {
    fork: vi.fn(),
  },
}))

function createMockChildProcess() {
  const cp = new EventEmitter() as any
  cp.pid = 1234
  cp.stdout = new EventEmitter()
  cp.stderr = new EventEmitter()
  cp.kill = vi.fn().mockReturnValue(true)
  return cp
}

async function loadModules() {
  const { crossPlatformSpawn } = await import('@main/utils/process')
  const { ProcessManagerService } = await import('../ProcessManagerService')
  return { crossPlatformSpawn: crossPlatformSpawn as any, ProcessManagerService }
}

describe('ProcessManagerService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  describe('register()', () => {
    it('should register a child process and return a handle', async () => {
      const { ProcessManagerService } = await loadModules()
      const pm = new ProcessManagerService()

      const handle = pm.register({
        type: 'child',
        id: 'test-child',
        command: '/usr/bin/test',
      })

      expect(handle.id).toBe('test-child')
      expect(handle.state).toBe(ProcessState.Idle)
    })

    it('should reject duplicate ids', async () => {
      const { ProcessManagerService } = await loadModules()
      const pm = new ProcessManagerService()

      pm.register({ type: 'child', id: 'dup', command: '/usr/bin/test' })
      expect(() => pm.register({ type: 'child', id: 'dup', command: '/usr/bin/test' })).toThrow(
        /already registered/,
      )
    })

    it('should allow get() to retrieve a registered handle', async () => {
      const { ProcessManagerService } = await loadModules()
      const pm = new ProcessManagerService()

      pm.register({ type: 'child', id: 'foo', command: '/usr/bin/foo' })
      const handle = pm.get('foo')
      expect(handle).toBeDefined()
      expect(handle!.id).toBe('foo')
    })

    it('should return undefined for unregistered id', async () => {
      const { ProcessManagerService } = await loadModules()
      const pm = new ProcessManagerService()
      expect(pm.get('nonexistent')).toBeUndefined()
    })
  })

  describe('events', () => {
    it('should emit process:started when a child process starts', async () => {
      const mockCp = createMockChildProcess()
      const { crossPlatformSpawn, ProcessManagerService } = await loadModules()
      ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

      const pm = new ProcessManagerService()
      const handle = pm.register({
        type: 'child',
        id: 'evt-test',
        command: '/usr/bin/test',
      })

      const started = vi.fn()
      pm.on('process:started', started)

      await handle.start()

      expect(started).toHaveBeenCalledWith('evt-test', 1234)
    })

    it('should emit process:exited when a child process exits', async () => {
      const mockCp = createMockChildProcess()
      const { crossPlatformSpawn, ProcessManagerService } = await loadModules()
      ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

      const pm = new ProcessManagerService()
      const handle = pm.register({
        type: 'child',
        id: 'exit-test',
        command: '/usr/bin/test',
      })

      const exited = vi.fn()
      pm.on('process:exited', exited)

      await handle.start()
      mockCp.emit('close', 1, null)

      expect(exited).toHaveBeenCalledWith('exit-test', 1, null)
    })

    it('should emit process:log on stdout/stderr', async () => {
      const mockCp = createMockChildProcess()
      const { crossPlatformSpawn, ProcessManagerService } = await loadModules()
      ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

      const pm = new ProcessManagerService()
      const handle = pm.register({
        type: 'child',
        id: 'log-test',
        command: '/usr/bin/test',
      })

      const logged = vi.fn()
      pm.on('process:log', logged)

      await handle.start()
      mockCp.stdout.emit('data', Buffer.from('hello'))

      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({ processId: 'log-test', stream: 'stdout', data: 'hello' }),
      )
    })
  })

  describe('onStop()', () => {
    it('should stop all running processes on service stop', async () => {
      const mockCp = createMockChildProcess()
      const { crossPlatformSpawn, ProcessManagerService } = await loadModules()
      ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

      const pm = new ProcessManagerService()
      const handle = pm.register({
        type: 'child',
        id: 'shutdown-test',
        command: '/usr/bin/test',
      })

      await handle.start()

      // Simulate service stop — stop() triggers SIGTERM, process exits
      const stopPromise = pm._doStop()
      mockCp.emit('close', 0, 'SIGTERM')
      await stopPromise

      expect(handle.state).toBe(ProcessState.Stopped)
      expect(mockCp.kill).toHaveBeenCalledWith('SIGTERM')
    })
  })

  describe('unregister()', () => {
    it('should remove a stopped process from the registry', async () => {
      const { ProcessManagerService } = await loadModules()
      const pm = new ProcessManagerService()

      pm.register({ type: 'child', id: 'temp', command: '/usr/bin/temp' })
      pm.unregister('temp')

      expect(pm.get('temp')).toBeUndefined()
    })

    it('should reject unregister of a running process', async () => {
      const mockCp = createMockChildProcess()
      const { crossPlatformSpawn, ProcessManagerService } = await loadModules()
      ;(crossPlatformSpawn as any).mockReturnValue(mockCp)

      const pm = new ProcessManagerService()
      const handle = pm.register({ type: 'child', id: 'running', command: '/usr/bin/test' })
      await handle.start()

      expect(() => pm.unregister('running')).toThrow(/running/)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/process/__tests__/ProcessManagerService.test.ts`
Expected: FAIL — `../ProcessManagerService` not found

- [ ] **Step 3: Implement ProcessManagerService.ts**

```typescript
// src/main/services/process/ProcessManagerService.ts
import EventEmitter from 'node:events'

import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { ChildProcessHandle } from './ChildProcessHandle'
import type {
  ChildProcessDefinition,
  ProcessDefinition,
  ProcessHandle,
  ProcessLogLine,
  ProcessManagerEvents,
  UtilityProcessDefinition,
  UtilityProcessHandle,
} from './types'
import { ProcessState } from './types'

const logger = loggerService.withContext('ProcessManagerService')

@Injectable('ProcessManagerService')
@ServicePhase(Phase.WhenReady)
export class ProcessManagerService extends BaseService {
  private readonly emitter = new EventEmitter()
  private readonly handles = new Map<string, ProcessHandle>()

  protected async onInit(): Promise<void> {
    logger.info('ProcessManagerService initialized')
  }

  protected async onStop(): Promise<void> {
    logger.info(`Stopping all managed processes (${this.handles.size} registered)`)

    const stopPromises: Promise<void>[] = []
    for (const handle of this.handles.values()) {
      if (handle.state === ProcessState.Running) {
        stopPromises.push(handle.stop().catch((err) => logger.error(`Failed to stop ${handle.id}`, err)))
      }
    }

    await Promise.all(stopPromises)
    logger.info('All managed processes stopped')
  }

  /**
   * Register a process definition. Returns a typed handle.
   */
  register(def: ChildProcessDefinition): ChildProcessHandle
  register(def: UtilityProcessDefinition): UtilityProcessHandle
  register(def: ProcessDefinition): ProcessHandle {
    if (this.handles.has(def.id)) {
      throw new Error(`Process '${def.id}' is already registered`)
    }

    let handle: ProcessHandle

    if (def.type === 'child') {
      const childHandle = new ChildProcessHandle(def)
      childHandle.onStarted = (pid) => this.emitter.emit('process:started', def.id, pid)
      childHandle.onExited = (code, signal) => this.emitter.emit('process:exited', def.id, code, signal)
      childHandle.onLog = (line) => this.emitter.emit('process:log', line)
      handle = childHandle
    } else {
      // UtilityProcess — will be implemented in Task 4
      throw new Error('UtilityProcess registration not yet implemented')
    }

    this.handles.set(def.id, handle)
    logger.info(`Registered process '${def.id}' (type=${def.type})`)

    return handle
  }

  /**
   * Retrieve a registered handle by id.
   */
  get(id: string): ProcessHandle | undefined {
    return this.handles.get(id)
  }

  /**
   * Remove a stopped/idle process from the registry.
   */
  unregister(id: string): void {
    const handle = this.handles.get(id)
    if (!handle) return

    if (handle.state === ProcessState.Running) {
      throw new Error(`Cannot unregister process '${id}' while it is running. Stop it first.`)
    }

    this.handles.delete(id)
    logger.info(`Unregistered process '${id}'`)
  }

  /**
   * Subscribe to process events.
   */
  on<K extends keyof ProcessManagerEvents>(event: K, listener: ProcessManagerEvents[K]): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  /**
   * Unsubscribe from process events.
   */
  off<K extends keyof ProcessManagerEvents>(event: K, listener: ProcessManagerEvents[K]): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }
}
```

- [ ] **Step 4: Run tests and iterate until they pass**

Run: `pnpm vitest run src/main/services/process/__tests__/ProcessManagerService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/process/ProcessManagerService.ts src/main/services/process/__tests__/ProcessManagerService.test.ts
git commit --signoff -m "feat(process-manager): implement ProcessManagerService with registry and events"
```

---

## Task 4: Barrel Exports and Service Registration

**Files:**
- Create: `src/main/services/process/index.ts`
- Modify: `src/main/core/application/serviceRegistry.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// src/main/services/process/index.ts
export { ChildProcessHandle } from './ChildProcessHandle'
export { ProcessManagerService } from './ProcessManagerService'
export type {
  ChildProcessDefinition,
  ProcessDefinition,
  ProcessHandle,
  ProcessLogLine,
  ProcessManagerEvents,
  UtilityProcessDefinition,
  UtilityProcessHandle,
} from './types'
export { ProcessState } from './types'
```

- [ ] **Step 2: Register in serviceRegistry.ts**

Add `ProcessManagerService` to `src/main/core/application/serviceRegistry.ts`:

```typescript
import { CacheService } from '@data/CacheService'
import { DataApiService } from '@data/DataApiService'
import { DbService } from '@data/db/DbService'
import { PreferenceService } from '@data/PreferenceService'
import { CodeCliService } from '@main/services/CodeCliService'
import { ProcessManagerService } from '@main/services/process/ProcessManagerService'

import type { ServiceConstructor } from '../lifecycle/types'

export const services = {
  DbService,
  CacheService,
  DataApiService,
  PreferenceService,
  CodeCliService,
  ProcessManagerService,
} as const

export type ServiceRegistry = {
  [K in keyof typeof services]: InstanceType<(typeof services)[K]>
}

export const serviceList = Object.values(services) as ServiceConstructor[]
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `pnpm vitest run src/main/services/process/`
Expected: All process tests PASS

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/main/services/process/index.ts src/main/core/application/serviceRegistry.ts
git commit --signoff -m "feat(process-manager): register ProcessManagerService in service registry"
```

---

## Task 5: UtilityProcessHandle

**Files:**
- Create: `src/main/services/process/UtilityProcessHandle.ts`
- Modify: `src/main/services/process/ProcessManagerService.ts` (add utility registration)
- Modify: `src/main/services/process/index.ts` (add export)
- Test: `src/main/services/process/__tests__/UtilityProcessHandle.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/services/process/__tests__/UtilityProcessHandle.test.ts
import EventEmitter from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UtilityProcessDefinition } from '../types'
import { ProcessState } from '../types'

// Mock electron
const mockUtilityProcess = {
  fork: vi.fn(),
}
vi.mock('electron', () => ({
  utilityProcess: mockUtilityProcess,
}))

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

function createMockUtilityProcess() {
  const proc = new EventEmitter() as any
  proc.pid = 9876
  proc.postMessage = vi.fn()
  proc.kill = vi.fn()
  return proc
}

async function loadModules() {
  const { UtilityProcessHandle: UPH } = await import('../UtilityProcessHandle')
  return { UtilityProcessHandle: UPH }
}

const baseDef: UtilityProcessDefinition = {
  type: 'utility',
  id: 'test-utility',
  modulePath: './workers/test-worker.js',
}

describe('UtilityProcessHandle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should start in Idle state', async () => {
    const { UtilityProcessHandle } = await loadModules()
    const handle = new UtilityProcessHandle(baseDef)
    expect(handle.state).toBe(ProcessState.Idle)
    expect(handle.id).toBe('test-utility')
  })

  it('should transition to Running on start()', async () => {
    const mockProc = createMockUtilityProcess()
    mockUtilityProcess.fork.mockReturnValue(mockProc)

    const { UtilityProcessHandle } = await loadModules()
    const handle = new UtilityProcessHandle(baseDef)

    await handle.start()

    expect(handle.state).toBe(ProcessState.Running)
    expect(handle.pid).toBe(9876)
    expect(mockUtilityProcess.fork).toHaveBeenCalledWith(
      './workers/test-worker.js',
      expect.objectContaining({ args: undefined }),
    )
  })

  it('should send and receive messages', async () => {
    const mockProc = createMockUtilityProcess()
    mockUtilityProcess.fork.mockReturnValue(mockProc)

    const { UtilityProcessHandle } = await loadModules()
    const handle = new UtilityProcessHandle(baseDef)
    await handle.start()

    // Send message
    handle.postMessage({ type: 'ping' })
    expect(mockProc.postMessage).toHaveBeenCalledWith({ type: 'ping' })

    // Receive message
    const received = vi.fn()
    handle.onMessage(received)
    mockProc.emit('message', { type: 'pong' })
    expect(received).toHaveBeenCalledWith({ type: 'pong' })
  })

  it('should unsubscribe via returned cleanup function', async () => {
    const mockProc = createMockUtilityProcess()
    mockUtilityProcess.fork.mockReturnValue(mockProc)

    const { UtilityProcessHandle } = await loadModules()
    const handle = new UtilityProcessHandle(baseDef)
    await handle.start()

    const received = vi.fn()
    const unsub = handle.onMessage(received)

    mockProc.emit('message', { a: 1 })
    expect(received).toHaveBeenCalledTimes(1)

    unsub()
    mockProc.emit('message', { a: 2 })
    expect(received).toHaveBeenCalledTimes(1) // no new call
  })

  it('should stop with SIGTERM then SIGKILL fallback', async () => {
    vi.useFakeTimers()

    const mockProc = createMockUtilityProcess()
    mockUtilityProcess.fork.mockReturnValue(mockProc)

    const { UtilityProcessHandle } = await loadModules()
    const handle = new UtilityProcessHandle({ ...baseDef, killTimeoutMs: 100 })
    await handle.start()

    const stopPromise = handle.stop()
    expect(mockProc.kill).toHaveBeenCalledTimes(1) // SIGTERM equivalent

    vi.advanceTimersByTime(150)
    // After timeout, should attempt force kill
    // Process exits
    mockProc.emit('exit', 0)
    await stopPromise

    expect(handle.state).toBe(ProcessState.Stopped)

    vi.useRealTimers()
  })

  it('should transition to Crashed on unexpected exit', async () => {
    const mockProc = createMockUtilityProcess()
    mockUtilityProcess.fork.mockReturnValue(mockProc)

    const { UtilityProcessHandle } = await loadModules()
    const handle = new UtilityProcessHandle(baseDef)
    await handle.start()

    mockProc.emit('exit', 1)
    expect(handle.state).toBe(ProcessState.Crashed)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/process/__tests__/UtilityProcessHandle.test.ts`
Expected: FAIL — `../UtilityProcessHandle` not found

- [ ] **Step 3: Implement UtilityProcessHandle.ts**

```typescript
// src/main/services/process/UtilityProcessHandle.ts
import { utilityProcess } from 'electron'

import { loggerService } from '@logger'

import type { ProcessLogLine, UtilityProcessDefinition } from './types'
import { ProcessState } from './types'

const DEFAULT_KILL_TIMEOUT_MS = 5000

export class UtilityProcessHandle {
  readonly id: string

  private _state: ProcessState = ProcessState.Idle
  private _pid: number | undefined
  private _process: Electron.UtilityProcess | undefined
  private readonly def: UtilityProcessDefinition
  private readonly logger: ReturnType<typeof loggerService.withContext>
  private readonly messageHandlers = new Set<(message: unknown) => void>()

  /** Callbacks set by ProcessManagerService to bridge events */
  onStarted: ((pid: number) => void) | undefined
  onExited: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  onLog: ((line: ProcessLogLine) => void) | undefined

  constructor(def: UtilityProcessDefinition) {
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

  async start(): Promise<void> {
    if (this._state === ProcessState.Running) {
      throw new Error(`Process '${this.id}' is already running`)
    }

    const proc = utilityProcess.fork(this.def.modulePath, {
      args: this.def.args,
      env: this.def.env ? { ...process.env, ...this.def.env } : undefined,
    } as any)

    this._process = proc
    this._pid = proc.pid
    this._state = ProcessState.Running

    this.logger.info(`Started utility process, pid=${proc.pid}`)
    this.onStarted?.(proc.pid)

    proc.on('message', (message: unknown) => {
      for (const handler of this.messageHandlers) {
        handler(message)
      }
    })

    proc.on('exit', (code: number) => {
      this._process = undefined

      if (this._state === ProcessState.Stopping) {
        this._state = ProcessState.Stopped
      } else if (code !== 0) {
        this._state = ProcessState.Crashed
        this.logger.warn(`Utility process exited unexpectedly: code=${code}`)
      } else {
        this._state = ProcessState.Stopped
      }

      this.onExited?.(code, null)
    })
  }

  async stop(): Promise<void> {
    if (!this._process || this._state !== ProcessState.Running) {
      return
    }

    this._state = ProcessState.Stopping
    const proc = this._process
    const killTimeout = this.def.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS

    return new Promise<void>((resolve) => {
      const onExit = () => {
        clearTimeout(timer)
        resolve()
      }

      proc.once('exit', onExit)

      // utilityProcess.kill() sends SIGTERM
      proc.kill()

      const timer = setTimeout(() => {
        this.logger.warn(`Kill timeout (${killTimeout}ms), force killing utility process`)
        // No SIGKILL equivalent for utilityProcess — kill() is the only option.
        // Process should have exited; if not, we resolve anyway to unblock shutdown.
        resolve()
      }, killTimeout)
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  postMessage(message: unknown): void {
    if (!this._process) {
      throw new Error(`Cannot postMessage to '${this.id}': process not running`)
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
```

- [ ] **Step 4: Update ProcessManagerService to support utility registration**

In `src/main/services/process/ProcessManagerService.ts`, replace the `throw new Error('UtilityProcess registration not yet implemented')` block with:

```typescript
    } else if (def.type === 'utility') {
      const utilHandle = new UtilityProcessHandleImpl(def)
      utilHandle.onStarted = (pid) => this.emitter.emit('process:started', def.id, pid)
      utilHandle.onExited = (code, signal) => this.emitter.emit('process:exited', def.id, code, signal)
      utilHandle.onLog = (line) => this.emitter.emit('process:log', line)
      handle = utilHandle
    }
```

Add the import at the top:

```typescript
import { UtilityProcessHandle as UtilityProcessHandleImpl } from './UtilityProcessHandle'
```

- [ ] **Step 5: Update index.ts barrel exports**

Add to `src/main/services/process/index.ts`:

```typescript
export { UtilityProcessHandle } from './UtilityProcessHandle'
```

- [ ] **Step 6: Run all process tests**

Run: `pnpm vitest run src/main/services/process/`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/services/process/UtilityProcessHandle.ts src/main/services/process/__tests__/UtilityProcessHandle.test.ts src/main/services/process/ProcessManagerService.ts src/main/services/process/index.ts
git commit --signoff -m "feat(process-manager): implement UtilityProcessHandle with MessagePort IPC"
```

---

## Task 6: TaskExecutor

**Files:**
- Create: `src/main/services/process/TaskExecutor.ts`
- Modify: `src/main/services/process/index.ts` (add export)
- Test: `src/main/services/process/__tests__/TaskExecutor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/services/process/__tests__/TaskExecutor.test.ts
import EventEmitter from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProcessState } from '../types'

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

function createMockProcessManager() {
  const handles = new Map<string, any>()

  return {
    register: vi.fn((def: any) => {
      const proc = new EventEmitter() as any
      proc.id = def.id
      proc._state = ProcessState.Idle
      proc.pid = undefined
      proc.state = ProcessState.Idle
      proc.postMessage = vi.fn((msg: any) => {
        // Auto-respond to tasks
        if (msg.taskId) {
          setTimeout(() => {
            const handler = proc._messageHandlers?.values().next().value
            if (handler) {
              handler({ taskId: msg.taskId, result: `result-of-${msg.taskType}` })
            }
          }, 0)
        }
      })
      proc._messageHandlers = new Set()
      proc.onMessage = vi.fn((handler: any) => {
        proc._messageHandlers.add(handler)
        return () => proc._messageHandlers.delete(handler)
      })
      proc.start = vi.fn(async () => {
        proc._state = ProcessState.Running
        proc.state = ProcessState.Running
        proc.pid = Math.floor(Math.random() * 10000)
      })
      proc.stop = vi.fn(async () => {
        proc._state = ProcessState.Stopped
        proc.state = ProcessState.Stopped
      })
      proc.restart = vi.fn()
      proc.onStarted = undefined
      proc.onExited = undefined
      proc.onLog = undefined
      handles.set(def.id, proc)
      return proc
    }),
    unregister: vi.fn(),
    handles,
  }
}

async function loadModules() {
  const { TaskExecutor } = await import('../TaskExecutor')
  return { TaskExecutor }
}

describe('TaskExecutor', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should create and execute a task', async () => {
    const mockPm = createMockProcessManager()
    const { TaskExecutor } = await loadModules()

    const executor = new TaskExecutor(mockPm as any, {
      id: 'test-executor',
      modulePath: './workers/test.js',
      max: 2,
    })

    const result = await executor.exec<string>('doWork', { input: 'data' })

    expect(result).toBe('result-of-doWork')
    expect(mockPm.register).toHaveBeenCalled()
  })

  it('should reuse idle workers', async () => {
    const mockPm = createMockProcessManager()
    const { TaskExecutor } = await loadModules()

    const executor = new TaskExecutor(mockPm as any, {
      id: 'reuse-test',
      modulePath: './workers/test.js',
      max: 2,
    })

    await executor.exec('task1', {})
    await executor.exec('task2', {})

    // Should have created only 1 worker (reused for second task)
    expect(mockPm.register).toHaveBeenCalledTimes(1)
  })

  it('should spawn up to max workers for concurrent tasks', async () => {
    const mockPm = createMockProcessManager()
    const { TaskExecutor } = await loadModules()

    // Override postMessage to not auto-resolve — tasks stay pending
    mockPm.register.mockImplementation((def: any) => {
      const proc = new EventEmitter() as any
      proc.id = def.id
      proc.state = ProcessState.Idle
      proc.pid = undefined
      proc._messageHandlers = new Set()
      proc.postMessage = vi.fn() // No auto-response
      proc.onMessage = vi.fn((handler: any) => {
        proc._messageHandlers.add(handler)
        return () => proc._messageHandlers.delete(handler)
      })
      proc.start = vi.fn(async () => {
        proc.state = ProcessState.Running
        proc.pid = Math.floor(Math.random() * 10000)
      })
      proc.stop = vi.fn(async () => {
        proc.state = ProcessState.Stopped
      })
      proc.onStarted = undefined
      proc.onExited = undefined
      proc.onLog = undefined
      return proc
    })

    const executor = new TaskExecutor(mockPm as any, {
      id: 'concurrent-test',
      modulePath: './workers/test.js',
      max: 2,
    })

    // Start 3 concurrent tasks
    const p1 = executor.exec('t1', {})
    const p2 = executor.exec('t2', {})
    const p3 = executor.exec('t3', {})

    // Should spawn max=2 workers, third task queued
    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 10))
    expect(mockPm.register).toHaveBeenCalledTimes(2)
  })

  it('should shutdown and reject pending tasks', async () => {
    const mockPm = createMockProcessManager()
    const { TaskExecutor } = await loadModules()

    // No auto-response
    mockPm.register.mockImplementation((def: any) => {
      const proc = new EventEmitter() as any
      proc.id = def.id
      proc.state = ProcessState.Idle
      proc.pid = undefined
      proc._messageHandlers = new Set()
      proc.postMessage = vi.fn()
      proc.onMessage = vi.fn((handler: any) => {
        proc._messageHandlers.add(handler)
        return () => proc._messageHandlers.delete(handler)
      })
      proc.start = vi.fn(async () => {
        proc.state = ProcessState.Running
        proc.pid = 1234
      })
      proc.stop = vi.fn(async () => {
        proc.state = ProcessState.Stopped
      })
      proc.onStarted = undefined
      proc.onExited = undefined
      proc.onLog = undefined
      return proc
    })

    const executor = new TaskExecutor(mockPm as any, {
      id: 'shutdown-test',
      modulePath: './workers/test.js',
      max: 1,
    })

    const pendingTask = executor.exec('slow', {})

    // Allow worker to spin up
    await new Promise((r) => setTimeout(r, 10))

    await executor.shutdown()

    await expect(pendingTask).rejects.toThrow(/shutdown/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/process/__tests__/TaskExecutor.test.ts`
Expected: FAIL — `../TaskExecutor` not found

- [ ] **Step 3: Implement TaskExecutor.ts**

```typescript
// src/main/services/process/TaskExecutor.ts
import { loggerService } from '@logger'

import type { ProcessManagerService } from './ProcessManagerService'
import type { UtilityProcessHandle } from './types'
import { ProcessState } from './types'

export interface TaskExecutorOptions {
  id: string
  modulePath: string
  max: number
  idleTimeoutMs?: number
  env?: Record<string, string>
  killTimeoutMs?: number
}

interface PendingTask {
  taskId: string
  taskType: string
  payload: unknown
  resolve: (value: any) => void
  reject: (error: Error) => void
}

interface WorkerEntry {
  handle: UtilityProcessHandle
  workerId: string
  busy: boolean
  idleTimer?: ReturnType<typeof setTimeout>
  cleanup?: () => void
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000
let taskIdCounter = 0

export class TaskExecutor {
  readonly id: string
  private readonly pm: ProcessManagerService
  private readonly options: TaskExecutorOptions
  private readonly logger: ReturnType<typeof loggerService.withContext>
  private readonly workers: Map<string, WorkerEntry> = new Map()
  private readonly taskQueue: PendingTask[] = []
  private readonly pendingTasks: Map<string, PendingTask> = new Map()
  private workerIdCounter = 0
  private shuttingDown = false

  constructor(pm: ProcessManagerService, options: TaskExecutorOptions) {
    this.pm = pm
    this.options = options
    this.id = options.id
    this.logger = loggerService.withContext(`TaskExecutor:${options.id}`)
  }

  async exec<T>(taskType: string, payload: unknown): Promise<T> {
    if (this.shuttingDown) {
      throw new Error(`TaskExecutor '${this.id}' is shutting down`)
    }

    const taskId = `task-${++taskIdCounter}`

    return new Promise<T>((resolve, reject) => {
      const task: PendingTask = { taskId, taskType, payload, resolve, reject }
      this.taskQueue.push(task)
      this.dispatch()
    })
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    this.logger.info('Shutting down')

    // Reject all queued tasks
    for (const task of this.taskQueue) {
      task.reject(new Error(`TaskExecutor '${this.id}' shutdown — task rejected`))
    }
    this.taskQueue.length = 0

    // Reject all pending (in-flight) tasks
    for (const task of this.pendingTasks.values()) {
      task.reject(new Error(`TaskExecutor '${this.id}' shutdown — task rejected`))
    }
    this.pendingTasks.clear()

    // Stop all workers
    const stopPromises: Promise<void>[] = []
    for (const entry of this.workers.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      entry.cleanup?.()
      stopPromises.push(entry.handle.stop())
    }
    await Promise.all(stopPromises)

    // Unregister workers from PM
    for (const entry of this.workers.values()) {
      try {
        this.pm.unregister(entry.workerId)
      } catch {
        // already cleaned up
      }
    }
    this.workers.clear()

    this.logger.info('Shutdown complete')
  }

  private dispatch(): void {
    if (this.taskQueue.length === 0) return

    // Find an idle worker
    for (const [, entry] of this.workers) {
      if (!entry.busy) {
        const task = this.taskQueue.shift()!
        this.assignTask(entry, task)
        return
      }
    }

    // Spawn a new worker if under capacity
    if (this.workers.size < this.options.max) {
      void this.spawnWorkerAndDispatch()
    }
    // Else: task stays queued, will be picked up when a worker finishes
  }

  private async spawnWorkerAndDispatch(): Promise<void> {
    const task = this.taskQueue.shift()
    if (!task) return

    const workerId = `${this.id}-worker-${++this.workerIdCounter}`

    try {
      const handle = this.pm.register({
        type: 'utility',
        id: workerId,
        modulePath: this.options.modulePath,
        env: this.options.env,
        killTimeoutMs: this.options.killTimeoutMs,
      }) as unknown as UtilityProcessHandle

      await handle.start()

      const cleanup = handle.onMessage((msg: any) => {
        const pendingTask = this.pendingTasks.get(msg.taskId)
        if (!pendingTask) return

        this.pendingTasks.delete(msg.taskId)

        if (msg.error) {
          pendingTask.reject(new Error(msg.error))
        } else {
          pendingTask.resolve(msg.result)
        }

        // Mark worker idle and try next task
        const workerEntry = this.workers.get(workerId)
        if (workerEntry) {
          workerEntry.busy = false
          this.scheduleIdleTimeout(workerEntry)
          this.dispatch()
        }
      })

      const entry: WorkerEntry = { handle, workerId, busy: false, cleanup }
      this.workers.set(workerId, entry)

      this.assignTask(entry, task)
    } catch (err) {
      task.reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private assignTask(entry: WorkerEntry, task: PendingTask): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }

    entry.busy = true
    this.pendingTasks.set(task.taskId, task)

    entry.handle.postMessage({
      taskId: task.taskId,
      taskType: task.taskType,
      payload: task.payload,
    })
  }

  private scheduleIdleTimeout(entry: WorkerEntry): void {
    const timeout = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS

    entry.idleTimer = setTimeout(async () => {
      if (entry.busy || this.shuttingDown) return

      this.logger.debug(`Worker ${entry.workerId} idle timeout, stopping`)
      this.workers.delete(entry.workerId)
      entry.cleanup?.()
      await entry.handle.stop()
      try {
        this.pm.unregister(entry.workerId)
      } catch {
        // already cleaned up
      }
    }, timeout)
  }
}
```

- [ ] **Step 4: Update index.ts barrel exports**

Add to `src/main/services/process/index.ts`:

```typescript
export { TaskExecutor } from './TaskExecutor'
export type { TaskExecutorOptions } from './TaskExecutor'
```

- [ ] **Step 5: Run all process tests**

Run: `pnpm vitest run src/main/services/process/`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/services/process/TaskExecutor.ts src/main/services/process/__tests__/TaskExecutor.test.ts src/main/services/process/index.ts
git commit --signoff -m "feat(process-manager): implement TaskExecutor for parallel task dispatch"
```

---

## Task 7: Lint, Format, and Final Verification

**Files:** All files in `src/main/services/process/`

- [ ] **Step 1: Run lint**

Run: `pnpm lint`
Fix any reported issues.

- [ ] **Step 2: Run format**

Run: `pnpm format`

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: All tests pass, no regressions.

- [ ] **Step 5: Run build check**

Run: `pnpm build:check`
Expected: PASS

- [ ] **Step 6: Final commit if any fixups were needed**

```bash
git add -u
git commit --signoff -m "fix(process-manager): lint and format fixes"
```

---

## Summary

| Task | What it builds | Files |
|------|---------------|-------|
| 1 | Types and interfaces | `types.ts` |
| 2 | ChildProcessHandle | `ChildProcessHandle.ts` + tests |
| 3 | ProcessManagerService | `ProcessManagerService.ts` + tests |
| 4 | Barrel exports + registry | `index.ts` + `serviceRegistry.ts` |
| 5 | UtilityProcessHandle | `UtilityProcessHandle.ts` + tests + PM update |
| 6 | TaskExecutor | `TaskExecutor.ts` + tests |
| 7 | Lint, format, final checks | All files |

Each task is independently testable and produces a commit. Tasks 1-4 deliver a working ChildProcess-only ProcessManager. Task 5 adds UtilityProcess support. Task 6 adds the composite TaskExecutor layer.
