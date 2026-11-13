import { MockCherrystudioUI } from '@test-mocks/renderer/CherrystudioUI'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'

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
    ScrollArea: MockCherrystudioUI.ScrollArea
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

vi.mock('@renderer/components/tags/Model', () => ({
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
