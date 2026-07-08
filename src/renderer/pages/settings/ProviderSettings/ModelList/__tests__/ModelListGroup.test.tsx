import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelListGroup from '../ModelListGroup'

const { loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock
    })
  }
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Button: ({ children, ...props }: any) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tooltip: ({ children, classNames }: any) => (
      <span className={classNames?.placeholder} data-testid={classNames?.placeholder ? 'tooltip-trigger' : undefined}>
        {children}
      </span>
    )
  }
})

const models = [
  {
    id: 'openai::alpha',
    name: 'Alpha',
    capabilities: [],
    isEnabled: true,
    providerId: 'openai'
  },
  {
    id: 'openai::beta',
    name: 'Beta',
    capabilities: [],
    isEnabled: true,
    providerId: 'openai'
  }
] as any

describe('ModelListGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the group without an enabled switch', () => {
    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        onDeleteModels={vi.fn()}
      />
    )

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chat' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('deletes all models in the group from the header action', () => {
    const onDeleteModels = vi.fn().mockResolvedValue(undefined)

    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        onDeleteModels={onDeleteModels}
      />
    )

    const deleteButtons = screen.getAllByRole('button', { name: 'settings.models.manage.remove_whole_group' })

    expect(deleteButtons[0]).toHaveClass('opacity-0', 'group-hover/modelGroup:opacity-100')
    fireEvent.click(deleteButtons[0])

    expect(onDeleteModels).toHaveBeenCalledWith(models)
  })

  it('logs and shows a toast when deleting a group fails', async () => {
    const error = new Error('delete group failed')
    const onDeleteModels = vi.fn().mockRejectedValue(error)

    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        onDeleteModels={onDeleteModels}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.models.manage.remove_whole_group' })[0])

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to delete provider model group', {
        groupName: 'chat',
        error
      })
    })
    expect(toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
  })

  it('shows a localized knowledge base in-use message when deleting a group fails', async () => {
    const error = DataApiErrorFactory.invalidOperation(
      'delete model batch(2 items)',
      'model is in use by a knowledge base'
    )
    const onDeleteModels = vi.fn().mockRejectedValue(error)

    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        onDeleteModels={onDeleteModels}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.models.manage.remove_whole_group' })[0])

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('settings.models.manage.model_in_use_by_knowledge_base')
    })
  })

  it('toggles the group body from the title row while keeping the action separate', () => {
    const onToggleOpen = vi.fn()
    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        onDeleteModels={vi.fn()}
        onToggleOpen={onToggleOpen}
      />
    )

    const header = screen.getByRole('button', { name: 'chat' })
    fireEvent.click(header)

    expect(onToggleOpen).toHaveBeenCalled()
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('reflects controlled open state', () => {
    const { rerender } = render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        open
        disabled={false}
        pendingModelIds={new Set()}
        onDeleteModels={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'chat' })).toHaveAttribute('aria-expanded', 'true')

    rerender(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        open={false}
        disabled={false}
        pendingModelIds={new Set()}
        onDeleteModels={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'chat' })).toHaveAttribute('aria-expanded', 'false')

    rerender(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        open
        disabled={false}
        pendingModelIds={new Set()}
        onDeleteModels={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'chat' })).toHaveAttribute('aria-expanded', 'true')
  })
})
