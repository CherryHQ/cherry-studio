import type { Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import {
  defaultMessageEditorConfig,
  defaultMessageRenderConfig,
  type MessageListItem,
  type MessageListProviderValue
} from '../../types'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  NormalTooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  Textarea: {
    Input: ({ ref, ...props }: ComponentProps<'textarea'> & { ref?: React.RefObject<HTMLTextAreaElement | null> }) => (
      <textarea ref={ref} {...props} />
    )
  },
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: ({ icon, ...props }: ComponentProps<'button'> & { icon: ReactNode }) => (
    <button type="button" {...props}>
      {icon}
    </button>
  )
}))

vi.mock('@renderer/utils', () => ({
  classNames: (...values: unknown[]) => values.filter(Boolean).join(' '),
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) => `${prefix}: ${String(error)}`
}))

vi.mock('./../MessageAttachmentPreview', () => ({
  MessageAttachmentButton: () => <button type="button">attachment</button>,
  MessageAttachmentPreview: () => null
}))

vi.mock('lucide-react', () => ({
  Bot: () => <span>bot-icon</span>,
  Boxes: () => <span>boxes-icon</span>,
  Braces: () => <span>braces-icon</span>,
  Code2: () => <span>code-icon</span>,
  FileText: () => <span>file-icon</span>,
  Globe2: () => <span>globe-icon</span>,
  Languages: () => <span>translate-icon</span>,
  Loader2: () => <span>loading-icon</span>,
  Monitor: () => <span>monitor-icon</span>,
  Save: () => <span>save-icon</span>,
  Send: () => <span>resend-icon</span>,
  TextQuote: () => <span>quote-icon</span>,
  Wrench: () => <span>wrench-icon</span>,
  X: () => <span>cancel-icon</span>,
  Zap: () => <span>zap-icon</span>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const { default: MessageEditor } = await import('../MessageEditor')

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: []
} as Topic

const textPart = (text: string, metadata?: Record<string, unknown>): CherryMessagePart =>
  ({ type: 'text', text, ...(metadata && { providerMetadata: metadata }) }) as CherryMessagePart

const quotedPromptText = '<blockquote>\n\nSelected message text\n</blockquote>'

const quoteTextPart = (): CherryMessagePart =>
  textPart(`${quotedPromptText} Reply`, {
    cherry: {
      composer: {
        version: 1,
        tokens: [
          {
            id: 'quote-1',
            kind: 'quote',
            label: 'Quote',
            description: 'Selected message text',
            index: 0,
            textOffset: 0,
            promptText: quotedPromptText
          }
        ]
      }
    }
  })

const staleQuoteTextPart = (): CherryMessagePart =>
  textPart('Edited selected message Reply', {
    cherry: {
      composer: {
        version: 1,
        tokens: [
          {
            id: 'quote-1',
            kind: 'quote',
            label: 'Quote',
            description: 'Selected message text',
            index: 0,
            textOffset: 0,
            promptText: quotedPromptText
          }
        ]
      }
    }
  })

function userMessage(overrides: Partial<MessageListItem>): MessageListItem {
  return {
    id: 'message-1',
    role: 'user',
    topicId: topic.id,
    parentId: 'assistant-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    ...overrides
  } as MessageListItem
}

function renderEditor({
  message,
  parts = [textPart('hello')],
  actions = {},
  onSave = vi.fn(),
  onResend = vi.fn(),
  onCancel = vi.fn()
}: {
  message: MessageListItem
  parts?: CherryMessagePart[]
  actions?: Partial<MessageListProviderValue['actions']>
  onSave?: (parts: CherryMessagePart[]) => void | Promise<void>
  onResend?: (parts: CherryMessagePart[]) => void | Promise<void>
  onCancel?: () => void
}) {
  const value: MessageListProviderValue = {
    state: {
      topic,
      messages: [message],
      partsByMessageId: {
        [message.id]: parts
      },
      hasOlder: false,
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig,
      editorConfig: defaultMessageEditorConfig,
      getMessageEditorCapabilities: (item) => ({
        canAddImageFile: false,
        canAddTextFile: true,
        canForkAndResend: item.role === 'user'
      })
    },
    actions: {
      forkAndResendMessage: vi.fn(),
      editMessage: vi.fn(),
      ...actions
    },
    meta: {
      selectionLayer: false
    }
  }

  const result = render(
    <MessageListProvider value={value}>
      <MessageEditor message={message} onSave={onSave} onResend={onResend} onCancel={onCancel} />
    </MessageListProvider>
  )

  return { ...result, onSave, onResend, onCancel }
}

describe('MessageEditor', () => {
  it('shows resend for root user messages and keeps save available', async () => {
    const { onCancel, onResend } = renderEditor({ message: userMessage({ parentId: null }) })

    expect(screen.getByText('resend-icon')).toBeInTheDocument()
    expect(screen.getByText('save-icon')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    await waitFor(() => expect(onResend).toHaveBeenCalledWith([textPart('hello')]))

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalled()
  })

  it('shows resend for non-root user messages', () => {
    renderEditor({ message: userMessage({ parentId: 'assistant-1' }) })

    expect(screen.getByText('resend-icon')).toBeInTheDocument()
  })

  it('saves root user edits without requiring resend', async () => {
    const { onSave, onResend } = renderEditor({ message: userMessage({ parentId: null }) })

    fireEvent.click(screen.getByText('save-icon').closest('button')!)

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([textPart('hello')]))
    expect(onResend).not.toHaveBeenCalled()
  })

  it('uses compact composer spacing instead of document editor spacing', async () => {
    renderEditor({ message: userMessage({ parentId: 'assistant-1' }) })

    const editor = await screen.findByRole('textbox')

    expect(editor).toHaveClass('composer-tiptap')
    expect(editor.getAttribute('style')).toContain('--composer-editor-padding: 14px 16px')
  })

  it('renders quote composer metadata as an atomic token instead of blockquote text', async () => {
    renderEditor({ message: userMessage({ parentId: 'assistant-1' }), parts: [quoteTextPart()] })

    const editor = await screen.findByRole('textbox')
    const token = editor.querySelector('[data-composer-token-kind="quote"]')

    expect(token).toBeInTheDocument()
    expect(token).toHaveTextContent('Quote')
    expect(editor.textContent).toContain('QuoteReply')
    expect(editor.textContent).not.toContain('Quote Reply')
    expect(editor).not.toHaveTextContent('<blockquote>')
    expect(editor).not.toHaveTextContent('Selected message text')
    expect(editor).toHaveTextContent('Reply')
  })

  it('saves quote token edits as blockquote text and updated composer metadata', async () => {
    const { onSave } = renderEditor({ message: userMessage({ parentId: 'assistant-1' }), parts: [quoteTextPart()] })

    fireEvent.click(screen.getByText('save-icon').closest('button')!)

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'text',
          text: `${quotedPromptText} Reply`,
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [
                  expect.objectContaining({
                    id: 'quote-1',
                    kind: 'quote',
                    label: 'Quote',
                    textOffset: 0,
                    promptText: quotedPromptText
                  })
                ]
              }
            }
          }
        })
      ])
    )
  })

  it('clears stale composer metadata when translated text replaces quote token content', async () => {
    const translateEditorText = vi.fn().mockResolvedValue('Translated reply')
    const { onSave } = renderEditor({
      message: userMessage({ parentId: 'assistant-1' }),
      parts: [quoteTextPart()],
      actions: { translateEditorText }
    })

    fireEvent.click(screen.getByText('translate-icon').closest('button')!)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('Translated reply'))
    fireEvent.click(screen.getByText('save-icon').closest('button')!)

    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const savedPart = vi.mocked(onSave).mock.calls[0][0][0] as CherryMessagePart & {
      providerMetadata?: { cherry?: { composer?: unknown } }
    }
    expect(savedPart).toMatchObject({ type: 'text', text: 'Translated reply' })
    expect(savedPart.providerMetadata?.cherry?.composer).toBeUndefined()
  })

  it('saves stale quote metadata as plain text without reinserting the old prompt text', async () => {
    const { onSave } = renderEditor({
      message: userMessage({ parentId: 'assistant-1' }),
      parts: [staleQuoteTextPart()]
    })

    fireEvent.click(screen.getByText('save-icon').closest('button')!)

    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const savedPart = vi.mocked(onSave).mock.calls[0][0][0] as CherryMessagePart & {
      providerMetadata?: { cherry?: { composer?: unknown } }
    }
    expect(savedPart).toMatchObject({ type: 'text', text: 'Edited selected message Reply' })
    expect(savedPart.providerMetadata?.cherry?.composer).toBeUndefined()
  })
})
