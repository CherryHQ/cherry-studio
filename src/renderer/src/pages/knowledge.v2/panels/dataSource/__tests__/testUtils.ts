import type { KnowledgeItemOf } from '@shared/data/types/knowledge'

type LeafKnowledgeItemPhase = KnowledgeItemOf<'file'>['phase']
type ContainerKnowledgeItemPhase = KnowledgeItemOf<'directory'>['phase']
type KnowledgeItemLifecycle<TItem extends { error: unknown; phase: unknown; status: string }> = TItem extends unknown
  ? Pick<TItem, 'error' | 'phase' | 'status'>
  : never
type LeafKnowledgeItemLifecycle = KnowledgeItemLifecycle<KnowledgeItemOf<'file'>>
type ContainerKnowledgeItemLifecycle = KnowledgeItemLifecycle<KnowledgeItemOf<'directory'>>

const baseFields = {
  baseId: 'base-1',
  groupId: null,
  createdAt: '2026-04-21T10:00:00+08:00',
  updatedAt: '2026-04-21T10:00:00+08:00'
} as const

const createLeafLifecycle = (
  status: KnowledgeItemOf<'file'>['status'],
  phase: LeafKnowledgeItemPhase
): LeafKnowledgeItemLifecycle => {
  if (status === 'failed') {
    return {
      status,
      phase: null,
      error: 'Indexing failed'
    }
  }

  if (status === 'processing') {
    return {
      status,
      phase,
      error: null
    }
  }

  return {
    status,
    phase: null,
    error: null
  }
}

const createContainerLifecycle = (
  status: KnowledgeItemOf<'directory'>['status'],
  phase: ContainerKnowledgeItemPhase
): ContainerKnowledgeItemLifecycle => {
  if (status === 'failed') {
    return {
      status,
      phase: null,
      error: 'Indexing failed'
    }
  }

  if (status === 'processing') {
    return {
      status,
      phase,
      error: null
    }
  }

  return {
    status,
    phase: null,
    error: null
  }
}

export const createNoteItem = ({
  id,
  content = '会议纪要',
  source = id,
  status = 'completed',
  phase = null
}: {
  id: string
  content?: string
  source?: string
  status?: KnowledgeItemOf<'note'>['status']
  phase?: LeafKnowledgeItemPhase
}): KnowledgeItemOf<'note'> => ({
  ...baseFields,
  ...createLeafLifecycle(status, phase),
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
  phase = null,
  ext = 'PDF',
  size = 1024
}: {
  id: string
  originName?: string
  source?: string
  status?: KnowledgeItemOf<'file'>['status']
  phase?: LeafKnowledgeItemPhase
  ext?: string
  size?: number
}): KnowledgeItemOf<'file'> => ({
  ...baseFields,
  ...createLeafLifecycle(status, phase),
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
  status = 'completed',
  phase = null
}: {
  id: string
  source?: string
  status?: KnowledgeItemOf<'url'>['status']
  phase?: LeafKnowledgeItemPhase
}): KnowledgeItemOf<'url'> => ({
  ...baseFields,
  ...createLeafLifecycle(status, phase),
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
  status = 'completed',
  phase = null
}: {
  id: string
  source?: string
  status?: KnowledgeItemOf<'sitemap'>['status']
  phase?: ContainerKnowledgeItemPhase
}): KnowledgeItemOf<'sitemap'> => ({
  ...baseFields,
  ...createContainerLifecycle(status, phase),
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
  status = 'completed',
  phase = null
}: {
  id: string
  source?: string
  status?: KnowledgeItemOf<'directory'>['status']
  phase?: ContainerKnowledgeItemPhase
}): KnowledgeItemOf<'directory'> => ({
  ...baseFields,
  ...createContainerLifecycle(status, phase),
  id,
  type: 'directory',
  data: {
    source,
    path: source
  }
})
