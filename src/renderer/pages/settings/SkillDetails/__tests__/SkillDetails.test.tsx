import type { InstalledSkill } from '@shared/data/types/agent'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps, ReactNode, Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  folder: { data: undefined, error: undefined, isLoading: false } as {
    data?: { rootPath: string; access: 'read_only' | 'read_write'; readOnlyReason?: 'builtin' }
    error?: Error
    isLoading: boolean
  },
  ipcRequest: vi.fn(),
  flushBrowser: vi.fn(),
  launchSkill: vi.fn(),
  navigate: vi.fn(),
  query: { data: undefined, error: undefined, isLoading: false } as {
    data?: InstalledSkill
    error?: Error
    isLoading: boolean
  },
  refetch: vi.fn(),
  uninstallSkill: vi.fn(),
  updateGlobalEnabled: vi.fn()
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('swr', () => ({ default: () => mocks.folder }))
vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useDataChange: vi.fn(),
  useQuery: () => ({ ...mocks.query, refetch: mocks.refetch })
}))
vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useSkillMutationsById: () => ({
    isUpdating: false,
    uninstallSkill: mocks.uninstallSkill,
    updateGlobalEnabled: mocks.updateGlobalEnabled
  })
}))
vi.mock('@renderer/hooks/useSkillLauncher', () => ({ useSkillLauncher: () => mocks.launchSkill }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('@renderer/components/resourceCatalog/catalog/SkillSourceBadge', () => ({
  SkillSourceBadge: ({ source, sourceRegistry }: { source: string; sourceRegistry?: string | null }) => (
    <span data-registry={sourceRegistry ?? ''} data-testid="source-badge">
      {source}
    </span>
  )
}))
vi.mock('../SkillFileBrowser', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    SkillFileBrowser: function MockSkillFileBrowser({
      rootPath,
      skillId,
      access,
      disabled,
      ref
    }: {
      rootPath: string
      skillId: string
      access: string
      disabled?: boolean
      ref?: Ref<{ flush: () => Promise<void> }>
    }) {
      useImperativeHandle(ref, () => ({ flush: mocks.flushBrowser }))
      return (
        <div
          data-access={access}
          data-disabled={String(Boolean(disabled))}
          data-root-path={rootPath}
          data-skill-id={skillId}
          data-testid="skill-file-browser"
        />
      )
    }
  }
})
vi.mock('@renderer/utils/time', () => ({ formatRelativeTime: () => 'recently' }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn() }) } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
    t: (key: string) => key
  })
}))
vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, ...props }: ComponentProps<'button'> & { size?: string; variant?: string }) => {
    const { size, variant, ...buttonProps } = props
    void size
    void variant
    return (
      <button type={buttonProps.type ?? 'button'} {...buttonProps}>
        {children}
      </button>
    )
  },
  ConfirmDialog: ({
    confirmText,
    open,
    onConfirm,
    title
  }: {
    confirmText?: ReactNode
    open: boolean
    onConfirm: () => Promise<void>
    title: ReactNode
  }) =>
    open ? (
      <div role="dialog">
        <span>{title}</span>
        <button type="button" onClick={() => void onConfirm()}>
          {confirmText}
        </button>
      </div>
    ) : null,
  DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect
  }: {
    children?: ReactNode
    disabled?: boolean
    onSelect?: () => void
  }) => (
    <button type="button" disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  EmptyState: ({
    actionLabel,
    onAction,
    title
  }: {
    actionLabel?: ReactNode
    onAction?: () => void
    title: ReactNode
  }) => (
    <div>
      <span>{title}</span>
      {actionLabel ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  ),
  Skeleton: () => <div data-testid="skeleton" />,
  Switch: ({ checked, onCheckedChange, ...props }: { checked: boolean; onCheckedChange: (value: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props} />
  )
}))

import { SkillDetails } from '../SkillDetails'

function createSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    id: 'skill-1',
    name: 'Writer',
    description: 'Draft clear prose',
    folderName: 'writer',
    source: 'builtin',
    sourceUrl: null,
    namespace: null,
    author: null,
    version: '1.2.3',
    sourceTags: ['writing'],
    contentHash: 'hash',
    sourceRegistry: null,
    canUpdateFromRemote: false,
    isGlobalEnabled: true,
    isEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides
  }
}

