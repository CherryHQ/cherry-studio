import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP, DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE } from '@shared/data/types/knowledge'
import { KeyedMutex } from '@shared/utils/async'
import type { PosixRelativeFilePath } from '@shared/utils/file'

const { dataDir, renameMaterialMock } = vi.hoisted(() => ({
  dataDir: `${process.env.TMPDIR ?? '/tmp'}/kb-rename-${process.pid}`,
  renameMaterialMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory({
    KnowledgeVectorStoreService: {
      getIndexStoreIfExists: vi.fn(() => ({ renameMaterial: renameMaterialMock }))
    }
  } as Parameters<typeof mockApplicationFactory>[0])
  mocked.application.getPath = vi.fn((key: string, filename?: string) =>
    key === 'feature.knowledgebase.data' ? dataDir : nodePath.resolve('/mock', key, filename ?? '')
  )
  return mocked
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}))

const { renameKnowledgeFileItem } = await import('../renameItem')

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const PDF_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const OTHER_ID = '0198f3f2-7d1b-7abc-8def-123456789abc'
const NOTE_ID = '0198f3f2-7d1c-7abc-8def-123456789abc'
const fileData = (source: string, relativePath: string, indexedRelativePath?: string) => ({
  source,
  relativePath: relativePath as PosixRelativeFilePath,
  ...(indexedRelativePath && { indexedRelativePath: indexedRelativePath as PosixRelativeFilePath })
})
const rawDir = nodePath.join(dataDir, BASE_ID, 'raw')

