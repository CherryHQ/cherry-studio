import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeV2Page from '../KnowledgeV2Page'

const mockUseKnowledgeV2Bases = vi.fn()
const mockUseKnowledgeV2Items = vi.fn()

vi.mock('../hooks/useKnowledgeV2Bases', () => ({
  useKnowledgeV2Bases: () => mockUseKnowledgeV2Bases()
}))

vi.mock('../hooks/useKnowledgeV2Items', () => ({
  useKnowledgeV2Items: (baseId: string) => mockUseKnowledgeV2Items(baseId)
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../components/BaseNavigator', () => ({
  default: ({
    bases,
    selectedBaseId,
    onSelectBase
  }: {
    bases: Array<{ base: { id: string; name: string }; itemCount: number }>
    selectedBaseId: string
    onSelectBase: (baseId: string) => void
  }) => (
    <div>
      <div data-testid="base-count">{bases.length}</div>
      <div data-testid="selected-base-id">{selectedBaseId}</div>
      <div data-testid="selected-base-doc-count">
        {bases.find((base) => base.base.id === selectedBaseId)?.itemCount ?? -1}
      </div>
      {bases.map((base) => (
        <button key={base.base.id} onClick={() => onSelectBase(base.base.id)} type="button">
          {base.base.name}
        </button>
      ))}
    </div>
  )
}))

vi.mock('../components/DetailHeader', () => ({
  default: ({ base }: { base: { base: { name: string } } }) => <div data-testid="detail-header">{base.base.name}</div>
}))

vi.mock('../components/DetailTabs', () => ({
  default: ({
    dataSourceCount,
    onChange
  }: {
    dataSourceCount: number
    onChange: (tab: 'dataSource' | 'ragConfig' | 'recallTest') => void
  }) => (
    <div>
      <div data-testid="detail-tabs">{dataSourceCount}</div>
      <button type="button" onClick={() => onChange('ragConfig')}>
        RAG
      </button>
    </div>
  )
}))

vi.mock('../panels/dataSource/DataSourcePanel', () => ({
  default: ({ items }: { items: Array<{ id: string }> }) => <div data-testid="data-source-panel">{items.length}</div>
}))

vi.mock('../panels/ragConfig/RagConfigPanel', () => ({
  default: ({ base }: { base: { id: string; name: string } }) => <div data-testid="rag-config-panel">{base.name}</div>
}))

vi.mock('../panels/recallTest/RecallTestPanel', () => ({
  default: () => <div>recall-test-panel</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.loading': '加载中...',
          'knowledge.empty': '暂无知识库',
          'knowledge.title': '知识库'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase>): KnowledgeBase => ({
  id: '',
  name: '',
  description: undefined,
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: undefined,
  chunkOverlap: undefined,
  threshold: undefined,
  documentCount: undefined,
  searchMode: undefined,
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

const createKnowledgeItem = ({ id }: { id: string }): KnowledgeItemOf<'note'> => ({
  baseId: 'base-1',
  groupId: null,
  id,
  type: 'note',
  data: {
    content: 'Example note'
  },
  status: 'completed',
  error: null,
  createdAt: '2026-04-21T10:00:00+08:00',
  updatedAt: '2026-04-21T10:00:00+08:00'
})

describe('KnowledgeV2Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseKnowledgeV2Items.mockReturnValue({
      items: [],
      total: 0,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
  })

  it('selects the first knowledge base after bases load and uses real item count for the selected base tab', () => {
    mockUseKnowledgeV2Bases.mockReturnValue({
      bases: [
        createKnowledgeBase({ id: 'base-1', name: 'Base 1' }),
        createKnowledgeBase({ id: 'base-2', name: 'Base 2' })
      ],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeV2Items.mockImplementation((baseId: string) => ({
      items:
        baseId === 'base-1'
          ? [createKnowledgeItem({ id: 'item-1' }), createKnowledgeItem({ id: 'item-2' })]
          : [createKnowledgeItem({ id: 'item-3' })],
      total: baseId === 'base-1' ? 2 : 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    }))

    render(<KnowledgeV2Page />)

    expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 1')
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-1')
    expect(screen.getByTestId('selected-base-doc-count')).toHaveTextContent('2')
    expect(screen.getByTestId('detail-tabs')).toHaveTextContent('2')
    expect(screen.getByTestId('data-source-panel')).toHaveTextContent('2')

    fireEvent.click(screen.getByRole('button', { name: 'RAG' }))
    expect(screen.getByTestId('rag-config-panel')).toHaveTextContent('Base 1')
  })

  it('shows an empty state when no knowledge bases are available', () => {
    mockUseKnowledgeV2Bases.mockReturnValue({
      bases: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgeV2Page />)

    expect(screen.getByText('暂无知识库')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-header')).not.toBeInTheDocument()
  })

  it('falls back to the first remaining base when the selected base disappears', () => {
    const firstBase = createKnowledgeBase({ id: 'base-1', name: 'Base 1' })
    const secondBase = createKnowledgeBase({ id: 'base-2', name: 'Base 2' })
    let bases = [firstBase, secondBase]

    mockUseKnowledgeV2Bases.mockImplementation(() => ({
      bases,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    }))

    const { rerender } = render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: 'Base 2' }))
    expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 2')

    bases = [firstBase]
    rerender(<KnowledgeV2Page />)

    expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 1')
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-1')
  })
})
