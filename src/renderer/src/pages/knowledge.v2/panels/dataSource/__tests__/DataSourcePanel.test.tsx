import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DataSourcePanel from '../DataSourcePanel'
import { createDirectoryItem, createFileItem, createNoteItem, createSitemapItem, createUrlItem } from './testUtils'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return {
    ...actual,
    Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <button {...props}>{children}</button>
    ),
    Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
})

vi.mock('@renderer/pages/knowledge.v2/utils', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'knowledge_v2.data_source.ready_summary') {
        return `已就绪 ${options?.ready}/${options?.total}`
      }

      return (
        (
          {
            'common.add': '添加',
            'common.loading': '加载中...',
            'common.no_results': '暂无结果',
            'knowledge_v2.data_source.filters.all': '全部',
            'knowledge_v2.data_source.filters.file': '文件',
            'knowledge_v2.data_source.filters.note': '笔记',
            'knowledge_v2.data_source.filters.directory': '目录',
            'knowledge_v2.data_source.filters.url': '链接',
            'knowledge_v2.data_source.filters.sitemap': '站点地图',
            'knowledge_v2.data_source.status.ready': '就绪',
            'knowledge_v2.data_source.status.error': '失败',
            'knowledge_v2.data_source.status.embedding': '向量化中',
            'knowledge_v2.data_source.status.chunking': '分块中',
            'knowledge_v2.data_source.status.pending': '等待中',
            'knowledge_v2.rag.file_processing': '文件处理'
          } as Record<string, string>
        )[key] ?? key
      )
    }
  })
}))

describe('DataSourcePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading and empty states through the list composition without changing panel behavior', () => {
    const { rerender } = render(<DataSourcePanel items={[]} isLoading onAdd={vi.fn()} />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()

    rerender(<DataSourcePanel items={[]} isLoading={false} onAdd={vi.fn()} />)

    expect(screen.getByText('暂无结果')).toBeInTheDocument()
  })

  it('uses the first non-empty note line as the title and leaves blank notes without the old fallback label', () => {
    render(
      <DataSourcePanel
        items={[
          createNoteItem({ id: 'note-1', content: '\n \n  第一行标题  \n第二行内容' }),
          createNoteItem({ id: 'note-2', content: '\n   \n' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
      />
    )

    expect(screen.getByText('第一行标题')).toBeInTheDocument()
    expect(screen.getAllByText('笔记')).toHaveLength(1)
    expect(screen.getByText('已就绪 2/2')).toBeInTheDocument()
  })

  it('renders url, sitemap, and directory items from their required name fields and keeps the ready count correct', () => {
    render(
      <DataSourcePanel
        items={[
          createUrlItem({ id: 'url-1', name: '产品文档' }),
          createSitemapItem({ id: 'sitemap-1', name: '站点地图导入', status: 'embed' }),
          createDirectoryItem({ id: 'directory-1', name: '本地资料夹' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
      />
    )

    expect(screen.getByText('产品文档')).toBeInTheDocument()
    expect(screen.getByText('站点地图导入')).toBeInTheDocument()
    expect(screen.getByText('本地资料夹')).toBeInTheDocument()
    expect(screen.getByText('已就绪 2/3')).toBeInTheDocument()
    expect(screen.getByText('向量化中')).toBeInTheDocument()
  })

  it('builds filter labels from the type display config and filters the visible rows by type', () => {
    render(
      <DataSourcePanel
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createNoteItem({ id: 'note-1', content: '会议纪要' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '笔记' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '目录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '链接' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '站点地图' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(screen.getByText('季度报告.pdf')).toBeInTheDocument()
    expect(screen.queryByText('会议纪要')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '笔记' }))
    expect(screen.getByText('会议纪要')).toBeInTheDocument()
    expect(screen.queryByText('季度报告.pdf')).not.toBeInTheDocument()
  })

  it('forwards the header add action without affecting the existing list behavior', () => {
    const onAdd = vi.fn()

    render(
      <DataSourcePanel
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={onAdd}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByText('季度报告.pdf')).toBeInTheDocument()
  })
})
