import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { mockUseSharedCacheSelector } from '@test-mocks/renderer/useCache'
import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { mockUsePreference } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type * as CherryUi from '@cherrystudio/ui'
import type * as VirtualList from '@renderer/components/chat/messages/list/MessageVirtualList'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { ModelSchema, type UniqueModelId } from '@shared/data/types/model'
import type { SideChatSource } from '@shared/data/types/sideChat'
import type { SideChatEventSchemas, SideChatView } from '@shared/ipc/schemas/sideChat'

import { SideChatProvider, useSideChatContext } from '../SideChatContext'
import { SideChatPanel } from '../SideChatPanel'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryUi>())

vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'en-US', language: 'en-US', exists: () => true }
  }
  return { useTranslation: () => translation }
})
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
const defaultQuery = mockUseQuery.getMockImplementation()!
const defaultMutation = mockUseMutation.getMockImplementation()!
const defaultPreference = mockUsePreference.getMockImplementation()!
const defaultSelector = mockUseSharedCacheSelector.getMockImplementation()!
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
beforeEach(() => {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() }
  })
  // Match production's stable cache results and callbacks so launcher effects can settle.
  const selections = new WeakMap<object, unknown>()
  mockUseSharedCacheSelector.mockImplementation((keys, selector) => {
    if (!selections.has(selector)) selections.set(selector, defaultSelector(keys, selector))
    return selections.get(selector) as ReturnType<typeof selector>
  })
  const mutations = new Map<string, ReturnType<typeof defaultMutation>>()
  mockUseMutation.mockImplementation((method, path, options) => {
    const key = `${method}:${path}`
    if (!mutations.has(key)) mutations.set(key, defaultMutation(method, path, options))
    return mutations.get(key)!
  })
  const preferenceSetters = new Map<string, ReturnType<typeof defaultPreference>[1]>()
  mockUsePreference.mockImplementation((key, options) => {
    const [value, setter] = defaultPreference(key, options)
    if (!preferenceSetters.has(key)) preferenceSetters.set(key, setter)
    return [value, preferenceSetters.get(key)!]
  })
  const models = ['initial', 'current', 'replacement'].map((id) =>
    ModelSchema.parse({
      id: `provider::${id}`,
      providerId: 'provider',
      name: 'Current model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })
  )
  const queries = new Map<string, ReturnType<typeof defaultQuery>>()
  mockUseQuery.mockImplementation((path, options) => {
    const key = JSON.stringify([path, options])
    if (!queries.has(key)) {
      const result = defaultQuery(path, options)
      queries.set(
        key,
        path.startsWith('/models/') && options?.enabled !== false
          ? { ...result, data: models.find((model) => path === `/models/${model.id}`) }
          : result
      )
    }
    return queries.get(key)!
  })
  for (const [key, value] of Object.entries(DefaultPreferences.default)) {
    mockPreferenceState.set(key, value)
  }
  vi.mocked(window.api.ipcApi.on).mockImplementation((name, listener) => {
    listeners.set(name, listener)
    return () => listeners.delete(name)
  })
})

afterEach(() => {
  for (const [key, descriptor] of [
    ['getClientRects', rangeRects],
    ['getBoundingClientRect', rangeBounds]
  ] as const) {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor)
    else Reflect.deleteProperty(Range.prototype, key)
  }
})

function OpenChat({ id }: { id: string }) {
  const context = useSideChatContext()!
  return (
    <button type="button" onClick={() => context.open(id)}>
      Open {id}
    </button>
  )
}

function composerInput() {
  const input = document.querySelector<HTMLElement>('[data-ui~="part:composer-input"] [contenteditable="true"]')
  expect(input).not.toBeNull()
  return input!
}

