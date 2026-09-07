import '@testing-library/jest-dom/vitest'

import type { SkillSearchResult } from '@shared/types/skill'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { isValidElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillMarketplaceDialog } from '../SkillMarketplaceDialog'

const searchMock = vi.fn()
const clearMock = vi.fn()
const installMock = vi.fn()
const isInstallingMock = vi.fn()
const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: toastSuccess, error: toastError }
}))
const SEARCH_DEBOUNCE_MS = 300

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
  // Radix Select stubbed as a native select: same combobox role and value semantics, no portal.
  Select: ({
    children,
    value,
    onValueChange
  }: {
    children?: ReactNode
    value?: string
    onValueChange?: (value: string) => void
  }) => (
    <select
      aria-label="library.skill_marketplace.source_label"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children?: ReactNode; value: string }) => {
    // <option> only accepts text, so flatten the styled count span the real SelectItem renders.
    const flatten = (node: ReactNode): string => {
      if (typeof node === 'string' || typeof node === 'number') return String(node)
      if (Array.isArray(node)) return node.map(flatten).join('')
      if (isValidElement<{ children?: ReactNode }>(node)) return flatten(node.props.children)
      return ''
    }
    return <option value={value}>{flatten(children)}</option>
  },
  SelectTrigger: () => null,
  SelectValue: () => null,
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
    open: vi.fn()
  })
})

function renderDialog(props: Partial<ComponentProps<typeof SkillMarketplaceDialog>> = {}) {
  return render(<SkillMarketplaceDialog open onOpenChange={vi.fn()} {...props} />)
}

function typeSearchQuery(query: string) {
  vi.useFakeTimers()
  try {
    fireEvent.change(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), {
      target: { value: query }
    })
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
    })
  } finally {
    vi.useRealTimers()
  }

  expect(searchMock).toHaveBeenLastCalledWith(query)
  expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
}

function sourceSelect() {
  return screen.getByRole('combobox', { name: 'library.skill_marketplace.source_label' })
}

