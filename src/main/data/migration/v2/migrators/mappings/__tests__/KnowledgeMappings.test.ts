import { assertSafeKnowledgeRelativePath, CHERRY_META_DIR } from '@main/features/knowledge'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED,
  KNOWLEDGE_NOTE_CONTENT_MAX
} from '@shared/data/types/knowledge'
import { FILE_TYPE } from '@shared/types/file'
import { describe, expect, it } from 'vitest'

import { legacyModelToUniqueId } from '../../transformers/ModelTransformers'
import {
  expandLegacyDirectoryItem,
  inferKnowledgeItemStatus,
  transformKnowledgeBase,
  transformKnowledgeItem
} from '../KnowledgeMappings'

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUIDV4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const LEGACY_FILE_ID = '019606a0-0000-7000-8000-000000000101'

// Keep the filename-bearing fields distinct so each assertion below can independently tell
// where a value came from: `id`+`ext` (the v1 storage name `{id}{ext}`) feeds
// `fileCopy.storageNames`, `origin_name` (user-facing) feeds `relativePath`, `path` (stale column)
// feeds `data.source`, and `name` is a deliberate DISTRACTOR that must NOT feed storageNames
// (v1's dedup path emits a malformed double-extension `name`). A crossed wiring fails the asserts.
const fileMetadata = {
  id: LEGACY_FILE_ID,
  name: 'stored-019606a0.pdf',
  origin_name: 'report.pdf',
  path: '/tmp/source-on-disk.pdf',
  size: 128,
  ext: '.pdf',
  type: FILE_TYPE.DOCUMENT,
  created_at: '2025-01-01T00:00:00.000Z',
  count: 1
}

