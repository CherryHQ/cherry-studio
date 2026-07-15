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
  directoryPath: '/home/test/.codex/skills/system-skill',
  placements: [
    {
      sourceId: 'codex',
      sourceName: 'Codex',
      directoryPath: '/home/test/.codex/skills/system-skill'
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
  Spinner: ({ text }: { text?: ReactNode }) => <div>{text}</div>
}))

beforeEach(() => {
  vi.clearAllMocks()
  registerMock.mockResolvedValue(installed)
  useSystemSkillsMock.mockReturnValue({
    skills: [candidate],
    loading: false,
    error: null,
    refresh: vi.fn(),
    register: registerMock,
    registering: new Set<string>()
  })
})

describe('SystemSkillDialog', () => {
  it('registers and selects a system skill before the agent exists', async () => {
    const user = userEvent.setup()
    const onRegistered = vi.fn()
    render(<SystemSkillDialog open onOpenChange={vi.fn()} onRegistered={onRegistered} />)

    await user.click(screen.getByRole('button', { name: 'library.system_skill.reference_select' }))

    expect(useSystemSkillsMock).toHaveBeenCalledWith(undefined, true)
    expect(registerMock).toHaveBeenCalledWith(candidate)
    expect(onRegistered).toHaveBeenCalledWith(installed)
    expect(toastSuccess).toHaveBeenCalledWith('library.system_skill.reference_select_success:System Skill')
  })

  it('keeps register-and-enable behavior for an existing agent', async () => {
    const user = userEvent.setup()
    render(<SystemSkillDialog agentId="agent-1" open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'library.system_skill.reference_enable' }))

    expect(useSystemSkillsMock).toHaveBeenCalledWith('agent-1', true)
    expect(toastSuccess).toHaveBeenCalledWith('library.system_skill.reference_enable_success:System Skill')
  })

  it('does not register a system skill that is already selected', () => {
    useSystemSkillsMock.mockReturnValue({
      skills: [{ ...candidate, status: 'registered', registeredSkillId: installed.id }],
      loading: false,
      error: null,
      refresh: vi.fn(),
      register: registerMock,
      registering: new Set<string>()
    })

    render(<SystemSkillDialog open onOpenChange={vi.fn()} selectedIds={[installed.id]} />)

    expect(screen.getByRole('button', { name: 'common.selected' })).toBeDisabled()
    expect(registerMock).not.toHaveBeenCalled()
  })
})
