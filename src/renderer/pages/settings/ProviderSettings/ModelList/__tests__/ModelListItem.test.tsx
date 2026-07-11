import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelListItem from '../ModelListItem'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Avatar: ({ children }: any) => <span>{children}</span>,
    AvatarFallback: ({ children }: any) => <span>{children}</span>,
    RowFlex: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    Tooltip: ({ children, content }: any) => <span data-tooltip-content={content}>{children}</span>
  }
})

vi.mock('@renderer/utils/model', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getModelLogo: () => null
}))

vi.mock('../../components/FreeTrialModelTag', () => ({
  FreeTrialModelTag: () => null
}))

vi.mock('../../components/ModelTagsWithLabel', () => ({
  default: () => null
}))

describe('ModelListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
  })

  it('renders the row without an enabled switch', () => {
    render(
      <ModelListItem
        model={
          {
            id: 'openai::alpha',
            providerId: 'openai',
            name: 'Alpha',
            isEnabled: true,
            capabilities: []
          } as any
        }
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByLabelText('common.settings')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.models.manage.remove_model')).toBeInTheDocument()
  })

  it('opens the model drawer only from the settings button', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()

    render(
      <ModelListItem
        model={
          {
            id: 'openai::alpha',
            providerId: 'openai',
            name: 'Alpha',
            isEnabled: true,
            capabilities: []
          } as any
        }
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByText('Alpha'))

    expect(onEdit).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('common.settings'))

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai::alpha' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('deletes the model from the row delete button without opening edit', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onEdit = vi.fn()

    render(
      <ModelListItem
        model={
          {
            id: 'openai::alpha',
            providerId: 'openai',
            name: 'Alpha',
            isEnabled: true,
            capabilities: []
          } as any
        }
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByLabelText('settings.models.manage.remove_model'))

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai::alpha' }))
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('disables the row delete button when deletion is disabled', () => {
    const onDelete = vi.fn()

    render(
      <ModelListItem
        model={
          {
            id: 'openai::alpha',
            providerId: 'openai',
            name: 'Alpha',
            isEnabled: true,
            capabilities: []
          } as any
        }
        disabled
        onEdit={vi.fn()}
        onDelete={onDelete}
      />
    )

    const deleteButton = screen.getByLabelText('settings.models.manage.remove_model')
    expect(deleteButton).toBeDisabled()

    fireEvent.click(deleteButton)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('explains why a default model cannot be removed', () => {
    render(
      <ModelListItem
        model={
          {
            id: 'openai::alpha',
            providerId: 'openai',
            name: 'Alpha',
            isEnabled: true,
            capabilities: []
          } as any
        }
        isDefaultModel
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const deleteButton = screen.getByLabelText('settings.models.manage.remove_model')
    expect(deleteButton).toBeDisabled()
    expect(deleteButton.parentElement).toHaveAttribute(
      'data-tooltip-content',
      'settings.models.manage.default_model_cannot_remove'
    )
  })

  it('shows an error toast when deleting a model fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('delete failed'))

    render(
      <ModelListItem
        model={
          {
            id: 'openai::alpha',
            providerId: 'openai',
            name: 'Alpha',
            isEnabled: true,
            capabilities: []
          } as any
        }
        onEdit={vi.fn()}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByLabelText('settings.models.manage.remove_model'))

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai::alpha' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
    })
  })

  it('shows a localized knowledge base in-use message when deleting a model fails', async () => {
    const error = DataApiErrorFactory.invalidOperation(
      'delete model openai/alpha',
      'model is in use by a knowledge base'
    )
    const onDelete = vi.fn().mockRejectedValue(error)

    render(
      <ModelListItem
        model={
          {
            id: 'openai::alpha',
            providerId: 'openai',
            name: 'Alpha',
            isEnabled: true,
            capabilities: []
          } as any
        }
        onEdit={vi.fn()}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByLabelText('settings.models.manage.remove_model'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('settings.models.manage.model_in_use_by_knowledge_base')
    })
  })
})
