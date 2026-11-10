import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import { CommandSharedPreferencesContext } from '@renderer/hooks/command'

import MessageGroup from '../list/MessageGroup'
import { MessageListProvider } from '../MessageListProvider'
import { DEFAULT_MESSAGE_LIST_CONFIG, defaultMessageRenderConfig, type MessageListProviderValue } from '../types'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../frame/MessageFrame', () => ({
  default: ({ message }: { message: { id: string } }) => (
    <div>
      <p>{message.id} reply</p>
      <div contentEditable suppressContentEditableWarning>
        Editable draft
      </div>
    </div>
  )
}))
vi.mock('../list/MessageGroupMenuBar', () => ({ default: () => null }))

function renderGrid() {
  const timestamp = '2026-10-21T00:00:00.000Z'
  const value: MessageListProviderValue = {
    state: {
      ...DEFAULT_MESSAGE_LIST_CONFIG,
      topic: {
        id: 'topic-1',
        name: 'Grid replies',
        assistantId: 'assistant-1',
        messages: [],
        isNameManuallyEdited: false,
        orderKey: 'a0',
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActivityAt: timestamp
      },
      messages: ['Model A', 'Model B'].map((id) => ({
        id,
        parentId: 'question-1',
        topicId: 'topic-1',
        role: 'assistant',
        status: 'success',
        createdAt: timestamp
      })),
      partsByMessageId: {},
      messageNavigation: 'none',
      renderConfig: { ...defaultMessageRenderConfig, multiModelMessageStyle: 'grid' }
    },
    actions: {},
    meta: { selectionLayer: false }
  }
  return render(
    <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
      <MessageListProvider value={value}>
        <SelectionContextMenu>
          <MessageGroup messages={value.state.messages} />
        </SelectionContextMenu>
      </MessageListProvider>
      <p>Unrelated content</p>
    </CommandSharedPreferencesContext>
  )
}

async function selectText(element: HTMLElement) {
  fireEvent(element, new MouseEvent('pointerdown', { button: 0, bubbles: true }))
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  fireEvent(element, new MouseEvent('pointerup', { button: 0, bubbles: true }))
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

describe('grid reply selection through a portal', () => {
  beforeEach(() => {
    window.getSelection()?.removeAllRanges()
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(100, 100, 180, 20)
    })
    window.api.quoteToMainWindow = vi.fn().mockResolvedValue(undefined)
  })

  it('copies and quotes expanded reply text while retaining the popup and excluding editable content', async () => {
    const user = userEvent.setup()
    renderGrid()
    await user.click(screen.getByText('Model A reply'))
    const expanded = await screen.findByRole('dialog')

    await selectText(within(expanded).getByText('Editable draft'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()

    const reply = within(expanded).getByText('Model A reply')
    await selectText(reply)
    await user.click(await screen.findByRole('button', { name: 'common.copy' }))
    expect(await navigator.clipboard.readText()).toBe('Model A reply')
    expect(window.getSelection()?.toString()).toBe('Model A reply')
    expect(expanded).toBeInTheDocument()

    await selectText(reply)
    await user.click(await screen.findByRole('button', { name: 'chat.message.quote' }))
    expect(window.api.quoteToMainWindow).toHaveBeenCalledWith('Model A reply')
    expect(expanded).toBeInTheDocument()

    await selectText(screen.getByText('Unrelated content'))
    expect(screen.queryByRole('button', { name: 'common.copy' })).not.toBeInTheDocument()
  })
})
