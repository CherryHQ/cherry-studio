import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import type * as CherryUi from '@cherrystudio/ui'
import type * as VirtualList from '@renderer/components/chat/messages/list/MessageVirtualList'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SideChatSource } from '@shared/data/types/sideChat'
import type { SideChatEventSchemas, SideChatView } from '@shared/ipc/schemas/sideChat'

import { SideChatProvider, useSideChatContext } from '../SideChatContext'
import { SideChatPanel } from '../SideChatPanel'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryUi>())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en-US', language: 'en-US' } })
}))
vi.mock('@renderer/components/chat/panes/Shell', () => ({ useRightPanelActions: () => ({ requestOpen: () => {} }) }))

// JSDOM has no layout: only virtual scrolling is replaced; message bodies and actions are real.
vi.mock('@renderer/components/chat/messages/list/MessageVirtualList', async (importActual) => ({
  ...(await importActual<typeof VirtualList>()),
  MessageVirtualList: ({
    items,
    renderItem
  }: {
    items: unknown[]
    renderItem: (item: unknown, index: number) => ReactNode
  }) => (
    <div>
      {items.map((item, index) => (
        <div key={index}>{renderItem(item, index)}</div>
      ))}
    </div>
  )
}))

const listeners = new Map<string, (event: never) => void>()
beforeEach(() => {
  vi.mocked(window.api.ipcApi.on).mockImplementation((name, listener) => {
    listeners.set(name, listener)
    return () => listeners.delete(name)
  })
})

function OpenChat({ id }: { id: string }) {
  const context = useSideChatContext()!
  return (
    <button type="button" onClick={() => context.open(id)}>
      Open {id}
    </button>
  )
}

function SelectQuote({ source }: { source: SideChatSource }) {
  const context = useSideChatContext()!
  return (
    <button type="button" onClick={() => context.openSource(source)}>
      Select quote
    </button>
  )
}

it.each([
  ['cross-topic', false],
  ['same-topic', false],
  ['existing', false],
  ['cross-topic', true],
  ['same-topic', true],
  ['existing', true]
] as const)('preserves a newer %s choice when an old create settles (failure: %s)', async (choice, fails) => {
  const source = (id: string): SideChatSource => ({
    topicId: id,
    messageId: `answer-${id}`,
    selection: 'selected quote'
  })
  const first = source(`qa2-${choice}-${fails}`)
  const next = choice === 'cross-topic' ? source(`${first.topicId}-next`) : first
  const view = (id: string, quote: SideChatSource): SideChatView => ({
    topicId: id,
    sourceTopicId: quote.topicId,
    revision: 1,
    mode: 'temporary',
    questionCount: 0,
    generating: false,
    omittedContext: [],
    messages: [],
    metadata: {
      config: { modelId: 'provider::current', prompt: '' },
      snapshot: {
        messageId: quote.messageId,
        selection: quote.selection!,
        answer: '',
        question: '',
        prefix: '',
        suffix: ''
      }
    }
  })
  const existing = view(`${first.topicId}-existing`, next)
  const responses: Array<(result: unknown) => void> = []
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (name) => {
    if (name === 'side_chat.list') return { ok: true, data: [] }
    if (name === 'side_chat.get') return { ok: true, data: existing }
    if (name === 'side_chat.create') return new Promise((resolve) => responses.push(resolve))
    return { ok: true, data: undefined }
  })
  const content = (quote: SideChatSource) => (
    <SideChatProvider sourceTopicId={quote.topicId} modelId="provider::current">
      <SelectQuote source={quote} />
      <OpenChat id={existing.topicId} />
      <SideChatPanel />
    </SideChatProvider>
  )
  const user = userEvent.setup()
  const ui = render(content(first))
  await user.click(screen.getByRole('button', { name: 'Select quote' }))
  await user.click(screen.getByRole('button', { name: 'side_chat.create' }))
  ui.rerender(content(next))
  if (choice === 'existing') {
    await user.click(screen.getByRole('button', { name: `Open ${existing.topicId}` }))
    await user.type(await screen.findByPlaceholderText('side_chat.question'), 'keep this draft')
  } else {
    await user.click(screen.getByRole('button', { name: 'Select quote' }))
    expect(screen.getByRole('button', { name: 'side_chat.create' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'side_chat.create' }))
  }
  await act(async () =>
    responses[0](
      fails
        ? { ok: false, error: { code: 'side_chat_model_unavailable', message: 'unavailable' } }
        : { ok: true, data: view(`${first.topicId}-old`, first) }
    )
  )
  expect(screen.queryByRole('alert')).toBeNull()
  if (choice === 'existing') {
    expect(screen.getByPlaceholderText('side_chat.question')).toHaveValue('keep this draft')
  } else {
    expect(screen.getByRole('button', { name: 'side_chat.create' })).toBeDisabled()
    expect(screen.queryByPlaceholderText('side_chat.question')).toBeNull()
    await act(async () => responses[1]({ ok: true, data: view(`${first.topicId}-new`, next) }))
    expect(await screen.findByPlaceholderText('side_chat.question')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'side_chat.create' })).toBeNull()
  }
})

