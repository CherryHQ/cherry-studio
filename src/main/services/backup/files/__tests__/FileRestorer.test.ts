import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { ConflictStrategy } from '@shared/backup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn().mockImplementation((key: string) => {
      if (key === 'feature.files.data') return '/tmp/test-live-files'
      if (key === 'feature.knowledgebase.data') return '/tmp/test-live-kb'
      return '/tmp/test'
    })
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('FileRestorer', () => {
  let FileRestorer: typeof import('../FileRestorer').FileRestorer
  let tmpDir: string
  let liveDir: string

  const createMockTracker = () => ({
    incrementItemsProcessed: vi.fn(),
    setPhase: vi.fn(),
    setDomain: vi.fn(),
    setTotals: vi.fn()
  })

  const createMockToken = () => ({
    isCancelled: false,
    cancel: vi.fn(),
    throwIfCancelled: vi.fn()
  })

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'filerestorer-test-'))
    liveDir = path.join(tmpDir, 'live')
    const extractDir = path.join(tmpDir, 'extract')
    const filesDir = path.join(extractDir, 'files')
    await fsp.mkdir(filesDir, { recursive: true })
    await fsp.mkdir(liveDir, { recursive: true })

    const { application } = await import('@application')
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'feature.files.data') return liveDir
      return liveDir
    })

    const mod = await import('../FileRestorer')
    FileRestorer = mod.FileRestorer
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('OVERWRITE replaces files even when sizes match', async () => {
    const extractDir = path.join(tmpDir, 'extract')
    const filesDir = path.join(extractDir, 'files')

    await fsp.writeFile(path.join(filesDir, 'a.txt'), 'NEW!')
    await fsp.writeFile(path.join(liveDir, 'a.txt'), 'OLD!')

    const srcStat = await fsp.stat(path.join(filesDir, 'a.txt'))
    const tgtStat = await fsp.stat(path.join(liveDir, 'a.txt'))
    expect(srcStat.size).toBe(tgtStat.size)

    const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
    const result = await restorer.restoreFiles(ConflictStrategy.OVERWRITE)

    expect(result.restored).toBe(1)
    expect(result.skipped).toBe(0)
    const content = await fsp.readFile(path.join(liveDir, 'a.txt'), 'utf-8')
    expect(content).toBe('NEW!')
  })

  it('SKIP skips existing files', async () => {
    const extractDir = path.join(tmpDir, 'extract')
    const filesDir = path.join(extractDir, 'files')

    await fsp.writeFile(path.join(filesDir, 'a.txt'), 'NEW!')
    await fsp.writeFile(path.join(liveDir, 'a.txt'), 'OLD!')

    const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
    const result = await restorer.restoreFiles(ConflictStrategy.SKIP)

    expect(result.restored).toBe(0)
    expect(result.skipped).toBe(1)
    const content = await fsp.readFile(path.join(liveDir, 'a.txt'), 'utf-8')
    expect(content).toBe('OLD!')
  })

  it('restores new files that do not exist in target', async () => {
    const extractDir = path.join(tmpDir, 'extract')
    const filesDir = path.join(extractDir, 'files')

    await fsp.writeFile(path.join(filesDir, 'b.txt'), 'BRAND NEW')

    const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
    const result = await restorer.restoreFiles(ConflictStrategy.SKIP)

    expect(result.restored).toBe(1)
    const content = await fsp.readFile(path.join(liveDir, 'b.txt'), 'utf-8')
    expect(content).toBe('BRAND NEW')
  })

  it('returns zero counts when files directory does not exist', async () => {
    const emptyExtract = path.join(tmpDir, 'empty-extract')
    await fsp.mkdir(emptyExtract, { recursive: true })

    const restorer = new FileRestorer(emptyExtract, createMockTracker() as never, createMockToken() as never)
    const result = await restorer.restoreFiles(ConflictStrategy.OVERWRITE)

    expect(result).toEqual({ restored: 0, skipped: 0 })
  })
})
