import type { SystemSkillCandidate } from '@shared/types/skill'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SystemSkillDialog } from '../SystemSkillDialog'

const { importSkillMock, toastSuccess, useSystemSkillsMock } = vi.hoisted(() => ({
  importSkillMock: vi.fn(),
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
  importSkillMock.mockResolvedValue({ id: 'system-skill-id' })
  useSystemSkillsMock.mockReturnValue({
    skills: [candidate],
    loading: false,
    error: null,
    importSkill: importSkillMock,
    importing: new Set<string>()
  })
})

describe('SystemSkillDialog', () => {
  it('imports a system skill without enabling it from skill management', async () => {
    const user = userEvent.setup()
    render(<SystemSkillDialog mode="manage" open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'library.system_skill.import' }))

    expect(useSystemSkillsMock).toHaveBeenCalledWith(true)
    expect(importSkillMock).toHaveBeenCalledWith(candidate)
    expect(toastSuccess).toHaveBeenCalledWith('library.system_skill.import_success:System Skill')
  })

  it('imports without enabling from agent creation', async () => {
    const user = userEvent.setup()
    const onEnabled = vi.fn()
    render(
      <SystemSkillDialog mode="agent-create" open onOpenChange={vi.fn()} onEnabled={onEnabled} selectedSkillIds={[]} />
    )

    await user.click(screen.getByRole('button', { name: 'library.system_skill.import' }))

    expect(useSystemSkillsMock).toHaveBeenCalledWith(true)
    expect(onEnabled).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('library.system_skill.import_success:System Skill')
  })

  it('does not show a manual refresh action', () => {
    render(<SystemSkillDialog mode="manage" open onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'common.refresh' })).not.toBeInTheDocument()
  })

  it('shows an imported system skill as imported in skill management', () => {
    const registeredCandidate = { ...candidate, status: 'registered' as const, registeredSkillId: 'system-skill-id' }
    useSystemSkillsMock.mockReturnValue({
      skills: [registeredCandidate],
      loading: false,
      error: null,
      importSkill: importSkillMock,
      importing: new Set<string>()
    })

    render(<SystemSkillDialog mode="manage" open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'library.system_skill.imported' })).toBeDisabled()
  })

  it('enables an imported skill for a new agent without importing it again', async () => {
    const user = userEvent.setup()
    const onEnabled = vi.fn()
    const registeredCandidate = { ...candidate, status: 'registered' as const, registeredSkillId: 'system-skill-id' }
    useSystemSkillsMock.mockReturnValue({
      skills: [registeredCandidate],
      loading: false,
      error: null,
      importSkill: importSkillMock,
      importing: new Set<string>()
    })

    render(
      <SystemSkillDialog mode="agent-create" open onOpenChange={vi.fn()} onEnabled={onEnabled} selectedSkillIds={[]} />
    )

    await user.click(screen.getByRole('button', { name: 'library.action.enable' }))

    expect(onEnabled).toHaveBeenCalledWith('system-skill-id')
    expect(importSkillMock).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('library.system_skill.enable_success:System Skill')
  })

  it('shows a selected imported skill as enabled during agent creation', () => {
    const registeredCandidate = { ...candidate, status: 'registered' as const, registeredSkillId: 'system-skill-id' }
    useSystemSkillsMock.mockReturnValue({
      skills: [registeredCandidate],
      loading: false,
      error: null,
      importSkill: importSkillMock,
      importing: new Set<string>()
    })

    render(
      <SystemSkillDialog
        mode="agent-create"
        open
        onOpenChange={vi.fn()}
        onEnabled={vi.fn()}
        selectedSkillIds={['system-skill-id']}
      />
    )

    expect(screen.getByRole('button', { name: 'library.system_skill.enabled' })).toBeDisabled()
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
      importSkill: importSkillMock,
      importing: new Set<string>()
    })

    render(<SystemSkillDialog mode="manage" open onOpenChange={vi.fn()} />)

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
