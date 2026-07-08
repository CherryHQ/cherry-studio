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
  setSearchText: vi.fn()
}

describe('ModelListHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('renders the model list title, persistent search, and external action slot', () => {
    render(<ModelListHeader {...baseProps} actions={<button type="button">external-action</button>} />)

    expect(screen.getByText('settings.models.list_title')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('models.search.placeholder')).toBeInTheDocument()
    expect(screen.getByText('external-action')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.bulk_enable' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.bulk_disable' })).not.toBeInTheDocument()
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
    expect(docsLink).toHaveClass('h-[1.3em]', 'w-[1.3em]', 'text-foreground-muted/70', 'hover:text-primary')
    expect(docsLink).not.toHaveClass('hover:underline')
    expect(screen.queryByText('settings.models.docs')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByText('settings.provider.docs_check')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.provider.docs_more_details')).not.toBeInTheDocument()
  })

  it('updates and clears the persistent search input', () => {
    render(<ModelListHeader {...baseProps} searchText="GPT" />)

    fireEvent.change(screen.getByPlaceholderText('models.search.placeholder'), { target: { value: 'Claude' } })
    expect(baseProps.setSearchText).toHaveBeenCalledWith('Claude')

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))
    expect(baseProps.setSearchText).toHaveBeenCalledWith('')
  })

  it('does not render the capability filter button', () => {
    render(<ModelListHeader {...baseProps} />)

    expect(screen.queryByRole('button', { name: 'settings.models.filter.label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.filter.clear' })).not.toBeInTheDocument()
  })
})
