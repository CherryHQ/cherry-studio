import { FILE_TYPE } from '@shared/data/types/file'
import { KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { legacyModelToUniqueId } from '../../transformers/ModelTransformers'
import { inferKnowledgeItemStatus, transformKnowledgeBase, transformKnowledgeItem } from '../KnowledgeMappings'

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUIDV4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const LEGACY_FILE_ID = '019606a0-0000-7000-8000-000000000101'

const fileMetadata = {
  id: LEGACY_FILE_ID,
  name: 'report.pdf',
  origin_name: 'report.pdf',
  path: '/tmp/report.pdf',
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
          content: 'dexie-content',
          sourceUrl: 'https://dexie.example.com'
        },
        status: 'idle',
        error: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      }
    })
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
          content: '',
          sourceUrl: 'https://example.com/origin'
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
          content: 'recoverable body',
          sourceUrl: ''
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
          source: '/tmp/report.pdf',
          fileEntryId: LEGACY_FILE_ID
        },
        status: 'completed',
        error: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      }
    })
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
      })
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
          source: '/tmp/docs',
          path: '/tmp/docs'
        },
        status: 'idle',
        error: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      }
    })
  })
})
