import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentEntity, ScheduledTaskEntity } from '@shared/data/types/agent'

import { AgentProfilePane } from '../AgentProfilePane'
import { recordEditDialogRequests, renderInRightPane, serveQueries } from './profilePaneTestUtils'

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

function serveAgentData({
  tasks = [],
  channels = []
}: { tasks?: ScheduledTaskEntity[]; channels?: { agentId: string; type: string }[] } = {}) {
  serveQueries({
    '/agents/:agentId': ({ params }) => (params?.agentId === agent.id ? agent : undefined),
    '/agents/:agentId/tasks': ({ params }) => {
      const items = tasks.filter((item) => item.agentId === params?.agentId)
      return { items, total: items.length, page: 1 }
    },
    '/agent-channels': ({ query }) => channels.filter((channel) => channel.agentId === query?.agentId),
    '/mcp-servers': () => ({ items: [], total: 0, page: 1 })
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

  it('shows the current settings and opens the edit dialog on the page that changes them', async () => {
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)
    const settings = screen.getByRole('region', { name: 'Settings' })

    fireEvent.click(within(settings).getByRole('button', { name: 'All' }))
    fireEvent.click(within(settings).getByRole('button', { name: 'Model: Claude Sonnet 4.5' }))
    fireEvent.click(within(settings).getByRole('button', { name: 'Permissions: Auto-accept Edits' }))
    fireEvent.click(within(settings).getByRole('button', { name: /^Reply language: Follow global/ }))

    await waitFor(() =>
      expect(dialog.requests).toEqual([
        { kind: 'agent', id: agent.id, initialTab: undefined },
        { kind: 'agent', id: agent.id, initialTab: 'basic' },
        { kind: 'agent', id: agent.id, initialTab: 'basic' },
        { kind: 'agent', id: agent.id, initialTab: 'basic' }
      ])
    )
  })

  it.each([
    { language: null, label: 'Reply language: No constraint' },
    { language: 'Svenska', label: 'Reply language: Svenska' }
  ])('names the reply language $label', ({ language, label }) => {
    agent = createAgent({ language })
    renderInRightPane(<AgentProfilePane agentId={agent.id} />)

    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
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
      serveAgentData({
        tasks: [task('t-1', agent.id, 'Daily code review')],
        channels: [
          { agentId: agent.id, type: 'feishu' },
          // Another Agent's WeChat channel does not count for this one.
          { agentId: 'agent-2', type: 'wechat' }
        ]
      })
      agent = { ...agent, knowledgeBaseIds: ['kb-1'] }
      renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      const suggestions = within(screen.getByRole('region', { name: 'Suggestions' }))

      expect(suggestions.queryByText('Connect to Feishu')).toBeNull()
      expect(suggestions.getByText('Connect to WeChat')).toBeInTheDocument()
      expect(suggestions.queryByText('Send me a daily report every morning')).toBeNull()
      expect(suggestions.queryByText('Link a knowledge base')).toBeNull()
      expect(suggestions.getByText('Connect GitHub')).toBeInTheDocument()
      expect(suggestions.getByText('Find skills that suit me')).toBeInTheDocument()
      expect(suggestions.getByText('Remember my habits')).toBeInTheDocument()
    })

    it('fills the composer from a suggestion, opens the edit dialog to link a knowledge base, and hides on request', async () => {
      renderInRightPane(<AgentProfilePane agentId={agent.id} sessionId="session-1" />)
      const region = screen.getByRole('region', { name: 'Suggestions' })

      expect(within(region).getByText('Connect to Feishu')).toBeInTheDocument()
      expect(within(region).getByText('Send me a daily report every morning')).toBeInTheDocument()
      fireEvent.click(within(region).getByText('Remember my habits'))
      fireEvent.click(within(region).getByText('Link a knowledge base'))
      await waitFor(() => {
        expect(prefills.requests).toEqual([{ topicId: SESSION_TOPIC, text: 'Remember my habits: ' }])
        expect(dialog.requests).toEqual([{ kind: 'agent', id: agent.id, initialTab: 'tools.knowledge' }])
      })

      fireEvent.click(within(region).getByRole('button', { name: 'Hide' }))
      expect(screen.queryByRole('region', { name: 'Suggestions' })).toBeNull()
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
