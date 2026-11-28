import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { MouseEvent, ReactElement, ReactNode, RefObject } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceService } from '@data/PreferenceService'
import en from '@renderer/i18n/locales/en-us.json'
import { messageProjectionService } from '@renderer/services/aiTransport'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart } from '@shared/data/types/message'

import { useMessageExportActions } from '../../hooks/useMessageExportActions'
import { MessageListProvider } from '../../MessageListProvider'
import {
  defaultMessageMenuConfig,
  defaultMessageRenderConfig,
  type MessageListItem,
  type MessageListProviderValue
} from '../../types'
import MessageMenuBar from '../MessageMenuBar'

vi.mock('@cherrystudio/ui', (importOriginal) => importOriginal())

vi.mock('@renderer/components/command', async () => {
  const React = await import('react')

  type ExtraMenuItem = {
    id: string
    type?: string
    label?: ReactNode
    onSelect?: () => void
    children?: ExtraMenuItem[]
  }

  function renderExtraItems(items: ExtraMenuItem[], close: () => void): ReactNode {
    return items.map((item) => {
      if (item.children?.length) {
        return (
          <div key={item.id}>
            <span>{item.label}</span>
            {renderExtraItems(item.children, close)}
          </div>
        )
      }
      if (!item.label) return null
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            close()
            item.onSelect?.()
          }}>
          {item.label}
        </button>
      )
    })
  }

  return {
    CommandPopupMenu: ({
      children,
      extraItems = [],
      onOpenChange
    }: {
      children: ReactNode
      extraItems?: ExtraMenuItem[]
      onOpenChange?: (open: boolean) => void
    }) => {
      const [open, setOpen] = React.useState(false)
      const child = React.isValidElement<{ onClick?: (event: MouseEvent) => void }>(children) ? children : null
      const close = () => {
        setOpen(false)
        onOpenChange?.(false)
      }
      const trigger = child
        ? // eslint-disable-next-line @eslint-react/no-clone-element -- Mirrors CommandPopupMenu's asChild trigger path.
          React.cloneElement(child as ReactElement<{ onClick?: (event: MouseEvent) => void }>, {
            onClick: (event: MouseEvent) => {
              child.props.onClick?.(event)
              setOpen(true)
              onOpenChange?.(true)
            }
          })
        : children

      return (
        <>
          {trigger}
          {open && <div role="menu">{renderExtraItems(extraItems, close)}</div>}
        </>
      )
    }
  }
})

const i18n = createInstance()

beforeAll(async () => {
  await i18n.init({
    lng: 'en-US',
    load: 'currentOnly',
    keySeparator: false,
    resources: { 'en-US': { translation: en } },
    interpolation: { escapeValue: false }
  })
})

function MenuBarExportHarness({
  topicId,
  message,
  parts
}: {
  topicId: string
  message: MessageListItem
  parts: CherryMessagePart[]
}) {
  const exportActions = useMessageExportActions({
    topicName: 'Export Topic',
    exportToObsidian: vi.fn()
  })
  const value: MessageListProviderValue = {
    state: {
      topic: { id: topicId, name: 'Export Topic', messages: [] } as unknown as Topic,
      messages: [message],
      partsByMessageId: { [message.id]: parts },
      hasOlder: false,
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig,
      selection: { enabled: false, isMultiSelectMode: false, selectedMessageIds: [] },
      menuConfig: {
        ...defaultMessageMenuConfig,
        exportMenuOptions: {
          ...defaultMessageMenuConfig.exportMenuOptions,
          markdown: true,
          markdown_reason: true
        }
      },
      getMessageUiState: () => ({}),
      translationLanguages: []
    },
    actions: {
      ...exportActions,
      copyText: vi.fn()
    },
    meta: { selectionLayer: false }
  }

  return (
    <I18nextProvider i18n={i18n}>
      <MessageListProvider value={value}>
        <MessageMenuBar
          message={message}
          isLastMessage
          forceVisible
          isAssistantMessage
          isProcessing={false}
          messageContainerRef={{ current: null } as unknown as RefObject<HTMLDivElement>}
        />
      </MessageListProvider>
    </I18nextProvider>
  )
}

async function selectExportMenuOption(optionLabel: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: en['chat.message.more'] }))
  await user.click(await screen.findByRole('button', { name: optionLabel }))
}

