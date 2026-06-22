import { cacheService } from '@data/CacheService'
import type { FileMetadata, LocalSkill } from '@renderer/types'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '../../ComposerSurface'
import type { ComposerSerializedToken } from '../../tokens'
import AgentComposer, { AgentHomeComposer, MissingAgentHomeComposer } from '../AgentComposer'

const mocks = vi.hoisted(() => ({
  draftText: 'hello',
  draftTokens: undefined as ComposerSerializedToken[] | undefined,
  files: [] as FileMetadata[],
  modelLookupId: undefined as UniqueModelId | undefined,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  isDirectory: vi.fn(),
  listDirectory: vi.fn(),
  createInternalEntry: vi.fn(),
  getPhysicalPath: vi.fn(),
  getMetadata: vi.fn(),
  updateModel: vi.fn(),
  updateSession: vi.fn(),
  setFiles: vi.fn(),
  reconcileTokens: vi.fn(),
  insertToken: vi.fn(),
  availableSkills: [] as LocalSkill[],
  availableSkillsRefresh: vi.fn(),
  contextUsagePercentage: null as number | null,
  surfaceProps: undefined as ComposerSurfaceProps | undefined,
  derivedToolState: undefined as { couldAddImageFile: boolean; extensions: string[] } | undefined,
  shortcutHandlers: new Map<string, () => void>(),
  shortcutOptions: new Map<string, Record<string, unknown> | undefined>(),
  ipcListeners: new Map<string, (_event: unknown, payload: unknown) => void>(),
  ipcOn: vi.fn(),
  runtimeHostProps: undefined as
    | { assistant?: { modelId?: string | null }; model?: Model; session?: { agentId?: string } }
    | undefined
}))

const originalResizeObserver = globalThis.ResizeObserver

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  target?: Element
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

const resizeObserverMockInstances: ResizeObserverMockInstance[] = []

const model = {
  id: 'anthropic::claude-sonnet-4-5',
  providerId: 'anthropic',
  apiModelId: 'claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} satisfies Model

const file = {
  id: 'file-1',
  fileTokenSourceId: 'source-file-1',
  name: 'notes.md',
  origin_name: 'notes.md',
  path: '/tmp/notes.md'
} as FileMetadata

const pdfSkill = {
  name: 'pdf',
  description: 'Read and analyze PDFs',
  filename: 'pdf'
} satisfies LocalSkill
const reviewSkill = {
  name: 'Review (fast)',
  description: 'Review changed files',
  filename: 'review-fast'
} satisfies LocalSkill

const pdfSkillToken = {
  id: 'skill:pdf',
  kind: 'skill',
  label: 'pdf',
  description: 'Read and analyze PDFs',
  promptText: 'Use the pdf skill.',
  payload: pdfSkill
} as const

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn(() => ''),
    setCasual: vi.fn()
  }
}))

vi.mock('@renderer/components/chat/composer/ComposerSurface', () => {
  function MockComposerSurface(props: ComposerSurfaceProps) {
    useEffect(() => {
      props.onActionsChange?.({
        focus: vi.fn(),
        onTextChange: (updater) => {
          const nextText = typeof updater === 'function' ? updater(props.text) : updater
          props.onTextChange(nextText)
        },
        toggleExpanded: vi.fn(),
        removeToken: vi.fn(),
        insertToken: mocks.insertToken,
        getDraft: () => ({ text: props.text, tokens: [...(props.draftTokens ?? [])] })
      })
    }, [props])

    mocks.surfaceProps = props
    return (
      <div>
        <div data-testid="composer-left-controls">{props.renderLeftControls?.(undefined)}</div>
        <div data-testid="composer-below-controls">{props.renderBelowControls?.(undefined)}</div>
        <div data-testid="composer-send-accessory">{props.sendAccessory}</div>
        <button
          type="button"
          onClick={() =>
            props.onSendDraft({
              text: mocks.draftText,
              tokens:
                mocks.draftTokens ??
                mocks.files.map((currentFile, index) => ({
                  id: `file:${currentFile.fileTokenSourceId}`,
                  kind: 'file',
                  label: currentFile.name,
                  payload: currentFile,
                  index,
                  textOffset: mocks.draftText.length
                }))
            })
          }>
          send
        </button>
        <button type="button" onClick={() => props.onPause()}>
          pause
        </button>
      </div>
    )
  }

  return {
    default: MockComposerSurface
  }
})

