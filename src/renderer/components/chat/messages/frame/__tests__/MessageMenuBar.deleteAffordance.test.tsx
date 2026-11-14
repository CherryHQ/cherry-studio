import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { RefObject } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { Topic } from '@renderer/types/topic'

import { MessageListProvider } from '../../MessageListProvider'
import {
  defaultMessageMenuConfig,
  defaultMessageRenderConfig,
  type MessageListActions,
  type MessageListItem,
  type MessageListProviderValue
} from '../../types'
import MessageMenuBar from '../MessageMenuBar'

vi.mock('@cherrystudio/ui', (importOriginal) => importOriginal())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

vi.mock('@renderer/services/ExportService', () => ({
  exportService: { captureScrollableAsBlob: vi.fn(), captureScrollableAsDataUrl: vi.fn() },
  getMessageTitle: vi.fn(),
  messageToMarkdown: vi.fn()
}))

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
afterEach(cleanup)

const canDeleteMessage = (message: MessageListItem) => message.role !== 'assistant'

function renderToolbar(
  role: MessageListItem['role'],
  policy?: MessageListActions['canDeleteMessage'],
  confirm = false
) {
  const message: MessageListItem = {
    id: `${role}-1`,
    role,
    topicId: 'topic-1',
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success'
  }
  const deleteMessage = vi.fn().mockResolvedValue(undefined)
  const actions: MessageListActions = { deleteMessage, canDeleteMessage: policy, copyText: vi.fn() }
  const value: MessageListProviderValue = {
    state: {
      topic: { id: 'topic-1', name: 'Topic', messages: [] } as unknown as Topic,
      messages: [message],
      partsByMessageId: { [message.id]: [{ type: 'text', text: 'hello' }] },
      hasOlder: false,
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig,
      selection: { enabled: false, isMultiSelectMode: false, selectedMessageIds: [] },
      menuConfig: { ...defaultMessageMenuConfig, confirmDeleteMessage: confirm },
      getMessageUiState: () => ({}),
      translationLanguages: []
    },
    actions,
    meta: { selectionLayer: false }
  }
  render(
    <I18nextProvider i18n={i18n}>
      <MessageListProvider value={value}>
        <MessageMenuBar
          message={message}
          isLastMessage
          forceVisible
          isAssistantMessage={role === 'assistant'}
          isProcessing={false}
          messageContainerRef={{ current: null } as unknown as RefObject<HTMLDivElement>}
        />
      </MessageListProvider>
    </I18nextProvider>
  )
  return { deleteMessage, message, actions }
}

describe('MessageMenuBar delete affordance', () => {
  it('offers no Delete button for a completed Agent assistant reply while keeping Copy', () => {
    const { actions, deleteMessage } = renderToolbar('assistant', canDeleteMessage)
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
    expect(actions.deleteMessage).toBe(deleteMessage)
  })

  it('keeps enabled Delete for an Agent user message and deletes that id once without confirmation', async () => {
    const user = userEvent.setup()
    const { deleteMessage, message } = renderToolbar('user', canDeleteMessage)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() => expect(deleteMessage).toHaveBeenCalledExactlyOnceWith(message.id, { modelName: undefined }))
  })

  it('keeps enabled Delete for a completed Home-like assistant reply without a predicate', () => {
    renderToolbar('assistant')
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('confirms user deletion with the real dialog, preserving cancellation and accepting confirmation', async () => {
    const user = userEvent.setup()
    const { deleteMessage, message } = renderToolbar('user', canDeleteMessage, true)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(deleteMessage).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteMessage).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteMessage).toHaveBeenCalledExactlyOnceWith(message.id, { modelName: undefined }))
  })
})
