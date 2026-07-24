import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MODEL_LIST_CAPABILITY_FILTERS, type ModelListCapabilityCounts } from '../modelListDerivedState'
import ModelListHeader from '../ModelListHeader'

const emptyTypeCounts = MODEL_LIST_CAPABILITY_FILTERS.reduce<ModelListCapabilityCounts>((acc, key) => {
  acc[key] = 0
  return acc
}, {} as ModelListCapabilityCounts)

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
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

const baseProps = {
  isBusy: false,
  hasNoModels: false,
  searchText: '',
  setSearchText: vi.fn(),
  selectedTypeFilter: 'all' as const,
  setSelectedTypeFilter: vi.fn(),
  typeCounts: emptyTypeCounts,
  groupsExpanded: true,
  onToggleGroupsExpanded: vi.fn()
}

describe('ModelListHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('renders the model list title, collapsed search action, and external action slot', () => {
    render(<ModelListHeader {...baseProps} actions={<button type="button">external-action</button>} />)

    expect(screen.getByText('settings.models.list_title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.collapse_all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.search' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('models.search.placeholder')).not.toBeInTheDocument()
    expect(screen.getByText('external-action')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.bulk_enable' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.bulk_disable' })).not.toBeInTheDocument()
  })

  it('toggles all model groups from the header action', () => {
    render(<ModelListHeader {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.collapse_all' }))

    expect(baseProps.onToggleGroupsExpanded).toHaveBeenCalledTimes(1)
  })

  it('renders provider documentation links when websites are available', () => {
    render(
      <ModelListHeader
        {...baseProps}
        docsWebsite="https://docs.github.com/en/github-models"
        modelsWebsite="https://github.com/marketplace/models"
      />
    )

    const docsLink = screen.getByRole('link', { name: 'settings.models.docs' })

    expect(docsLink).toHaveAttribute('href', 'https://github.com/marketplace/models')
    expect(screen.queryByText('settings.models.docs')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByText('settings.provider.docs_check')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.provider.docs_more_details')).not.toBeInTheDocument()
  })

  it('expands, updates, and clears the search input', () => {
    const { rerender } = render(<ModelListHeader {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.search' }))

    fireEvent.change(screen.getByPlaceholderText('models.search.placeholder'), { target: { value: 'Claude' } })
    expect(baseProps.setSearchText).toHaveBeenCalledWith('Claude')

    rerender(<ModelListHeader {...baseProps} searchText="GPT" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))
    expect(baseProps.setSearchText).toHaveBeenCalledWith('')
  })

  it('collapses the search input on blur only when there is no search text', () => {
    const { rerender } = render(<ModelListHeader {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.search' }))
    fireEvent.blur(screen.getByPlaceholderText('models.search.placeholder'))

    expect(screen.queryByPlaceholderText('models.search.placeholder')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.search' })).toBeInTheDocument()

    rerender(<ModelListHeader {...baseProps} searchText="GPT" />)
    fireEvent.blur(screen.getByPlaceholderText('models.search.placeholder'))

    expect(screen.getByPlaceholderText('models.search.placeholder')).toBeInTheDocument()
  })

  it('toggles the model-type filter row from the filter button', () => {
    render(<ModelListHeader {...baseProps} typeCounts={{ ...emptyTypeCounts, all: 3, text: 2 }} />)

    const filterButton = screen.getByRole('button', { name: 'settings.models.filter.label' })
    expect(filterButton).toBeInTheDocument()
    // The type-filter row is hidden until the button is toggled.
    expect(screen.queryByRole('tab', { name: 'models.type.text' })).not.toBeInTheDocument()

    fireEvent.click(filterButton)

    expect(screen.getByRole('tab', { name: 'models.all' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'models.type.text' })).toBeInTheDocument()
  })

  it('marks the filter button active when a non-default type filter is selected', () => {
    render(<ModelListHeader {...baseProps} selectedTypeFilter="embedding" />)

    expect(screen.getByRole('button', { name: 'settings.models.filter.label' })).toHaveClass('text-foreground')
  })
})
