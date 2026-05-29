import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { filterIndexableKnowledgeItems, isIndexableKnowledgeItem } from '../items'

function createItem(type: KnowledgeItem['type']): KnowledgeItem {
  const base = {
    id: `${type}-1`,
    baseId: 'kb-1',
    groupId: null,
    status: 'idle',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  } as const

  switch (type) {
    case 'file':
      return {
        ...base,
        type,
        data: { source: '/docs/file.md', fileEntryId: '019606a0-0000-7000-8000-000000000001' }
      }
    case 'url':
      return { ...base, type, data: { source: 'https://example.com', url: 'https://example.com' } }
    case 'note':
      return { ...base, type, data: { source: 'note', content: 'note' } }
    case 'sitemap':
      return {
        ...base,
        type,
        data: { source: 'https://example.com/sitemap.xml', url: 'https://example.com/sitemap.xml' }
      }
    case 'directory':
      return { ...base, type, data: { source: '/docs', path: '/docs' } }
  }
}

describe('indexable knowledge item helpers', () => {
  it('recognizes file, url, and note as indexable leaves', () => {
    const items = ['file', 'url', 'note', 'sitemap', 'directory'].map((type) =>
      createItem(type as KnowledgeItem['type'])
    )

    expect(items.map((item) => isIndexableKnowledgeItem(item))).toEqual([true, true, true, false, false])
    expect(filterIndexableKnowledgeItems(items).map((item) => item.type)).toEqual(['file', 'url', 'note'])
  })
})
