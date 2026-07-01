import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'
import { CapabilityStep } from '../CapabilityStep'

const refreshMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    skills: [
      { id: 'skill-a', name: 'Alpha Skill' },
      { id: 'skill-b', name: 'Beta Skill' }
    ],
    loading: false,
    refresh: refreshMock
  })
}))

vi.mock('@renderer/components/resource/dialogs/ImportSkillDialog', () => ({
  ImportSkillDialog: () => null
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
})
