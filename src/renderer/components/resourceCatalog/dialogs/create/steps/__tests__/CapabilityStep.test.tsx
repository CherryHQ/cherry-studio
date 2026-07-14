import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'
import { CapabilityStep } from '../CapabilityStep'

const { importSkillDialogState, marketplaceDialogState } = vi.hoisted(() => ({
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
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    skills: [
      { id: 'skill-a', name: 'Alpha Skill', source: 'local' },
      { id: 'skill-b', name: 'Beta Skill', source: 'local' },
      { id: 'skill-builtin', name: 'Builtin Skill', source: 'builtin' }
    ],
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
    importSkillDialogState.current = null
    marketplaceDialogState.current = null
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

    await user.click(screen.getByRole('button', { name: 'library.config.dialogs.create.capability.import' }))
    expect(importSkillDialogState.current?.open).toBe(true)
  })

  it('opens online skill search', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    await user.click(screen.getByRole('button', { name: 'library.skill_add.online_search' }))
    expect(marketplaceDialogState.current?.open).toBe(true)
  })
})
