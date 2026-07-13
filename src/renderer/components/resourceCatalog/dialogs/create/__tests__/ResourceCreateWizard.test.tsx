import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => ['provider::default-model', vi.fn()]
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({
    model: {
      id: 'provider::default-model',
      providerId: 'provider',
      name: 'Default Model',
      capabilities: []
    }
  })
}))

// Mock the step bodies so the wizard shell (navigation, validation gate, submit
// mapping) is exercised in isolation. BasicInfoStep fills the fields that gate
// the Next button; PersonaStep fills the prompt.
vi.mock('../steps/BasicInfoStep', () => ({
  BasicInfoStep: ({ form }: { form: { setValue: (name: string, value: unknown) => void } }) => (
    <>
      <button type="button" onClick={() => form.setValue('name', 'My Resource')}>
        fill name
      </button>
      <button
        type="button"
        onClick={() => {
          form.setValue('name', 'My Resource')
          form.setValue('modelId', 'provider::model')
        }}>
        fill basic
      </button>
    </>
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
const CANCEL = 'common.cancel'

afterEach(cleanup)

describe('ResourceCreateWizard', () => {
  it('uses the global default model for a newly created resource', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'fill name' }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(onSubmit).toHaveBeenCalledWith({
      avatar: '💬',
      name: 'My Resource',
      modelId: 'provider::default-model',
      description: '',
      prompt: '',
      knowledgeBaseIds: [],
      skillIds: []
    })
  })

  it('does not use the global default model when it is excluded by the model filter', async () => {
    const user = userEvent.setup()
    render(
      <ResourceCreateWizard kind="agent" open onOpenChange={vi.fn()} onSubmit={vi.fn()} modelFilter={() => false} />
    )

    await user.click(screen.getByRole('button', { name: 'fill name' }))

    expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()
  })

  it('removes an auto-selected default model if the model filter later excludes it', async () => {
    const user = userEvent.setup()
    let defaultModelAllowed = true
    const modelFilter = () => defaultModelAllowed
    const props = {
      kind: 'agent' as const,
      open: true,
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
      modelFilter
    }
    const { rerender } = render(<ResourceCreateWizard {...props} />)

    await user.click(screen.getByRole('button', { name: 'fill name' }))
    expect(screen.getByRole('button', { name: NEXT })).toBeEnabled()

    defaultModelAllowed = false
    rerender(<ResourceCreateWizard {...props} />)

    expect(screen.getByRole('button', { name: NEXT })).toBeDisabled()
  })

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
      skillIds: []
    })
  })

  it('surfaces the actionable submit error and leaves the dialog closable after failure', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Selected skill no longer exists'))

    render(<ResourceCreateWizard kind="assistant" open onOpenChange={onOpenChange} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))

    expect(await screen.findByText('Selected skill no longer exists')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'library.config.dialogs.create.assistant_title' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: CANCEL }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
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
