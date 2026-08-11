import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { PosixRelativeFilePath } from '@shared/utils/file'
import { describe, expect, it } from 'vitest'

import { planKnowledgeItemSource } from '../sourcePlanning'

function createBase(fileProcessorId: string | null = 'doc2x'): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    groupId: null,
    dimensions: 3,
    embeddingModelId: 'provider::embed',
    rerankModelId: null,
    fileProcessorId,
    status: 'completed',
    error: null,
    chunkSize: 1024,
    chunkOverlap: 200,
    chunkStrategy: 'structured',
    chunkSeparator: '\\n\\n',
    documentCount: 10,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createFileItem(source: string): KnowledgeItemOf<'file'> {
  return {
    id: 'file-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'file',
    data: { source, relativePath: (source.split('/').pop() ?? source) as PosixRelativeFilePath },
    status: 'processing',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('planKnowledgeItemSource', () => {
  it('routes PDFs to file processing when a processor is configured', () => {
    expect(planKnowledgeItemSource(createBase(), createFileItem('/docs/source.pdf'))).toEqual({
      kind: 'needsFileProcessing'
    })
  })

  it.each(['doc', 'docx', 'pptx', 'xlsx', 'xls'])(
    'indexes .%s directly even with a processor configured — AnydocReader already reads it',
    (ext) => {
      expect(planKnowledgeItemSource(createBase(), createFileItem(`/docs/source.${ext}`))).toEqual({
        kind: 'index-documents'
      })
    }
  )

  it('indexes supported documents directly when no file processor is configured', () => {
    expect(planKnowledgeItemSource(createBase(null), createFileItem('/docs/source.pdf'))).toEqual({
      kind: 'index-documents'
    })
  })

  it('indexes a file that already carries a processed artifact directly, skipping the processor', () => {
    const item = createFileItem('/docs/source.pdf')
    item.data.indexedRelativePath = 'source.md' as PosixRelativeFilePath
    expect(planKnowledgeItemSource(createBase(), item)).toEqual({ kind: 'index-documents' })
  })
})
