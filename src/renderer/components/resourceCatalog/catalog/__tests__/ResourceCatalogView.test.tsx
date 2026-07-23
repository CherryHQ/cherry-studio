import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourceCatalogView } from '../ResourceCatalogView'

const {
  dialogImplementationsLoadedMock,
  refetchMock,
  resourceCatalogControllerMock,
  resourceCreateWizardMock,
  resourceGridMock,
  skillDetailDialogMock,
  systemSkillDialogMock
} = vi.hoisted(() => ({
  dialogImplementationsLoadedMock: vi.fn(),
  refetchMock: vi.fn(),
  resourceCatalogControllerMock: vi.fn(),
  resourceCreateWizardMock: vi.fn(),
  resourceGridMock: vi.fn(),
  skillDetailDialogMock: vi.fn(),
  systemSkillDialogMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.error': 'Error',
          'common.retry': 'Retry'
        }) satisfies Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ action, description, message }: { action?: ReactNode; description?: ReactNode; message?: ReactNode }) => (
    <div role="alert">
      {message}
      {description}
      {action}
    </div>
  ),
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void; size?: string; variant?: string }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/create', () => {
  dialogImplementationsLoadedMock('create')
  return {
    ResourceCreateWizard: (props: { kind: string; open: boolean }) => {
      resourceCreateWizardMock(props)
      return props.open ? <div data-kind={props.kind} data-testid="resource-create-wizard" /> : null
    }
  }
})
vi.mock('@renderer/components/resourceCatalog/dialogs/delete', () => ({
  ResourceDeleteConfirmDialog: () => null
}))
vi.mock('@renderer/components/resourceCatalog/dialogs/detail', () => {
  dialogImplementationsLoadedMock('detail')
  return {
    SkillDetailDialog: (props: { open: boolean; skill: { id: string } | null }) => {
      skillDetailDialogMock(props)
      return props.open ? <div data-skill-id={props.skill?.id} data-testid="skill-detail-dialog" /> : null
    }
  }
})
vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => {
  dialogImplementationsLoadedMock('edit')
  return {
    AgentEditDialog: () => null,
    AssistantEditDialog: () => null
  }
})
vi.mock('@renderer/components/resourceCatalog/dialogs/import', () => {
  dialogImplementationsLoadedMock('import')
  return { ImportAssistantDialog: () => null }
})
vi.mock('@renderer/components/resourceCatalog/dialogs/skill', () => {
  dialogImplementationsLoadedMock('skill')
  return {
    ImportSkillDialog: () => null,
    SkillMarketplaceDialog: () => null,
    SystemSkillDialog: (props: { mode: 'manage' | 'agent-create' }) => {
      systemSkillDialogMock(props)
      return null
    }
  }
})

vi.mock('@renderer/utils/resourceCatalog/assistantModelFilter', () => ({
  isSelectableAssistantModel: () => true
}))

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelFilter: () => () => true
}))

vi.mock('@renderer/hooks/resourceCatalog/useResourceCatalogController', () => ({
  useResourceCatalogController: resourceCatalogControllerMock
}))

vi.mock('../AssistantLibraryDialog', () => {
  dialogImplementationsLoadedMock('assistant-library')
  return { AssistantLibraryDialog: () => null }
})

vi.mock('../ResourceGrid', () => ({
  ResourceGrid: (props: { toolbarLeading?: ReactNode }) => {
    resourceGridMock(props)

    return <div data-testid="resource-grid">{props.toolbarLeading}</div>
  }
}))

function createController(resourceError?: Error) {
  return {
    resourceError,
    refetch: refetchMock,
    gridProps: {
      activeResourceType: 'assistant',
      activeGroupId: null,
      allGroups: [],
      groups: [],
      isLoading: false,
      onAddGroup: vi.fn(),
      onCreate: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      onEdit: vi.fn(),
      onExport: vi.fn(),
      onImportAssistant: vi.fn(),
      onOpenAssistantLibrary: vi.fn(),
      onOpenSkillMarketplace: vi.fn(),
      onOpenSystemSkills: vi.fn(),
      onSearchChange: vi.fn(),
      onGroupFilter: vi.fn(),
      resources: [],
      search: ''
    },
    dialogs: {
      assistantImportOpen: false,
      assistantLibraryOpen: false,
      createDialogKind: null,
      createDialogOpen: false,
      creatingResource: false,
      deleteConfirm: null,
      editDialog: null,
      editDialogOpen: false,
      handleCreateDialogOpenChange: vi.fn(),
      handleEditDialogOpenChange: vi.fn(),
      handleEditSaved: vi.fn(),
      handleSubmitCreateResource: vi.fn(),
      selectedSkill: null,
      setAssistantImportOpen: vi.fn(),
      setAssistantLibraryOpen: vi.fn(),
      setDeleteConfirm: vi.fn(),
      setSelectedSkill: vi.fn(),
      setSkillImportOpen: vi.fn(),
      setSkillMarketplaceOpen: vi.fn(),
      setSystemSkillOpen: vi.fn(),
      skillImportOpen: false,
      skillMarketplaceOpen: false,
      systemSkillOpen: false
    }
  }
}

