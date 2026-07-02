import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourceCatalogView } from '../ResourceCatalogView'

const { refetchMock, resourceCatalogControllerMock, resourceGridMock } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
  resourceCatalogControllerMock: vi.fn(),
  resourceGridMock: vi.fn()
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

vi.mock('@renderer/components/resource/dialogs', () => ({
  AgentEditDialog: () => null,
  AssistantEditDialog: () => null,
  ImportAssistantDialog: () => null,
  ImportSkillDialog: () => null,
  PromptEditDialog: () => null,
  ResourceCreateWizard: () => null,
  ResourceDeleteConfirmDialog: () => null,
  SkillDetailDialog: () => null
}))

vi.mock('@renderer/components/resource/dialogs/form/assistantModelFilter', () => ({
  isSelectableAssistantModel: () => true
}))

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelFilter: () => () => true
}))

vi.mock('@renderer/hooks/resourceCatalog/useResourceCatalogController', () => ({
  useResourceCatalogController: resourceCatalogControllerMock
}))

vi.mock('../AssistantLibraryDialog', () => ({
  AssistantLibraryDialog: () => null
}))

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
      activeTag: null,
      allTagNames: [],
      allTags: [],
      isLoading: false,
      onAddTag: vi.fn(),
      onCreate: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      onEdit: vi.fn(),
      onExport: vi.fn(),
      onImportAssistant: vi.fn(),
      onOpenAssistantLibrary: vi.fn(),
      onSearchChange: vi.fn(),
      onTagFilter: vi.fn(),
      onUpdateResourceTags: vi.fn(),
      resources: [],
      search: '',
      tags: []
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
      handleClosePromptDialog: vi.fn(),
      handleCreateDialogOpenChange: vi.fn(),
      handleEditDialogOpenChange: vi.fn(),
      handleEditSaved: vi.fn(),
      handlePromptDialogSave: vi.fn(),
      handleSubmitCreateResource: vi.fn(),
      promptDialogOpen: false,
      promptDialogPrompt: null,
      selectedSkill: null,
      setAssistantImportOpen: vi.fn(),
      setAssistantLibraryOpen: vi.fn(),
      setDeleteConfirm: vi.fn(),
      setSelectedSkill: vi.fn(),
      setSkillImportOpen: vi.fn(),
      skillImportOpen: false
    }
  }
}

describe('ResourceCatalogView', () => {
  beforeEach(() => {
    refetchMock.mockClear()
    resourceCatalogControllerMock.mockReset()
    resourceGridMock.mockClear()
    resourceCatalogControllerMock.mockReturnValue(createController())
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
})
