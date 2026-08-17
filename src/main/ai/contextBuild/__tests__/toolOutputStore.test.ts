import { createHash } from 'node:crypto'
import { readFile as readFsFile } from 'node:fs/promises'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { BaseService } from '@main/core/lifecycle'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() }
}))
vi.mock('electron', () => electronMocks)

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileManager } = await import('@main/services/file/FileManager')
const {
  computeVfsFilename,
  extractPersistableText,
  inflateEntities,
  persistToolOutputText,
  reconstructOutput,
  spliceTextAtKey
} = await import('../toolOutputStore')

const BIG_TEXT = Array.from({ length: 200 }, (_, i) => `log line ${i + 1} — lorem ipsum dolor sit amet`).join('\n')

describe('toolOutputStore', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let internalRoot: string
  let fm: InstanceType<typeof FileManager>

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainCacheServiceUtils.resetMocks()
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-tool-output-'))
    internalRoot = path.join(tmp, 'files-internal')
    await mkdir(internalRoot, { recursive: true })
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(internalRoot, filename) : internalRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    BaseService.resetInstances()
    fm = new FileManager()
    const container = application.getContainer()
    vi.mocked(application.get).mockImplementation((name: string) => (name === 'FileManager' ? fm : container.get(name)))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  describe('persistToolOutputText', () => {
    it('creates a delete_when_unreferenced txt entry holding the exact bytes', async () => {
      const { entry, vfsFilename } = await persistToolOutputText(BIG_TEXT)

      expect(entry.origin).toBe('internal')
      expect(entry.cleanupPolicy).toBe('delete_when_unreferenced')
      expect(entry.ext).toBe('txt')
      expect(entry.name).toBe(vfsFilename.replace(/\.txt$/, ''))
      expect(vfsFilename).toMatch(/^vfs_[a-f0-9]{16}\.txt$/)

      const onDisk = await readFsFile(path.join(internalRoot, `${entry.id}.txt`), 'utf8')
      expect(onDisk).toBe(BIG_TEXT)
    })

    it('dedups by content hash: same text reuses the entry, different text creates a new one', async () => {
      const first = await persistToolOutputText(BIG_TEXT)
      const second = await persistToolOutputText(BIG_TEXT)
      const other = await persistToolOutputText(`${BIG_TEXT}!`)

      expect(second.entry.id).toBe(first.entry.id)
      expect(other.entry.id).not.toBe(first.entry.id)
      const rows = await dbh.db.select().from(fileEntryTable)
      expect(rows).toHaveLength(2)
    })

    it('never adopts a colliding entry it could not have written (manual policy)', async () => {
      const manual = await fm.createInternalEntry({
        source: 'bytes',
        data: Buffer.from(BIG_TEXT, 'utf8'),
        name: 'user-upload',
        ext: 'txt',
        cleanupPolicy: 'manual'
      })

      const { entry } = await persistToolOutputText(BIG_TEXT)
      expect(entry.id).not.toBe(manual.id)
      expect(entry.cleanupPolicy).toBe('delete_when_unreferenced')
    })

    it('names entries with the sha256[:16] formula the in-flight offloader uses', () => {
      // The offloader side of this contract is pinned in
      // packages/aiCore/src/core/context/__tests__/offloader.test.ts.
      const sha = createHash('sha256').update(BIG_TEXT, 'utf8').digest('hex').slice(0, 16)
      expect(computeVfsFilename(BIG_TEXT)).toBe(`vfs_${sha}.txt`)
    })
  })

  describe('extractPersistableText', () => {
    it('accepts plain string outputs', () => {
      expect(extractPersistableText('hello')).toEqual({ text: 'hello', shape: 'text' })
    })

    it('accepts all-text MCP content and joins with newline (mcpResultToTextSummary parity)', () => {
      const metadata = { serverId: 's1', serverName: 'files', type: 'mcp' }
      const out = extractPersistableText({
        content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text' }],
        metadata
      })
      expect(out).toEqual({ text: 'a\nb\n', shape: 'mcp-content', metadata })
    })

    it('rejects everything reconstruction could not rebuild faithfully', () => {
      expect(extractPersistableText(null)).toBeNull()
      expect(extractPersistableText(42)).toBeNull()
      expect(extractPersistableText(['a'])).toBeNull()
      expect(extractPersistableText({ content: [] })).toBeNull()
      expect(extractPersistableText({ content: [{ type: 'image', data: 'x' }] })).toBeNull()
      expect(extractPersistableText({ content: [{ type: 'text', text: 'x' }], isError: true })).toBeNull()
      expect(extractPersistableText({ content: [{ type: 'text', text: 'x' }], structuredContent: { a: 1 } })).toBeNull()
      expect(extractPersistableText({ content: [{ type: 'text', text: 1 }] })).toBeNull()
    })
  })

  describe('reconstructOutput', () => {
    const baseRef = {
      fileEntryId: 'e1',
      vfsFilename: 'vfs_0123456789abcdef.txt',
      head: '',
      tail: '',
      totalChars: 5,
      totalLines: 1
    } as const

    it('rebuilds a string output', () => {
      expect(reconstructOutput({ ...baseRef, shape: 'text' }, 'hello')).toBe('hello')
    })

    it('rebuilds an MCP envelope whose extracted text round-trips', () => {
      const metadata = { serverId: 's1' }
      const rebuilt = reconstructOutput({ ...baseRef, shape: 'mcp-content', metadata }, 'a\nb')
      expect(rebuilt).toEqual({ content: [{ type: 'text', text: 'a\nb' }], metadata })
      expect(extractPersistableText(rebuilt)).toEqual({ text: 'a\nb', shape: 'mcp-content', metadata })
    })

    it('omits metadata when the envelope carried none', () => {
      expect(reconstructOutput({ ...baseRef, shape: 'mcp-content' }, 'x')).toEqual({
        content: [{ type: 'text', text: 'x' }]
      })
    })
  })

  describe('spliceTextAtKey', () => {
    it('replaces an array item field preserving key insertion order and sibling references', () => {
      const items = [
        { id: 'a', title: 'A', content: 'alpha' },
        { id: 'b', title: 'B', content: 'beta' }
      ]
      const spliced = spliceTextAtKey(items, '/0/content', 'SPLICED') as Array<Record<string, unknown>>
      expect(Object.keys(spliced[0])).toEqual(['id', 'title', 'content'])
      expect(spliced[0].content).toBe('SPLICED')
      expect(spliced[1]).toBe(items[1])
      expect(items[0].content).toBe('alpha')
    })

    it('replaces a top-level record field', () => {
      const output = { kind: 'text', text: 'body', totalLines: 2 }
      const spliced = spliceTextAtKey(output, '/text', 'SPLICED') as Record<string, unknown>
      expect(Object.keys(spliced)).toEqual(['kind', 'text', 'totalLines'])
      expect(spliced.text).toBe('SPLICED')
    })

    it.each([
      ['empty key', [{ content: 'x' }], ''],
      ['out-of-range index', [{ content: 'x' }], '/9/content'],
      ['missing field', [{ content: 'x' }], '/0/other'],
      ['non-array skeleton with indexed key', { content: 'x' }, '/0/content'],
      ['non-record item', ['plain'], '/0/content']
    ])('leaves the skeleton untouched for %s', (_label, skeleton, key) => {
      expect(spliceTextAtKey(skeleton, key, 'SPLICED')).toBe(skeleton)
    })
  })

  describe('inflateEntities', () => {
    it('splices each known blob text into the skeleton and skips missing keys', () => {
      const ref = {
        shape: 'entities' as const,
        skeleton: [
          { id: 'a', content: 'snippet-a' },
          { id: 'b', content: 'snippet-b' }
        ],
        blobRefs: [
          { key: '/0/content', fileEntryId: 'e1', vfsFilename: 'v1', head: '', tail: '', totalChars: 1, totalLines: 1 },
          { key: '/1/content', fileEntryId: 'e2', vfsFilename: 'v2', head: '', tail: '', totalChars: 1, totalLines: 1 }
        ]
      }
      const inflated = inflateEntities(ref, { '/0/content': 'FULL A' }) as Array<Record<string, unknown>>
      expect(inflated[0].content).toBe('FULL A')
      expect(inflated[1].content).toBe('snippet-b')
    })
  })
})
