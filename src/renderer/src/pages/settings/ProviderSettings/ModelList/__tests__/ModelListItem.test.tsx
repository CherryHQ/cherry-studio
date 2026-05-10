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
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
        {String(checked)}
      </button>
    ),
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

vi.mock('@renderer/pages/settings/ProviderSettings/config/models', async (importOriginal) => ({
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
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('shows an error toast when toggling a model fails', async () => {
    const onToggleEnabled = vi.fn().mockRejectedValue(new Error('toggle failed'))

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
        onToggleEnabled={onToggleEnabled}
      />
    )

    fireEvent.click(screen.getByRole('switch'))

    expect(onToggleEnabled).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai::alpha' }), false)
    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
    })
  })

  it('opens the model drawer from the model name and only copies from the copy button', async () => {
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
        onToggleEnabled={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('Alpha'))

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai::alpha' }))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()

    onEdit.mockClear()
    fireEvent.click(screen.getByLabelText('settings.models.copy_model_id_tooltip'))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('alpha')
    expect(onEdit).not.toHaveBeenCalled()
  })
})
