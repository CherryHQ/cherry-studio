import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// Mock the step bodies so the wizard shell (navigation, validation gate, submit
// mapping) is exercised in isolation. BasicInfoStep fills the fields that gate
// the Next button; PersonaStep fills the prompt.
vi.mock('../steps/BasicInfoStep', () => ({
  BasicInfoStep: ({ form }: { form: { setValue: (name: string, value: unknown) => void } }) => (
    <button
      type="button"
      onClick={() => {
        form.setValue('name', 'My Resource')
        form.setValue('modelId', 'provider::model')
      }}>
      fill basic
    </button>
  )
}))
vi.mock('../steps/PersonaStep', () => ({
  PersonaStep: ({ form }: { form: { setValue: (name: string, value: unknown) => void } }) => (
    <button type="button" onClick={() => form.setValue('prompt', 'be helpful')}>
      fill persona
    </button>
  )
}))
vi.mock('../steps/KnowledgeStep', () => ({
  KnowledgeStep: () => <div data-testid="knowledge-step" />
}))
vi.mock('../steps/CapabilityStep', () => ({
  CapabilityStep: () => <div data-testid="capability-step" />
}))

import { ResourceCreateWizard } from '../ResourceCreateWizard'

const NEXT = 'library.config.dialogs.create.next'
const CREATE = 'library.config.dialogs.create.submit'

afterEach(cleanup)

describe('ResourceCreateWizard', () => {
  it('gates Next on a valid name + model, then walks assistant steps to a mapped submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={onSubmit} />)

    // Step 1: Next is blocked until name + model are set.
    expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    // Step 1 → 2 (persona)
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: 'fill persona' }))

    // Step 2 → 3 (assistant: knowledge)
    await user.click(screen.getByRole('button', { name: NEXT }))
    expect(screen.getByTestId('knowledge-step')).toBeInTheDocument()

    // Final create → mapped payload
    await user.click(screen.getByRole('button', { name: CREATE }))
    expect(onSubmit).toHaveBeenCalledWith({
      avatar: '💬',
      name: 'My Resource',
      modelId: 'provider::model',
      description: '',
      prompt: 'be helpful',
      knowledgeBaseIds: [],
      mcps: [],
      disabledTools: [],
      skillIds: []
    })
  })

  it('shows the capability step (not knowledge) for the agent kind', async () => {
    const user = userEvent.setup()
    render(<ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))

    expect(screen.getByTestId('capability-step')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-step')).not.toBeInTheDocument()
  })
})
