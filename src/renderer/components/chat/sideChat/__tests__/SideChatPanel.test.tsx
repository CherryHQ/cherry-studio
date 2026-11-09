import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { SideChatEventSchemas, SideChatView } from '@shared/ipc/schemas/sideChat'

import { SideChatProvider, useSideChatContext } from '../SideChatContext'
import { SideChatPanel } from '../SideChatPanel'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/components/chat/panes/Shell', () => ({ useRightPanelActions: () => ({ requestOpen: () => {} }) }))
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('provider::replacement')}>
      Choose replacement
    </button>
  )
}))

function OpenChat({ id }: { id: string }) {
  const context = useSideChatContext()!
  return (
    <button type="button" onClick={() => context.open(id)}>
      Open {id}
    </button>
  )
}

it('keeps drafts scoped across topics, configures only the side chat, and clears temporary content on removal', async () => {
  const listeners = new Map<string, (event: never) => void>()
  vi.mocked(window.api.ipcApi.on).mockImplementation((name, listener) => {
    listeners.set(name, listener)
    return () => listeners.delete(name)
  })
  const makeView = (id: string): SideChatView => ({
    topicId: id,
    sourceTopicId: `source-${id}`,
    revision: 0,
    mode: 'temporary',
    questionCount: 0,
    generating: false,
    omittedContext: [],
    messages: [],
    metadata: {
      config: { modelId: 'provider::initial', prompt: 'original' },
      snapshot: {
        messageId: `answer-${id}`,
        selection: `quote-${id}`,
        answer: `quote-${id}`,
        question: '',
        prefix: '',
        suffix: ''
      }
    }
  })
  const views = [makeView('a'), makeView('b')]
  const request = vi.mocked(window.api.ipcApi.request).mockImplementation(async (name, input) => {
    const args = input as { topicId?: string; sourceTopicId?: string; config?: SideChatView['metadata']['config'] }
    if (name === 'side_chat.list')
      return { ok: true, data: structuredClone(views.filter((v) => v.sourceTopicId === args.sourceTopicId)) }
    const view = views.find((v) => v.topicId === args.topicId)!
    if (name === 'side_chat.configure') {
      view.metadata.config = args.config!
      view.revision++
    }
    return { ok: true, data: structuredClone(view) }
  })
  const content = (id: string) => (
    <SideChatProvider sourceTopicId={`source-${id}`}>
      <OpenChat id={id} />
      <SideChatPanel />
    </SideChatProvider>
  )
  const ui = render(content('a'))
  fireEvent.click(await screen.findByText('Open a'))
  const input = await screen.findByLabelText('side_chat.question')
  fireEvent.change(input, { target: { value: 'private a' } })
  fireEvent.click(screen.getByText('Choose replacement'))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('side_chat.configure', {
      topicId: 'a',
      config: { modelId: 'provider::replacement', prompt: 'original' }
    })
  )
  ui.rerender(content('b'))
  fireEvent.click(await screen.findByText('Open b'))
  await waitFor(() => expect(screen.getByLabelText('side_chat.question')).toHaveValue(''))
  fireEvent.change(screen.getByLabelText('side_chat.question'), { target: { value: 'private b' } })
  ui.rerender(content('a'))
  await waitFor(() => expect(screen.getByLabelText('side_chat.question')).toHaveValue('private a'))
  const removal: SideChatEventSchemas['side_chat.changed'] = {
    topicId: 'a',
    sourceTopicId: 'source-a',
    revision: 5,
    view: null
  }
  act(() => listeners.get('side_chat.changed')!(removal as never))
  expect(screen.queryByLabelText('side_chat.question')).toBeNull()
  act(() => listeners.get('side_chat.changed')!({ ...removal, revision: 1, view: views[0] } as never))
  expect(screen.queryByText('quote-a')).toBeNull()
  ui.rerender(content('b'))
  await waitFor(() => expect(screen.getByLabelText('side_chat.question')).toHaveValue('private b'))
})
