import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  MigrationDatabaseColumnCountBucket,
  MigrationDatabaseCompletedDiagnosticResult,
  MigrationDatabaseDiagnosticStep,
  MigrationDatabaseDiagnosticsWorkerInput,
  MigrationDatabaseDiagnosticsWorkerMessage
} from '../migrationDatabaseDiagnosticsSchemas'
import { EXPECTED_MIGRATION_DATABASE_OBJECTS } from '../migrationDatabaseDiagnosticsSchemas'

const workerModuleMocks = vi.hoisted(() => ({
  createWorker: vi.fn()
}))

vi.mock('../migrationDatabaseDiagnosticsWorker?nodeWorker', () => ({
  default: workerModuleMocks.createWorker
}))

import {
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES,
  MigrationDatabaseDiagnostics,
  type MigrationDatabaseDiagnosticsWorkerLike
} from '../MigrationDatabaseDiagnostics'

class FakeWorker extends EventEmitter implements MigrationDatabaseDiagnosticsWorkerLike {
  readonly terminate = vi.fn<() => Promise<number>>(() => Promise.resolve(0))
  readonly unref = vi.fn()

  constructor(readonly options: { readonly workerData: MigrationDatabaseDiagnosticsWorkerInput }) {
    super()
  }
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
      writeMode: 'rollback',
      walSidecars: 'none'
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
      quickCheck: {
        outcome: 'ok',
        issueCountBucket: '0',
        categories: [],
        truncated: false
      },
      foreignKeys: {
        outcome: 'ok',
        scannedCountBucket: '0',
        violations: [],
        truncated: false
      }
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

function emitMessage(worker: FakeWorker, message: MigrationDatabaseDiagnosticsWorkerMessage): void {
  worker.emit('message', message)
}

function emitAllSteps(worker: FakeWorker, result: MigrationDatabaseCompletedDiagnosticResult): void {
  emitMessage(worker, { type: 'step', step: result.l0 })
  emitMessage(worker, { type: 'step', step: result.l1 })
  emitMessage(worker, { type: 'step', step: result.l2 })
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('MigrationDatabaseDiagnostics', () => {
  let workers: FakeWorker[]

  beforeEach(() => {
    workers = []
    workerModuleMocks.createWorker.mockReset()
    workerModuleMocks.createWorker.mockImplementation((options) => {
      const worker = new FakeWorker(options)
      workers.push(worker)
      return worker
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts incremental strict steps and a strict final result', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/Users/private/database.sqlite')
    const worker = workers[0]
    const result = makeResult()

    emitMessage(worker, { type: 'step', step: result.l0 })
    emitMessage(worker, { type: 'step', step: result.l1 })
    emitMessage(worker, { type: 'result', result })

    await expect(inspection).resolves.toEqual(result)
    expect(worker.options.workerData).toEqual({ databaseFile: '/Users/private/database.sqlite' })
    expect(worker.unref).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('preserves completed steps when the worker emits an error', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/private/canary.sqlite')
    const worker = workers[0]
    const completed = makeResult()

    emitAllSteps(worker, completed)
    worker.emit('error', new Error('sk-secret /private/canary.sqlite'))

    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: 'worker_error' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result.l2).toEqual(completed.l2)
    expect(JSON.stringify(result)).not.toContain('sk-secret')
    expect(JSON.stringify(result)).not.toContain('/private/canary.sqlite')
  })

  it.each([
    { code: 9, expected: 'worker_exit' as const },
    { code: 0, expected: 'worker_no_result' as const }
  ])('maps exit code $code without a final result to $expected', async ({ code, expected }) => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const worker = workers[0]
    const completed = makeResult()

    emitAllSteps(worker, completed)
    worker.emit('exit', code)

    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: expected })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result.l2).toEqual(completed.l2)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('keeps a timeout visible after all steps and terminates a hung worker once', async () => {
    vi.useFakeTimers()
    const diagnostics = new MigrationDatabaseDiagnostics({
      createWorker: workerModuleMocks.createWorker,
      timeoutMs: 25
    })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const worker = workers[0]
    const completed = makeResult()

    emitAllSteps(worker, completed)
    await vi.advanceTimersByTimeAsync(25)

    const result = await inspection
    expect(result.completion).toEqual({ status: 'timed_out', code: 'worker_timeout' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result.l2).toEqual(completed.l2)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('removes every listener and ignores late messages after settlement', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const worker = workers[0]
    const result = makeResult()

    emitMessage(worker, { type: 'result', result })
    await expect(inspection).resolves.toEqual(result)

    expect(worker.listenerCount('message')).toBe(0)
    expect(worker.listenerCount('error')).toBe(0)
    expect(worker.listenerCount('exit')).toBe(0)
    worker.emit('message', { rawError: 'late-secret' })
    worker.emit('exit', 8)
    await flushPromises()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: 'final result with an extra path',
      message: { type: 'result', result: { ...makeResult(), databaseFile: '/Users/alice/secret.sqlite' } }
    },
    {
      name: 'oversized final result',
      message: {
        type: 'result',
        result: { ...makeResult(), payload: 'x'.repeat(MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES + 1) }
      }
    }
  ])('preserves all steps and exposes protocol failure for a $name', async ({ message }) => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const worker = workers[0]
    const completed = makeResult()

    emitAllSteps(worker, completed)
    worker.emit('message', message)

    const result = await inspection
    expect(result.completion).toEqual({ status: 'failed', code: 'protocol_error' })
    expect(result.l0).toEqual(completed.l0)
    expect(result.l1).toEqual(completed.l1)
    expect(result.l2).toEqual(completed.l2)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('/Users/alice')
  })

  it('does not fabricate a failed diagnostic layer for a malformed step', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const worker = workers[0]

    worker.emit('message', { type: 'step', step: { level: 'l0', rawError: 'secret-canary' } })

    const result = await inspection
    expect(result).toMatchObject({ completion: { status: 'failed', code: 'protocol_error' } })
    expect(result).not.toHaveProperty('l0')
    expect(result).not.toHaveProperty('l1')
    expect(result).not.toHaveProperty('l2')
    expect(JSON.stringify(result)).not.toContain('secret-canary')
  })

  it('returns a stable result when construction or termination fails', async () => {
    const constructorFailure = new MigrationDatabaseDiagnostics({
      createWorker: () => {
        throw new Error('/private/path constructor secret')
      }
    })
    const constructorResult = await constructorFailure.inspect('/private/database.sqlite')
    expect(constructorResult).toMatchObject({ completion: { status: 'failed', code: 'worker_error' } })
    expect(constructorResult).not.toHaveProperty('l0')
    expect(constructorResult).not.toHaveProperty('l1')
    expect(constructorResult).not.toHaveProperty('l2')

    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const worker = workers[0]
    worker.terminate.mockRejectedValue(new Error('termination secret'))
    const result = makeResult()
    emitMessage(worker, { type: 'result', result })

    await expect(inspection).resolves.toEqual(result)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('does not share incremental state across concurrent calls', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const first = diagnostics.inspect('/private/first.sqlite')
    const second = diagnostics.inspect('/private/second.sqlite')
    const [firstWorker, secondWorker] = workers
    const l0 = makeL0Step()

    emitMessage(firstWorker, { type: 'step', step: l0 })
    firstWorker.emit('error', new Error('first failed'))
    secondWorker.emit('error', new Error('second failed'))

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.l0).toEqual(l0)
    expect(firstResult.completion).toEqual({ status: 'failed', code: 'worker_error' })
    expect(secondResult.completion).toEqual({ status: 'failed', code: 'worker_error' })
    expect(secondResult).not.toHaveProperty('l0')
    expect(firstWorker.terminate).toHaveBeenCalledOnce()
    expect(secondWorker.terminate).toHaveBeenCalledOnce()
  })
})
