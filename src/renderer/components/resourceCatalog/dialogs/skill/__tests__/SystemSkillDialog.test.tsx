import type { InstalledSkill, SystemSkillCandidate } from '@shared/types/skill'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SystemSkillDialog } from '../SystemSkillDialog'

const { registerMock, toastSuccess, useSystemSkillsMock } = vi.hoisted(() => ({
  registerMock: vi.fn(),
  toastSuccess: vi.fn(),
  useSystemSkillsMock: vi.fn()
}))

const candidate: SystemSkillCandidate = {
  id: 'candidate-1',
  name: 'System Skill',
  filename: 'system-skill',
  directoryPath: '/home/test123/.codex/skills/system-skill',
  placements: [
    {
      sourceId: 'codex',
      sourceName: 'Codex',
      directoryPath: '/home/test123/.codex/skills/system-skill'
    }
  ],
  status: 'available'
}

const installed = {
  id: 'system-skill-id',
  name: candidate.name
} as InstalledSkill

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key)
  })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useSystemSkills: useSystemSkillsMock
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: toastSuccess }
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
  Center: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
  DialogContent: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  EmptyState: ({ description, title }: { description?: string; title?: string }) => (
    <div>
      {title}
      {description}
    </div>
  ),
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Spinner: ({ text }: { text?: ReactNode }) => <div>{text}</div>
}))

beforeEach(() => {
  vi.clearAllMocks()
  registerMock.mockResolvedValue(installed)
  useSystemSkillsMock.mockReturnValue({
    skills: [candidate],
    loading: false,
    error: null,
    register: registerMock,
    registering: new Set<string>()
  })
})

describe('SystemSkillDialog', () => {
  it('imports a system skill before the agent exists', async () => {
    const user = userEvent.setup()
    const onRegistered = vi.fn()
    render(<SystemSkillDialog open onOpenChange={vi.fn()} onRegistered={onRegistered} />)

    await user.click(screen.getByRole('button', { name: 'library.system_skill.import' }))

    expect(useSystemSkillsMock).toHaveBeenCalledWith(undefined, true)
    expect(registerMock).toHaveBeenCalledWith(candidate)
    expect(onRegistered).toHaveBeenCalledWith(installed)
    expect(toastSuccess).toHaveBeenCalledWith('library.system_skill.import_success:System Skill')
  })

  it('imports a system skill for an existing agent', async () => {
    const user = userEvent.setup()
    render(<SystemSkillDialog agentId="agent-1" open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'library.system_skill.import' }))

    expect(useSystemSkillsMock).toHaveBeenCalledWith('agent-1', true)
    expect(toastSuccess).toHaveBeenCalledWith('library.system_skill.import_success:System Skill')
  })

  it('does not show a manual refresh action', () => {
    render(<SystemSkillDialog open onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'common.refresh' })).not.toBeInTheDocument()
  })

  it('keeps a registered skill importable for the current agent', () => {
    const registeredCandidate = { ...candidate, status: 'registered' as const, registeredSkillId: installed.id }
    useSystemSkillsMock.mockReturnValue({
      skills: [registeredCandidate],
      loading: false,
      error: null,
      register: registerMock,
      registering: new Set<string>()
    })

    render(<SystemSkillDialog agentId="agent-1" open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'library.system_skill.import' })).toBeEnabled()
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('shows an enabled skill as imported', () => {
    useSystemSkillsMock.mockReturnValue({
      skills: [{ ...candidate, status: 'enabled' }],
      loading: false,
      error: null,
      register: registerMock,
      registering: new Set<string>()
    })

    render(<SystemSkillDialog agentId="agent-1" open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'library.system_skill.imported' })).toBeDisabled()
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('filters system skills by the search query', async () => {
    const user = userEvent.setup()
    useSystemSkillsMock.mockReturnValue({
      skills: [
        candidate,
        {
          ...candidate,
          id: 'candidate-2',
          name: 'Other Skill',
          directoryPath: '/home/test/.claude/skills/other-skill'
        }
      ],
      loading: false,
      error: null,
      register: registerMock,
      registering: new Set<string>()
    })

    render(<SystemSkillDialog open onOpenChange={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('library.system_skill.search_placeholder'), 'other')

    expect(screen.queryByText('System Skill')).not.toBeInTheDocument()
    expect(screen.getByText('Other Skill')).toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText('library.system_skill.search_placeholder'))
    await user.type(screen.getByPlaceholderText('library.system_skill.search_placeholder'), '123')

    expect(screen.queryByText('System Skill')).not.toBeInTheDocument()
    expect(screen.queryByText('Other Skill')).not.toBeInTheDocument()
    expect(screen.getByText('common.no_results')).toBeInTheDocument()
  })
})
