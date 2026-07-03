import '@testing-library/jest-dom/vitest'

import type { SkillSearchResult } from '@shared/types/skill'
import { render, screen, waitFor } from '@testing-library/react'
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
  Button: ({ children, size, variant, ...props }: ComponentProps<'button'> & { size?: string; variant?: string }) => {
    void size
    void variant
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
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
    void closeOnOverlayClick
    void size
    return (
      <div role="dialog" {...props}>
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
  SearchInput: ({
    onClear,
    clearLabel,
    ...props
  }: ComponentProps<'input'> & { onClear?: () => void; clearLabel?: string }) => {
    void onClear
    void clearLabel
    return <input {...props} />
  },
  SegmentedControl: ({
    options,
    value,
    onValueChange
  }: {
    options: { value: string; label: ReactNode }[]
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
          onClick={() => onValueChange?.(option.value)}>
          {option.label}
        </button>
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
    renderDialog()

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'react')

    expect(searchMock).toHaveBeenLastCalledWith('react')
    expect(screen.getByRole('radio', { name: /claude-plugins.dev/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /skills.sh/ })).toBeInTheDocument()
    expect(screen.getByText('Code Review')).toBeInTheDocument()
    expect(screen.queryByText('React Skill')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /skills.sh/ }))

    expect(screen.getByText('React Skill')).toBeInTheDocument()
    expect(screen.queryByText('Code Review')).not.toBeInTheDocument()
  })

  it('installs a marketplace skill and notifies the parent', async () => {
    const user = userEvent.setup()
    const onInstalled = vi.fn()
    renderDialog({ onInstalled })

    await user.type(screen.getByPlaceholderText('library.skill_marketplace.search_placeholder'), 'code')
    await user.click(screen.getByRole('button', { name: /settings.skills.install/ }))

    await waitFor(() => {
      expect(installMock).toHaveBeenCalledWith('claude-plugins:anthropic/skills/code-review')
    })
    expect(onInstalled).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith('settings.skills.installSuccess:Installed Skill')
    expect(await screen.findByText('settings.skills.installed')).toBeInTheDocument()
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
