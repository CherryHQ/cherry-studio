import { EventEmitter } from 'node:events'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONVERSATION_ISLAND_MAX_LINE_BYTES,
  type ConversationIslandActivityItem,
  type ConversationIslandCommand
} from '../conversationIslandProtocol'

const mocks = vi.hoisted(() => ({
  isPackaged: false,
  getPath: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    }
  }
}))

vi.mock('@application', () => ({ application: { getPath: mocks.getPath } }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError, warn: mocks.loggerWarn }) }
}))

const { ConversationIslandNativeHost } = await import('../ConversationIslandNativeHost')

type PresentCommand = Extract<ConversationIslandCommand, { type: 'present' }>
type DismissCommand = Extract<ConversationIslandCommand, { type: 'dismiss' }>

class FakeReadable extends EventEmitter {
  push(chunk: Buffer | string): void {
    this.emit('data', chunk)
  }

  finish(): void {
    this.emit('end')
  }
}

class FakeStdin extends EventEmitter {
  readonly writes: Buffer[] = []
  readonly ends: Buffer[] = []
  readonly writeResults: boolean[] = []

  write(chunk: Uint8Array): boolean {
    this.writes.push(Buffer.from(chunk))
    return this.writeResults.shift() ?? true
  }

  end(chunk?: Uint8Array): void {
    if (chunk) this.ends.push(Buffer.from(chunk))
  }
}

