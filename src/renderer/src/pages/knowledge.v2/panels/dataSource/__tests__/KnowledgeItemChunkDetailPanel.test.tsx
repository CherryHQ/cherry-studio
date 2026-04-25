import type { KnowledgeItemChunk } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeItemChunkDetailPanel from '../KnowledgeItemChunkDetailPanel'
import { createFileItem } from './testUtils'

const listItemChunksMock = vi.fn()

const chunks: KnowledgeItemChunk[] = [
  {
    id: 'chunk-1',
    itemId: 'file-1',
    content: '真实 chunk 内容一',
    metadata: {
      itemId: 'file-1',
      itemType: 'file',
      source: '/tmp/RAG 技术指南.pdf',
      name: 'RAG 技术指南.pdf',
      chunkIndex: 0,
      tokenCount: 145
    }
  },
  {
    id: 'chunk-2',
    itemId: 'file-1',
    content: '真实 chunk 内容二',
    metadata: {
      itemId: 'file-1',
      itemType: 'file',
      source: '/tmp/RAG 技术指南.pdf',
      name: 'RAG 技术指南.pdf',
      chunkIndex: 1,
      tokenCount: 88
    }
  }
]

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  Scrollbar: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('@renderer/pages/knowledge.v2/utils', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@renderer/utils', () => ({
  formatFileSize: () => '2.4 MB'
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
      if (key === 'knowledge_v2.data_source.chunks_count') {
        return `${options?.count} chunks`
      }

      return (
        (
          {
            'common.back': '返回',
            'common.delete': '删除',
            'common.edit': '编辑',
            'common.expand': '展开',
            'common.loading': '加载中',
            'knowledge_v2.data_source.empty_description': '暂无数据源',
            'knowledge_v2.data_source.filters.file': '文件',
            'knowledge_v2.rag.tokens_unit': 'tokens',
            'knowledge_v2.data_source.status.ready': '就绪'
          } as Record<string, string>
        )[key] ?? key
      )
    }
  })
}))

describe('KnowledgeItemChunkDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listItemChunksMock.mockResolvedValue(chunks)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        knowledgeRuntime: {
          listItemChunks: listItemChunksMock
        }
      }
    })
  })

  it('renders item metadata and real chunks', async () => {
    render(
      <KnowledgeItemChunkDetailPanel
        item={createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf', ext: 'PDF', size: 2516582 })}
        onBack={() => undefined}
      />
    )

    expect(screen.getByText('RAG 技术指南.pdf')).toBeInTheDocument()
    expect(screen.getByText('pdf')).toBeInTheDocument()
    expect(screen.getByText('2.4 MB')).toBeInTheDocument()
    expect(screen.getByText('0 chunks')).toBeInTheDocument()
    expect(screen.getByText('加载中')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(`${chunks.length} chunks`)).toBeInTheDocument()
    })
    expect(listItemChunksMock).toHaveBeenCalledWith('base-1', 'file-1')
    expect(screen.getByText('145 tokens')).toBeInTheDocument()
    expect(screen.getByText('88 tokens')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容一')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容二')).toBeInTheDocument()
  })

  it('renders placeholder chunk action buttons with zh-CN labels', async () => {
    render(
      <KnowledgeItemChunkDetailPanel
        item={createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf' })}
        onBack={() => undefined}
      />
    )

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(chunks.length)
    })
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(chunks.length)
    expect(screen.getAllByRole('button', { name: '展开' })).toHaveLength(chunks.length)
  })

  it('renders an empty state when the item has no chunks', async () => {
    listItemChunksMock.mockResolvedValueOnce([])

    render(
      <KnowledgeItemChunkDetailPanel
        item={createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf' })}
        onBack={() => undefined}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('暂无数据源')).toBeInTheDocument()
    })
    expect(screen.getByText('0 chunks')).toBeInTheDocument()
  })

  it('calls onBack from the header back button', async () => {
    const onBack = vi.fn()

    render(
      <KnowledgeItemChunkDetailPanel
        item={createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf' })}
        onBack={onBack}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(`${chunks.length} chunks`)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '返回' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