vi.mock('@renderer/components/chat/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ComposerToolDerivedStateProvider: ({
    children,
    couldAddImageFile,
    extensions
  }: {
    children: ReactNode
    couldAddImageFile: boolean
    extensions: string[]
  }) => {
    mocks.derivedToolState = { couldAddImageFile, extensions }
    return <>{children}</>
  },
  ComposerToolRuntimeHost: (props: {
    assistant?: { modelId?: string | null }
    model?: Model
    session?: { agentId?: string }
  }) => {
    mocks.runtimeHostProps = props
    return null
  },
  ComposerToolMenu: () => null,
  ComposerActiveToolControls: () => null,
  useComposerToolState: () => ({
    files: mocks.files,
    mentionedModels: [],
    selectedKnowledgeBases: [],
    isExpanded: false,
    couldAddImageFile: false,
    extensions: []
  }),
  useComposerToolDispatch: () => ({
    setFiles: mocks.setFiles,
    setIsExpanded: vi.fn(),
    addNewTopic: vi.fn(),
    onTextChange: vi.fn(),
    toolsRegistry: {
      registerLaunchers: vi.fn(() => vi.fn())
    },
    triggers: {
      getLaunchers: vi.fn(() => []),
      version: 0
    }
  }),
  useComposerToolLauncherController: () => ({
    getLaunchers: vi.fn(() => []),
    dispatchLauncher: vi.fn()
  }),
  useComposerToolLauncherActions: () => ({
    getLaunchers: vi.fn(() => []),
    dispatchLauncher: vi.fn()
  }),
  useComposerTokenReconcile: () => mocks.reconcileTokens
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: () => ({
    agent: {
      id: 'agent-1',
      name: 'Agent',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet-4-5',
      modelName: 'Claude Sonnet 4.5',
      instructions: 'Follow instructions',
      configuration: {}
    }
  }),
  useUpdateAgent: () => ({ updateModel: mocks.updateModel })
}))

vi.mock('@renderer/hooks/agents/useAgentModelFilter', () => ({
  useAgentModelFilter: () => undefined
}))

vi.mock('@renderer/hooks/agents/useAgentSessionContextUsage', () => ({
  useAgentSessionContextUsage: () => ({
    usage:
      mocks.contextUsagePercentage === null
        ? null
        : {
            categories: [],
            totalTokens: 42,
            maxTokens: 100,
            rawMaxTokens: 100,
            percentage: mocks.contextUsagePercentage,
            gridRows: [],
            model: 'agent/deepseek-v4-flash',
            memoryFiles: [],
            mcpTools: [],
            agents: [],
            isAutoCompactEnabled: false,
            apiUsage: null
          },
    percentage: mocks.contextUsagePercentage
  })
}))

vi.mock('@renderer/hooks/agents/useAgentSessionCompaction', () => ({
  useAgentSessionCompaction: () => ({ status: 'idle' })
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSession: () => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      accessiblePaths: ['/workspace'],
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: 'Workspace 1',
        path: '/workspace',
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
  }),
  useUpdateSession: () => ({ updateSession: mocks.updateSession })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (id: UniqueModelId) => {
    mocks.modelLookupId = id
    return { model }
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => 'Anthropic'
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useAvailableSkills: () => ({
    skills: mocks.availableSkills,
    loading: false,
    error: null,
    refresh: mocks.availableSkillsRefresh
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false, isFulfilled: false, markSeen: () => {} })
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (key: string, handler: () => void, options?: Record<string, unknown>) => {
    mocks.shortcutHandlers.set(key, handler)
    mocks.shortcutOptions.set(key, options)
  }
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/Selector/model', () => ({
  ModelSelector: ({ onSelect, trigger, open, onOpenChange, shortcut }: any) => (
    <div data-testid="agent-model-selector" data-open={String(Boolean(open))} data-shortcut={shortcut ?? ''}>
      {trigger}
      {onOpenChange ? (
        <>
          <button type="button" onClick={() => onOpenChange(true)}>
            open agent model selector popup
          </button>
          <button type="button" onClick={() => onOpenChange(false)}>
            close agent model selector popup
          </button>
        </>
      ) : null}
      <button type="button" onClick={() => onSelect({ id: 'anthropic::claude-opus-4', name: 'Claude Opus 4' })}>
        select model 2
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/resource', () => ({
  AgentSelector: ({ autoSelectOnCreate, onChange, trigger }: any) => (
    <div data-testid="agent-selector" data-auto-select-on-create={String(Boolean(autoSelectOnCreate))}>
      {trigger}
      <button type="button" onClick={() => onChange('agent-2')}>
        select agent 2
      </button>
    </div>
  ),
  WorkspaceSelector: ({ onChange, trigger }: any) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('workspace-2')}>
        select workspace 2
      </button>
    </div>
  )
}))

