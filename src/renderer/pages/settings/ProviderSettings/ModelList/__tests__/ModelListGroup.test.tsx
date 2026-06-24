import { DataApiErrorFactory } from '@shared/data/api'
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
    Switch: ({ checked, onCheckedChange, onClick, size, ...props }: any) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-size={size}
        onClick={(event) => {
          onClick?.(event)
          onCheckedChange?.(!checked)
        }}
        {...props}
      />
    ),
    Tooltip: ({ children, classNames }: any) => (
      <span className={classNames?.placeholder} data-testid={classNames?.placeholder ? 'tooltip-trigger' : undefined}>
        {children}
      </span>
    )
  }
})

vi.mock('../ModelListItem', () => ({
  default: ({ model, onDelete }: any) => (
    <div data-testid={`model-${model.id}`}>
      {model.name}
      <button type="button" onClick={() => onDelete(model)}>
        delete-{model.id}
      </button>
    </div>
  )
}))

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
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('runs the group bulk action without toggling the group open state', () => {
    const onToggleModels = vi.fn().mockResolvedValue(undefined)

    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        bulkToggleEnabled={false}
        bulkToggleLabel="settings.models.group_disable"
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={vi.fn()}
        onToggleModel={vi.fn()}
        onToggleModels={onToggleModels}
      />
    )

    expect(screen.getByTestId('model-openai::alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'settings.models.group_disable' }))

    expect(onToggleModels).toHaveBeenCalledWith(models, false)
    expect(screen.getByTestId('model-openai::alpha')).toBeInTheDocument()
  })

  it('logs and shows a toast when group bulk action fails', async () => {
    const error = new Error('toggle failed')
    const onToggleModels = vi.fn().mockRejectedValue(error)

    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        bulkToggleEnabled={false}
        bulkToggleLabel="settings.models.group_disable"
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={vi.fn()}
        onToggleModel={vi.fn()}
        onToggleModels={onToggleModels}
      />
    )

    fireEvent.click(screen.getByRole('switch', { name: 'settings.models.group_disable' }))

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to toggle provider model group', {
        groupName: 'chat',
        enabled: false,
        error
      })
    })
    expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
  })

  it('renders the group bulk action as a switch', () => {
    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        bulkToggleEnabled={false}
        bulkToggleLabel="settings.models.group_disable"
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={vi.fn()}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    expect(screen.getByRole('switch', { name: 'settings.models.group_disable' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('switch', { name: 'settings.models.group_disable' })).toHaveAttribute('data-size', 'xs')
    expect(screen.getByRole('switch', { name: 'settings.models.group_disable' }).parentElement).toHaveClass(
      'inline-flex',
      'h-6',
      'items-center'
    )
  })

  it('passes delete actions to model rows', () => {
    const onDeleteModel = vi.fn().mockResolvedValue(undefined)

    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        bulkToggleEnabled={false}
        bulkToggleLabel="settings.models.group_disable"
        onEditModel={vi.fn()}
        onDeleteModel={onDeleteModel}
        onDeleteModels={vi.fn()}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'delete-openai::alpha' }))

    expect(onDeleteModel).toHaveBeenCalledWith(models[0])
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
        bulkToggleEnabled={false}
        bulkToggleLabel="settings.models.group_disable"
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={onDeleteModels}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    const deleteButtons = screen.getAllByRole('button', { name: 'settings.models.manage.remove_whole_group' })

    expect(deleteButtons[0]).toHaveClass('opacity-0', 'group-hover/groupRow:opacity-100')
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
        bulkToggleEnabled={false}
        bulkToggleLabel="settings.models.group_disable"
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={onDeleteModels}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.models.manage.remove_whole_group' })[0])

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to delete provider model group', {
        groupName: 'chat',
        error
      })
    })
    expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
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
        bulkToggleEnabled={false}
        bulkToggleLabel="settings.models.group_disable"
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={onDeleteModels}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.models.manage.remove_whole_group' })[0])

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.model_in_use_by_knowledge_base')
    })
  })

  it('toggles the group body from the title row while keeping the action separate', () => {
    render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        bulkToggleEnabled
        bulkToggleLabel="settings.models.group_enable"
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={vi.fn()}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'chat' }))

    expect(screen.queryByTestId('model-openai::alpha')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'settings.models.group_enable' })).toBeInTheDocument()
  })

  it('applies list-level expansion commands', () => {
    const { rerender } = render(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        bulkToggleEnabled
        bulkToggleLabel="settings.models.group_enable"
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={vi.fn()}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    expect(screen.getByTestId('model-openai::alpha')).toBeInTheDocument()

    rerender(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        bulkToggleEnabled
        bulkToggleLabel="settings.models.group_enable"
        expansionCommand={{ expanded: false, version: 1 }}
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={vi.fn()}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    expect(screen.queryByTestId('model-openai::alpha')).not.toBeInTheDocument()

    rerender(
      <ModelListGroup
        groupName="chat"
        items={models.map((model: any) => ({ model }))}
        defaultOpen
        disabled={false}
        pendingModelIds={new Set()}
        bulkToggleEnabled
        bulkToggleLabel="settings.models.group_enable"
        expansionCommand={{ expanded: true, version: 2 }}
        onEditModel={vi.fn()}
        onDeleteModel={vi.fn()}
        onDeleteModels={vi.fn()}
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    expect(screen.getByTestId('model-openai::alpha')).toBeInTheDocument()
  })
})
