import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../migrationDatabaseDiagnosticsChild?modulePath', () => ({
  default: '/fixed/migrationDatabaseDiagnosticsChild.js'
}))

import {
  MigrationDatabaseDiagnostics,
  type MigrationDatabaseDiagnosticsChildFactory,
  type MigrationDatabaseDiagnosticsChildLike
} from '../MigrationDatabaseDiagnostics'
import { MIGRATION_DATABASE_OBJECT_DEFINITIONS } from '../migrationDatabaseDiagnosticsSchemas'

const available = {
  status: 'available',
  quickCheck: 'ok',
  foreignKeyViolationCountBucket: '0',
  objects: MIGRATION_DATABASE_OBJECT_DEFINITIONS.map(({ role, table, columns }) => ({
    role,
    tableName: table,
    standardColumns: columns,
    status: 'present' as const
  }))
} as const

class FakeChild extends EventEmitter implements MigrationDatabaseDiagnosticsChildLike {
  readonly stderr = new EventEmitter()
  readonly send = vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
    callback?.(null)
    return true
  })
  readonly kill = vi.fn(() => true)
  readonly unref = vi.fn()
}

let testDir = ''
let databaseFile = ''
let children: FakeChild[] = []
let createChild: ReturnType<typeof vi.fn<MigrationDatabaseDiagnosticsChildFactory>>

function writeSqliteHeader(file = databaseFile, size = 4_096): void {
  const bytes = Buffer.alloc(size)
  Buffer.from('SQLite format 3\0', 'binary').copy(bytes)
  writeFileSync(file, bytes)
}

beforeEach(() => {
  vi.useRealTimers()
  testDir = mkdtempSync(path.join(tmpdir(), 'migration-database-parent-'))
  databaseFile = path.join(testDir, 'cherrystudio.sqlite')
  children = []
  createChild = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    return child
  })
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(testDir, { recursive: true, force: true })
})

describe('native-free file inspection', () => {
  it('does not spawn for a missing or non-regular database', async () => {
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })

    await expect(diagnostics.inspect(databaseFile)).resolves.toEqual({
      file: { status: 'missing', sqliteHeader: 'unavailable', walPresent: false, shmPresent: false },
      sqlite: { status: 'unavailable', reason: 'not_attempted' }
    })
    expect(createChild).not.toHaveBeenCalled()

    writeFileSync(path.join(testDir, 'target'), 'outside')
    const symlink = path.join(testDir, 'database-link')
    symlinkSync(path.join(testDir, 'target'), symlink)
    await expect(diagnostics.inspect(symlink)).resolves.toMatchObject({
      file: { status: 'not_regular', sqliteHeader: 'unavailable' },
      sqlite: { status: 'unavailable', reason: 'not_attempted' }
    })
    expect(createChild).not.toHaveBeenCalled()
  })

  it('retains bounded header/size/sidecar facts when SQLite is unavailable', async () => {
    writeFileSync(databaseFile, Buffer.alloc(100, 'x'))
    writeFileSync(`${databaseFile}-wal`, '')
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspect(databaseFile)
    const child = children[0]
    child.emit('message', { type: 'result', result: { status: 'unavailable', reason: 'open_failed' } })
    child.emit('close', 0, null)

    await expect(inspection).resolves.toEqual({
      file: {
        status: 'readable',
        sizeBucket: '1-4095',
        sqliteHeader: 'invalid',
        walPresent: true,
        shmPresent: false
      },
      sqlite: { status: 'unavailable', reason: 'open_failed' }
    })
  })
})

describe('one-shot child lifecycle', () => {
  it('keeps the database path out of spawn arguments and sends it exactly once', async () => {
    writeSqliteHeader()
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspect(databaseFile)
    const child = children[0]

    expect(createChild).toHaveBeenCalledOnce()
    const [modulePath, options] = createChild.mock.calls[0]
    expect(modulePath).toBe('/fixed/migrationDatabaseDiagnosticsChild.js')
    expect(options).toMatchObject({
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
      shell: false,
      env: { ELECTRON_RUN_AS_NODE: '1', CHERRY_MIGRATION_DATABASE_DIAGNOSTICS_CHILD: '1' }
    })
    expect(JSON.stringify([modulePath, options])).not.toContain(databaseFile)
    expect(child.send).toHaveBeenCalledOnce()
    expect(child.send).toHaveBeenCalledWith({ databaseFile }, expect.any(Function))

    child.emit('message', { type: 'result', result: available })
    child.emit('close', 0, null)
    await expect(inspection).resolves.toMatchObject({ sqlite: available })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('waits for clean close after the single valid result and removes listeners', async () => {
    writeSqliteHeader()
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    let settled = false
    const inspection = diagnostics.inspect(databaseFile).then((value) => {
      settled = true
      return value
    })
    const child = children[0]

    child.emit('message', { type: 'result', result: available })
    await Promise.resolve()
    expect(settled).toBe(false)
    child.emit('close', 0, null)

    await inspection
    expect(child.listenerCount('message')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('close')).toBe(0)
    expect(child.stderr.listenerCount('data')).toBe(0)
  })

  it('maps timeout, exit, and invalid output to unavailable without losing file facts', async () => {
    writeSqliteHeader()

    vi.useFakeTimers()
    const timeoutDiagnostics = new MigrationDatabaseDiagnostics({ createChild, timeoutMs: 25 })
    const timedOut = timeoutDiagnostics.inspect(databaseFile)
    const timedOutChild = children[0]
    await vi.advanceTimersByTimeAsync(25)
    await expect(timedOut).resolves.toMatchObject({
      file: { status: 'readable', sqliteHeader: 'valid' },
      sqlite: { status: 'unavailable', reason: 'timeout' }
    })
    expect(timedOutChild.kill).toHaveBeenCalledOnce()
    vi.useRealTimers()

    const exitDiagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const exited = exitDiagnostics.inspect(databaseFile)
    children[1].emit('close', 2, null)
    await expect(exited).resolves.toMatchObject({ sqlite: { status: 'unavailable', reason: 'child_exit' } })

    const invalidDiagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const invalid = invalidDiagnostics.inspect(databaseFile)
    children[2].emit('message', { type: 'step', databaseFile, message: 'private error' })
    await expect(invalid).resolves.toMatchObject({ sqlite: { status: 'unavailable', reason: 'invalid_output' } })
    expect(JSON.stringify(await invalid)).not.toContain(databaseFile)
    expect(children[2].kill).toHaveBeenCalledOnce()
  })

  it('treats a second result as invalid output', async () => {
    writeSqliteHeader()
    const diagnostics = new MigrationDatabaseDiagnostics({ createChild })
    const inspection = diagnostics.inspect(databaseFile)
    const child = children[0]

    child.emit('message', { type: 'result', result: available })
    child.emit('message', { type: 'result', result: available })

    await expect(inspection).resolves.toMatchObject({ sqlite: { status: 'unavailable', reason: 'invalid_output' } })
  })
})