it('keeps drafts scoped across topics, follows the current model, and clears temporary content on removal', async () => {
  const makeView = (id: string): SideChatView => ({
    topicId: id,
    sourceTopicId: `source-${id}`,
    revision: 0,
    mode: 'temporary',
    questionCount: 0,
    generating: false,
    omittedContext: [],
    messages: [
      {
        id: `question-${id}`,
        topicId: id,
        parentId: null,
        role: 'user',
        data: { parts: [{ type: 'text', text: `question ${id}` }] },
        searchableText: '',
        status: 'success',
        siblingsGroupId: 0,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z'
      },
      {
        id: `reply-${id}`,
        topicId: id,
        parentId: `question-${id}`,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: `**answer ${id}**` }] },
        searchableText: '',
        status: 'success',
        siblingsGroupId: 0,
        createdAt: '2026-11-10T00:00:01.000Z',
        updatedAt: '2026-11-10T00:00:01.000Z'
      }
    ],
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
  let failSend = false
  const request = vi.mocked(window.api.ipcApi.request).mockImplementation(async (name, input) => {
    const args = input as { topicId?: string; sourceTopicId?: string; config?: SideChatView['metadata']['config'] }
    if (name === 'side_chat.list')
      return { ok: true, data: structuredClone(views.filter((v) => v.sourceTopicId === args.sourceTopicId)) }
    const view = views.find((v) => v.topicId === args.topicId)!
    if (name === 'side_chat.submit' && failSend)
      return { ok: false, error: { code: 'side_chat_model_unavailable', message: 'model unavailable' } }
    return { ok: true, data: structuredClone(view) }
  })
  const content = (id: string, modelId: UniqueModelId | undefined = 'provider::current') => (
    <SideChatProvider sourceTopicId={`source-${id}`} modelId={modelId}>
      <OpenChat id={id} />
      <SideChatPanel />
    </SideChatProvider>
  )
  const user = userEvent.setup()
  const ui = render(content('a'))
  fireEvent.click(await screen.findByText('Open a'))
  const input = await screen.findByPlaceholderText('side_chat.question')
  fireEvent.change(input, { target: { value: 'private a' } })
  expect(screen.queryByText('side_chat.save_default')).toBeNull()
  expect(screen.queryByText('side_chat.prompt')).toBeNull()
  ui.rerender(content('a', 'provider::replacement'))
  await user.click((await screen.findAllByRole('button', { name: 'common.regenerate' }))[0])
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('side_chat.retry', {
      topicId: 'a',
      questionId: 'question-a',
      modelId: 'provider::replacement'
    })
  )
  expect(await screen.findByText('answer a')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'side_chat.create' })).toBeNull()
  failSend = true
  await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('code.model_required')
  expect(request).toHaveBeenCalledWith('side_chat.submit', {
    topicId: 'a',
    text: 'private a',
    modelId: 'provider::replacement'
  })
  expect(screen.getByPlaceholderText('side_chat.question')).toHaveValue('private a')
  expect(request.mock.calls.some(([name]) => name === 'side_chat.configure')).toBe(false)
  failSend = false
  await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
  await waitFor(() => expect(screen.getByPlaceholderText('side_chat.question')).toHaveValue(''))
  fireEvent.change(screen.getByPlaceholderText('side_chat.question'), { target: { value: 'private a' } })
  ui.rerender(content('b'))
  fireEvent.click(await screen.findByText('Open b'))
  await waitFor(() => expect(screen.getByPlaceholderText('side_chat.question')).toHaveValue(''))
  fireEvent.change(screen.getByPlaceholderText('side_chat.question'), { target: { value: 'private b' } })
  ui.rerender(content('a'))
  await waitFor(() => expect(screen.getByPlaceholderText('side_chat.question')).toHaveValue('private a'))
  const removal: SideChatEventSchemas['side_chat.changed'] = {
    topicId: 'a',
    sourceTopicId: 'source-a',
    revision: 5,
    view: null
  }
  act(() => listeners.get('side_chat.changed')!(removal as never))
  expect(screen.queryByPlaceholderText('side_chat.question')).toBeNull()
  act(() => listeners.get('side_chat.changed')!({ ...removal, revision: 1, view: views[0] } as never))
  expect(screen.queryByText('quote-a')).toBeNull()
  ui.rerender(content('b'))
  await waitFor(() => expect(screen.getByPlaceholderText('side_chat.question')).toHaveValue('private b'))
})