describe('renameKnowledgeFileItem', () => {
  const dbh = setupTestDatabase()
  const lock = new KeyedMutex()

  beforeEach(async () => {
    renameMaterialMock.mockReset()
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.mkdirSync(rawDir, { recursive: true })
    fs.writeFileSync(nodePath.join(rawDir, 'paper.pdf'), 'pdf')
    fs.writeFileSync(nodePath.join(rawDir, 'paper.md'), 'markdown')
    fs.writeFileSync(nodePath.join(rawDir, 'other.txt'), 'other')

    const [providerOrderKey, modelOrderKey] = generateOrderKeySequence(2)
    await dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'provider', name: 'Provider', orderKey: providerOrderKey })
    await dbh.db.insert(userModelTable).values({
      id: 'provider::embed',
      providerId: 'provider',
      modelId: 'embed',
      presetModelId: 'embed',
      name: 'embed',
      isEnabled: true,
      isHidden: false,
      orderKey: modelOrderKey
    })
    await dbh.db.insert(knowledgeBaseTable).values({
      orderKey: 'a0',
      id: BASE_ID,
      name: 'KB',
      groupId: null,
      dimensions: 3,
      embeddingModelId: 'provider::embed',
      status: 'completed',
      error: null,
      rerankModelId: null,
      fileProcessorId: 'processor',
      chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
      chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
      documentCount: null
    })
    await dbh.db.insert(knowledgeItemTable).values([
      {
        id: PDF_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'file',
        data: fileData('/home/me/paper.pdf', 'paper.pdf', 'paper.md'),
        status: 'completed',
        error: null
      },
      {
        id: OTHER_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'file',
        data: fileData('/home/me/other.txt', 'other.txt'),
        status: 'completed',
        error: null
      },
      {
        id: NOTE_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'note',
        data: { source: 'note', content: 'hello' },
        status: 'completed',
        error: null
      }
    ])
  })

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  const rename = (itemId: string, name: string) => renameKnowledgeFileItem(lock, BASE_ID, itemId, name)
  const files = () => fs.readdirSync(rawDir).sort()

  it('renames the file, its processed artifact, the row and the index material together', async () => {
    await rename(PDF_ID, 'Q4 report.pdf')

    expect(files()).toEqual(['Q4 report.md', 'Q4 report.pdf', 'other.txt'])
    expect(fs.readFileSync(nodePath.join(rawDir, 'Q4 report.pdf'), 'utf8')).toBe('pdf')
    const item = knowledgeItemService.getById(PDF_ID)
    expect(item.status).toBe('completed')
    expect(item.data).toEqual({
      source: '/home/me/paper.pdf',
      relativePath: 'Q4 report.pdf',
      indexedRelativePath: 'Q4 report.md'
    })
    expect(renameMaterialMock).toHaveBeenCalledWith(PDF_ID, 'Q4 report.md')
  })

  it('treats a case-only change as a rename of the same file', async () => {
    await rename(OTHER_ID, 'Other.TXT')

    expect(files()).toContain('Other.TXT')
    expect(knowledgeItemService.getById(OTHER_ID).data).toMatchObject({ relativePath: 'Other.TXT' })
  })

  it.each([
    ['empty', '   ', 'cannot be empty'],
    ['too long', `${'a'.repeat(252)}.txt`, 'too long'],
    ['a Windows reserved name', 'CON.txt', 'not allowed'],
    ['a Windows forbidden character', 'a:b.txt', 'not allowed'],
    ['a trailing dot', 'name..txt.', 'not allowed'],
    ['a path separator', 'sub/dir.txt', 'not allowed'],
    ['a changed extension', 'other.pdf', 'extension'],
    ['a dropped extension', 'other', 'extension']
  ])('rejects %s before touching anything', async (_label, name, message) => {
    await expect(rename(OTHER_ID, name)).rejects.toThrow(new RegExp(message))

    expect(files()).toEqual(['other.txt', 'paper.md', 'paper.pdf'])
    expect(knowledgeItemService.getById(OTHER_ID).data).toMatchObject({ relativePath: 'other.txt' })
    expect(renameMaterialMock).not.toHaveBeenCalled()
  })

  it('rejects a name already used by another item, case-insensitively', async () => {
    fs.writeFileSync(nodePath.join(rawDir, 'dup.txt'), 'dup')
    await dbh.db.insert(knowledgeItemTable).values({
      id: '0198f3f2-7d1d-7abc-8def-123456789abc',
      baseId: BASE_ID,
      groupId: null,
      type: 'file',
      data: fileData('/home/me/dup.txt', 'dup.txt'),
      status: 'completed',
      error: null
    })

    await expect(rename(OTHER_ID, 'DUP.txt')).rejects.toThrow(/already exists/)
    expect(files()).toContain('other.txt')
  })

  it("rejects a name that would take another file's processed artifact", async () => {
    fs.writeFileSync(nodePath.join(rawDir, 'note.md'), 'md')
    await dbh.db
      .update(knowledgeItemTable)
      .set({ data: fileData('/home/me/note.md', 'note.md') })
      .where(eq(knowledgeItemTable.id, OTHER_ID))

    await expect(rename(OTHER_ID, 'PAPER.md')).rejects.toThrow(/already exists/)
  })

  it('rejects an in-flight file and a non-file item', async () => {
    await dbh.db.update(knowledgeItemTable).set({ status: 'embedding' }).where(eq(knowledgeItemTable.id, OTHER_ID))

    await expect(rename(OTHER_ID, 'new.txt')).rejects.toThrow(/indexing has finished/)
    await expect(rename(NOTE_ID, 'new.txt')).rejects.toThrow(/Only files/)
  })

  it('leaves the original name in place when the filesystem rename fails', async () => {
    const realRename = fsp.rename.bind(fsp)
    const spy = vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('.md')) {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
      return realRename(from, to)
    })

    await expect(rename(PDF_ID, 'renamed.pdf')).rejects.toThrow(/could not be renamed \(EBUSY\)/)
    spy.mockRestore()

    expect(files()).toEqual(['other.txt', 'paper.md', 'paper.pdf'])
    expect(knowledgeItemService.getById(PDF_ID).data).toMatchObject({
      relativePath: 'paper.pdf',
      indexedRelativePath: 'paper.md'
    })
    expect(renameMaterialMock).not.toHaveBeenCalled()
  })

  it('rolls the row and files back when the index update fails', async () => {
    renameMaterialMock.mockImplementationOnce(() => {
      throw new Error('index locked')
    })

    await expect(rename(PDF_ID, 'renamed.pdf')).rejects.toThrow('index locked')

    expect(files()).toEqual(['other.txt', 'paper.md', 'paper.pdf'])
    expect(knowledgeItemService.getById(PDF_ID).data).toMatchObject({
      relativePath: 'paper.pdf',
      indexedRelativePath: 'paper.md'
    })
  })
})
