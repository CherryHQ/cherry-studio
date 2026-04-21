import { describe, expect, it } from 'vitest'

import type { KnowledgeV2Item } from '../../types'
import { filterKnowledgeV2TopLevelItems } from '../knowledgeItems'

const baseItem = {
  baseId: 'base-1',
  groupId: null,
  status: 'completed',
  error: null,
  createdAt: '2026-04-21T10:00:00+08:00',
  updatedAt: '2026-04-21T10:00:00+08:00'
} as const

const createDirectoryItem = ({
  id,
  ...overrides
}: Pick<KnowledgeV2Item, 'id'> &
  Partial<Pick<KnowledgeV2Item, 'groupId' | 'parentId' | 'status'>>): KnowledgeV2Item => ({
  ...baseItem,
  ...overrides,
  id,
  type: 'directory',
  data: {
    name: 'Example Directory',
    path: '/tmp/example-directory'
  }
})

const createFileItem = ({
  id,
  ...overrides
}: Pick<KnowledgeV2Item, 'id'> &
  Partial<Pick<KnowledgeV2Item, 'groupId' | 'parentId' | 'status'>>): KnowledgeV2Item => ({
  ...baseItem,
  ...overrides,
  id,
  type: 'file',
  data: {
    file: {
      id: 'file-1',
      name: 'report.pdf',
      origin_name: 'report.pdf',
      path: '/tmp/report.pdf',
      size: 1024,
      ext: 'pdf',
      type: 'document',
      created_at: '2026-04-21T10:00:00+08:00',
      count: 1
    }
  }
})

const createUrlItem = ({
  id,
  ...overrides
}: Pick<KnowledgeV2Item, 'id'> &
  Partial<Pick<KnowledgeV2Item, 'groupId' | 'parentId' | 'status'>>): KnowledgeV2Item => ({
  ...baseItem,
  ...overrides,
  id,
  type: 'url',
  data: {
    url: 'https://example.com/page',
    name: 'Example Page'
  }
})

const createSitemapItem = ({
  id,
  ...overrides
}: Pick<KnowledgeV2Item, 'id'> &
  Partial<Pick<KnowledgeV2Item, 'groupId' | 'parentId' | 'status'>>): KnowledgeV2Item => ({
  ...baseItem,
  ...overrides,
  id,
  type: 'sitemap',
  data: {
    url: 'https://example.com/sitemap.xml',
    name: 'Example Sitemap'
  }
})

const createNoteItem = ({
  id,
  ...overrides
}: Pick<KnowledgeV2Item, 'id'> &
  Partial<Pick<KnowledgeV2Item, 'groupId' | 'parentId' | 'status'>>): KnowledgeV2Item => ({
  ...baseItem,
  ...overrides,
  id,
  type: 'note',
  data: {
    content: 'Example note'
  }
})

describe('filterKnowledgeV2TopLevelItems', () => {
  it('filters out child items that carry parentId', () => {
    const items = [
      createSitemapItem({ id: 'parent' }),
      createUrlItem({ id: 'child-1', parentId: 'parent' }),
      createNoteItem({ id: 'top-level-note' })
    ]

    expect(filterKnowledgeV2TopLevelItems(items).map((item) => item.id)).toEqual(['parent', 'top-level-note'])
  })

  it('falls back to hiding sitemap and directory children grouped under a container owner', () => {
    const items = [
      createDirectoryItem({ id: 'directory-parent' }),
      createFileItem({ id: 'directory-child', groupId: 'directory-parent' }),
      createSitemapItem({ id: 'sitemap-parent' }),
      createUrlItem({ id: 'sitemap-child', groupId: 'sitemap-parent' }),
      createFileItem({ id: 'standalone-file' })
    ]

    expect(filterKnowledgeV2TopLevelItems(items).map((item) => item.id)).toEqual([
      'directory-parent',
      'sitemap-parent',
      'standalone-file'
    ])
  })
})
