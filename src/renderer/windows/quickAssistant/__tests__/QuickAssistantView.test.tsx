import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
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
  ipcHandlers: new Map<string, () => void>(),
  resizeCallbacks: new Set<() => void>(),
  /** The latest `onSend` handed to the composer, to read what it reports back. */
  composerOnSend: null as ((text: string) => unknown) | null,
  composerOnPause: null as (() => void) | null
}))

// A live binding, so a case can pick the platform instead of inheriting the host's.
const platform = vi.hoisted(() => ({ isMac: true, isWin: false }))

vi.mock('@renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  get isMac() {
    return platform.isMac
  },
  get isWin() {
    return platform.isWin
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
    onPause,
    onSend,
    placement
  }: {
    compactWhenSingleLine?: boolean
    externalContextControls?: boolean
    onNewTopic?: () => void
    onPause?: () => void
    onSend: (text: string) => unknown
    placement: string
  }) => {
    runtime.composerOnSend = onSend
    runtime.composerOnPause = onPause ?? null
    return (
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
  }
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
    runtime.resizeCallbacks.clear()
    runtime.quickPanelVisible = false
    runtime.assistants = [{ id: 'first-assistant', name: 'Assistant first-assistant' }]
    platform.isMac = true
    platform.isWin = false
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {
          runtime.resizeCallbacks.add(callback)
        }
        observe() {}
        disconnect() {
          runtime.resizeCallbacks.delete(this.callback)
        }
      }
    )
  })

  const lastSetView = () =>
    runtime.ipcRequest.mock.calls.filter(([route]) => route === 'quick_assistant.set_view').at(-1)?.[1]
  const passthroughCalls = () =>
    runtime.ipcRequest.mock.calls
      .filter(([route]) => route === 'quick_assistant.set_pointer_passthrough')
      .map(([, input]) => input)

  it('resizes the opaque window only when its required height or view changes', async () => {
    platform.isMac = false
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(135)
    const { rerender } = render(<QuickAssistantView draggable={false} />)
    const requestedViews = () =>
      runtime.ipcRequest.mock.calls.filter(([route]) => route === 'quick_assistant.set_view').map(([, input]) => input)
    const notifyResize = () => act(() => runtime.resizeCallbacks.forEach((callback) => callback()))

    // Width-only observations used to echo native resizes and amplify Windows DPI rounding.
    notifyResize()
    notifyResize()
    expect(requestedViews()).toEqual([{ view: 'bar', contentHeight: 135, animate: true }])

    offsetHeight.mockReturnValue(155)
    notifyResize()
    expect(lastSetView()).toEqual({ view: 'bar', contentHeight: 155, animate: true })

    runtime.quickPanelVisible = true
    rerender(<QuickAssistantView draggable={false} />)
    notifyResize()
    runtime.quickPanelVisible = false
    rerender(<QuickAssistantView draggable={false} />)
    notifyResize()
    expect(requestedViews()).toEqual([
      { view: 'bar', contentHeight: 135, animate: true },
      { view: 'bar', contentHeight: 155, animate: true },
      { view: 'quick-panel', contentHeight: 560, animate: false },
      { view: 'bar', contentHeight: 155, animate: false }
    ])
    offsetHeight.mockRestore()
  })

  it('grows an opaque bar for the quick panel in one step and shrinks it back the same way', async () => {
    // Linux keeps an opaque frame; tweening menu expansion would displace the composer.
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

  it.each(['macOS', 'Windows'])('keeps the %s bar at overlay height while menus open and close', async (os) => {
    platform.isMac = os === 'macOS'
    platform.isWin = os === 'Windows'
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(135)
    const { rerender } = render(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 560 }))

    runtime.quickPanelVisible = true
    rerender(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'quick-panel', contentHeight: 560 }))

    runtime.quickPanelVisible = false
    rerender(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 560 }))
    offsetHeight.mockRestore()
  })

  /** A Radix popper as it portals into the body; `state` is what its content reports. */
  const mountPopper = (state: string) => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-radix-popper-content-wrapper', '')
    const content = document.createElement('div')
    content.setAttribute('data-state', state)
    wrapper.appendChild(content)
    document.body.appendChild(wrapper)
    return { wrapper, content }
  }
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  const hideCalls = () => runtime.ipcRequest.mock.calls.filter(([route]) => route === 'quick_assistant.hide').length

  it('makes room for an open popover, and frees it once the popover closes even if kept mounted', async () => {
    platform.isMac = false
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(135)
    render(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 135 }))

    // Tooltips share the popper wrapper but report a different state and need no room.
    const tooltip = mountPopper('delayed-open')
    await settle()
    expect(lastSetView()).toMatchObject({ view: 'bar' })

    const picker = mountPopper('open')
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'quick-panel', contentHeight: 560 }))

    // The assistant/model pickers stay mounted while closed; the bar must not stay grown.
    picker.content.setAttribute('data-state', 'closed')
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 135 }))

    picker.wrapper.remove()
    tooltip.wrapper.remove()
    offsetHeight.mockRestore()
  })

  it('keeps room and Escape for an open dialog, which portals without a popper wrapper', async () => {
    // The MCP prompt argument form is a centered dialog: a bar-height window would clip it,
    // and Escape must close the form rather than hide the window behind it.
    platform.isMac = false
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(135)
    render(<QuickAssistantView draggable={false} />)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 135 }))

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('data-state', 'open')
    document.body.appendChild(dialog)
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'quick-panel', contentHeight: 560 }))

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'message' }), { key: 'Escape' })
    expect(hideCalls()).toBe(0)

    dialog.setAttribute('data-state', 'closed')
    await waitFor(() => expect(lastSetView()).toMatchObject({ view: 'bar', contentHeight: 135 }))
    dialog.remove()
    offsetHeight.mockRestore()
  })

  it('leaves Escape to an open popover and handles it again once nothing is open', async () => {
    render(<QuickAssistantView draggable={false} />)
    const picker = mountPopper('open')
    // Radix dismisses from a document capture listener, so by our bubble phase the picker
    // already reads closed — and a kept-mounted closed picker still prevents every Escape.
    const radixDismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      picker.content.setAttribute('data-state', 'closed')
    }
    document.addEventListener('keydown', radixDismiss, true)
    const input = screen.getByRole('textbox', { name: 'message' })

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(hideCalls()).toBe(0)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(hideCalls()).toBe(1)

    document.removeEventListener('keydown', radixDismiss, true)
    picker.wrapper.remove()
    await settle()
  })

  it.each(['macOS', 'Windows'])('lets clicks through only over the transparent %s headroom', (os) => {
    platform.isMac = os === 'macOS'
    platform.isWin = os === 'Windows'
    const { container } = render(<QuickAssistantView draggable={false} />)
    const root = container.querySelector('[data-ui="quick-assistant.view"]') as HTMLElement

    fireEvent.mouseMove(root)
    fireEvent.mouseMove(screen.getByRole('textbox', { name: 'message' }))
    fireEvent.mouseMove(root)

    expect(passthroughCalls()).toEqual([{ passThrough: true }, { passThrough: false }, { passThrough: true }])
  })

  it('never lets clicks through the opaque Linux bar', () => {
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

  const openPanel = async () => {
    quickConversation.send.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'mock send' }))
    await screen.findByTestId('quick-messages')
  }

  it('ends the conversation once it is saved, since it now belongs to the main window', async () => {
    // Continuing a saved topic here would run it through the temporary surface, which has
    // neither its branch anchor nor a tool-approval UI.
    quickConversation.save.mockResolvedValue(true)
    render(<QuickAssistantView draggable={false} />)
    await openPanel()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('quickAssistant.control_bar.save_topic') }))

    await waitFor(() => expect(screen.queryByTestId('quick-messages')).not.toBeInTheDocument())
    expect(quickConversation.reset).toHaveBeenCalled()
  })

  it('leaves a conversation started during a save alone when that save lands late', async () => {
    // save() resolves false when the lease turned over mid-request: the conversation on
    // screen is not the one that was written, so it must not be cleared.
    quickConversation.save.mockResolvedValue(false)
    render(<QuickAssistantView draggable={false} />)
    await openPanel()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('quickAssistant.control_bar.save_topic') }))

    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(screen.getByTestId('quick-messages')).toBeInTheDocument()
    expect(quickConversation.reset).not.toHaveBeenCalled()
  })

  it("stops the conversation from the composer's Pause, in the bar and in the panel", async () => {
    // This window has no ChatWriteContext, so the composer's own Pause had nothing to stop.
    render(<QuickAssistantView draggable={false} />)
    act(() => runtime.composerOnPause?.())
    expect(quickConversation.stop).toHaveBeenCalledTimes(1)

    quickConversation.send.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'mock send' }))
    await screen.findByTestId('quick-messages')
    act(() => runtime.composerOnPause?.())
    expect(quickConversation.stop).toHaveBeenCalledTimes(2)
  })

  it('tells the composer when a send was not taken, so it keeps the draft or queued follow-up', () => {
    // The composer drops a steered follow-up unless onSend reports exactly `false`.
    render(<QuickAssistantView draggable={false} />)

    quickConversation.send.mockReturnValue(false)
    let reported: unknown
    act(() => {
      reported = runtime.composerOnSend?.('busy')
    })
    expect(reported).toBe(false)

    quickConversation.send.mockReturnValue(true)
    act(() => {
      reported = runtime.composerOnSend?.('idle')
    })
    expect(reported).toBe(true)
  })

  it('keeps the Linux bar opaque where the native window is not transparent', () => {
    platform.isMac = false
    const { container } = render(<QuickAssistantView draggable={false} />)

    const root = container.querySelector('[data-ui="quick-assistant.view"]')
    expect(root).toHaveClass('bg-popover', 'text-popover-foreground')
    expect(root).not.toHaveClass('bg-transparent')
  })

  it('keeps the Windows bar and tool-panel headroom transparent', () => {
    platform.isMac = false
    platform.isWin = true
    const { container, rerender } = render(<QuickAssistantView draggable={false} />)

    const root = container.querySelector('[data-ui="quick-assistant.view"]')
    expect(root).toHaveClass('bg-transparent')
    expect(root).not.toHaveClass('bg-popover')

    runtime.quickPanelVisible = true
    rerender(<QuickAssistantView draggable={false} />)
    expect(root).toHaveClass('bg-transparent')
    expect(root).not.toHaveClass('bg-popover')
  })

  it('keeps the Windows conversation panel opaque after sending', async () => {
    platform.isMac = false
    platform.isWin = true
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
