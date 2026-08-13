import type { Prompt, PromptBindingRelation } from '@shared/data/types/prompt'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type PromptTargetOption, PromptTargetPopover } from '../PromptTargetPopover'

const prompt: Prompt = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Targeted prompt',
  content: 'Available when linked',
  visibility: 'restricted',
  orderKey: 'a0',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z'
}
const assistantId = '22222222-2222-4222-8222-222222222222'
const assistant: PromptTargetOption = {
  type: 'assistant',
  id: assistantId,
  name: 'Assistant A',
  avatar: '🌟'
}
const binding: PromptBindingRelation = {
  promptId: prompt.id,
  targetType: 'assistant',
  targetId: assistantId
}

const mocks = vi.hoisted(() => ({
  bindTarget: vi.fn(),
  unbindTarget: vi.fn()
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  usePromptTargetMutations: () => ({ bindTarget: mocks.bindTarget, unbindTarget: mocks.unbindTarget })
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => prefix
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; title?: string }) => {
      if (key === 'settings.prompts.binding.manageTargets') return `Manage ${options?.title}`
      if (options?.count !== undefined) return `${key}:${options.count}`
      return key
    }
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const Passthrough = ({ children }: { children: ReactNode }) => <>{children}</>

  return {
    Badge: Passthrough,
    Button: ({ children, size, variant, ...props }: ComponentProps<'button'> & { size?: string; variant?: string }) => {
      void size
      void variant
      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    Checkbox: ({ checked, ...props }: ComponentProps<'input'> & { checked?: boolean }) => (
      <input type="checkbox" checked={checked} readOnly {...props} />
    ),
    Command: Passthrough,
    CommandEmpty: Passthrough,
    CommandGroup: Passthrough,
    CommandInput: (props: ComponentProps<'input'>) => <input {...props} />,
    CommandItem: ({
      children,
      keywords,
      onSelect,
      value,
      ...props
    }: Omit<ComponentProps<'button'>, 'onSelect' | 'value'> & {
      keywords?: string[]
      onSelect?: () => void
      value?: string
    }) => {
      void keywords
      void value
      return (
        <button type="button" onClick={onSelect} {...props}>
          {children}
        </button>
      )
    },
    CommandList: Passthrough,
    Popover: Passthrough,
    PopoverContent: Passthrough,
    PopoverTrigger: Passthrough,
    Skeleton: (props: ComponentProps<'div'>) => <div {...props} />
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.bindTarget.mockResolvedValue(undefined)
  mocks.unbindTarget.mockResolvedValue(undefined)
})

const renderPopover = (bindings: PromptBindingRelation[]) =>
  render(
    <PromptTargetPopover
      bindings={bindings}
      isLoadingBindings={false}
      isLoadingTargets={false}
      onRetry={vi.fn()}
      prompt={prompt}
      targets={[assistant]}
    />
  )

describe('PromptTargetPopover', () => {
  it('binds the prompt to an unselected target', async () => {
    const user = userEvent.setup()
    renderPopover([])

    await user.click(screen.getByRole('button', { name: /Assistant A/ }))

    expect(mocks.bindTarget).toHaveBeenCalledWith(expect.objectContaining({ type: 'assistant', id: assistantId }))
    expect(mocks.unbindTarget).not.toHaveBeenCalled()
  })

  it('shows the bound target and unbinds only that relation', async () => {
    const user = userEvent.setup()
    renderPopover([binding])

    expect(screen.getByRole('button', { name: 'Manage Targeted prompt' })).toHaveTextContent('Assistant A')
    await user.click(screen.getByRole('button', { name: /Assistant A/ }))

    expect(mocks.unbindTarget).toHaveBeenCalledWith(expect.objectContaining({ type: 'assistant', id: assistantId }))
    expect(mocks.bindTarget).not.toHaveBeenCalled()
  })
})
