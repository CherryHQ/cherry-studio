import { COMPOSER_FILE_KIND } from '@renderer/types'
import {
  COMPOSER_CLIPBOARD_FRAGMENT_MIME,
  createComposerClipboardFragment,
  readComposerClipboardFragment,
  writeComposerRichClipboardContent
} from '@renderer/utils/messageUtils/composerClipboard'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComposerSurface, { type ComposerSurfaceActions, type ComposerSurfaceProps } from '../ComposerSurface'

const mocks = vi.hoisted(() => ({
  editorOptions: undefined as any,
  actions: undefined as ComposerSurfaceActions | undefined,
  editorViewComposing: false,
  insertContent: vi.fn(),
  insertComposerToken: vi.fn(),
  deleteRange: vi.fn(),
  deleteSelection: vi.fn(),
  setContent: vi.fn(),
  setNodeSelection: vi.fn(),
  chainRun: vi.fn(),
  docDescendants: vi.fn(),
  docTextBetween: vi.fn(),
  focus: vi.fn(),
  fsReadText: vi.fn(),
  getJSON: vi.fn(),
  dispatch: vi.fn(),
  pasteHandler: vi.fn(),
  setTimeoutTimer: vi.fn(),
  timeoutCleanups: [] as Array<() => void>,
  preferences: {
    'chat.input.send_message_shortcut': 'Enter'
  } as Record<string, unknown>,
  editorPresetOptions: undefined as any,
  quickPanelClose: vi.fn(),
  quickPanelDispatchKeyDown: vi.fn(),
  quickPanelIsVisible: false,
  quickPanelOpen: vi.fn(),
  quickPanelSymbol: '',
  quickPanelUpdateList: vi.fn(),
  selection: { from: 1 } as any,
  transaction: undefined as any
}))

function clearMockTimers() {
  mocks.timeoutCleanups.splice(0).forEach((cleanup) => cleanup())
}

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => {
    void _size
    void _variant

    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <span data-testid="popover-content">{children}</span>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/chat/layout/ChatLayoutModeContext', () => ({
  useChatLayoutMode: () => ({ forceWideLayout: false })
}))

vi.mock('@renderer/components/chat/layout/NarrowLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="narrow-layout">{children}</div>
}))

vi.mock('@renderer/components/chat/composer/panelEngine', () => ({
  QuickPanelView: () => null,
  useQuickPanel: () => ({
    close: mocks.quickPanelClose,
    dispatchKeyDown: mocks.quickPanelDispatchKeyDown,
    isVisible: mocks.quickPanelIsVisible,
    open: mocks.quickPanelOpen,
    symbol: mocks.quickPanelSymbol,
    updateList: mocks.quickPanelUpdateList
  })
}))

vi.mock('@renderer/components/RichEditor/useRichTextEditorKernel', () => ({
  useRichTextEditorKernel: (options: any) => {
    mocks.editorOptions = options
    return {
      isDestroyed: false,
      isEditable: true,
      getJSON: mocks.getJSON,
      commands: {
        focus: mocks.focus,
        setContent: mocks.setContent,
        setNodeSelection: mocks.setNodeSelection
      },
      chain: () => ({
        focus: () => ({
          deleteRange: (...args: unknown[]) => {
            mocks.deleteRange(...args)
            return {
              insertContent: (...contentArgs: unknown[]) => {
                mocks.insertContent(...contentArgs)
                return { run: mocks.chainRun }
              },
              run: mocks.chainRun
            }
          },
          setNodeSelection: (...args: unknown[]) => {
            mocks.setNodeSelection(...args)
            return { run: mocks.chainRun }
          },
          deleteSelection: () => {
            mocks.deleteSelection()
            return { run: mocks.chainRun }
          },
          insertContent: (...args: unknown[]) => {
            mocks.insertContent(...args)
            return { run: mocks.chainRun }
          },
          insertComposerToken: (...args: unknown[]) => {
            mocks.insertComposerToken(...args)
            return {
              insertContent: (...contentArgs: unknown[]) => {
                mocks.insertContent(...contentArgs)
                return { run: mocks.chainRun }
              },
              run: mocks.chainRun
            }
          }
        })
      }),
      view: {
        get composing() {
          return mocks.editorViewComposing
        },
        dispatch: mocks.dispatch
      },
      state: {
        get selection() {
          return mocks.selection
        },
        get tr() {
          return mocks.transaction
        },
        doc: {
          descendants: mocks.docDescendants,
          textBetween: mocks.docTextBetween
        }
      }
    }
  }
}))

vi.mock('@tiptap/react', () => ({
  EditorContent: ({ style, onFocus }: { style?: React.CSSProperties; onFocus?: () => void }) => (
    <div data-testid="editor-content" style={style} onFocus={onFocus}>
      <div
        data-testid="composer-editor"
        className={mocks.editorOptions?.editorProps?.attributes?.class}
        data-editor-style={mocks.editorOptions?.editorProps?.attributes?.style}
      />
    </div>
  )
}))

vi.mock('@renderer/pages/home/Inputbar/SendMessageButton', () => ({
  default: () => <button type="button">send</button>
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferences[key]]
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer
  })
}))

vi.mock('@renderer/components/chat/composer/paste/useFileDragDrop', () => ({
  useFileDragDrop: () => ({
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    isDragging: false
  })
}))

vi.mock('@renderer/components/chat/composer/paste/usePasteHandler', () => ({
  usePasteHandler: () => ({
    handlePaste: mocks.pasteHandler
  })
}))

vi.mock('@renderer/components/chat/composer/paste/pasteHandling', () => ({
  default: {
    init: vi.fn(),
    registerHandler: vi.fn(),
    unregisterHandler: vi.fn(),
    setLastFocusedComponent: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../composerPreset', () => ({
  createComposerEditorPreset: (options: any) => {
    mocks.editorPresetOptions = options
    return []
  }
}))

const baseProps: ComposerSurfaceProps = {
  text: '',
  onTextChange: vi.fn(),
  tokens: [],
  managedTokenKinds: [],
  onTokensChange: vi.fn(),
  placeholder: 'Message',
  sendDisabled: false,
  isLoading: false,
  onSendDraft: vi.fn(),
  onPause: vi.fn(),
  supportedExts: [],
  setFiles: vi.fn(),
  filesCount: 0,
  isExpanded: false,
  onExpandedChange: vi.fn(),
  quickPanelEnabled: false,
  enableDragDrop: false,
  enableSpellCheck: false,
  fontSize: 14,
  narrowMode: false
}

const Harness = () => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <ComposerSurface
      {...baseProps}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
      onActionsChange={(actions) => {
        mocks.actions = actions
      }}
    />
  )
}

function createClipboardDataMock() {
  const data = new Map<string, string>()

  return {
    clearData: vi.fn(() => data.clear()),
    getData: vi.fn((type: string) => data.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value)
    })
  }
}

function createComposerCopyView(content: unknown[], options: { empty?: boolean } = {}) {
  return {
    state: {
      selection: {
        empty: options.empty ?? false,
        content: () => ({
          content: {
            toJSON: () => content
          }
        })
      }
    }
  }
}

async function primeComposerClipboardSessionCache(plainText: string, fragment: string) {
  Object.defineProperty(window, 'ClipboardItem', {
    configurable: true,
    value: class {
      constructor(_items: Record<string, Blob>) {
        void _items
      }
    }
  })
  const clipboard = {
    write: vi.fn(async () => {}),
    read: vi.fn(async () => [])
  }
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: clipboard
  })
  await writeComposerRichClipboardContent({
    plainText,
    html: '<div>rich copy</div>',
    customFormats: { [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: fragment }
  })
  return clipboard
}

