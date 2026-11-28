import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { MockUseCache } from '@test-mocks/renderer/useCache'
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MessageHeader from '@renderer/components/chat/messages/frame/MessageHeader'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type {
  MessageListItem,
  MessageListProviderValue,
  MessageListRuntime
} from '@renderer/components/chat/messages/types'
import { messageProjectionService } from '@renderer/services/aiTransport'
import { toast } from '@renderer/services/toast'
import type { InputFilePreview } from '@renderer/types/inputFilePreview'
import type { Topic } from '@renderer/types/topic'
import { messagePartsAt } from '@renderer/utils/message/messagePartRows'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { CherryUIMessage } from '@shared/data/types/message'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { AbsoluteFilePath } from '@shared/types/file'

const exportActionsMock = vi.hoisted(() => ({
  saveTextFile: vi.fn(),
  saveImage: vi.fn(),
  saveToKnowledge: vi.fn(),
  exportMessageAsMarkdown: vi.fn(),
  exportToNotes: vi.fn(),
  exportToWord: vi.fn(),
  exportToNotion: vi.fn(),
  exportToYuque: vi.fn(),
  exportToObsidian: vi.fn(),
  exportToJoplin: vi.fn(),
  exportToSiyuan: vi.fn()
}))
const useMessageExportActionsMock = vi.hoisted(() => vi.fn(() => exportActionsMock))
const cacheHookMocks = vi.hoisted(() => ({
  selectedMessageIds: ['user-1'] as string[],
  setMultiSelectMode: vi.fn(),
  setSelectedMessageIds: vi.fn()
}))
const errorActionsMock = vi.hoisted(() => ({
  diagnoseMessageError: vi.fn(),
  openErrorDetail: vi.fn(),
  navigateErrorTarget: vi.fn()
}))
const useMessageErrorActionsMock = vi.hoisted(() =>
  vi.fn<(options?: unknown) => typeof errorActionsMock>(() => errorActionsMock)
)
const dataApiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  onDataChanged: vi.fn(() => () => {})
}))
const leafCapabilitiesMock = vi.hoisted(() => ({
  previewFile: vi.fn(),
  subscribeToolProgress: vi.fn(),
  openExternalUrl: vi.fn(),
  copyText: vi.fn(),
  copyRichContent: vi.fn(),
  copyImage: vi.fn(),
  exportTableAsExcel: vi.fn(),
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  getFileView: vi.fn(),
  isToolAutoApproved: vi.fn(() => false)
}))
const headerCapabilitiesMock = vi.hoisted(() => ({
  userProfile: { avatar: '🙂' },
  openUserProfile: vi.fn()
}))
const openRouteMock = vi.hoisted(() => vi.fn())
const ipcApiRequest = vi.hoisted(() => vi.fn())
const eventMocks = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(() => vi.fn()),
  // The locate dispatcher polls for a mounted subscriber before emitting; the
  // mock reports one so delivery happens on the first animation frame.
  listenerCount: vi.fn(() => 1)
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: async (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('ai.projection.')) {
        const result = await window.api.ipcApi.request(...(args as Parameters<typeof window.api.ipcApi.request>))
        return (result as { ok?: boolean; data?: unknown })?.ok ? (result as { data?: unknown }).data : result
      }
      return ipcApiRequest(...args)
    },
    on: (...args: Parameters<typeof window.api.ipcApi.on>) => window.api.ipcApi.on(...args)
  }
}))

vi.mock('@data/hooks/useCache', () => ({
  ...MockUseCache,
  useCache: (key: string) => {
    if (key === 'chat.multi_select_mode') return [true, cacheHookMocks.setMultiSelectMode]
    if (key === 'chat.selected_message_ids')
      return [cacheHookMocks.selectedMessageIds, cacheHookMocks.setSelectedMessageIds]
    return [undefined, vi.fn()]
  }
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: vi.fn(() => undefined),
    set: vi.fn()
  }
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: dataApiMocks
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: 'idle',
    activeExecutions: [],
    awaitingApprovalAnchors: []
  })
}))

const renderConfiguration = vi.hoisted(() => ({
  renderConfig: {
    userName: '',
    narrowMode: false,
    messageStyle: 'plain',
    messageFont: 'system',
    fontSize: 14,
    renderInputMessageAsMarkdown: false,
    codeFancyBlock: true,
    thoughtAutoCollapse: true,
    keepIntermediateAssistantText: false,
    mathEnableSingleDollar: false,
    showMessageOutline: false,
    multiModelMessageStyle: 'horizontal',
    multiModelGridColumns: 2,
    multiModelGridPopoverTrigger: 'click'
  },
  updateRenderConfig: vi.fn()
}))
vi.mock('@renderer/components/chat/messages/hooks/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => renderConfiguration
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageMenuConfig', () => ({
  useMessageMenuConfig: () => ({
    confirmDeleteMessage: false,
    enableDeveloperMode: false,
    exportMenuOptions: {
      image: false,
      markdown: false,
      markdown_reason: false,
      notion: false,
      yuque: false,
      joplin: false,
      obsidian: false,
      siyuan: false,
      docx: false,
      plain_text: false
    }
  })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageExportActions', () => ({
  useMessageExportActions: useMessageExportActionsMock
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageErrorActions', () => ({
  useMessageErrorActions: useMessageErrorActionsMock
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageLeafCapabilities', () => ({
  useMessageLeafCapabilities: () => leafCapabilitiesMock
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageHeaderCapabilities', () => ({
  useMessageHeaderCapabilities: () => headerCapabilitiesMock
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openRoute: openRouteMock
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    LOCATE_MESSAGE: 'LOCATE_MESSAGE'
  },
  EventEmitter: eventMocks
}))

