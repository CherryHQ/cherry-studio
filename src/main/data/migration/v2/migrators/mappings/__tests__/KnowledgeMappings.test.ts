import { FILE_TYPE } from '@shared/data/types/file'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED,
  KNOWLEDGE_NOTE_CONTENT_MAX
} from '@shared/data/types/knowledge'
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
// `fileCopy.storageName`, `origin_name` (user-facing) feeds `relativePath`, `path` (stale column)
// feeds `data.source`, and `name` is a deliberate DISTRACTOR that must NOT feed storageName
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
        documentCount: undefined,
        searchMode: 'hybrid'
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
      fileCopy: { storageName: `${LEGACY_FILE_ID}.pdf` }
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
      fileCopy: { storageName: `${LEGACY_FILE_ID}.pdf` }
    })
    // The fallback leaves a diagnostic trail in the migration log.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('file-blank-name')
    expect(warnings[0]).toContain('blank v1 filename')
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
      fileCopy: { storageName: `${LEGACY_FILE_ID}.pdf` }
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
      ])
    )

    expect(result).not.toBeNull()
    if (!result) return

    // Container: a completed `directory` rooted at the folder path, no parent. It is
    // `completed` (not the tombstone `failed`) precisely because its children carry
    // migrated vectors — the folder is searchable, not an empty shell.
    expect(result.container).toStrictEqual({
      id: expect.stringMatching(UUIDV7_PATTERN),
      baseId: 'kb-1',
      groupId: null,
      type: 'directory',
      data: { source: '/tmp/docs' },
      status: 'completed',
      error: null,
      createdAt: 1735689600000,
      updatedAt: 1738454400000
    })

    // One completed `file` child per loader id, parented to the container, each
    // carrying its external source and a virtual relativePath equal to its own id.
    const [childA, childB] = result.children
    expect(childA).toStrictEqual({
      id: expect.stringMatching(UUIDV7_PATTERN),
      baseId: 'kb-1',
      groupId: result.container.id,
      type: 'file',
      data: { source: '/tmp/docs/a.md', relativePath: childA.id },
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
      data: { source: '/tmp/docs/b.md', relativePath: childB.id },
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

  it('keeps same-named files in different folders collision-free via the virtual per-id relativePath', () => {
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
      ])
    )

    expect(result).not.toBeNull()
    if (!result) return

    // Two same-named README.md sources expand without collision: the relativePath is
    // each child's own id (no copy into the base, so no shared raw/ path to clash on).
    const [childA, childB] = result.children
    expect(childA.id).not.toBe(childB.id)
    expect(childA.data).toStrictEqual({ source: '/tmp/project/api/README.md', relativePath: childA.id })
    expect(childB.data).toStrictEqual({ source: '/tmp/project/web/README.md', relativePath: childB.id })
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
      new Map([['known', '/tmp/docs/known.md']])
    )

    expect(result).not.toBeNull()
    if (!result) return

    expect(result.children).toHaveLength(1)
    expect(result.childLoaderRemap.has('orphan')).toBe(false)
    expect(result.childLoaderRemap.get('known')).toBe(result.children[0].id)
  })

  it('returns null when no loader id resolves to a source so the caller keeps the tombstone', () => {
    // Every loader id is orphaned (vector DB unreadable/empty) → no children → null.
    expect(
      expandLegacyDirectoryItem(
        'kb-1',
        { id: 'dir-1', type: 'directory', content: '/tmp/docs', uniqueIds: ['orphan'] },
        new Map()
      )
    ).toBeNull()

    // No loader ids at all (v1 never indexed the folder) → null.
    expect(
      expandLegacyDirectoryItem(
        'kb-1',
        { id: 'dir-1', type: 'directory', content: '/tmp/docs' },
        new Map([['x', '/tmp/docs/x.md']])
      )
    ).toBeNull()
  })

  it('returns null for a directory with blank content', () => {
    expect(
      expandLegacyDirectoryItem(
        'kb-1',
        { id: 'dir-1', type: 'directory', content: '   ', uniqueIds: ['L1'] },
        new Map([['L1', '/tmp/docs/a.md']])
      )
    ).toBeNull()
  })
})
