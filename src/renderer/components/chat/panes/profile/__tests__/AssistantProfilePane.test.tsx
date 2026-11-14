import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'

import { AssistantProfilePane } from '../AssistantProfilePane'
import { recordEditDialogRequests, renderInRightPane, serveQueries } from './profilePaneTestUtils'

const fetchGenerate = vi.hoisted(() => vi.fn<(input: { prompt: string; content: string }) => Promise<string>>())
vi.mock('@renderer/utils/aiGeneration', () => ({ fetchGenerate }))

const nextModel = vi.hoisted(
  () => ({ id: 'openai::gpt-5.2', providerId: 'openai', name: 'GPT-5.2', capabilities: [] }) as unknown as Model
)

// The real selector loads providers and models; picking one is all the pane needs from it.
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger, onSelect }: { trigger: ReactNode; onSelect: (model: Model) => void }) => (
    <>
      {trigger}
      <button type="button" onClick={() => onSelect(nextModel)}>
        Pick GPT-5.2
      </button>
    </>
  )
}))

const knowledgeBase = (id: string, name: string, itemCount: number) => ({ id, name, itemCount })

const assistant = {
  id: 'assistant-1',
  name: 'Writing Assistant',
  emoji: '✍️',
  description: 'Turns scattered ideas into a clean draft',
  prompt: 'You are a writing assistant.',
  modelId: null,
  modelName: 'GPT-5.1',
  knowledgeBaseIds: [],
  mcpServerIds: [],
  settings: { enableBrowser: true }
} as unknown as Assistant

