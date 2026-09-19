import { describe, expect, it } from 'vitest'

import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { PosixRelativeFilePath } from '@shared/utils/file'

import { resolveKnowledgeReacquireProducer } from '../reacquire'

describe('resolveKnowledgeReacquireProducer', () => {
  it('keeps an external item pinned to its local snapshot instead of contacting its provider', () => {
    const item: KnowledgeItemOf<'external'> = {
      id: 'external-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'external',
      data: {
        source: 'feishu://document/doc-1',
        title: 'External doc',
        relativePath: 'external.md' as PosixRelativeFilePath
      },
      status: 'completed',
      error: null,
      createdAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-19T00:00:00.000Z'
    }

    expect(resolveKnowledgeReacquireProducer(item)).toBeNull()
  })
})
