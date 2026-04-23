import { FILE_TYPE } from '@shared/data/types/file'
import { describe, expect, it } from 'vitest'

import { legacyModelToUniqueId } from '../../transformers/ModelTransformers'
import { inferKnowledgeItemStatus, transformKnowledgeBase, transformKnowledgeItem } from '../KnowledgeMappings'

const fileMetadata = {
  id: 'file-1',
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

  it('inferKnowledgeItemStatus only trusts uniqueId', () => {
    expect(inferKnowledgeItemStatus({ uniqueId: 'loader-1' } as any)).toBe('completed')
    expect(inferKnowledgeItemStatus({ uniqueId: '   ' } as any)).toBe('idle')
    expect(inferKnowledgeItemStatus({} as any)).toBe('idle')
  })

  it('transformKnowledgeBase preserves the knowledge base when model is unavailable', () => {
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
        id: 'kb-1',
        name: 'KB 1',
        groupId: null,
        emoji: '📁',
        embeddingModelId: null,
        rerankModelId: null,
        searchMode: 'hybrid'
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
        id: 'kb-soft-limit-config',
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
        id: 'kb-invalid-config',
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
        id: 'note-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'note',
        data: {
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

  it('transformKnowledgeItem resolves file metadata by file id fallback', () => {
    const result = transformKnowledgeItem(
      'kb-1',
      {
        id: 'file-item-1',
        type: 'file',
        content: 'file-1',
        uniqueId: 'loader-1'
      },
      {
        noteById: new Map(),
        filesById: new Map([['file-1', fileMetadata]])
      }
    )

    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: 'file-item-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'file',
        data: {
          file: fileMetadata
        },
        status: 'completed',
        error: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number)
      }
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
        id: 'dir-1',
        baseId: 'kb-1',
        groupId: null,
        type: 'directory',
        data: {
          name: 'docs',
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
