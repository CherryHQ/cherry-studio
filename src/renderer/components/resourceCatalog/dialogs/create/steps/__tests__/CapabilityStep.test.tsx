import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'
import { CapabilityStep } from '../CapabilityStep'

const { importSkillDialogState, marketplaceDialogState, refreshMock } = vi.hoisted(() => ({
  importSkillDialogState: {
    current: null as null | {
      open: boolean
      onOpenChange: (open: boolean) => void
      onInstalled?: () => void
    }
  },
  marketplaceDialogState: {
    current: null as null | {
      open: boolean
      onOpenChange: (open: boolean) => void
      onInstalled?: () => void
    }
  },
  refreshMock: vi.fn()
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
    loading: false,
    refresh: refreshMock
  })
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/import', () => ({
  ImportSkillDialog: (props: { open: boolean; onOpenChange: (open: boolean) => void; onInstalled?: () => void }) => {
    importSkillDialogState.current = props
    return props.open ? (
      <button type="button" onClick={() => props.onInstalled?.()}>
        Complete skill import
      </button>
    ) : null
  },
  SkillMarketplaceDialog: (props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onInstalled?: () => void
  }) => {
    marketplaceDialogState.current = props
    return props.open ? (
      <button type="button" onClick={() => props.onInstalled?.()}>
        Complete marketplace install
      </button>
    ) : null
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
    refreshMock.mockClear()
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

  it('opens the skill import dialog and refreshes the catalog after installation', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    await user.click(screen.getByRole('button', { name: 'library.config.dialogs.create.capability.import' }))
    expect(importSkillDialogState.current?.open).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Complete skill import' }))
    expect(refreshMock).toHaveBeenCalledOnce()
  })

  it('opens online skill search and refreshes the catalog after installation', async () => {
    const user = userEvent.setup()
    render(<CapabilityStepHarness />)

    await user.click(screen.getByRole('button', { name: 'library.skill_add.online_search' }))
    expect(marketplaceDialogState.current?.open).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Complete marketplace install' }))
    expect(refreshMock).toHaveBeenCalledOnce()
  })
})
