import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { SelectedModelsTrigger } from '../SelectedModelsTrigger'

vi.mock('@cherrystudio/ui', () => {
  let currentPopoverOpen = false

  return {
    Button: ({ children, ...props }: { children?: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Popover: ({ children, open }: { children?: ReactNode; open?: boolean }) => {
      currentPopoverOpen = Boolean(open)
      return <div>{children}</div>
    },
    PopoverAnchor: ({ children }: { children?: ReactNode }) => <>{children}</>,
    PopoverContent: ({
      children,
      align,
      side,
      sideOffset,
      onOpenAutoFocus,
      onCloseAutoFocus,
      onPointerEnter,
      onPointerLeave,
      ...props
    }: {
      children?: ReactNode
      align?: string
      side?: string
      sideOffset?: number
      onOpenAutoFocus?: () => void
      onCloseAutoFocus?: () => void
      onPointerEnter?: () => void
      onPointerLeave?: () => void
    }) => {
      void align
      void side
      void sideOffset
      void onOpenAutoFocus
      void onCloseAutoFocus

      return currentPopoverOpen ? (
        <div {...props} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
          {children}
        </div>
      ) : null
    },
    Scrollbar: ({ children, ...props }: { children?: ReactNode }) => (
      <div data-scrolling="false" {...props}>
        {children}
      </div>
    )
  }
})

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ model, size }: { model?: Model; size: number }) => (
    <span data-size={size} data-testid={`model-avatar-${model?.id ?? 'empty'}`} />
  )
}))

vi.mock('@renderer/components/Tags/Model', () => ({
  getModelDisplayTags: (model: Model) =>
    model.capabilities.filter((capability) =>
      [MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.FUNCTION_CALL].includes(capability as any)
    ),
  ModelTag: ({ tag, size, className }: { tag: string; size: number; className?: string }) => (
    <span className={className} data-size={size} data-testid={`model-tag-${tag}`}>
      {tag}
    </span>
  )
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  getProviderDisplayName: (provider: { name: string } | undefined) => provider?.name ?? ''
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18nextModule>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'models.selection.context_window') return `Context ${options?.count}`
        if (key === 'models.selection.remove_model') return `Remove ${options?.name}`
        if (key === 'models.selection.restore_default') return 'Restore'
        if (key === 'models.selection.selected_models') return 'Selected models'
        return key
      }
    })
  }
})

const modelA = {
  id: 'provider-a::model-a',
  providerId: 'provider-a',
  apiModelId: 'model-a',
  name: 'Model A',
  capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION],
  contextWindow: 128000,
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} satisfies Model

const modelB = {
  id: 'provider-b::model-b',
  providerId: 'provider-b',
  apiModelId: 'model-b',
  name: 'Model B',
  capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
  contextWindow: 64000,
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} satisfies Model

const providers = [
  { id: 'provider-a', name: 'Provider A' },
  { id: 'provider-b', name: 'Provider B' }
] as any

function openSelectedModelsPopover() {
  fireEvent.pointerEnter(screen.getByRole('button', { name: 'Selected models' }))
}

