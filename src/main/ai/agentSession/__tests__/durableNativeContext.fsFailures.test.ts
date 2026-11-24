import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService as logger } from '@test-mocks/MainLoggerService'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { prepareDurableBranch } from '@main/ai/runtime/piDurable/durableContext'
import { serializeError } from '@main/ai/utils/serializeError'

import {
  createDurableBackend,
  openDurableStorage,
  prepareDurableRoot,
  reconcileDurableBackend
} from '../durableNativeContext'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, linkSync: vi.fn(actual.linkSync), renameSync: vi.fn(actual.renameSync) }
})

// Each failure must preserve real entries and either recover a marked store or retain native storage diagnostics.
describe('durable publication filesystem failures', () => {
  const dbh = setupTestDatabase()
  let contextId: string
  let directory: string
  let backend: ReturnType<typeof contexts.backend>
  let target: string
  const real = () => vi.importActual<typeof fs>('node:fs')
  const quarantines = () => fs.readdirSync(directory).filter((name) => name.startsWith('.quarantine-'))
  const sentinel = () => {
    fs.mkdirSync(target)
    fs.writeFileSync(join(target, 'sentinel'), 'keep me')
  }
  const failure = (code: string, syscall = 'link') =>
    Object.assign(new Error(`${code}: injected ${syscall} '${target}'`), {
      code,
      errno: -13,
      syscall,
      path: 'native-source',
      dest: target
    })
  const preservedAside = () => {
    expect(quarantines()).toHaveLength(1)
    expect(fs.readFileSync(join(directory, quarantines()[0], 'occupant', 'sentinel'), 'utf8')).toBe('keep me')
  }
  const markedStore = async () => {
    const storage = await reconcileDurableBackend(backend.id)
    await storage.close(BACKGROUND_CONTEXT)
    expect(contexts.backend(backend.id).state).toBe('bound')
  }
  const assertTerminal = async (error: Error, operation: string, attempt = 'initial') => {
    const stack = error.stack
    await expect(prepareDurableRoot(contextId)).rejects.toBe(error)
    expect(serializeError(error)).toMatchObject({ i18nKey: 'durable_storage_failed', stack })
    expect(error).toMatchObject({ code: expect.any(String), path: 'native-source', dest: target })
    expect(error.message).toContain((error as NodeJS.ErrnoException).code)
    expect(logger.error.mock.calls).toContainEqual([
      'Failed to publish durable store',
      expect.objectContaining({
        backendId: backend.id,
        operation,
        attempt,
        code: (error as NodeJS.ErrnoException).code,
        errno: -13,
        syscall: (error as NodeJS.ErrnoException).syscall,
        sourcePath: expect.stringContaining('store.sqlite'),
        destinationPath: target,
        error
      })
    ])
  }
  beforeEach(async () => {
    directory = fs.mkdtempSync(join(tmpdir(), 'durable-failures-'))
    vi.mocked(application.getPath).mockImplementation((_key, file) => (file ? join(directory, file) : directory))
    const actual = await real()
    vi.mocked(fs.linkSync).mockReset().mockImplementation(actual.linkSync)
    vi.mocked(fs.renameSync).mockReset().mockImplementation(actual.renameSync)
    logger.error.mockClear()
    const workspaceId = uuid()
    const sessionId = uuid()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Work', path: directory, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Durable', orderKey: 'a0' }).run()
    const context = prepareDurableBranch(sessionId)
    contextId = context.id
    backend = contexts.backend(context.backendId)
    if (backend.locator.kind !== 'pi-durable') throw new Error('Expected Durable backend')
    target = join(directory, backend.locator.fileName)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it.each(['EEXIST', 'EISDIR'])('repairs a real directory after initial %s', async (code) => {
    sentinel()
    if (code === 'EISDIR')
      vi.mocked(fs.linkSync).mockImplementationOnce(() => {
        throw failure(code)
      })
    await createDurableBackend(backend.id)
    await markedStore()
    preservedAside()
    expect(fs.lstatSync(target).isFile()).toBe(true)
  })

  it.each(['EACCES', 'EEXIST'])('keeps quarantine rename %s terminal', async (code) => {
    sentinel()
    const error = failure(code, 'rename')
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw error
    })
    await assertTerminal(error, 'rename')
    expect(fs.readFileSync(join(target, 'sentinel'), 'utf8')).toBe('keep me')
    expect(contexts.backend(backend.id).state).toBe('creating')
  })

  it('retains the quarantine after a terminal retry failure', async () => {
    sentinel()
    const actual = await real()
    const error = failure('ENOSPC')
    vi.mocked(fs.linkSync)
      .mockImplementationOnce(actual.linkSync)
      .mockImplementationOnce(() => {
        throw error
      })
    await assertTerminal(error, 'link', 'retry')
    preservedAside()
    expect(fs.existsSync(target)).toBe(false)
    expect(logger.error.mock.calls[0][1]).toMatchObject({
      initialCollision: expect.objectContaining({ code: 'EEXIST' }),
      quarantinePath: expect.any(String)
    })
  })

  it('reuses a valid store that wins the retry without replacing it', async () => {
    await createDurableBackend(backend.id)
    const winner = join(directory, 'winner.sqlite')
    fs.renameSync(target, winner)
    // Reproduce an interrupted binding without changing the valid native marker.
    const actual = await real()
    const db = application.get('DbService').getDb()
    const { agentRuntimeBackendTable } = await import('@data/db/schemas/agentRuntimeBackend')
    const { eq } = await import('drizzle-orm')
    db.update(agentRuntimeBackendTable)
      .set({ state: 'creating' })
      .where(eq(agentRuntimeBackendTable.id, backend.id))
      .run()
    sentinel()
    const bytes = fs.readFileSync(winner)
    vi.mocked(fs.linkSync)
      .mockImplementationOnce(actual.linkSync)
      .mockImplementationOnce((source, destination) => {
        actual.linkSync(winner, destination)
        actual.linkSync(source, destination)
      })
    const root = await prepareDurableRoot(contextId)
    await root.storage.close(BACKGROUND_CONTEXT)
    await markedStore()
    preservedAside()
    expect(fs.readFileSync(target)).toEqual(bytes)
  })

  it('leaves a symlink and its directory referent intact and annotates strict-open failure', async () => {
    const referent = join(directory, 'referent')
    fs.mkdirSync(referent)
    fs.writeFileSync(join(referent, 'sentinel'), 'keep me')
    fs.symlinkSync(referent, target, 'dir')
    await expect(createDurableBackend(backend.id)).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(openDurableStorage(backend)).rejects.toMatchObject({ i18nKey: 'durable_storage_failed' })
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(join(referent, 'sentinel'), 'utf8')).toBe('keep me')
    expect(quarantines()).toEqual([])
  })

  it('annotates a bound store directory failure without repairing its contents', async () => {
    await createDurableBackend(backend.id)
    fs.rmSync(target)
    sentinel()
    await expect(prepareDurableRoot(contextId)).rejects.toMatchObject({ i18nKey: 'durable_storage_failed' })
    expect(contexts.backend(backend.id).state).toBe('bound')
    expect(fs.readFileSync(join(target, 'sentinel'), 'utf8')).toBe('keep me')
    expect(quarantines()).toEqual([])
  })

  it.each(['EACCES', 'ENOSPC'])('annotates terminal initial %s without moving the directory', async (code) => {
    sentinel()
    const error = failure(code)
    vi.mocked(fs.linkSync).mockImplementationOnce(() => {
      throw error
    })
    await assertTerminal(error, 'link')
    expect(fs.readFileSync(join(target, 'sentinel'), 'utf8')).toBe('keep me')
    expect(quarantines()).toEqual([])
  })
})