vi.mock('@renderer/pages/agents/AgentSettings/shared', () => ({
  AgentLabel: ({ agent }: any) => <span>{agent.name}</span>,
  isSoulModeEnabled: () => false
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'app.spell_check.enabled': true,
      'chat.message.font_size': 14,
      'chat.narrow_mode': false,
      'chat.input.send_message_shortcut': 'Enter'
    }
    return [values[key]]
  }
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn(),
    clearTimeoutTimer: vi.fn()
  })
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18nextModule>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

describe('AgentComposer', () => {
  beforeEach(() => {
    resizeObserverMockInstances.length = 0
    globalThis.ResizeObserver = vi.fn((callback: ResizeObserverCallback) => {
      const instance: ResizeObserverMockInstance = {
        callback,
        observe: vi.fn((target: Element) => {
          instance.target = target
        }),
        disconnect: vi.fn()
      }
      resizeObserverMockInstances.push(instance)

      return {
        observe: instance.observe,
        disconnect: instance.disconnect
      } as unknown as ResizeObserver
    }) as unknown as typeof ResizeObserver

    mocks.draftText = 'hello'
    mocks.draftTokens = undefined
    mocks.files = []
    mocks.modelLookupId = undefined
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockResolvedValue(undefined)
    mocks.stop.mockReset()
    mocks.stop.mockResolvedValue(undefined)
    mocks.isDirectory.mockReset()
    mocks.isDirectory.mockImplementation(() => new Promise(() => undefined))
    mocks.listDirectory.mockReset()
    mocks.listDirectory.mockResolvedValue([])
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.getCasual).mockReturnValue('')
    vi.mocked(cacheService.setCasual).mockReset()
    mocks.createInternalEntry.mockReset()
    mocks.createInternalEntry.mockResolvedValue({ id: 'fe-1', ext: 'png' })
    mocks.getPhysicalPath.mockReset()
    mocks.getPhysicalPath.mockResolvedValue('/p/fe-1.png')
    mocks.getMetadata.mockReset()
    mocks.getMetadata.mockResolvedValue({ kind: 'file', mime: 'text/markdown', size: 1, mtime: 0 })
    window.api = {
      ...window.api,
      file: {
        ...window.api.file,
        isDirectory: mocks.isDirectory,
        listDirectory: mocks.listDirectory,
        createInternalEntry: mocks.createInternalEntry,
        getPhysicalPath: mocks.getPhysicalPath,
        getMetadata: mocks.getMetadata
      }
    }
    mocks.updateModel.mockReset()
    mocks.updateSession.mockReset()
    mocks.setFiles.mockReset()
    mocks.insertToken.mockReset()
    mocks.availableSkills = []
    mocks.availableSkillsRefresh.mockReset()
    mocks.availableSkillsRefresh.mockResolvedValue(undefined)
    mocks.contextUsagePercentage = null
    mocks.surfaceProps = undefined
    mocks.derivedToolState = undefined
    mocks.runtimeHostProps = undefined
    mocks.shortcutHandlers.clear()
    mocks.shortcutOptions.clear()
    mocks.ipcListeners.clear()
    mocks.ipcOn.mockReset()
    mocks.ipcOn.mockImplementation((channel: string, listener: (_event: unknown, payload: unknown) => void) => {
      mocks.ipcListeners.set(channel, listener)
      return () => mocks.ipcListeners.delete(channel)
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          on: mocks.ipcOn
        }
      }
    })
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('resolves the agent model through the v2 UniqueModelId', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.modelLookupId).toBe('anthropic::claude-sonnet-4-5')
    expect(mocks.runtimeHostProps?.model).toBe(model)
    expect(mocks.runtimeHostProps?.session?.agentId).toBe('agent-1')
  })

  it('restores the draft instead of silently dropping it when a direct send fails', async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error('send failed'))

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    act(() => {
      mocks.surfaceProps?.onTextChange('draft message')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('draft message'))

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'draft message', tokens: [] })
    })

    expect(mocks.sendMessage).toHaveBeenCalled()
    // Without the restore the optimistic clear would leave this '' — the user's text is kept.
    expect(mocks.surfaceProps?.text).toBe('draft message')
  })

  it('re-persists skill draft tokens to the cache when a direct send fails', async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error('send failed'))
    const cachedTokens = [{ ...pdfSkillToken, index: 0, textOffset: 0 }]
    vi.mocked(cacheService.getCasual).mockReturnValue({ text: 'analyze this. continue', tokens: cachedTokens })

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )
    await waitFor(() => expect(mocks.surfaceProps?.draftTokens).toEqual(cachedTokens))

    // Isolate the post-send write from the mount-time cache writes.
    vi.mocked(cacheService.setCasual).mockClear()
    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'analyze this. continue', tokens: cachedTokens })
    })

    expect(mocks.sendMessage).toHaveBeenCalled()
    // The optimistic clear wrote tokens: []; the failed-send restore must rewrite the skill
    // tokens, otherwise a remount would silently drop the restored skill.
    const lastWrite = vi.mocked(cacheService.setCasual).mock.calls.at(-1)
    expect(lastWrite?.[1]).toEqual(expect.objectContaining({ text: 'analyze this. continue', tokens: cachedTokens }))
  })

  it('passes the chat model shortcut to the model selector', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('agent-model-selector')).toHaveAttribute('data-shortcut', 'chat.model.select')
  })

  it('routes new session shortcuts through the explicit parent action', () => {
    const onNewSessionDraft = vi.fn()

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onNewSessionDraft={onNewSessionDraft}
        isStreaming={false}
      />
    )

    mocks.shortcutHandlers.get('topic.create')?.()

    expect(onNewSessionDraft).toHaveBeenCalledTimes(1)
  })

  it('passes attachment capabilities through the provider without effect mirroring', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.derivedToolState).toEqual({
      couldAddImageFile: false,
      extensions: mocks.surfaceProps?.supportedExts
    })
  })

  it('renders context usage next to the send action when cached usage exists', async () => {
    mocks.contextUsagePercentage = 42

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const indicator = screen.getByLabelText('agent.right_pane.info.context_usage 42%')
    expect(indicator).toBeInTheDocument()
    expect(indicator).not.toHaveTextContent('42%')
    expect(indicator).toHaveAttribute('style', expect.stringContaining('--context-usage-progress: 42%'))
    expect(indicator).toHaveAttribute('style', expect.stringContaining('color-mix(in oklch'))

    await waitFor(() => expect(screen.getByText('42 / 100 (42%)')).toBeInTheDocument())
    expect(screen.getByText('agent/deepseek-v4-flash')).toBeInTheDocument()
  })

  it('provides workspace resources through the mention suggestion source', async () => {
    mocks.listDirectory.mockResolvedValue(['/workspace/docs/notes.md', '/workspace/docs/notes.md'])

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const resourceSource = mocks.surfaceProps?.suggestionSources?.[0]
    expect(resourceSource).toEqual(
      expect.objectContaining({
        char: '@',
        pluginKey: 'agent-resource-mention-suggestion'
      })
    )

    const items = await resourceSource?.items({ query: 'notes', editor: {} as any })
    expect(mocks.listDirectory).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({
        recursive: true,
        maxDepth: 3,
        searchPattern: 'notes'
      })
    )
    expect(items).toHaveLength(1)
    const item = items?.[0]
    expect(items?.[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^file:.+/),
        label: 'docs/notes.md',
        description: '/workspace/docs/notes.md',
        disabled: false
      })
    )
    expect(item?.id).not.toContain('/workspace/docs/notes.md')

    const run = vi.fn()
    const insertContent = vi.fn(() => ({ run }))
    const insertComposerToken = vi.fn(() => ({ insertContent }))
    const editor = {
      getJSON: () => ({ type: 'doc', content: [] }),
      chain: () => ({
        focus: () => ({
          insertComposerToken
        })
      })
    }

    items?.[0]?.command({ editor: editor as any, range: { from: 1, to: 7 }, item: items[0], query: 'notes' })

    expect(insertComposerToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: item?.id,
        kind: 'file',
        label: 'notes.md',
        payload: expect.objectContaining({
          fileTokenSourceId: item?.id.slice('file:'.length),
          path: '/workspace/docs/notes.md'
        })
      })
    )
    expect(insertContent).toHaveBeenCalledWith(' ')
    expect(run).toHaveBeenCalled()

    const setFilesUpdater = mocks.setFiles.mock.calls.at(-1)?.[0]
    expect(typeof setFilesUpdater).toBe('function')
    const selectedFile = { id: '/workspace/docs/notes.md', path: '/workspace/docs/notes.md' } as FileMetadata
    expect(setFilesUpdater([])).toEqual([
      expect.objectContaining({
        fileTokenSourceId: item?.id.slice('file:'.length),
        path: '/workspace/docs/notes.md'
      })
    ])
    expect(setFilesUpdater([selectedFile])).toBeInstanceOf(Array)
    expect(setFilesUpdater([selectedFile])).toHaveLength(1)
  })

  it('marks already selected workspace resources as disabled', async () => {
    mocks.files = [
      {
        fileTokenSourceId: 'source-notes',
        name: 'notes.md',
        origin_name: 'notes.md',
        path: '/workspace/docs/notes.md'
      } as FileMetadata
    ]
    mocks.listDirectory.mockResolvedValue(['/workspace/docs/notes.md'])

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const items = await mocks.surfaceProps?.suggestionSources?.[0]?.items({ query: 'notes', editor: {} as any })
    expect(items?.[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^file:.+/),
        disabled: true
      })
    )
    expect(items?.[0]?.id).not.toContain('/workspace/docs/notes.md')
  })

  it('passes available skills as additional slash panel rows', () => {
    mocks.availableSkills = [pdfSkill]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const skillItem = mocks.surfaceProps?.rootPanelAdditionalItems?.[0]
    expect(skillItem).toEqual(
      expect.objectContaining({
        id: 'skill:pdf',
        label: 'pdf',
        description: 'Read and analyze PDFs',
        suffix: 'plugins.skills',
        filterText: expect.stringContaining('pdf Read and analyze PDFs plugins.skills')
      })
    )
    expect(mocks.surfaceProps?.managedTokenKinds).toEqual(['file', 'skill'])
    mocks.surfaceProps?.onRootPanelOpen?.()
    expect(mocks.availableSkillsRefresh).toHaveBeenCalledOnce()

    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      insertToken: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    skillItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: skillItem,
      inputAdapter
    })

    expect(inputAdapter.insertText).not.toHaveBeenCalled()
    expect(inputAdapter.insertToken).toHaveBeenCalledWith(pdfSkillToken)
    expect(inputAdapter.focus).toHaveBeenCalled()
  })

  it('does not fall back to plain prompt text without token support', () => {
    mocks.availableSkills = [pdfSkill]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const skillItem = mocks.surfaceProps?.rootPanelAdditionalItems?.[0]
    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    skillItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: skillItem,
      inputAdapter
    })

    expect(inputAdapter.insertText).not.toHaveBeenCalled()
    expect(inputAdapter.focus).not.toHaveBeenCalled()
  })

  it('adds selected skill tokens to ComposerSurface and avoids duplicates', async () => {
    mocks.availableSkills = [pdfSkill]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      insertToken: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }

    mocks.surfaceProps?.rootPanelAdditionalItems?.[0]?.action?.({
      context: {} as any,
      action: 'enter',
      item: mocks.surfaceProps.rootPanelAdditionalItems[0],
      inputAdapter
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.tokens).toContainEqual(pdfSkillToken)
    })

    inputAdapter.insertToken.mockClear()
    const currentSkillItem = mocks.surfaceProps?.rootPanelAdditionalItems?.[0]
    currentSkillItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: currentSkillItem,
      inputAdapter
    })

    expect(inputAdapter.insertToken).not.toHaveBeenCalled()
  })

  it('restores cached skill draft tokens after composer remount', () => {
    vi.mocked(cacheService.getCasual).mockReturnValue({
      text: 'Use the pdf skill. continue',
      tokens: [
        {
          ...pdfSkillToken,
          index: 0,
          textOffset: 0
        }
      ]
    })

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.surfaceProps?.text).toBe('Use the pdf skill. continue')
    expect(mocks.surfaceProps?.tokens).toContainEqual(pdfSkillToken)
    expect(mocks.surfaceProps?.draftTokens).toEqual([
      {
        ...pdfSkillToken,
        index: 0,
        textOffset: 0
      }
    ])
  })

  it('removes selected skill state when the skill token is deleted', async () => {
    mocks.availableSkills = [pdfSkill]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      insertToken: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    const skillItem = mocks.surfaceProps?.rootPanelAdditionalItems?.[0]
    skillItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: skillItem,
      inputAdapter
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.tokens).toContainEqual(pdfSkillToken)
    })

    act(() => {
      mocks.surfaceProps?.onTokensChange([])
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.tokens).not.toContainEqual(pdfSkillToken)
    })
  })

  it('restores selected skill state when pasted marker inserts a skill token', async () => {
    mocks.availableSkills = [pdfSkill]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    act(() => {
      mocks.surfaceProps?.onTokensChange([
        {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'pdf',
          promptText: 'Use the pdf skill.',
          index: 0,
          textOffset: 0
        }
      ])
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.tokens).toContainEqual(pdfSkillToken)
    })
  })

  it('resolves slash skill markers by filename', async () => {
    mocks.availableSkills = [reviewSkill]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.surfaceProps?.resolveSkillMarker?.('Review (fast)')).toBeNull()
    expect(mocks.surfaceProps?.resolveSkillMarker?.('review-fast')).toEqual({
      id: 'skill:review-fast',
      kind: 'skill',
      label: 'Review (fast)',
      description: 'Review changed files',
      promptText: 'Use the Review (fast) skill.',
      payload: reviewSkill
    })
  })

  it('keeps skill tokens when a file token is removed from the draft', async () => {
    mocks.availableSkills = [pdfSkill]
    mocks.files = [file]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      insertToken: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    const skillItem = mocks.surfaceProps?.rootPanelAdditionalItems?.[0]
    skillItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: skillItem,
      inputAdapter
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.tokens).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'file:source-file-1', kind: 'file' }), pdfSkillToken])
      )
    })

    act(() => {
      mocks.surfaceProps?.onTokensChange([
        {
          ...pdfSkillToken,
          index: 0,
          textOffset: 0
        }
      ])
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.tokens).toContainEqual(pdfSkillToken)
    })
    // File-token prune/dedup now lives in attachmentTool (see attachmentTool.test); this test
    // only asserts the agent-owned skill reconcile keeps the skill when a file token is removed.
  })

  it('sends a draft that only contains a skill token', async () => {
    mocks.draftText = 'Use the pdf skill.'
    mocks.draftTokens = [
      {
        ...pdfSkillToken,
        index: 0,
        textOffset: 0
      }
    ]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('send'))

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled())
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'Use the pdf skill.' },
      {
        body: {
          agentId: 'agent-1',
          sessionId: 'session-1',
          userMessageParts: [
            expect.objectContaining({
              type: 'text',
              text: 'Use the pdf skill.',
              providerMetadata: {
                cherry: {
                  composer: {
                    version: 1,
                    tokens: [
                      {
                        id: 'skill:pdf',
                        kind: 'skill',
                        label: 'pdf',
                        description: 'Read and analyze PDFs',
                        index: 0,
                        textOffset: 0,
                        promptText: 'Use the pdf skill.'
                      }
                    ]
                  }
                }
              }
            })
          ]
        }
      }
    )
  })

  it('bridges file tokens into the existing agent session message text protocol', async () => {
    mocks.files = [file]
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('send'))

    // The FileEntry is created at send time: the file part carries fileEntryId + a file:// url
    // + a real MIME, not the raw path / literal extension.
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled())
    expect(mocks.createInternalEntry).toHaveBeenCalledWith({ source: 'path', path: '/tmp/notes.md' })
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      {
        body: {
          agentId: 'agent-1',
          sessionId: 'session-1',
          userMessageParts: [
            {
              type: 'text',
              text: 'hello',
              providerMetadata: {
                cherry: {
                  composer: {
                    version: 1,
                    tokens: [
                      {
                        id: 'file:source-file-1',
                        kind: 'file',
                        label: 'notes.md',
                        index: 0,
                        textOffset: 5,
                        payload: { name: 'notes.md', origin_name: 'notes.md' }
                      }
                    ]
                  }
                }
              }
            },
            {
              type: 'file',
              url: 'file:///p/fe-1.png',
              mediaType: 'text/markdown',
              filename: 'notes.md',
              providerMetadata: {
                cherry: {
                  fileEntryId: 'fe-1'
                }
              }
            }
          ]
        }
      }
    )
    expect(mocks.setFiles).toHaveBeenLastCalledWith([])
  })

  it('blocks sends while the parent session is switching', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        sendDisabled
      />
    )

    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('common.loading')

    fireEvent.click(screen.getByText('send'))

    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('calls the active stream stop handler when paused', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    fireEvent.click(screen.getByText('pause'))

    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('queues a follow-up while the agent session is streaming (does not send directly)', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    fireEvent.click(screen.getByText('send'))

    // Busy → the message is queued, not sent; the dock surfaces through `queueContent`.
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.queueContent).toBeTruthy()
  })

  it('keeps a steered follow-up in the dock when its manual send fails', async () => {
    mocks.draftText = 'queued message'

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    fireEvent.click(screen.getByText('send'))
    const itemId = (mocks.surfaceProps!.queueContent as any).props.items[0].id

    mocks.sendMessage.mockRejectedValueOnce(new Error('send failed'))
    await act(async () => {
      await (mocks.surfaceProps!.queueContent as any).props.onSteer(itemId)
    })

    // A failed manual steer must not silently drop the queued item.
    expect((mocks.surfaceProps!.queueContent as any).props.items.map((entry: any) => entry.id)).toContain(itemId)
  })

  it('inserts quoted selected text as a quote token from the main-window quote IPC', async () => {
    vi.mocked(cacheService.getCasual).mockReturnValue('Existing draft')

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => {
      expect(mocks.ipcOn).toHaveBeenCalledWith(IpcChannel.App_QuoteToMain, expect.any(Function))
    })

    act(() => {
      mocks.ipcListeners.get(IpcChannel.App_QuoteToMain)?.({}, 'Selected message text')
    })

    expect(mocks.insertToken).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'quote',
        label: 'selection.action.builtin.quote',
        description: 'Selected message text',
        promptText: '<blockquote>\n\nSelected message text\n</blockquote>'
      })
    )
    expect(mocks.surfaceProps?.text).toBe('Existing draft')
  })

  it('updates the active session agent from the composer toolbar', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('select agent 2'))

    expect(mocks.updateSession).toHaveBeenCalledWith(
      { id: 'session-1', agentId: 'agent-2' },
      { showSuccessToast: false }
    )
  })

  it('does not auto-select agents created from a persisted session', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('agent-selector')).toHaveAttribute('data-auto-select-on-create', 'false')
  })

  it('releases draft session agent changes to the provided handler', () => {
    const onAgentChange = vi.fn()

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onAgentChange={onAgentChange}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('select agent 2'))

    expect(onAgentChange).toHaveBeenCalledWith('agent-2')
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('updates the active agent model from the composer toolbar', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.updateModel).toHaveBeenCalledWith('agent-1', 'anthropic::claude-opus-4', {
      showSuccessToast: false
    })
  })

  it('controls the agent model selector popup open state from the composer toolbar', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('agent-model-selector')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByText('open agent model selector popup'))

    expect(screen.getByTestId('agent-model-selector')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByText('close agent model selector popup'))

    expect(screen.getByTestId('agent-model-selector')).toHaveAttribute('data-open', 'false')
  })

  it('shows only icons in the input bottom toolbar when it is narrow', async () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByText('Agent')).not.toHaveClass('sr-only')
    expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).not.toHaveClass('sr-only')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Agent')).toHaveClass('sr-only')
      expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).toHaveClass('sr-only')
    })
  })

  it('keeps input bottom toolbar labels visible when the toolbar fits', async () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await notifyComposerBottomToolbarWidth(420, 420)

    expect(screen.getByText('Agent')).not.toHaveClass('sr-only')
    expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).not.toHaveClass('sr-only')
  })

  it('renders agent and model selectors below the surface in draft home mode', () => {
    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Agent')
    const belowControls = screen.getByTestId('composer-below-controls')
    expect(belowControls).toHaveTextContent('Workspace 1')
    expect(belowControls).toHaveTextContent('Agent')
    expect(belowControls).toHaveTextContent('Claude Sonnet 4.5 | Anthropic')

    expect(screen.getByText('Agent').closest('button')).toHaveClass('h-8', 'rounded-lg')
    expect(screen.getByText('Claude Sonnet 4.5 | Anthropic').closest('button')).toHaveClass('h-8', 'rounded-lg')
    expect(screen.getByText('Workspace 1').closest('button')).toHaveClass('h-8', 'rounded-lg')

    const belowText = belowControls.textContent ?? ''
    expect(belowText.indexOf('Agent')).toBeLessThan(belowText.indexOf('Claude Sonnet 4.5 | Anthropic'))
    expect(belowText.indexOf('Claude Sonnet 4.5 | Anthropic')).toBeLessThan(belowText.indexOf('Workspace 1'))
  })

  it('renders a missing-agent home composer with a selectable agent and blocked sending', () => {
    const onAgentChange = vi.fn()

    render(<MissingAgentHomeComposer onAgentChange={onAgentChange} />)

    expect(screen.getByTestId('agent-selector')).toHaveAttribute('data-auto-select-on-create', 'true')
    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('chat.alerts.select_agent')
    const belowControls = screen.getByTestId('composer-below-controls')
    expect(belowControls).toHaveTextContent('chat.alerts.select_agent')
    expect(belowControls).toHaveTextContent('button.select_model')
    expect(belowControls).not.toHaveTextContent('Workspace 1')
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('chat.alerts.select_agent')

    act(() => {
      mocks.surfaceProps?.onTextChange('draft before agent')
    })
    fireEvent.click(screen.getByText('select agent 2'))

    expect(cacheService.setCasual).toHaveBeenCalledWith(
      'agent-session-draft-agent-2',
      { text: 'draft before agent', tokens: [] },
      24 * 60 * 60 * 1000
    )
    expect(onAgentChange).toHaveBeenCalledWith('agent-2')
  })

  it('shows only icons in the draft home bottom toolbar when it is narrow', async () => {
    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByText('Agent')).not.toHaveClass('sr-only')
    expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).not.toHaveClass('sr-only')
    expect(screen.getByText('Workspace 1')).not.toHaveClass('sr-only')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Agent')).toHaveClass('sr-only')
      expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).toHaveClass('sr-only')
      expect(screen.getByText('Workspace 1')).toHaveClass('sr-only')
    })
  })

  it('does not render the workspace selector in docked composer mode', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Workspace 1')
  })

  it('releases draft workspace changes to the provided handler', () => {
    const onWorkspaceChange = vi.fn()

    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onWorkspaceChange={onWorkspaceChange}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('select workspace 2'))

    expect(onWorkspaceChange).toHaveBeenCalledWith('workspace-2')
  })

  it('does not block sends when workspace status preflight fails', async () => {
    mocks.isDirectory.mockRejectedValueOnce(new Error('preflight unavailable'))

    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => expect(mocks.isDirectory).toHaveBeenCalledWith('/workspace'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('send'))

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
  })
})

async function notifyComposerBottomToolbarWidth(width: number, scrollWidth = width + 240) {
  await waitFor(() => {
    expect(
      resizeObserverMockInstances.some((instance) =>
        String(instance.target?.getAttribute('class') ?? '').includes('max-w-full')
      )
    ).toBe(true)
  })

  const toolbarInstances = resizeObserverMockInstances.filter((instance) =>
    String(instance.target?.getAttribute('class') ?? '').includes('max-w-full')
  )
  if (toolbarInstances.length === 0) {
    throw new Error('Expected composer bottom toolbar to create a ResizeObserver')
  }

  act(() => {
    for (const instance of toolbarInstances) {
      Object.defineProperty(instance.target, 'clientWidth', { configurable: true, value: width })
      Object.defineProperty(instance.target, 'scrollWidth', { configurable: true, value: scrollWidth })
      instance.callback(
        [
          {
            contentRect: { width }
          } as ResizeObserverEntry
        ],
        {} as ResizeObserver
      )
    }
  })
}
