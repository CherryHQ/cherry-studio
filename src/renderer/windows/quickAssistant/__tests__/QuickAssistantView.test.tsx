import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import QuickAssistantView from '../QuickAssistantView'

const quickConversation = vi.hoisted(() => ({
  send: vi.fn(() => false),
  stop: vi.fn(),
  reset: vi.fn(),
  save: vi.fn()
}))

const runtime = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  quickPanelVisible: false,
  assistants: [] as { id: string; name: string }[],
  ipcHandlers: new Map<string, () => void>()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size,
    variant,
    type = 'button',
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => (
    <button {...props} data-size={size} data-variant={variant} type={type}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/components/EmojiIcon', () => ({
  default: ({ emoji }: { emoji: string }) => <span>{emoji}</span>
}))

vi.mock('@renderer/components/chat/editing/MessageEditingContext', () => ({
  MessageEditingProvider: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => ({ isVisible: runtime.quickPanelVisible })
}))

vi.mock('@renderer/components/composer/variants/ChatComposer', () => ({
  ChatPlacementComposer: ({
    compactWhenSingleLine,
    externalContextControls,
    onNewTopic,
    onSend,
    placement
  }: {
    compactWhenSingleLine?: boolean
    externalContextControls?: boolean
    onNewTopic?: () => void
    onSend: (text: string) => void
    placement: string
  }) => (
    <div
      data-compact={String(Boolean(compactWhenSingleLine))}
      data-external-context={String(Boolean(externalContextControls))}
      data-new-topic={String(Boolean(onNewTopic))}
      data-placement={placement}
      data-testid="quick-composer">
      {/* ComposerSurface puts this marker on the textarea itself, not a wrapper. */}
      <textarea aria-label="message" data-ui="part:composer-input" />
      <button type="button" onClick={() => onSend('hello')}>
        mock send
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/composer/variants/chat/ChatConversationControls', () => ({
  ChatConversationControls: ({ assistantName, model }: { assistantName: string; model?: { name: string } }) => (
    <div data-testid="conversation-controls">
      {assistantName} / {model?.name}
    </div>
  )
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: () => ({ assistants: runtime.assistants }),
  // Echoes the id so a test can tell which assistant the view resolved to.
  useAssistant: (assistantId?: string | null) =>
    assistantId
      ? {
          assistant: { id: assistantId, name: `Assistant ${assistantId}`, emoji: '🙂' },
          model: { id: 'provider::model-1', name: 'Model 1' },
          isLoading: false,
          isModelPending: false,
          isModelMissing: false
        }
      : {
          assistant: undefined,
          model: undefined,
          isLoading: false,
          isModelPending: false,
          isModelMissing: true
        }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: runtime.ipcRequest },
  useIpcOn: (event: string, handler: () => void) => {
    runtime.ipcHandlers.set(event, handler)
  }
}))

vi.mock('../useQuickConversation', () => ({
  useQuickConversation: () => ({
    topic: { id: 'topic-1', name: '' },
    topicId: 'topic-1',
    isLoading: false,
    isSaved: false,
    error: null,
    messages: [],
    partsByMessageId: new Map(),
    ...quickConversation
  })
}))

vi.mock('../panel/QuickMessages', () => ({
  default: () => <div data-testid="quick-messages" />
}))

