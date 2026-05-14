import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const MODEL = vi.hoisted(
  () =>
    ({
      id: 'provider::dialog-model',
      providerId: 'provider',
      name: 'Dialog Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }) as const
)

vi.mock('../model', () => ({
  ModelSelector: ({
    trigger,
    onSelect
  }: {
    trigger: ReactNode
    onSelect: (model: typeof MODEL | undefined) => void
  }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect(MODEL)}>
        Pick model
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/EmojiPicker', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🎓')}>
      Choose emoji
    </button>
  )
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
        ({
          'common.avatar': 'Avatar',
          'common.cancel': 'Cancel',
          'common.description': 'Description',
          'common.model': 'Model',
          'common.name': 'Name',
          'selector.create_dialog.agent_title': 'New Agent',
          'selector.create_dialog.assistant_title': 'New Assistant',
          'selector.create_dialog.avatar_aria': 'Pick avatar',
          'selector.create_dialog.create': 'Create',
          'selector.create_dialog.dialog_description': 'Create a lightweight resource from the selector.',
          'selector.create_dialog.description_placeholder': 'Describe this resource',
          'selector.create_dialog.model_placeholder': 'Select a model',
          'selector.create_dialog.model_required': 'Please select a model',
          'selector.create_dialog.name_placeholder': 'Name this resource',
          'selector.create_dialog.name_required': 'Please enter a name',
          'selector.create_dialog.submit_failed': 'Create failed'
        })[key] ?? key
    })
  }
})

import { ResourceCreateDialog } from '../resource/ResourceCreateDialog'

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ResourceCreateDialog', () => {
  it('validates required name and model fields', async () => {
    const onSubmit = vi.fn()
    render(<ResourceCreateDialog kind="assistant" open onOpenChange={vi.fn()} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Please enter a name')).toBeInTheDocument()
    expect(screen.getByText('Please select a model')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits avatar, name, model, and description', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ResourceCreateDialog kind="assistant" open onOpenChange={vi.fn()} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick avatar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose emoji' }))
    fireEvent.change(screen.getByPlaceholderText('Name this resource'), { target: { value: 'Study Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.change(screen.getByPlaceholderText('Describe this resource'), {
      target: { value: 'Helps with notes' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        avatar: '🎓',
        name: 'Study Assistant',
        modelId: MODEL.id,
        description: 'Helps with notes'
      })
    )
  })

  it('disables actions while submitting and shows submit errors', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network down'))
    const { rerender } = render(
      <ResourceCreateDialog kind="agent" open isSubmitting onOpenChange={vi.fn()} onSubmit={onSubmit} />
    )

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    rerender(<ResourceCreateDialog kind="agent" open onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText('Name this resource'), { target: { value: 'Build Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Network down')).toBeInTheDocument()
  })
})
