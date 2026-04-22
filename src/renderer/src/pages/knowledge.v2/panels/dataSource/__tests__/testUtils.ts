import type { KnowledgeItemOf } from '@shared/data/types/knowledge'

const baseFields = {
  baseId: 'base-1',
  groupId: null,
  error: null,
  createdAt: '2026-04-21T10:00:00+08:00',
  updatedAt: '2026-04-21T10:00:00+08:00'
} as const

export const createNoteItem = ({
  id,
  content = '会议纪要',
  status = 'completed'
}: {
  id: string
  content?: string
  status?: KnowledgeItemOf<'note'>['status']
}): KnowledgeItemOf<'note'> => ({
  ...baseFields,
  id,
  type: 'note',
  status,
  data: {
    content
  }
})

export const createFileItem = ({
  id,
  originName = 'internal.pdf',
  status = 'completed',
  ext = 'PDF',
  size = 1024
}: {
  id: string
  originName?: string
  status?: KnowledgeItemOf<'file'>['status']
  ext?: string
  size?: number
}): KnowledgeItemOf<'file'> => ({
  ...baseFields,
  id,
  type: 'file',
  status,
  data: {
    file: {
      id: `file-${id}`,
      name: `internal-${id}.pdf`,
      origin_name: originName,
      path: `/tmp/${originName}`,
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
  name = '产品文档',
  status = 'completed'
}: {
  id: string
  name?: string
  status?: KnowledgeItemOf<'url'>['status']
}): KnowledgeItemOf<'url'> => ({
  ...baseFields,
  id,
  type: 'url',
  status,
  data: {
    name,
    url: `https://example.com/${id}`
  }
})

export const createSitemapItem = ({
  id,
  name = '站点地图导入',
  status = 'completed'
}: {
  id: string
  name?: string
  status?: KnowledgeItemOf<'sitemap'>['status']
}): KnowledgeItemOf<'sitemap'> => ({
  ...baseFields,
  id,
  type: 'sitemap',
  status,
  data: {
    name,
    url: `https://example.com/${id}.xml`
  }
})

export const createDirectoryItem = ({
  id,
  name = '本地资料夹',
  status = 'completed'
}: {
  id: string
  name?: string
  status?: KnowledgeItemOf<'directory'>['status']
}): KnowledgeItemOf<'directory'> => ({
  ...baseFields,
  id,
  type: 'directory',
  status,
  data: {
    name,
    path: `/Users/eeee/${id}`
  }
})
