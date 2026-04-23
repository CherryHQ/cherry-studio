import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeV2Page from '../KnowledgeV2Page'

const mockUseKnowledgeBases = vi.fn()
const mockUseKnowledgeGroups = vi.fn()
const mockUseCreateKnowledgeGroup = vi.fn()
const mockUseCreateKnowledgeBase = vi.fn()
const mockUseUpdateKnowledgeBase = vi.fn()
const mockUseUpdateKnowledgeGroup = vi.fn()
const mockUseDeleteKnowledgeGroup = vi.fn()
const mockUseDeleteKnowledgeBase = vi.fn()
const mockUseKnowledgeItems = vi.fn()

vi.mock('../hooks', () => ({
  useKnowledgeBases: () => mockUseKnowledgeBases(),
  useKnowledgeGroups: () => mockUseKnowledgeGroups(),
  useCreateKnowledgeGroup: () => mockUseCreateKnowledgeGroup(),
  useCreateKnowledgeBase: () => mockUseCreateKnowledgeBase(),
  useUpdateKnowledgeBase: () => mockUseUpdateKnowledgeBase(),
  useUpdateKnowledgeGroup: () => mockUseUpdateKnowledgeGroup(),
  useDeleteKnowledgeGroup: () => mockUseDeleteKnowledgeGroup(),
  useDeleteKnowledgeBase: () => mockUseDeleteKnowledgeBase(),
  useKnowledgeItems: (baseId: string) => mockUseKnowledgeItems(baseId)
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../components/BaseNavigator', () => ({
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
    onCreateBase: () => void
    onMoveBase: (baseId: string, groupId: string) => Promise<void> | void
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
      <button type="button" onClick={onCreateBase}>
        新建知识库
      </button>
      {bases.map((base) => (
        <div key={base.id}>
          <button onClick={() => onSelectBase(base.id)} type="button">
            {base.name}
          </button>
          <button onClick={() => onRenameBase(base)} type="button">
            RenameBase {base.name}
          </button>
          <button onClick={() => void onMoveBase(base.id, groups[1]?.id ?? 'group-2')} type="button">
            Move {base.name}
          </button>
          <button onClick={() => void onDeleteBase(base.id)} type="button">
            Delete {base.name}
          </button>
        </div>
      ))}
      {groups.map((group) => (
        <div key={group.id}>
          <button onClick={() => onRenameGroup(group)} type="button">
            RenameGroup {group.name}
          </button>
          <button onClick={() => void onDeleteGroup(group.id)} type="button">
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
    onRenameBase
  }: {
    base: { id: string; name: string }
    onRenameBase: (base: { id: string; name: string }) => void
  }) => (
    <div>
      <div data-testid="detail-header">{base.name}</div>
      <button type="button" onClick={() => onRenameBase(base)}>
        HeaderRename {base.name}
      </button>
    </div>
  )
}))

vi.mock('../components/DetailTabs', () => ({
  default: ({
    dataSourceCount,
    onChange
  }: {
    dataSourceCount: number
    onChange: (tab: 'data' | 'rag' | 'recall') => void
  }) => (
    <div>
      <div data-testid="detail-tabs">{dataSourceCount}</div>
      <button type="button" onClick={() => onChange('rag')}>
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

vi.mock('../components/CreateKnowledgeBaseDialog', () => ({
  default: ({
    open,
    groups,
    createBase,
    onOpenChange,
    onCreated
  }: {
    open: boolean
    groups: Array<{ id: string; name: string }>
    createBase: (input: {
      name: string
      emoji: string
      groupId?: string
      embeddingModelId: string | null
      dimensions: string
    }) => Promise<KnowledgeBase>
    onOpenChange: (open: boolean) => void
    onCreated: (base: KnowledgeBase) => void
  }) =>
    open ? (
      <div data-testid="create-dialog">
        <div data-testid="create-dialog-groups">{groups.map((group) => group.name).join(',')}</div>
        <button
          type="button"
          onClick={async () => {
            const createdBase = await createBase({
              name: 'Base 2',
              emoji: '📚',
              embeddingModelId: 'openai::text-embedding-3-small',
              dimensions: '1536'
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

vi.mock('../components/KnowledgeGroupNameDialog', () => ({
  default: ({
    mode,
    open,
    initialName,
    onSubmit,
    onOpenChange
  }: {
    mode: 'create' | 'update'
    open: boolean
    initialName?: string
    onSubmit: (name: string) => Promise<void>
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid={`${mode}-group-dialog`}>
        <div data-testid="group-dialog-initial-name">{initialName ?? ''}</div>
        <button type="button" onClick={() => void onSubmit(mode === 'create' ? 'Group 2' : 'Renamed Group')}>
          {mode === 'create' ? 'Submit Create Group' : 'Submit Rename Group'}
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          {mode === 'create' ? 'Cancel Create Group' : 'Cancel Rename Group'}
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
  description: undefined,
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
  searchMode: undefined,
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
  })

  it('selects the first knowledge base after bases load', () => {
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

    render(<KnowledgeV2Page />)

    expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 1')
    expect(screen.getByTestId('group-names')).toHaveTextContent('Research,Archive')
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-1')
    expect(screen.getByTestId('detail-tabs')).toHaveTextContent('2')
    expect(screen.getByTestId('data-source-panel')).toHaveTextContent('2')

    fireEvent.click(screen.getByRole('button', { name: 'RAG' }))
    expect(screen.getByTestId('rag-config-panel')).toHaveTextContent('Base 1')
  })

  it('shows an empty state when no knowledge bases are available', () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgeV2Page />)

    expect(screen.getByText('暂无知识库')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-header')).not.toBeInTheDocument()
  })

  it('does not mount the create-group dialog before it is opened', () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgeV2Page />)

    expect(screen.queryByTestId('create-group-dialog')).not.toBeInTheDocument()
  })

  it('does not mount the create dialog before it is opened', () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgeV2Page />)

    expect(screen.queryByTestId('create-dialog')).not.toBeInTheDocument()
  })

  it('passes the current groups into the create knowledge base dialog', () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mockUseKnowledgeGroups.mockReturnValue({
      groups: [createGroup({ name: 'Research' }), createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: '新建知识库' }))

    expect(screen.getByTestId('create-dialog-groups')).toHaveTextContent('Research,Archive')
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

    render(<KnowledgeV2Page />)

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

    render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: 'RenameGroup Research' }))

    expect(screen.getByTestId('update-group-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('group-dialog-initial-name')).toHaveTextContent('Research')

    fireEvent.click(screen.getByRole('button', { name: 'Submit Rename Group' }))

    await waitFor(() => {
      expect(updateGroup).toHaveBeenCalledWith('group-1', { name: 'Renamed Group' })
    })
    expect(screen.queryByTestId('update-group-dialog')).not.toBeInTheDocument()
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

    render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: 'RenameBase Base 1' }))

    expect(screen.getByTestId('rename-base-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('base-dialog-initial-name')).toHaveTextContent('Base 1')

    fireEvent.click(screen.getByRole('button', { name: 'Submit Rename Base' }))

    await waitFor(() => {
      expect(updateBase).toHaveBeenCalledWith('base-1', { name: 'Renamed Base' })
    })
    expect(screen.queryByTestId('rename-base-dialog')).not.toBeInTheDocument()
  })

  it('opens the same knowledge base rename dialog from the detail header', () => {
    mockUseKnowledgeBases.mockReturnValue({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Base 1' })],
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })

    render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: 'HeaderRename Base 1' }))

    expect(screen.getByTestId('rename-base-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('base-dialog-initial-name')).toHaveTextContent('Base 1')
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

    render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: 'RenameBase Base 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit Same Name Base' }))

    await waitFor(() => {
      expect(screen.queryByTestId('rename-base-dialog')).not.toBeInTheDocument()
    })
    expect(updateBase).not.toHaveBeenCalled()
  })

  it('falls back to the first remaining base when the selected base disappears', () => {
    const firstBase = createKnowledgeBase({ id: 'base-1', name: 'Base 1' })
    const secondBase = createKnowledgeBase({ id: 'base-2', name: 'Base 2' })
    let bases = [firstBase, secondBase]

    mockUseKnowledgeBases.mockImplementation(() => ({
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

  it('opens the create dialog and selects the newly created knowledge base after success', async () => {
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

    const { rerender } = render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: '新建知识库' }))
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Submit Create' }))

    await waitFor(() => expect(createBase).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-2')

    bases = [firstBase, secondBase]
    rerender(<KnowledgeV2Page />)

    expect(screen.queryByTestId('create-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('selected-base-id')).toHaveTextContent('base-2')
    expect(screen.getByTestId('detail-header')).toHaveTextContent('Base 2')
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

    render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: 'Move Base 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Base 2' }))

    await waitFor(() => {
      expect(updateBase).toHaveBeenCalledWith('base-1', { groupId: 'group-2' })
      expect(deleteBase).toHaveBeenCalledWith('base-2')
    })
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

    render(<KnowledgeV2Page />)

    fireEvent.click(screen.getByRole('button', { name: 'DeleteGroup Research' }))

    await waitFor(() => {
      expect(deleteGroup).toHaveBeenCalledWith('group-1')
    })
  })
})