describe('SkillMarketplaceDialog', () => {
  it('renders every source option and filters results by the selected one', async () => {
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

    typeSearchQuery('react')
    const sourceOptions = within(sourceSelect()).getAllByRole('option')
    expect(sourceOptions.map((option) => option.textContent)).toEqual([
      'skills.sh1',
      'claude-plugins.dev2',
      'clawhub.ai',
      'GitHub'
    ])
    expect(sourceSelect()).toHaveValue('skills.sh')
    expect(screen.getByText('React Skill')).toBeInTheDocument()
    const firstResult = screen.getAllByRole('listitem')[0]
    expect(within(firstResult).queryByText('vercel')).not.toBeInTheDocument()
    expect(within(firstResult).getByText('12')).toBeInTheDocument()
    await user.click(within(firstResult).getByLabelText('settings.skills.viewSource'))
    expect(window.open).toHaveBeenCalledWith('https://github.com/vercel/skills')
    expect(screen.queryByText('Code Review')).not.toBeInTheDocument()
    expect(within(firstResult).queryByText('skills.sh')).not.toBeInTheDocument()

    await user.selectOptions(sourceSelect(), 'claude-plugins.dev')

    expect(screen.getByText('Code Review')).toBeInTheDocument()
    const claudeResult = screen.getAllByRole('listitem')[0]
    expect(within(claudeResult).queryByText('Review code changes')).not.toBeInTheDocument()
    expect(within(claudeResult).queryByText('anthropic')).not.toBeInTheDocument()
    expect(within(claudeResult).getByText('42')).toBeInTheDocument()
    expect(screen.queryByText('React Skill')).not.toBeInTheDocument()
    expect(within(claudeResult).queryByText('claude-plugins.dev')).not.toBeInTheDocument()
  })

  it('debounces marketplace searches while typing', () => {
    vi.useFakeTimers()
    try {
      renderDialog()
      const input = screen.getByPlaceholderText('library.skill_marketplace.search_placeholder')

      fireEvent.change(input, { target: { value: 'r' } })
      fireEvent.change(input, { target: { value: 're' } })
      fireEvent.change(input, { target: { value: 'rea' } })
      fireEvent.change(input, { target: { value: 'react' } })

      expect(clearMock).toHaveBeenCalledTimes(4)
      expect(screen.getByText('common.loading')).toBeInTheDocument()
      expect(screen.queryByText('React Skill')).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(299)
      })
      expect(searchMock).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(searchMock).toHaveBeenCalledTimes(1)
      expect(searchMock).toHaveBeenCalledWith('react')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the selected source active when only another source has results', async () => {
    const user = userEvent.setup()
    skillSearchState.results = [resultsFixture[1]]
    renderDialog()

    await user.selectOptions(sourceSelect(), 'clawhub.ai')
    typeSearchQuery('react')

    expect(sourceSelect()).toHaveValue('clawhub.ai')
    expect(screen.getByText('library.skill_marketplace.no_results_title')).toBeInTheDocument()
    expect(screen.queryByText('React Skill')).not.toBeInTheDocument()

    await user.selectOptions(sourceSelect(), 'skills.sh')

    // Switching between registries refilters the one shared search instead of discarding it.
    expect(screen.getByText('React Skill')).toBeInTheDocument()
    expect(searchMock).toHaveBeenCalledTimes(1)
  })

  describe('github source', () => {
    async function selectGithubAndType(url: string) {
      const user = userEvent.setup()
      await user.selectOptions(sourceSelect(), 'github')
      vi.useFakeTimers()
      try {
        fireEvent.change(screen.getByPlaceholderText('library.skill_marketplace.github_url_placeholder'), {
          target: { value: url }
        })
        act(() => {
          vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
        })
      } finally {
        vi.useRealTimers()
      }
    }

    it.each([
      [
        'repository-root blob link',
        'https://github.com/owner/repo/blob/main/SKILL.md',
        'github:https://github.com/owner/repo/blob/main/SKILL.md'
      ],
      [
        'official raw link',
        'https://github.com/owner/repo/raw/refs/heads/main/SKILL.md',
        'github:https://raw.githubusercontent.com/owner/repo/refs/heads/main/SKILL.md'
      ]
    ])('installs a %s without querying the registries', async (_case, url, installSource) => {
      const user = userEvent.setup()
      renderDialog()

      await selectGithubAndType(url)

      expect(searchMock).not.toHaveBeenCalled()
      expect(screen.getByText('repo')).toBeInTheDocument()
      // The dropdown counts what each source currently offers, and GitHub's one row is not in
      // `results` — reading only the registry list would leave it blank.
      expect(within(sourceSelect()).getByRole('option', { name: 'GitHub1' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /settings.skills.install/ }))
      await waitFor(() => {
        expect(installMock).toHaveBeenCalledWith(installSource)
      })
    })

    it('reports an unsupported GitHub URL format instead of offering an install', async () => {
      renderDialog()

      await selectGithubAndType('https://github.com/owner/repo')

      const input = screen.getByPlaceholderText('library.skill_marketplace.github_url_placeholder')
      const message = screen.getByRole('alert')
      expect(message).toHaveTextContent('library.skill_marketplace.github_url_invalid')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription('library.skill_marketplace.github_url_invalid')
      expect(screen.queryByRole('button', { name: /settings.skills.install/ })).not.toBeInTheDocument()
      expect(searchMock).not.toHaveBeenCalled()
    })

    it('drops the typed value when the source switches between keywords and URLs', async () => {
      const user = userEvent.setup()
      renderDialog()

      typeSearchQuery('react')
      await user.selectOptions(sourceSelect(), 'github')

      expect(screen.getByPlaceholderText('library.skill_marketplace.github_url_placeholder')).toHaveValue('')
      expect(screen.getByText('library.skill_marketplace.github_empty_title')).toBeInTheDocument()
    })
  })

  it('shows a localized marketplace error message when search fails', async () => {
    skillSearchState.results = []
    skillSearchState.error = 'Search failed'
    renderDialog()

    typeSearchQuery('react')

    expect(screen.getByText('common.error')).toBeInTheDocument()
    expect(screen.getByText('library.skill_marketplace.search_failed_description')).toBeInTheDocument()
    expect(screen.queryByText('Search failed')).not.toBeInTheDocument()
  })

  it('installs a marketplace skill and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange })

    typeSearchQuery('code')
    await user.click(screen.getByRole('button', { name: /settings.skills.install/ }))

    await waitFor(() => {
      expect(installMock).toHaveBeenCalledWith('skills.sh:vercel/skills/react-skill')
    })
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

    await user.selectOptions(sourceSelect(), 'claude-plugins.dev')
    typeSearchQuery('code')

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

    await user.selectOptions(sourceSelect(), 'claude-plugins.dev')
    typeSearchQuery('code')
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

    typeSearchQuery('code')
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

    typeSearchQuery('code')
    await user.click(screen.getByRole('button', { name: /settings.skills.install/ }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('settings.skills.installFailed:React Skill: clone failed')
    })
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
