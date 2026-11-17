import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'

import { MessageListProvider } from '../../MessageListProvider'
import {
  DEFAULT_MESSAGE_LIST_CONFIG,
  defaultMessageRenderConfig,
  type MessageListItem,
  type MessageListState
} from '../../types'
import MessageGroupMenuBar from '../MessageGroupMenuBar'
import MessageGroupModelList from '../MessageGroupModelList'

vi.mock('@cherrystudio/ui', async (original) => original<typeof Ui>())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'message.message.multi_model_style.fold.expand': 'Switch to expanded tabs',
          'message.message.multi_model_style.fold.compress': 'Switch to compact tabs'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

const messages: MessageListItem[] = ['glm-5', 'gpt-5'].map((name) => ({
  id: name,
  role: 'assistant',
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success',
  model: { id: name, name, provider: 'p' }
}))

function FoldGroup() {
  const [renderConfig, updateRenderConfig] = useState(defaultMessageRenderConfig)
  return (
    <MessageListProvider
      value={{
        state: {
          ...DEFAULT_MESSAGE_LIST_CONFIG,
          topic: { id: 'topic-1' } as MessageListState['topic'],
          messageNavigation: '',
          messages,
          partsByMessageId: {},
          renderConfig
        },
        actions: {
          updateRenderConfig: (updates) => updateRenderConfig((config) => ({ ...config, ...updates }))
        },
        meta: { selectionLayer: false }
      }}>
      <MessageGroupMenuBar
        multiModelMessageStyle="fold"
        setMultiModelMessageStyle={() => {}}
        messages={messages}
        selectMessageId="glm-5"
        setSelectedMessage={() => {}}
      />
    </MessageListProvider>
  )
}

it('updates fold tab names when the display toggle changes the list configuration', async () => {
  const user = userEvent.setup()
  render(<FoldGroup />)
  expect(screen.getByText('gpt-5')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Switch to compact tabs' }))
  expect(screen.queryByText('gpt-5')).not.toBeInTheDocument()
  expect(screen.getByText('glm-5')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Switch to expanded tabs' }))
  expect(screen.getByText('gpt-5')).toBeVisible()
})

it('keeps compact replies identifiable on hover and selectable', async () => {
  const user = userEvent.setup()
  const setSelectedMessage = vi.fn()
  render(
    <MessageGroupModelList
      messages={messages}
      selectMessageId="glm-5"
      setSelectedMessage={setSelectedMessage}
      displayMode="compact"
    />
  )

  const selectedTab = screen.getByRole('radio', { name: 'glm-5' })
  expect(selectedTab).toHaveAttribute('aria-checked', 'true')

  const unselectedTab = screen.getAllByRole('radio')[1]
  expect(within(unselectedTab).queryByText('gpt-5')).not.toBeInTheDocument()
  await user.hover(within(unselectedTab).getByTestId('model-avatar'))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('gpt-5')
  await user.click(unselectedTab)
  expect(setSelectedMessage).toHaveBeenCalledWith(messages[1])
})
