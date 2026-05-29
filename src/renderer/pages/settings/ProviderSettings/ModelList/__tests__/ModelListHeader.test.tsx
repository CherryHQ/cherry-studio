import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  onToggleVisibleModels: vi.fn()
}

describe('ModelListHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('renders the model list title, list actions, and external action slot', () => {
    render(<ModelListHeader {...baseProps} actions={<button type="button">external-action</button>} />)

    expect(screen.getByText('settings.models.list_title')).toBeInTheDocument()
    expect(screen.getByText(/1\/3 common\.enabled/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('models.search.placeholder')).not.toBeInTheDocument()
    expect(screen.getByText('external-action')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.bulk_enable' }))
    expect(baseProps.onToggleVisibleModels).toHaveBeenCalledWith(true)
  })

  it('shows an error toast when bulk toggle fails', async () => {
    const onToggleVisibleModels = vi.fn().mockRejectedValue(new Error('bulk failed'))

    render(<ModelListHeader {...baseProps} onToggleVisibleModels={onToggleVisibleModels} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.bulk_enable' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
    })
  })

  it('switches the bulk action label when all models are enabled', () => {
    render(<ModelListHeader {...baseProps} allEnabled={true} enabledModelCount={2} modelCount={2} />)

    expect(screen.getByRole('button', { name: 'settings.models.bulk_disable' })).toBeInTheDocument()
  })

  it('keeps search collapsed by default and expands it when the search toggle is activated', () => {
    render(<ModelListHeader {...baseProps} />)

    expect(screen.queryByPlaceholderText('models.search.placeholder')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'models.search.tooltip' }))
    expect(screen.getByPlaceholderText('models.search.placeholder')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'models.search.tooltip' }))
    expect(screen.queryByPlaceholderText('models.search.placeholder')).not.toBeInTheDocument()
  })
})