describe('MessageMenuBar Markdown export', () => {
  const saveFile = vi.fn<typeof window.api.file.save>(async (fileName) => `/tmp/${fileName}`)

  beforeEach(async () => {
    saveFile.mockClear()
    window.api.file.save = saveFile
    await preferenceService.set('menu.presentation_mode', 'cherry')
    await preferenceService.set('data.export.markdown.path', '')
    await preferenceService.set('data.export.markdown.use_topic_naming_for_message_title', false)
    await preferenceService.set('data.export.markdown.force_dollar_math', false)
    await preferenceService.set('data.export.markdown.show_model_name', false)
    await preferenceService.set('data.export.markdown.show_model_provider', false)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('includes Work mode reasoning when exporting with reasoning and omits it for standard Markdown', async () => {
    const ipc = projectionIpc()
    const target = { kind: 'topic', topicId: 'agent_session_session-1' } as const
    const release = messageProjectionService.subscribe(target, () => {})
    try {
      const attachment = ipc.attachments[0]
      attachment.resolve({
        kind: 'topic',
        topicId: target.topicId,
        revision: 0,
        executions: [],
        messages: [{ id: 'assistant-work-1', role: 'assistant', parts: [], partIds: [] }]
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      ipc.emit(attachment.subscriptionId, {
        kind: 'topic',
        type: 'parts',
        revision: 1,
        patches: [
          { type: 'part-open', messageId: 'assistant-work-1', partId: 'reason-1', kind: 'reasoning', pos: 1 },
          { type: 'part-append', partId: 'reason-1', text: 'Step-by-step work reasoning' },
          { type: 'part-finish', partId: 'reason-1' },
          { type: 'part-open', messageId: 'assistant-work-1', partId: 'text-1', kind: 'text', pos: 2 },
          { type: 'part-append', partId: 'text-1', text: 'Work mode answer' },
          { type: 'part-finish', partId: 'text-1' }
        ]
      })

      const shellParts = messageProjectionService.getSnapshot(target).view!.messages[0].parts
      const message: MessageListItem = {
        id: 'assistant-work-1',
        role: 'assistant',
        topicId: target.topicId,
        parentId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success'
      }

      render(<MenuBarExportHarness topicId={target.topicId} message={message} parts={shellParts} />)

      await selectExportMenuOption(en['chat.topics.export.md.reason'])
      await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
      const withReasoningMarkdown = saveFile.mock.calls[0]?.[1]
      expect(withReasoningMarkdown).toContain('<details')
      expect(withReasoningMarkdown).toContain('<summary>')
      expect(withReasoningMarkdown).toContain('Step-by-step work reasoning')
      expect(withReasoningMarkdown).toContain('Work mode answer')

      await selectExportMenuOption(en['chat.topics.export.md.label'])
      await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2))
      const standardMarkdown = saveFile.mock.calls[1]?.[1]
      expect(standardMarkdown).not.toContain('<details')
      expect(standardMarkdown).not.toContain('Step-by-step work reasoning')
      expect(standardMarkdown).toContain('Work mode answer')
    } finally {
      release()
    }
  })

  it('preserves Chat mode Markdown export behavior with and without reasoning', async () => {
    const message: MessageListItem = {
      id: 'assistant-chat-1',
      role: 'assistant',
      topicId: 'topic-1',
      parentId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    }
    const parts: CherryMessagePart[] = [
      { type: 'reasoning', text: 'Chat mode reasoning', state: 'done' },
      { type: 'text', text: 'Chat mode answer', state: 'done' }
    ]

    render(<MenuBarExportHarness topicId="topic-1" message={message} parts={parts} />)

    await selectExportMenuOption(en['chat.topics.export.md.reason'])
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    const withReasoningMarkdown = saveFile.mock.calls[0]?.[1]
    expect(withReasoningMarkdown).toContain('Chat mode reasoning')
    expect(withReasoningMarkdown).toContain('Chat mode answer')

    await selectExportMenuOption(en['chat.topics.export.md.label'])
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2))
    const standardMarkdown = saveFile.mock.calls[1]?.[1]
    expect(standardMarkdown).not.toContain('Chat mode reasoning')
    expect(standardMarkdown).toContain('Chat mode answer')
  })
})