describe('SelectedModelsTrigger', () => {
  it('renders every selected model avatar inline in the trigger', () => {
    render(
      <SelectedModelsTrigger
        models={[modelA, modelB]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        onModelsChange={vi.fn()}
        onRestore={vi.fn()}
      />
    )

    const iconRail = screen.getByTestId('selected-models-trigger-icons')
    expect(within(iconRail).getByTestId('model-avatar-provider-a::model-a')).toBeInTheDocument()
    expect(within(iconRail).getByTestId('model-avatar-provider-b::model-b')).toBeInTheDocument()
    expect(iconRail.className).not.toContain('overflow-x-auto')
  })

  it('shows model names, providers, capability tags, and context windows in the popover content', () => {
    render(
      <SelectedModelsTrigger
        models={[modelA, modelB]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        onModelsChange={vi.fn()}
        onRestore={vi.fn()}
      />
    )

    openSelectedModelsPopover()

    expect(screen.getByTestId('selected-models-popover')).toHaveTextContent('Model A')
    expect(screen.getByTestId('selected-models-list')).toHaveAttribute('data-scrolling', 'false')
    expect(screen.getByTestId('selected-models-popover')).toHaveTextContent('Provider A')
    const firstRow = screen.getByTestId('selected-model-row-provider-a::model-a')
    const tag = screen.getByTestId(`model-tag-${MODEL_CAPABILITY.IMAGE_RECOGNITION}`)
    expect(firstRow.className).toContain('h-10.5')
    expect(within(firstRow).getByTestId('model-avatar-provider-a::model-a')).toHaveAttribute('data-size', '16')
    expect(tag).toHaveAttribute('data-size', '8')
    expect(tag).toHaveClass('h-3.5', 'min-w-3.5', 'px-1', 'py-px')
    expect(tag).toHaveTextContent(MODEL_CAPABILITY.IMAGE_RECOGNITION)
    expect(within(firstRow).getByTestId('model-avatar-provider-a::model-a').parentElement?.className).toContain('h-8')
    expect(within(firstRow).getByTestId('model-avatar-provider-a::model-a').parentElement?.className).toContain(
      'items-center'
    )
    const contextWindow = within(firstRow).getByText('Context 128000')
    expect(contextWindow.parentElement?.className).toContain('justify-items-end')
    expect(within(firstRow).getByLabelText('Remove Model A').parentElement?.className).toContain('w-0')
    expect(within(firstRow).getByLabelText('Remove Model A').parentElement?.className).toContain('group-hover:w-4')
  })

  it('returns the filtered model list when removing one selected model', () => {
    const onModelsChange = vi.fn()
    render(
      <SelectedModelsTrigger
        models={[modelA, modelB]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        onModelsChange={onModelsChange}
        onRestore={vi.fn()}
      />
    )

    openSelectedModelsPopover()

    fireEvent.click(screen.getByLabelText('Remove Model B'))

    expect(onModelsChange).toHaveBeenCalledWith([modelA])
  })

  it('does not expose remove actions for a single selected model', () => {
    const onModelsChange = vi.fn()
    const onRestore = vi.fn()
    render(
      <SelectedModelsTrigger
        models={[modelA]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        onModelsChange={onModelsChange}
        onRestore={onRestore}
      />
    )

    expect(screen.queryByLabelText('Remove Model A')).not.toBeInTheDocument()
    expect(onModelsChange).not.toHaveBeenCalled()
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('does not render popover content for a single selected model', () => {
    render(
      <SelectedModelsTrigger
        models={[modelA]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        onModelsChange={vi.fn()}
        onRestore={vi.fn()}
      />
    )

    expect(screen.queryByTestId('selected-models-popover')).not.toBeInTheDocument()
  })

  it('does not render a placeholder avatar for the fallback model label', () => {
    render(
      <SelectedModelsTrigger
        models={[]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        iconOnly
        onModelsChange={vi.fn()}
        onRestore={vi.fn()}
      />
    )

    const fallbackLabel = screen.getByText('Select model')
    expect(screen.queryByTestId('model-avatar-empty')).not.toBeInTheDocument()
    expect(fallbackLabel).not.toHaveClass('sr-only')
    expect(screen.getByRole('button', { name: 'Selected models' })).not.toHaveClass('w-8')
  })

  it('does not render popover content for an empty model selection', () => {
    render(
      <SelectedModelsTrigger
        models={[]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        onModelsChange={vi.fn()}
        onRestore={vi.fn()}
      />
    )

    openSelectedModelsPopover()

    expect(screen.queryByTestId('selected-models-popover')).not.toBeInTheDocument()
  })

  it('calls the restore callback from the multi-model popover content', () => {
    const onRestore = vi.fn()
    render(
      <SelectedModelsTrigger
        models={[modelA, modelB]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        onModelsChange={vi.fn()}
        onRestore={onRestore}
      />
    )

    openSelectedModelsPopover()

    fireEvent.click(screen.getByText('Restore'))

    expect(onRestore).toHaveBeenCalled()
  })

  it('does not render the selected-model popover while it is suppressed', () => {
    render(
      <SelectedModelsTrigger
        models={[modelA, modelB]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        suppressSelectionPopover
        onModelsChange={vi.fn()}
        onRestore={vi.fn()}
      />
    )

    expect(screen.queryByTestId('selected-models-popover')).not.toBeInTheDocument()
  })

  it('closes and keeps the selected-model popover blocked when suppression starts', () => {
    const { rerender } = render(
      <SelectedModelsTrigger
        models={[modelA, modelB]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        onModelsChange={vi.fn()}
        onRestore={vi.fn()}
      />
    )

    openSelectedModelsPopover()

    expect(screen.getByTestId('selected-models-popover')).toBeInTheDocument()

    rerender(
      <SelectedModelsTrigger
        models={[modelA, modelB]}
        assistantModel={modelA}
        providers={providers}
        fallbackLabel="Select model"
        suppressSelectionPopover
        onModelsChange={vi.fn()}
        onRestore={vi.fn()}
      />
    )

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Selected models' }))

    expect(screen.queryByTestId('selected-models-popover')).not.toBeInTheDocument()
  })

  it('closes the selected-model popover after the hover trigger is left', () => {
    vi.useFakeTimers()

    try {
      render(
        <SelectedModelsTrigger
          models={[modelA, modelB]}
          assistantModel={modelA}
          providers={providers}
          fallbackLabel="Select model"
          onModelsChange={vi.fn()}
          onRestore={vi.fn()}
        />
      )

      const trigger = screen.getByRole('button', { name: 'Selected models' })

      fireEvent.pointerEnter(trigger)

      expect(screen.getByTestId('selected-models-popover')).toBeInTheDocument()

      fireEvent.pointerLeave(trigger)

      act(() => {
        vi.runOnlyPendingTimers()
      })

      expect(screen.queryByTestId('selected-models-popover')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
