import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgePage from '../KnowledgePage'

const mockUseKnowledgeBases = vi.fn()
const mockUseKnowledgeGroups = vi.fn()
const mockUseCreateKnowledgeGroup = vi.fn()
const mockUseCreateKnowledgeBase = vi.fn()
const mockUseRestoreKnowledgeBase = vi.fn()
const mockUseUpdateKnowledgeBase = vi.fn()
const mockUseUpdateKnowledgeGroup = vi.fn()
const mockUseDeleteKnowledgeGroup = vi.fn()
const mockUseDeleteKnowledgeBase = vi.fn()
const mockUseDeleteKnowledgeItem = vi.fn()
const mockUseKnowledgeItems = vi.fn()
const mockUseReindexKnowledgeItem = vi.fn()

vi.mock('@renderer/hooks/useKnowledgeBases', () => ({
  useKnowledgeBases: () => mockUseKnowledgeBases(),
  useCreateKnowledgeBase: () => mockUseCreateKnowledgeBase(),
  useRestoreKnowledgeBase: () => mockUseRestoreKnowledgeBase(),
  useUpdateKnowledgeBase: () => mockUseUpdateKnowledgeBase(),
  useDeleteKnowledgeBase: () => mockUseDeleteKnowledgeBase()
}))

vi.mock('../hooks', () => ({
  useKnowledgeGroups: () => mockUseKnowledgeGroups(),
  useCreateKnowledgeGroup: () => mockUseCreateKnowledgeGroup(),
  useUpdateKnowledgeGroup: () => mockUseUpdateKnowledgeGroup(),
  useDeleteKnowledgeGroup: () => mockUseDeleteKnowledgeGroup(),
  useDeleteKnowledgeItem: (baseId: string) => mockUseDeleteKnowledgeItem(baseId),
  useKnowledgeItems: (baseId: string) => mockUseKnowledgeItems(baseId),
  useReindexKnowledgeItem: (baseId: string) => mockUseReindexKnowledgeItem(baseId)
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../components/navigator', () => ({
  default: ({
    bases,
    groups,
    selectedBaseId,
    onSelectBase,
    onCreateGroup,
    onCreateBase,
    onMoveBase,
    onRenameBase,
    onRenameGroup,
    onDeleteGroup,
    onDeleteBase
  }: {
    bases: Array<{ id: string; name: string }>
    groups: Array<{ id: string; name: string }>
    selectedBaseId: string
    onSelectBase: (baseId: string) => void
    onCreateGroup: () => void
    onCreateBase: (groupId?: string) => void
    onMoveBase: (baseId: string, groupId: string | null) => Promise<void> | void
    onRenameBase: (base: { id: string; name: string }) => void
    onRenameGroup: (group: { id: string; name: string }) => void
    onDeleteGroup: (groupId: string) => Promise<void> | void
    onDeleteBase: (baseId: string) => Promise<void> | void
  }) => (
    <div>
      <div data-testid="base-count">{bases.length}</div>
      <div data-testid="group-names">{groups.map((group) => group.name).join(',')}</div>
      <div data-testid="selected-base-id">{selectedBaseId}</div>
      <button type="button" onClick={onCreateGroup}>
        新建分组
      </button>
      <button type="button" onClick={() => onCreateBase()}>
        新建知识库
      </button>
      {bases.map((base) => (
        <div key={base.id}>
          <button type="button" onClick={() => onSelectBase(base.id)}>
            {base.name}
          </button>
          <button type="button" onClick={() => onRenameBase(base)}>
            RenameBase {base.name}
          </button>
          <button type="button" onClick={() => void onMoveBase(base.id, groups[1]?.id ?? 'group-2')}>
            Move {base.name}
          </button>
          <button type="button" onClick={() => void onDeleteBase(base.id)}>
            Delete {base.name}
          </button>
        </div>
      ))}
      {groups.map((group) => (
        <div key={group.id}>
          <button type="button" onClick={() => onRenameGroup(group)}>
            RenameGroup {group.name}
          </button>
          <button type="button" onClick={() => onCreateBase(group.id)}>
            CreateBaseInGroup {group.name}
          </button>
          <button type="button" onClick={() => void onDeleteGroup(group.id)}>
            DeleteGroup {group.name}
          </button>
        </div>
      ))}
    </div>
  )
}))

