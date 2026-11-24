import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { parseProfileStarters } from '@shared/ai/profileStarters'
import type { AgentEntity, ScheduledTaskEntity } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'

import { AgentProfilePane } from '../AgentProfilePane'
import { recordEditDialogRequests, renderInRightPane, serveQueries } from './profilePaneTestUtils'

const fetchGenerate = vi.hoisted(() => vi.fn<(input: { prompt: string; content: string }) => Promise<string>>())

const DEFAULT_MODEL_ID = 'openai::gpt-5'

const nextModel = vi.hoisted(
  () =>
    ({
      id: 'anthropic::claude-opus-4-5',
      providerId: 'anthropic',
      name: 'Claude Opus 4.5',
      capabilities: []
    }) as unknown as Model
)

// The real selector loads providers and models; picking one is all the pane needs from it.
vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger, onSelect }: { trigger: ReactNode; onSelect: (model: Model) => void }) => (
    <>
      {trigger}
      <button type="button" onClick={() => onSelect(nextModel)}>
        Pick Claude Opus 4.5
      </button>
    </>
  )
}))

let agent: AgentEntity

const task = (id: string, agentId: string, name: string, enabled = true): ScheduledTaskEntity =>
  ({
    id,
    agentId,
    name,
    prompt: name,
    trigger: { kind: 'cron', expr: '30 9 * * 1-5' },
    enabled,
    status: enabled ? 'active' : 'paused'
  }) as unknown as ScheduledTaskEntity

function serveAgentData({ tasks = [] }: { tasks?: ScheduledTaskEntity[] } = {}) {
  serveQueries({
    '/agents/:agentId': ({ params }) => (params?.agentId === agent.id ? agent : undefined),
    '/agents/:agentId/tasks': ({ params }) => {
      const items = tasks.filter((item) => item.agentId === params?.agentId)
      return { items, total: items.length, page: 1 }
    },
    '/agent-channels': () => [],
    '/mcp-servers': () => ({ items: [], total: 0, page: 1 }),
    [`/models/${DEFAULT_MODEL_ID}`]: () => ({ id: DEFAULT_MODEL_ID, name: 'GPT-5' })
  })
}

function recordPrefills() {
  const requests: { topicId: string; text: string }[] = []
  const stop = EventEmitter.on(EVENT_NAMES.PREFILL_COMPOSER, (payload) => {
    requests.push(payload as { topicId: string; text: string })
  })
  return { requests, stop }
}

function createAgent(configuration: AgentEntity['configuration'] = {}): AgentEntity {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Code Reviewer',
    description: 'Reviews changes and points out risks',
    model: null,
    modelName: 'Claude Sonnet 4.5',
    configuration
  } as unknown as AgentEntity
}

