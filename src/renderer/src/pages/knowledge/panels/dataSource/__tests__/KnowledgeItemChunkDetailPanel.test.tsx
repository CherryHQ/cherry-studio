import type { KnowledgeItemChunk } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeItemChunkDetailPanel from '../KnowledgeItemChunkDetailPanel'
import { createDirectoryItem, createFileItem } from './testUtils'

const listItemChunksMock = vi.fn()
const deleteItemChunkMock = vi.fn()
const mockUseQuery = vi.fn()
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
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmText,
    cancelText,
    onConfirm,
    onOpenChange,
    confirmLoading
  }: {
    open?: boolean
    title: ReactNode
    description?: ReactNode
    confirmText?: string
    cancelText?: string
    onConfirm?: () => void | Promise<void>
    onOpenChange?: (open: boolean) => void
    confirmLoading?: boolean
  }) =>
    open ? (
      <div role="dialog">
        <div>{title}</div>
        <div>{description}</div>
        <button type="button" onClick={() => onOpenChange?.(false)}>
          {cancelText}
        </button>
        <button type="button" disabled={confirmLoading} onClick={() => void onConfirm?.()}>
          {confirmText}
        </button>
      </div>
    ) : null,
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

vi.mock('@renderer/pages/knowledge/utils', () => ({
  formatRelativeTime: () => '刚刚',
  normalizeKnowledgeError: (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
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
      if (key === 'knowledge.data_source.chunks_count') {
        return `${options?.count} chunks`
      }

      return (
        (
          {
            'common.back': '返回',
            'common.delete': '删除',
            'common.loading': '加载中',
            'common.cancel': '取消',
            'knowledge.data_source.empty_description': '暂无数据源',
            'knowledge.data_source.chunk_delete_confirm_description':
              '删除后该 Chunk 将不再参与召回，重新索引数据源后会重新生成。',
            'knowledge.data_source.chunk_delete_confirm_title': '确认删除 Chunk',
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
    listItemChunksMock.mockResolvedValue(chunks)
    deleteItemChunkMock.mockResolvedValue(undefined)
    mockUseQuery.mockReturnValue({
      data: createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf' }),
      isLoading: false,
      error: undefined
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        knowledgeRuntime: {
          listItemChunks: listItemChunksMock,
          deleteItemChunk: deleteItemChunkMock
        }
      }
    })
  })

  const renderPanel = () =>
    render(<KnowledgeItemChunkDetailPanel baseId="base-1" itemId="file-1" onBack={() => undefined} />)

  it('renders item metadata and real chunks', async () => {
    mockUseQuery.mockReturnValueOnce({
      data: createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf', ext: 'PDF', size: 2516582 }),
      isLoading: false,
      error: undefined
    })

    renderPanel()

    expect(screen.getByText('RAG 技术指南.pdf')).toBeInTheDocument()
    expect(screen.getByText('pdf')).toBeInTheDocument()
    expect(screen.getByText('2.4 MB')).toBeInTheDocument()
    expect(screen.getByText('0 chunks')).toBeInTheDocument()
    expect(screen.getByText('加载中')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(`${chunks.length} chunks`)).toBeInTheDocument()
    })
    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-items/:id', {
      params: { id: 'file-1' },
      enabled: true
    })
    expect(listItemChunksMock).toHaveBeenCalledWith('base-1', 'file-1')
    expect(screen.getByText('145 tokens')).toBeInTheDocument()
    expect(screen.getByText('88 tokens')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容一')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容二')).toBeInTheDocument()
  })

  it('renders only implemented chunk action buttons', async () => {
    renderPanel()

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(chunks.length)
    })
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '展开' })).not.toBeInTheDocument()
  })

  it('opens a confirmation dialog before deleting a chunk', async () => {
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(`${chunks.length} chunks`)).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])

    expect(deleteItemChunkMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('确认删除 Chunk')
    expect(screen.getByRole('dialog')).toHaveTextContent('删除后该 Chunk 将不再参与召回，重新索引数据源后会重新生成。')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteItemChunkMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(deleteItemChunkMock).toHaveBeenCalledWith('base-1', 'file-1', 'chunk-1')
    })
    expect(screen.getByText('1 chunks')).toBeInTheDocument()
    expect(screen.queryByText('真实 chunk 内容一')).not.toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容二')).toBeInTheDocument()
  })

  it('deletes a descendant chunk by the chunk owner item id when viewing a directory', async () => {
    mockUseQuery.mockReturnValueOnce({
      data: createDirectoryItem({ id: 'directory-1', source: '/Users/eeee/docs' }),
      isLoading: false,
      error: undefined
    })
    listItemChunksMock.mockResolvedValueOnce([
      {
        id: 'chunk-child-1',
        itemId: 'file-child-1',
        content: '子文件 chunk 内容',
        metadata: {
          itemId: 'file-child-1',
          itemType: 'file',
          source: '/Users/eeee/docs/a.pdf',
          chunkIndex: 0,
          tokenCount: 64
        }
      }
    ])

    render(<KnowledgeItemChunkDetailPanel baseId="base-1" itemId="directory-1" onBack={() => undefined} />)

    await waitFor(() => {
      expect(screen.getByText('子文件 chunk 内容')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(deleteItemChunkMock).toHaveBeenCalledWith('base-1', 'file-child-1', 'chunk-child-1')
    })
    expect(deleteItemChunkMock).not.toHaveBeenCalledWith('base-1', 'directory-1', 'chunk-child-1')
  })

  it('keeps existing chunks and shows an error when chunk deletion fails', async () => {
    const deleteError = new Error('delete failed')
    deleteItemChunkMock.mockRejectedValueOnce(deleteError)

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(`${chunks.length} chunks`)).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(screen.getByText('delete failed')).toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容一')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容二')).toBeInTheDocument()
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to delete knowledge item chunk', deleteError, {
      baseId: 'base-1',
      itemId: 'file-1',
      chunkId: 'chunk-1'
    })
  })

  it('logs chunk list failures and shows the original error message', async () => {
    const listError = new Error('list failed')
    listItemChunksMock.mockRejectedValueOnce(listError)

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
    listItemChunksMock.mockResolvedValueOnce([])

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
