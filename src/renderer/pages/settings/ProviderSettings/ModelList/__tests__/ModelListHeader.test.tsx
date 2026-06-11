import { fireEvent, render, screen } from '@testing-library/react'
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
  isBusy: false,
  hasNoModels: false,
  searchText: '',
  setSearchText: vi.fn(),
  selectedCapabilityFilter: 'all' as const,
  setSelectedCapabilityFilter: vi.fn(),
  capabilityOptions: MODEL_LIST_CAPABILITY_FILTERS,
  capabilityModelCounts: {
    ...emptyCapabilityCounts(),
    all: 3
  }
}

describe('ModelListHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom does not implement scrollIntoView; the capability filter calls it on click.
    Element.prototype.scrollIntoView = vi.fn()
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('renders the model list title, persistent search, and external action slot', () => {
    render(<ModelListHeader {...baseProps} actions={<button type="button">external-action</button>} />)

    expect(screen.getByText('settings.models.list_title')).toBeInTheDocument()
    expect(screen.getByText('settings.models.available_count')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('models.search.placeholder')).toBeInTheDocument()
    expect(screen.getByText('external-action')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.bulk_enable' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.bulk_disable' })).not.toBeInTheDocument()
  })

  it('updates and clears the persistent search input', () => {
    render(<ModelListHeader {...baseProps} searchText="GPT" />)

    fireEvent.change(screen.getByPlaceholderText('models.search.placeholder'), { target: { value: 'Claude' } })
    expect(baseProps.setSearchText).toHaveBeenCalledWith('Claude')

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))
    expect(baseProps.setSearchText).toHaveBeenCalledWith('')
  })

  it('renders capability filters by default when models exist', () => {
    render(<ModelListHeader {...baseProps} />)

    expect(screen.getByRole('button', { name: /models\.all/ })).toBeInTheDocument()
  })

  it('selects a capability filter from the line-style filter row', () => {
    render(
      <ModelListHeader
        {...baseProps}
        capabilityModelCounts={{
          ...baseProps.capabilityModelCounts,
          reasoning: 2
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /models\.type\.reasoning/ }))

    expect(baseProps.setSelectedCapabilityFilter).toHaveBeenCalledWith('reasoning')
  })
})
