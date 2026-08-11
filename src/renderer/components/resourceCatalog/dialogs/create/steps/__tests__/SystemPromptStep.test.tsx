import type * as CherryStudioUi from '@cherrystudio/ui'
import { Form } from '@cherrystudio/ui'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'
import { SystemPromptStep } from '../SystemPromptStep'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/PromptEditorField', () => ({
  PromptEditorField: ({
    actions,
    value,
    onChange,
    previewValue,
    resetPreviewKey
  }: {
    actions?: ReactNode
    value: string
    onChange: (value: string) => void
    previewValue?: string
    resetPreviewKey?: number
  }) => (
    <div>
      {actions}
      <textarea aria-label="system-prompt" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      <output aria-label="system-prompt-preview">{previewValue}</output>
      <output data-testid="preview-reset-key">{resetPreviewKey}</output>
    </div>
  )
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (modelId: string | null) => ({
    model: modelId ? { id: modelId, name: 'Selected Model' } : undefined
  })
}))

vi.mock('@renderer/hooks/usePromptProcessor', () => ({
  usePromptProcessor: ({ prompt, modelName }: { prompt: string; modelName?: string }) =>
    modelName ? prompt.replace(/{{model_name}}/g, modelName) : prompt
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
      onClick={() => onChange('Polished system prompt')}>
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

function Harness({
  name = '',
  modelId = null,
  prompt = 'Original system prompt'
}: {
  name?: string
  modelId?: ResourceCreateWizardFormValues['modelId']
  prompt?: string
}) {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: {
      avatar: '💬',
      name,
      description: '',
      modelId,
      prompt,
      knowledgeBaseIds: [],
      skillIds: []
    }
  })

  return (
    <Form {...form}>
      <SystemPromptStep form={form} portalContainer={null} />
    </Form>
  )
}

afterEach(cleanup)

describe('SystemPromptStep', () => {
  it('resolves the selected model name in the prompt preview', () => {
    render(
      <Harness modelId={'provider::model' as ResourceCreateWizardFormValues['modelId']} prompt="Use {{model_name}}" />
    )

    expect(screen.getByLabelText('system-prompt')).toHaveValue('Use {{model_name}}')
    expect(screen.getByLabelText('system-prompt-preview')).toHaveTextContent('Use Selected Model')
  })

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

    expect(screen.getByLabelText('system-prompt')).toHaveValue('Polished system prompt')
    expect(screen.getByTestId('preview-reset-key')).toHaveTextContent('1')
  })
})
