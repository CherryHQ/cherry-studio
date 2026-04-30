import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MODEL_LIST_CAPABILITY_FILTERS, type ModelListCapabilityCounts } from '../modelListDerivedState'
import ModelListHeader from '../ModelListHeader'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Button: ({ children, ...props }: any) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

function emptyCapabilityCounts(): ModelListCapabilityCounts {
  return MODEL_LIST_CAPABILITY_FILTERS.reduce<ModelListCapabilityCounts>((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as ModelListCapabilityCounts)
}

const baseProps = {
  enabledModelCount: 1,
  modelCount: 3,
  hasVisibleModels: true,
  allEnabled: false,
  isBusy: false,
  hasNoModels: false,
  searchText: '',
  setSearchText: vi.fn(),
  selectedCapabilityFilter: 'all' as const,
  setSelectedCapabilityFilter: vi.fn(),
  capabilityOptions: MODEL_LIST_CAPABILITY_FILTERS,
  capabilityModelCounts: emptyCapabilityCounts(),
  showDownloadButton: false,
  onToggleVisibleModels: vi.fn(),
  onRunHealthCheck: vi.fn(),
  onRefreshModels: vi.fn(),
  onAddModel: vi.fn(),
  onOpenManageModels: vi.fn(),
  onDownloadModel: vi.fn()
}

describe('ModelListHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('renders the model list title and icon-only actions with accessible labels', () => {
    render(<ModelListHeader {...baseProps} />)

    expect(screen.getByText('settings.models.list_title')).toBeInTheDocument()
    expect(screen.getByText(/1\/3 common\.enabled/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('models.search.placeholder')).toBeInTheDocument()

    expect(screen.queryByText('button.manage')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.bulk_enable' }))
    expect(baseProps.onToggleVisibleModels).toHaveBeenCalledWith(true)

    expect(screen.getByRole('button', { name: 'settings.models.check.button_caption' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.models.check.button_caption' }))
    expect(baseProps.onRunHealthCheck).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.toolbar.pull_short' }))
    expect(baseProps.onRefreshModels).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.add.add_model' }))
    vi.advanceTimersByTime(220)
    expect(baseProps.onAddModel).toHaveBeenCalled()
  })

  it('opens manage models on add-button double click without firing the delayed add flow', () => {
    render(<ModelListHeader {...baseProps} />)

    const addButton = screen.getByRole('button', { name: 'settings.models.add.add_model' })
    fireEvent.click(addButton)
    fireEvent.doubleClick(addButton)
    vi.advanceTimersByTime(220)

    expect(baseProps.onOpenManageModels).toHaveBeenCalledTimes(1)
    expect(baseProps.onAddModel).not.toHaveBeenCalled()
  })

  it('switches the bulk action label when all models are enabled', () => {
    render(<ModelListHeader {...baseProps} allEnabled={true} enabledModelCount={2} modelCount={2} />)

    expect(screen.getByRole('button', { name: 'settings.models.bulk_disable' })).toBeInTheDocument()
  })

  it('shows search by default and collapses it when the search toggle is activated', () => {
    render(<ModelListHeader {...baseProps} />)

    expect(screen.getByPlaceholderText('models.search.placeholder')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'models.search.tooltip' }))
    expect(screen.queryByPlaceholderText('models.search.placeholder')).not.toBeInTheDocument()
  })
})
