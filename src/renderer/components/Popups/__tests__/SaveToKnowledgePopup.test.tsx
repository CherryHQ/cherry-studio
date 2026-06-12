import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import type { FileMetadata } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
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

vi.mock('@renderer/components/TopView', () => ({
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
  analyzeMessageContent: (message: Message & { testFiles?: FileMetadata[] }) => ({
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
  analyzeTopicContent: vi.fn(),
  processMessageContent: mocks.processMessageContent,
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

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    Button: ({ children, loading, ...props }: React.ComponentProps<'button'> & { loading?: boolean }) => (
      <button type="button" {...props}>
        {loading ? 'loading' : children}
      </button>
    )
  }
})

async function renderPopup(source: Message) {
  const { default: SaveToKnowledgePopup } = await import('../SaveToKnowledgePopup')

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

function createMessageWithFiles(files: FileMetadata[]): Message {
  return {
    id: 'message-1',
    role: 'user',
    assistantId: 'assistant-1',
    topicId: 'topic-1',
    createdAt: '2026-05-27T00:00:00.000Z',
    status: 'success',
    blocks: files.map((file) => `${file.id}-block`),
    testFiles: files
  } as Message
}

describe('SaveToKnowledgePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    mocks.processMessageContent.mockImplementation((message: Message & { testFiles?: FileMetadata[] }) => ({
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
    const { promise } = await renderPopup(
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