class FakeChild extends EventEmitter {
  readonly stdin = new FakeStdin()
  readonly stdout = new FakeReadable()
  readonly stderr = new FakeReadable()
  readonly kills: NodeJS.Signals[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(readonly pid: number) {
    super()
  }

  kill(signal: NodeJS.Signals): boolean {
    this.kills.push(signal)
    return true
  }

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

const activity: ConversationIslandActivityItem = {
  activityId: 'topic-1',
  identityAvatar: '🤖',
  identityName: 'Assistant',
  state: 'streaming',
  statusText: 'Working',
  title: 'Private conversation title'
}

function present(revision: number): PresentCommand {
  return {
    version: 1,
    type: 'present',
    revision,
    payload: {
      displayId: 1,
      expanded: false,
      reducedMotion: false,
      theme: { appearance: 'dark', primaryColor: '#00B96B', fontFamily: '' },
      primaryActivityId: activity.activityId,
      activityCountText: '1 activity',
      activities: [activity]
    }
  }
}

function dismiss(revision: number): DismissCommand {
  return { version: 1, type: 'dismiss', revision }
}

function helperEvent(event: object): Buffer {
  return Buffer.from(`${JSON.stringify(event)}\n`)
}

function decoded(chunks: Buffer[]): ConversationIslandCommand[] {
  return chunks.map((chunk) => JSON.parse(chunk.toString('utf8')) as ConversationIslandCommand)
}

interface HarnessCallbacks {
  onReady: ReturnType<typeof vi.fn>
  onSetExpanded: ReturnType<typeof vi.fn>
  onOpenActivity: ReturnType<typeof vi.fn>
}

function createHarness() {
  const children: FakeChild[] = []
  const spawnProcess = vi.fn(() => {
    const child = new FakeChild(41000 + children.length)
    children.push(child)
    return child as never
  })
  const callbacks: HarnessCallbacks = {
    onReady: vi.fn(),
    onSetExpanded: vi.fn(),
    onOpenActivity: vi.fn()
  }
  const host = new ConversationIslandNativeHost({ spawnProcess, callbacks })

  return { callbacks, children, host, spawnProcess }
}

function ready(child: FakeChild): void {
  child.stdout.push(helperEvent({ version: 1, type: 'ready', pid: child.pid }))
}

describe('ConversationIslandNativeHost', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    vi.clearAllMocks()
    mocks.isPackaged = false
    mocks.getPath.mockImplementation((key: string, filename?: string) => {
      if (key === 'app.extra_resources') return filename ? `/Applications/Cherry/${filename}` : '/Applications/Cherry'
      if (key === 'app.root.resources.binaries') return '/workspace/resources/binaries'
      throw new Error(`Unexpected application.getPath(${key})`)
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each([
    [true, '/Applications/Cherry/conversation-island-helper'],
    [false, path.join('/workspace/resources/binaries', `darwin-${process.arch}`, 'conversation-island-helper')]
  ])('resolves the %s packaged-state executable through the path registry', (isPackaged, expectedPath) => {
    mocks.isPackaged = isPackaged
    const { host, spawnProcess } = createHarness()

    host.present(present(1))

    expect(spawnProcess).toHaveBeenCalledWith(expectedPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    })
    if (isPackaged) {
      expect(mocks.getPath).toHaveBeenCalledWith('app.extra_resources', 'conversation-island-helper')
    } else {
      expect(mocks.getPath).toHaveBeenCalledWith('app.root.resources.binaries')
    }
  })

  it('does not spawn until the first present and shutdown without a child is idempotent', async () => {
    const { host, spawnProcess } = createHarness()

    host.dismiss(dismiss(1))
    expect(spawnProcess).not.toHaveBeenCalled()

    const first = host.shutdown()
    const second = host.shutdown()

    expect(first).toBe(second)
    expect(spawnProcess).not.toHaveBeenCalled()
    await expect(first).resolves.toBeUndefined()
  })

  it('fails and safely closes a child that misses the three-second ready deadline', () => {
    const { callbacks, children, host } = createHarness()
    host.present(present(1))
    const child = children[0]

    vi.advanceTimersByTime(2_999)
    expect(child.stdin.ends).toEqual([])

    vi.advanceTimersByTime(1)

    expect(decoded(child.stdin.ends)).toEqual([{ version: 1, type: 'shutdown' }])
    expect(callbacks.onReady).not.toHaveBeenCalled()
    expect(mocks.loggerWarn).toHaveBeenCalledWith('Conversation Island native helper failed', {
      reason: 'ready-timeout'
    })
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(activity.title)
  })

  it('restarts active crashes with bounded backoff and replays the latest present after each ready', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    ready(children[0])

    children[0].exit(1)
    host.present(present(2))
    vi.advanceTimersByTime(249)
    expect(spawnProcess).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    ready(children[1])
    expect(decoded(children[1].stdin.writes)).toEqual([present(2)])

    children[1].exit(1)
    host.present(present(3))
    vi.advanceTimersByTime(999)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    ready(children[2])
    expect(decoded(children[2].stdin.writes)).toEqual([present(3)])

    children[2].exit(1)
    host.present(present(4))
    vi.advanceTimersByTime(3_999)
    expect(spawnProcess).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(1)
    ready(children[3])
    expect(decoded(children[3].stdin.writes)).toEqual([present(4)])
  })

  it('opens the circuit after four active crashes within sixty seconds', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    ready(children[0])

    for (const delay of [250, 1_000, 4_000]) {
      children.at(-1)!.exit(1)
      vi.advanceTimersByTime(delay)
      ready(children.at(-1)!)
    }

    children.at(-1)!.exit(1)
    vi.advanceTimersByTime(120_000)

    expect(spawnProcess).toHaveBeenCalledTimes(4)
    expect(mocks.loggerError).toHaveBeenCalledWith('Conversation Island native helper circuit opened', {
      crashCount: 4,
      errorKind: 'process-exit',
      state: 'present'
    })
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(activity.title)
  })

  it('counts an error and subsequent exit from one generation as one crash', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    ready(children[0])

    children[0].emit('error', new Error('private process details'))
    children[0].exit(1)
    vi.advanceTimersByTime(250)
    ready(children[1])

    children[1].exit(1)
    vi.advanceTimersByTime(999)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(spawnProcess).toHaveBeenCalledTimes(3)
  })