describe('KnowledgeMappings', () => {
  it('legacyModelToUniqueId builds provider::modelId and preserves precomposed ids', () => {
    expect(legacyModelToUniqueId({ id: 'BAAI/bge-m3', provider: 'silicon' })).toBe('silicon::BAAI/bge-m3')
    expect(legacyModelToUniqueId({ id: 'silicon::BAAI/bge-m3', provider: 'silicon' })).toBe('silicon::BAAI/bge-m3')
  })

  it('inferKnowledgeItemStatus maps legacy transient states to failed', () => {
    expect(inferKnowledgeItemStatus({ uniqueId: 'loader-1' } as any)).toBe('completed')
    expect(inferKnowledgeItemStatus({ uniqueId: '   ' } as any)).toBe('idle')
    expect(inferKnowledgeItemStatus({ processingStatus: 'pending' } as any)).toBe('failed')
    expect(inferKnowledgeItemStatus({ processingStatus: 'processing' } as any)).toBe('failed')
    expect(inferKnowledgeItemStatus({ processingStatus: 'failed', uniqueId: 'loader-1' } as any)).toBe('failed')
    expect(inferKnowledgeItemStatus({} as any)).toBe('idle')
  })

  it('transformKnowledgeBase marks knowledge bases without an embedding model as failed', () => {
    expect(
      transformKnowledgeBase(
        {
          id: 'kb-1',
          name: 'KB 1'
        },
        1024
      )
    ).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        id: expect.stringMatching(UUIDV4_PATTERN),
        embeddingModelId: null,
        status: 'failed',
        error: KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
      })
    })
  })

  it('transformKnowledgeBase falls back to the v1 base id for an all-whitespace name', () => {
    // Write-side guard only checked `name !== ''`, but the read path
    // (KnowledgeBaseSchema `name: trim().min(1)`) rejects whitespace-only
    // names — one such row used to poison the whole list query.
    const warnings: string[] = []
    expect(
      transformKnowledgeBase(
        {
          id: 'kb-blank-name',
          name: '   '
        },
        1024,
        (msg) => warnings.push(msg)
      )
    ).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        name: 'kb-blank-name'
      })
    })
    // The fallback leaves a diagnostic trail in the migration log.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('kb-blank-name')
    expect(warnings[0]).toContain('blank v1 name')
  })

  it('transformKnowledgeBase trims surrounding whitespace from a valid name', () => {
    expect(
      transformKnowledgeBase(
        {
          id: 'kb-padded-name',
          name: '  My KB  '
        },
        1024
      )
    ).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        name: 'My KB'
      })
    })
  })

  it('transformKnowledgeBase fills default chunk config when legacy values are missing', () => {
    expect(
      transformKnowledgeBase(
        {
          id: 'kb-default-config',
          name: 'KB default config',
          model: { id: 'BAAI/bge-m3', name: 'bge', provider: 'silicon' }
        },
        1024
      )
    ).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        chunkSize: 1024,
        chunkOverlap: 200
      })
    })
  })

  it('transformKnowledgeBase keeps default overlap below a preserved small chunk size', () => {
    expect(
      transformKnowledgeBase(
        {
          id: 'kb-small-chunk',
          name: 'KB small chunk',
          model: { id: 'BAAI/bge-m3', name: 'bge', provider: 'silicon' },
          chunkSize: 128
        },
        1024
      )
    ).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        chunkSize: 128,
        chunkOverlap: 127
      })
    })
  })

  it('transformKnowledgeBase preserves positive config values outside recommended UI ranges', () => {
    expect(
      transformKnowledgeBase(
        {
          id: 'kb-soft-limit-config',
          name: 'KB soft limit config',
          model: { id: 'BAAI/bge-m3', name: 'bge', provider: 'silicon' },
          chunkSize: 80,
          chunkOverlap: 40,
          threshold: 0.6,
          documentCount: 100
        },
        1024
      )
    ).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        id: expect.stringMatching(UUIDV4_PATTERN),
        name: 'KB soft limit config',
        embeddingModelId: 'silicon::BAAI/bge-m3',
        chunkSize: 80,
        chunkOverlap: 40,
        threshold: 0.6,
        documentCount: 100
      })
    })
  })

  it('transformKnowledgeBase normalizes invalid tuning config instead of skipping the base', () => {
    expect(
      transformKnowledgeBase(
        {
          id: 'kb-invalid-config',
          name: 'KB invalid config',
          model: { id: 'BAAI/bge-m3', name: 'bge', provider: 'silicon' },
          chunkSize: 200,
          chunkOverlap: 200,
          threshold: 2,
          documentCount: 0
        },
        1024
      )
    ).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        id: expect.stringMatching(UUIDV4_PATTERN),
        name: 'KB invalid config',
        embeddingModelId: 'silicon::BAAI/bge-m3',
        chunkSize: 200,
        chunkOverlap: 199,
        threshold: undefined,
        documentCount: undefined
      })
    })
  })

  it('transformKnowledgeBase writes split rerank model columns', () => {
    const result = transformKnowledgeBase(
      {
        id: 'kb-rerank',
        name: 'KB with rerank',
        model: { id: 'BAAI/bge-m3', name: 'bge', provider: 'silicon' },
        rerankModel: { id: 'BAAI/bge-reranker', name: 'reranker', provider: 'silicon' }
      },
      1024
    )

    expect(result).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        embeddingModelId: 'silicon::BAAI/bge-m3',
        rerankModelId: 'silicon::BAAI/bge-reranker'
      })
    })
  })

  it('transformKnowledgeBase sets rerank columns to null when no rerank model', () => {
    const result = transformKnowledgeBase(
      {
        id: 'kb-no-rerank',
        name: 'KB no rerank',
        model: { id: 'BAAI/bge-m3', name: 'bge', provider: 'silicon' }
      },
      1024
    )

    expect(result).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        rerankModelId: null
      })
    })
  })

  it('transformKnowledgeItem prefers Dexie note content over Redux fallback', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'note-1',
        type: 'note',
        content: 'redux-content',
        sourceUrl: 'https://redux.example.com'
      },
      {
        noteById: new Map([
          [
            'note-1',
            {
              id: 'note-1',
              content: 'dexie-content',
              sourceUrl: 'https://dexie.example.com'
            }
          ]
        ]),
        filesById: new Map()
      }
    )

    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: expect.stringMatching(UUIDV7_PATTERN),
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: {
          source: 'https://dexie.example.com',
          content: 'dexie-content'
        },
        status: 'idle',
        error: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      }
    })
  })

  it('transformKnowledgeItem keeps note content unchanged when within the read-side max', () => {
    const warnings: string[] = []
    const content = 'short note body'
    const result = transformKnowledgeItem(
      'kb-1',
      { id: 'note-1', type: 'note', content, sourceUrl: 'https://example.com' },
      { noteById: new Map(), filesById: new Map() },
      (message) => warnings.push(message)
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.data).toMatchObject({ content })
    expect(warnings).toEqual([])
  })

  it('transformKnowledgeItem clamps over-long note content to the read-side max and warns', () => {
    // v1 notes had no length cap; the v2 read path enforces .max(KNOWLEDGE_NOTE_CONTENT_MAX), so a
    // longer note would parse-fail and poison the whole base's item-list query. It must be
    // truncated (not dropped) and the truncation surfaced as a warning.
    const warnings: string[] = []
    const content = 'a'.repeat(KNOWLEDGE_NOTE_CONTENT_MAX + 10)
    const result = transformKnowledgeItem(
      'kb-1',
      { id: 'note-long', type: 'note', content, sourceUrl: 'https://example.com' },
      { noteById: new Map(), filesById: new Map() },
      (message) => warnings.push(message)
    )

    expect(result.ok).toBe(true)
    if (!result.ok || !('content' in result.value.data)) throw new Error('expected a note result')
    expect(result.value.data.content).toHaveLength(KNOWLEDGE_NOTE_CONTENT_MAX)
    expect(result.value.data.content).toBe('a'.repeat(KNOWLEDGE_NOTE_CONTENT_MAX))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('note-long')
    expect(warnings[0]).toContain('truncated')
  })

  it('transformKnowledgeItem keeps note content exactly at the max without warning (boundary)', () => {
    const warnings: string[] = []
    const content = 'b'.repeat(KNOWLEDGE_NOTE_CONTENT_MAX)
    const result = transformKnowledgeItem(
      'kb-1',
      { id: 'note-exact', type: 'note', content, sourceUrl: 'https://example.com' },
      { noteById: new Map(), filesById: new Map() },
      (message) => warnings.push(message)
    )

    expect(result.ok).toBe(true)
    if (!result.ok || !('content' in result.value.data)) throw new Error('expected a note result')
    expect(result.value.data.content).toHaveLength(KNOWLEDGE_NOTE_CONTENT_MAX)
    expect(warnings).toEqual([])
  })

  it('transformKnowledgeItem skips a note with neither sourceUrl nor content', () => {
    // Sibling branches (file/url/directory) all guard their source, but the
    // note branch let `source: ''` through — the read path requires
    // `source: trim().min(1)` and one such row breaks the item list query.
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'note-empty',
        type: 'note',
        content: ''
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toStrictEqual({ ok: false, reason: 'invalid_note' })
  })

  it('transformKnowledgeItem skips a note whose content is whitespace-only', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'note-blank',
        type: 'note',
        content: '  \n  '
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toStrictEqual({ ok: false, reason: 'invalid_note' })
  })

  it('transformKnowledgeItem keeps a note that has a sourceUrl but empty content', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'note-url-only',
        type: 'note',
        content: '',
        sourceUrl: 'https://example.com/origin'
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        type: 'note',
        data: {
          source: 'https://example.com/origin',
          content: ''
        }
      })
    })
  })

  it('transformKnowledgeItem keeps a note with an empty-string sourceUrl but non-empty content', () => {
    // The source chain must use `||`, not `??`: an empty-string sourceUrl
    // would short-circuit a nullish chain and get a recoverable note
    // dropped as invalid_note despite its non-empty content.
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'note-blank-url',
        type: 'note',
        content: 'recoverable body',
        sourceUrl: ''
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        type: 'note',
        data: {
          source: 'recoverable body',
          content: 'recoverable body'
        }
      })
    })
  })

  it('transformKnowledgeItem resolves file metadata by file id fallback', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'file-item-1',
        type: 'file',
        content: LEGACY_FILE_ID,
        uniqueId: 'loader-1'
      },
      {
        noteById: new Map(),
        filesById: new Map([[LEGACY_FILE_ID, fileMetadata]])
      }
    )

    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: expect.stringMatching(UUIDV7_PATTERN),
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: {
          source: '/tmp/source-on-disk.pdf',
          relativePath: 'report.pdf'
        },
        status: 'completed',
        error: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      },
      fileCopy: { storageNames: [`${LEGACY_FILE_ID}.pdf`] }
    })
  })

  it('transformKnowledgeItem falls back to the storage name when origin_name is blank', () => {
    // A blank origin_name short-circuits sanitizeFilename to '' (before its
    // 'untitled' guard). A blank relativePath fails the read path
    // (FileItemDataSchema `.min(1)`) and poisons the whole base's item list —
    // degrade to the storage name (keeps the extension) like FileMigrator does.
    const warnings: string[] = []
    const blankOriginFile = {
      ...fileMetadata,
      name: 'stored-019606a0.pdf',
      origin_name: ''
    }
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'file-blank-name',
        type: 'file',
        content: LEGACY_FILE_ID
      },
      {
        noteById: new Map(),
        filesById: new Map([[LEGACY_FILE_ID, blankOriginFile]])
      },
      (msg) => warnings.push(msg)
    )

    expect(result).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        type: 'file',
        data: {
          source: '/tmp/source-on-disk.pdf',
          relativePath: 'stored-019606a0.pdf'
        }
      }),
      fileCopy: { storageNames: [`${LEGACY_FILE_ID}.pdf`] }
    })
    // The fallback leaves a diagnostic trail in the migration log.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('file-blank-name')
    expect(warnings[0]).toContain('blank v1 filename')
  })

  it('transformKnowledgeItem reports a filename lost by the v1 duplicate-upload bug', () => {
    // v1 FileStorage.findDuplicateFile overwrote origin_name with the storage name on a second
    // upload of the same bytes. The name is unrecoverable, so the item migrates under the id —
    // but silently showing it as if the user had chosen it is what this warning prevents.
    const warnings: string[] = []
    const dedupedFile = {
      ...fileMetadata,
      name: `${LEGACY_FILE_ID}.pdf.pdf`,
      origin_name: `${LEGACY_FILE_ID}.pdf`
    }
    const result = transformKnowledgeItem(
      'kb-1',
      { id: 'file-lost-name', type: 'file', content: LEGACY_FILE_ID },
      { noteById: new Map(), filesById: new Map([[LEGACY_FILE_ID, dedupedFile]]) },
      (msg) => warnings.push(msg)
    )

    expect(result.ok && result.value.data).toStrictEqual({
      source: '/tmp/source-on-disk.pdf',
      relativePath: `${LEGACY_FILE_ID}.pdf`
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('file-lost-name')
    expect(warnings[0]).toContain('the original filename was lost')
  })

  it('transformKnowledgeItem stays quiet for a normal upload', () => {
    const warnings: string[] = []
    transformKnowledgeItem(
      'kb-1',
      { id: 'file-ok', type: 'file', content: LEGACY_FILE_ID },
      { noteById: new Map(), filesById: new Map([[LEGACY_FILE_ID, fileMetadata]]) },
      (msg) => warnings.push(msg)
    )

    expect(warnings).toEqual([])
  })

  it('transformKnowledgeItem clears blank legacy processing errors for idle and completed items', () => {
    const idleResult = transformKnowledgeItem(
      'kb-1',
      {
        id: 'idle-note',
        type: 'note',
        content: 'idle note',
        processingError: ''
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )
    const completedResult = transformKnowledgeItem(
      'kb-1',
      {
        id: 'completed-file',
        type: 'file',
        content: LEGACY_FILE_ID,
        uniqueId: 'loader-1',
        processingError: '   '
      },
      {
        noteById: new Map(),
        filesById: new Map([[LEGACY_FILE_ID, fileMetadata]])
      }
    )

    expect(idleResult).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'idle',
        error: null
      })
    })
    expect(completedResult).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'completed',
        error: null
      }),
      fileCopy: { storageNames: [`${LEGACY_FILE_ID}.pdf`] }
    })
  })

  it('transformKnowledgeItem backfills errors for legacy transient states without processing errors', () => {
    const processingResult = transformKnowledgeItem(
      'kb-1',
      {
        id: 'processing-note',
        type: 'note',
        content: 'processing note',
        processingStatus: 'processing',
        processingError: '   '
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )
    const pendingResult = transformKnowledgeItem(
      'kb-1',
      {
        id: 'pending-note',
        type: 'note',
        content: 'pending note',
        processingStatus: 'pending',
        processingError: ''
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(processingResult).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'failed',
        error: 'Legacy knowledge item indexing was interrupted and needs to be retried.'
      })
    })
    expect(pendingResult).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'failed',
        error: 'Legacy knowledge item indexing was interrupted and needs to be retried.'
      })
    })
  })

  it('transformKnowledgeItem backfills errors for legacy failed states without processing errors', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'failed-note',
        type: 'note',
        content: 'failed note',
        processingStatus: 'failed',
        processingError: '   '
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toStrictEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'failed',
        error: 'Legacy knowledge item failed without an error message.'
      })
    })
  })

  it('transformKnowledgeItem rejects unsupported legacy item types', () => {
    expect(
      transformKnowledgeItem(
        'kb-1',
        {
          id: 'video-1',
          type: 'video',
          content: []
        },
        {
          noteById: new Map(),
          filesById: new Map()
        }
      )
    ).toStrictEqual({
      ok: false,
      reason: 'unsupported_type'
    })
  })

  it('transformKnowledgeItem maps directory items to v2 directory node data', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'dir-1',
        type: 'directory',
        content: '/tmp/docs'
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: expect.stringMatching(UUIDV7_PATTERN),
        baseId: 'kb-1',
        groupId: null,
        type: 'directory',
        data: {
          source: '/tmp/docs'
        },
        status: 'idle',
        error: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      }
    })
  })

  it('transformKnowledgeItem marks a v1-indexed directory `failed` with the not-migrated code', () => {
    // V1 embedded the folder's files under the directory item's loader ids; the
    // vector migrator drops those container-level vectors, so a `completed`
    // directory would be an empty shell that never re-indexes. It must surface
    // as `failed` with the code the UI renders as a delete-and-re-upload prompt.
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'dir-1',
        type: 'directory',
        content: '/tmp/docs',
        uniqueId: 'DirectoryLoader_1'
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('failed')
      expect(result.value.error).toBe(KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED)
    }
  })

  it('transformKnowledgeItem keeps the shared failed mapping for an interrupted directory', () => {
    // Only the lying `completed` state is overridden; a v1-interrupted directory
    // stays on the shared transient-state mapping and its retry message.
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'dir-1',
        type: 'directory',
        content: '/tmp/docs',
        processingStatus: 'processing'
      },
      {
        noteById: new Map(),
        filesById: new Map()
      }
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('failed')
      expect(result.value.error).toBe('Legacy knowledge item indexing was interrupted and needs to be retried.')
    }
  })
})