async function typeQuestion(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await waitFor(composerInput)
  // JSDOM has no hit testing; place the caret with the DOM selection API.
  act(() => {
    input.focus()
    const range = document.createRange()
    range.selectNodeContents(input)
    range.collapse(true)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  })
  await user.paste(text)
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
  const request = vi.mocked(window.api.ipcApi.request).mockImplementation(async (name, input) => {
    if (name === 'side_chat.list') return { ok: true, data: [] }
    if (name === 'side_chat.get') return { ok: true, data: existing }
    if (name === 'side_chat.create') return new Promise((resolve) => responses.push(resolve))
    if (name === 'side_chat.submit') {
      const { topicId } = input as { topicId: string }
      return { ok: true, data: view(topicId, topicId.endsWith('-old') ? first : next) }
    }
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
  expect(screen.queryByRole('button', { name: 'side_chat.create' })).toBeNull()
  await waitFor(() =>
    expect(document.querySelector('[data-ui~="chat.composer"] [data-composer-token-kind="quote"]')).toHaveTextContent(
      'selection.action.builtin.quote'
    )
  )
  expect(responses).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
  await waitFor(() => expect(responses).toHaveLength(1))
  ui.rerender(content(next))
  if (choice === 'existing') {
    await user.click(screen.getByRole('button', { name: `Open ${existing.topicId}` }))
    await typeQuestion(user, 'keep this draft')
  } else {
    await user.click(screen.getByRole('button', { name: 'Select quote' }))
    expect(screen.getByRole('button', { name: 'chat.input.send' })).toHaveAttribute('aria-disabled', 'false')
    await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
    await waitFor(() => expect(responses).toHaveLength(2))
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
    expect(composerInput()).toHaveTextContent('keep this draft')
  } else {
    expect(screen.getByRole('button', { name: 'chat.input.send' })).toHaveAttribute('aria-disabled', 'true')
    await act(async () => responses[1]({ ok: true, data: view(`${first.topicId}-new`, next) }))
    expect(await waitFor(composerInput)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'side_chat.create' })).toBeNull()
    expect(request).toHaveBeenCalledWith('side_chat.submit', {
      topicId: `${first.topicId}-new`,
      text: '<blockquote>\n\nselected quote\n</blockquote> ',
      parts: [expect.objectContaining({ type: 'text', text: '<blockquote>\n\nselected quote\n</blockquote> ' })],
      turnOptions: {
        reasoningEffort: 'default',
        serviceTier: 'standard',
        fastMode: false,
        sideChat: { permissionMode: 'default', skills: [] }
      },
      modelId: 'provider::current',
      composer: {
        version: 1,
        tokens: [expect.objectContaining({ kind: 'quote', description: 'selected quote', textOffset: 0 })]
      }
    })
  }
})

it('keeps the quoted question after a failed first send and reuses the created conversation', async () => {
  const source: SideChatSource = { topicId: 'first-send', messageId: 'answer', selection: 'selected words' }
  const view: SideChatView = {
    topicId: 'first-send-side',
    sourceTopicId: source.topicId,
    revision: 1,
    mode: 'temporary',
    questionCount: 0,
    generating: false,
    omittedContext: [],
    messages: [],
    metadata: {
      config: { modelId: 'provider::current', prompt: '' },
      snapshot: { messageId: 'answer', selection: 'selected words', answer: '', question: '', prefix: '', suffix: '' }
    }
  }
  let failSend = true
  const request = vi.mocked(window.api.ipcApi.request).mockImplementation(async (name) => {
    if (name === 'side_chat.list') return { ok: true, data: [] }
    if (name === 'side_chat.submit' && failSend)
      return { ok: false, error: { code: 'side_chat_model_unavailable', message: 'unavailable' } }
    return { ok: true, data: view }
  })
  const user = userEvent.setup()
  const { container } = render(
    <SideChatProvider sourceTopicId={source.topicId} modelId="provider::current">
      <SelectQuote source={source} />
      <SideChatPanel />
    </SideChatProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Select quote' }))
  await waitFor(() => expect(container.querySelector('[data-composer-token-kind="quote"]')).toBeInTheDocument())
  const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')!
  await typeQuestion(user, 'Explain this')
  await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('common.detail')
  expect(editor).toHaveTextContent('Explain this')
  expect(container.querySelector('[data-composer-token-kind="quote"]')).toBeInTheDocument()
  failSend = false
  await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(request.mock.calls.filter(([name]) => name === 'side_chat.create')).toHaveLength(1)
  expect(request).toHaveBeenLastCalledWith(
    'side_chat.submit',
    expect.objectContaining({
      topicId: view.topicId,
      modelId: 'provider::current',
      text: 'Explain this<blockquote>\n\nselected words\n</blockquote> ',
      composer: {
        version: 1,
        tokens: [expect.objectContaining({ kind: 'quote', description: 'selected words', textOffset: 12 })]
      }
    })
  )
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
  await typeQuestion(user, 'private a')
  expect(screen.queryByText('side_chat.save_default')).toBeNull()
  expect(screen.queryByText('side_chat.prompt')).toBeNull()
  ui.rerender(content('a', 'provider::replacement'))
  expect(await screen.findByText('answer a')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.regenerate' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'side_chat.create' })).toBeNull()
  failSend = true
  await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('common.detail')
  expect(request).toHaveBeenCalledWith(
    'side_chat.submit',
    expect.objectContaining({
      topicId: 'a',
      text: 'private a',
      modelId: 'provider::replacement'
    })
  )
  expect(composerInput()).toHaveTextContent('private a')
  expect(request.mock.calls.some(([name]) => name === 'side_chat.configure')).toBe(false)
  failSend = false
  await user.click(screen.getByRole('button', { name: 'chat.input.send' }))
  await waitFor(() => expect(composerInput()).toHaveTextContent(/^$/))
  await typeQuestion(user, 'private a')
  ui.rerender(content('b'))
  fireEvent.click(await screen.findByText('Open b'))
  await waitFor(() => expect(composerInput()).toHaveTextContent(/^$/))
  await typeQuestion(user, 'private b')
  ui.rerender(content('a'))
  await waitFor(() => expect(composerInput()).toHaveTextContent('private a'))
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
  await waitFor(() => expect(composerInput()).toHaveTextContent('private b'))
})
