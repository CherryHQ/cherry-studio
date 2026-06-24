import type { KnowledgeItemChunk } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeItemChunkDetailPanel from '../KnowledgeItemChunkDetailPanel'
import { createFileItem } from './testUtils'

const mockIpcRequest = vi.fn()
const mockUseQuery = vi.fn()

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mockIpcRequest(...args)
  }
}))
const mockLogger = vi.hoisted(() => ({
  error: vi.fn()
}))

const chunks: KnowledgeItemChunk[] = [
  {
    id: 'chunk-1',
    itemId: 'file-1',
    content: '真实 chunk 内容一',
    metadata: {
      itemId: 'file-1',
      itemType: 'file',
      source: '/tmp/RAG 技术指南.pdf',
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
      chunkIndex: 1,
      tokenCount: 88
    }
  }
]

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  EmptyState: ({ title, description }: { title?: ReactNode; description?: ReactNode }) => (
    <div>
      {title}
      {description}
    </div>
  ),
  Scrollbar: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mockLogger.error
    })
  }
}))

vi.mock('@renderer/utils/time', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@renderer/pages/knowledge/utils', () => ({
  normalizeKnowledgeError: (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
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
      if (key === 'knowledge.data_source.chunks_count') {
        return `${options?.count} chunks`
      }

      return (
        (
          {
            'common.back': '返回',
            'common.loading': '加载中',
            'knowledge.data_source.empty_description': '暂无数据源',
            'knowledge.data_source.filters.file': '文件',
            'knowledge.rag.tokens_unit': 'tokens',
            'knowledge.data_source.status.ready': '就绪'
          } as Record<string, string>
        )[key] ?? key
      )
    }
  })
}))

describe('KnowledgeItemChunkDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIpcRequest.mockResolvedValue(chunks)
    mockUseQuery.mockImplementation((path: string) => {
      if (path === '/knowledge-items/:id') {
        return {
          data: createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf' }),
          isLoading: false,
          error: undefined
        }
      }

      return {
        data: undefined,
        isLoading: false,
        error: undefined
      }
    })
  })

  const renderPanel = () =>
    render(<KnowledgeItemChunkDetailPanel baseId="base-1" itemId="file-1" onBack={() => undefined} />)

  it('renders item metadata and real chunks', async () => {
    mockUseQuery.mockImplementation((path: string) => {
      if (path === '/knowledge-items/:id') {
        return {
          data: createFileItem({ id: 'file-1', originName: 'fallback.md' }),
          isLoading: false,
          error: undefined
        }
      }

      return {
        data: undefined,
        isLoading: false,
        error: undefined
      }
    })

    renderPanel()

    expect(screen.getByText('fallback.md')).toBeInTheDocument()
    expect(screen.getByText('0 chunks')).toBeInTheDocument()
    expect(screen.getByText('加载中')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(`${chunks.length} chunks`)).toBeInTheDocument()
    })
    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-items/:id', {
      params: { id: 'file-1' },
      enabled: true
    })
    expect(mockUseQuery).not.toHaveBeenCalledWith('/files/entries/:id', expect.anything())
    expect(mockIpcRequest).toHaveBeenCalledWith('knowledge.list_item_chunks', { baseId: 'base-1', itemId: 'file-1' })
    expect(screen.getByText('145 tokens')).toBeInTheDocument()
    expect(screen.getByText('88 tokens')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容一')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容二')).toBeInTheDocument()
    // chunk index badges are 1-based (chunkIndex 0/1 render as 1/2)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders chunk cards without action buttons', async () => {
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(`${chunks.length} chunks`)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '展开' })).not.toBeInTheDocument()
  })

  it('logs chunk list failures and shows the original error message', async () => {
    const listError = new Error('list failed')
    mockIpcRequest.mockRejectedValueOnce(listError)

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('list failed')).toBeInTheDocument()
    })
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to list knowledge item chunks', listError, {
      baseId: 'base-1',
      itemId: 'file-1'
    })
  })

  it('renders an empty state when the item has no chunks', async () => {
    mockIpcRequest.mockResolvedValueOnce([])

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('暂无数据源')).toBeInTheDocument()
    })
    expect(screen.getByText('0 chunks')).toBeInTheDocument()
  })

  it('calls onBack from the header back button', async () => {
    const onBack = vi.fn()

    render(<KnowledgeItemChunkDetailPanel baseId="base-1" itemId="file-1" onBack={onBack} />)

    await waitFor(() => {
      expect(screen.getByText(`${chunks.length} chunks`)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '返回' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