describe('ResourceCatalogView', () => {
  beforeEach(() => {
    dialogImplementationsLoadedMock.mockClear()
    refetchMock.mockClear()
    resourceCatalogControllerMock.mockReset()
    resourceCreateWizardMock.mockClear()
    resourceGridMock.mockClear()
    skillDetailDialogMock.mockClear()
    systemSkillDialogMock.mockClear()
    resourceCatalogControllerMock.mockReturnValue(createController())
  })

  it('loads dialog implementations only after activation and keeps the dialog host mounted', async () => {
    const inactiveController = createController()
    resourceCatalogControllerMock.mockReturnValue(inactiveController)
    const { rerender } = render(<ResourceCatalogView resourceType="assistant" />)

    expect(dialogImplementationsLoadedMock).not.toHaveBeenCalled()

    resourceCatalogControllerMock.mockReturnValue({
      ...inactiveController,
      dialogs: {
        ...inactiveController.dialogs,
        createDialogKind: 'assistant',
        createDialogOpen: true
      }
    })
    rerender(<ResourceCatalogView resourceType="assistant" />)

    expect(await screen.findByTestId('resource-create-wizard')).toHaveAttribute('data-kind', 'assistant')
    expect(dialogImplementationsLoadedMock).toHaveBeenCalledWith('create')
    expect(dialogImplementationsLoadedMock).toHaveBeenCalledWith('detail')
    expect(dialogImplementationsLoadedMock).toHaveBeenCalledWith('edit')
    expect(dialogImplementationsLoadedMock).toHaveBeenCalledWith('import')
    expect(dialogImplementationsLoadedMock).toHaveBeenCalledWith('skill')
    expect(dialogImplementationsLoadedMock).toHaveBeenCalledWith('assistant-library')

    resourceCatalogControllerMock.mockReturnValue(inactiveController)
    rerender(<ResourceCatalogView resourceType="assistant" />)

    expect(screen.queryByTestId('resource-create-wizard')).not.toBeInTheDocument()
    expect(resourceCreateWizardMock).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }))

    resourceCatalogControllerMock.mockReturnValue({
      ...inactiveController,
      dialogs: {
        ...inactiveController.dialogs,
        selectedSkill: { id: 'skill-1' } as never
      }
    })
    rerender(<ResourceCatalogView resourceType="assistant" />)

    expect(await screen.findByTestId('skill-detail-dialog')).toHaveAttribute('data-skill-id', 'skill-1')
    expect(skillDetailDialogMock).toHaveBeenLastCalledWith(expect.objectContaining({ open: true }))
  })

  it('keeps toolbar leading in the resource grid success state', () => {
    render(
      <ResourceCatalogView resourceType="assistant" toolbarLeading={<button type="button">Toggle sidebar</button>} />
    )

    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument()
    expect(resourceGridMock).toHaveBeenCalledWith(expect.objectContaining({ toolbarLeading: expect.anything() }))
  })

  it('keeps toolbar leading available when the catalog enters the error state', () => {
    resourceCatalogControllerMock.mockReturnValue(createController(new Error('catalog failed')))

    render(
      <ResourceCatalogView resourceType="assistant" toolbarLeading={<button type="button">Toggle sidebar</button>} />
    )

    expect(screen.queryByTestId('resource-grid')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('catalog failed')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(refetchMock).toHaveBeenCalledOnce()
  })

  it('opens system skill management without agent enablement semantics', async () => {
    const controller = createController()
    resourceCatalogControllerMock.mockReturnValue({
      ...controller,
      dialogs: {
        ...controller.dialogs,
        systemSkillOpen: true
      }
    })

    render(<ResourceCatalogView resourceType="skill" skillAgentId="agent-1" />)

    expect(resourceGridMock).toHaveBeenCalledWith(expect.objectContaining({ onOpenSystemSkills: expect.any(Function) }))
    await vi.waitFor(() =>
      expect(systemSkillDialogMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'manage' }))
    )
  })
})