describe('expandLegacyDirectoryItem', () => {
  it('expands a v1-indexed directory into a completed container plus one completed file child per embedded file', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      {
        id: 'dir-1',
        type: 'directory',
        content: '/tmp/docs',
        uniqueIds: ['LocalPathLoader_a', 'LocalPathLoader_b'],
        created_at: 1735689600000, // 2025-01-01T00:00:00.000Z
        updated_at: 1738454400000 // 2025-02-02T00:00:00.000Z
      },
      new Map([
        ['LocalPathLoader_a', '/tmp/docs/a.md'],
        ['LocalPathLoader_b', '/tmp/docs/b.md']
      ]),
      new Set()
    )

    expect(result).not.toBeNull()
    if (!result) return

    // Container: a completed `directory` rooted at the folder path, no parent, owning a
    // top-level raw/ prefix just like a native expansion. It is `completed` (not the
    // tombstone `failed`) precisely because its children carry migrated vectors — the
    // folder is searchable, not an empty shell.
    expect(result.container).toStrictEqual({
      id: expect.stringMatching(UUIDV7_PATTERN),
      baseId: 'kb-1',
      groupId: null,
      type: 'directory',
      data: { source: '/tmp/docs', relativePath: 'docs' },
      status: 'completed',
      error: null,
      createdAt: 1735689600000,
      updatedAt: 1738454400000
    })
    expect(result.pathPrefix).toBe('docs')
    expect(result.unrelatedSourceChildCount).toBe(0)

    // One completed `file` child per loader id, parented to the container, each carrying its
    // external source plus a `<prefix>/<subpath>` relativePath — the same shape a native
    // directory expansion produces, except no byte is ever written under raw/<prefix>.
    const [childA, childB] = result.children
    expect(childA).toStrictEqual({
      id: expect.stringMatching(UUIDV7_PATTERN),
      baseId: 'kb-1',
      groupId: result.container.id,
      type: 'file',
      data: { source: '/tmp/docs/a.md', relativePath: 'docs/a.md' },
      status: 'completed',
      error: null,
      createdAt: 1735689600000,
      updatedAt: 1738454400000
    })
    expect(childB).toStrictEqual({
      id: expect.stringMatching(UUIDV7_PATTERN),
      baseId: 'kb-1',
      groupId: result.container.id,
      type: 'file',
      data: { source: '/tmp/docs/b.md', relativePath: 'docs/b.md' },
      status: 'completed',
      error: null,
      createdAt: 1735689600000,
      updatedAt: 1738454400000
    })

    // childLoaderRemap routes each v1 loader id to the synthesized child id so the
    // vector migrator can re-attribute the folder's chunks per file.
    expect(result.childLoaderRemap.get('LocalPathLoader_a')).toBe(childA.id)
    expect(result.childLoaderRemap.get('LocalPathLoader_b')).toBe(childB.id)
  })

  it('keeps same-named files in different folders collision-free via their subtree paths', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      {
        id: 'dir-1',
        type: 'directory',
        content: '/tmp/project',
        uniqueIds: ['L1', 'L2']
      },
      new Map([
        ['L1', '/tmp/project/api/README.md'],
        ['L2', '/tmp/project/web/README.md']
      ]),
      new Set()
    )

    expect(result).not.toBeNull()
    if (!result) return

    // Two same-named README.md sources stay distinct because each keeps the subdirectory it
    // came from — which is also what makes them unique in the index store's UNIQUE
    // material.relative_path column.
    const [childA, childB] = result.children
    expect(childA.data).toStrictEqual({
      source: '/tmp/project/api/README.md',
      relativePath: 'project/api/README.md'
    })
    expect(childB.data).toStrictEqual({
      source: '/tmp/project/web/README.md',
      relativePath: 'project/web/README.md'
    })
  })

  it('derives child paths from Windows sources on any host platform', () => {
    // v1 rows can carry foreign-platform paths (#15733). Using node:path here would make the
    // same v1 export migrate to different names on macOS and on Windows.
    const result = expandLegacyDirectoryItem(
      'kb-1',
      {
        id: 'dir-1',
        type: 'directory',
        content: 'C:\\Users\\me\\docs',
        uniqueIds: ['L1']
      },
      new Map([['L1', 'C:\\Users\\me\\docs\\api\\README.md']]),
      new Set()
    )

    expect(result?.pathPrefix).toBe('docs')
    expect(result?.children[0].data).toStrictEqual({
      source: 'C:\\Users\\me\\docs\\api\\README.md',
      relativePath: 'docs/api/README.md'
    })
  })

  it('tolerates trailing and duplicated separators in v1 paths', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      { id: 'dir-1', type: 'directory', content: '/tmp/docs/', uniqueIds: ['L1'] },
      new Map([['L1', '/tmp//docs//a.md']]),
      new Set()
    )

    expect(result?.children[0].data.relativePath).toBe('docs/a.md')
  })

  it('matches the container case-insensitively but keeps each segment original casing', () => {
    // A cross-platform restore can leave the folder path and its files differing in case.
    const result = expandLegacyDirectoryItem(
      'kb-1',
      { id: 'dir-1', type: 'directory', content: 'C:\\Users\\Me\\Docs', uniqueIds: ['L1'] },
      new Map([['L1', 'c:\\users\\me\\docs\\API\\readme.md']]),
      new Set()
    )

    expect(result?.children[0].data.relativePath).toBe('Docs/API/readme.md')
  })

  it('dedupes the container prefix against names the base already uses', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      { id: 'dir-1', type: 'directory', content: '/tmp/docs', uniqueIds: ['L1'] },
      new Map([['L1', '/tmp/docs/a.md']]),
      new Set(['docs'])
    )

    expect(result?.pathPrefix).toBe('docs_1')
    expect(result?.container.data).toStrictEqual({ source: '/tmp/docs', relativePath: 'docs_1' })
    expect(result?.children[0].data.relativePath).toBe('docs_1/a.md')
  })

  it('keeps a folder named .cherry away from the reserved meta dir', () => {
    // A bare `.cherry` prefix is rejected by assertSafeKnowledgeRelativePath, which sits on
    // every read path — it would raise instead of degrading to "source missing".
    const result = expandLegacyDirectoryItem(
      'kb-1',
      { id: 'dir-1', type: 'directory', content: '/tmp/.cherry', uniqueIds: ['L1'] },
      new Map([['L1', '/tmp/.cherry/a.md']]),
      new Set([CHERRY_META_DIR])
    )

    expect(result?.pathPrefix).toBe('.cherry_1')
    expect(() => assertSafeKnowledgeRelativePath(result!.container.data.relativePath!)).not.toThrow()
    expect(() => assertSafeKnowledgeRelativePath(result!.children[0].data.relativePath!)).not.toThrow()
  })

  it('falls back to the file name when a v1 source is not under the folder', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      { id: 'dir-1', type: 'directory', content: '/tmp/docs', uniqueIds: ['L1', 'L2'] },
      new Map([
        ['L1', '/tmp/docs/a.md'],
        ['L2', '/other/place/b.md']
      ]),
      new Set()
    )

    expect(result?.children[0].data.relativePath).toBe('docs/a.md')
    expect(result?.children[1].data.relativePath).toBe('docs/b.md')
    expect(result?.unrelatedSourceChildCount).toBe(1)
  })

  it('suffixes fallback names and sanitized names that collide', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      { id: 'dir-1', type: 'directory', content: '/tmp/docs', uniqueIds: ['L1', 'L2', 'L3', 'L4'] },
      new Map([
        // Two out-of-folder sources sharing a filename.
        ['L1', '/other/x/report.md'],
        ['L2', '/other/y/report.md'],
        // Two in-folder sources that sanitize onto the same path.
        ['L3', '/tmp/docs/a<b.md'],
        ['L4', '/tmp/docs/a>b.md']
      ]),
      new Set()
    )

    const paths = result!.children.map((child) => child.data.relativePath)
    expect(paths).toEqual(['docs/report.md', 'docs/report_1.md', 'docs/a_b.md', 'docs/a_b_1.md'])
    // The whole point of the suffixing: material.relative_path is UNIQUE.
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('sanitizes traversal and empty segments into safe knowledge paths', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      { id: 'dir-1', type: 'directory', content: '/tmp/docs', uniqueIds: ['L1', 'L2'] },
      new Map([
        ['L1', '/tmp/docs/sub/../x.md'],
        ['L2', '/tmp/docs/./nested//y.md']
      ]),
      new Set()
    )

    const paths = result!.children.map((child) => child.data.relativePath!)
    expect(paths).toEqual(['docs/sub/untitled/x.md', 'docs/nested/y.md'])
    for (const relativePath of paths) {
      expect(() => assertSafeKnowledgeRelativePath(relativePath)).not.toThrow()
      expect(relativePath.split('/')).not.toContain('..')
    }
  })

  it('falls back to a root prefix when the folder path has no named segment', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      { id: 'dir-1', type: 'directory', content: '/', uniqueIds: ['L1'] },
      new Map([['L1', '/tmp/a.md']]),
      new Set()
    )

    expect(result?.pathPrefix).toBe('root')
    expect(result?.children[0].data.relativePath).toBe('root/tmp/a.md')
  })

  it('skips loader ids whose source cannot be resolved and keeps the rest', () => {
    const result = expandLegacyDirectoryItem(
      'kb-1',
      {
        id: 'dir-1',
        type: 'directory',
        content: '/tmp/docs',
        uniqueIds: ['known', 'orphan']
      },
      new Map([['known', '/tmp/docs/known.md']]),
      new Set()
    )

    expect(result).not.toBeNull()
    if (!result) return

    expect(result.children).toHaveLength(1)
    expect(result.children[0].data.relativePath).toBe('docs/known.md')
    expect(result.childLoaderRemap.has('orphan')).toBe(false)
    expect(result.childLoaderRemap.get('known')).toBe(result.children[0].id)
  })

  it('mints one child per distinct loader id even when v1 repeats one', () => {
    // Without the guard the second pass mints another child and overwrites the remap, so the first
    // one ends up `completed` with no vectors pointing at it — an empty shell that reads as healthy
    // and escapes the re-attribution warning, which counts loader ids rather than children.
    const result = expandLegacyDirectoryItem(
      'kb-1',
      {
        id: 'dir-1',
        type: 'directory',
        content: '/tmp/docs',
        uniqueIds: ['dup', 'dup', 'other']
      },
      new Map([
        ['dup', '/tmp/docs/a.md'],
        ['other', '/tmp/docs/b.md']
      ]),
      new Set()
    )

    expect(result).not.toBeNull()
    if (!result) return

    expect(result.children.map((child) => child.data.relativePath)).toEqual(['docs/a.md', 'docs/b.md'])
    expect(result.childLoaderRemap.get('dup')).toBe(result.children[0].id)
  })

  it('returns null when no loader id resolves to a source so the caller keeps the tombstone', () => {
    // Every loader id is orphaned (vector DB unreadable/empty) → no children → null.
    expect(
      expandLegacyDirectoryItem(
        'kb-1',
        { id: 'dir-1', type: 'directory', content: '/tmp/docs', uniqueIds: ['orphan'] },
        new Map(),
        new Set()
      )
    ).toBeNull()

    // No loader ids at all (v1 never indexed the folder) → null.
    expect(
      expandLegacyDirectoryItem(
        'kb-1',
        { id: 'dir-1', type: 'directory', content: '/tmp/docs' },
        new Map([['x', '/tmp/docs/x.md']]),
        new Set()
      )
    ).toBeNull()
  })

  it('returns null for a directory with blank content', () => {
    expect(
      expandLegacyDirectoryItem(
        'kb-1',
        { id: 'dir-1', type: 'directory', content: '   ', uniqueIds: ['L1'] },
        new Map([['L1', '/tmp/docs/a.md']]),
        new Set()
      )
    ).toBeNull()
  })
})
