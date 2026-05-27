import type { KnowledgeItemOf } from '@shared/data/types/knowledge'

type KnowledgeItemLifecycle<TItem extends { error: unknown; status: string }> = TItem extends unknown
  ? Pick<TItem, 'error' | 'status'>
  : never
type LeafKnowledgeItemLifecycle = KnowledgeItemLifecycle<KnowledgeItemOf<'file'>>
type ContainerKnowledgeItemLifecycle = KnowledgeItemLifecycle<KnowledgeItemOf<'directory'>>

const baseFields = {
  baseId: 'base-1',
  groupId: null,
  createdAt: '2026-04-21T10:00:00+08:00',
  updatedAt: '2026-04-21T10:00:00+08:00'
} as const

const createLeafLifecycle = (status: KnowledgeItemOf<'file'>['status']): LeafKnowledgeItemLifecycle => {
  if (status === 'failed') {
    return {
      status,
      error: 'Indexing failed'
    }
  }

  return {
    status,
    error: null
  }
}

const createContainerLifecycle = (status: KnowledgeItemOf<'directory'>['status']): ContainerKnowledgeItemLifecycle => {
  if (status === 'failed') {
    return {
      status,
      error: 'Indexing failed'
    }
  }

  return {
    status,
    error: null
  }
}

export const createNoteItem = ({
  id,
  content = '会议纪要',
  source = id,
  status = 'completed'
}: {
  id: string
  content?: string
  source?: string
  status?: KnowledgeItemOf<'note'>['status']
}): KnowledgeItemOf<'note'> => ({
  ...baseFields,
  ...createLeafLifecycle(status),
  id,
  type: 'note',
  data: {
    source,
    content
  }
})

export const createFileItem = ({
  id,
  originName = 'internal.pdf',
  source = `/tmp/${originName}`,
  status = 'completed',
  ext = 'PDF',
  size = 1024
}: {
  id: string
  originName?: string
  source?: string
  status?: KnowledgeItemOf<'file'>['status']
  ext?: string
  size?: number
}): KnowledgeItemOf<'file'> => ({
  ...baseFields,
  ...createLeafLifecycle(status),
  id,
  type: 'file',
  data: {
    source,
    file: {
      id: `file-${id}`,
      name: `internal-${id}.pdf`,
      origin_name: originName,
      path: source,
      size,
      ext,
      type: 'document',
      created_at: '2026-04-21T10:00:00+08:00',
      count: 1
    }
  }
})

export const createUrlItem = ({
  id,
  source = `https://example.com/${id}`,
  status = 'completed'
}: {
  id: string
  source?: string
  status?: KnowledgeItemOf<'url'>['status']
}): KnowledgeItemOf<'url'> => ({
  ...baseFields,
  ...createLeafLifecycle(status),
  id,
  type: 'url',
  data: {
    source,
    url: source
  }
})

export const createSitemapItem = ({
  id,
  source = `https://example.com/${id}.xml`,
  status = 'completed'
}: {
  id: string
  source?: string
  status?: KnowledgeItemOf<'sitemap'>['status']
}): KnowledgeItemOf<'sitemap'> => ({
  ...baseFields,
  ...createContainerLifecycle(status),
  id,
  type: 'sitemap',
  data: {
    source,
    url: source
  }
})

export const createDirectoryItem = ({
  id,
  source = `/Users/eeee/${id}`,
  status = 'completed'
}: {
  id: string
  source?: string
  status?: KnowledgeItemOf<'directory'>['status']
}): KnowledgeItemOf<'directory'> => ({
  ...baseFields,
  ...createContainerLifecycle(status),
  id,
  type: 'directory',
  data: {
    source,
    path: source
  }
})
