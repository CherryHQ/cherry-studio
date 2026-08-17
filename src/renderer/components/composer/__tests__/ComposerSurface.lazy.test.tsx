import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComposerSurface, {
  type ComposerDeferredIntent,
  type ComposerSurfaceActions,
  type ComposerSurfaceProps
} from '../ComposerSurface'
import type { ComposerDraftToken } from '../tokens'

const mocks = vi.hoisted(() => ({
  onSendDraft: vi.fn(),
  runtimeLoads: 0,
  runtimeIntent: undefined as ComposerDeferredIntent | undefined,
  toastError: vi.fn()
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

vi.mock('@renderer/components/SendMessageButton', () => ({
  default: ({
    disabled,
    onDisabledClick,
    sendMessage
  }: {
    disabled?: boolean
    onDisabledClick?: () => void
    sendMessage: () => void
  }) => (
    <button type="button" onClick={disabled ? onDisabledClick : sendMessage}>
      Send
    </button>
  )
}))

vi.mock('../ComposerSurfaceRuntime', () => {
  mocks.runtimeLoads += 1
  return {
    default: ({ initialTextSelection, text, deferredIntent }: ComposerSurfaceProps) => {
      mocks.runtimeIntent = deferredIntent
      return (
        <div
          data-testid="composer-runtime"
          data-selection={`${initialTextSelection?.start}:${initialTextSelection?.end}`}>
          {text}
        </div>
      )
    }
  }
})

/** jsdom ships none of the transfer APIs the fallback uses to snapshot a payload. */
class FakeDataTransfer {
  private data = new Map<string, string>()
  readonly items = { add: (file: File) => this.fileList.push(file) }
  private fileList: File[] = []
  get types() {
    return [...this.data.keys(), ...(this.fileList.length ? ['Files'] : [])]
  }
  get files() {
    return this.fileList
  }
  getData(type: string) {
    return this.data.get(type) ?? ''
  }
  setData(type: string, value: string) {
    this.data.set(type, value)
  }
}

function Harness(overrides: Partial<ComposerSurfaceProps> = {}) {
  const [text, setText] = useState('')
  const props: ComposerSurfaceProps = {
    text,
    onTextChange: setText,
    tokens: [],
    managedTokenKinds: [],
    onTokensChange: vi.fn(),
    placeholder: 'Message',
    sendMessageShortcut: ['Enter'],
    sendDisabled: false,
    isLoading: false,
    onSendDraft: mocks.onSendDraft,
    onPause: vi.fn(),
    supportedExts: [],
    setFiles: vi.fn(),
    filesCount: 0,
    isExpanded: false,
    onExpandedChange: vi.fn(),
    quickPanelEnabled: true,
    enableDragDrop: true,
    enableSpellCheck: true,
    fontSize: 14,
    narrowMode: true,
    renderLeftControls: () => <span>Composer tools</span>,
    ...overrides
  }

  return <ComposerSurface {...props} />
}

describe('deferred ComposerSurface', () => {
  beforeEach(() => {
    vi.stubGlobal('DataTransfer', FakeDataTransfer)
    mocks.runtimeIntent = undefined
    mocks.onSendDraft.mockClear()
    mocks.toastError.mockClear()
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('matches the regular composer shell before loading the rich runtime', () => {
    const { container } = render(<Harness editable={undefined} />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    const inputbar = container.querySelector<HTMLElement>('[data-composer-inputbar]')
    const narrowLayout = container.querySelector<HTMLElement>('.narrow-mode')

    expect(input).toBeEnabled()
    expect(input).toHaveClass('w-full')
    expect(input).toHaveAttribute('rows', '1')
    expect(input).toHaveStyle({ height: '46px', minHeight: '46px', lineHeight: '1.4' })
    expect(narrowLayout).toHaveClass('max-w-[calc(800px+3rem)]', 'px-6')
    expect(narrowLayout).toContainElement(inputbar)
    expect(inputbar).toContainElement(screen.getByText('Composer tools'))
    expect(inputbar?.querySelector('[data-composer-toolbar]')).toContainElement(
      screen.getByRole('button', { name: 'Send' })
    )
    expect(mocks.runtimeLoads).toBe(0)
  })

  it('keeps a whitespace-only draft on the fallback without loading the runtime', () => {
    render(<Harness text="   " />)

    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('   ')
    expect(mocks.runtimeLoads).toBe(0)
  })

  it('swaps in the rich runtime while idle, before the user can type into the fallback', async () => {
    const idleCallbacks: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => idleCallbacks.push(callback))
    vi.stubGlobal('cancelIdleCallback', () => {})

    render(<Harness text="" />)
    expect(mocks.runtimeLoads).toBe(0)

    act(() => idleCallbacks.forEach((callback) => callback()))

    expect(await screen.findByTestId('composer-runtime')).toBeInTheDocument()
  })

  it('loads the rich runtime on focus so the fallback swap cannot swallow the first keystroke', async () => {
    render(<Harness text="" />)

    fireEvent.focus(screen.getByRole('textbox', { name: 'Message' }))
    const runtime = await screen.findByTestId('composer-runtime')
    expect(runtime).toHaveTextContent('')
    expect(runtime).toHaveAttribute('data-selection', '0:0')
  })

  it('keeps a usable textarea and IME state until the rich runtime can replace it', async () => {
    render(<Harness />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    expect(input).toHaveValue('')

    // Focus starts the runtime load; a composition begun before the swap commits keeps the
    // textarea mounted, so the committed characters survive into the runtime.
    fireEvent.focus(input)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'draft text', selectionStart: 10, selectionEnd: 10 } })
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('draft text')

    fireEvent.compositionEnd(input, { currentTarget: { selectionStart: 10, selectionEnd: 10 } })
    const runtime = await screen.findByTestId('composer-runtime')
    expect(runtime).toHaveTextContent('draft text')
    expect(runtime).toHaveAttribute('data-selection', '10:10')
  })

  it('hands the whole clipboard payload to the runtime instead of inserting plain text', async () => {
    render(<Harness />)

    const clipboardData = new FakeDataTransfer()
    clipboardData.setData('text/plain', 'x'.repeat(20000))
    clipboardData.setData('text/html', '<span data-composer-token="skill:review"></span>')
    clipboardData.items.add(new File(['png'], 'shot.png', { type: 'image/png' }))

    fireEvent.paste(screen.getByRole('textbox', { name: 'Message' }), { clipboardData })

    await screen.findByTestId('composer-runtime')
    const transfer = mocks.runtimeIntent?.transfer
    expect(transfer?.kind).toBe('paste')
    expect(transfer?.data.getData('text/plain')).toHaveLength(20000)
    expect(transfer?.data.getData('text/html')).toContain('data-composer-token')
    expect([...transfer!.data.files].map((file) => file.name)).toEqual(['shot.png'])
  })

  it('hands a first file drop to the runtime instead of losing it', async () => {
    const { container } = render(<Harness />)

    const dataTransfer = new FakeDataTransfer()
    dataTransfer.items.add(new File(['pdf'], 'paper.pdf', { type: 'application/pdf' }))
    fireEvent.drop(container.querySelector('.inputbar')!, { dataTransfer })

    await screen.findByTestId('composer-runtime')
    expect(mocks.runtimeIntent?.transfer?.kind).toBe('drop')
    expect([...mocks.runtimeIntent!.transfer!.data.files].map((file) => file.name)).toEqual(['paper.pdf'])
  })

  it('keeps panel-backed toolbar controls usable and opens the requested panel once ready', async () => {
    render(
      <Harness
        renderLeftControls={(_inputAdapter, unifiedPanelControl) =>
          unifiedPanelControl?.available ? (
            <button type="button" onClick={() => unifiedPanelControl.open({ launcherId: 'skills' })}>
              Skills
            </button>
          ) : null
        }
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))

    await screen.findByTestId('composer-runtime')
    expect(mocks.runtimeIntent?.openPanel).toEqual({ launcherId: 'skills' })
  })

  it('loads the runtime for states the fallback cannot represent', async () => {
    const { unmount } = render(<Harness editingState={{ messageId: 'm1' } as ComposerSurfaceProps['editingState']} />)
    expect(await screen.findByTestId('composer-runtime')).toBeInTheDocument()
    unmount()

    render(
      <Harness
        draftTokens={[{ id: 't1', kind: 'quote', index: 0, textOffset: 0 } as never]}
        text="tail after the token"
      />
    )
    expect(await screen.findByTestId('composer-runtime')).toBeInTheDocument()
  })

  it('loads the runtime for a restored multi-line draft the fixed-height fallback cannot hold', async () => {
    render(<Harness text={'line one\nline two\nline three'} />)

    const runtime = await screen.findByTestId('composer-runtime')
    expect(runtime).toHaveTextContent('line one line two line three')
  })

  it('loads the runtime for any non-empty draft, even one line a narrow input may soft-wrap', async () => {
    render(<Harness text="one long single line" />)

    expect(await screen.findByTestId('composer-runtime')).toHaveTextContent('one long single line')
  })

  it('marks the deferred intent as focused when the fallback textarea gained focus', async () => {
    render(<Harness />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'hello' } })

    await screen.findByTestId('composer-runtime')
    expect(mocks.runtimeIntent?.hadFocus).toBe(true)
  })

  it('loads the runtime for the compact structural variant', async () => {
    render(<Harness compactWhenSingleLine />)

    expect(await screen.findByTestId('composer-runtime')).toBeInTheDocument()
  })

  it('loads the runtime for the expanded structural variant', async () => {
    render(<Harness isExpanded />)

    expect(await screen.findByTestId('composer-runtime')).toBeInTheDocument()
  })

  it('follows the send-shortcut preference when the caller does not pass one', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.input.send_message_shortcut', 'Ctrl+Enter')
    render(<Harness sendMessageShortcut={undefined} />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.onSendDraft).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(mocks.onSendDraft).toHaveBeenCalledTimes(1)
  })

  it('routes the steer shortcut to onSendDraft with { steer: true } in the deferred textarea', () => {
    render(<Harness steerShortcut={['CommandOrControl', 'Enter']} />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(mocks.onSendDraft).toHaveBeenCalledTimes(1)
    expect(mocks.onSendDraft).toHaveBeenCalledWith(expect.anything(), { steer: true })
  })

  it('ignores the steer shortcut in the deferred textarea when the caller does not pass one', () => {
    render(<Harness />)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter', ctrlKey: true })
    expect(mocks.onSendDraft).not.toHaveBeenCalled()
  })

  it('navigates input history on the first arrow key', () => {
    const onInputHistoryNavigate = vi.fn(() => true)
    render(<Harness text="" onInputHistoryNavigate={onInputHistoryNavigate} />)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'ArrowUp' })
    expect(onInputHistoryNavigate).toHaveBeenCalledWith('up')
  })

  it('matches the runtime ArrowUp history boundary for a non-empty draft', async () => {
    const text = 'draft'
    const onInputHistoryNavigate = vi.fn(() => true)
    render(<Harness text={text} onInputHistoryNavigate={onInputHistoryNavigate} />)

    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
    input.setSelectionRange(0, 0)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onInputHistoryNavigate).not.toHaveBeenCalled()

    input.setSelectionRange(1, text.length)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onInputHistoryNavigate).not.toHaveBeenCalled()

    input.setSelectionRange(text.length, text.length)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onInputHistoryNavigate).toHaveBeenCalledWith('up')
    await screen.findByTestId('composer-runtime')
  })

  it('hands the end selection to the runtime for history recalled before it loads', async () => {
    const historyText = 'previous chat prompt'
    let actions: ComposerSurfaceActions | undefined

    function InputHistoryHarness() {
      const [text, setText] = useState('')
      return (
        <Harness
          text={text}
          onTextChange={setText}
          onActionsChange={(nextActions) => {
            actions = nextActions
          }}
          onInputHistoryNavigate={() => {
            actions?.replaceDraft({ text: historyText, tokens: [] })
            return true
          }}
        />
      )
    }

    render(<InputHistoryHarness />)
    await waitFor(() => expect(actions).toBeDefined())

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'ArrowUp' })

    const runtime = await screen.findByTestId('composer-runtime')
    expect(runtime).toHaveAttribute('data-selection', `${historyText.length}:${historyText.length}`)
  })

  it('replays a programmatic first token insertion through the runtime', async () => {
    let actions: ComposerSurfaceActions | undefined
    const quote = { id: 'q1', kind: 'quote', promptText: 'Quoted line' } as ComposerDraftToken
    const onTokensChange = vi.fn()
    render(
      <Harness
        text="draft"
        onActionsChange={(next) => {
          actions = next
        }}
        onTokensChange={onTokensChange}
      />
    )

    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' }).setSelectionRange(2, 2)
    act(() => actions!.insertToken(quote))

    await screen.findByTestId('composer-runtime')
    // Writing the token straight into draftTokens leaves it without prompt text at that offset,
    // which the reconcilers and the document builder both discard.
    expect(onTokensChange).not.toHaveBeenCalled()
    expect(mocks.runtimeIntent?.insertToken).toEqual({ token: quote, selection: { start: 2, end: 2 } })
  })

  it('carries the whole selection so a replayed token still replaces the selected text', async () => {
    let actions: ComposerSurfaceActions | undefined
    const quote = { id: 'q2', kind: 'quote', promptText: 'Quoted line' } as ComposerDraftToken
    render(
      <Harness
        text="draft"
        onActionsChange={(next) => {
          actions = next
        }}
      />
    )

    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' }).setSelectionRange(1, 4)
    act(() => actions!.insertToken(quote))

    await screen.findByTestId('composer-runtime')
    expect(mocks.runtimeIntent?.insertToken?.selection).toEqual({ start: 1, end: 4 })
  })

  it('carries an IME value only committed on compositionend into the runtime', async () => {
    render(<Harness />)

    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Process' })
    // Some IMEs never fire `change`: the committed characters land on the DOM value at
    // compositionend, right before the runtime replaces the textarea.
    input.value = 'draft你好'
    fireEvent.compositionEnd(input)

    const runtime = await screen.findByTestId('composer-runtime')
    expect(runtime).toHaveTextContent('draft你好')
  })

  it('does not swap the toolbar out from under a click when the runtime chunk is already warm', async () => {
    const warm = render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'warm' } })
    await screen.findByTestId('composer-runtime')
    warm.unmount()

    render(<Harness />)
    const send = screen.getByRole('button', { name: 'Send' })
    fireEvent.pointerDown(send)
    fireEvent.click(send)

    expect(mocks.onSendDraft).toHaveBeenCalledTimes(1)
  })

  it('names the fallback pause action for screen readers', () => {
    const { container } = render(<Harness isLoading sendDisabled />)
    const pause = container.querySelector('[data-ui="chat.composer.action.pause"]')
    expect(pause?.getAttribute('aria-label')).toBeTruthy()
  })

  it('shows blocked-send feedback when the disabled send button is clicked before the runtime loads', () => {
    render(<Harness sendDisabled sendBlockedReason="test.send_blocked" />)

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mocks.toastError).toHaveBeenCalledWith('test.send_blocked')
  })

  it('shows blocked-send feedback when the send shortcut is pressed while disabled', () => {
    render(<Harness sendDisabled sendBlockedReason="test.send_blocked" />)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' })
    expect(mocks.toastError).toHaveBeenCalledWith('test.send_blocked')
  })
})
