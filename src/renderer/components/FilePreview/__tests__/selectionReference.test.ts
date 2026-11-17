import { describe, expect, it } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import { createSelectionReference } from '../selectionReference'

const filePath = '/workspace/report.docx' as AbsoluteFilePath
const anchor = { format: 'docx', paragraph: 0 } as const
const metadata = { size: 1024, modifiedAt: 1_700_000_000_000 }

describe('createSelectionReference', () => {
  it('stamps the reference with the metadata the preview loaded with', () => {
    const selection = { sourceId: filePath, revision: '1024:1700000000000', anchor, excerpt: 'Q1 revenue' }

    expect(createSelectionReference({ filePath, selection, metadata })).toEqual({
      path: filePath,
      anchor,
      excerpt: 'Q1 revenue',
      fileStamp: { size: 1024, mtimeMs: 1_700_000_000_000 }
    })
  })
})
