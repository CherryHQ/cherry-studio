import type { Message } from '@renderer/types/newMessage'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SaveToKnowledgePopup from '../SaveToKnowledgePopup'

const mockSubmitKnowledgeItems = vi.fn()
const mockUseKnowledgeBases = vi.fn()
const mockUseAddKnowledgeItems = vi.fn()
const mockAnalyzeMessageContent = vi.fn()
const mockProcessMessageContent = vi.fn()
const mockTopViewShow = vi.fn()
const mockTopViewHide = vi.fn()

vi.mock('@renderer/hooks/useKnowledgeBases', () => ({
  useKnowledgeBases: () => mockUseKnowledgeBases()
}))

vi.mock('@renderer/hooks/useKnowledgeItems', () => ({
  useAddKnowledgeItems: (...args: unknown[]) => mockUseAddKnowledgeItems(...args)
}))

vi.mock('@renderer/utils/knowledge', () => ({
  CONTENT_TYPES: {
    TEXT: 'text',
    CODE: 'code',
    THINKING: 'thinking',
    TOOL_USE: 'tools',
    CITATION: 'citations',
    TRANSLATION: 'translations',
    ERROR: 'errors',
    FILE: 'files',
    IMAGES: 'images'
  },
  analyzeMessageContent: (...args: unknown[]) => mockAnalyzeMessageContent(...args),
  analyzeTopicContent: vi.fn(),
  processMessageContent: (...args: unknown[]) => mockProcessMessageContent(...args),
  processTopicContent: vi.fn()
}))

vi.mock('@renderer/components/TopView', () => ({
  TopView: {
    show: (...args: unknown[]) => mockTopViewShow(...args),
    hide: (...args: unknown[]) => mockTopViewHide(...args)
  }
}))

vi.mock('@cherrystudio/ui', async () => {
  return {
    Button: ({
      children,
      disabled,
      loading,
      onClick,
      ...props
    }: {
      children: ReactNode
      disabled?: boolean
      loading?: boolean
      onClick?: () => void
    }) => (
      <button {...props} disabled={disabled || loading} onClick={onClick} type="button">
        {children}
      </button>
    ),
    ColFlex: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    Combobox: ({
      onChange,
      options = [],
      placeholder,
      value,
      ...props
    }: {
      onChange?: (value: string) => void
      options?: Array<{ disabled?: boolean; label: string; value: string }>
      placeholder?: string
      value?: string
    }) => (
      <select {...props} value={value ?? ''} onChange={(event) => onChange?.(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} disabled={option.disabled} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    Dialog: ({
      children,
      open,
      onOpenChange
    }: {
      children: ReactNode
      open: boolean
      onOpenChange?: (open: boolean) => void
    }) =>
      open ? (
        <div data-testid="dialog">
          {children}
          <button type="button" onClick={() => onOpenChange?.(false)}>
            close
          </button>
        </div>
      ) : null,
    DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    DialogFooter: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    DialogHeader: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    DialogTitle: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <h1 {...props}>{children}</h1>
    ),
    Flex: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => <div {...props}>{children}</div>,
    CustomTag: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <span {...props}>{children}</span>
    ),
    HelpTooltip: ({ content }: { content?: ReactNode }) => (content ? <span>{content}</span> : null),
    Label: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <label {...props}>{children}</label>
    )
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      const translations = {
        'chat.input.file_not_supported_count': `${options?.count ?? 0} files are not supported`,
        'chat.save.knowledge.content.file.description': 'file description',
        'chat.save.knowledge.content.file.title': 'Files',
        'chat.save.knowledge.content.maintext.description': 'text description',
        'chat.save.knowledge.content.maintext.title': 'Main text',
        'chat.save.knowledge.empty.no_content': 'No content',
        'chat.save.knowledge.empty.no_knowledge_base': 'No knowledge base',
        'chat.save.knowledge.error.invalid_base': 'Invalid base',
        'chat.save.knowledge.error.no_content_selected': 'No content selected',
        'chat.save.knowledge.error.save_failed': 'Save failed',
        'chat.save.knowledge.select.base.placeholder': 'Select base',
        'chat.save.knowledge.select.base.title': 'Knowledge base',
        'chat.save.knowledge.select.content.tip': `Selected ${options?.count ?? 0}`,
        'chat.save.knowledge.select.content.title': 'Content',
        'chat.save.knowledge.title': 'Save to knowledge',
        'chat.save.topic.knowledge.loading': 'Loading',
        'common.cancel': 'Cancel',
        'common.no_results': 'No results',
        'common.save': 'Save',
        'common.search': 'Search'
      } satisfies Record<string, string>

      return translations[key] ?? key
    }
  })
}))

