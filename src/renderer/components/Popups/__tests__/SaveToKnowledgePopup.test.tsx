import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import type { FileMetadata } from '@renderer/types/file'
import type { MessageExportView } from '@renderer/types/messageExport'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processMessageContent: vi.fn(),
  submitKnowledgeItems: vi.fn(),
  TopView: {
    show: vi.fn(),
    hide: vi.fn()
  },
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: vi.fn()
}))

vi.mock('@renderer/hooks/useKnowledgeItems', () => ({
  useAddKnowledgeItems: vi.fn()
}))

vi.mock('@renderer/components/TopView/TopView', () => ({
  TopView: mocks.TopView
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
  analyzeMessageContent: (message: MessageExportView & { testFiles?: FileMetadata[] }) => ({
    text: 0,
    code: 0,
    thinking: 0,
    images: 0,
    files: message.testFiles?.length ?? 0,
    tools: 0,
    citations: 0,
    translations: 0,
    errors: 0
  }),
  processMessageContent: mocks.processMessageContent
}))

vi.mock('@renderer/services/knowledgeContent', () => ({
  analyzeTopicContent: vi.fn(),
  processTopicContent: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key)
  })
}))

vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="check-icon" />
}))

vi.mock('@renderer/components/tags/CustomTag', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, loading, ...props }: React.ComponentProps<'button'> & { loading?: boolean }) => (
    <button type="button" {...props}>
      {loading ? 'loading' : children}
    </button>
  ),
  ColFlex: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  Combobox: ({
    onChange,
    options = [],
    value
  }: {
    onChange: (value: string) => void
    options?: { label: string; value: string; disabled?: boolean }[]
    value?: string
  }) => (
    <select aria-label="knowledge-base" onChange={(event) => onChange(event.target.value)} value={value ?? ''}>
      {options.map((option) => (
        <option key={option.value} disabled={option.disabled} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({
    children,
    closeOnOverlayClick,
    ...props
  }: React.ComponentProps<'div'> & { closeOnOverlayClick?: boolean }) => {
    void closeOnOverlayClick
    return <div {...props}>{children}</div>
  },
  DialogFooter: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  DialogHeader: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }: React.ComponentProps<'h2'>) => <h2 {...props}>{children}</h2>,
  Flex: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  HelpTooltip: () => null,
  Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label>
}))

import SaveToKnowledgePopup from '../SaveToKnowledgePopup'

function renderPopup(source: MessageExportView) {
  const promise = SaveToKnowledgePopup.show({ source: { type: 'message', data: source } })
  const rendered = mocks.TopView.show.mock.calls[0][0] as React.ReactNode

  render(<>{rendered}</>)
  return { promise }
}

function createFile(path: string, id: string): FileMetadata {
  return {
    id,
    name: `${id}.pdf`,
    origin_name: `${id}.pdf`,
    path,
    size: 1024,
    ext: '.pdf',
    type: 'document',
    created_at: '2026-05-27T00:00:00.000Z',
    count: 1
  }
}

function createMessageWithFiles(files: FileMetadata[]): MessageExportView {
  return {
    id: 'message-1',
    role: 'user',
    assistantId: 'assistant-1',
    topicId: 'topic-1',
    createdAt: '2026-05-27T00:00:00.000Z',
    status: 'success',
    parts: [],
    testFiles: files
  } as MessageExportView & { testFiles: FileMetadata[] }
}

describe('SaveToKnowledgePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    mocks.processMessageContent.mockImplementation((message: MessageExportView & { testFiles?: FileMetadata[] }) => ({
      text: '',
      files: message.testFiles ?? []
    }))
    ;(useKnowledgeBases as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      bases: [{ id: 'base-1', name: 'Knowledge Base', status: 'completed' }]
    })
    ;(useAddKnowledgeItems as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      submit: mocks.submitKnowledgeItems
    })
    mocks.submitKnowledgeItems.mockResolvedValue(undefined)
    Object.assign(window, {
      api: {
        file: {
          ensureExternalEntry: vi.fn()
        }
      },
      toast: mocks.toast
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves resolvable files and warns about failed files', async () => {
    const { promise } = renderPopup(
      createMessageWithFiles([createFile('/tmp/ok.pdf', 'ok'), createFile('bad.pdf', 'bad')])
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(mocks.submitKnowledgeItems).toHaveBeenCalledWith([
        {
          type: 'file',
          data: {
            source: '/tmp/ok.pdf',
            path: '/tmp/ok.pdf'
          }
        }
      ])
    )
    expect(mocks.toast.warning).toHaveBeenCalledWith('chat.save.knowledge.error.file_partial_failed:{"count":1}')

    await expect(promise).resolves.toEqual({ success: true, savedCount: 1 })
  })
})
