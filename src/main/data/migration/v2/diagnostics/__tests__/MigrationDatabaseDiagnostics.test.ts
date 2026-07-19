import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  MigrationDatabaseColumnCountBucket,
  MigrationDatabaseCompletedDiagnosticResult,
  MigrationDatabaseDiagnosticsChildMessage,
  MigrationDatabaseDiagnosticStep
} from '../migrationDatabaseDiagnosticsSchemas'
import { EXPECTED_MIGRATION_DATABASE_OBJECTS } from '../migrationDatabaseDiagnosticsSchemas'

vi.mock('../migrationDatabaseDiagnosticsChild?modulePath', () => ({
  default: '/fixed/migrationDatabaseDiagnosticsChild.js'
}))

import {
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES,
  MigrationDatabaseDiagnostics,
  type MigrationDatabaseDiagnosticsChildFactory,
  type MigrationDatabaseDiagnosticsChildLike,
  type MigrationDatabaseDiagnosticsLease
} from '../MigrationDatabaseDiagnostics'

class FakeStderr extends EventEmitter {}

class FakeChild extends EventEmitter implements MigrationDatabaseDiagnosticsChildLike {
  readonly stderr = new FakeStderr()
  readonly send = vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
    callback?.(null)
    return true
  })
  readonly kill = vi.fn(() => true)
  readonly unref = vi.fn()
}

function makeLease(databaseFile = '/Users/private/database.sqlite'): MigrationDatabaseDiagnosticsLease {
  return {
    databaseFile,
    identity: {
      database: { device: '1', inode: '10' },
      wal: { device: '1', inode: '11' },
      shm: { device: '1', inode: '12' }
    }
  } as MigrationDatabaseDiagnosticsLease
}

function makeL0Step(): MigrationDatabaseDiagnosticStep {
  return {
    level: 'l0',
    status: 'success',
    data: {
      exists: true,
      fileKind: 'regular',
      sizeBucket: '4_kib_to_1_mib',
      mtimeAgeBucket: 'under_1_hour',
      header: 'valid',
      writeMode: 'wal',
      walSidecars: 'complete'
    }
  }
}

function bucketColumnCount(count: number | undefined): MigrationDatabaseColumnCountBucket {
  if (count === undefined) return 'unavailable'
  if (count === 0) return '0'
  if (count <= 5) return '1_to_5'
  if (count <= 10) return '6_to_10'
  if (count <= 20) return '11_to_20'
  if (count <= 40) return '21_to_40'
  return '41_plus'
}

function makeL1Step(): MigrationDatabaseDiagnosticStep {
  return {
    level: 'l1',
    status: 'success',
    data: {
      metadata: {
        pageSize: '4096',
        encoding: 'utf8',
        userVersionBucket: '0',
        schemaVersionBucket: '1_to_10',
        applicationId: 'unset',
        queryOnly: true
      },
      objects: EXPECTED_MIGRATION_DATABASE_OBJECTS.map((object) => ({
        id: object.id,
        kind: object.kind,
        status: 'ok' as const,
        columnCountBucket: bucketColumnCount('columnCount' in object ? object.columnCount : undefined)
      })),
      unknownObjects: []
    }
  }
}

function makeL2Step(): MigrationDatabaseDiagnosticStep {
  return {
    level: 'l2',
    status: 'success',
    data: {
      quickCheck: { outcome: 'ok', issueCountBucket: '0', categories: [], truncated: false },
      foreignKeys: { outcome: 'ok', scannedCountBucket: '0', violations: [], truncated: false }
    }
  }
}

function makeResult(
  overrides: Partial<MigrationDatabaseCompletedDiagnosticResult> = {}
): MigrationDatabaseCompletedDiagnosticResult {
  return {
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'completed' },
    l0: makeL0Step() as Extract<MigrationDatabaseDiagnosticStep, { level: 'l0' }>,
    l1: makeL1Step() as Extract<MigrationDatabaseDiagnosticStep, { level: 'l1' }>,
    l2: makeL2Step() as Extract<MigrationDatabaseDiagnosticStep, { level: 'l2' }>,
    ...overrides
  }
}

