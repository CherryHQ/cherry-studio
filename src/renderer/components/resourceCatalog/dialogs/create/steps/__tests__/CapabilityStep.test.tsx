import type { InstalledSkill } from '@shared/types/skill'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'
import { CapabilityStep } from '../CapabilityStep'

const {
  importSkillDialogState,
  installedSkillsState,
  marketplaceDialogState,
  systemSkillDialogState,
  uninstallSkillMock
} = vi.hoisted(() => ({
  importSkillDialogState: {
    current: null as null | {
      open: boolean
      onOpenChange: (open: boolean) => void
    }
  },
  marketplaceDialogState: {
    current: null as null | {
      open: boolean
      onOpenChange: (open: boolean) => void
    }
  },
  installedSkillsState: {
    skills: [
      { id: 'skill-a', name: 'Alpha Skill', source: 'local' },
      { id: 'skill-b', name: 'Beta Skill', source: 'local' },
      { id: 'skill-builtin', name: 'Builtin Skill', source: 'builtin' }
    ] as InstalledSkill[]
  },
  systemSkillDialogState: {
    current: null as null | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'manage' | 'agent-create'
      onEnabled?: (skillId: string) => void
      selectedSkillIds?: readonly string[]
    }
  },
  uninstallSkillMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    skills: installedSkillsState.skills,
    loading: false,
    uninstall: uninstallSkillMock
  })
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/skill/ImportSkillDialog', () => ({
  ImportSkillDialog: (props: { open: boolean; onOpenChange: (open: boolean) => void }) => {
    importSkillDialogState.current = props
    return props.open ? <div>Skill import dialog</div> : null
  }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/skill/SkillMarketplaceDialog', () => ({
  SkillMarketplaceDialog: (props: { open: boolean; onOpenChange: (open: boolean) => void }) => {
    marketplaceDialogState.current = props
    return props.open ? <div>Skill marketplace dialog</div> : null
  }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/skill/SystemSkillDialog', () => ({
  SystemSkillDialog: (props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: 'manage' | 'agent-create'
    onEnabled?: (skillId: string) => void
    selectedSkillIds?: readonly string[]
  }) => {
    systemSkillDialogState.current = props
    return props.open ? <div>System skill dialog</div> : null
  }
}))

function CapabilityStepHarness() {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: {
      avatar: '🤖',
      name: '',
      description: '',
      modelId: null,
      prompt: '',
      knowledgeBaseIds: [],
      skillIds: []
    }
  })

  return (
    <>
      <CapabilityStep form={form} portalContainer={null} />
      <output data-testid="skill-ids">{form.watch('skillIds').join(',')}</output>
    </>
  )
}

