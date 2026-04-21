import type * as CherryStudioUi from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { type BasicFormState, BasicSection } from '../AssistantConfig/sections/BasicSection'

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

function createForm(overrides: Partial<BasicFormState> = {}): BasicFormState {
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

    await user.click(screen.getByRole('button', { name: '选择头像' }))
    await user.click(await screen.findByRole('button', { name: 'pick emoji' }))

    expect(onChange).toHaveBeenCalledWith({ emoji: '🧠' })
  })
})
