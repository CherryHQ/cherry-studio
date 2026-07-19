import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  MigrationDatabaseDiagnosticResult,
  MigrationDatabaseDiagnosticStep,
  MigrationDatabaseDiagnosticsWorkerInput,
  MigrationDatabaseDiagnosticsWorkerMessage
} from '../migrationDatabaseDiagnosticsSchemas'

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
      header: 'valid'
    }
  }
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
      objects: [],
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

function makeResult(overrides: Partial<MigrationDatabaseDiagnosticResult> = {}): MigrationDatabaseDiagnosticResult {
  return {
    version: 1,
    expectedSchemaVersion: 1,
    l0: makeL0Step() as Extract<MigrationDatabaseDiagnosticStep, { level: 'l0' }>,
    l1: makeL1Step() as Extract<MigrationDatabaseDiagnosticStep, { level: 'l1' }>,
    l2: makeL2Step() as Extract<MigrationDatabaseDiagnosticStep, { level: 'l2' }>,
    ...overrides
  }
}

function emitMessage(worker: FakeWorker, message: MigrationDatabaseDiagnosticsWorkerMessage): void {
  worker.emit('message', message)
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
    expect(worker.options.workerData).toMatchObject({
      databaseFile: '/Users/private/database.sqlite',
      policy: {
        version: 1,
        expectedSchemaVersion: 1,
        expectedObjects: expect.any(Array)
      }
    })
    expect(worker.unref).toHaveBeenCalledOnce()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('preserves completed steps when the worker emits an error', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/private/canary.sqlite')
    const worker = workers[0]
    const l0 = makeL0Step()

    emitMessage(worker, { type: 'step', step: l0 })
    worker.emit('error', new Error('sk-secret /private/canary.sqlite'))

    const result = await inspection
    expect(result.l0).toEqual(l0)
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: 'worker_error' })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: 'worker_error' })
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

    worker.emit('exit', code)

    const result = await inspection
    expect(result.l0).toEqual({ level: 'l0', status: 'failed', code: expected })
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: expected })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: expected })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('times out only unfinished steps and terminates a hung worker once', async () => {
    vi.useFakeTimers()
    const diagnostics = new MigrationDatabaseDiagnostics({
      createWorker: workerModuleMocks.createWorker,
      timeoutMs: 25
    })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const worker = workers[0]
    const l0 = makeL0Step()
    const l1 = makeL1Step()

    emitMessage(worker, { type: 'step', step: l0 })
    emitMessage(worker, { type: 'step', step: l1 })
    await vi.advanceTimersByTimeAsync(25)

    const result = await inspection
    expect(result.l0).toEqual(l0)
    expect(result.l1).toEqual(l1)
    expect(result.l2).toEqual({ level: 'l2', status: 'timed_out', code: 'worker_timeout' })
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
    { name: 'malformed step', message: { type: 'step', step: { level: 'l0', rawError: 'secret-canary' } } },
    {
      name: 'final result with an extra path',
      message: { type: 'result', result: { ...makeResult(), databaseFile: '/Users/alice/secret.sqlite' } }
    },
    {
      name: 'oversized message',
      message: { type: 'unknown', payload: 'x'.repeat(MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES + 1) }
    }
  ])('maps $name to a stable protocol result without leaking the payload', async ({ message }) => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createWorker: workerModuleMocks.createWorker })
    const inspection = diagnostics.inspect('/private/database.sqlite')
    const worker = workers[0]

    worker.emit('message', message)

    const result = await inspection
    expect(result.l0).toEqual({ level: 'l0', status: 'failed', code: 'protocol_error' })
    expect(result.l1).toEqual({ level: 'l1', status: 'failed', code: 'protocol_error' })
    expect(result.l2).toEqual({ level: 'l2', status: 'failed', code: 'protocol_error' })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('secret-canary')
    expect(serialized).not.toContain('/Users/alice')
  })

  it('returns a stable result when construction or termination fails', async () => {
    const constructorFailure = new MigrationDatabaseDiagnostics({
      createWorker: () => {
        throw new Error('/private/path constructor secret')
      }
    })
    await expect(constructorFailure.inspect('/private/database.sqlite')).resolves.toMatchObject({
      l0: { level: 'l0', status: 'failed', code: 'worker_error' },
      l1: { level: 'l1', status: 'failed', code: 'worker_error' },
      l2: { level: 'l2', status: 'failed', code: 'worker_error' }
    })

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
    expect(secondResult.l0).toEqual({ level: 'l0', status: 'failed', code: 'worker_error' })
    expect(firstWorker.terminate).toHaveBeenCalledOnce()
    expect(secondWorker.terminate).toHaveBeenCalledOnce()
  })
})
