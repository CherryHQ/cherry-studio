import { MockCherrystudioUI } from '@test-mocks/renderer/CherrystudioUI'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { KnowledgeItemChunk } from '@shared/data/types/knowledge'

import KnowledgeItemChunkDetailPanel from '../KnowledgeItemChunkDetailPanel'
import { createFileItem } from './testUtils'

const mockIpcRequest = vi.fn()
const mockUseQuery = vi.fn()

// Review persistence and real controls have their own focused integration suite.
vi.mock('../KnowledgeChunkReviewPanel', () => ({ default: () => null }))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    list,
    children,
    getItemKey
  }: {
    list: KnowledgeItemChunk[]
    children: (chunk: KnowledgeItemChunk, index: number) => ReactNode
    getItemKey?: (index: number) => string | number
  }) => {
    return (
      <div data-testid="virtual-list">
        {list.slice(0, 3).map((chunk, index) => (
          <div key={getItemKey?.(index) ?? index} data-testid="virtual-chunk">
            {children(chunk, index)}
          </div>
        ))}
      </div>
    )
  }
}))

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
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  EmptyState: ({ title, description }: { title?: ReactNode; description?: ReactNode }) => (
    <div>
      {title}
      {description}
    </div>
  ),
  ScrollArea: MockCherrystudioUI.ScrollArea
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

