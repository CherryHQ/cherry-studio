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

const createContainerLifecycle = (
  status: KnowledgeItemOf<'directory'>['status'],
  error = 'Indexing failed'
): ContainerKnowledgeItemLifecycle => {
  if (status === 'failed') {
    return {
      status,
      error
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
  status = 'completed'
}: {
  id: string
  originName?: string
  source?: string
  status?: KnowledgeItemOf<'file'>['status']
}): KnowledgeItemOf<'file'> => ({
  ...baseFields,
  ...createLeafLifecycle(status),
  id,
  type: 'file',
  data: {
    source,
    relativePath: originName
  }
})

export const createUrlItem = ({
  id,
  source = `https://example.com/${id}`,
  relativePath,
  status = 'completed'
}: {
  id: string
  source?: string
  relativePath?: string
  status?: KnowledgeItemOf<'url'>['status']
}): KnowledgeItemOf<'url'> => ({
  ...baseFields,
  ...createLeafLifecycle(status),
  id,
  type: 'url',
  data: {
    source,
    url: source,
    ...(relativePath ? { relativePath } : {})
  }
})

export const createDirectoryItem = ({
  id,
  source = `/Users/eeee/${id}`,
  status = 'completed',
  error
}: {
  id: string
  source?: string
  status?: KnowledgeItemOf<'directory'>['status']
  error?: string
}): KnowledgeItemOf<'directory'> => ({
  ...baseFields,
  ...createContainerLifecycle(status, error),
  id,
  type: 'directory',
  data: {
    source,
    path: source
  }
})
