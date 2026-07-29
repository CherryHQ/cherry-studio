import type * as CherryStudioUi from '@cherrystudio/ui'
import { Form } from '@cherrystudio/ui'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'
import { PersonaStep } from '../PersonaStep'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/PromptEditorField', () => ({
  PromptEditorField: ({
    actions,
    value,
    onChange,
    resetPreviewKey
  }: {
    actions?: ReactNode
    value: string
    onChange: (value: string) => void
    resetPreviewKey?: number
  }) => (
    <div>
      {actions}
      <textarea aria-label="persona-prompt" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      <output data-testid="preview-reset-key">{resetPreviewKey}</output>
    </div>
  )
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions', () => ({
  PromptPolishActions: ({
    fallbackSource,
    emptyValueSystemPrompt,
    existingValueSystemPrompt,
    onChange
  }: {
    fallbackSource?: string
    emptyValueSystemPrompt: string
    existingValueSystemPrompt: string
    onChange: (value: string) => void
  }) => (
    <button
      type="button"
      data-fallback-source={fallbackSource}
      data-empty-value-system-prompt={emptyValueSystemPrompt}
      data-existing-value-system-prompt={existingValueSystemPrompt}
      onClick={() => onChange('Polished persona prompt')}>
      Polish prompt
    </button>
  )
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/components/EditDialogShared', () => ({
  EDIT_DIALOG_PROMPT_MAX_HEIGHT: '18rem',
  EDIT_DIALOG_PROMPT_MIN_HEIGHT: '10rem',
  FieldLabelWithHelp: ({ label }: { label: ReactNode }) => <>{label}</>,
  PromptVariablesPopover: () => null
}))

function Harness({ name = '' }: { name?: string }) {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: {
      avatar: '💬',
      name,
      description: '',
      modelId: null,
      prompt: 'Original persona prompt',
      knowledgeBaseIds: [],
      skillIds: []
    }
  })

  return (
    <Form {...form}>
      <PersonaStep form={form} portalContainer={null} />
    </Form>
  )
}

afterEach(cleanup)

describe('PersonaStep', () => {
  it('wires prompt generation and polish into the create form', async () => {
    const user = userEvent.setup()

    render(<Harness name="Research Assistant" />)

    const action = screen.getByRole('button', { name: 'Polish prompt' })
    expect(action).toHaveAttribute('data-fallback-source', 'Research Assistant')
    expect(action).toHaveAttribute(
      'data-empty-value-system-prompt',
      expect.stringContaining('You are a Prompt Generator.')
    )
    expect(action).toHaveAttribute(
      'data-existing-value-system-prompt',
      expect.stringContaining('Improve the supplied system prompt without changing its intent or authority.')
    )

    await user.click(action)

    expect(screen.getByLabelText('persona-prompt')).toHaveValue('Polished persona prompt')
    expect(screen.getByTestId('preview-reset-key')).toHaveTextContent('1')
  })
})