describe('ComposerSurface', () => {
  beforeEach(() => {
    clearMockTimers()
    mocks.editorOptions = undefined
    mocks.actions = undefined
    mocks.editorViewComposing = false
    mocks.insertContent.mockReset()
    mocks.insertComposerToken.mockReset()
    mocks.deleteRange.mockReset()
    mocks.deleteSelection.mockReset()
    mocks.setContent.mockReset()
    mocks.setNodeSelection.mockReset()
    mocks.chainRun.mockReset()
    mocks.docDescendants.mockReset()
    mocks.docTextBetween.mockReset()
    mocks.docTextBetween.mockReturnValue('')
    mocks.focus.mockReset()
    mocks.fsReadText.mockReset()
    mocks.fsReadText.mockResolvedValue('')
    mocks.getJSON.mockReset()
    mocks.getJSON.mockReturnValue({ type: 'doc', content: [{ type: 'paragraph' }] })
    mocks.dispatch.mockReset()
    mocks.pasteHandler.mockReset()
    mocks.setTimeoutTimer.mockReset()
    mocks.setTimeoutTimer.mockImplementation((_key: string, callback: () => void, delay?: number) => {
      const timer = setTimeout(callback, delay)
      const cleanup = () => clearTimeout(timer)
      mocks.timeoutCleanups.push(cleanup)
      return cleanup
    })
    mocks.preferences = {
      'chat.input.send_message_shortcut': 'Enter'
    }
    mocks.editorPresetOptions = undefined
    mocks.quickPanelClose.mockReset()
    mocks.quickPanelDispatchKeyDown.mockReset()
    mocks.quickPanelIsVisible = false
    mocks.quickPanelOpen.mockReset()
    mocks.quickPanelSymbol = ''
    mocks.quickPanelUpdateList.mockReset()
    mocks.selection = { from: 1, to: 1, $to: {} }
    mocks.transaction = {
      doc: {},
      delete: vi.fn(() => mocks.transaction),
      setNodeMarkup: vi.fn(() => mocks.transaction),
      setSelection: vi.fn(() => mocks.transaction)
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: {
          readText: mocks.fsReadText
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn()
      }
    })
  })

  afterEach(() => {
    clearMockTimers()
  })

  it('uses state-specific viewport-relative max heights and only fixes height when expanded', async () => {
    render(<Harness />)

    const editorContent = screen.getByTestId('editor-content')
    const editor = screen.getByTestId('composer-editor')
    const editorContainer = editorContent.parentElement
    const expandedHeight = `${Math.max(220, Math.round(window.innerHeight * 0.5))}px`

    expect(editorContainer).toHaveStyle({ minHeight: '46px' })
    expect(editorContainer).not.toHaveStyle({ height: 'max(220px, 50vh)' })
    expect(editorContainer).toHaveClass('transition-[height]', 'ease-out')
    expect(editorContent).not.toHaveStyle({ height: '100%' })
    expect(editor.getAttribute('data-editor-style')).toContain('max-height: max(220px, 40vh)')
    expect(editor.className).toContain('max-h-[max(220px,40vh)]')
    expect(editor.className).not.toContain('max-h-[max(220px,50vh)]')
    expect(editor.className).not.toContain('max-h-[500px]')

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.expand' }))

    await waitFor(() => expect(editorContainer).toHaveStyle({ height: expandedHeight, overflow: 'hidden' }))
    fireEvent.transitionEnd(editorContainer as HTMLElement, { propertyName: 'height' })

    expect(editorContainer).toHaveStyle({ height: 'max(220px, 50vh)', overflow: 'hidden' })
    expect(editorContent).toHaveStyle({ height: '100%' })
    expect(screen.getByTestId('composer-editor').className).toContain('max-h-[max(220px,50vh)]')
    expect(screen.getByTestId('composer-editor').className).toContain('h-full')
    expect(screen.getByTestId('composer-editor').getAttribute('data-editor-style')).toContain(
      'max-height: max(220px, 50vh)'
    )
    expect(screen.getByTestId('composer-editor').getAttribute('data-editor-style')).toContain('height: 100%')
    expect(screen.getByTestId('composer-editor').getAttribute('data-editor-style')).toContain('overflow-y: auto')
  })

  it('renders the expand control in the inputbar corner', () => {
    render(<Harness />)

    const expandButton = screen.getByRole('button', { name: 'chat.input.expand' })
    const inputbar = document.getElementById('inputbar')
    const corner = inputbar?.querySelector('[data-composer-expand-corner]') as HTMLElement | null
    const cornerLine = inputbar?.querySelector('[data-composer-expand-corner-line]') as HTMLElement | null

    expect(screen.queryByRole('button', { name: 'translate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send' })).toBeInTheDocument()
    expect(inputbar).not.toBeNull()
    expect(corner).not.toBeNull()
    expect(expandButton.closest('#inputbar')).toBe(inputbar)
    expect(expandButton.parentElement).toBe(corner)
    expect(inputbar).not.toHaveClass('group/inputbar')
    expect(corner).toHaveClass('group/expand-corner', 'absolute', 'top-px', 'right-px', 'size-7')
    expect(cornerLine).toHaveClass('top-0', 'right-0', 'size-[18px]', 'rounded-tr-[18px]')
    expect(cornerLine).toHaveClass('border-t-[1.5px]', 'border-r-[1.5px]', 'origin-top-right')
    expect(cornerLine).toHaveClass(
      'transition-[opacity,scale]',
      'duration-200',
      'group-hover/expand-corner:scale-50',
      'group-hover/expand-corner:opacity-0'
    )
    expect(expandButton).toHaveClass(
      'absolute',
      'top-1',
      'right-1',
      'size-5.5',
      'translate-x-2.5',
      '-translate-y-2.5',
      'rotate-[-8deg]',
      'scale-80',
      'transition-[opacity,translate,scale,rotate,color,background-color]',
      'duration-300',
      'opacity-0'
    )
    expect(expandButton).toHaveClass(
      'group-hover/expand-corner:translate-x-0',
      'group-hover/expand-corner:translate-y-0',
      'group-hover/expand-corner:rotate-0',
      'group-hover/expand-corner:scale-100',
      'group-hover/expand-corner:bg-accent/80',
      'group-hover/expand-corner:opacity-100'
    )
    expect(expandButton.querySelector('svg')).toHaveClass('transition-[scale]', 'group-hover/expand-corner:scale-110')

    fireEvent.click(expandButton)

    const collapseButton = screen.getByRole('button', { name: 'chat.input.collapse' })
    expect(collapseButton).toHaveAttribute('aria-pressed', 'true')
    expect(collapseButton).toHaveClass('opacity-100', 'bg-accent/80', 'rotate-0')
    expect(cornerLine).toHaveClass('opacity-0', 'scale-50')
  })

  it('renders a compact editing mode badge attached to the inputbar edge', () => {
    const onCancel = vi.fn()
    const onLocate = vi.fn()

    render(
      <ComposerSurface
        {...baseProps}
        editingState={{
          messageId: 'message-1',
          onLocate,
          onCancel
        }}
      />
    )

    const editingBadge = screen.getByText('chat.input.editing').closest('[data-composer-editing-badge]')

    expect(editingBadge?.closest('[data-composer-inputbar]')).not.toBeNull()
    expect(editingBadge?.closest('[data-composer-toolbar]')).toBeNull()
    expect(editingBadge).toHaveClass(
      'absolute',
      'top-0',
      'left-3',
      '-translate-y-1/2',
      'rounded-full',
      'border',
      'border-border-subtle',
      'bg-card'
    )
    expect(editingBadge).not.toHaveClass('w-full', 'border-b-0', 'bg-muted', 'bg-secondary', 'shadow-xs')

    const locateButton = screen.getByRole('button', { name: 'chat.input.locate_editing_message' })
    expect(locateButton).toHaveClass('size-5', 'text-foreground-muted', 'hover:bg-accent', 'hover:text-foreground')
    fireEvent.click(locateButton)
    expect(onLocate).toHaveBeenCalledTimes(1)

    const cancelButton = screen.getByRole('button', { name: 'chat.input.cancel_editing' })
    expect(cancelButton).toHaveClass('size-5', 'text-foreground-muted', 'hover:bg-accent', 'hover:text-foreground')
    expect(cancelButton).not.toHaveClass('text-info', 'hover:bg-[var(--color-info-bg-hover)]')

    fireEvent.click(cancelButton)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('focuses the editor when an editing session starts', async () => {
    const { rerender } = render(<ComposerSurface {...baseProps} editingState={undefined} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    mocks.focus.mockClear()

    rerender(
      <ComposerSurface
        {...baseProps}
        editingState={{
          messageId: 'message-1',
          highlightKey: 1,
          onCancel: vi.fn()
        }}
      />
    )

    await waitFor(() => expect(mocks.focus).toHaveBeenCalledTimes(1))
  })

  it('briefly highlights the inputbar border when editing starts', () => {
    vi.useFakeTimers()

    try {
      const { rerender } = render(
        <ComposerSurface
          {...baseProps}
          editingState={{
            messageId: 'message-1',
            highlightKey: 1,
            onCancel: vi.fn()
          }}
        />
      )
      const inputbar = document.querySelector('[data-composer-inputbar]')

      expect(inputbar).toHaveClass('border-primary', 'ring-2', 'ring-primary/20')

      act(() => {
        vi.advanceTimersByTime(900)
      })

      expect(inputbar).not.toHaveClass('border-primary', 'ring-2', 'ring-primary/20')

      rerender(<ComposerSurface {...baseProps} editingState={undefined} />)

      expect(inputbar).not.toHaveClass('border-primary', 'ring-2', 'ring-primary/20')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sets quick phrase text as prompt variable token content', async () => {
    render(<Harness />)

    await waitFor(() => expect(mocks.actions).toBeDefined())
    act(() => {
      mocks.actions?.onTextChange('plan ${from}')
    })

    expect(mocks.setContent).toHaveBeenCalledWith(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'plan ' },
              {
                type: 'composerToken',
                attrs: expect.objectContaining({
                  kind: 'promptVariable',
                  label: 'from',
                  promptText: '${from}'
                })
              }
            ]
          }
        ]
      },
      { emitUpdate: false }
    )
  })

  it('keeps token structure when an external text update matches the current content', async () => {
    // Reproduces the long-text paste flow: the editor holds a quote token, pasteHandling converts
    // the pasted text into a file and re-applies the unchanged serialized text. The rebuild only
    // re-tokenizes prompt variables, so it must be skipped or the quote token degrades to text.
    mocks.getJSON.mockReturnValue({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'composerToken',
              attrs: { id: 'quote-1', kind: 'quote', label: 'Quote', promptText: 'quoted text' }
            },
            { type: 'text', text: ' follow up' }
          ]
        }
      ]
    })
    const onTextChange = vi.fn()

    render(
      <ComposerSurface
        {...baseProps}
        text="quoted text follow up"
        onTextChange={onTextChange}
        onActionsChange={(actions) => {
          mocks.actions = actions
        }}
      />
    )

    await waitFor(() => expect(mocks.actions).toBeDefined())
    mocks.setContent.mockClear()

    act(() => {
      mocks.actions?.onTextChange('quoted text follow up')
    })

    expect(mocks.setContent).not.toHaveBeenCalled()
    expect(onTextChange).not.toHaveBeenCalled()
  })

  it('truncates external text updates at the maximum text length', async () => {
    const onTextChange = vi.fn()

    render(
      <ComposerSurface
        {...baseProps}
        onTextChange={onTextChange}
        onActionsChange={(actions) => {
          mocks.actions = actions
        }}
      />
    )

    await waitFor(() => expect(mocks.actions).toBeDefined())
    act(() => {
      mocks.actions?.onTextChange('a'.repeat(40001))
    })

    expect(onTextChange).toHaveBeenCalledWith('a'.repeat(40000))
  })

  it('exposes a focus action for external composer targeting', async () => {
    render(<Harness />)

    await waitFor(() => expect(mocks.actions).toBeDefined())
    act(() => {
      mocks.actions?.focus()
    })

    expect(mocks.focus).toHaveBeenCalled()
  })

  it('inserts composer tokens using the same spacing as attachment tokens', async () => {
    mocks.getJSON.mockReturnValue({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Existing draft' }] }]
    })
    render(<Harness />)

    await waitFor(() => expect(mocks.actions).toBeDefined())
    const token = {
      id: 'quote-1',
      kind: 'quote' as const,
      label: 'Quote',
      description: 'Selected message text',
      promptText: '<blockquote>\n\nSelected message text\n</blockquote>\n'
    }

    act(() => {
      mocks.actions?.insertToken(token)
    })

    expect(mocks.insertComposerToken).toHaveBeenCalledWith(token)
    expect(mocks.insertContent).toHaveBeenCalledWith(' ')
    expect(mocks.insertContent).not.toHaveBeenCalledWith(
      expect.arrayContaining([{ type: 'hardBreak' }, { type: 'composerToken', attrs: token }])
    )
    expect(mocks.chainRun).toHaveBeenCalled()
  })

  it('uses Tab to select the next prompt variable token', async () => {
    mocks.docDescendants.mockImplementation((visit: (node: unknown, position: number) => void) => {
      visit(
        {
          type: { name: 'composerToken' },
          attrs: {
            id: 'prompt-variable:0:from',
            kind: 'promptVariable',
            label: 'from',
            promptText: '${from}'
          }
        },
        5
      )
    })
    render(<Harness />)

    await waitFor(() => expect(mocks.actions).toBeDefined())
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const handled = mocks.editorOptions.editorProps.handleKeyDown(null, {
      key: 'Tab',
      shiftKey: false,
      isComposing: false,
      preventDefault,
      stopPropagation
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(mocks.setNodeSelection).toHaveBeenCalledWith(5)
  })

  it('commits IME composition to a selected prompt variable once composition ends', async () => {
    mocks.selection = {
      from: 5,
      node: {
        type: { name: 'composerToken' },
        attrs: {
          id: 'prompt-variable:0:city',
          kind: 'promptVariable',
          label: 'city',
          promptText: '${city}'
        }
      }
    }
    render(<Harness />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    expect(mocks.editorOptions.editorProps.handleDOMEvents.compositionstart()).toBe(false)

    mocks.editorViewComposing = true
    expect(mocks.editorOptions.editorProps.handleTextInput(null, 5, 6, 'sh')).toBe(true)
    expect(mocks.transaction.setNodeMarkup).not.toHaveBeenCalled()

    mocks.editorViewComposing = false
    expect(mocks.editorOptions.editorProps.handleDOMEvents.compositionend(null, { data: '上海' })).toBe(true)
    expect(mocks.transaction.setNodeMarkup).toHaveBeenCalledWith(
      5,
      undefined,
      expect.objectContaining({
        label: '上海',
        promptText: '上海'
      })
    )
    expect(mocks.dispatch).toHaveBeenCalledWith(mocks.transaction)

    expect(mocks.editorOptions.editorProps.handleTextInput(null, 5, 6, '上海')).toBe(true)
    expect(mocks.transaction.setNodeMarkup).toHaveBeenCalledTimes(1)
  })

  it('blocks typed input after the composer reaches the maximum text length', async () => {
    render(<ComposerSurface {...baseProps} text={'a'.repeat(40000)} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    expect(
      mocks.editorOptions.editorProps.handleTextInput({ state: { doc: { textBetween: vi.fn(() => '') } } }, 1, 1, 'b')
    ).toBe(true)
  })

  it('truncates typed input to the remaining maximum text length', async () => {
    render(<ComposerSurface {...baseProps} text={'a'.repeat(39999)} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    const transaction = {
      insertText: vi.fn(() => transaction)
    }
    const view = {
      state: {
        doc: { textBetween: vi.fn(() => '') },
        tr: transaction
      },
      dispatch: vi.fn()
    }

    expect(mocks.editorOptions.editorProps.handleTextInput(view, 1, 1, 'bc')).toBe(true)
    expect(transaction.insertText).toHaveBeenCalledWith('b', 1, 1)
    expect(view.dispatch).toHaveBeenCalledWith(transaction)
  })

  it('allows typed replacement when the composer stays within the maximum text length', async () => {
    render(<ComposerSurface {...baseProps} text={'a'.repeat(40000)} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    expect(
      mocks.editorOptions.editorProps.handleTextInput({ state: { doc: { textBetween: vi.fn(() => 'a') } } }, 1, 2, 'b')
    ).toBe(false)
  })

  it('opens the QuickPanel root from the slash suggestion bridge', async () => {
    render(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        getToolLaunchers={() => [
          {
            id: 'generate-image',
            kind: 'command',
            label: 'Generate image',
            disabled: true,
            disabledReason: 'The model does not support generating images.',
            icon: 'image'
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    expect(rootSource.renderMode).toBe('headless')
    expect(rootSource.allowedPrefixes).toEqual([' ', '\n', '\t'])
    expect(rootSource.items({ query: 'image' })).toEqual([])

    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 6 },
      query: 'image',
      text: '/image',
      items: []
    })

    expect(mocks.quickPanelOpen).toHaveBeenCalledWith({
      title: 'settings.quickPanel.title',
      list: [
        expect.objectContaining({
          label: 'Generate image',
          description: 'The model does not support generating images.',
          disabled: true,
          filterText: expect.stringContaining('The model does not support generating images.')
        })
      ],
      symbol: '/',
      queryAnchor: 0,
      triggerInfo: {
        type: 'input',
        position: 0,
        originalText: '/image'
      },
      trackInputQuery: true
    })

    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    expect(rootSource.onKeyDown({ event })).toBe(false)
    expect(mocks.quickPanelDispatchKeyDown).toHaveBeenCalledWith(event)
  })

  it('bridges external suggestion sources into QuickPanel items', async () => {
    const command = vi.fn()
    const sourceOnKeyDown = vi.fn(() => false)
    const suggestionItem = {
      id: 'file:notes',
      label: 'notes.md',
      description: '/workspace/notes.md',
      icon: 'file',
      command
    }

    render(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        suggestionSources={[
          {
            pluginKey: 'resource-suggestion',
            char: '@',
            title: 'Resources',
            pageSize: 5,
            allowedPrefixes: [' ', '\n'],
            onKeyDown: sourceOnKeyDown,
            items: () => [suggestionItem]
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const resourceSource = mocks.editorPresetOptions.suggestionSources[1]
    expect(resourceSource.renderMode).toBe('headless')

    const editor = {
      state: {
        doc: {
          textBetween: vi.fn((_from: number, to: number) => (to === 1 ? '' : '@doc'))
        },
        selection: {
          from: 5
        }
      }
    }
    const range = { from: 1, to: 5 }

    resourceSource.onActiveChange({
      editor,
      range,
      query: 'doc',
      text: '@doc',
      items: [suggestionItem]
    })

    expect(mocks.quickPanelOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Resources',
        symbol: '@',
        pageSize: 5,
        queryAnchor: 0,
        manageListExternally: true,
        trackInputQuery: true,
        triggerInfo: {
          type: 'input',
          position: 0,
          originalText: '@doc'
        },
        list: [
          expect.objectContaining({
            id: 'file:notes',
            label: 'notes.md',
            description: '/workspace/notes.md',
            icon: 'file'
          })
        ]
      })
    )

    const openOptions = mocks.quickPanelOpen.mock.calls[0][0]
    openOptions.list[0].action({ action: 'enter', item: openOptions.list[0], context: openOptions })

    expect(command).toHaveBeenCalledWith({
      editor,
      range,
      item: suggestionItem,
      query: 'doc'
    })

    mocks.quickPanelDispatchKeyDown.mockReturnValue(true)
    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    expect(resourceSource.onKeyDown({ event })).toBe(true)
    expect(mocks.quickPanelDispatchKeyDown).toHaveBeenCalledWith(event)
    expect(sourceOnKeyDown).not.toHaveBeenCalled()
  })

  it('appends additional items at the end of the QuickPanel root list', async () => {
    const onRootPanelOpen = vi.fn()
    render(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        onRootPanelOpen={onRootPanelOpen}
        getToolLaunchers={() => [
          {
            id: 'generate-image',
            kind: 'command',
            label: 'Generate image',
            description: 'Generate an image',
            icon: 'image'
          }
        ]}
        rootPanelAdditionalItems={[
          {
            id: 'skill:pdf',
            label: 'pdf',
            description: 'Read PDFs',
            icon: 'sparkles'
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    const activeChangeOptions = {
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 2 },
      query: '',
      text: '/',
      items: []
    }
    rootSource.onActiveChange(activeChangeOptions)
    rootSource.onActiveChange(activeChangeOptions)

    expect(onRootPanelOpen).toHaveBeenCalledOnce()
    expect(mocks.quickPanelOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        list: [
          expect.objectContaining({ label: 'Generate image' }),
          expect.objectContaining({ id: 'skill:pdf', label: 'pdf', description: 'Read PDFs' })
        ]
      })
    )

    rootSource.onExit(activeChangeOptions)
    rootSource.onActiveChange(activeChangeOptions)
    expect(onRootPanelOpen).toHaveBeenCalledTimes(2)
  })

  it('updates the open QuickPanel root list when additional items change', async () => {
    mocks.quickPanelIsVisible = true
    mocks.quickPanelSymbol = '/'

    const getToolLaunchers = () => [
      {
        id: 'generate-image',
        kind: 'command' as const,
        label: 'Generate image',
        description: 'Generate an image',
        icon: 'image'
      }
    ]

    const { rerender } = render(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        getToolLaunchers={getToolLaunchers}
        rootPanelAdditionalItems={[
          {
            id: 'skill:pdf',
            label: 'pdf',
            description: 'Read PDFs',
            icon: 'sparkles'
          }
        ]}
      />
    )

    await waitFor(() => {
      expect(mocks.quickPanelUpdateList).toHaveBeenCalledWith([
        expect.objectContaining({ label: 'Generate image' }),
        expect.objectContaining({ id: 'skill:pdf', label: 'pdf', description: 'Read PDFs' })
      ])
    })

    mocks.quickPanelUpdateList.mockClear()

    rerender(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        getToolLaunchers={getToolLaunchers}
        rootPanelAdditionalItems={[
          {
            id: 'skill:docx',
            label: 'docx',
            description: 'Read DOCX files',
            icon: 'sparkles'
          }
        ]}
      />
    )

    await waitFor(() => {
      expect(mocks.quickPanelUpdateList).toHaveBeenCalledWith([
        expect.objectContaining({ label: 'Generate image' }),
        expect.objectContaining({ id: 'skill:docx', label: 'docx', description: 'Read DOCX files' })
      ])
    })
  })

  it('syncs external managed file and skill tokens into the editor document', async () => {
    const fileToken = {
      id: 'file:file-1',
      kind: 'file' as const,
      label: 'notes.md'
    }
    const skillToken = {
      id: 'skill:pdf',
      kind: 'skill' as const,
      label: 'pdf',
      promptText: 'Use the pdf skill.'
    }

    render(<ComposerSurface {...baseProps} tokens={[fileToken, skillToken]} managedTokenKinds={['file', 'skill']} />)

    await waitFor(() => {
      expect(mocks.insertComposerToken).toHaveBeenCalledWith(fileToken)
      expect(mocks.insertComposerToken).toHaveBeenCalledWith(skillToken)
    })
    expect(mocks.insertContent).toHaveBeenCalledWith(' ')
    expect(mocks.insertContent).toHaveBeenCalledTimes(2)
  })

  it('renders pasted text file tokens with a show-in-input action that replaces the token', async () => {
    const pastedFile = {
      id: 'file-1',
      name: 'pasted_text.txt',
      origin_name: '已粘贴的文本.txt',
      path: '/tmp/pasted_text.txt',
      composerFileKind: COMPOSER_FILE_KIND.PASTED_TEXT
    }
    const pastedToken = {
      id: 'file:file-1',
      kind: 'file' as const,
      label: '已粘贴的文本.txt',
      payload: pastedFile
    }
    const setFiles = vi.fn()

    mocks.fsReadText.mockResolvedValue('long pasted text')
    mocks.getJSON.mockReturnValue({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'composerToken', attrs: pastedToken }] }]
    })

    render(<ComposerSurface {...baseProps} tokens={[pastedToken]} managedTokenKinds={['file']} setFiles={setFiles} />)

    await waitFor(() => expect(mocks.editorPresetOptions?.renderToken).toBeDefined())
    render(
      <>
        {mocks.editorPresetOptions.renderToken(pastedToken, {
          selected: false,
          nodeViewProps: { getPos: () => 3, node: { nodeSize: 1 } }
        })}
      </>
    )

    const showInInputButton = screen.getByRole('button', { name: 'chat.input.paste_text_file' })
    expect(showInInputButton).toHaveClass('min-h-0', 'w-fit', 'p-0', 'text-primary', 'hover:text-primary-hover')
    expect(showInInputButton).not.toHaveClass('w-full', 'text-muted-foreground')

    fireEvent.click(showInInputButton)

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/pasted_text.txt'))
    expect(mocks.deleteRange).toHaveBeenCalledWith({ from: 3, to: 4 })
    expect(mocks.insertContent).toHaveBeenCalledWith([{ type: 'text', text: 'long pasted text' }])
    expect(mocks.chainRun).toHaveBeenCalled()

    const fileUpdater = setFiles.mock.calls[0]?.[0] as (files: (typeof pastedFile)[]) => (typeof pastedFile)[]
    expect(fileUpdater([pastedFile])).toEqual([])
  })

  it('does not notify token changes when only text changes', async () => {
    const onTextChange = vi.fn()
    const onTokensChange = vi.fn()
    render(
      <ComposerSurface
        {...baseProps}
        managedTokenKinds={['file']}
        onTextChange={onTextChange}
        onTokensChange={onTokensChange}
      />
    )

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    act(() => {
      mocks.editorOptions.onUpdate({
        editor: {
          getJSON: () => ({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }]
          }),
          schema: { nodes: {} },
          state: {
            doc: {
              descendants: vi.fn()
            },
            tr: mocks.transaction
          },
          view: {
            composing: false,
            dispatch: mocks.dispatch
          }
        }
      })
    })

    expect(onTextChange).toHaveBeenCalledWith('hello')
    expect(onTokensChange).not.toHaveBeenCalled()
  })

  it('notifies managed token changes when a token text offset changes', async () => {
    const onTokensChange = vi.fn()
    const skillToken = {
      id: 'skill:pdf',
      kind: 'skill' as const,
      label: 'pdf',
      promptText: 'Use the pdf skill.'
    }
    const createEditor = (prefix = '') => ({
      getJSON: () => ({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [...(prefix ? [{ type: 'text', text: prefix }] : []), { type: 'composerToken', attrs: skillToken }]
          }
        ]
      }),
      schema: { nodes: {} },
      state: {
        doc: {
          descendants: vi.fn()
        },
        tr: mocks.transaction
      },
      view: {
        composing: false,
        dispatch: mocks.dispatch
      }
    })

    render(<ComposerSurface {...baseProps} managedTokenKinds={['skill']} onTokensChange={onTokensChange} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    act(() => {
      mocks.editorOptions.onUpdate({ editor: createEditor() })
    })
    onTokensChange.mockClear()

    act(() => {
      mocks.editorOptions.onUpdate({ editor: createEditor('hello ') })
    })

    expect(onTokensChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'skill:pdf',
        textOffset: 6
      })
    ])
  })

  it('lets composer token shortcuts handle Backspace before removing attachments', async () => {
    const setFiles = vi.fn()
    render(<ComposerSurface {...baseProps} filesCount={1} setFiles={setFiles} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    mocks.selection = {
      empty: false,
      from: 1,
      to: 2,
      node: { type: { name: 'composerToken' } },
      $from: { nodeBefore: null }
    }
    const event = {
      key: 'Backspace',
      isComposing: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    }

    const handled = mocks.editorOptions.editorProps.handleKeyDown(null, event)

    expect(handled).toBe(false)
    expect(setFiles).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('opens the QuickPanel root when slash follows whitespace', async () => {
    render(<ComposerSurface {...baseProps} quickPanelEnabled getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => 'hello ')
          }
        }
      },
      range: { from: 7, to: 8 },
      query: '',
      text: '/',
      items: []
    })

    expect(mocks.quickPanelOpen).toHaveBeenCalledWith(expect.objectContaining({ queryAnchor: 6, symbol: '/' }))
  })

  it('uses input-layer text for slash queries after skill tokens', async () => {
    const onToolLauncherSelect = vi.fn()
    render(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        onToolLauncherSelect={onToolLauncherSelect}
        getToolLaunchers={() => [
          {
            id: 'test-command',
            kind: 'command',
            label: 'Test command',
            icon: 'test',
            sources: ['root-panel']
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const inputText = '21 21  /'
    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        getJSON: () => ({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: '21 21 ' },
                {
                  type: 'composerToken',
                  attrs: {
                    id: 'skill:find-skills',
                    kind: 'skill',
                    label: 'find-skills',
                    promptText: 'Use the find-skills skill.'
                  }
                },
                { type: 'text', text: ' /' }
              ]
            }
          ]
        }),
        state: {
          doc: {
            content: { size: 10 },
            textBetween: vi.fn((_from: number, to: number) => (to === 9 ? '21 21  ' : inputText))
          },
          selection: {
            from: 10
          }
        }
      },
      range: { from: 9, to: 10 },
      query: '',
      text: '/',
      items: []
    })

    const openOptions = mocks.quickPanelOpen.mock.calls[0][0]
    expect(openOptions.queryAnchor).toBe(7)
    openOptions.list[0].action({
      action: 'enter',
      context: openOptions,
      item: openOptions.list[0],
      parentPanel: openOptions,
      queryAnchor: openOptions.queryAnchor,
      searchText: ''
    })

    const actionOptions = onToolLauncherSelect.mock.calls[0][1]
    expect(actionOptions.inputAdapter.getText()).toBe(inputText)
    expect(actionOptions.inputAdapter.getCursorOffset()).toBe(inputText.length)
  })

  it('restores copied skill markers as composer tokens on paste', async () => {
    const resolveSkillMarker = vi.fn((marker: string) => {
      if (marker === 'find-skills') {
        return {
          id: 'skill:find-skills',
          kind: 'skill' as const,
          label: 'Find Skills',
          promptText: 'Use the Find Skills skill.'
        }
      }
      if (marker === 'pdf') {
        return {
          id: 'skill:pdf',
          kind: 'skill' as const,
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        }
      }
      return null
    })
    render(<ComposerSurface {...baseProps} resolveSkillMarker={resolveSkillMarker} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const preventDefault = vi.fn()
    const event = {
      preventDefault,
      clipboardData: {
        getData: vi.fn((type: string) => (type === 'text/plain' ? '/find-skills/ /pdf/ 你好' : ''))
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    await waitFor(() =>
      expect(mocks.insertContent).toHaveBeenCalledWith([
        {
          type: 'composerToken',
          attrs: {
            id: 'skill:find-skills',
            kind: 'skill',
            label: 'Find Skills',
            promptText: 'Use the Find Skills skill.'
          }
        },
        { type: 'text', text: ' ' },
        {
          type: 'composerToken',
          attrs: {
            id: 'skill:pdf',
            kind: 'skill',
            label: 'PDF',
            promptText: 'Use the PDF skill.'
          }
        },
        { type: 'text', text: ' 你好' }
      ])
    )
    expect(resolveSkillMarker).toHaveBeenCalledWith('find-skills')
    expect(resolveSkillMarker).toHaveBeenCalledWith('pdf')
  })

  it('writes rich composer clipboard data when copying selected skill tokens', async () => {
    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const clipboardData = createClipboardDataMock()
    const event = {
      preventDefault: vi.fn(),
      clipboardData
    }
    const view = createComposerCopyView([
      {
        type: 'paragraph',
        content: [
          {
            type: 'composerToken',
            attrs: {
              id: 'skill:pdf',
              kind: 'skill',
              label: 'PDF',
              promptText: 'Use PDF'
            }
          },
          { type: 'text', text: ' now' }
        ]
      }
    ])

    const handled = mocks.editorOptions.editorProps.handleDOMEvents.copy(view, event)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(clipboardData.clearData).toHaveBeenCalled()
    expect(clipboardData.getData('text/plain')).toBe('/pdf/ now')
    expect(clipboardData.getData('text/html')).not.toContain('data-composer-token')
    expect(readComposerClipboardFragment(clipboardData.getData(COMPOSER_CLIPBOARD_FRAGMENT_MIME))?.segments).toEqual([
      {
        type: 'token',
        fallbackText: '/pdf/',
        token: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use PDF'
        }
      },
      { type: 'text', text: ' now' }
    ])
  })

  it('writes rich clipboard data and deletes the selection when cutting composer tokens', async () => {
    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const clipboardData = createClipboardDataMock()
    const event = {
      preventDefault: vi.fn(),
      clipboardData
    }
    const view = createComposerCopyView([
      {
        type: 'paragraph',
        content: [
          {
            type: 'composerToken',
            attrs: {
              id: 'skill:pdf',
              kind: 'skill',
              label: 'PDF',
              promptText: 'Use PDF'
            }
          },
          { type: 'text', text: ' now' }
        ]
      }
    ])

    const handled = mocks.editorOptions.editorProps.handleDOMEvents.cut(view, event)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(clipboardData.getData('text/plain')).toBe('/pdf/ now')
    expect(
      readComposerClipboardFragment(clipboardData.getData(COMPOSER_CLIPBOARD_FRAGMENT_MIME))?.segments
    ).toContainEqual({
      type: 'token',
      fallbackText: '/pdf/',
      token: {
        id: 'skill:pdf',
        kind: 'skill',
        label: 'PDF',
        promptText: 'Use PDF'
      }
    })
    expect(mocks.deleteSelection).toHaveBeenCalled()
    expect(mocks.chainRun).toHaveBeenCalled()
  })

  it('lets ProseMirror handle plain text composer cut selections', async () => {
    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const clipboardData = createClipboardDataMock()
    const event = {
      preventDefault: vi.fn(),
      clipboardData
    }
    const view = createComposerCopyView([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'plain text' }]
      }
    ])

    const handled = mocks.editorOptions.editorProps.handleDOMEvents.cut(view, event)

    expect(handled).toBe(false)
    expect(clipboardData.setData).not.toHaveBeenCalled()
    expect(mocks.deleteSelection).not.toHaveBeenCalled()
  })

  it('lets ProseMirror handle plain text composer copy selections', async () => {
    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const clipboardData = createClipboardDataMock()
    const event = {
      preventDefault: vi.fn(),
      clipboardData
    }
    const view = createComposerCopyView([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'plain text' }]
      }
    ])

    const handled = mocks.editorOptions.editorProps.handleDOMEvents.copy(view, event)

    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(clipboardData.clearData).not.toHaveBeenCalled()
    expect(clipboardData.setData).not.toHaveBeenCalled()
  })

  it('keeps copied composer file paths private while preserving attachment restore data', async () => {
    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const clipboardData = createClipboardDataMock()
    const event = {
      preventDefault: vi.fn(),
      clipboardData
    }
    const view = createComposerCopyView([
      {
        type: 'paragraph',
        content: [
          {
            type: 'composerToken',
            attrs: {
              id: 'file:file-1',
              kind: 'file',
              label: 'report.pdf',
              payload: {
                fileTokenSourceId: 'file-1',
                type: 'document',
                ext: '.pdf',
                name: 'report.pdf',
                origin_name: 'report.pdf',
                size: 4096,
                path: '/Users/example/private/report.pdf'
              }
            }
          },
          { type: 'text', text: ' after' }
        ]
      }
    ])

    const handled = mocks.editorOptions.editorProps.handleDOMEvents.copy(view, event)

    const fragmentText = clipboardData.getData(COMPOSER_CLIPBOARD_FRAGMENT_MIME)
    expect(handled).toBe(true)
    expect(clipboardData.getData('text/plain')).toBe('report.pdf after')
    expect(clipboardData.getData('text/html')).not.toContain('/Users/example/private/report.pdf')
    expect(fragmentText).not.toContain('/Users/example/private/report.pdf')
    expect(readComposerClipboardFragment(fragmentText)?.segments[0]).toMatchObject({
      type: 'token',
      token: {
        id: 'file:file-1',
        kind: 'file',
        label: 'report.pdf',
        payload: {
          handle: expect.any(String)
        }
      }
    })
  })

  it('uses live file token payload when copying restored edited-message file tokens', async () => {
    render(
      <ComposerSurface
        {...baseProps}
        tokens={[
          {
            id: 'file:file-1',
            kind: 'file',
            label: 'report.pdf',
            payload: {
              id: 'file-1',
              fileTokenSourceId: 'file-1',
              name: 'report.pdf',
              origin_name: 'report.pdf',
              path: '/Users/example/private/report.pdf',
              size: 4096,
              ext: '.pdf',
              type: 'document',
              created_at: '',
              count: 1
            }
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const clipboardData = createClipboardDataMock()
    const event = {
      preventDefault: vi.fn(),
      clipboardData
    }
    const view = createComposerCopyView([
      {
        type: 'paragraph',
        content: [
          {
            type: 'composerToken',
            attrs: {
              id: 'file:file-1',
              kind: 'file',
              label: 'report.pdf',
              payload: {
                type: 'document',
                ext: '.pdf',
                name: 'report.pdf',
                origin_name: 'report.pdf',
                size: 4096
              }
            }
          }
        ]
      }
    ])

    const handled = mocks.editorOptions.editorProps.handleDOMEvents.copy(view, event)
    const fragmentText = clipboardData.getData(COMPOSER_CLIPBOARD_FRAGMENT_MIME)

    expect(handled).toBe(true)
    expect(clipboardData.getData('text/plain')).toBe('report.pdf')
    expect(clipboardData.getData('text/html')).not.toContain('/Users/example/private/report.pdf')
    expect(readComposerClipboardFragment(fragmentText)?.segments[0]).toMatchObject({
      type: 'token',
      token: {
        id: 'file:file-1',
        kind: 'file',
        label: 'report.pdf',
        payload: {
          handle: expect.any(String)
        }
      }
    })
  })

  it('restores tokens from composer copy data pasted into another composer surface', async () => {
    const resolveSkillMarker = vi.fn((marker: string) =>
      marker === 'pdf'
        ? {
            id: 'skill:pdf',
            kind: 'skill' as const,
            label: 'PDF',
            promptText: 'Use PDF'
          }
        : null
    )
    render(<ComposerSurface {...baseProps} resolveSkillMarker={resolveSkillMarker} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const clipboardData = createClipboardDataMock()
    const copyEvent = {
      preventDefault: vi.fn(),
      clipboardData
    }
    const copyView = createComposerCopyView([
      {
        type: 'paragraph',
        content: [
          {
            type: 'composerToken',
            attrs: {
              id: 'skill:pdf',
              kind: 'skill',
              label: 'PDF',
              promptText: 'Use PDF'
            }
          }
        ]
      }
    ])

    expect(mocks.editorOptions.editorProps.handleDOMEvents.copy(copyView, copyEvent)).toBe(true)

    const pasteEvent = {
      preventDefault: vi.fn(),
      clipboardData
    }
    const handled = mocks.editorOptions.handlePaste(null, pasteEvent)

    expect(handled).toBe(true)
    expect(pasteEvent.preventDefault).toHaveBeenCalled()
    expect(mocks.insertContent).toHaveBeenCalledWith([
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use PDF'
        }
      }
    ])
  })

  it('restores private clipboard skill fragments before parsing plain text markers', async () => {
    const resolveSkillMarker = vi.fn((marker: string) =>
      marker === 'pdf'
        ? {
            id: 'skill:pdf',
            kind: 'skill' as const,
            label: 'PDF',
            promptText: 'Use the PDF skill.'
          }
        : null
    )
    render(<ComposerSurface {...baseProps} resolveSkillMarker={resolveSkillMarker} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const preventDefault = vi.fn()
    const fragment = createComposerClipboardFragment([
      {
        type: 'token',
        token: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        },
        fallbackText: '/pdf/'
      },
      { type: 'text', text: ' private' }
    ])
    const event = {
      preventDefault,
      clipboardData: {
        getData: vi.fn((type: string) => {
          if (type === COMPOSER_CLIPBOARD_FRAGMENT_MIME) return fragment
          if (type === 'text/plain') return '/missing/ plain'
          return ''
        })
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(mocks.insertContent).toHaveBeenCalledWith([
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        }
      },
      { type: 'text', text: ' private' }
    ])
    expect(resolveSkillMarker).toHaveBeenCalledWith('pdf')
  })

  it('restores private clipboard fragments from the session cache when paste data omits custom formats', async () => {
    const resolveSkillMarker = vi.fn((marker: string) =>
      marker === 'pdf'
        ? {
            id: 'skill:pdf',
            kind: 'skill' as const,
            label: 'PDF',
            promptText: 'Use the PDF skill.'
          }
        : null
    )
    const fragment = createComposerClipboardFragment([
      {
        type: 'token',
        token: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        },
        fallbackText: '/plain-only/'
      }
    ])
    const clipboard = await primeComposerClipboardSessionCache('/plain-only/', fragment)

    render(<ComposerSurface {...baseProps} resolveSkillMarker={resolveSkillMarker} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const preventDefault = vi.fn()
    const event = {
      preventDefault,
      clipboardData: {
        getData: vi.fn((type: string) => (type === 'text/plain' ? '/plain-only/' : ''))
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(mocks.insertContent).toHaveBeenCalledWith([
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        }
      }
    ])
    expect(clipboard.read).not.toHaveBeenCalled()
    expect(resolveSkillMarker).toHaveBeenCalledWith('pdf')
  })

  it('matches the session cache across Windows clipboard line ending round-trips', async () => {
    const resolveSkillMarker = vi.fn((marker: string) =>
      marker === 'pdf'
        ? {
            id: 'skill:pdf',
            kind: 'skill' as const,
            label: 'PDF',
            promptText: 'Use the PDF skill.'
          }
        : null
    )
    const fragment = createComposerClipboardFragment([
      {
        type: 'token',
        token: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        },
        fallbackText: '/pdf/'
      }
    ])
    const clipboard = await primeComposerClipboardSessionCache('line one\nline two', fragment)

    render(<ComposerSurface {...baseProps} resolveSkillMarker={resolveSkillMarker} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn((type: string) => (type === 'text/plain' ? 'line one\r\nline two' : ''))
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(mocks.insertContent).toHaveBeenCalledWith([
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'PDF',
          promptText: 'Use the PDF skill.'
        }
      }
    ])
    expect(clipboard.read).not.toHaveBeenCalled()
  })

  it('inserts external plain text synchronously without reading the system clipboard', async () => {
    const read = vi.fn(async () => [])
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read }
    })
    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const preventDefault = vi.fn()
    const event = {
      preventDefault,
      clipboardData: {
        getData: vi.fn((type: string) => (type === 'text/plain' ? 'plain paste' : ''))
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(mocks.insertContent).toHaveBeenCalledWith([{ type: 'text', text: 'plain paste' }])
    expect(mocks.insertContent).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
  })

  it('prefers paste event private fragments over the session cache', async () => {
    const resolveSkillMarker = vi.fn((marker: string) =>
      marker === 'event'
        ? {
            id: 'skill:event',
            kind: 'skill' as const,
            label: 'Event Skill',
            promptText: 'Use event skill.'
          }
        : marker === 'cached'
          ? {
              id: 'skill:cached',
              kind: 'skill' as const,
              label: 'Cached Skill',
              promptText: 'Use cached skill.'
            }
          : null
    )
    const eventFragment = createComposerClipboardFragment([
      {
        type: 'token',
        token: {
          id: 'skill:event',
          kind: 'skill',
          label: 'Event Skill',
          promptText: 'Use event skill.'
        },
        fallbackText: '/event/'
      }
    ])
    const cachedFragment = createComposerClipboardFragment([
      {
        type: 'token',
        token: {
          id: 'skill:cached',
          kind: 'skill',
          label: 'Cached Skill',
          promptText: 'Use cached skill.'
        },
        fallbackText: '/cached/'
      }
    ])
    const clipboard = await primeComposerClipboardSessionCache('/event/', cachedFragment)
    render(<ComposerSurface {...baseProps} resolveSkillMarker={resolveSkillMarker} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn((type: string) => {
          if (type === COMPOSER_CLIPBOARD_FRAGMENT_MIME) return eventFragment
          if (type === 'text/plain') return '/event/'
          return ''
        })
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(mocks.insertContent).toHaveBeenCalledWith([
      {
        type: 'composerToken',
        attrs: {
          id: 'skill:event',
          kind: 'skill',
          label: 'Event Skill',
          promptText: 'Use event skill.'
        }
      }
    ])
    expect(clipboard.read).not.toHaveBeenCalled()
    expect(resolveSkillMarker).toHaveBeenCalledWith('event')
    expect(resolveSkillMarker).not.toHaveBeenCalledWith('cached')
  })

  it('restores private clipboard file fragments with handles into file tokens and file state', async () => {
    const setFiles = vi.fn()
    render(<ComposerSurface {...baseProps} managedTokenKinds={['file']} setFiles={setFiles} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const fragment = createComposerClipboardFragment([
      {
        type: 'token',
        token: {
          id: 'file:file-1',
          kind: 'file',
          label: 'report.pdf',
          payload: {
            fileTokenSourceId: 'file-1',
            type: 'document',
            ext: '.pdf',
            name: 'report.pdf',
            origin_name: 'report.pdf',
            size: 4096,
            path: '/Users/example/private/report.pdf'
          }
        },
        fallbackText: 'report.pdf'
      }
    ])
    expect(fragment).not.toContain('/Users/example/private/report.pdf')
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn((type: string) => {
          if (type === COMPOSER_CLIPBOARD_FRAGMENT_MIME) return fragment
          if (type === 'text/plain') return 'report.pdf'
          return ''
        })
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(mocks.insertContent).toHaveBeenCalledWith([
      {
        type: 'composerToken',
        attrs: {
          id: 'file:file-1',
          kind: 'file',
          label: 'report.pdf',
          payload: expect.objectContaining({
            fileTokenSourceId: 'file-1',
            path: '/Users/example/private/report.pdf',
            type: 'document'
          })
        }
      }
    ])
    const updater = setFiles.mock.calls[0]?.[0] as (files: unknown[]) => unknown[]
    expect(updater([])).toEqual([
      expect.objectContaining({
        fileTokenSourceId: 'file-1',
        path: '/Users/example/private/report.pdf',
        type: 'document'
      })
    ])
  })

  it('downgrades private clipboard file fragments without paths to fallback text', async () => {
    render(<ComposerSurface {...baseProps} managedTokenKinds={['file']} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())
    const fragment = createComposerClipboardFragment([
      {
        type: 'token',
        token: {
          id: 'file:file-1',
          kind: 'file',
          label: 'report.pdf',
          payload: {
            type: 'document',
            ext: '.pdf',
            name: 'report.pdf'
          }
        },
        fallbackText: 'report.pdf'
      }
    ])
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn((type: string) => {
          if (type === COMPOSER_CLIPBOARD_FRAGMENT_MIME) return fragment
          if (type === 'text/plain') return 'report.pdf'
          return ''
        })
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(mocks.insertContent).toHaveBeenCalledWith([{ type: 'text', text: 'report.pdf' }])
    expect(baseProps.setFiles).not.toHaveBeenCalled()
  })

  it('restores serialized skill tokens when initializing draft content', async () => {
    render(
      <ComposerSurface
        {...baseProps}
        text="Use the Find Skills skill. hello"
        draftTokens={[
          {
            id: 'skill:find-skills',
            kind: 'skill',
            label: 'Find Skills',
            promptText: 'Use the Find Skills skill.',
            index: 0,
            textOffset: 0
          }
        ]}
      />
    )

    expect(mocks.editorOptions.content).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'composerToken',
              attrs: {
                id: 'skill:find-skills',
                kind: 'skill',
                label: 'Find Skills',
                promptText: 'Use the Find Skills skill.'
              }
            },
            { type: 'text', text: ' hello' }
          ]
        }
      ]
    })
  })

  it('preserves serialized file token payload when initializing draft content', async () => {
    render(
      <ComposerSurface
        {...baseProps}
        text="Open default-topic.png now"
        draftTokens={[
          {
            id: 'file:image',
            kind: 'file',
            label: 'default-topic.png',
            promptText: 'default-topic.png',
            payload: {
              type: 'image',
              ext: '.png',
              name: 'default-topic.png',
              origin_name: 'default-topic.png',
              size: 2048
            },
            index: 0,
            textOffset: 5
          }
        ]}
      />
    )

    expect(mocks.editorOptions.content).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Open ' },
            {
              type: 'composerToken',
              attrs: {
                id: 'file:image',
                kind: 'file',
                label: 'default-topic.png',
                promptText: 'default-topic.png',
                payload: {
                  type: 'image',
                  ext: '.png',
                  name: 'default-topic.png',
                  origin_name: 'default-topic.png',
                  size: 2048
                }
              }
            },
            { type: 'text', text: ' now' }
          ]
        }
      ]
    })
  })

  it('delegates text longer than the fixed threshold to the long-text file handler', async () => {
    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn((type: string) => (type === 'text/plain' ? 'a'.repeat(2001) : ''))
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(mocks.pasteHandler).toHaveBeenCalledWith(event)
  })

  it('truncates pasted text to the remaining maximum text length', async () => {
    render(<ComposerSurface {...baseProps} text={'a'.repeat(39999)} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        getData: vi.fn((type: string) => (type === 'text/plain' ? 'bb' : ''))
      }
    }

    const handled = mocks.editorOptions.handlePaste(null, event)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(mocks.insertContent).toHaveBeenCalledWith([{ type: 'text', text: 'b' }])
    expect(mocks.pasteHandler).not.toHaveBeenCalled()
  })

  it('does not reapply serialized skill prompt text as visible editor content', async () => {
    const onTextChange = vi.fn()
    const skillToken = {
      id: 'skill:find-skills',
      kind: 'skill' as const,
      label: 'find-skills',
      promptText: 'Use the find-skills skill.'
    }
    const serializedText = 'Use the find-skills skill. '
    const tokenDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'composerToken',
              attrs: skillToken
            },
            { type: 'text', text: ' ' }
          ]
        }
      ]
    }
    const { rerender } = render(
      <ComposerSurface {...baseProps} onTextChange={onTextChange} managedTokenKinds={['skill']} tokens={[]} />
    )

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    act(() => {
      mocks.editorOptions.onUpdate({
        editor: {
          getJSON: () => tokenDocument,
          state: {
            doc: {
              descendants: vi.fn()
            },
            tr: mocks.transaction
          },
          view: {
            composing: false
          }
        }
      })
    })

    expect(onTextChange).toHaveBeenCalledWith(serializedText)
    mocks.setContent.mockClear()

    rerender(
      <ComposerSurface
        {...baseProps}
        text={serializedText}
        onTextChange={onTextChange}
        managedTokenKinds={['skill']}
        tokens={[skillToken]}
      />
    )

    expect(mocks.setContent).not.toHaveBeenCalled()

    rerender(
      <ComposerSurface
        {...baseProps}
        text={serializedText}
        onTextChange={onTextChange}
        managedTokenKinds={['skill']}
        tokens={[skillToken]}
      />
    )

    expect(mocks.setContent).toHaveBeenCalledWith(expect.any(Object), { emitUpdate: false })
  })

  it('does not open the QuickPanel root when slash is attached to previous text', async () => {
    render(<ComposerSurface {...baseProps} quickPanelEnabled getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => 'hello')
          }
        }
      },
      range: { from: 6, to: 7 },
      query: '',
      text: '/',
      items: []
    })

    expect(mocks.quickPanelOpen).not.toHaveBeenCalled()
  })

  it('does not open the QuickPanel root when cursor is not at the end of the slash query', async () => {
    render(<ComposerSurface {...baseProps} quickPanelEnabled getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn((_from: number, to: number) => (to === 7 ? 'hello ' : 'hello /i'))
          },
          selection: {
            from: 9
          }
        }
      },
      range: { from: 7, to: 13 },
      query: 'image',
      text: '/image',
      items: []
    })

    expect(mocks.quickPanelOpen).not.toHaveBeenCalled()
  })

  it('closes the QuickPanel root when the slash suggestion exits', async () => {
    mocks.quickPanelIsVisible = true
    mocks.quickPanelSymbol = '/'

    render(<ComposerSurface {...baseProps} quickPanelEnabled getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onExit({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 2 },
      query: '',
      text: '/',
      items: []
    })

    await waitFor(() => expect(mocks.quickPanelClose).toHaveBeenCalledWith())
  })

  it('does not close a child panel when the slash suggestion exits', async () => {
    mocks.quickPanelIsVisible = true
    mocks.quickPanelSymbol = '/'

    const { rerender } = render(<ComposerSurface {...baseProps} quickPanelEnabled getToolLaunchers={() => []} />)

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onExit({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 2 },
      query: '',
      text: '/',
      items: []
    })

    mocks.quickPanelSymbol = 'child-panel'
    rerender(<ComposerSurface {...baseProps} quickPanelEnabled getToolLaunchers={() => []} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mocks.quickPanelClose).not.toHaveBeenCalled()
  })

  it('lets the visible QuickPanel handle Enter before send-message shortcuts', async () => {
    const onSendDraft = vi.fn()
    mocks.quickPanelIsVisible = true
    mocks.quickPanelDispatchKeyDown.mockReturnValue(true)

    render(<ComposerSurface {...baseProps} onSendDraft={onSendDraft} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    expect(mocks.editorOptions.editorProps.handleKeyDown(null, event)).toBe(true)
    expect(mocks.quickPanelDispatchKeyDown).toHaveBeenCalledWith(event)
    expect(onSendDraft).not.toHaveBeenCalled()
  })

  it('lets the visible QuickPanel handle Tab before prompt-variable navigation', async () => {
    mocks.quickPanelIsVisible = true
    mocks.quickPanelDispatchKeyDown.mockReturnValue(true)

    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    const event = new KeyboardEvent('keydown', { key: 'Tab' })
    expect(mocks.editorOptions.editorProps.handleKeyDown(null, event)).toBe(true)
    expect(mocks.quickPanelDispatchKeyDown).toHaveBeenCalledWith(event)
    expect(mocks.setNodeSelection).not.toHaveBeenCalled()
  })

  it('routes QuickPanel keys through the dispatcher even when the editor captured a hidden panel state', async () => {
    mocks.quickPanelIsVisible = false
    mocks.quickPanelDispatchKeyDown.mockReturnValue(true)

    render(<ComposerSurface {...baseProps} />)

    await waitFor(() => expect(mocks.editorOptions).toBeDefined())

    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    expect(mocks.editorOptions.editorProps.handleKeyDown(null, event)).toBe(true)
    expect(mocks.quickPanelDispatchKeyDown).toHaveBeenCalledWith(event)
  })

  it('keeps the QuickPanel root as the parent when opening child panels from slash', async () => {
    const onToolLauncherSelect = vi.fn()
    render(
      <ComposerSurface
        {...baseProps}
        quickPanelEnabled
        onToolLauncherSelect={onToolLauncherSelect}
        getToolLaunchers={() => [
          {
            id: 'thinking',
            kind: 'group',
            label: 'Thinking',
            description: 'Reasoning controls',
            icon: 'brain',
            sources: ['popover'],
            submenu: [
              {
                id: 'thinking-low',
                kind: 'command',
                label: 'Low',
                description: 'Use low reasoning',
                icon: 'low',
                sources: ['root-panel']
              }
            ]
          },
          {
            id: 'knowledge-base',
            kind: 'command',
            label: 'Knowledge Base',
            description: 'Use configured knowledge',
            icon: 'kb',
            sources: ['root-panel']
          }
        ]}
      />
    )

    await waitFor(() => expect(mocks.editorPresetOptions).toBeDefined())

    const rootSource = mocks.editorPresetOptions.suggestionSources[0]
    rootSource.onActiveChange({
      editor: {
        state: {
          doc: {
            textBetween: vi.fn(() => '')
          }
        }
      },
      range: { from: 1, to: 4 },
      query: 'low',
      text: '/low',
      items: []
    })

    const rootPanelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    expect(rootPanelOptions).toMatchObject({
      title: 'settings.quickPanel.title',
      symbol: '/',
      queryAnchor: 0,
      triggerInfo: {
        type: 'input',
        position: 0,
        originalText: '/low'
      }
    })
    expect(rootPanelOptions.list).toEqual([
      expect.objectContaining({
        label: 'Thinking',
        isMenu: true,
        filterText: expect.stringContaining('Low')
      }),
      expect.objectContaining({
        label: 'Knowledge Base'
      })
    ])

    rootPanelOptions.list[0].action({
      action: 'enter',
      context: rootPanelOptions,
      item: rootPanelOptions.list[0],
      parentPanel: rootPanelOptions,
      queryAnchor: 0,
      searchText: 'low'
    })

    expect(onToolLauncherSelect).not.toHaveBeenCalled()
    expect(mocks.quickPanelOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Thinking',
        symbol: 'thinking',
        queryAnchor: 0,
        parentPanel: expect.objectContaining({
          title: 'settings.quickPanel.title',
          symbol: '/',
          queryAnchor: 0,
          triggerInfo: {
            type: 'input',
            position: 0,
            originalText: '/low'
          },
          list: expect.arrayContaining([
            expect.objectContaining({ label: 'Thinking' }),
            expect.objectContaining({ label: 'Knowledge Base' })
          ])
        }),
        list: [expect.objectContaining({ label: 'Low', filterText: expect.stringContaining('Low') })]
      })
    )
  })
})