vi.mock('../components/DetailHeader', () => ({
  default: ({
    base,
    itemCount,
    onRenameBase,
    onDeleteBase
  }: {
    base: KnowledgeBase
    itemCount: number
    onRenameBase: (base: { id: string; name: string }) => void
    onDeleteBase: (baseId: string) => Promise<void> | void
  }) => (
    <div>
      <div data-testid="detail-header">{base.name}</div>
      <div data-testid="detail-header-item-count">{itemCount}</div>
      <button type="button" onClick={() => onRenameBase(base)}>
        HeaderRename {base.name}
      </button>
      <button type="button" onClick={() => void onDeleteBase(base.id)}>
        HeaderDelete {base.name}
      </button>
    </div>
  )
}))

vi.mock('../components/DetailTabs', () => ({
  default: ({
    activeTab,
    dataSourceCount,
    onChange
  }: {
    activeTab: 'data' | 'rag' | 'recall'
    dataSourceCount: number
    onChange: (tab: 'data' | 'rag' | 'recall') => void
  }) => (
    <div>
      <div data-testid="detail-tabs">{dataSourceCount}</div>
      <div data-testid="active-tab">{activeTab}</div>
      <button type="button" onClick={() => onChange('data')}>
        Data
      </button>
      <button type="button" onClick={() => onChange('rag')}>
        RAG
      </button>
      <button type="button" onClick={() => onChange('recall')}>
        Recall
      </button>
    </div>
  )
}))

vi.mock('../panels/dataSource/DataSourcePanel', () => ({
  default: ({
    items,
    isLoading,
    onAdd,
    onItemClick,
    onDelete,
    onReindex
  }: {
    items: Array<{ id: string }>
    isLoading: boolean
    onAdd: () => void
    onItemClick: (itemId: string) => void
    onDelete: (item: { id: string }) => void | Promise<void>
    onReindex: (item: { id: string }) => void | Promise<void>
  }) => (
    <div>
      <div data-testid="data-source-panel">{`${items.length}:${isLoading ? 'loading' : 'idle'}`}</div>
      <button type="button" onClick={onAdd}>
        Open Add Source
      </button>
      {items.map((item) => (
        <div key={item.id}>
          <button type="button" onClick={() => onItemClick(item.id)}>
            OpenChunks {item.id}
          </button>
          <button type="button" onClick={() => void onDelete(item)}>
            DeleteItem {item.id}
          </button>
          <button type="button" onClick={() => void onReindex(item)}>
            Reindex {item.id}
          </button>
        </div>
      ))}
    </div>
  )
}))

vi.mock('../panels/dataSource/KnowledgeItemChunkDetailPanel', () => ({
  default: ({ itemId, onBack }: { itemId: string; onBack: () => void }) => (
    <div data-testid="chunk-detail-panel">
      <div>{`chunks:${itemId}`}</div>
      <button type="button" onClick={onBack}>
        BackToSources
      </button>
    </div>
  )
}))

vi.mock('../panels/ragConfig/RagConfigPanel', () => ({
  default: ({ base, onRestoreBase }: { base: KnowledgeBase; onRestoreBase: (base: KnowledgeBase) => void }) => (
    <div data-testid="rag-config-panel">
      {base.name}
      <button type="button" onClick={() => onRestoreBase(base)}>
        RagRestore {base.name}
      </button>
    </div>
  )
}))

vi.mock('../panels/recallTest/RecallTestPanel', () => ({
  default: () => <div data-testid="recall-test-panel">recall-test-panel</div>
}))

vi.mock('../components/AddKnowledgeItemDialog', () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? (
      <div data-testid="add-source-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close Add Source
        </button>
      </div>
    ) : null
}))

