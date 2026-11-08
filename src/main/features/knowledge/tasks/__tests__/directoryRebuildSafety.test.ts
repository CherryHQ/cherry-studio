import { describe, expect, it } from 'vitest'

import { assertDirectoryRebuildSafe } from '../utils/directoryRebuildSafety'
import { createDirectoryItem, createFileItem, createNoteItem, createUrlItem } from './jobHandlerTestUtils'

describe('directory rebuild safety', () => {
  const root = createDirectoryItem('imported-docs')
  it.each([createNoteItem(), createUrlItem(), createFileItem()])('protects independent $type content', (item) => {
    expect(() => assertDirectoryRebuildSafe(root, [item])).toThrow('independently added documents')
  })
  it('allows only filesystem descendants, including nested directory rows', () => {
    const file = createFileItem()
    file.data.source = '/imported-docs/nested/a.pdf'
    const directory = createDirectoryItem('nested')
    directory.data.source = '/imported-docs/nested'
    expect(() => assertDirectoryRebuildSafe(root, [directory, file])).not.toThrow()
  })
  it('rejects a sibling sharing the folder name prefix', () => {
    const file = createFileItem()
    file.data.source = '/imported-docs-other/a.pdf'
    expect(() => assertDirectoryRebuildSafe(root, [file])).toThrow('independently added documents')
  })
  it.each(['.independent.md', '.private/independent.md', 'nested/.private/independent.md'])(
    'protects scanner-hidden %s',
    (relative) => {
      const file = createFileItem()
      file.data.source = `/imported-docs/${relative}`
      expect(() => assertDirectoryRebuildSafe(root, [file])).toThrow('independently added documents')
    }
  )
  it('leaves selected leaf roots alone', () => {
    expect(() => assertDirectoryRebuildSafe(createNoteItem(), [createUrlItem()])).not.toThrow()
  })
})