describe('QuickAssistantView', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', 'assistant-1')
    quickConversation.send.mockReset().mockReturnValue(false)
    quickConversation.stop.mockReset()
    quickConversation.reset.mockReset()
    quickConversation.save.mockReset()
    runtime.ipcRequest.mockReset()
    runtime.quickPanelVisible = false
    runtime.assistants = [{ id: 'first-assistant', name: 'Assistant first-assistant' }]
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
  })

  it('temporarily expands the transparent window while the quick panel is visible', async () => {
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(135)
    const { container, rerender } = render(<QuickAssistantView draggable={false} />)

    await waitFor(() =>
      expect(runtime.ipcRequest).toHaveBeenLastCalledWith('quick_assistant.set_view', {
        view: 'bar',
        contentHeight: 135,
        animate: true
      })
    )

    runtime.quickPanelVisible = true
    rerender(<QuickAssistantView draggable={false} />)

    await waitFor(() =>
      expect(runtime.ipcRequest).toHaveBeenLastCalledWith('quick_assistant.set_view', {
        view: 'quick-panel',
        contentHeight: 560,
        animate: true
      })
    )
    expect(container.querySelector('[data-ui="quick-assistant.view"]')).toHaveClass('justify-end')

    runtime.quickPanelVisible = false
    rerender(<QuickAssistantView draggable={false} />)

    await waitFor(() =>
      expect(runtime.ipcRequest).toHaveBeenLastCalledWith('quick_assistant.set_view', {
        view: 'bar',
        contentHeight: 135,
        animate: true
      })
    )
    offsetHeight.mockRestore()
  })

  it('summons as one row and expands the composer only after its editor is focused', async () => {
    const { container } = render(<QuickAssistantView draggable={false} />)

    const composer = screen.getByTestId('quick-composer')
    const input = screen.getByRole('textbox', { name: 'message' })
    expect(composer).toHaveAttribute('data-compact', 'true')
    // Always external in the bar: the built-in context row brings a backdrop plate that
    // reads as a second window edge in a transparent frameless window.
    expect(composer).toHaveAttribute('data-external-context', 'true')
    expect(composer).toHaveAttribute('data-new-topic', 'false')
    expect(container.querySelector('[data-ui="quick-assistant.contextbar"]')).not.toBeInTheDocument()

    fireEvent.focus(input)
    await waitFor(() => expect(composer).toHaveAttribute('data-compact', 'false'))
    expect(composer).toHaveAttribute('data-external-context', 'true')
    expect(container.querySelector('[data-ui="quick-assistant.contextbar"]')).toBeInTheDocument()
    expect(screen.getByTestId('conversation-controls')).toHaveTextContent('Assistant assistant-1 / Model 1')

    const documentHidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(composer).toHaveAttribute('data-compact', 'true'))
    // Always external in the bar: the built-in context row brings a backdrop plate that
    // reads as a second window edge in a transparent frameless window.
    expect(composer).toHaveAttribute('data-external-context', 'true')
    expect(container.querySelector('[data-ui="quick-assistant.contextbar"]')).not.toBeInTheDocument()
    expect(input).not.toHaveFocus()
    documentHidden.mockRestore()
  })

  it('focuses the composer when the window is summoned again', async () => {
    render(<QuickAssistantView draggable={false} />)
    const input = screen.getByRole('textbox', { name: 'message' })
    expect(input).not.toHaveFocus()

    // A hidden window keeps its DOM, so nothing else re-focuses the input on re-show —
    // without this the hotkey opens a bar the user has to click before typing.
    runtime.ipcHandlers.get('quick_assistant.shown')?.()

    await waitFor(() => expect(input).toHaveFocus())
  })

  it('falls back to the first assistant when the preference has never been set', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.quick_assistant.assistant_id', '')
    render(<QuickAssistantView draggable={false} />)

    await user.click(screen.getByRole('textbox', { name: 'message' }))

    // Without a fallback the bar would open with no assistant and no model, so the send
    // button would be dead on a fresh install.
    expect(screen.getByTestId('conversation-controls')).toHaveTextContent('Assistant first-assistant / Model 1')
  })

  it('expands into the panel only once the turn actually starts', async () => {
    const user = userEvent.setup()
    quickConversation.send.mockReturnValue(false)
    const { container } = render(<QuickAssistantView draggable={false} />)

    await user.click(screen.getByRole('button', { name: 'mock send' }))

    // A send rejected because the temporary topic lease has not landed must leave the bar
    // as it was, rather than opening an empty conversation panel.
    expect(container.querySelector('[data-testid="quick-messages"]')).not.toBeInTheDocument()

    quickConversation.send.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'mock send' }))

    await waitFor(() => expect(screen.getByTestId('quick-messages')).toBeInTheDocument())
  })

  it('uses the sub-window hierarchy after a conversation starts', async () => {
    quickConversation.send.mockReturnValue(true)
    const { container } = render(<QuickAssistantView draggable={false} />)

    expect(container.querySelector('[data-ui="quick-assistant.view"]')).toHaveClass('bg-transparent')

    fireEvent.click(screen.getByRole('button', { name: 'mock send' }))

    await waitFor(() => expect(screen.getByTestId('quick-composer')).toHaveAttribute('data-placement', 'docked'))
    expect(container.querySelector('[data-ui="quick-assistant.view"]')).toHaveClass('bg-card', 'text-card-foreground')
    expect(container.querySelector('[data-ui="quick-assistant.view"]')).not.toHaveClass('bg-transparent')
    expect(screen.getByTestId('quick-composer')).toHaveAttribute('data-external-context', 'true')
    expect(screen.getByTestId('quick-composer')).toHaveAttribute('data-new-topic', 'false')
    expect(screen.getByTestId('conversation-controls')).toHaveTextContent('Assistant assistant-1 / Model 1')
    const messages = await screen.findByTestId('quick-messages')

    const titleBar = container.querySelector('[data-ui="quick-assistant.titlebar"]')
    const contextBar = container.querySelector('[data-ui="quick-assistant.contextbar"]')
    const composer = screen.getByTestId('quick-composer')
    expect(titleBar).not.toHaveTextContent('Assistant 1')
    expect(titleBar).not.toHaveTextContent('🙂')
    expect(titleBar?.compareDocumentPosition(contextBar as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(contextBar?.compareDocumentPosition(messages)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(messages.compareDocumentPosition(composer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