describe('AgentProfilePane', () => {
  let dialog: ReturnType<typeof recordEditDialogRequests>
  let prefills: ReturnType<typeof recordPrefills>

  beforeEach(async () => {
    MockUseDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUseCacheUtils.resetMocks()
    fetchGenerate.mockReset()
    vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
      if (route !== 'ai.profile_starters.generate') return undefined
      const { mode, system, prompt } = aiRequestSchemas['ai.profile_starters.generate'].input.parse(input)
      return { ok: true, data: parseProfileStarters(await fetchGenerate({ prompt: system, content: prompt }), mode) }
    })
    await i18n.changeLanguage('en-US')
    agent = createAgent({ permission_mode: 'acceptEdits' })
    serveAgentData()
    dialog = recordEditDialogRequests()
    prefills = recordPrefills()
  })

  afterEach(() => {
    dialog.stop()
    prefills.stop()
  })

  it('shows who the Agent is', () => {
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)

    expect(screen.getByRole('heading', { name: 'Code Reviewer' })).toBeInTheDocument()
    expect(screen.getByText('Reviews changes and points out risks')).toBeInTheDocument()
  })

  it('shows every supported platform in Channels for an Agent with no accounts', () => {
    renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Channels' }))
    const platforms = within(screen.getByRole('region', { name: 'Available platforms' }))
    for (const platform of ['WeChat', 'Feishu', 'WeCom', 'DingTalk', 'QQ', 'Telegram', 'Discord', 'Slack']) {
      expect(platforms.getByRole('button', { name: `Connect ${platform}` })).toBeInTheDocument()
    }
    expect(screen.queryByRole('region', { name: 'Suggestions' })).not.toBeInTheDocument()
  })

  describe('settings', () => {
    let patches: unknown[]

    beforeEach(() => {
      patches = []
      MockUseDataApiUtils.mockMutationWithTrigger(
        'PATCH',
        `/agents/${agent.id}` as '/agents/:agentId',
        vi.fn(async ({ body }: { body: unknown }) => {
          patches.push(body)
          return agent
        })
      )
    })

    const settingsRegion = (onModelChange?: (model: Model) => void) => {
      renderInRightPane(<AgentProfilePane agentId={agent.id} onModelChange={onModelChange} />)
      return screen.getByRole('region', { name: 'Settings' })
    }

    it('opens the edit dialog from All', async () => {
      fireEvent.click(within(settingsRegion()).getByRole('button', { name: 'All' }))

      await waitFor(() => expect(dialog.requests).toEqual([{ kind: 'agent', id: agent.id }]))
    })

    it("hands a model choice to the conversation's confirmed switch instead of saving it directly", () => {
      const chosen: Model[] = []
      const settings = settingsRegion((model) => chosen.push(model))
      expect(within(settings).getByRole('button', { name: 'Model' })).toHaveTextContent('Claude Sonnet 4.5')

      fireEvent.click(within(settings).getByRole('button', { name: 'Pick Claude Opus 4.5' }))

      expect(chosen).toEqual([nextModel])
      expect(patches).toEqual([])
    })

    // A session can run on another model than its Agent's; the pane shows the one in use.
    it("shows the conversation's model when the session uses its own", () => {
      renderInRightPane(<AgentProfilePane agentId={agent.id} model={nextModel} onModelChange={vi.fn()} />)

      const settings = screen.getByRole('region', { name: 'Settings' })
      expect(within(settings).getByRole('button', { name: 'Model' })).toHaveTextContent(nextModel.name)
    })

    it('cannot change the model outside a conversation that confirms the switch', () => {
      expect(within(settingsRegion()).getByRole('button', { name: 'Model' })).toBeDisabled()
    })

    it('changes the permission mode in place, and asks before Full Access', async () => {
      const settings = settingsRegion()
      expect(within(settings).getByRole('button', { name: 'Permissions' })).toHaveTextContent('Auto-accept Edits')

      fireEvent.click(within(settings).getByRole('button', { name: /^Ask Before Acting/ }))
      await waitFor(() => expect(patches).toEqual([{ configuration: { permission_mode: 'default' } }]))

      fireEvent.click(within(settings).getByRole('button', { name: /^Full Access/ }))
      expect(patches).toHaveLength(1)
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enable Full Access' }))
      await waitFor(() => expect(patches[1]).toEqual({ configuration: { permission_mode: 'bypassPermissions' } }))
    })

    it('changes the reply language in place', async () => {
      const settings = settingsRegion()

      fireEvent.click(within(settings).getByRole('button', { name: 'No constraint' }))
      fireEvent.click(within(settings).getByRole('button', { name: '日本語' }))

      await waitFor(() =>
        expect(patches).toEqual([{ configuration: { language: null } }, { configuration: { language: '日本語' } }])
      )
    })
  })

  describe('activity', () => {
    const SESSION_TOPIC = buildAgentSessionTopicId('session-1')

    it("shows this Agent's usage in compact numbers", () => {
      serveQueries({
        '/agents/:agentId': () => agent,
        '/agents/:agentId/stats': ({ params }) =>
          params?.agentId === agent.id
            ? { sessionCount: 31, recentTaskRunCount: 18, recentTokens: 1_200_000 }
            : undefined
      })
      renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)

      for (const [value, label] of [
        ['31', 'Sessions'],
        ['18', 'Task runs'],
        ['1.2M', 'Tokens, 7 days']
      ]) {
        expect(screen.getByText(label).closest('div')).toHaveTextContent(`${label}${value}`)
      }
    })

    it("lists only this Agent's scheduled tasks with their schedule or paused state", () => {
      serveAgentData({
        tasks: [
          task('t-1', agent.id, 'Daily code review'),
          task('t-2', agent.id, 'Weekly summary', false),
          task('t-3', 'agent-2', "Someone else's task")
        ]
      })
      renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      const tasks = screen.getByRole('region', { name: 'Scheduled tasks' })

      expect(within(tasks).getByText('Daily code review')).toBeInTheDocument()
      expect(within(tasks).getByText('Weekly summary')).toBeInTheDocument()
      expect(within(tasks).queryByText("Someone else's task")).toBeNull()
      expect(within(tasks).getByText('Weekdays at 09:30')).toBeInTheDocument()
      expect(within(tasks).getByText('Paused')).toBeInTheDocument()
      expect(within(tasks).getByRole('switch', { name: 'Pause Daily code review' })).toBeChecked()
      expect(within(tasks).getByRole('switch', { name: 'Resume Weekly summary' })).not.toBeChecked()
    })

    it("puts a task request into this session's composer from New", async () => {
      renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      const tasks = screen.getByRole('region', { name: 'Scheduled tasks' })

      expect(within(tasks).getByText('No scheduled tasks yet')).toBeInTheDocument()
      fireEvent.click(within(tasks).getByRole('button', { name: 'New' }))

      await waitFor(() =>
        expect(prefills.requests).toEqual([{ topicId: SESSION_TOPIC, text: 'Create a scheduled task for me: ' }])
      )
    })

    it('suggests only what this Agent has not set up yet', () => {
      serveAgentData({ tasks: [task('t-1', agent.id, 'Daily code review')] })
      agent = { ...agent, knowledgeBaseIds: ['kb-1'] }
      renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      const suggestions = within(screen.getByRole('region', { name: 'Suggestions' }))

      expect(suggestions.queryByText('Connect to Feishu')).toBeNull()
      expect(suggestions.queryByText('Connect to WeChat')).toBeNull()
      expect(suggestions.queryByText('Send me a daily report every morning')).toBeNull()
      expect(suggestions.queryByText('Link a knowledge base')).toBeNull()
      expect(suggestions.getByText('Connect GitHub')).toBeInTheDocument()
      expect(suggestions.getByText('Find skills that suit me')).toBeInTheDocument()
      expect(suggestions.getByText('Remember my habits')).toBeInTheDocument()
    })

    it('fills the composer from a suggestion and opens the edit dialog to link a knowledge base', async () => {
      renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      const region = screen.getByRole('region', { name: 'Suggestions' })

      expect(within(region).getByText('Send me a daily report every morning')).toBeInTheDocument()
      fireEvent.click(within(region).getByText('Remember my habits'))
      fireEvent.click(within(region).getByText('Link a knowledge base'))
      await waitFor(() => {
        expect(prefills.requests).toEqual([{ topicId: SESSION_TOPIC, text: 'Remember my habits: ' }])
        expect(dialog.requests).toEqual([{ kind: 'agent', id: agent.id, initialTab: 'tools.knowledge' }])
      })
    })

    it('keeps the suggestions hidden for this Agent after Hide, across remounts', () => {
      const first = renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      fireEvent.click(within(screen.getByRole('region', { name: 'Suggestions' })).getByRole('button', { name: 'Hide' }))
      first.unmount()

      renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      expect(screen.queryByRole('region', { name: 'Suggestions' })).toBeNull()
    })

    describe('generated by the default model', () => {
      const generated = (title: string, kind = 'generic') => ({
        kind,
        title,
        hint: `${title} hint`,
        prompt: `${title}, please`
      })
      const reply = (items: object[]) => JSON.stringify({ items })
      const GENERATED = [
        generated('Review my latest PR'),
        generated('Post reviews to Feishu', 'channel-feishu'),
        generated('Reach me on WeChat', 'channel-wechat'),
        generated('Weekly risk digest', 'schedule'),
        generated('Link the style guide', 'knowledge'),
        generated('Remember my review style', 'memory')
      ]

      beforeEach(() => MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', DEFAULT_MODEL_ID))

      const renderPane = () => renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      const suggestions = () => within(screen.getByRole('region', { name: 'Suggestions' }))

      it('shows the generated suggestions minus what is already set up, and a click fills the composer', async () => {
        serveAgentData({ tasks: [task('t-1', agent.id, 'Daily code review')] })
        fetchGenerate.mockResolvedValue(`\`\`\`json\n${reply(GENERATED)}\n\`\`\``)
        renderPane()

        expect(await suggestions().findByText('Review my latest PR')).toBeInTheDocument()
        expect(suggestions().queryByText('Reach me on WeChat')).toBeNull()
        expect(suggestions().getByText('Link the style guide')).toBeInTheDocument()
        expect(suggestions().getByText('Remember my review style')).toBeInTheDocument()
        expect(suggestions().queryByText('Post reviews to Feishu')).toBeNull()
        expect(suggestions().queryByText('Weekly risk digest')).toBeNull()
        expect(suggestions().queryByText('Connect GitHub')).toBeNull()
        expect(fetchGenerate.mock.calls[0][0].content).not.toContain('Connected channels:')

        fireEvent.click(suggestions().getByText('Review my latest PR'))
        fireEvent.click(suggestions().getByText('Link the style guide'))
        await waitFor(() => {
          expect(prefills.requests).toEqual([{ topicId: SESSION_TOPIC, text: 'Review my latest PR, please' }])
          expect(dialog.requests).toEqual([{ kind: 'agent', id: agent.id, initialTab: 'tools.knowledge' }])
        })
      })

      it('regenerates old cached recommendations that could include channel-related tasks', async () => {
        MockUseCacheUtils.setPersistCacheValue('ui.chat.profile_pane.starters', {
          [agent.id]: {
            hash: 'n91u1u', // The pre-version cache key for the default test Agent in en-US.
            items: [{ kind: 'generic', title: 'Send updates to Slack', hint: '', prompt: 'Send updates to Slack' }]
          }
        })
        fetchGenerate.mockResolvedValue(reply(GENERATED))
        renderPane()

        expect(await suggestions().findByText('Review my latest PR')).toBeInTheDocument()
        expect(suggestions().queryByText('Send updates to Slack')).not.toBeInTheDocument()
      })

      // In Chinese the model called the Agent 助手, the UI's word for an Assistant.
      it("tells the model this is an Agent in the UI's own word", async () => {
        await i18n.changeLanguage('zh-CN')
        fetchGenerate.mockResolvedValue(reply(GENERATED))
        renderPane()

        await waitFor(() => expect(fetchGenerate).toHaveBeenCalledTimes(1))
        const { prompt, content } = fetchGenerate.mock.calls[0][0]
        expect(content).toContain('Kind: 智能体')
        expect(prompt).toContain('never call an Agent an Assistant')
      })

      it.each([
        ['there is no default model', () => MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', null)],
        ['generation fails', () => fetchGenerate.mockRejectedValue(new Error('Provider is disabled'))],
        ['the reply is not JSON', () => fetchGenerate.mockResolvedValue('Here are some ideas: review PRs')],
        [
          'the reply has too few valid suggestions',
          () => fetchGenerate.mockResolvedValue(reply([GENERATED[0], { title: 'No prompt' }]))
        ],
        [
          'channel suggestions leave fewer than four valid items',
          () => fetchGenerate.mockResolvedValue(reply(GENERATED.slice(0, 4)))
        ]
      ])('shows the rule-based suggestions when %s', async (_case, arrange) => {
        arrange()
        renderPane()

        expect(await suggestions().findByText('Connect GitHub')).toBeInTheDocument()
        expect(suggestions().getByText('Remember my habits')).toBeInTheDocument()
        expect(suggestions().queryByText('Review my latest PR')).toBeNull()
      })

      it('shows a loading state, then the rule-based suggestions when generation times out', async () => {
        vi.useFakeTimers()
        try {
          fetchGenerate.mockReturnValue(Promise.withResolvers<string>().promise)
          renderPane()
          expect(screen.getByRole('region', { name: 'Suggestions' })).toHaveTextContent('Loading...')
          expect(suggestions().queryByText('Connect GitHub')).toBeNull()

          await act(() => vi.advanceTimersByTimeAsync(30_000))
          expect(suggestions().getByText('Connect GitHub')).toBeInTheDocument()
        } finally {
          vi.useRealTimers()
        }
      })

      it.each(['generated cards', 'default cards'] as const)(
        'keeps %s visible while updated instructions regenerate recommendations',
        async (initial) => {
          const initialCard = initial === 'generated cards' ? 'Review my latest PR' : 'Connect GitHub'
          if (initial === 'generated cards') fetchGenerate.mockResolvedValueOnce(reply(GENERATED))
          else fetchGenerate.mockRejectedValueOnce(new Error('Provider unavailable'))

          const next = Promise.withResolvers<string>()
          fetchGenerate.mockReturnValueOnce(next.promise)
          const view = renderPane()
          expect(await suggestions().findByText(initialCard)).toBeVisible()

          agent = { ...agent, instructions: 'Review database migrations' }
          view.rerender(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)

          expect(suggestions().getByText(initialCard)).toBeVisible()
          expect(suggestions().queryByText('Loading...')).not.toBeInTheDocument()
          await act(async () => next.resolve(reply([generated('Audit migration risks'), ...GENERATED.slice(1)])))
          expect(await suggestions().findByText('Audit migration risks')).toBeVisible()
        }
      )

      it.each(['name', 'description', 'instructions'] as const)(
        'reuses the cached suggestions until the %s changes',
        async (field) => {
          fetchGenerate
            .mockResolvedValueOnce(reply(GENERATED))
            .mockResolvedValueOnce(reply([generated('Audit the new module'), ...GENERATED.slice(1)]))
          const first = renderPane()
          expect(await suggestions().findByText('Review my latest PR')).toBeInTheDocument()
          first.unmount()

          const second = renderPane()
          expect(suggestions().getByText('Review my latest PR')).toBeInTheDocument()
          second.unmount()
          expect(fetchGenerate).toHaveBeenCalledTimes(1)

          agent = { ...agent, [field]: `${agent[field] ?? ''} (changed)` }
          renderPane()
          expect(await suggestions().findByText('Audit the new module')).toBeInTheDocument()
          expect(fetchGenerate).toHaveBeenCalledTimes(2)
        }
      )
    })

    it('shows the session workspace and opens it in the Files pane', () => {
      let opened = 0
      renderInRightPane(
        <AgentProfilePane
          agentId={agent.id}
          sessionId="session-1"
          workspace={{ path: '/projects/cherry-studio', open: () => opened++ }}
        />
      )
      const workspace = screen.getByRole('region', { name: 'Workspace' })

      expect(within(workspace).getByText('Idle')).toBeInTheDocument()
      fireEvent.click(within(workspace).getByRole('button', { name: /\/projects\/cherry-studio/ }))
      expect(opened).toBe(1)
    })
  })
})
