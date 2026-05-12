import type * as CherryStudioUi from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { type AssistantFormState } from '../descriptor'
import { BasicSection } from '../sections/BasicSection'

const models = [
  { id: 'anthropic::claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'moonshot::moonshot-v1', name: 'Moonshot v1' },
  { id: 'moonshot::kimi-k2', name: 'kimi-k2' }
]

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  const React = await import('react')
  const PopoverContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null)

  const Popover = ({
    open,
    onOpenChange,
    children
  }: {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: React.ReactNode
  }) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(Boolean(open))
    const resolvedOpen = open ?? uncontrolledOpen

    const setOpen = (nextOpen: boolean) => {
      if (open === undefined) {
        setUncontrolledOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    }

    return <PopoverContext value={{ open: resolvedOpen, setOpen }}>{children}</PopoverContext>
  }

  const PopoverTrigger = ({
    children
  }: {
    asChild?: boolean
    children: React.ReactElement<{ onClick?: (event: React.MouseEvent) => void }>
  }) => {
    const context = React.use(PopoverContext)
    if (!context) return children

    return React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event)
        context.setOpen(!context.open)
      }
    })
  }

  const PopoverContent = ({ children }: { children: React.ReactNode }) => {
    const context = React.use(PopoverContext)
    if (!context?.open) return null
    return <div>{children}</div>
  }

  return {
    ...actual,
    Popover,
    PopoverTrigger,
    PopoverContent
  }
})

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: () => ({ models, isLoading: false })
}))

vi.mock('@renderer/components/Selector', () => ({
  ModelSelector: ({ trigger, onSelect }: { trigger: ReactNode; onSelect: (modelId: string | undefined) => void }) => (
    <div>
      <div data-testid="model-selector-trigger">{trigger}</div>
      <button type="button" onClick={() => onSelect('anthropic::claude-sonnet-4-5')}>
        select claude
      </button>
      <button type="button" onClick={() => onSelect('moonshot::moonshot-v1')}>
        select moonshot
      </button>
      <button type="button" onClick={() => onSelect('moonshot::kimi-k2')}>
        select kimi
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <div data-testid="model-avatar" />
}))

vi.mock('@renderer/components/Popups/SelectModelPopup', () => ({
  SelectChatModelPopup: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/components/EmojiPicker', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('🧠')}>
      pick emoji
    </button>
  )
}))

function createForm(overrides: Partial<AssistantFormState> = {}): AssistantFormState {
  return {
    name: '助手',
    emoji: '💬',
    description: '',
    modelId: null,
    temperature: 1,
    enableTemperature: false,
    topP: 1,
    enableTopP: false,
    maxTokens: 4096,
    enableMaxTokens: false,
    contextCount: 5,
    streamOutput: true,
    toolUseMode: 'function',
    maxToolCalls: 20,
    enableMaxToolCalls: true,
    customParameters: [],
    tags: [],
    prompt: '',
    knowledgeBaseIds: [],
    mcpServerIds: [],
    mcpMode: 'auto',
    ...overrides
  }
}

describe('BasicSection avatar picker', () => {
  it('opens emoji picker from the selected avatar and applies the chosen emoji', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<BasicSection form={createForm()} onChange={onChange} tagColorByName={new Map()} allTagNames={[]} />)

    await user.click(screen.getByRole('button', { name: /选择头像|library\.config\.basic\.pick_avatar/ }))
    await user.click(await screen.findByRole('button', { name: 'pick emoji' }))

    expect(onChange).toHaveBeenCalledWith({ emoji: '🧠' })
  })
})

describe('BasicSection model selector', () => {
  it('writes the selected UniqueModelId directly into assistant form state', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <BasicSection
        form={createForm()}
        onChange={onChange}
        mode="optional"
        tagColorByName={new Map()}
        allTagNames={[]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'select claude' }))

    expect(onChange).toHaveBeenCalledWith({ modelId: 'anthropic::claude-sonnet-4-5' })
  })

  it('keeps the model-switch temperature heuristics when selecting known models', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <BasicSection
        form={createForm()}
        onChange={onChange}
        mode="optional"
        tagColorByName={new Map()}
        allTagNames={[]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'select moonshot' }))
    await user.click(screen.getByRole('button', { name: 'select kimi' }))

    expect(onChange).toHaveBeenCalledWith({ modelId: 'moonshot::moonshot-v1', temperature: 0.3 })
    expect(onChange).toHaveBeenCalledWith({ modelId: 'moonshot::kimi-k2', temperature: 0.6 })
  })

  it('clears an existing assistant model to null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <BasicSection
        form={createForm({ modelId: 'anthropic::claude-sonnet-4-5' })}
        onChange={onChange}
        mode="optional"
        tagColorByName={new Map()}
        allTagNames={[]}
      />
    )

    expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /清空|library\.config\.basic\.model_clear/ }))

    expect(onChange).toHaveBeenCalledWith({ modelId: null })
  })
})

describe('BasicSection model settings', () => {
  it('renders icon tooltip entry points for assistant identity fields', () => {
    render(<BasicSection form={createForm()} onChange={vi.fn()} tagColorByName={new Map()} allTagNames={[]} />)

    expect(
      screen.getByLabelText(
        /展示在资源库和助手选择器中|Shown in the library and assistant selectors|library\.config\.basic\.field\.name\.hint/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(
        /给助手起个名字|Give the assistant a name|library\.config\.basic\.field\.name\.placeholder/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(
        /这个助手的用途|What this assistant is for|library\.config\.basic\.field\.description\.placeholder/
      )
    ).toBeInTheDocument()
  })

  it('does not expose zero as a context count slider value', () => {
    render(
      <BasicSection
        form={createForm()}
        onChange={vi.fn()}
        mode="optional"
        tagColorByName={new Map()}
        allTagNames={[]}
      />
    )

    const contextSlider = screen.getAllByRole('slider').find((slider) => slider.getAttribute('aria-valuemax') === '20')

    expect(contextSlider).toHaveAttribute('aria-valuemin', '1')
  })
})