vi.mock('@renderer/pages/knowledge/utils/error', () => ({
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
            'common.save': 'Save',
            'common.cancel': 'Cancel',
            'common.refresh': 'Refresh',
            'common.select': 'Select',
            'knowledge.governance.exclude': 'Exclude from retrieval',
            'knowledge.governance.include': 'Include in retrieval',
            'knowledge.governance.label': 'Label',
            'knowledge.governance.add_label': 'Add label',
            'knowledge.governance.remove_label': 'Remove label',
            'knowledge.governance.review': 'Review needed',
            'knowledge.governance.review_hint': 'Source changed. Review before editing.',
            'knowledge.governance.preview': 'Review selected chunks before saving.',
            'knowledge.governance.active': 'Active',
            'knowledge.governance.excluded': 'Excluded',
            'knowledge.governance.pending': 'Pending correction',
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

  const governed = (): KnowledgeItemChunk[] =>
    chunks.map((chunk, index) => ({
      ...chunk,
      governance: {
        sourceContentHash: 'a'.repeat(64),
        revision: index === 0 ? 0 : 4,
        excluded: false,
        labels: [],
        status: 'active'
      }
    }))
  const mutations = () =>
    mockIpcRequest.mock.calls.filter(([channel]) => channel === 'knowledge.apply_chunk_governance')

  it('never persists opening, selecting, previewing or cancelling a batch', async () => {
    const user = userEvent.setup()
    mockIpcRequest.mockResolvedValue(governed())
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Select 1' }))
    await user.click(screen.getByRole('button', { name: 'Exclude from retrieval' }))
    expect(screen.getByRole('region', { name: 'Review needed' })).toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  })

  it('confirms only the selected identities and revisions, then reloads the committed states', async () => {
    const user = userEvent.setup()
    const initial = governed()
    mockIpcRequest
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(
        initial.map((chunk) => ({
          ...chunk,
          governance: {
            ...chunk.governance!,
            excluded: true,
            status: 'excluded',
            revision: chunk.governance!.revision + 1
          }
        }))
      )
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Select 1' }))
    await user.click(screen.getByRole('button', { name: 'Select 2' }))
    await user.click(screen.getByRole('button', { name: 'Exclude from retrieval' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getAllByText('Excluded')).toHaveLength(2))
    expect(mutations()).toEqual([
      [
        'knowledge.apply_chunk_governance',
        {
          baseId: 'base-1',
          selection: [
            { itemId: 'file-1', unitId: 'chunk-1', sourceContentHash: 'a'.repeat(64), expectedRevision: 0 },
            { itemId: 'file-1', unitId: 'chunk-2', sourceContentHash: 'a'.repeat(64), expectedRevision: 4 }
          ],
          action: { kind: 'exclusion', excluded: true }
        }
      ]
    ])
    expect(screen.getByRole('button', { name: 'Select 1' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('previews and saves a trimmed label on the selected chunk without sending original text', async () => {
    const user = userEvent.setup()
    mockIpcRequest.mockResolvedValue(governed())
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Select 2' }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), '  priority  ')
    await user.click(screen.getByRole('button', { name: 'Add label' }))
    expect(screen.getByText('Add label: priority')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())
    expect(mutations()).toEqual([
      [
        'knowledge.apply_chunk_governance',
        {
          baseId: 'base-1',
          selection: [{ itemId: 'file-1', unitId: 'chunk-2', sourceContentHash: 'a'.repeat(64), expectedRevision: 4 }],
          action: { kind: 'label', operation: 'add', label: 'priority' }
        }
      ]
    ])
  })

  it('clears stale intent after a conflict and requires explicit refresh and reselection, never retrying', async () => {
    const user = userEvent.setup()
    mockIpcRequest
      .mockResolvedValueOnce(governed())
      .mockRejectedValueOnce(new Error('Revision changed; refresh'))
      .mockResolvedValueOnce(governed())
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Select 1' }))
    await user.click(screen.getByRole('button', { name: 'Include in retrieval' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Revision changed; refresh')
    expect(mutations()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('button', { name: 'Select 1' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(mutations()).toHaveLength(1)
  })

  it('prevents old selections from being applied while a different item is loading', async () => {
    const user = userEvent.setup()
    let resolve!: (value: KnowledgeItemChunk[]) => void
    mockIpcRequest
      .mockResolvedValueOnce(governed())
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValue(undefined)
    const view = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Select 1' }))
    view.rerender(<KnowledgeItemChunkDetailPanel baseId="base-1" itemId="file-2" onBack={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Exclude from retrieval' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select 1' })).not.toBeInTheDocument()
    await act(async () => {
      resolve(
        governed()
          .slice(0, 1)
          .map((chunk) => ({ ...chunk, id: 'new-chunk', itemId: 'file-2', content: 'New source' }))
      )
    })
    expect(await screen.findByText('New source')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select 1' })).toHaveAttribute('aria-pressed', 'false')
    expect(mutations()).toHaveLength(0)
  })

  it('ignores a late list response from a previous item', async () => {
    let resolve!: (value: KnowledgeItemChunk[]) => void
    mockIpcRequest
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValueOnce([{ ...governed()[0], content: 'Current item' }])
    const view = renderPanel()
    view.rerender(<KnowledgeItemChunkDetailPanel baseId="base-1" itemId="file-2" onBack={() => undefined} />)
    expect(await screen.findByText('Current item')).toBeInTheDocument()
    await act(async () => {
      resolve([{ ...governed()[0], content: 'Previous item' }])
    })
    expect(screen.queryByText('Previous item')).not.toBeInTheDocument()
    expect(screen.getByText('Current item')).toBeInTheDocument()
  })

  it('does not let an old save clear a new selection after switching away and back', async () => {
    const user = userEvent.setup()
    let resolve!: () => void
    mockIpcRequest.mockImplementation((channel: string) =>
      channel === 'knowledge.apply_chunk_governance'
        ? new Promise<void>((done) => {
            resolve = done
          })
        : Promise.resolve(governed())
    )
    const view = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Select 1' }))
    await user.click(screen.getByRole('button', { name: 'Exclude from retrieval' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    view.rerender(<KnowledgeItemChunkDetailPanel baseId="base-1" itemId="file-2" onBack={() => undefined} />)
    await screen.findByRole('button', { name: 'Select 1' })
    view.rerender(<KnowledgeItemChunkDetailPanel baseId="base-1" itemId="file-1" onBack={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: 'Select 2' }))
    await user.click(screen.getByRole('button', { name: 'Include in retrieval' }))
    await act(async () => {
      resolve()
    })
    expect(screen.getByRole('button', { name: 'Select 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(mutations()).toHaveLength(1)
  })

  it('makes changed-source chunks read-only and shows pending corrections without editing them', async () => {
    const initial = governed()
    initial[0].governance!.status = 'review-needed'
    initial[1].governance!.status = 'pending'
    initial[1].governance!.labels = ['retained']
    mockIpcRequest.mockResolvedValue(initial)
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Select 1' })).toBeDisabled()
    expect(screen.getByText('Pending correction')).toBeInTheDocument()
    expect(screen.getByText('retained')).toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  })

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
    expect(screen.getByText('145 tokens')).toBeInTheDocument()
    expect(screen.getByText('88 tokens')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容一')).toBeInTheDocument()
    expect(screen.getByText('真实 chunk 内容二')).toBeInTheDocument()
    // chunk index badges are 1-based (chunkIndex 0/1 render as 1/2)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
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

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '返回' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
