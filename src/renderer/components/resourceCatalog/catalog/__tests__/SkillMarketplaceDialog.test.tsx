import '@testing-library/jest-dom/vitest'

import type { SkillSearchResult } from '@shared/types/skill'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillMarketplaceDialog } from '../SkillMarketplaceDialog'

const searchMock = vi.fn()
const clearMock = vi.fn()
const installMock = vi.fn()
const isInstallingMock = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

const resultsFixture: SkillSearchResult[] = [
  {
    slug: 'code-review',
    name: 'Code Review',
    description: 'Review code changes',
    author: 'anthropic',
    stars: 42,
    downloads: 0,
    sourceRegistry: 'claude-plugins.dev',
    sourceUrl: 'https://github.com/anthropic/skills/tree/main/code-review',
    installSource: 'claude-plugins:anthropic/skills/code-review'
  },
  {
    slug: 'react-skill',
    name: 'React Skill',
    description: null,
    author: 'vercel',
    stars: 0,
    downloads: 12,
    sourceRegistry: 'skills.sh',
    sourceUrl: 'https://github.com/vercel/skills',
    installSource: 'skills.sh:vercel/skills/react-skill'
  }
]

let skillSearchState: {
  results: SkillSearchResult[]
  searching: boolean
  error: string | null
} = {
  results: resultsFixture,
  searching: false,
  error: null
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key)
  })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useSkillSearch: () => ({
    ...skillSearchState,
    search: searchMock,
    clear: clearMock
  }),
  useSkillInstall: () => ({
    install: installMock,
    isInstalling: isInstallingMock
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    loading,
    size,
    variant,
    ...props
  }: ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }) => {
    void loading
    void size
    void variant
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Center: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
  DialogContent: ({
    children,
    size,
    closeOnOverlayClick,
    ...props
  }: ComponentProps<'div'> & {
    closeOnOverlayClick?: boolean
    size?: string
  }) => {
    void size
    return (
      <div role="dialog" data-close-on-overlay-click={closeOnOverlayClick ? 'true' : 'false'} {...props}>
        {children}
      </div>
    )
  },
  DialogHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  EmptyState: ({ description, title }: { description?: string; title?: string }) => (
    <div data-testid="empty-state">
      {title ? <div>{title}</div> : null}
      {description ? <div>{description}</div> : null}
    </div>
  ),
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  SegmentedControl: ({
    options,
    value,
    onValueChange
  }: {
    options: { value: string; label: ReactNode; disabled?: boolean }[]
    value?: string
    onValueChange?: (value: string) => void
  }) => (
    <div role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={option.disabled}
          onClick={() => onValueChange?.(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Spinner: ({ text }: { text: ReactNode }) => <div>{text}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    children,
    className,
    role,
    list
  }: {
    children: (item: SkillSearchResult, index: number) => ReactNode
    className?: string
    list: SkillSearchResult[]
    role?: string
  }) => (
    <div className={className} data-testid="skill-results-virtual-list" role={role}>
      {list.map((item, index) => (
        <div key={item.installSource}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

beforeEach(() => {
  vi.clearAllMocks()
  skillSearchState = {
    results: resultsFixture,
    searching: false,
    error: null
  }
  installMock.mockResolvedValue({ skill: { id: 'skill-1', name: 'Installed Skill' } })
  isInstallingMock.mockReturnValue(false)
  Object.assign(window, {
    toast: { ...window.toast, success: toastSuccess, error: toastError },
    open: vi.fn()
  })
})

function renderDialog(props: Partial<ComponentProps<typeof SkillMarketplaceDialog>> = {}) {
  return render(<SkillMarketplaceDialog open onOpenChange={vi.fn()} onInstalled={vi.fn()} {...props} />)
}

describe('SkillMarketplaceDialog', () => {
  it('renders source tabs and filters results by selected source', async () => {
    const user = userEvent.setup()
    skillSearchState.results = [
      ...resultsFixture,
      {
        ...resultsFixture[0],
        slug: 'markdown-converter',
        name: 'Markdown Converter',
        installSource: 'claude-plugins:anthropic/skills/markdown-converter'
      }
    ]
    renderDialog()

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'react')

    expect(searchMock).toHaveBeenLastCalledWith('react')
    expect(screen.getByRole('radio', { name: /claude-plugins.dev/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /skills.sh/ })).toBeInTheDocument()
    expect(screen.getByTestId('skill-results-virtual-list')).toHaveClass('px-6', 'pt-1', 'pb-1')
    expect(screen.getByTestId('skill-results-virtual-list')).toHaveClass('[&::-webkit-scrollbar]:!w-0.75')
    expect(screen.getAllByRole('listitem')[0]).toHaveClass('min-h-[56px]', 'border-b')
    expect(screen.getAllByRole('listitem')[0].className).not.toContain('hover:bg-accent')
    expect(screen.getByText('Code Review')).toBeInTheDocument()
    const firstResult = screen.getAllByRole('listitem')[0]
    expect(within(firstResult).queryByText('Review code changes')).not.toBeInTheDocument()
    expect(within(firstResult).queryByText('anthropic')).not.toBeInTheDocument()
    expect(within(firstResult).getByText('42')).toBeInTheDocument()
    await user.click(within(firstResult).getByLabelText('settings.skills.viewSource'))
    expect(window.open).toHaveBeenCalledWith('https://github.com/anthropic/skills/tree/main/code-review')
    expect(screen.queryByText('React Skill')).not.toBeInTheDocument()
    expect(within(firstResult).queryByText('claude-plugins.dev')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /skills.sh/ }))

    expect(screen.getByText('React Skill')).toBeInTheDocument()
    expect(screen.queryByText('vercel')).not.toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.queryByText('Code Review')).not.toBeInTheDocument()
    expect(within(screen.getByRole('listitem')).queryByText('skills.sh')).not.toBeInTheDocument()
  })

  it('selects a source with results when the default source has no matches', async () => {
    const user = userEvent.setup()
    skillSearchState.results = [resultsFixture[1]]
    renderDialog()

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'react')

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /skills.sh/ })).toHaveAttribute('aria-checked', 'true')
    })
    expect(screen.getByText('React Skill')).toBeInTheDocument()
    expect(screen.queryByText('library.skill_marketplace.no_results_title')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /claude-plugins.dev/ })).toBeDisabled()
  })

  it('installs a marketplace skill, keeps the dialog open, and notifies the parent', async () => {
    const user = userEvent.setup()
    const onInstalled = vi.fn()
    const onOpenChange = vi.fn()
    renderDialog({ onInstalled, onOpenChange })

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'code')
    await user.click(screen.getByRole('button', { name: /settings.skills.install/ }))

    await waitFor(() => {
      expect(installMock).toHaveBeenCalledWith('claude-plugins:anthropic/skills/code-review')
    })
    expect(onInstalled).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('settings.skills.installSuccess:Installed Skill')
    expect(await screen.findByText('settings.skills.installed')).toBeInTheDocument()
  })

  it('keeps other install buttons enabled while one install is in progress', async () => {
    const user = userEvent.setup()
    skillSearchState.results = [
      resultsFixture[0],
      {
        ...resultsFixture[0],
        slug: 'markdown-converter',
        name: 'Markdown Converter',
        installSource: 'claude-plugins:anthropic/skills/markdown-converter'
      }
    ]
    isInstallingMock.mockImplementation((key?: string) =>
      key ? key === 'claude-plugins:anthropic/skills/code-review' : true
    )
    renderDialog()

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'code')

    expect(screen.getByRole('dialog')).toHaveAttribute('data-close-on-overlay-click', 'true')
    const installButtons = screen.getAllByRole('button', { name: /settings.skills.install/ })
    expect(installButtons[0]).toBeDisabled()
    expect(installButtons[1]).not.toBeDisabled()
  })

  it('starts installs for multiple marketplace skills without waiting for the first one', async () => {
    const user = userEvent.setup()
    skillSearchState.results = [
      resultsFixture[0],
      {
        ...resultsFixture[0],
        slug: 'markdown-converter',
        name: 'Markdown Converter',
        installSource: 'claude-plugins:anthropic/skills/markdown-converter'
      }
    ]
    isInstallingMock.mockImplementation((key?: string) => (key ? false : true))
    renderDialog()

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'code')
    const installButtons = screen.getAllByRole('button', { name: /settings.skills.install/ })
    await user.click(installButtons[0])
    await user.click(installButtons[1])

    await waitFor(() => {
      expect(installMock).toHaveBeenCalledWith('claude-plugins:anthropic/skills/code-review')
      expect(installMock).toHaveBeenCalledWith('claude-plugins:anthropic/skills/markdown-converter')
    })
  })

  it('ignores duplicate clicks for the same marketplace skill while it is pending', async () => {
    const user = userEvent.setup()
    let resolveInstall!: (value: { skill: { id: string; name: string } }) => void
    installMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInstall = resolve
        })
    )
    renderDialog()

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'code')
    const installButton = screen.getByRole('button', { name: /settings.skills.install/ })
    await user.click(installButton)
    await user.click(installButton)

    expect(installMock).toHaveBeenCalledTimes(1)

    resolveInstall({ skill: { id: 'skill-1', name: 'Installed Skill' } })
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('settings.skills.installSuccess:Installed Skill')
    })
  })

  it('shows an error toast when marketplace install fails without closing', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    installMock.mockResolvedValueOnce({ skill: null, error: 'clone failed' })
    renderDialog({ onOpenChange })

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'code')
    await user.click(screen.getByRole('button', { name: /settings.skills.install/ }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('settings.skills.installFailed:Code Review: clone failed')
    })
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
