import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { Form } from '@cherrystudio/ui'
import type * as ModelSelectorModule from '@renderer/components/ModelSelector'
import type { Model, UniqueModelId } from '@shared/data/types/model'

import type { ResourceCreateWizardFormValues } from '../../types'
import { QuickCreateStep } from '../QuickCreateStep'

const PICKED_MODEL = {
  id: 'provider::picked',
  providerId: 'provider',
  name: 'Picked model',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} as unknown as Model

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/ModelSelector', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelSelectorModule>()),
  ModelSelector: ({ trigger, onSelect }: { trigger: ReactNode; onSelect: (model: Model) => void }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect(PICKED_MODEL)}>
        pick model
      </button>
    </div>
  )
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({ model: undefined })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => ''
}))

const AUTO = 'library.config.dialogs.create.quick.auto_create'
const MANUAL = 'library.config.dialogs.create.quick.manual_create'
const MODEL_REQUIRED = 'library.config.dialogs.create.quick.model_required'
const NAME_PLACEHOLDER = 'library.config.dialogs.create.quick.name_placeholder'

function Harness({ modelId = null }: { modelId?: UniqueModelId | null }) {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: {
      avatar: '🤖',
      name: '',
      description: '',
      agentType: 'pi-durable',
      permissionMode: 'auto',
      modelId,
      prompt: '',
      knowledgeBaseIds: [],
      skillIds: []
    }
  })

  return (
    <Form {...form}>
      <QuickCreateStep
        form={form}
        portalContainer={null}
        fallbackAvatar="🤖"
        onCancel={vi.fn()}
        onManualCreate={vi.fn()}
        onAutoCreate={vi.fn()}
      />
      <output data-testid="model-id">{form.watch('modelId') ?? 'empty'}</output>
    </Form>
  )
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(cleanup)

describe('QuickCreateStep', () => {
  it('hides the model picker when a default model is already resolved', () => {
    render(<Harness modelId="provider::default" />)

    expect(screen.queryByText('common.model')).not.toBeInTheDocument()
    expect(screen.queryByText(MODEL_REQUIRED)).not.toBeInTheDocument()
  })

  it('keeps both create actions disabled until a name exists', () => {
    render(<Harness modelId="provider::default" />)

    expect(screen.getByRole('button', { name: AUTO })).toBeDisabled()
    expect(screen.getByRole('button', { name: MANUAL })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), { target: { value: 'Slide Expert' } })

    expect(screen.getByRole('button', { name: AUTO })).toBeEnabled()
    expect(screen.getByRole('button', { name: MANUAL })).toBeEnabled()
  })

  it('asks for a model when none is resolved, stores the pick, and keeps the picker visible', () => {
    render(<Harness />)

    fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), { target: { value: 'Slide Expert' } })
    expect(screen.getByText(MODEL_REQUIRED)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: AUTO })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'pick model' }))

    expect(screen.getByTestId('model-id')).toHaveTextContent('provider::picked')
    expect(screen.queryByText(MODEL_REQUIRED)).not.toBeInTheDocument()
    expect(screen.getByText('common.model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: AUTO })).toBeEnabled()
  })
})