describe('AssistantProfilePane', () => {
  let dialog: ReturnType<typeof recordEditDialogRequests>

  beforeEach(async () => {
    MockUseDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseCacheUtils.resetMocks()
    fetchGenerate.mockReset()
    await i18n.changeLanguage('en-US')
    serveQueries({ '/assistants/:id': ({ params }) => (params?.id === assistant.id ? assistant : undefined) })
    dialog = recordEditDialogRequests()
  })

  afterEach(() => dialog.stop())

  it('shows who the Assistant is', () => {
    renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)

    expect(screen.getByRole('heading', { name: 'Writing Assistant' })).toBeInTheDocument()
    expect(screen.getByText('Turns scattered ideas into a clean draft')).toBeInTheDocument()
  })

  it('lists only the knowledge bases linked to this Assistant, in its order, and manages them in the edit dialog', async () => {
    MockUseDataApiUtils.seedInfiniteQuery(
      '/knowledge-bases',
      [
        {
          items: [
            knowledgeBase('kb-brand', 'Brand guide', 12),
            knowledgeBase('kb-other', 'Another team wiki', 40),
            knowledgeBase('kb-style', 'Style rules', 1)
          ],
          nextCursor: undefined
        }
      ] as never,
      { query: { sortBy: 'orderKey', sortOrder: 'asc' }, limit: KNOWLEDGE_BASES_MAX_LIMIT }
    )
    serveQueries({
      '/assistants/:id': () => ({ ...assistant, knowledgeBaseIds: ['kb-style', 'kb-brand'] })
    })
    renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)
    const section = screen.getByRole('region', { name: 'Knowledge bases' })

    expect(
      within(section)
        .getAllByText(/Brand guide|Style rules|Another team wiki/)
        .map((node) => node.textContent)
    ).toEqual(['Style rules', 'Brand guide'])
    expect(within(section).getByText('12 docs')).toBeInTheDocument()

    fireEvent.click(within(section).getByRole('button', { name: 'Manage' }))
    await waitFor(() =>
      expect(dialog.requests).toEqual([{ kind: 'assistant', id: assistant.id, initialTab: 'tools.knowledge' }])
    )
  })

  it('leaves out the knowledge base section when none is linked', () => {
    renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)

    expect(screen.queryByRole('region', { name: 'Knowledge bases' })).toBeNull()
  })

  describe('settings', () => {
    let patches: unknown[]
    let save: Mock<(args: { body: unknown }) => Promise<Assistant>>

    beforeEach(() => {
      patches = []
      save = vi.fn(async ({ body }: { body: unknown }) => {
        patches.push(body)
        return assistant
      })
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/assistants/:id', save)
    })

    const settingsRegion = () => {
      renderInRightPane(<AssistantProfilePane assistantId={assistant.id} />)
      return screen.getByRole('region', { name: 'Settings' })
    }

    it('opens the edit dialog from All', async () => {
      fireEvent.click(within(settingsRegion()).getByRole('button', { name: 'All' }))

      await waitFor(() => expect(dialog.requests).toEqual([{ kind: 'assistant', id: assistant.id }]))
    })

    it('changes the model and the browser in place', async () => {
      const settings = settingsRegion()

      fireEvent.click(within(settings).getByRole('button', { name: 'Pick GPT-5.2' }))
      fireEvent.click(within(settings).getByRole('switch', { name: 'Browser' }))

      await waitFor(() => expect(patches).toHaveLength(2))
      expect(patches[0]).toMatchObject({ modelId: 'openai::gpt-5.2' })
      expect(patches[1]).toEqual({ settings: { enableBrowser: false } })
      expect(dialog.requests).toEqual([])
    })

    it('saves the reply language chosen from the list, starting from no constraint', async () => {
      const settings = settingsRegion()
      expect(within(settings).getByRole('button', { name: 'Reply language' })).toBeInTheDocument()

      fireEvent.click(within(settings).getByRole('button', { name: 'Deutsch' }))
      fireEvent.click(within(settings).getByRole('button', { name: /^Follow global/ }))

      await waitFor(() =>
        expect(patches).toEqual([
          { settings: { replyLanguage: { mode: 'custom', language: 'Deutsch' } } },
          { settings: { replyLanguage: { mode: 'inherit' } } }
        ])
      )
    })

    it('saves another language once its input loses focus, not while typing', async () => {
      const settings = settingsRegion()

      fireEvent.click(within(settings).getByRole('button', { name: 'Other language…' }))
      const input = within(settings).getByRole('textbox')
      fireEvent.change(input, { target: { value: '  Svenska ' } })
      expect(patches).toEqual([])

      fireEvent.blur(input)
      await waitFor(() =>
        expect(patches).toEqual([{ settings: { replyLanguage: { mode: 'custom', language: 'Svenska' } } }])
      )
    })

    it('tells the user when a change could not be saved', async () => {
      save.mockRejectedValue(new Error('offline'))

      fireEvent.click(within(settingsRegion()).getByRole('switch', { name: 'Browser' }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Save failed'))
    })
  })

  it("shows this Assistant's usage and recent topics and opens them", () => {
    const now = Date.now()
    serveQueries({
      '/assistants/:id': () => assistant,
      '/assistants/:id/stats': ({ params }) =>
        params?.id === assistant.id
          ? {
              topicCount: 12,
              messageCount: 248,
              recentTokens: 36_000,
              recentTopics: [
                { id: 'topic-a', name: 'Weekly report', lastActivityAt: new Date(now).toISOString(), messageCount: 3 },
                { id: 'topic-b', name: '', lastActivityAt: new Date(now - 86_400_000).toISOString(), messageCount: 1 }
              ]
            }
          : undefined
    })
    const opened: string[] = []
    let showAll = 0
    renderInRightPane(
      <AssistantProfilePane
        assistantId={assistant.id}
        activeTopicId="topic-a"
        onOpenTopic={(id) => opened.push(id)}
        onShowAllTopics={() => showAll++}
      />
    )

    for (const [value, label] of [
      ['12', 'Topics'],
      ['248', 'Messages'],
      ['36K', 'Tokens, 7 days']
    ]) {
      expect(screen.getByText(label).closest('div')).toHaveTextContent(`${label}${value}`)
    }
    const recent = screen.getByRole('region', { name: 'Recent topics' })
    const [current, older] = within(recent).getAllByRole('button', { name: /message/ })
    expect(current).toHaveTextContent('Weekly report')
    expect(current).toHaveTextContent('3 messages')
    expect(within(current).getByTitle('Current topic')).toBeInTheDocument()
    expect(older).toHaveTextContent('Default Conversation')
    expect(older).toHaveTextContent('1 message')
    expect(within(older).queryByTitle('Current topic')).toBeNull()

    fireEvent.click(older)
    fireEvent.click(within(recent).getByRole('button', { name: 'All' }))
    expect(opened).toEqual(['topic-b'])
    expect(showAll).toBe(1)
  })

  describe('try asking', () => {
    const DEFAULT_MODEL_ID = 'openai::gpt-5'
    const question = (title: string) => ({ title, hint: `${title} hint`, prompt: `${title}:` })
    const reply = (titles: string[]) => JSON.stringify({ items: titles.map(question) })
    const QUESTIONS = ['Outline a blog post', 'Tighten this paragraph', 'Suggest five titles', 'Fix grammar only']
    let current: Assistant
    let prefills: { topicId: string; text: string }[]
    let stopPrefills: () => void

    beforeEach(() => {
      current = assistant
      serveQueries({
        '/assistants/:id': () => current,
        [`/models/${DEFAULT_MODEL_ID}`]: () => ({ id: DEFAULT_MODEL_ID, name: 'GPT-5' })
      })
      MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', DEFAULT_MODEL_ID)
      prefills = []
      stopPrefills = EventEmitter.on(EVENT_NAMES.PREFILL_COMPOSER, (payload) => {
        prefills.push(payload as { topicId: string; text: string })
      })
    })

    afterEach(() => stopPrefills())

    const renderPane = () =>
      renderInRightPane(<AssistantProfilePane assistantId={assistant.id} activeTopicId="topic-1" />)
    const section = () => screen.queryByRole('region', { name: 'Try asking' })

    it('shows 4 generated questions and puts a clicked one into the composer', async () => {
      fetchGenerate.mockResolvedValue(reply([...QUESTIONS, 'A fifth question']))
      renderPane()

      expect(
        await within(screen.getByRole('region', { name: 'Try asking' })).findByText('Outline a blog post')
      ).toBeInTheDocument()
      expect(within(section()!).getAllByRole('button', { name: / hint$/ })).toHaveLength(4)
      expect(within(section()!).queryByText('A fifth question')).toBeNull()

      fireEvent.click(within(section()!).getByText('Tighten this paragraph'))
      await waitFor(() => expect(prefills).toEqual([{ topicId: 'topic-1', text: 'Tighten this paragraph:' }]))
    })

    it.each([
      ['there is no default model', () => MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', null)],
      ['generation fails', () => fetchGenerate.mockRejectedValue(new Error('Provider is disabled'))],
      ['the reply has fewer than 4 questions', () => fetchGenerate.mockResolvedValue(reply(QUESTIONS.slice(0, 3)))]
    ])('leaves the section out when %s', async (_case, arrange) => {
      arrange()
      renderPane()

      await waitFor(() => expect(section()).toBeNull())
      expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument()
    })

    it('reuses the questions until the prompt changes', async () => {
      fetchGenerate
        .mockResolvedValueOnce(reply(QUESTIONS))
        .mockResolvedValueOnce(reply(['Draft a launch email', ...QUESTIONS.slice(1)]))
      const first = renderPane()
      expect(
        await within(screen.getByRole('region', { name: 'Try asking' })).findByText('Outline a blog post')
      ).toBeInTheDocument()
      first.unmount()

      const second = renderPane()
      expect(within(section()!).getByText('Outline a blog post')).toBeInTheDocument()
      second.unmount()
      expect(fetchGenerate).toHaveBeenCalledTimes(1)

      current = { ...assistant, prompt: 'You are a copywriter for product launches.' }
      renderPane()
      expect(
        await within(screen.getByRole('region', { name: 'Try asking' })).findByText('Draft a launch email')
      ).toBeInTheDocument()
      expect(fetchGenerate).toHaveBeenCalledTimes(2)
    })

    it('stays hidden for this Assistant after Hide, across remounts', async () => {
      fetchGenerate.mockResolvedValue(reply(QUESTIONS))
      const first = renderPane()
      const region = await screen.findByRole('region', { name: 'Try asking' })
      fireEvent.click(within(region).getByRole('button', { name: 'Hide' }))
      first.unmount()

      renderPane()
      expect(section()).toBeNull()
    })
  })
})
