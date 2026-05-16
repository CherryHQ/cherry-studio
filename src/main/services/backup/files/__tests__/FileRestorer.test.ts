import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { ConflictStrategy } from '@shared/backup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileRestorer as FileRestorerClass } from '../FileRestorer'

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn()
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
  let FileRestorer: typeof FileRestorerClass
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

  it('skips files when name and size match (spec §7.3)', async () => {
    const extractDir = path.join(tmpDir, 'extract')
    const filesDir = path.join(extractDir, 'files')

    await fsp.writeFile(path.join(filesDir, 'a.txt'), 'NEW!')
    await fsp.writeFile(path.join(liveDir, 'a.txt'), 'OLD!')

    const srcStat = await fsp.stat(path.join(filesDir, 'a.txt'))
    const tgtStat = await fsp.stat(path.join(liveDir, 'a.txt'))
    expect(srcStat.size).toBe(tgtStat.size)

    const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
    const result = await restorer.restoreFiles(ConflictStrategy.OVERWRITE)

    // Same name + same size → skip regardless of strategy
    expect(result.restored).toBe(0)
    expect(result.skipped).toBe(1)
    const content = await fsp.readFile(path.join(liveDir, 'a.txt'), 'utf-8')
    expect(content).toBe('OLD!')
  })

  it('OVERWRITE replaces files when sizes differ', async () => {
    const extractDir = path.join(tmpDir, 'extract')
    const filesDir = path.join(extractDir, 'files')

    await fsp.writeFile(path.join(filesDir, 'a.txt'), 'NEW CONTENT!')
    await fsp.writeFile(path.join(liveDir, 'a.txt'), 'OLD!')

    const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
    const result = await restorer.restoreFiles(ConflictStrategy.OVERWRITE)

    expect(result.restored).toBe(1)
    expect(result.skipped).toBe(0)
    const content = await fsp.readFile(path.join(liveDir, 'a.txt'), 'utf-8')
    expect(content).toBe('NEW CONTENT!')
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

  describe('restoreKnowledgeBases', () => {
    let kbLiveDir: string

    beforeEach(async () => {
      kbLiveDir = path.join(tmpDir, 'kb-live')
      await fsp.mkdir(kbLiveDir, { recursive: true })

      const { application } = await import('@application')
      vi.mocked(application.getPath).mockImplementation((key: string) => {
        if (key === 'feature.files.data') return liveDir
        if (key === 'feature.knowledgebase.data') return kbLiveDir
        return liveDir
      })

      const mod = await import('../FileRestorer')
      FileRestorer = mod.FileRestorer
    })

    it('restores new KB directories', async () => {
      const extractDir = path.join(tmpDir, 'extract')
      const kbDir = path.join(extractDir, 'knowledge', 'kb-1')
      await fsp.mkdir(kbDir, { recursive: true })
      await fsp.writeFile(path.join(kbDir, 'data.db'), 'vector-data')

      const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
      const result = await restorer.restoreKnowledgeBases(ConflictStrategy.OVERWRITE)

      expect(result.restored).toBe(1)
      expect(result.skipped).toBe(0)
      const content = await fsp.readFile(path.join(kbLiveDir, 'kb-1', 'data.db'), 'utf-8')
      expect(content).toBe('vector-data')
    })

    it('skips KB directories when total byte size matches', async () => {
      const extractDir = path.join(tmpDir, 'extract')
      const kbDir = path.join(extractDir, 'knowledge', 'kb-1')
      await fsp.mkdir(kbDir, { recursive: true })
      await fsp.writeFile(path.join(kbDir, 'data.db'), 'AAAA')

      const liveKbDir = path.join(kbLiveDir, 'kb-1')
      await fsp.mkdir(liveKbDir, { recursive: true })
      await fsp.writeFile(path.join(liveKbDir, 'data.db'), 'BBBB')

      const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
      const result = await restorer.restoreKnowledgeBases(ConflictStrategy.OVERWRITE)

      // Same total byte size → skip
      expect(result.skipped).toBe(1)
      expect(result.restored).toBe(0)
      const content = await fsp.readFile(path.join(kbLiveDir, 'kb-1', 'data.db'), 'utf-8')
      expect(content).toBe('BBBB')
    })

    it('overwrites KB directories when sizes differ', async () => {
      const extractDir = path.join(tmpDir, 'extract')
      const kbDir = path.join(extractDir, 'knowledge', 'kb-1')
      await fsp.mkdir(kbDir, { recursive: true })
      await fsp.writeFile(path.join(kbDir, 'data.db'), 'LARGER DATA')

      const liveKbDir = path.join(kbLiveDir, 'kb-1')
      await fsp.mkdir(liveKbDir, { recursive: true })
      await fsp.writeFile(path.join(liveKbDir, 'data.db'), 'SM')

      const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
      const result = await restorer.restoreKnowledgeBases(ConflictStrategy.OVERWRITE)

      expect(result.restored).toBe(1)
      const content = await fsp.readFile(path.join(kbLiveDir, 'kb-1', 'data.db'), 'utf-8')
      expect(content).toBe('LARGER DATA')
    })

    it('skips existing KB directories with SKIP strategy', async () => {
      const extractDir = path.join(tmpDir, 'extract')
      const kbDir = path.join(extractDir, 'knowledge', 'kb-1')
      await fsp.mkdir(kbDir, { recursive: true })
      await fsp.writeFile(path.join(kbDir, 'data.db'), 'X')

      const liveKbDir = path.join(kbLiveDir, 'kb-1')
      await fsp.mkdir(liveKbDir, { recursive: true })
      await fsp.writeFile(path.join(liveKbDir, 'data.db'), 'Y')

      const restorer = new FileRestorer(extractDir, createMockTracker() as never, createMockToken() as never)
      const result = await restorer.restoreKnowledgeBases(ConflictStrategy.SKIP)

      expect(result.skipped).toBe(1)
      expect(result.restored).toBe(0)
    })

    it('returns zero when knowledge directory does not exist', async () => {
      const emptyExtract = path.join(tmpDir, 'empty-extract')
      await fsp.mkdir(emptyExtract, { recursive: true })

      const restorer = new FileRestorer(emptyExtract, createMockTracker() as never, createMockToken() as never)
      const result = await restorer.restoreKnowledgeBases(ConflictStrategy.OVERWRITE)

      expect(result).toEqual({ restored: 0, skipped: 0 })
    })
  })
})