const message = {
  id: 'message-1',
  role: 'user',
  assistantId: 'assistant-1',
  topicId: 'topic-1',
  createdAt: '2026-05-15T00:00:00.000Z',
  status: 'success',
  blocks: []
} as Message

function renderPopupForMessage() {
  const promise = SaveToKnowledgePopup.showForMessage(message)
  const element = mockTopViewShow.mock.calls.at(-1)?.[0] as ReactNode

  render(<>{element}</>)

  return promise
}

describe('SaveToKnowledgePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockUseKnowledgeBases.mockReturnValue({
      bases: [
        {
          id: 'base-1',
          name: 'Knowledge Base',
          status: 'completed'
        }
      ]
    })
    mockUseAddKnowledgeItems.mockReturnValue({
      submit: mockSubmitKnowledgeItems,
      isSubmitting: false,
      error: undefined
    })
    mockSubmitKnowledgeItems.mockResolvedValue(undefined)
    ;(window as any).toast = {
      error: vi.fn(),
      warning: vi.fn()
    }
  })

  it('skips unsupported file attachments and submits supported files', async () => {
    mockAnalyzeMessageContent.mockReturnValue({
      text: 0,
      code: 0,
      thinking: 0,
      images: 0,
      files: 3,
      tools: 0,
      citations: 0,
      translations: 0,
      errors: 0
    })
    mockProcessMessageContent.mockReturnValue({
      text: '',
      files: [{ path: '/tmp/report.pdf' }, { path: '/tmp/cache.sqlite' }, { path: '/tmp/notes.md' }]
    })

    const promise = renderPopupForMessage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockSubmitKnowledgeItems).toHaveBeenCalledWith([
        {
          type: 'file',
          data: {
            source: '/tmp/report.pdf',
            path: '/tmp/report.pdf'
          }
        },
        {
          type: 'file',
          data: {
            source: '/tmp/notes.md',
            path: '/tmp/notes.md'
          }
        }
      ])
    })
    expect(window.toast.warning).toHaveBeenCalledWith('1 files are not supported')

    await expect(promise).resolves.toEqual({
      success: true,
      savedCount: 2
    })
  })

  it('does not submit when selected attachments are all unsupported', async () => {
    mockAnalyzeMessageContent.mockReturnValue({
      text: 0,
      code: 0,
      thinking: 0,
      images: 0,
      files: 2,
      tools: 0,
      citations: 0,
      translations: 0,
      errors: 0
    })
    mockProcessMessageContent.mockReturnValue({
      text: '',
      files: [{ path: '/tmp/blob.bin' }, { path: '/tmp/cache.sqlite' }]
    })

    void renderPopupForMessage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('2 files are not supported')
    })
    expect(mockSubmitKnowledgeItems).not.toHaveBeenCalled()
  })

  it('saves text when file attachments are unsupported', async () => {
    mockAnalyzeMessageContent.mockReturnValue({
      text: 1,
      code: 0,
      thinking: 0,
      images: 0,
      files: 1,
      tools: 0,
      citations: 0,
      translations: 0,
      errors: 0
    })
    mockProcessMessageContent.mockReturnValue({
      text: 'hello',
      files: [{ path: '/tmp/cache.sqlite' }]
    })

    void renderPopupForMessage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockSubmitKnowledgeItems).toHaveBeenCalledWith([
        {
          type: 'note',
          data: {
            source: 'message-1',
            content: 'hello'
          }
        }
      ])
    })
    expect(window.toast.warning).toHaveBeenCalledWith('1 files are not supported')
  })
})
