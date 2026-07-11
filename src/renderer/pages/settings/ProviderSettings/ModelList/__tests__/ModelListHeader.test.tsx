import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

const baseProps = {
  isBusy: false,
  hasNoModels: false,
  searchText: '',
  setSearchText: vi.fn(),
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
    expect(docsLink).toHaveClass('size-6', 'bg-transparent')
    expect(docsLink).not.toHaveClass('hover:underline')
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

  it('does not render the capability filter button', () => {
    render(<ModelListHeader {...baseProps} />)

    expect(screen.queryByRole('button', { name: 'settings.models.filter.label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.filter.clear' })).not.toBeInTheDocument()
  })
})
