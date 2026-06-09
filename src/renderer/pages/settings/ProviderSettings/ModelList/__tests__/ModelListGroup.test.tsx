import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ModelListGroup from '../ModelListGroup'

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
      <span className={classNames?.placeholder} data-testid="tooltip-trigger">
        {children}
      </span>
    )
  }
})

vi.mock('../ModelListItem', () => ({
  default: ({ model }: any) => <div data-testid={`model-${model.id}`}>{model.name}</div>
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
        onToggleModel={vi.fn()}
        onToggleModels={onToggleModels}
      />
    )

    expect(screen.getByTestId('model-openai::alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.group_disable' }))

    expect(onToggleModels).toHaveBeenCalledWith(models, false)
    expect(screen.getByTestId('model-openai::alpha')).toBeInTheDocument()
  })

  it('keeps the group action tooltip trigger aligned with 20px controls', () => {
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
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    expect(screen.getByTestId('tooltip-trigger')).toHaveClass('inline-flex', 'size-5', 'leading-none')
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
        onToggleModel={vi.fn()}
        onToggleModels={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'chat' }))

    expect(screen.queryByTestId('model-openai::alpha')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.group_enable' })).toBeInTheDocument()
  })
})