function emitMessage(child: FakeChild, message: MigrationDatabaseDiagnosticsChildMessage): void {
  child.emit('message', message)
}

function emitReady(child: FakeChild): void {
  child.emit('message', { type: 'ready', version: 1 })
}

function emitAllSteps(child: FakeChild, result: MigrationDatabaseCompletedDiagnosticResult): void {
  emitMessage(child, { type: 'step', step: result.l0 })
  emitMessage(child, { type: 'step', step: result.l1 })
  emitMessage(child, { type: 'step', step: result.l2 })
}

function emitExit(child: FakeChild, code: number | null = 0, signal: NodeJS.Signals | null = null): void {
  child.emit('exit', code, signal)
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('MigrationDatabaseDiagnostics', () => {
  let children: FakeChild[]
  let createChild: ReturnType<typeof vi.fn<MigrationDatabaseDiagnosticsChildFactory>>

  beforeEach(() => {
    children = []
    createChild = vi.fn(() => {
      const child = new FakeChild()
      children.push(child)
      return child
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns a fixed child without the database path and sends the lease only after ready', async () => {
    const databaseFile = '/Users/private/path-canary.sqlite'
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspectWithLease(makeLease(databaseFile))
    const child = children[0]

    expect(createChild).toHaveBeenCalledOnce()
    const [modulePath, options] = createChild.mock.calls[0]
    expect(modulePath).toBe('/fixed/migrationDatabaseDiagnosticsChild.js')
    expect(options).toMatchObject({
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
      shell: false,
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
    expect(JSON.stringify([modulePath, options])).not.toContain(databaseFile)
    expect(child.send).not.toHaveBeenCalled()

    emitReady(child)
    expect(child.send).toHaveBeenCalledOnce()
    expect(child.send.mock.calls[0][0]).toMatchObject({ mode: 'full', databaseFile })

    const result = makeResult()
    emitAllSteps(child, result)
    emitMessage(child, { type: 'result', result })
    emitExit(child)
    await expect(inspection).resolves.toEqual(result)
  })

  it('waits for a clean child exit after a complete ordered and identical final result', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    let settled = false
    const inspection = diagnostics.inspectWithLease(makeLease()).then((result) => {
      settled = true
      return result
    })
    const child = children[0]
    const result = makeResult()

    emitReady(child)
    emitAllSteps(child, result)
    emitMessage(child, { type: 'result', result })
    await flushPromises()
    expect(settled).toBe(false)
    expect(child.kill).not.toHaveBeenCalled()

    emitExit(child)
    await expect(inspection).resolves.toEqual(result)
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it.each([
    {
      caseName: 'duplicate step',
      makeLateMessage: (result: MigrationDatabaseCompletedDiagnosticResult) => ({ type: 'step', step: result.l2 })
    },
    { caseName: 'unknown object', makeLateMessage: () => ({ type: 'unknown' }) },
    { caseName: 'arbitrary value', makeLateMessage: () => 'unexpected-after-final' }
  ])('rejects a $caseName received after final but before exit', async ({ makeLateMessage }) => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    let settled = false
    const inspection = diagnostics.inspectWithLease(makeLease()).then((result) => {
      settled = true
      return result
    })
    const child = children[0]
    const completed = makeResult()

    emitReady(child)
    emitAllSteps(child, completed)
    emitMessage(child, { type: 'result', result: completed })
    child.emit('message', makeLateMessage(completed))

    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    await flushPromises()
    expect(settled).toBe(false)
    emitExit(child, null, 'SIGKILL')

    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: 'protocol_error' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result.l2).toEqual(completed.l2)
  })

  it('times out and kills a child that sends a complete final result but never exits', async () => {
    vi.useFakeTimers()
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild, timeoutMs: 25 })
    let settled = false
    const inspection = diagnostics.inspectWithLease(makeLease()).then((result) => {
      settled = true
      return result
    })
    const child = children[0]
    const completed = makeResult()

    emitReady(child)
    emitAllSteps(child, completed)
    emitMessage(child, { type: 'result', result: completed })
    await vi.advanceTimersByTimeAsync(25)

    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    expect(settled).toBe(false)
    emitExit(child, null, 'SIGKILL')

    const result = await inspection
    expect(result.completion).toEqual({ status: 'timed_out', code: 'process_timeout' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result.l2).toEqual(completed.l2)
  })

  it('returns only L0 with lease_unavailable when no database lease exists', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const child = children[0]
    const l0 = makeL0Step()

    emitReady(child)
    expect(child.send.mock.calls[0][0]).toEqual({ mode: 'l0_only', databaseFile: '/private/database.sqlite' })
    emitMessage(child, { type: 'step', step: l0 })
    emitExit(child)

    await expect(inspection).resolves.toEqual({
      version: 1,
      expectedSchemaVersion: 1,
      completion: { status: 'failed', code: 'lease_unavailable' },
      l0
    })
  })

  it('rejects final-before-steps and waits for the killed child to exit', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    let settled = false
    const inspection = diagnostics.inspectWithLease(makeLease()).then((result) => {
      settled = true
      return result
    })
    const child = children[0]

    emitReady(child)
    emitMessage(child, { type: 'result', result: makeResult() })
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    await flushPromises()
    expect(settled).toBe(false)

    emitExit(child, null, 'SIGKILL')
    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: 'protocol_error' })
    expect(result).not.toHaveProperty('l0')
  })

  it('rejects a final missing L2 and preserves only the real L0/L1 prefix', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspectWithLease(makeLease())
    const child = children[0]
    const completed = makeResult()

    emitReady(child)
    emitMessage(child, { type: 'step', step: completed.l0 })
    emitMessage(child, { type: 'step', step: completed.l1 })
    emitMessage(child, { type: 'result', result: completed })
    emitExit(child, null, 'SIGKILL')

    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: 'protocol_error' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result).not.toHaveProperty('l2')
  })

  it.each([
    { level: 'l0', finalResult: makeResult({ l0: { level: 'l0', status: 'failed', code: 'read_failed' } }) },
    { level: 'l1', finalResult: makeResult({ l1: { level: 'l1', status: 'failed', code: 'query_failed' } }) },
    { level: 'l2', finalResult: makeResult({ l2: { level: 'l2', status: 'failed', code: 'query_failed' } }) }
  ])('rejects a final whose $level differs from the saved prefix', async ({ finalResult }) => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspectWithLease(makeLease())
    const child = children[0]
    const completed = makeResult()

    emitReady(child)
    emitAllSteps(child, completed)
    emitMessage(child, { type: 'result', result: finalResult })
    emitExit(child, null, 'SIGKILL')

    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: 'protocol_error' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result.l2).toEqual(completed.l2)
  })

  it('SIGKILLs on timeout and does not resolve or release its caller before exit', async () => {
    vi.useFakeTimers()
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild, timeoutMs: 25 })
    let settled = false
    const inspection = diagnostics.inspectWithLease(makeLease()).then((result) => {
      settled = true
      return result
    })
    const child = children[0]
    const completed = makeResult()

    emitReady(child)
    emitMessage(child, { type: 'step', step: completed.l0 })
    emitMessage(child, { type: 'step', step: completed.l1 })
    await vi.advanceTimersByTimeAsync(25)

    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    expect(settled).toBe(false)
    emitExit(child, null, 'SIGKILL')

    const result = await inspection
    expect(result.completion).toEqual({ status: 'timed_out', code: 'process_timeout' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result).not.toHaveProperty('l2')
  })

  it('contains kill throws and still waits for a later observed exit', async () => {
    vi.useFakeTimers()
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild, timeoutMs: 25 })
    let settled = false
    const inspection = diagnostics.inspectWithLease(makeLease()).then((result) => {
      settled = true
      return result
    })
    const child = children[0]
    child.kill.mockImplementation(() => {
      throw new Error('kill secret')
    })

    emitReady(child)
    await vi.advanceTimersByTimeAsync(25)
    expect(settled).toBe(false)
    emitExit(child, null, 'SIGKILL')

    await expect(inspection).resolves.toMatchObject({
      completion: { status: 'timed_out', code: 'process_timeout' }
    })
  })

  it('kills on child or IPC errors, preserves the prefix, and never echoes details', async () => {
    const cases: Array<(child: FakeChild) => void> = [
      (child) => child.emit('error', new Error('sk-child-error /private/path')),
      (child) => child.send.mock.calls[0][1]!(new Error('sk-ipc-error /private/path'))
    ]

    for (const fail of cases) {
      const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
      const inspection = diagnostics.inspectWithLease(makeLease())
      const child = children.at(-1)!
      const l0 = makeL0Step()
      emitReady(child)
      emitMessage(child, { type: 'step', step: l0 })
      fail(child)
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
      emitExit(child, null, 'SIGKILL')

      const result = await inspection
      expect(result.completion).toEqual({ status: 'failed', code: 'process_error' })
      expect(result.l0).toEqual(l0)
      expect(JSON.stringify(result)).not.toMatch(/sk-|private/)
    }
  })

  it.each([
    { code: 9, expected: 'process_exit' as const },
    { code: 0, expected: 'process_no_result' as const }
  ])('maps an unprompted exit code $code to $expected without killing again', async ({ code, expected }) => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspectWithLease(makeLease())
    const child = children[0]
    const l0 = makeL0Step()

    emitReady(child)
    emitMessage(child, { type: 'step', step: l0 })
    emitExit(child, code)

    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: expected })
    expect(result.l0).toEqual(l0)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('rejects oversized/malformed/late messages, drains stderr, and cleans all listeners once', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspectWithLease(makeLease())
    const child = children[0]
    const completed = makeResult()

    child.stderr.emit('data', Buffer.from('stderr-secret-canary'))
    emitReady(child)
    emitAllSteps(child, completed)
    child.emit('message', {
      type: 'result',
      result: { ...completed, payload: 'x'.repeat(MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES + 1) }
    })
    emitExit(child, null, 'SIGKILL')

    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: 'protocol_error' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result.l2).toEqual(completed.l2)
    expect(JSON.stringify(result)).not.toContain('stderr-secret-canary')
    expect(child.listenerCount('message')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('exit')).toBe(0)
    expect(child.stderr.listenerCount('data')).toBe(0)
    child.emit('message', { rawError: 'late-secret' })
    emitExit(child, 8)
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('returns stable invalid-input and spawn-failure results without leaking input', async () => {
    const invalid = await new MigrationDatabaseDiagnostics({ createChild }).inspect('')
    expect(invalid).toMatchObject({ completion: { status: 'failed', code: 'invalid_input' } })
    expect(createChild).not.toHaveBeenCalled()

    const spawnFailure = new MigrationDatabaseDiagnostics({
      createChild: () => {
        throw new Error('/private/path spawn secret')
      }
    })
    const failed = await spawnFailure.inspect('/private/database.sqlite')
    expect(failed).toMatchObject({ completion: { status: 'failed', code: 'process_error' } })
    expect(JSON.stringify(failed)).not.toContain('/private')
  })

  it('does not share prefixes or kills across concurrent inspections', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const first = diagnostics.inspectWithLease(makeLease('/private/first.sqlite'))
    const second = diagnostics.inspectWithLease(makeLease('/private/second.sqlite'))
    const [firstChild, secondChild] = children
    const l0 = makeL0Step()

    emitReady(firstChild)
    emitReady(secondChild)
    emitMessage(firstChild, { type: 'step', step: l0 })
    firstChild.emit('error', new Error('first failed'))
    secondChild.emit('error', new Error('second failed'))
    emitExit(firstChild, null, 'SIGKILL')
    emitExit(secondChild, null, 'SIGKILL')

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.l0).toEqual(l0)
    expect(firstResult.completion).toEqual({ status: 'failed', code: 'process_error' })
    expect(secondResult).not.toHaveProperty('l0')
    expect(firstChild.kill).toHaveBeenCalledOnce()
    expect(secondChild.kill).toHaveBeenCalledOnce()
  })
})
