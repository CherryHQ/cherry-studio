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
    onChange,
    onRunningChange
  }: {
    fallbackSource?: string
    emptyValueSystemPrompt: string
    existingValueSystemPrompt: string
    onChange: (value: string) => void
    onRunningChange: (running: boolean) => void
  }) => (
    <>
      <button
        type="button"
        data-fallback-source={fallbackSource}
        data-empty-value-system-prompt={emptyValueSystemPrompt}
        data-existing-value-system-prompt={existingValueSystemPrompt}
        onClick={() => onChange('Polished persona prompt')}>
        Polish prompt
      </button>
      <button type="button" onClick={() => onRunningChange(true)}>
        Start polishing
      </button>
    </>
  )
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/components/EditDialogShared', () => ({
  EDIT_DIALOG_PROMPT_MAX_HEIGHT: '18rem',
  EDIT_DIALOG_PROMPT_MIN_HEIGHT: '10rem',
  FieldLabelWithHelp: ({ label }: { label: ReactNode }) => <>{label}</>,
  PromptVariablesPopover: () => null
}))

function Harness({
  name = '',
  emptyValueSystemPrompt = 'empty-value-strategy',
  existingValueSystemPrompt = 'existing-value-strategy',
  onRunningChange = vi.fn()
}: {
  name?: string
  emptyValueSystemPrompt?: string
  existingValueSystemPrompt?: string
  onRunningChange?: (running: boolean) => void
}) {
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
      <PersonaStep
        form={form}
        portalContainer={null}
        emptyValueSystemPrompt={emptyValueSystemPrompt}
        existingValueSystemPrompt={existingValueSystemPrompt}
        onRunningChange={onRunningChange}
      />
    </Form>
  )
}

afterEach(cleanup)

describe('PersonaStep', () => {
  it('writes the polished prompt back to the create form', async () => {
    const user = userEvent.setup()

    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Polish prompt' }))

    expect(screen.getByLabelText('persona-prompt')).toHaveValue('Polished persona prompt')
    expect(screen.getByTestId('preview-reset-key')).toHaveTextContent('1')
  })

  it('reports action-running state to the create wizard', async () => {
    const user = userEvent.setup()
    const onRunningChange = vi.fn()

    render(<Harness onRunningChange={onRunningChange} />)

    await user.click(screen.getByRole('button', { name: 'Start polishing' }))

    expect(onRunningChange).toHaveBeenCalledWith(true)
  })

  it('uses the resource name as the blank-prompt generation fallback', () => {
    render(<Harness name="Research Assistant" />)

    expect(screen.getByRole('button', { name: 'Polish prompt' })).toHaveAttribute(
      'data-fallback-source',
      'Research Assistant'
    )
  })

  it('forwards the owning flow prompt strategies', () => {
    render(
      <Harness emptyValueSystemPrompt="custom-empty-strategy" existingValueSystemPrompt="custom-existing-strategy" />
    )

    expect(screen.getByRole('button', { name: 'Polish prompt' })).toHaveAttribute(
      'data-empty-value-system-prompt',
      'custom-empty-strategy'
    )
    expect(screen.getByRole('button', { name: 'Polish prompt' })).toHaveAttribute(
      'data-existing-value-system-prompt',
      'custom-existing-strategy'
    )
  })
})