describe('SkillDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.query = { data: createSkill(), error: undefined, isLoading: false }
    mocks.folder = {
      data: { rootPath: '/managed/skills/writer', access: 'read_only', readOnlyReason: 'builtin' },
      error: undefined,
      isLoading: false
    }
    mocks.uninstallSkill.mockResolvedValue(undefined)
    mocks.updateGlobalEnabled.mockResolvedValue(undefined)
    mocks.flushBrowser.mockResolvedValue(undefined)
    mocks.refetch.mockResolvedValue(undefined)
  })

  it('renders loading and not-found states without constructing a file browser', () => {
    mocks.query = { data: undefined, error: undefined, isLoading: true }
    const view = render(<SkillDetails skillId="skill-1" />)
    expect(screen.getAllByTestId('skeleton')).toHaveLength(2)

    view.unmount()
    mocks.query = { data: undefined, error: new Error('missing'), isLoading: false }
    render(<SkillDetails skillId="skill-1" />)
    expect(screen.getByText('settings.skills.notFound')).toBeInTheDocument()
    expect(screen.queryByTestId('skill-file-browser')).not.toBeInTheDocument()
  })

  it('shows metadata separately from source and stacks actions below it on narrow layouts', () => {
    const { container } = render(<SkillDetails skillId="skill-1" />)

    expect(screen.getByRole('heading', { name: 'Writer' })).toBeInTheDocument()
    expect(screen.getByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByTestId('source-badge')).toHaveTextContent('builtin')
    expect(screen.getByText('writing')).toBeInTheDocument()
    expect(screen.getByText('settings.skills.readOnly')).toBeInTheDocument()
    expect(screen.getByTestId('skill-file-browser')).toHaveAttribute('data-root-path', '/managed/skills/writer')
    expect(container.querySelector('[data-ui="skill-detail-header"] > div:last-of-type')).toHaveClass(
      'w-full',
      'lg:w-auto'
    )
  })

  it('launches, toggles, opens, and removes the current Skill from explicit actions', async () => {
    const skill = createSkill()
    mocks.query = { data: skill, error: undefined, isLoading: false }
    mocks.ipcRequest.mockResolvedValue(undefined)
    render(<SkillDetails skillId="skill-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.skills.tryNow' }))
    expect(mocks.launchSkill).toHaveBeenCalledExactlyOnceWith(skill)

    fireEvent.click(screen.getByRole('button', { name: 'library.skill_detail.open_folder' }))
    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledExactlyOnceWith('skill.folder.open', { skillId: 'skill-1' })
    )

    fireEvent.click(screen.getByRole('switch'))
    expect(mocks.updateGlobalEnabled).toHaveBeenCalledExactlyOnceWith(false)

    fireEvent.click(screen.getByRole('button', { name: /library.action.uninstall/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'library.action.uninstall' }))
    await waitFor(() => expect(mocks.uninstallSkill).toHaveBeenCalledOnce())
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/skills' })
  })

  it('returns to the list from the header', () => {
    render(<SkillDetails skillId="skill-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/skills' })
  })

  it('checks and applies a remote update only after flushing the editor', async () => {
    mocks.query = {
      data: createSkill({
        source: 'marketplace',
        sourceRegistry: 'skills.sh',
        canUpdateFromRemote: true
      }),
      error: undefined,
      isLoading: false
    }
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'skill.remote.check') {
        return { state: 'available', localChanges: true, remoteVersion: '2.0.0', revision: 'revision-1' }
      }
      if (route === 'skill.remote.apply') return createSkill({ version: '2.0.0' })
      return undefined
    })
    render(<SkillDetails skillId="skill-1" />)

    expect(screen.getByTestId('source-badge')).toHaveAttribute('data-registry', 'skills.sh')
    fireEvent.click(screen.getByRole('button', { name: 'settings.skills.remote.check' }))
    await waitFor(() => expect(screen.getByText('settings.skills.remote.updateAvailableTitle')).toBeInTheDocument())
    expect(mocks.flushBrowser).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'settings.skills.remote.update' }))
    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('skill.remote.apply', {
        skillId: 'skill-1',
        revision: 'revision-1',
        overwriteLocalChanges: true
      })
    )
    expect(mocks.flushBrowser).toHaveBeenCalledTimes(2)
  })
})