describe('CapabilityStep', () => {
  beforeEach(() => {
    installedSkillsState.skills = [
      { id: 'skill-a', name: 'Alpha Skill', source: 'local' },
      { id: 'skill-b', name: 'Beta Skill', source: 'local' },
      { id: 'skill-builtin', name: 'Builtin Skill', source: 'builtin' }
    ] as InstalledSkill[]
    uninstallSkillMock.mockReset()
    uninstallSkillMock.mockResolvedValue(true)
    importSkillDialogState.current = null
    marketplaceDialogState.current = null
    systemSkillDialogState.current = null
  })

  it('writes selected skills through the checkbox catalog variant', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    await user.click(screen.getByRole('checkbox', { name: 'Alpha Skill' }))
    expect(screen.getByTestId('skill-ids')).toHaveTextContent('skill-a')

    await user.click(screen.getByRole('checkbox', { name: 'Beta Skill' }))
    expect(screen.getByTestId('skill-ids')).toHaveTextContent('skill-a,skill-b')

    await user.click(screen.getByRole('checkbox', { name: 'Alpha Skill' }))
    expect(screen.getByTestId('skill-ids')).toHaveTextContent('skill-b')
  })

  it('shows builtin skills pre-checked and locked, and never adds them to skillIds', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    const builtinCheckbox = screen.getByRole('checkbox', { name: 'Builtin Skill' })
    expect(builtinCheckbox).toBeChecked()
    expect(builtinCheckbox).toBeDisabled()

    await user.click(builtinCheckbox)
    expect(builtinCheckbox).toBeChecked()
    expect(screen.getByTestId('skill-ids').textContent).toBe('')

    await user.click(screen.getByRole('checkbox', { name: 'Alpha Skill' }))
    expect(screen.getByTestId('skill-ids').textContent).toBe('skill-a')
  })

  it('selects and clears every configurable skill without adding builtin skills to skillIds', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    const selectAllSwitch = screen.getByRole('switch', {
      name: 'library.config.agent.section.tools.skills_enable_all'
    })
    const alphaSkill = screen.getByRole('checkbox', { name: 'Alpha Skill' })
    const betaSkill = screen.getByRole('checkbox', { name: 'Beta Skill' })
    const builtinSkill = screen.getByRole('checkbox', { name: 'Builtin Skill' })

    await user.click(selectAllSwitch)
    expect(screen.getByTestId('skill-ids')).toHaveTextContent('skill-a,skill-b')
    expect(alphaSkill).toBeChecked()
    expect(betaSkill).toBeChecked()
    expect(builtinSkill).toBeChecked()

    await user.click(selectAllSwitch)
    expect(screen.getByTestId('skill-ids').textContent).toBe('')
    expect(alphaSkill).not.toBeChecked()
    expect(betaSkill).not.toBeChecked()
    expect(builtinSkill).toBeChecked()
  })

  it('opens the skill import dialog', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    await user.click(screen.getByRole('button', { name: 'library.skill_add.add' }))
    await user.click(screen.getByRole('button', { name: 'library.skill_add.local_import' }))
    expect(importSkillDialogState.current?.open).toBe(true)
  })

  it('opens online skill search', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    await user.click(screen.getByRole('button', { name: 'library.skill_add.add' }))
    await user.click(screen.getByRole('button', { name: 'library.skill_add.online_search' }))
    expect(marketplaceDialogState.current?.open).toBe(true)
  })

  it('enables an imported system skill for the new agent selection', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    await user.click(screen.getByRole('button', { name: 'library.skill_add.add' }))
    await user.click(screen.getByRole('button', { name: 'library.skill_add.system_search' }))
    expect(systemSkillDialogState.current?.open).toBe(true)
    expect(systemSkillDialogState.current?.mode).toBe('agent-create')

    act(() => systemSkillDialogState.current?.onEnabled?.('system-skill-id'))
    expect(screen.getByTestId('skill-ids')).toHaveTextContent('system-skill-id')
    expect(systemSkillDialogState.current?.selectedSkillIds).toEqual(['system-skill-id'])
  })

  it('uninstalls a system skill from the skill list', async () => {
    const user = userEvent.setup()
    installedSkillsState.skills = [
      ...installedSkillsState.skills,
      { id: 'system-skill-id', name: 'System Skill', source: 'system' } as InstalledSkill
    ]
    render(<CapabilityStepHarness />)

    act(() => systemSkillDialogState.current?.onEnabled?.('system-skill-id'))
    expect(screen.getByRole('checkbox', { name: 'System Skill' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'library.action.uninstall' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'library.action.uninstall' }))

    await waitFor(() => expect(uninstallSkillMock).toHaveBeenCalledWith('system-skill-id'))
    expect(screen.getByTestId('skill-ids').textContent).toBe('')
  })

  it('uninstalls an online skill from the skill list', async () => {
    const user = userEvent.setup()
    installedSkillsState.skills = [
      ...installedSkillsState.skills,
      { id: 'marketplace-skill-id', name: 'Marketplace Skill', source: 'marketplace' } as InstalledSkill
    ]
    render(<CapabilityStepHarness />)

    await user.click(screen.getByRole('checkbox', { name: 'Marketplace Skill' }))
    expect(screen.getByTestId('skill-ids')).toHaveTextContent('marketplace-skill-id')

    await user.click(screen.getByRole('button', { name: 'library.action.uninstall' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'library.action.uninstall' }))

    await waitFor(() => expect(uninstallSkillMock).toHaveBeenCalledWith('marketplace-skill-id'))
    expect(screen.getByTestId('skill-ids').textContent).toBe('')
  })
})