  it('applies the same crash recovery policy to ready timeouts', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))

    vi.advanceTimersByTime(3_000)
    vi.advanceTimersByTime(249)
    expect(spawnProcess).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    expect(spawnProcess).toHaveBeenCalledTimes(2)

    ready(children[1])
    expect(decoded(children[1].stdin.writes)).toEqual([present(1)])
  })

  it('does not count or restart a crash while hidden and idle', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    ready(children[0])
    host.dismiss(dismiss(2))
    children[0].stdout.push(helperEvent({ version: 1, type: 'hidden', revision: 2 }))

    children[0].exit(1)
    vi.advanceTimersByTime(60_000)
    expect(spawnProcess).toHaveBeenCalledOnce()

    host.present(present(3))
    ready(children[1])
    children[1].exit(1)
    vi.advanceTimersByTime(249)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(spawnProcess).toHaveBeenCalledTimes(3)
  })

  it('does not count a normal idle shutdown as a crash', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    ready(children[0])
    host.dismiss(dismiss(2))
    children[0].stdout.push(helperEvent({ version: 1, type: 'hidden', revision: 2 }))

    vi.advanceTimersByTime(30_000)
    children[0].exit(0)
    host.present(present(3))
    ready(children[1])
    children[1].exit(1)

    vi.advanceTimersByTime(249)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(spawnProcess).toHaveBeenCalledTimes(3)
  })

  it('coalesces present updates during backoff and cancels a pending restart on dismiss', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    ready(children[0])

    children[0].exit(1)
    host.present(present(2))
    host.present(present(3))
    vi.advanceTimersByTime(250)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    ready(children[1])
    expect(decoded(children[1].stdin.writes)).toEqual([present(3)])

    children[1].exit(1)
    host.present(present(4))
    host.dismiss(dismiss(5))
    vi.advanceTimersByTime(1_000)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
  })

  it('starts the latest present when the circuit is reset', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    ready(children[0])

    for (const delay of [250, 1_000, 4_000]) {
      children.at(-1)!.exit(1)
      vi.advanceTimersByTime(delay)
      ready(children.at(-1)!)
    }
    children.at(-1)!.exit(1)
    host.present(present(8))

    vi.advanceTimersByTime(10_000)
    expect(spawnProcess).toHaveBeenCalledTimes(4)
    host.resetCircuit()
    expect(spawnProcess).toHaveBeenCalledTimes(5)
    ready(children[4])
    expect(decoded(children[4].stdin.writes)).toEqual([present(8)])
  })

  it('slides old crashes out of the window and returns to the shortest delay', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    ready(children[0])

    for (const delay of [250, 1_000, 4_000]) {
      children.at(-1)!.exit(1)
      vi.advanceTimersByTime(delay)
      ready(children.at(-1)!)
    }

    vi.advanceTimersByTime(60_000)
    children.at(-1)!.exit(1)
    vi.advanceTimersByTime(249)
    expect(spawnProcess).toHaveBeenCalledTimes(4)
    vi.advanceTimersByTime(1)

    expect(spawnProcess).toHaveBeenCalledTimes(5)
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })

  it('flushes only the latest desired state when the child becomes ready', () => {
    const { children, host } = createHarness()

    host.present(present(1))
    host.dismiss(dismiss(2))
    host.present(present(3))
    const child = children[0]
    expect(child.stdin.writes).toEqual([])

    ready(child)

    expect(decoded(child.stdin.writes)).toEqual([present(3)])
  })

  it('does not resend an accepted backpressured line and writes only the latest pending revision on drain', () => {
    const { children, host } = createHarness()
    host.present(present(1))
    const child = children[0]
    ready(child)
    child.stdin.writes.length = 0
    child.stdin.writeResults.push(false)

    host.present(present(3))
    host.present(present(4))
    host.present(present(5))

    expect(decoded(child.stdin.writes)).toEqual([present(3)])

    child.stdin.emit('drain')

    expect(decoded(child.stdin.writes)).toEqual([present(3), present(5)])
  })

  it('decodes split and multiple helper events without dispatching stale interactions', () => {
    const { callbacks, children, host } = createHarness()
    host.present(present(7))
    const child = children[0]
    const readyLine = helperEvent({ version: 1, type: 'ready', pid: child.pid })

    child.stdout.push(readyLine.subarray(0, 12))
    expect(callbacks.onReady).not.toHaveBeenCalled()
    child.stdout.push(
      Buffer.concat([
        readyLine.subarray(12),
        helperEvent({ version: 1, type: 'setExpanded', revision: 6, expanded: true }),
        helperEvent({ version: 1, type: 'setExpanded', revision: 7, expanded: true }),
        helperEvent({ version: 1, type: 'openActivity', revision: 6, activityId: 'stale' }),
        helperEvent({ version: 1, type: 'openActivity', revision: 7, activityId: 'topic-1' })
      ])
    )

    expect(callbacks.onReady).toHaveBeenCalledWith(child.pid)
    expect(callbacks.onSetExpanded).toHaveBeenCalledOnce()
    expect(callbacks.onSetExpanded).toHaveBeenCalledWith({
      version: 1,
      type: 'setExpanded',
      revision: 7,
      expanded: true
    })
    expect(callbacks.onOpenActivity).toHaveBeenCalledOnce()
    expect(callbacks.onOpenActivity).toHaveBeenCalledWith({
      version: 1,
      type: 'openActivity',
      revision: 7,
      activityId: 'topic-1'
    })
  })

  it('drops invalid JSON and unknown protocol events, then resumes without logging their payloads', () => {
    const { callbacks, children, host } = createHarness()
    host.present(present(1))
    const child = children[0]

    child.stdout.push(Buffer.from('{"private":"do-not-log"\n'))
    child.stdout.push(helperEvent({ version: 2, type: 'ready', pid: child.pid, private: 'do-not-log' }))
    child.stdout.push(helperEvent({ version: 1, type: 'unknown', private: 'do-not-log' }))
    ready(child)

    expect(callbacks.onReady).toHaveBeenCalledWith(child.pid)
    expect(
      mocks.loggerWarn.mock.calls.filter(([message]) => message === 'Ignored invalid Conversation Island helper event')
    ).toHaveLength(3)
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain('do-not-log')
  })

  it.each([
    ['invalid-utf8', () => Buffer.from([0xc3, 0x28, 0x0a])],
    [
      'line-too-long',
      () => Buffer.concat([Buffer.from('private-payload'), Buffer.alloc(CONVERSATION_ISLAND_MAX_LINE_BYTES, 0x61)])
    ]
  ])('treats %s stdout frames as fatal without exposing their bytes', (reason, makeChunk) => {
    const { callbacks, children, host } = createHarness()
    host.present(present(1))
    const child = children[0]

    child.stdout.push(makeChunk())

    expect(decoded(child.stdin.ends)).toEqual([{ version: 1, type: 'shutdown' }])
    expect(callbacks.onReady).not.toHaveBeenCalled()
    expect(mocks.loggerWarn).toHaveBeenCalledWith('Conversation Island native helper failed', { reason })
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain('private-payload')
  })

  it('ignores stale hidden events and reuses the same child when a present arrives before idle expiry', () => {
    const { children, host, spawnProcess } = createHarness()
    host.present(present(1))
    const child = children[0]
    ready(child)
    host.dismiss(dismiss(2))

    child.stdout.push(helperEvent({ version: 1, type: 'hidden', revision: 1 }))
    vi.advanceTimersByTime(30_000)
    expect(child.stdin.ends).toEqual([])

    child.stdout.push(helperEvent({ version: 1, type: 'hidden', revision: 2 }))
    vi.advanceTimersByTime(29_999)
    host.present(present(3))
    vi.advanceTimersByTime(1)

    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(child.stdin.ends).toEqual([])
    expect(decoded(child.stdin.writes).at(-1)).toEqual(present(3))
  })

  it('gracefully shuts down after a matching hidden event remains idle for thirty seconds', () => {
    const { children, host } = createHarness()
    host.present(present(1))
    const child = children[0]
    ready(child)
    host.dismiss(dismiss(2))
    child.stdout.push(helperEvent({ version: 1, type: 'hidden', revision: 2 }))

    vi.advanceTimersByTime(29_999)
    expect(child.stdin.ends).toEqual([])
    vi.advanceTimersByTime(1)

    expect(decoded(child.stdin.ends)).toEqual([{ version: 1, type: 'shutdown' }])
  })

  it('shuts down immediately after hidden when dismissal requests termination', () => {
    const { children, host } = createHarness()
    host.present(present(1))
    const child = children[0]
    ready(child)
    host.dismiss(dismiss(2), true)

    child.stdout.push(helperEvent({ version: 1, type: 'hidden', revision: 2 }))

    expect(decoded(child.stdin.ends)).toEqual([{ version: 1, type: 'shutdown' }])
  })

  it('queues shutdown behind accepted backpressured bytes and escalates to SIGTERM then SIGKILL', async () => {
    const { children, host } = createHarness()
    host.present(present(1))
    const child = children[0]
    ready(child)
    child.stdin.writeResults.push(false)
    host.present(present(2))
    host.present(present(3))

    const shutdown = host.shutdown()

    expect(decoded(child.stdin.writes).at(-1)).toEqual(present(2))
    expect(decoded(child.stdin.ends)).toEqual([{ version: 1, type: 'shutdown' }])
    child.stdin.emit('drain')
    expect(decoded(child.stdin.writes)).not.toContainEqual(present(3))
    vi.advanceTimersByTime(999)
    expect(child.kills).toEqual([])
    vi.advanceTimersByTime(1)
    expect(child.kills).toEqual(['SIGTERM'])
    vi.advanceTimersByTime(1_000)
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])

    child.exit(null, 'SIGKILL')
    await expect(shutdown).resolves.toBeUndefined()
  })

  it('cancels shutdown escalation when the child exits early', async () => {
    const { children, host } = createHarness()
    host.present(present(1))
    const child = children[0]

    const shutdown = host.shutdown()
    child.exit(0)
    await shutdown
    vi.advanceTimersByTime(5_000)

    expect(child.kills).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('frames stderr lines, caps them, and flushes a final partial line at EOF', () => {
    const { children, host } = createHarness()
    host.present(present(1))
    const child = children[0]

    child.stderr.push('first\nsec')
    child.stderr.push(`ond\n${'x'.repeat(5_000)}\ntail`)
    child.stderr.finish()

    const stderrLines = mocks.loggerWarn.mock.calls
      .filter(([message]) => message === 'Conversation Island native helper stderr')
      .map(([, context]) => context.line)
    expect(stderrLines).toEqual(['first', 'second', 'x'.repeat(4_096), 'tail'])
  })

  it('handles emitted spawn and stdin errors without leaking error details or throwing', () => {
    const { children, host } = createHarness()
    host.present(present(1))
    const child = children[0]

    expect(() => child.emit('error', new Error('private spawn details'))).not.toThrow()
    expect(() => child.stdin.emit('error', new Error('private stdin details'))).not.toThrow()
    expect(() => child.stdin.emit('close')).not.toThrow()

    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain('private')
    expect(mocks.loggerWarn).toHaveBeenCalledWith('Conversation Island native helper failed', {
      reason: 'process-error'
    })
  })

  it('isolates a replacement generation from late events emitted by the old child', () => {
    const { callbacks, children, host, spawnProcess } = createHarness()
    host.present(present(1))
    const first = children[0]
    ready(first)
    host.dismiss(dismiss(2))
    first.stdout.push(helperEvent({ version: 1, type: 'hidden', revision: 2 }))
    vi.advanceTimersByTime(30_000)
    first.exit(0)

    host.present(present(3))
    const second = children[1]
    ready(second)
    first.stdout.push(helperEvent({ version: 1, type: 'setExpanded', revision: 3, expanded: true }))
    second.stdout.push(helperEvent({ version: 1, type: 'setExpanded', revision: 3, expanded: true }))

    expect(spawnProcess).toHaveBeenCalledTimes(2)
    expect(callbacks.onSetExpanded).toHaveBeenCalledOnce()
    expect(callbacks.onSetExpanded).toHaveBeenCalledWith({
      version: 1,
      type: 'setExpanded',
      revision: 3,
      expanded: true
    })
  })

  it('cleans timers and listeners on exit and ignores events from an old generation', async () => {
    const { callbacks, children, host } = createHarness()
    host.present(present(1))
    const first = children[0]
    ready(first)

    const stopped = host.shutdown()
    first.exit(0)
    await stopped

    expect(first.listenerCount('exit')).toBe(0)
    expect(first.listenerCount('error')).toBe(0)
    expect(first.stdin.eventNames()).toEqual([])
    expect(first.stdout.eventNames()).toEqual([])
    expect(first.stderr.eventNames()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)

    first.stdout.push(helperEvent({ version: 1, type: 'setExpanded', revision: 1, expanded: true }))
    expect(callbacks.onSetExpanded).not.toHaveBeenCalled()
  })
})