vi.mock('@renderer/services/ExportService', () => ({
  messagesToMarkdown: vi.fn(async () => 'markdown')
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const { useAgentMessageListProviderValue } = await import('../agentMessageListAdapter')
const {
  clearPendingAgentSessionImageActionsForTest,
  consumePendingAgentSessionImageActions,
  requestAgentSessionImageAction
} = await import('../agentSessionImageActionBus')

describe('useAgentMessageListProviderValue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheHookMocks.selectedMessageIds = ['user-1']
    cacheHookMocks.setSelectedMessageIds.mockReset()
    clearPendingAgentSessionImageActionsForTest()
    ipcApiRequest.mockReset()
    ipcApiRequest.mockResolvedValue({
      kind: 'file',
      type: 'other',
      size: 0,
      createdAt: 0,
      modifiedAt: 0,
      mime: 'application/octet-stream'
    })
  })

  it.each([
    ['/settings/provider', '/settings/local-agents?id=poolside', '/settings/local-agents?id=poolside'],
    ['/settings/provider?id=openai', '/settings/local-agents?id=poolside', '/settings/provider?id=openai'],
    ['/settings/general', '/settings/local-agents?id=poolside', '/settings/general'],
    ['/settings/provider?id=anthropic', undefined, '/settings/provider?id=anthropic']
  ])('routes recovery from %s to the owning settings page', (target, providerErrorSettingsPath, expected) => {
    const { result } = renderHook(() =>
      useAgentMessageListProviderValue({
        topic: { id: 'agent-session:source', assistantId: 'agent-1', name: 'Source', messages: [] } as unknown as Topic,
        messages: [],
        partsByMessageId: {},
        isLoading: false,
        messageNavigation: 'anchor',
        providerErrorSettingsPath
      })
    )
    void result.current.actions.navigateErrorTarget?.(target)
    expect(errorActionsMock.navigateErrorTarget).toHaveBeenCalledWith(expected)
  })

  it('allows fork only at the final display segment and addresses the durable Run', async () => {
    const topic = { id: 'agent-session:fork-timeline', name: 'Timeline' } as Topic
    const run: CherryUIMessage = {
      id: 'run',
      role: 'assistant',
      metadata: { status: 'success', stats: { totalTokens: 20 } },
      partIds: ['before', 'after'],
      partPositions: [1, 3],
      parts: [
        { type: 'text', text: 'Before' },
        { type: 'text', text: 'After' }
      ]
    }
    const steer: CherryUIMessage = {
      id: 'steer',
      role: 'user',
      timeline: { pos: 2 },
      parts: [{ type: 'text', text: 'Steer' }]
    }
    const { result } = renderHook(() =>
      useAgentMessageListProviderValue({
        topic,
        messages: [run, steer],
        partsByMessageId: { run: run.parts, steer: steer.parts },
        historyActions: { run: { fork: null, edit: 'busy' } },
        isLoading: false,
        messageNavigation: 'none'
      })
    )
    const [before, , after] = result.current.state.messages
    expect(result.current.actions.forkSession?.availability(before)).toMatchObject({ enabled: false })
    expect(result.current.actions.forkSession?.availability(after)).toMatchObject({ enabled: true })
    expect(before.stats).toBeUndefined()
    expect(after.stats?.totalTokens).toBe(20)
    expect(messagePartsAt(result.current.state.partsByMessageId, after.id)).toEqual([{ type: 'text', text: 'After' }])
    ipcApiRequest.mockResolvedValueOnce({ sessionId: 'forked' })
    await result.current.actions.forkSession?.run(after.id)
    expect(ipcApiRequest).toHaveBeenCalledWith('ai.agent.session.fork', {
      sourceSessionId: 'fork-timeline',
      messageId: 'run'
    })
  })

  it('routes an approval on a later display segment to its original Run', async () => {
    const topic = { id: 'agent-session:approval-timeline', name: 'Timeline' } as Topic
    const tool = {
      type: 'dynamic-tool',
      toolName: 'Write',
      toolCallId: 'write',
      state: 'approval-requested',
      input: {},
      approval: { id: 'approval' }
    } as const
    const run: CherryUIMessage = {
      id: 'run',
      role: 'assistant',
      metadata: { status: 'pending' },
      partIds: ['before', 'approval'],
      partPositions: [1, 3],
      parts: [{ type: 'text', text: 'Before' }, tool]
    }
    const steer: CherryUIMessage = {
      id: 'steer',
      role: 'user',
      timeline: { pos: 2 },
      parts: [{ type: 'text', text: 'Steer' }]
    }
    const respond = vi.fn(async () => {})
    const { result } = renderHook(() =>
      useAgentMessageListProviderValue({
        topic,
        messages: [run, steer],
        partsByMessageId: { run: run.parts, steer: steer.parts },
        respondToolApproval: respond,
        isLoading: false,
        messageNavigation: 'none'
      })
    )
    const after = result.current.state.messages.at(-1)!
    await result.current.actions.respondToolApproval?.({
      approved: true,
      match: {
        messageId: after.id,
        toolCallId: 'write',
        approvalId: 'approval',
        state: 'approval-requested',
        part: tool
      }
    })
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ match: expect.objectContaining({ messageId: 'run' }), approved: true })
    )
  })

  it('keys Agent lists by session topic while keeping tool steps collapsed', () => {
    const topic = { id: 'agent-session:first', assistantId: 'agent-1', name: 'First', messages: [] } as unknown as Topic
    const { result, rerender } = renderHook(
      ({ activeTopic }) =>
        useAgentMessageListProviderValue({
          topic: activeTopic,
          messages: [],
          partsByMessageId: {},
          isLoading: false,
          messageNavigation: 'none'
        }),
      { initialProps: { activeTopic: topic } }
    )
    expect(result.current.state.listKey).toBe('agent-session:first')
    expect(result.current.state.renderConfig.expandToolSteps).toBe(false)
    expect(result.current.state.renderConfig.expandLiveToolSteps).toBe(true)
    rerender({ activeTopic: { ...topic, id: 'agent-session:second' } })
    expect(result.current.state.listKey).toBe('agent-session:second')
    expect(result.current.state.renderConfig.expandToolSteps).toBe(false)
    expect(result.current.state.renderConfig.expandLiveToolSteps).toBe(true)
  })

  it('keeps historical avatars current until their agent is deleted', () => {
    const messages: CherryUIMessage[] = [
      {
        id: 'historical-reply',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Historical reply' }],
        metadata: {
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'success',
          messageSnapshot: {
            id: 'agent-1',
            name: 'Original name',
            emoji: '🎓',
            model: { id: 'model-1', name: 'Model', provider: 'provider-1' }
          }
        }
      }
    ]
    const Probe = ({ avatar }: { avatar?: string }) => {
      const value = useAgentMessageListProviderValue({
        topic: {
          id: 'agent-session:avatar',
          assistantId: 'agent-1',
          name: 'History',
          messages: []
        } as unknown as Topic,
        messages,
        partsByMessageId: {},
        assistantProfile: avatar ? { id: 'agent-1', name: 'Current name', avatar } : undefined,
        isLoading: false,
        messageNavigation: 'anchor'
      })
      return (
        <MessageListProvider value={value}>
          <MessageHeader message={value.state.messages[0]} />
        </MessageListProvider>
      )
    }
    const { rerender } = render(<Probe avatar="🐱" />)
    expect(screen.getAllByText('🐱')[0]).toBeVisible()
    expect(screen.getByText('Original name')).toBeVisible()
    rerender(<Probe avatar="🐶" />)
    expect(screen.getAllByText('🐶')[0]).toBeVisible()
    expect(screen.queryByText('🐱')).not.toBeInTheDocument()
    rerender(<Probe />)
    expect(screen.getAllByText('🎓')[0]).toBeVisible()
    expect(screen.queryByText('🐶')).not.toBeInTheDocument()
  })

  it('delivers sent attachment activation to the current pane callback after rerender', async () => {
    const opened: InputFilePreview[] = []
    const input = { displayName: 'report.md', previewPath: '/managed/report.md' as AbsoluteFilePath }
    const { result, rerender } = renderHook(
      ({ previewInputFile }) =>
        useAgentMessageListProviderValue({
          topic: {
            id: 'agent-session:source',
            assistantId: 'agent-1',
            name: 'Source',
            messages: []
          } as unknown as Topic,
          messages: [],
          partsByMessageId: {},
          isLoading: false,
          messageNavigation: 'anchor',
          previewInputFile
        }),
      {
        initialProps: {
          previewInputFile: (file: InputFilePreview) => {
            opened.push(file)
          }
        }
      }
    )
    await act(async () => {
      await result.current.actions.previewInputFile?.(input)
    })
    expect(opened).toEqual([input])
    const nextOpened: InputFilePreview[] = []
    rerender({
      previewInputFile: (file: InputFilePreview) => {
        nextOpened.push(file)
      }
    })
    await act(async () => {
      await result.current.actions.previewInputFile?.(input)
    })
    expect(nextOpened).toEqual([input])
    expect(opened).toEqual([input])
  })

  it.each(['success', 'workspace_changed', 'legacy_history', 'cancelled', 'unexpected'] as const)(
    'offers Main-approved completed messages and reports native fork errors: %s',
    async (scenario) => {
      let value: MessageListProviderValue | undefined
      const Probe = () => {
        value = useAgentMessageListProviderValue({
          topic: {
            id: 'agent-session:source',
            assistantId: 'agent-1',
            name: 'Source',
            messages: []
          } as unknown as Topic,
          messages: [],
          historyActions: { 'selected-message': { fork: null, edit: 'invalid_target' } },
          partsByMessageId: {},
          isLoading: false,
          messageNavigation: 'anchor'
        })
        return null
      }
      ipcApiRequest.mockReset()
      if (scenario === 'success') ipcApiRequest.mockResolvedValueOnce({ sessionId: 'child' })
      else if (scenario === 'unexpected') ipcApiRequest.mockRejectedValueOnce(new Error('unexpected failure'))
      else
        ipcApiRequest.mockRejectedValueOnce(
          new IpcError(aiErrorCodes.AI_AGENT_SESSION_FORK_FAILED, 'fork failed', {
            reason: scenario
          })
        )
      render(<Probe />)
      const capability = value!.actions.forkSession!
      const selectedMessage = {
        id: 'selected-message',
        role: 'assistant',
        status: 'success'
      } as MessageListItem
      expect(capability.label).toBe('agent_session_fork.label')
      expect(capability.availability(selectedMessage)).toMatchObject({
        visible: true,
        enabled: true
      })
      expect(capability.availability({ ...selectedMessage, status: 'pending' })).toEqual({
        visible: true,
        enabled: false,
        reason: 'agent_session_fork.not_turn_boundary'
      })
      expect(capability.availability({ ...selectedMessage, role: 'user' })).toBe(false)
      expect(ipcApiRequest).not.toHaveBeenCalled()
      const action = value!.actions.forkSession!.run('selected-message')
      if (scenario === 'unexpected') {
        await expect(action).rejects.toThrow('unexpected failure')
        expect(leafCapabilitiesMock.notifyError).not.toHaveBeenCalled()
      } else if (scenario !== 'success') {
        const message = scenario === 'cancelled' ? 'message.tools.cancelled' : `agent_session_fork.${scenario}`
        await expect(action).resolves.toBeUndefined()
        expect(leafCapabilitiesMock.notifyError.mock.calls).toEqual([[message]])
      } else await action
      expect(ipcApiRequest).toHaveBeenNthCalledWith(1, 'ai.agent.session.fork', {
        sourceSessionId: 'source',
        messageId: 'selected-message'
      })
      expect(ipcApiRequest).toHaveBeenCalledTimes(1)
      if (scenario === 'success') expect(openRouteMock).toHaveBeenCalledWith('/app/agents', { sessionId: 'child' })
      else expect(openRouteMock).not.toHaveBeenCalled()
    }
  )

  it.each(['success', 'not-found', 'failure'] as const)(
    'opens the fork source only after a successful lookup: %s',
    async (scenario) => {
      const lookup = Promise.withResolvers<unknown>()
      dataApiMocks.get.mockReturnValueOnce(lookup.promise)
      const navigateMock = vi.fn(async () => {})
      const { result } = renderHook(() =>
        useAgentMessageListProviderValue({
          topic: { id: 'agent-session:child', assistantId: 'agent-1', name: 'Child', messages: [] } as unknown as Topic,
          messages: [],
          partsByMessageId: {},
          isLoading: false,
          messageNavigation: 'anchor',
          navigateToForkSource: navigateMock
        })
      )
      const opening = result.current.actions.openForkSourceSession!('parent')
      expect(dataApiMocks.get).toHaveBeenCalledWith('/agent-sessions/parent')
      expect(navigateMock).not.toHaveBeenCalled()
      if (scenario === 'success') lookup.resolve({ id: 'parent' })
      else
        lookup.reject(
          scenario === 'not-found' ? DataApiErrorFactory.notFound('Session', 'parent') : new Error('Connection failed')
        )
      await opening
      if (scenario === 'success') {
        expect(navigateMock).toHaveBeenCalledWith({ sourceSessionId: 'parent', returnSessionId: 'child' })
        expect(leafCapabilitiesMock.notifyError).not.toHaveBeenCalled()
      } else {
        expect(navigateMock).not.toHaveBeenCalled()
        expect(leafCapabilitiesMock.notifyError).toHaveBeenCalledWith(
          scenario === 'not-found' ? 'agent_session_fork.source_not_found' : 'Connection failed'
        )
      }
    }
  )

  it('offers no fork-source action when the host cannot navigate in place', () => {
    const { result } = renderHook(() =>
      useAgentMessageListProviderValue({
        topic: { id: 'agent-session:child', assistantId: 'agent-1', name: 'Child', messages: [] } as unknown as Topic,
        messages: [],
        partsByMessageId: {},
        isLoading: false,
        messageNavigation: 'anchor'
      })
    )
    expect(result.current.actions.openForkSourceSession).toBeUndefined()
  })

  it('uses the current Agent for imported authors while retaining source models and native author snapshots', () => {
    const snapshot = {
      id: 'source-session',
      name: 'Conversation title',
      emoji: '📄',
      model: { id: 'source-model', name: 'Source model', provider: 'source-provider' }
    }
    const messages: CherryUIMessage[] = [
      {
        id: 'imported',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Historical answer' }],
        metadata: {
          status: 'success',
          messageSnapshot: snapshot,
          provenance: { source: 'codex', sourceOrder: 2 }
        }
      },
      { id: 'native', role: 'assistant', parts: [], metadata: { messageSnapshot: snapshot } }
    ]
    const { result, rerender } = renderHook(
      ({ profile }) =>
        useAgentMessageListProviderValue({
          topic: {
            id: 'agent-session:source',
            assistantId: 'agent-1',
            name: 'Conversation title',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastActivityAt: '2026-01-01T00:00:00.000Z',
            messages: []
          },
          messages,
          partsByMessageId: {},
          assistantProfile: profile,
          messageNavigation: 'anchor',
          isLoading: false
        }),
      { initialProps: { profile: { name: 'Current Agent', avatar: '🤖' } } }
    )
    const imported = result.current.state.messages[0]
    expect(imported.messageSnapshot).toBeUndefined()
    expect(imported.model).toEqual(snapshot.model)
    expect(result.current.meta.assistantProfile).toEqual({ name: 'Current Agent', avatar: '🤖' })
    expect(result.current.state.messages[1].messageSnapshot).toEqual(snapshot)
    rerender({ profile: { name: 'Renamed Agent', avatar: '🍒' } })
    expect(result.current.meta.assistantProfile).toEqual({ name: 'Renamed Agent', avatar: '🍒' })
    expect(result.current.state.messages[0]).toBe(imported)
    expect(messages[0].metadata?.messageSnapshot).toEqual(snapshot)
  })

  it('hides generated WorkBuddy mode and clock reminders while keeping user quotations and other system context', () => {
    const reminder =
      '<system-reminder data-role="user-context">\n<craft_mode>You are now in Agent mode.</craft_mode>\n</system-reminder>\n<system-reminder data-role="additional-data"><current_time>Thursday, November 5</current_time></system-reminder>'
    const row = (id: string, role: CherryUIMessage['role'], text: string): CherryUIMessage => ({
      id,
      role,
      parts: [{ type: 'text', text }],
      metadata: { provenance: { source: 'workbuddy', sourceOrder: 1 } }
    })
    const messages = [
      row('task', 'user', 'Start'),
      row('generated', 'system', reminder),
      row('quoted', 'user', reminder),
      row('other', 'system', reminder + ' More context')
    ]
    const { result } = renderHook(() =>
      useAgentMessageListProviderValue({
        topic: {
          id: 'agent-session:source',
          assistantId: 'agent-1',
          name: 'Source',
          messages: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastActivityAt: '2026-01-01T00:00:00.000Z'
        },
        messages,
        partsByMessageId: {},
        isLoading: false,
        messageNavigation: 'anchor'
      })
    )
    expect(result.current.state.messages.map((message) => message.id)).toEqual(['task', 'quoted', 'other'])
  })
  it('hides only the imported preamble at the actual start, keeping mid-turn pages and normal messages', () => {
    const imported = (id: string, role: CherryUIMessage['role'], text: string): CherryUIMessage => ({
      id,
      role,
      parts: [{ type: 'text', text }],
      metadata: { provenance: { source: 'claude-code', sourceOrder: 1 } }
    })
    const preamble = imported('context', 'system', '[Historical local command]\n\n/model')
    const setup: CherryUIMessage = {
      ...imported('setup', 'user', 'Generated setup'),
      metadata: { provenance: { source: 'claude-code', sourceOrder: 1, isSetup: true } }
    }
    const user = imported('user', 'user', 'Explain this project')
    const answer = imported('answer', 'assistant', 'Project explanation')
    const laterContext = imported('later-context', 'system', 'Later context')
    const native: CherryUIMessage = {
      id: 'native',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Background task' }]
    }
    const messages = [native, preamble, setup, user, answer, laterContext]
    const { result, rerender } = renderHook(
      ({ hasOlder, history }) =>
        useAgentMessageListProviderValue({
          topic: {
            id: 'agent-session:source',
            assistantId: 'agent-1',
            name: 'Source',
            messages: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastActivityAt: '2026-01-01T00:00:00.000Z'
          },
          messages: history,
          partsByMessageId: {},
          isLoading: false,
          messageNavigation: 'anchor',
          hasOlder
        }),
      { initialProps: { hasOlder: true, history: messages } }
    )
    expect(result.current.state.messages.map((message) => message.id)).toEqual(messages.map((message) => message.id))
    rerender({ hasOlder: false, history: messages })
    expect(result.current.state.messages.map((message) => message.id)).toEqual([
      'native',
      'user',
      'answer',
      'later-context'
    ])
    expect(messages.map((message) => message.id)).toEqual([
      'native',
      'context',
      'setup',
      'user',
      'answer',
      'later-context'
    ])
    const followUp: CherryUIMessage = { id: 'follow-up', role: 'user', parts: [{ type: 'text', text: 'Continue' }] }
    rerender({ hasOlder: false, history: [setup, answer, followUp] })
    expect(result.current.state.messages.map((message) => message.id)).toEqual(['setup', 'answer', 'follow-up'])
    const toolResult = imported('tool-result', 'system', '[Historical tool result: Read]\n\nfile contents')
    const note = imported('note', 'system', 'Earlier session activity')
    rerender({ hasOlder: false, history: [setup, toolResult, note, answer, user, followUp] })
    expect(result.current.state.messages.map((message) => message.id)).toEqual([
      'tool-result',
      'note',
      'answer',
      'user',
      'follow-up'
    ])
  })

  it('adapts CherryUIMessage input and injects supported agent capabilities', async () => {
    const topic = {
      id: 'agent-session:session-1',
      assistantId: 'agent-1',
      name: 'Agent session',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic
    const messages = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        metadata: { createdAt: '2026-01-01T00:00:00.000Z' }
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'streaming reply' }],
        metadata: {
          parentId: 'user-1',
          createdAt: '2026-01-01T00:00:01.000Z',
          status: 'pending',
          messageSnapshot: {
            id: 'agent-1',
            name: 'My Agent',
            model: { id: 'claude-4', name: 'Claude 4', provider: 'anthropic' }
          }
        }
      }
    ] as CherryUIMessage[]
    const partsByMessageId = Object.fromEntries(messages.map((message) => [message.id, message.parts ?? []]))
    const deleteMessage = vi.fn()
    const respondToolApproval = vi.fn()
    const openArtifactFile = vi.fn()
    let value: MessageListProviderValue | undefined

    const Probe = () => {
      value = useAgentMessageListProviderValue({
        topic,
        messages,
        partsByMessageId,
        assistantId: 'agent-1',
        isLoading: false,
        openArtifactFile,
        deleteMessage,
        respondToolApproval,
        messageNavigation: 'anchor',
        workspacePath: '/tmp/workspace'
      })
      return null
    }

    render(<Probe />)

    expect(value?.state.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
    expect(value?.state.messages[1]).toMatchObject({
      role: 'assistant',
      parentId: 'user-1',
      status: 'pending',
      model: {
        id: 'claude-4',
        name: 'Claude 4',
        provider: 'anthropic'
      }
    })
    expect(value?.state.selection).toEqual({
      enabled: true,
      isMultiSelectMode: true,
      selectedMessageIds: ['user-1'],
      selectAllState: 'indeterminate',
      selectAllDisabled: false,
      isSelectAllLoading: false
    })

    expect(value?.actions.resolvePath?.('dist/report.md')).toBe('/tmp/workspace/dist/report.md')

    void value?.actions.openPath?.('dist/report.md')
    expect(ipcApiRequest).toHaveBeenCalledWith('ai.agent.session.open_path', {
      sessionId: 'session-1',
      path: 'dist/report.md'
    })

    ipcApiRequest.mockResolvedValueOnce({ kind: 'file' })
    await expect(value?.actions.isDirectory?.('dist/report.md')).resolves.toBe(false)
    expect(ipcApiRequest).toHaveBeenLastCalledWith('file.get_metadata', {
      kind: 'path',
      path: '/tmp/workspace/dist/report.md'
    })

    ipcApiRequest.mockResolvedValueOnce({ kind: 'directory' })
    await expect(value?.actions.isDirectory?.('dist')).resolves.toBe(true)
    expect(ipcApiRequest).toHaveBeenLastCalledWith('file.get_metadata', {
      kind: 'path',
      path: '/tmp/workspace/dist'
    })

    void value?.actions.navigateToRoute?.({ path: '/settings/provider', query: { id: 'provider-1' } })
    expect(openRouteMock).toHaveBeenCalledWith('/settings/provider', { id: 'provider-1' })

    const locateMessage = vi.fn()
    const startEditing = vi.fn()
    const unbindMessageRuntime = value?.actions.bindMessageRuntime?.('assistant-1', { locateMessage, startEditing })

    unbindMessageRuntime?.()

    const locateMessageGroup = vi.fn()
    value?.actions.bindMessageGroupRuntime?.(['user-1', 'assistant-1'], { locateMessage: locateMessageGroup })

    const listLocateMessage = vi.fn()
    const listRuntime = {
      scrollToBottom: vi.fn(),
      locateMessage: listLocateMessage,
      copyTopicImage: vi.fn(),
      exportTopicImage: vi.fn()
    } as MessageListRuntime
    const unbindRuntime = value?.actions.bindRuntime?.(listRuntime)

    vi.useFakeTimers()
    try {
      eventMocks.emit.mockClear()
      value?.actions.locateMessage?.('assistant-1', true)
      expect(listLocateMessage).toHaveBeenCalledWith('assistant-1')
      expect(eventMocks.emit).not.toHaveBeenCalled()

      vi.advanceTimersByTime(100)
      expect(eventMocks.emit).toHaveBeenCalledWith('LOCATE_MESSAGE:assistant-1', true)
    } finally {
      vi.useRealTimers()
      unbindRuntime?.()
    }

    eventMocks.emit.mockClear()
    value?.actions.locateMessage?.('assistant-1', true)
    expect(eventMocks.emit).toHaveBeenCalledWith('LOCATE_MESSAGE:assistant-1', true)
  })

  it('sends the raw path to main when the renderer has no workspace root of its own', () => {
    const topic = {
      id: 'agent-session:session-1',
      assistantId: 'agent-1',
      name: 'Agent session',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic

    let value: MessageListProviderValue | undefined
    const Probe = () => {
      value = useAgentMessageListProviderValue({
        topic,
        messages: [],
        partsByMessageId: {},
        assistantId: 'agent-1',
        isLoading: false,
        messageNavigation: 'anchor'
        // no workspacePath — a session whose workspace has not resolved yet
      })
      return null
    }
    render(<Probe />)

    void value?.actions.openPath?.('dist/report.md')
    expect(ipcApiRequest).toHaveBeenCalledWith('ai.agent.session.open_path', {
      sessionId: 'session-1',
      path: 'dist/report.md'
    })
    expect(ipcApiRequest.mock.calls.map(([route]) => route)).not.toContain('system.shell.open_path')
  })

  it('injects Agent-session diagnosis persistence into the shared error UI', async () => {
    const topic = {
      id: 'agent-session:session-1',
      assistantId: 'agent-1',
      name: 'Agent session',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic
    dataApiMocks.get.mockResolvedValue({
      data: { parts: [{ type: 'data-error', data: { name: 'AgentRuntimeError', message: 'failed' } }] }
    })
    const diagnosticReport = { location: 'Interactive Agent conversation' }

    const Probe = () => {
      const params = {
        topic,
        messages: [],
        partsByMessageId: {},
        diagnosticReport,
        isLoading: false,
        messageNavigation: 'anchor'
      }
      useAgentMessageListProviderValue(params)
      return null
    }
    render(<Probe />)

    const options = useMessageErrorActionsMock.mock.calls.at(-1)?.[0] as {
      diagnosticReport: { location: string }
      getDoctorSubject: (message?: { model?: { id: string; provider: string; name: string } }) => unknown
    }
    expect(options.getDoctorSubject()).toEqual({ kind: 'agent', agentId: topic.assistantId })
    expect(
      options.getDoctorSubject({
        model: { id: 'deepseek-v4-flash', provider: 'deepseek', name: 'DeepSeek V4 Flash' }
      })
    ).toEqual({
      kind: 'agent',
      agentId: topic.assistantId,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash'
    })
  })

  it('keeps intermediate assistant text visible in Agent sessions', () => {
    const topic = {
      id: 'agent-session:session-1',
      assistantId: 'agent-1',
      name: 'Agent session',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic
    let value: MessageListProviderValue | undefined

    const Probe = () => {
      value = useAgentMessageListProviderValue({
        topic,
        messages: [],
        partsByMessageId: {},
        isLoading: false,
        messageNavigation: 'none'
      })
      return null
    }

    render(<Probe />)

    expect(value?.state.renderConfig.keepIntermediateAssistantText).toBe(true)
    expect(value?.state.renderConfig.expandToolSteps).toBe(false)
    expect(value?.state.renderConfig.expandLiveToolSteps).toBe(true)
  })

  it('keeps the Agent render configuration stable across streamed deltas and refreshes changed preferences', () => {
    const topic = {
      id: 'agent-session:session-1',
      assistantId: 'agent-1',
      name: 'Agent session',
      messages: []
    } as unknown as Topic
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAgentMessageListProviderValue({
          topic,
          messages,
          partsByMessageId: {},
          isLoading: false,
          messageNavigation: 'none'
        }),
      { initialProps: { messages: [] as CherryUIMessage[] } }
    )
    const initial = result.current.state.renderConfig
    for (let i = 0; i < 10; i++) {
      rerender({
        messages: [
          { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'delta ' + i }] }
        ] as CherryUIMessage[]
      })
      expect(result.current.state.renderConfig).toBe(initial)
    }
    const previous = renderConfiguration.renderConfig
    renderConfiguration.renderConfig = { ...previous, fontSize: 18 }
    try {
      rerender({ messages: [] })
      expect(result.current.state.renderConfig).not.toBe(initial)
      expect(result.current.state.renderConfig.fontSize).toBe(18)
      expect(result.current.state.renderConfig.keepIntermediateAssistantText).toBe(true)
      expect(result.current.state.renderConfig.expandToolSteps).toBe(false)
      expect(result.current.state.renderConfig.expandLiveToolSteps).toBe(true)
    } finally {
      renderConfiguration.renderConfig = previous
    }
  })

  it('renders terminal fallbacks in both current and sealed history layers', () => {
    const topic = {
      id: 'agent-session:session-1',
      assistantId: 'agent-1',
      name: 'Agent session',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic
    const messages = [
      ...(['TIMEOUT', 'INCOMPLETE', 'CONTENT_FILTER', 'FINISHED'] as const).map((status) => ({
        id: `imported-${status}`,
        role: 'assistant',
        parts: status === 'TIMEOUT' ? [{ type: 'text', text: 'Preserved partial answer' }] : [],
        metadata: {
          status: status === 'FINISHED' ? 'success' : 'error',
          importedHistory: { source: 'deepseek', messageId: '2', status }
        }
      })),
      {
        id: 'assistant-error',
        role: 'assistant',
        parts: [],
        metadata: { createdAt: '2026-01-01T00:00:00.000Z', status: 'error' }
      },
      {
        id: 'assistant-empty-success',
        role: 'assistant',
        parts: [],
        metadata: { createdAt: '2026-01-01T00:00:01.000Z', status: 'success' }
      },
      {
        id: 'assistant-pending',
        role: 'assistant',
        parts: [],
        metadata: { createdAt: '2026-01-01T00:00:02.000Z', status: 'pending' }
      },
      {
        id: 'assistant-hidden-success',
        role: 'assistant',
        parts: [{ type: 'data-agent-task-event', data: {} }],
        metadata: { createdAt: '2026-01-01T00:00:03.000Z', status: 'success' }
      }
    ] as CherryUIMessage[]
    const partsByMessageId = Object.fromEntries(messages.map((message) => [message.id, message.parts ?? []]))
    const streamingLayers = { historyPartsByMessageId: partsByMessageId, liveMessageIds: [] }
    let value: MessageListProviderValue | undefined

    const Probe = () => {
      value = useAgentMessageListProviderValue({
        topic,
        messages,
        partsByMessageId,
        streamingLayers,
        isLoading: false,
        messageNavigation: 'none'
      })
      return null
    }

    render(<Probe />)

    for (const status of ['TIMEOUT', 'INCOMPLETE', 'CONTENT_FILTER', 'FINISHED']) {
      const expected = [
        ...(status === 'TIMEOUT' ? [{ type: 'text', text: 'Preserved partial answer' }] : []),
        { type: 'data-imported-status', data: { status } }
      ]
      expect(messagePartsAt(value?.state.partsByMessageId, `imported-${status}`)).toEqual(expected)
      expect(messagePartsAt(value?.state.streamingLayers?.historyPartsByMessageId, `imported-${status}`)).toEqual(
        expected
      )
    }
    expect(messagePartsAt(value?.state.partsByMessageId, 'assistant-error')).toEqual([
      expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ message: expect.any(String) }) })
    ])
    expect(messagePartsAt(value?.state.partsByMessageId, 'assistant-empty-success')).toEqual([
      expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ message: expect.any(String) }) })
    ])
    expect(messagePartsAt(value?.state.partsByMessageId, 'assistant-pending')).toEqual([])
    expect(messagePartsAt(value?.state.partsByMessageId, 'assistant-hidden-success')).toEqual([
      expect.objectContaining({ type: 'data-agent-task-event' }),
      expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ message: expect.any(String) }) })
    ])
    expect(messagePartsAt(value?.state.streamingLayers?.historyPartsByMessageId, 'assistant-error')).toEqual([
      expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ message: expect.any(String) }) })
    ])
    expect(messagePartsAt(value?.state.streamingLayers?.historyPartsByMessageId, 'assistant-hidden-success')).toEqual([
      expect.objectContaining({ type: 'data-agent-task-event' }),
      expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ message: expect.any(String) }) })
    ])
    expect(value?.state.streamingLayers?.liveMessageIds).toEqual([])
  })

  describe('Agent delete presentation policy', () => {
    const topic = {
      id: 'agent-session:policy',
      assistantId: 'agent-1',
      name: 'Policy',
      messages: []
    } as unknown as Topic
    const messages: CherryUIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'question' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }
    ]
    const renderPolicyAdapter = () => {
      cacheHookMocks.setSelectedMessageIds.mockImplementation((value) => {
        cacheHookMocks.selectedMessageIds =
          typeof value === 'function' ? value(cacheHookMocks.selectedMessageIds) : value
      })
      return renderHook(() =>
        useAgentMessageListProviderValue({
          topic,
          messages,
          partsByMessageId: Object.fromEntries(messages.map((message) => [message.id, message.parts ?? []])),
          isLoading: false,
          messageNavigation: 'anchor',
          deleteMessage: vi.fn()
        })
      )
    }

    it('allows deletion presentation for the returned user item', () => {
      const { result } = renderPolicyAdapter()
      const user = result.current.state.messages.find((message) => message.role === 'user')!
      expect(result.current.actions.canDeleteMessage?.(user)).toBe(true)
    })

    it('denies deletion presentation for the returned assistant item', () => {
      const { result } = renderPolicyAdapter()
      const assistant = result.current.state.messages.find((message) => message.role === 'assistant')!
      expect(result.current.actions.canDeleteMessage?.(assistant)).toBe(false)
      expect(result.current.actions.deleteMessage).toBeDefined()
    })

    it('hides selected delete for an assistant through the real capabilities and controller chain', () => {
      const { result, rerender } = renderPolicyAdapter()
      act(() => result.current.actions.selectMessage?.('assistant-1', true))
      rerender()
      expect(result.current.state.selection?.selectedMessageIds).toEqual(['assistant-1'])
      expect(result.current.actions.deleteSelectedMessages).toBeUndefined()
      expect(result.current.actions.copySelectedMessages).toBeDefined()
    })

    it('restores selected delete when only the user remains through the real capabilities and controller chain', () => {
      const { result, rerender } = renderPolicyAdapter()
      act(() => {
        result.current.actions.selectMessage?.('assistant-1', true)
        result.current.actions.selectMessage?.('user-1', true)
      })
      rerender()
      act(() => result.current.actions.selectMessage?.('assistant-1', false))
      rerender()
      expect(result.current.state.selection?.selectedMessageIds).toEqual(['user-1'])
      expect(result.current.actions.deleteSelectedMessages).toBeDefined()
    })
  })

  it('does not expose selected delete action without delete capability', () => {
    const topic = {
      id: 'agent-session:session-1',
      assistantId: 'agent-1',
      name: 'Agent session',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic
    const messages = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        metadata: { createdAt: '2026-01-01T00:00:00.000Z' }
      }
    ] as CherryUIMessage[]
    let value: MessageListProviderValue | undefined

    const Probe = () => {
      value = useAgentMessageListProviderValue({
        topic,
        messages,
        partsByMessageId: { 'user-1': messages[0].parts ?? [] },
        assistantId: 'agent-1',
        isLoading: false,
        messageNavigation: 'anchor'
      })
      return null
    }

    render(<Probe />)

    expect(value?.actions.deleteMessage).toBeUndefined()
    expect(value?.actions.deleteSelectedMessages).toBeUndefined()
  })

  it('does not show a toast when selected-message save is canceled', async () => {
    const topic = {
      id: 'agent-session:session-1',
      assistantId: 'agent-1',
      name: 'Agent session',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic
    const messages = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        metadata: { createdAt: '2026-01-01T00:00:00.000Z' }
      }
    ] as CherryUIMessage[]
    let value: MessageListProviderValue | undefined

    exportActionsMock.saveTextFile.mockResolvedValue(null)

    const Probe = () => {
      value = useAgentMessageListProviderValue({
        topic,
        messages,
        partsByMessageId: { 'user-1': messages[0].parts ?? [] },
        assistantId: 'agent-1',
        isLoading: false,
        messageNavigation: 'anchor'
      })
      return null
    }

    render(<Probe />)
    cacheHookMocks.setMultiSelectMode.mockClear()
    cacheHookMocks.setSelectedMessageIds.mockClear()

    await value?.actions.saveSelectedMessages?.(['user-1'])

    expect(exportActionsMock.saveTextFile).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(cacheHookMocks.setMultiSelectMode).not.toHaveBeenCalled()
    expect(cacheHookMocks.setSelectedMessageIds).not.toHaveBeenCalled()
  })

  it('keeps capture-scoped session image actions away from the visible runtime', async () => {
    const topic = {
      id: 'agent-session:session-a',
      assistantId: 'agent-1',
      name: 'Agent session',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: []
    } as Topic
    const messages = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        metadata: { createdAt: '2026-01-01T00:00:00.000Z' }
      }
    ] as CherryUIMessage[]
    let visibleValue: MessageListProviderValue | undefined
    let captureValue: MessageListProviderValue | undefined

    const VisibleProbe = () => {
      visibleValue = useAgentMessageListProviderValue({
        topic,
        messages,
        partsByMessageId: { 'user-1': messages[0].parts ?? [] },
        assistantId: 'agent-1',
        isLoading: false,
        messageNavigation: 'anchor'
      })
      return null
    }

    const CaptureProbe = () => {
      captureValue = useAgentMessageListProviderValue({
        topic,
        messages,
        partsByMessageId: { 'user-1': messages[0].parts ?? [] },
        assistantId: 'agent-1',
        isLoading: false,
        imageActionConsumer: 'capture',
        messageNavigation: 'anchor'
      })
      return null
    }

    render(<VisibleProbe />)

    const visibleRuntime: MessageListRuntime = {
      copyTopicImage: vi.fn().mockResolvedValue(undefined),
      exportTopicImage: vi.fn().mockResolvedValue(undefined),
      locateMessage: vi.fn(),
      scrollToBottom: vi.fn()
    }
    const unbindVisible = visibleValue?.actions.bindRuntime?.(visibleRuntime)
    const request = requestAgentSessionImageAction('copy', { id: 'session-a', name: 'Session A' })
    const unbindVisibleRebound = visibleValue?.actions.bindRuntime?.(visibleRuntime)

    expect(visibleRuntime.copyTopicImage).not.toHaveBeenCalled()

    render(<CaptureProbe />)

    const captureRuntime: MessageListRuntime = {
      copyTopicImage: vi.fn().mockResolvedValue(undefined),
      exportTopicImage: vi.fn().mockResolvedValue(undefined),
      locateMessage: vi.fn(),
      scrollToBottom: vi.fn()
    }
    const unbindCapture = captureValue?.actions.bindRuntime?.(captureRuntime)

    await expect(request.promise).resolves.toBeUndefined()
    expect(captureRuntime.copyTopicImage).toHaveBeenCalledTimes(1)

    expect(consumePendingAgentSessionImageActions('session-a')).toEqual([])

    unbindCapture?.()
    unbindVisibleRebound?.()
    unbindVisible?.()
  })

  describe('live projection part preservation', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

    async function setupProjectedRow(topicId: string, messageId: string) {
      const ipc = projectionIpc()
      const target = { kind: 'topic', topicId } as const
      const release = messageProjectionService.subscribe(target, () => {})
      try {
        const attachment = ipc.attachments[0]
        attachment.resolve({
          kind: 'topic',
          topicId,
          revision: 0,
          executions: [],
          messages: [{ id: messageId, role: 'assistant', parts: [], partIds: [] }]
        })
        await flush()

        ipc.emit(attachment.subscriptionId, {
          kind: 'topic',
          type: 'parts',
          revision: 1,
          patches: [
            { type: 'part-open', messageId, partId: 'reason-1', kind: 'reasoning', pos: 1 },
            { type: 'part-append', partId: 'reason-1', text: 'Agent reasoning' },
            { type: 'part-finish', partId: 'reason-1' },
            { type: 'part-open', messageId, partId: 'text-1', kind: 'text', pos: 2 },
            { type: 'part-append', partId: 'text-1', text: 'Agent answer' },
            { type: 'part-finish', partId: 'text-1' }
          ]
        })

        return { shellParts: messageProjectionService.getSnapshot(target).view!.messages[0].parts, release }
      } catch (error) {
        release()
        throw error
      }
    }

    it('preserves messageProjectionService-owned parts across terminal success without injecting a fallback error', async () => {
      const { shellParts, release } = await setupProjectedRow('agent_session_session-1', 'assistant-live')
      try {
        const message: CherryUIMessage = {
          id: 'assistant-live',
          role: 'assistant',
          parts: [],
          metadata: { createdAt: '2026-01-01T00:00:00.000Z', status: 'success' }
        }
        const { result } = renderHook(() =>
          useAgentMessageListProviderValue({
            topic: { id: 'agent-session:session-1', name: 'Session', messages: [] } as unknown as Topic,
            messages: [message],
            partsByMessageId: { 'assistant-live': shellParts },
            isLoading: false,
            messageNavigation: 'none'
          })
        )

        const displayParts = messagePartsAt(result.current.state.partsByMessageId, 'assistant-live')
        expect(displayParts).toBe(shellParts)
        expect(messageProjectionService.ownsRowParts(displayParts!)).toBe(true)
        expect(messageProjectionService.readParts(displayParts!)).toEqual([
          { type: 'reasoning', text: 'Agent reasoning', state: 'done' },
          { type: 'text', text: 'Agent answer', state: 'done' }
        ])
      } finally {
        release()
      }
    })

    it('keeps live reasoning and text parts when appending a fallback data-error for a failed turn', async () => {
      const { shellParts, release } = await setupProjectedRow('agent_session_session-2', 'assistant-failed')
      try {
        const message: CherryUIMessage = {
          id: 'assistant-failed',
          role: 'assistant',
          parts: [],
          metadata: { createdAt: '2026-01-01T00:00:00.000Z', status: 'error' }
        }
        const { result } = renderHook(() =>
          useAgentMessageListProviderValue({
            topic: { id: 'agent-session:session-2', name: 'Session', messages: [] } as unknown as Topic,
            messages: [message],
            partsByMessageId: { 'assistant-failed': shellParts },
            isLoading: false,
            messageNavigation: 'none'
          })
        )

        const displayParts = messagePartsAt(result.current.state.partsByMessageId, 'assistant-failed')
        expect(displayParts).toEqual([
          { type: 'reasoning', text: 'Agent reasoning', state: 'done' },
          { type: 'text', text: 'Agent answer', state: 'done' },
          expect.objectContaining({ type: 'data-error', data: expect.objectContaining({ name: 'AgentRuntimeError' }) })
        ])
      } finally {
        release()
      }
    })
  })
})
