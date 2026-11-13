import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceItem } from '@renderer/types/resourceCatalog'

import { ResourceCatalogView } from '../ResourceCatalogView'

const {
  dialogImplementationsLoadedMock,
  refetchMock,
  resourceCatalogControllerMock,
  resourceCreateWizardMock,
  resourceGridMock,
  systemSkillDialogMock
} = vi.hoisted(() => ({
  dialogImplementationsLoadedMock: vi.fn(),
  refetchMock: vi.fn(),
  resourceCatalogControllerMock: vi.fn(),
  resourceCreateWizardMock: vi.fn(),
  resourceGridMock: vi.fn(),
  systemSkillDialogMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.error': 'Error',
          'common.retry': 'Retry',
          'assistants.presets.export.title': 'Export Assistants'
        }) satisfies Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
  return {}
})
vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => {
  dialogImplementationsLoadedMock('edit')
  return {
    ResourceEditDialogHost: () => null
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
  ResourceGrid: (props: { toolbarLeading?: ReactNode; onExportAssistants?: () => void }) => {
    resourceGridMock(props)

    return (
      <div data-testid="resource-grid">
        {props.toolbarLeading}
        <button type="button" onClick={props.onExportAssistants}>
          Export
        </button>
      </div>
    )
  }
}))

function createController(resourceError?: Error, resources: ResourceItem[] = []) {
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
      onExportAssistants: vi.fn(),
      onOpenAssistantLibrary: vi.fn(),
      onOpenSkillMarketplace: vi.fn(),
      onOpenSystemSkills: vi.fn(),
      onSearchChange: vi.fn(),
      onGroupFilter: vi.fn(),
      resources,
      search: ''
    },
    dialogs: {
      assistantImportOpen: false,
      assistantExportOpen: false,
      exportAssistants: [],
      assistantExportLoading: false,
      assistantExporting: false,
      handleAssistantExportOpenChange: vi.fn(),
      handleExportAssistants: vi.fn(),
      assistantLibraryOpen: false,
      createDialogKind: null,
      createDialogOpen: false,
      creatingResource: false,
      deleteConfirm: null,
      editDialogTarget: null,
      handleCreateDialogOpenChange: vi.fn(),
      handleSubmitCreateResource: vi.fn(),
      setAssistantImportOpen: vi.fn(),
      setAssistantLibraryOpen: vi.fn(),
      setDeleteConfirm: vi.fn(),
      setEditDialogTarget: vi.fn(),
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

    resourceCatalogControllerMock.mockReturnValue(inactiveController)
    rerender(<ResourceCatalogView resourceType="assistant" />)

    expect(screen.queryByTestId('resource-create-wizard')).not.toBeInTheDocument()
  })

  it('filters controller resources before rendering the grid', () => {
    const enabledSkill = { id: 'enabled', type: 'skill', raw: { isGlobalEnabled: true } } as ResourceItem
    const disabledSkill = { id: 'disabled', type: 'skill', raw: { isGlobalEnabled: false } } as ResourceItem
    resourceCatalogControllerMock.mockReturnValue(createController(undefined, [enabledSkill, disabledSkill]))

    render(
      <ResourceCatalogView
        resourceType="skill"
        filterResource={(resource) => resource.type === 'skill' && resource.raw.isGlobalEnabled}
      />
    )

    expect(resourceGridMock).toHaveBeenCalledWith(
      expect.objectContaining({ resources: [enabledSkill], hasHiddenResources: false })
    )
  })

  it('tells the grid when an external filter hides every available resource', () => {
    const disabledSkill = { id: 'disabled', type: 'skill', raw: { isGlobalEnabled: false } } as ResourceItem
    resourceCatalogControllerMock.mockReturnValue(createController(undefined, [disabledSkill]))

    render(
      <ResourceCatalogView
        resourceType="skill"
        filterResource={(resource) => resource.type === 'skill' && resource.raw.isGlobalEnabled}
      />
    )

    expect(resourceGridMock).toHaveBeenCalledWith(expect.objectContaining({ resources: [], hasHiddenResources: true }))
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

  it('opens the batch export dialog on the first toolbar click through the lazy host', async () => {
    const user = userEvent.setup()
    resourceCatalogControllerMock.mockImplementation(function useExportController() {
      const [open, setOpen] = useState(false)
      const controller = createController()
      return {
        ...controller,
        gridProps: { ...controller.gridProps, onExportAssistants: () => setOpen(true) },
        dialogs: { ...controller.dialogs, assistantExportOpen: open, handleAssistantExportOpenChange: setOpen }
      }
    })
    render(<ResourceCatalogView resourceType="assistant" />)
    expect(screen.queryByRole('dialog', { name: 'Export Assistants' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByRole('dialog', { name: 'Export Assistants' })).toBeInTheDocument()
  })
})
