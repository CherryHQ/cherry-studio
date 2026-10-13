import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PlatformModule from '@renderer/utils/platform'

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

// The bar's background depends on whether its frame is transparent, which is macOS-only.
// A live binding, so a case can pick the platform instead of inheriting the host's.
const platform = vi.hoisted(() => ({ isMac: true }))

vi.mock('@renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  get isMac() {
    return platform.isMac
  }
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
      {/* Mirrors ComposerSurfaceRuntime: the marker sits on a non-focusable wrapper and
          the caret target is the contenteditable Tiptap renders inside it. */}
      <div data-ui="part:composer-input">
        <div aria-label="message" contentEditable role="textbox" suppressContentEditableWarning tabIndex={0} />
      </div>
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
    platform.isMac = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
  })

  const lastSetView = () =>
    runtime.ipcRequest.mock.calls.filter(([route]) => route === 'quick_assistant.set_view').at(-1)?.[1]
  const passthroughCalls = () =>
    runtime.ipcRequest.mock.calls
      .filter(([route]) => route === 'quick_assistant.set_pointer_passthrough')
      .map(([, input]) => input)

  it('grows an opaque bar for the quick panel in one step and shrinks it back the same way', async () => {
    // Off macOS the frame is opaque, so the bar must be exactly its content; a tweened
    // grow repaints the bottom-anchored composer a step behind every move.
    platform.isMac = false
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(135)
    const { rerender } = render(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toEqual({ view: 'bar', contentHeight: 135, animate: true }))

    runtime.quickPanelVisible = true
    rerender(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toEqual({ view: 'quick-panel', contentHeight: 560, animate: false }))

    runtime.quickPanelVisible = false
    rerender(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toEqual({ view: 'bar', contentHeight: 135, animate: false }))
    offsetHeight.mockRestore()
  })

  it('keeps the macOS bar at overlay height so opening the quick panel never resizes it', async () => {
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(135)
    const { rerender } = render(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 560 }))

    runtime.quickPanelVisible = true
    rerender(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'quick-panel', contentHeight: 560 }))
    offsetHeight.mockRestore()
  })

  it('makes room for an open popover but not for a tooltip', async () => {
    platform.isMac = false
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(135)
    render(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 135 }))

    // The assistant/model pickers and the response-settings popover all portal here.
    const tooltip = document.createElement('div')
    tooltip.setAttribute('data-radix-popper-content-wrapper', '')
    tooltip.innerHTML = '<span role="tooltip">hint</span>'
    // act() flushes the observer's state update, so a wrong reaction would be visible here.
    await act(async () => {
      document.body.appendChild(tooltip)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(lastSetView()).toMatchObject({ view: 'bar' })

    const popover = document.createElement('div')
    popover.setAttribute('data-radix-popper-content-wrapper', '')
    document.body.appendChild(popover)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'quick-panel', contentHeight: 560 }))

    popover.remove()
    tooltip.remove()
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 135 }))
    offsetHeight.mockRestore()
  })

  it('lets clicks through only over the transparent macOS headroom', () => {
    const { container } = render(<QuickAssistantView draggable={false} />)
    const root = container.querySelector('[data-ui="quick-assistant.view"]') as HTMLElement

    fireEvent.mouseMove(root)
    fireEvent.mouseMove(screen.getByRole('textbox', { name: 'message' }))
    fireEvent.mouseMove(root)

    expect(passthroughCalls()).toEqual([{ passThrough: true }, { passThrough: false }, { passThrough: true }])
  })

  it('never lets clicks through the opaque bar off macOS', () => {
    platform.isMac = false
    const { container } = render(<QuickAssistantView draggable={false} />)

    fireEvent.mouseMove(container.querySelector('[data-ui="quick-assistant.view"]') as HTMLElement)

    expect(passthroughCalls()).toEqual([])
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

  it('gives the bar an opaque surface where the window frame is not transparent', () => {
    // Only the macOS window is created `transparent`. On every other platform the frame
    // is opaque, so a see-through bar has nothing behind it to show and the controls lose
    // their contrast (#20307).
    platform.isMac = false
    const { container } = render(<QuickAssistantView draggable={false} />)

    const root = container.querySelector('[data-ui="quick-assistant.view"]')
    expect(root).toHaveClass('bg-popover', 'text-popover-foreground')
    expect(root).not.toHaveClass('bg-transparent')
  })

  it('keeps the conversation panel on the card surface off macOS', async () => {
    // The panel carries its own opaque card; the non-mac bar fallback must not bleed into
    // it, or the whole panel changes colour on Windows and Linux.
    platform.isMac = false
    quickConversation.send.mockReturnValue(true)
    const { container } = render(<QuickAssistantView draggable={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'mock send' }))

    await waitFor(() => expect(screen.getByTestId('quick-messages')).toBeInTheDocument())
    const root = container.querySelector('[data-ui="quick-assistant.view"]')
    expect(root).toHaveClass('bg-card', 'text-card-foreground')
    expect(root).not.toHaveClass('bg-popover')
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
    // The name the mock actually renders — 'Assistant 1' never appears in this tree, so
    // asserting its absence would hold even if the title bar grew an assistant label.
    expect(titleBar).not.toHaveTextContent('Assistant assistant-1')
    expect(titleBar).not.toHaveTextContent('🙂')
    expect(titleBar?.compareDocumentPosition(contextBar as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(contextBar?.compareDocumentPosition(messages)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(messages.compareDocumentPosition(composer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
