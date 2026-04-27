import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelListToolbar from '../ModelListToolbar'
import type { ModelListActionsSurface } from '../useModelListActions'

const useModelsMock = vi.fn()
const useModelListFiltersMock = vi.fn()
const useModelListHealthMock = vi.fn()

const models = [
  { id: 'openai::alpha', name: 'Alpha', isEnabled: true, capabilities: [], providerId: 'openai' },
  { id: 'openai::beta', name: 'Beta', isEnabled: false, capabilities: [], providerId: 'openai' }
] as any

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('../modelListFiltersContext', () => ({
  useModelListFilters: (...args: any[]) => useModelListFiltersMock(...args)
}))

vi.mock('../modelListHealthContext', () => ({
  useModelListHealth: (...args: any[]) => useModelListHealthMock(...args)
}))

vi.mock('../ModelListHeader', () => ({
  default: ({ onToggleVisibleModels, onRunHealthCheck, onRefreshModels, onAddModel, onDownloadModel }: any) => (
    <div>
      <button type="button" onClick={() => onToggleVisibleModels(true)}>
        toggle-visible
      </button>
      <button type="button" onClick={onRunHealthCheck}>
        open-health
      </button>
      <button type="button" onClick={onRefreshModels}>
        refresh-models
      </button>
      <button type="button" onClick={onAddModel}>
        add-model
      </button>
      <button type="button" onClick={onDownloadModel}>
        download-model
      </button>
    </div>
  )
}))

vi.mock('../ManageModelsDrawer', () => ({
  default: ({ open }: any) => (open ? <div>manage-models-drawer</div> : null)
}))

vi.mock('../ModelListSyncDrawer', () => ({
  default: ({ open }: any) => (open ? <div>model-list-sync-drawer</div> : null)
}))

vi.mock('../HealthCheckDrawer', () => ({
  default: ({ open }: any) => (open ? <div>health-check-drawer</div> : null)
}))

describe('ModelListToolbar', () => {
  let actions: ModelListActionsSurface

  beforeEach(() => {
    vi.clearAllMocks()

    useModelsMock.mockReturnValue({ models })
    useModelListFiltersMock.mockReturnValue({
      searchText: '',
      setSearchText: vi.fn(),
      selectedCapabilityFilter: 'all',
      setSelectedCapabilityFilter: vi.fn()
    })
    useModelListHealthMock.mockReturnValue({
      isHealthChecking: false,
      availableApiKeys: ['sk-test'],
      healthCheckOpen: true,
      modelStatuses: [],
      openHealthCheck: vi.fn(),
      closeHealthCheck: vi.fn(),
      startHealthCheck: vi.fn()
    })

    actions = {
      manageModelsOpen: true,
      modelListSyncOpen: false,
      openManageWithInlineCustomAdd: false,
      consumeOpenManageWithInlineCustomAdd: vi.fn(),
      openManageModels: vi.fn(),
      openModelListSync: vi.fn(),
      closeModelListSync: vi.fn(),
      closeManageModels: vi.fn(),
      onRefreshModels: vi.fn(),
      onAddModel: vi.fn(),
      onDownloadModel: vi.fn(),
      updateVisibleModelsEnabledState: vi.fn(),
      isBulkUpdating: false,
      isSyncingModels: false
    }
  })

  it('wires toolbar commands to model actions and local drawers', () => {
    render(<ModelListToolbar providerId="openai" actions={actions} />)

    expect(screen.getByText('manage-models-drawer')).toBeInTheDocument()
    expect(screen.getByText('health-check-drawer')).toBeInTheDocument()

    fireEvent.click(screen.getByText('toggle-visible'))
    expect(actions.updateVisibleModelsEnabledState).toHaveBeenCalledWith(models, true)

    fireEvent.click(screen.getByText('open-health'))
    expect(useModelListHealthMock.mock.results[0].value.openHealthCheck).toHaveBeenCalled()

    fireEvent.click(screen.getByText('refresh-models'))
    expect(actions.onRefreshModels).toHaveBeenCalled()

    fireEvent.click(screen.getByText('add-model'))
    expect(actions.onAddModel).toHaveBeenCalled()

    fireEvent.click(screen.getByText('download-model'))
    expect(actions.onDownloadModel).toHaveBeenCalled()
  })
})
