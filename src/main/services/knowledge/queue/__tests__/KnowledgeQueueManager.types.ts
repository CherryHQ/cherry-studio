/**
 * Type-safety regression tests for knowledge queue task entries.
 *
 * This file is typechecked by `pnpm typecheck:node`; every `@ts-expect-error`
 * directive asserts an invalid queue task shape that must stay rejected.
 */

import type { KnowledgeBase, KnowledgeItem, KnowledgeItemOf } from '@shared/data/types/knowledge'

import type { EnqueueKnowledgeTaskOptions } from '../types'

const base: KnowledgeBase = {
  id: 'base-1',
  name: 'Base',
  groupId: null,
  emoji: '📁',
  dimensions: 1024,
  embeddingModelId: 'ollama::nomic-embed-text',
  status: 'completed',
  error: null,
  chunkSize: 1024,
  chunkOverlap: 200,
  searchMode: 'hybrid',
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
}

const lifecycle = {
  status: 'processing',
  phase: null,
  error: null
} as const satisfies Pick<KnowledgeItem, 'status' | 'phase' | 'error'>

const noteItem: KnowledgeItemOf<'note'> = {
  id: 'note-1',
  baseId: base.id,
  groupId: null,
  type: 'note',
  data: { source: 'note-1', content: 'hello note-1' },
  ...lifecycle,
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
}

const fileItem: KnowledgeItemOf<'file'> = {
  id: 'file-1',
  baseId: base.id,
  groupId: null,
  type: 'file',
  data: {
    source: 'file-1',
    file: {
      id: 'file-1',
      name: 'file.md',
      origin_name: 'file.md',
      path: '/tmp/file.md',
      size: 1,
      ext: '.md',
      type: 'text',
      created_at: '2026-04-08T00:00:00.000Z',
      count: 1
    }
  },
  ...lifecycle,
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
}

const urlItem: KnowledgeItemOf<'url'> = {
  id: 'url-1',
  baseId: base.id,
  groupId: null,
  type: 'url',
  data: { source: 'url-1', url: 'https://example.com' },
  ...lifecycle,
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
}

const directoryItem: KnowledgeItemOf<'directory'> = {
  id: 'dir-1',
  baseId: base.id,
  groupId: null,
  type: 'directory',
  data: { source: '/tmp/docs', path: '/tmp/docs' },
  ...lifecycle,
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
}

const sitemapItem: KnowledgeItemOf<'sitemap'> = {
  id: 'sitemap-1',
  baseId: base.id,
  groupId: null,
  type: 'sitemap',
  data: { source: 'https://example.com/sitemap.xml', url: 'https://example.com/sitemap.xml' },
  ...lifecycle,
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
}

const ok = async (): Promise<void> => undefined

const validTasks = [
  {
    base,
    item: noteItem,
    kind: 'index-leaf',
    execute: ok
  },
  {
    base,
    item: fileItem,
    kind: 'index-leaf',
    execute: ok
  },
  {
    base,
    item: urlItem,
    kind: 'index-leaf',
    execute: ok
  },
  {
    base,
    item: directoryItem,
    kind: 'prepare-root',
    execute: ok
  },
  {
    base,
    item: sitemapItem,
    kind: 'prepare-root',
    execute: ok
  }
] satisfies EnqueueKnowledgeTaskOptions[]
void validTasks

// @ts-expect-error - sitemap roots must be prepared before leaf indexing.
const _indexSitemap: EnqueueKnowledgeTaskOptions = {
  base,
  item: sitemapItem,
  kind: 'index-leaf',
  execute: ok
}
void _indexSitemap

// @ts-expect-error - note leaf items cannot be prepared as roots.
const _prepareNote: EnqueueKnowledgeTaskOptions = {
  base,
  item: noteItem,
  kind: 'prepare-root',
  execute: ok
}
void _prepareNote

const _rawItemId: EnqueueKnowledgeTaskOptions = {
  base,
  // @ts-expect-error - public enqueue entries must carry the typed item, not a raw id.
  itemId: sitemapItem.id,
  kind: 'index-leaf',
  execute: ok
}
void _rawItemId