vi.mock('../components/CreateKnowledgeBaseDialog', () => ({
  default: ({
    open,
    groups,
    initialGroupId,
    createBase,
    onOpenChange,
    onCreated
  }: {
    open: boolean
    groups: Array<{ id: string; name: string }>
    initialGroupId?: string
    createBase: (input: {
      name: string
      emoji: string
      groupId?: string
      embeddingModelId: string | null
      dimensions: number
    }) => Promise<KnowledgeBase>
    onOpenChange: (open: boolean) => void
    onCreated: (base: KnowledgeBase) => void
  }) =>
    open ? (
      <div data-testid="create-dialog">
        <div data-testid="create-dialog-groups">{groups.map((group) => group.name).join(',')}</div>
        <div data-testid="create-dialog-initial-group-id">{initialGroupId}</div>
        <button
          type="button"
          onClick={async () => {
            const createdBase = await createBase({
              name: 'Base 2',
              emoji: '📚',
              ...(initialGroupId ? { groupId: initialGroupId } : {}),
              embeddingModelId: 'openai::text-embedding-3-small',
              dimensions: 1536
            })
            onCreated(createdBase)
            onOpenChange(false)
          }}>
          Submit Create
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel Create
        </button>
      </div>
    ) : null
}))

vi.mock('../components/RestoreKnowledgeBaseDialog', () => ({
  default: ({
    open,
    base,
    restoreBase,
    onOpenChange,
    onRestored
  }: {
    open: boolean
    base: KnowledgeBase
    restoreBase: (input: {
      sourceBaseId: string
      name: string
      embeddingModelId: string | null
      dimensions: number
    }) => Promise<KnowledgeBase>
    onOpenChange: (open: boolean) => void
    onRestored: (base: KnowledgeBase) => void
  }) =>
    open ? (
      <div data-testid="restore-dialog">
        <div data-testid="restore-dialog-source-name">{base.name}</div>
        <button
          type="button"
          onClick={async () => {
            const restoredBase = await restoreBase({
              sourceBaseId: base.id,
              name: `${base.name}_副本`,
              embeddingModelId: 'openai::text-embedding-3-small',
              dimensions: 1024
            })
            onRestored(restoredBase)
            onOpenChange(false)
          }}>
          Submit Restore
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel Restore
        </button>
      </div>
    ) : null
}))

