import { FileTypes } from '@shared/data/types/file'
import { describe, expect, it } from 'vitest'

import {
  inferKnowledgeItemStatus,
  toCompositeModelId,
  transformKnowledgeBase,
  transformKnowledgeItem
} from '../KnowledgeMappings'

const fileMetadata = {
  id: 'file-1',
  name: 'report.pdf',
  origin_name: 'report.pdf',
  path: '/tmp/report.pdf',
  size: 128,
  ext: '.pdf',
  type: FileTypes.DOCUMENT,
  created_at: '2025-01-01T00:00:00.000Z',
  count: 1
}

describe('KnowledgeMappings', () => {
  it('toCompositeModelId builds provider::modelId and preserves precomposed ids', () => {
    expect(toCompositeModelId({ id: 'BAAI/bge-m3', name: 'bge', provider: 'silicon' })).toBe('silicon::BAAI/bge-m3')
    expect(toCompositeModelId({ id: 'silicon::BAAI/bge-m3', name: 'bge', provider: 'silicon' })).toBe(
      'silicon::BAAI/bge-m3'
    )
  })

  it('inferKnowledgeItemStatus only trusts uniqueId', () => {
    expect(inferKnowledgeItemStatus({ uniqueId: 'loader-1' } as any)).toBe('completed')
    expect(inferKnowledgeItemStatus({ uniqueId: '   ' } as any)).toBe('idle')
    expect(inferKnowledgeItemStatus({} as any)).toBe('idle')
  })

  it('transformKnowledgeBase returns embedding_model_missing when model is unavailable', () => {
    expect(
      transformKnowledgeBase(
        {
          id: 'kb-1',
          name: 'KB 1'
        },
        1024
      )
    ).toStrictEqual({
      ok: false,
      reason: 'embedding_model_missing'
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
        parentId: null,
        type: 'note',
        data: {
          content: 'dexie-content',
          sourceUrl: 'https://dexie.example.com'
        },
        status: 'idle',
        error: null,
        createdAt: undefined,
        updatedAt: undefined
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
        parentId: null,
        type: 'file',
        data: {
          file: fileMetadata
        },
        status: 'completed',
        error: null,
        createdAt: undefined,
        updatedAt: undefined
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
})
