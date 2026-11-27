import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstalledSkill } from '@shared/types/skill'

import type { ResourceCreateWizardFormValues } from '../../types'
import { CapabilityStep } from '../CapabilityStep'

const { importSkillDialogState, installedSkillsState, marketplaceDialogState, systemSkillDialogState } = vi.hoisted(
  () => ({
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
      skills: [] as InstalledSkill[]
    },
    systemSkillDialogState: {
      current: null as null | {
        open: boolean
        onOpenChange: (open: boolean) => void
        mode: 'manage' | 'agent-create'
        onEnabled?: (skillId: string) => void
        selectedSkillIds?: readonly string[]
      }
    }
  })
)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useReconcileSkillsOnOpen: vi.fn(),
  useInstalledSkills: () => ({
    skills: installedSkillsState.skills,
    loading: false
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
      agentType: 'claude-code',
      permissionMode: 'default',
      modelId: null,
      prompt: '',
      knowledgeBaseIds: []
    }
  })

  return (
    <>
      <CapabilityStep form={form} portalContainer={null} />
      <output data-testid="disabled-skills">{form.watch('disabledSkillIds')?.join(',')}</output>
    </>
  )
}

describe('CapabilityStep', () => {
  beforeEach(() => {
    installedSkillsState.skills = [
      { id: 'skill-a', name: 'Alpha Skill', source: 'system', isGlobalEnabled: true, activationState: 'active' },
      { id: 'skill-b', name: 'Beta Skill', source: 'local', isGlobalEnabled: true, activationState: 'active' },
      {
        id: 'skill-builtin',
        name: 'Builtin Skill',
        source: 'builtin',
        isGlobalEnabled: true,
        activationState: 'active'
      },
      { id: 'skill-pending', name: 'Pending Skill', source: 'local', isGlobalEnabled: true, activationState: 'pending' }
    ] as InstalledSkill[]
    importSkillDialogState.current = null
    marketplaceDialogState.current = null
    systemSkillDialogState.current = null
  })

  it('starts inherited skills on and retains an explicit opt-out across catalog refreshes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CapabilityStepHarness />)
    const alpha = () => screen.getByRole('switch', { name: 'Alpha Skill' })
    const beta = () => screen.getByRole('switch', { name: 'Beta Skill' })

    expect(alpha()).toBeChecked()
    expect(beta()).toBeChecked()
    await user.click(alpha())
    expect(alpha()).not.toBeChecked()
    expect(screen.getByTestId('disabled-skills')).toHaveTextContent('skill-a')

    const initialSkills = installedSkillsState.skills
    installedSkillsState.skills = initialSkills.filter((skill) => skill.id !== 'skill-a')
    rerender(<CapabilityStepHarness />)
    await user.click(beta())
    installedSkillsState.skills = [
      ...initialSkills,
      {
        id: 'new-skill',
        name: 'New Skill',
        source: 'local',
        isGlobalEnabled: true,
        activationState: 'active'
      } as InstalledSkill
    ]
    rerender(<CapabilityStepHarness />)
    expect(alpha()).not.toBeChecked()
    expect(beta()).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'New Skill' })).toBeChecked()

    await user.click(alpha())
    expect(screen.getByTestId('disabled-skills')).toHaveTextContent(/^skill-b$/)
  })

  it('keeps pending skills unavailable and builtins locked during bulk selection', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    const builtinCheckbox = screen.getByRole('switch', { name: 'Builtin Skill' })
    expect(screen.queryByRole('switch', { name: 'Pending Skill' })).toBeNull()
    expect(screen.getByText('settings.skills.pendingActivationDescription')).toBeVisible()
    expect(builtinCheckbox).toBeChecked()
    expect(builtinCheckbox).toBeDisabled()

    const selectAllSwitch = screen.getByRole('switch', {
      name: 'library.config.agent.section.tools.skills_enable_all'
    })
    const alphaSkill = screen.getByRole('switch', { name: 'Alpha Skill' })
    const betaSkill = screen.getByRole('switch', { name: 'Beta Skill' })

    expect(selectAllSwitch).toBeChecked()
    await user.click(selectAllSwitch)
    expect(screen.getByTestId('disabled-skills')).toHaveTextContent('skill-a,skill-b')
    expect(alphaSkill).not.toBeChecked()
    expect(betaSkill).not.toBeChecked()
    expect(builtinCheckbox).toBeChecked()

    await user.click(selectAllSwitch)
    expect(screen.getByTestId('disabled-skills')).toBeEmptyDOMElement()
    expect(alphaSkill).toBeChecked()
    expect(betaSkill).toBeChecked()
  })

  it('restores an opted-out system skill from system search', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    const alpha = screen.getByRole('switch', { name: 'Alpha Skill' })
    expect(alpha).toBeChecked()
    await user.click(alpha)
    await user.click(screen.getByRole('button', { name: 'library.skill_add.add' }))
    await user.click(screen.getByRole('button', { name: 'library.skill_add.system_search' }))
    expect(systemSkillDialogState.current?.open).toBe(true)
    expect(systemSkillDialogState.current?.mode).toBe('agent-create')

    act(() => systemSkillDialogState.current?.onEnabled?.('skill-a'))
    expect(alpha).toBeChecked()
    expect(screen.getByTestId('disabled-skills')).toBeEmptyDOMElement()
  })
})