vi.mock('../components/CreateKnowledgeGroupDialog', () => ({
  default: ({
    open,
    onSubmit,
    onOpenChange
  }: {
    open: boolean
    onSubmit: (name: string) => Promise<void>
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="create-group-dialog">
        <button type="button" onClick={() => void onSubmit('Group 2')}>
          Submit Create Group
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel Create Group
        </button>
      </div>
    ) : null
}))

vi.mock('../components/RenameKnowledgeGroupDialog', () => ({
  default: ({
    open,
    initialName,
    onSubmit,
    onOpenChange
  }: {
    open: boolean
    initialName: string
    onSubmit: (name: string) => Promise<void>
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="rename-group-dialog">
        <div data-testid="group-dialog-initial-name">{initialName}</div>
        <button type="button" onClick={() => void onSubmit('Renamed Group')}>
          Submit Rename Group
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel Rename Group
        </button>
      </div>
    ) : null
}))

vi.mock('../components/KnowledgeBaseNameDialog', () => ({
  default: ({
    open,
    initialName,
    onSubmit,
    onOpenChange
  }: {
    open: boolean
    initialName: string
    onSubmit: (name: string) => Promise<void>
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="rename-base-dialog">
        <div data-testid="base-dialog-initial-name">{initialName}</div>
        <button type="button" onClick={() => void onSubmit('Renamed Base')}>
          Submit Rename Base
        </button>
        <button type="button" onClick={() => void onSubmit(initialName)}>
          Submit Same Name Base
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel Rename Base
        </button>
      </div>
    ) : null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.loading': '加载中...',
          'knowledge_v2.empty': '暂无知识库',
          'knowledge_v2.title': '知识库'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: undefined,
  documentCount: undefined,
  status: 'completed',
  error: null,
  searchMode: 'hybrid',
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

const createGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'group-1',
  entityType: 'knowledge',
  name: 'Research',
  orderKey: 'a0',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides
})

const createKnowledgeItem = ({ id }: { id: string }): KnowledgeItemOf<'note'> => ({
  baseId: 'base-1',
  groupId: null,
  id,
  type: 'note',
  data: {
    source: id,
    content: 'Example note'
  },
  status: 'completed',
  phase: null,
  error: null,
  createdAt: '2026-04-21T10:00:00+08:00',
  updatedAt: '2026-04-21T10:00:00+08:00'
})

describe('KnowledgePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCreateKnowledgeGroup.mockReturnValue({
      createGroup: vi.fn(),
      isCreating: false,
      createError: undefined
    })
    mockUseCreateKnowledgeBase.mockReturnValue({
      createBase: vi.fn(),
      isCreating: false,
      createError: undefined
    })
    mockUseRestoreKnowledgeBase.mockReturnValue({
      restoreBase: vi.fn(),
      isRestoring: false,
      restoreError: undefined
    })
    mockUseKnowledgeGroups.mockReturnValue({
      groups: [createGroup(), createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseUpdateKnowledgeBase.mockReturnValue({
      updateBase: vi.fn(),
      isUpdating: false,
      updateError: undefined
    })
    mockUseUpdateKnowledgeGroup.mockReturnValue({
      updateGroup: vi.fn(),
      isUpdating: false,
      updateError: undefined
    })
    mockUseDeleteKnowledgeGroup.mockReturnValue({
      deleteGroup: vi.fn(),
      isDeleting: false,
      deleteError: undefined
    })
    mockUseDeleteKnowledgeBase.mockReturnValue({
      deleteBase: vi.fn(),
      isDeleting: false,
      deleteError: undefined
    })
    mockUseKnowledgeItems.mockReturnValue({
      items: [],
      total: 0,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseDeleteKnowledgeItem.mockReturnValue({
      deleteItem: vi.fn(),
      isDeleting: false,
      error: undefined
    })
    mockUseReindexKnowledgeItem.mockReturnValue({
      reindexItem: vi.fn(),
      isReindexing: false,
      error: undefined
    })
  })

  it('auto-selects the first knowledge base after bases load', async () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [
        createKnowledgeBase({ id: 'base-1', name: 'Base 1' }),
        createKnowledgeBase({ id: 'base-2', name: 'Base 2' })
      ],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeItems.mockImplementation((baseId: string) => ({
      items:
        baseId === 'base-1'
          ? [createKnowledgeItem({ id: 'item-1' }), createKnowledgeItem({ id: 'item-2' })]
          : [createKnowledgeItem({ id: 'item-3' })],
      total: baseId === 'base-1' ? 2 : 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    }))

    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 1')
    })
    expect(screen.getByTestId('group-names')).toHaveTextContent('Research,Archive')
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-1')
    expect(screen.getByTestId('detail-header-item-count')).toHaveTextContent('2')
    expect(screen.getByTestId('detail-tabs')).toHaveTextContent('2')
    expect(screen.getByTestId('data-source-panel')).toHaveTextContent('2:idle')
  })

  it('switches tabs and renders the matching detail panel', async () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeItems.mockReturnValue({
      items: [createKnowledgeItem({ id: 'item-1' })],
      total: 1,
      isLoading: true,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('active-tab')).toHaveTextContent('data')
    })
    expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:loading')

    fireEvent.click(screen.getByRole('button', { name: 'RAG' }))
    expect(screen.getByTestId('active-tab')).toHaveTextContent('rag')
    expect(screen.getByTestId('rag-config-panel')).toHaveTextContent('Base 1')

    fireEvent.click(screen.getByRole('button', { name: 'Recall' }))
    expect(screen.getByTestId('active-tab')).toHaveTextContent('recall')
    expect(screen.getByTestId('recall-test-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(screen.getByTestId('active-tab')).toHaveTextContent('data')
    expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:loading')
  })

  it('opens and closes the add-source dialog from the data source panel when a knowledge base is selected', async () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeItems.mockReturnValue({
      items: [createKnowledgeItem({ id: 'item-1' })],
      total: 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:idle')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Add Source' }))
    expect(screen.getByTestId('add-source-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close Add Source' }))
    expect(screen.queryByTestId('add-source-dialog')).not.toBeInTheDocument()
  })

  it('wires data source delete actions to the selected base delete hook', async () => {
    const deleteItem = vi.fn()
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeItems.mockReturnValue({
      items: [createKnowledgeItem({ id: 'item-1' })],
      total: 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseDeleteKnowledgeItem.mockReturnValue({
      deleteItem,
      isDeleting: false,
      error: undefined
    })

    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:idle')
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeleteItem item-1' }))

    expect(mockUseDeleteKnowledgeItem).toHaveBeenCalledWith('base-1')
    expect(deleteItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
  })

  it('wires data source reindex actions to the selected base reindex hook', async () => {
    const reindexItem = vi.fn()
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeItems.mockReturnValue({
      items: [createKnowledgeItem({ id: 'item-1' })],
      total: 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseReindexKnowledgeItem.mockReturnValue({
      reindexItem,
      isReindexing: false,
      error: undefined
    })

    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:idle')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reindex item-1' }))

    expect(mockUseReindexKnowledgeItem).toHaveBeenCalledWith('base-1')
    expect(reindexItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
  })

  it('opens item chunks from the data source list and returns to the list', async () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeItems.mockReturnValue({
      items: [createKnowledgeItem({ id: 'item-1' })],
      total: 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:idle')
    })

    fireEvent.click(screen.getByRole('button', { name: 'OpenChunks item-1' }))

    expect(screen.getByTestId('chunk-detail-panel')).toHaveTextContent('chunks:item-1')
    expect(screen.queryByTestId('data-source-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'BackToSources' }))

    expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:idle')
  })

  it('clears open item chunks when switching away from the data tab', async () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeItems.mockReturnValue({
      items: [createKnowledgeItem({ id: 'item-1' })],
      total: 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:idle')
    })

    fireEvent.click(screen.getByRole('button', { name: 'OpenChunks item-1' }))
    expect(screen.getByTestId('chunk-detail-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'RAG' }))
    expect(screen.getByTestId('rag-config-panel')).toHaveTextContent('Base 1')

    fireEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(screen.getByTestId('data-source-panel')).toHaveTextContent('1:idle')
    expect(screen.queryByTestId('chunk-detail-panel')).not.toBeInTheDocument()
  })

  it('shows the loading state when bases are still loading', () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [],
      isLoading: true,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgePage />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-header')).not.toBeInTheDocument()
  })

  it('shows the empty state when no knowledge bases are available', () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgePage />)

    expect(screen.getByText('暂无知识库')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-header')).not.toBeInTheDocument()
  })

  it('opens the create-group dialog and wires submission to the group mutation hook', async () => {
    const createGroupMock = vi.fn().mockResolvedValue(createGroup({ id: 'group-2', name: 'Group 2', orderKey: 'a1' }))

    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseCreateKnowledgeGroup.mockReturnValue({
      createGroup: createGroupMock,
      isCreating: false,
      createError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: '新建分组' }))
    expect(screen.getByTestId('create-group-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit Create Group' }))

    await waitFor(() => {
      expect(createGroupMock).toHaveBeenCalledWith('Group 2')
    })
    expect(screen.queryByTestId('create-group-dialog')).not.toBeInTheDocument()
  })

  it('opens the rename dialog with the current name and updates the selected group', async () => {
    const updateGroup = vi.fn().mockResolvedValue(undefined)

    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseUpdateKnowledgeGroup.mockReturnValue({
      updateGroup,
      isUpdating: false,
      updateError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'RenameGroup Research' }))

    expect(screen.getByTestId('rename-group-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('group-dialog-initial-name')).toHaveTextContent('Research')

    fireEvent.click(screen.getByRole('button', { name: 'Submit Rename Group' }))

    await waitFor(() => {
      expect(updateGroup).toHaveBeenCalledWith('group-1', { name: 'Renamed Group' })
    })
    expect(screen.queryByTestId('rename-group-dialog')).not.toBeInTheDocument()
  })

  it('passes group deletion through to the delete-group hook', async () => {
    const deleteGroup = vi.fn().mockResolvedValue(undefined)

    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseDeleteKnowledgeGroup.mockReturnValue({
      deleteGroup,
      isDeleting: false,
      deleteError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'DeleteGroup Research' }))

    await waitFor(() => {
      expect(deleteGroup).toHaveBeenCalledWith('group-1')
    })
  })

  it('opens the knowledge base rename dialog from the navigator and updates the selected base', async () => {
    const updateBase = vi.fn().mockResolvedValue(undefined)

    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseUpdateKnowledgeBase.mockReturnValue({
      updateBase,
      isUpdating: false,
      updateError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'RenameBase Base 1' }))

    expect(screen.getByTestId('rename-base-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('base-dialog-initial-name')).toHaveTextContent('Base 1')

    fireEvent.click(screen.getByRole('button', { name: 'Submit Rename Base' }))

    await waitFor(() => {
      expect(updateBase).toHaveBeenCalledWith('base-1', { name: 'Renamed Base' })
    })
    expect(screen.queryByTestId('rename-base-dialog')).not.toBeInTheDocument()
  })

  it('reuses the same rename-base flow when the detail header triggers it', () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'HeaderRename Base 1' }))

    expect(screen.getByTestId('rename-base-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('base-dialog-initial-name')).toHaveTextContent('Base 1')
  })

  it('wires detail header delete to the knowledge base delete hook', async () => {
    const deleteBase = vi.fn().mockResolvedValue(undefined)

    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseDeleteKnowledgeBase.mockReturnValue({
      deleteBase,
      isDeleting: false,
      deleteError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'HeaderDelete Base 1' }))

    await waitFor(() => {
      expect(deleteBase).toHaveBeenCalledWith('base-1')
    })
  })

  it('closes the knowledge base rename dialog without updating when the trimmed name is unchanged', async () => {
    const updateBase = vi.fn().mockResolvedValue(undefined)

    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseUpdateKnowledgeBase.mockReturnValue({
      updateBase,
      isUpdating: false,
      updateError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'RenameBase Base 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit Same Name Base' }))

    await waitFor(() => {
      expect(screen.queryByTestId('rename-base-dialog')).not.toBeInTheDocument()
    })
    expect(updateBase).not.toHaveBeenCalled()
  })

  it('falls back to the first remaining base when the selected base disappears', async () => {
    const firstBase = createKnowledgeBase({ id: 'base-1', name: 'Base 1' })
    const secondBase = createKnowledgeBase({ id: 'base-2', name: 'Base 2' })
    let bases = [firstBase, secondBase]

    mockUseKnowledgeBases.mockImplementation(() => ({
      bases,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    }))

    const { rerender } = render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Base 2' }))
    await waitFor(() => {
      expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 2')
    })

    bases = [firstBase]
    rerender(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 1')
    })
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-1')
  })

  it('opens the create dialog, passes groups through, and selects the newly created knowledge base after success', async () => {
    const firstBase = createKnowledgeBase({ id: 'base-1', name: 'Base 1' })
    const secondBase = createKnowledgeBase({ id: 'base-2', name: 'Base 2', emoji: '📚' })
    let bases = [firstBase]
    const createBase = vi.fn().mockResolvedValue(secondBase)

    mockUseKnowledgeBases.mockImplementation(() => ({
      bases,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    }))
    mockUseCreateKnowledgeBase.mockReturnValue({
      createBase,
      isCreating: false,
      createError: undefined
    })
    mockUseKnowledgeItems.mockImplementation((baseId: string) => ({
      items: baseId === 'base-2' ? [createKnowledgeItem({ id: 'item-2' })] : [createKnowledgeItem({ id: 'item-1' })],
      total: 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    }))

    const { rerender } = render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: '新建知识库' }))
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('create-dialog-groups')).toHaveTextContent('Research,Archive')

    fireEvent.click(screen.getByRole('button', { name: 'Submit Create' }))

    await waitFor(() => expect(createBase).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-2')

    bases = [firstBase, secondBase]
    rerender(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 2')
    })
    expect(screen.queryByTestId('create-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-2')
  })

  it('opens the create dialog with the selected group id from a group action', async () => {
    const createdBase = createKnowledgeBase({ id: 'base-2', name: 'Base 2', emoji: '📚', groupId: 'group-2' })
    const createBase = vi.fn().mockResolvedValue(createdBase)

    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseCreateKnowledgeBase.mockReturnValue({
      createBase,
      isCreating: false,
      createError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'CreateBaseInGroup Archive' }))

    expect(screen.getByTestId('create-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('create-dialog-initial-group-id')).toHaveTextContent('group-2')

    fireEvent.click(screen.getByRole('button', { name: 'Submit Create' }))

    await waitFor(() => {
      expect(createBase).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-2' }))
    })
  })

  it('opens the restore dialog from the RAG config panel and selects the restored knowledge base after success', async () => {
    const failedBase = createKnowledgeBase({
      id: 'failed-base',
      name: 'Legacy KB',
      groupId: 'group-1',
      status: 'failed',
      error: 'missing_embedding_model',
      dimensions: null,
      embeddingModelId: null
    })
    const restoredBase = createKnowledgeBase({
      id: 'restored-base',
      name: 'Legacy KB_副本',
      groupId: 'group-1',
      status: 'completed',
      error: null,
      dimensions: 1024,
      embeddingModelId: 'openai::text-embedding-3-small'
    })
    let bases = [failedBase]
    const restoreBase = vi.fn().mockResolvedValue(restoredBase)

    mockUseKnowledgeBases.mockImplementation(() => ({
      bases,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    }))
    mockUseRestoreKnowledgeBase.mockReturnValue({
      restoreBase,
      isRestoring: false,
      restoreError: undefined
    })
    mockUseKnowledgeItems.mockImplementation((baseId: string) => ({
      items:
        baseId === 'restored-base'
          ? [createKnowledgeItem({ id: 'restored-item' })]
          : [createKnowledgeItem({ id: 'failed-item' })],
      total: 1,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    }))

    const { rerender } = render(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('detail-header')).toHaveTextContent('Legacy KB')
    })

    fireEvent.click(screen.getByRole('button', { name: 'RAG' }))
    fireEvent.click(screen.getByRole('button', { name: 'RagRestore Legacy KB' }))
    expect(screen.getByTestId('restore-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('restore-dialog-source-name')).toHaveTextContent('Legacy KB')

    fireEvent.click(screen.getByRole('button', { name: 'Submit Restore' }))

    await waitFor(() =>
      expect(restoreBase).toHaveBeenCalledWith({
        sourceBaseId: 'failed-base',
        name: 'Legacy KB_副本',
        embeddingModelId: 'openai::text-embedding-3-small',
        dimensions: 1024
      })
    )
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('restored-base')

    bases = [failedBase, restoredBase]
    rerender(<KnowledgePage />)

    await waitFor(() => {
      expect(screen.getByTestId('detail-header')).toHaveTextContent('Legacy KB_副本')
    })
    expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('restored-base')
  })

  it('clears the initial group id after closing a grouped create dialog', async () => {
    const createBase = vi.fn().mockResolvedValue(createKnowledgeBase({ id: 'base-2', name: 'Base 2', emoji: '📚' }))

    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseCreateKnowledgeBase.mockReturnValue({
      createBase,
      isCreating: false,
      createError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'CreateBaseInGroup Archive' }))
    expect(screen.getByTestId('create-dialog-initial-group-id')).toHaveTextContent('group-2')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Create' }))
    fireEvent.click(screen.getByRole('button', { name: '新建知识库' }))

    expect(screen.getByTestId('create-dialog-initial-group-id')).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: 'Submit Create' }))

    await waitFor(() => {
      expect(createBase).toHaveBeenCalledWith(expect.not.objectContaining({ groupId: expect.any(String) }))
    })
  })

  it('wires move and delete actions to the knowledge base mutation hooks', async () => {
    const updateBase = vi.fn().mockResolvedValue(undefined)
    const deleteBase = vi.fn().mockResolvedValue(undefined)

    mockUseKnowledgeBases.mockReturnValue({
      bases: [
        createKnowledgeBase({ id: 'base-1', name: 'Base 1' }),
        createKnowledgeBase({ id: 'base-2', name: 'Base 2' })
      ],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseUpdateKnowledgeBase.mockReturnValue({
      updateBase,
      isUpdating: false,
      updateError: undefined
    })
    mockUseDeleteKnowledgeBase.mockReturnValue({
      deleteBase,
      isDeleting: false,
      deleteError: undefined
    })

    render(<KnowledgePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Move Base 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Base 2' }))

    await waitFor(() => {
      expect(updateBase).toHaveBeenCalledWith('base-1', { groupId: 'group-2' })
      expect(deleteBase).toHaveBeenCalledWith('base-2')
    })
  })
})
