import { cacheService } from '@data/CacheService'
import { toast } from '@renderer/services/toast'
import type { FileMetadata } from '@renderer/types/file'
import type { FileUIPart } from '@shared/data/types/message'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { LocalSkill } from '@shared/types/skill'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installSyncRafMock } from '../../../../../../tests/__mocks__/requestAnimationFrame'
import type { ComposerSurfaceProps } from '../../ComposerSurface'
import type { ComposerSerializedToken } from '../../tokens'
import type { ComposerToolLauncher } from '../../toolLauncher'
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
  listDirectoryEntries: vi.fn(),
  createInternalEntry: vi.fn(),
  getPhysicalPath: vi.fn(),
  getMetadata: vi.fn(),
  ipcApiRequest: vi.fn(),
  timeoutCallbacks: new Map<string, () => void>(),
  setTimeoutTimer: vi.fn(),
  clearTimeoutTimer: vi.fn(),
  updateModel: vi.fn(),
  updateSession: vi.fn(),
  setFiles: vi.fn(),
  inputAdapterFocus: vi.fn(),
  quickPanelOpen: vi.fn(),
  pinnedToolIds: ['thinking', 'skills'] as string[],
  toolLaunchers: [] as ComposerToolLauncher[],
  toolLaunchersVersion: 0,
  reconcileTokens: vi.fn(),
  insertToken: vi.fn(),
  replaceDraft: vi.fn(),
  toggleExpanded: vi.fn(),
  availableSkills: [] as LocalSkill[],
  availableSkillsRefresh: vi.fn(),
  contextUsagePercentage: null as number | null,
  surfaceProps: undefined as ComposerSurfaceProps | undefined,
  getDraft: vi.fn(),
  derivedToolState: undefined as { couldAddImageFile: boolean; extensions: string[] } | undefined,
  shortcutHandlers: new Map<string, () => void>(),
  shortcutOptions: new Map<string, Record<string, unknown> | undefined>(),
  ipcListeners: new Map<string, (_event: unknown, payload: unknown) => void>(),
  ipcOn: vi.fn(),
  sessionLayout: undefined as string | undefined,
  runtimeHostProps: undefined as
    | { assistant?: { modelId?: string | null }; model?: Model; session?: { agentId?: string } }
    | undefined,
  sessionWorkspaceId: 'workspace-1',
  sessionWorkspaceName: 'Workspace 1',
  sessionWorkspacePath: '/workspace',
  runtimeProviderMounts: 0,
  runtimeProviderUnmounts: 0
}))

const originalResizeObserver = globalThis.ResizeObserver
let restoreRequestAnimationFrame: (() => void) | undefined

const seedInputHistory = (items: string[]) => {
  MockUseCacheUtils.setPersistCacheValue('ui.composer.input_history', items)
}
interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  targets: Set<Element>
  observe: ReturnType<typeof vi.fn>
  unobserve: ReturnType<typeof vi.fn>
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

function createThinkingLauncher(overrides: Partial<ComposerToolLauncher> = {}): ComposerToolLauncher {
  return {
    id: 'thinking',
    kind: 'group',
    label: 'assistants.settings.reasoning_effort.label',
    icon: <span data-testid="thinking-icon" />,
    sources: ['popover'],
    submenu: [{ id: 'thinking-high', kind: 'command', label: 'high', icon: 'high', sources: ['popover'] }],
    ...overrides
  }
}

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) => mocks.ipcApiRequest(route, input)
  }
}))

// useAgentSessionSlashCommands now observes the shared slash-command catalog via
// useSharedCacheValue (globally mocked); with no catalog seeded the composer
// falls back to the builtin list. This inline cacheService only serves the
// remaining getCasual/setCasual/subscribe consumers.
vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn(() => ''),
    setCasual: vi.fn(),
    subscribe: vi.fn(() => () => {})
  }
}))

vi.mock('@renderer/components/chat/panes/OpenExternalAppButton', () => ({
  default: ({ workdir, menuTrigger }: { workdir: string; menuTrigger?: ReactNode }) => (
    <div data-testid="workspace-open-button" data-workdir={workdir}>
      {menuTrigger}
    </div>
  )
}))

vi.mock('@renderer/components/composer/ComposerSurface', () => {
  function MockComposerSurface(props: ComposerSurfaceProps) {
    useEffect(() => {
      props.onActionsChange?.({
        focus: vi.fn(),
        onTextChange: (updater) => {
          const nextText = typeof updater === 'function' ? updater(props.text) : updater
          props.onTextChange(nextText)
        },
        toggleExpanded: mocks.toggleExpanded,
        removeToken: vi.fn(),
        insertToken: mocks.insertToken,
        replaceDraft: mocks.replaceDraft,
        getDraft: () => {
          // Default: mirror the live composer state. Individual tests override via
          // mocks.getDraft.mockImplementation to inject specific tokens.
          if (mocks.getDraft.mock.calls.length > 0 || mocks.getDraft.getMockImplementation()) {
            return mocks.getDraft()
          }
          return { text: props.text, tokens: [...(props.draftTokens ?? [])] }
        }
      })
    }, [props])

    mocks.surfaceProps = props
    const inputAdapter = {
      focus: mocks.inputAdapterFocus,
      getText: () => props.text,
      insertText: vi.fn(),
      insertToken: mocks.insertToken,
      deleteTriggerRange: vi.fn()
    }
    const unifiedPanelControl = {
      available: true,
      open: mocks.quickPanelOpen
    }
    const sendAccessory =
      typeof props.sendAccessory === 'function'
        ? props.sendAccessory(inputAdapter, unifiedPanelControl)
        : props.sendAccessory
    return (
      <div>
        <div data-testid="composer-left-controls">{props.renderLeftControls?.(inputAdapter, unifiedPanelControl)}</div>
        <div data-testid="composer-below-controls">
          {props.renderBelowControls?.(inputAdapter, unifiedPanelControl)}
        </div>
        <div data-testid="composer-send-accessory">{sendAccessory}</div>
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

vi.mock('@renderer/components/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({ children }: { children: ReactNode }) => {
    useEffect(() => {
      mocks.runtimeProviderMounts += 1
      return () => {
        mocks.runtimeProviderUnmounts += 1
      }
    }, [])
    return <>{children}</>
  },
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
  ComposerToolMenu: () => <button type="button">tool menu</button>,
  ComposerActiveToolControls: () => null,
  ComposerPinnedToolsProvider: ({ children }: { children: ReactNode }) => children,
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
      getLaunchers: vi.fn(() => mocks.toolLaunchers),
      version: mocks.toolLaunchersVersion
    }
  }),
  useComposerToolLauncherController: () => ({
    getLaunchers: vi.fn(() => mocks.toolLaunchers),
    dispatchLauncher: vi.fn()
  }),
  useComposerToolLauncherActions: () => ({
    getLaunchers: vi.fn(() => mocks.toolLaunchers),
    dispatchLauncher: vi.fn()
  }),
  useComposerToolLauncherVersion: () => mocks.toolLaunchersVersion,
  useComposerTokenReconcile: () => mocks.reconcileTokens
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
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

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelFilter: () => undefined
}))

vi.mock('@renderer/hooks/agent/useAgentSessionContextUsage', () => ({
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

vi.mock('@renderer/hooks/agent/useAgentSessionCompaction', () => ({
  useAgentSessionCompaction: () => ({ status: 'idle' })
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useSession: () => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      accessiblePaths: [mocks.sessionWorkspacePath],
      workspaceId: mocks.sessionWorkspaceId,
      workspace: {
        id: mocks.sessionWorkspaceId,
        type: 'user',
        name: mocks.sessionWorkspaceName,
        path: mocks.sessionWorkspacePath,
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
  default: ({ size }: { size?: number }) => <span data-testid="model-avatar" data-size={size} />,
  ModelAvatar: ({ size }: { size?: number }) => <span data-testid="model-avatar" data-size={size} />
}))

vi.mock('@renderer/components/ModelSelector', () => ({
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

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
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

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  ResourceEditDialogHost: ({ target, onOpenChange }: any) => (
    <div data-testid="resource-edit-dialog-host" data-kind={target?.kind ?? ''} data-id={target?.id ?? ''}>
      <button type="button" onClick={() => onOpenChange(false)}>
        close edit dialog
      </button>
    </div>
  )
}))

vi.mock('@renderer/pages/agents/AgentSettings/shared', () => ({
  AgentLabel: ({ agent }: any) => <span>{agent.name}</span>
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'app.spell_check.enabled': true,
      'chat.message.font_size': 14,
      'chat.narrow_mode': false,
      'chat.input.send_message_shortcut': 'Enter',
      'agent.input.toolbar.pinned_tools': mocks.pinnedToolIds,
      'agent.session.display_mode': mocks.sessionLayout === 'classic' ? 'agent' : (mocks.sessionLayout ?? 'workdir')
    }
    return [values[key]]
  }
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer,
    clearTimeoutTimer: mocks.clearTimeoutTimer
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
        targets: new Set(),
        observe: vi.fn((target: Element) => {
          instance.targets.add(target)
        }),
        unobserve: vi.fn((target: Element) => {
          instance.targets.delete(target)
        }),
        disconnect: vi.fn(() => {
          instance.targets.clear()
        })
      }
      resizeObserverMockInstances.push(instance)

      return {
        observe: instance.observe,
        unobserve: instance.unobserve,
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
    mocks.listDirectoryEntries.mockReset()
    mocks.listDirectoryEntries.mockResolvedValue([])
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.getCasual).mockReturnValue('')
    vi.mocked(cacheService.setCasual).mockReset()
    mocks.createInternalEntry.mockReset()
    mocks.createInternalEntry.mockResolvedValue({ id: 'fe-1', ext: 'png' })
    mocks.getPhysicalPath.mockReset()
    mocks.getPhysicalPath.mockResolvedValue('/p/fe-1.png')
    mocks.getMetadata.mockReset()
    mocks.getMetadata.mockResolvedValue({ kind: 'file', mime: 'text/markdown', size: 1, mtime: 0 })
    mocks.ipcApiRequest.mockReset()
    mocks.ipcApiRequest.mockImplementation(async (route: string, input: { items: { key: string }[] }) => {
      if (route !== 'file.batch_get_metadata') return {}
      return Object.fromEntries(
        input.items.map((item) => [item.key, { kind: 'file', mime: 'text/markdown', size: 1, mtime: 0 }])
      )
    })
    mocks.timeoutCallbacks.clear()
    mocks.setTimeoutTimer.mockReset()
    mocks.setTimeoutTimer.mockImplementation((key: string, callback: () => void) => {
      mocks.timeoutCallbacks.set(key, callback)
      return () => mocks.clearTimeoutTimer(key)
    })
    mocks.clearTimeoutTimer.mockReset()
    mocks.clearTimeoutTimer.mockImplementation((key: string) => {
      mocks.timeoutCallbacks.delete(key)
    })
    window.api = {
      ...window.api,
      file: {
        ...window.api.file,
        isDirectory: mocks.isDirectory,
        listDirectory: mocks.listDirectory,
        listDirectoryEntries: mocks.listDirectoryEntries,
        createInternalEntry: mocks.createInternalEntry,
        getPhysicalPath: mocks.getPhysicalPath,
        getMetadata: mocks.getMetadata
      }
    }
    mocks.updateModel.mockReset()
    mocks.updateSession.mockReset()
    mocks.setFiles.mockReset()
    mocks.inputAdapterFocus.mockReset()
    mocks.quickPanelOpen.mockReset()
    mocks.pinnedToolIds = ['thinking', 'skills']
    mocks.toolLaunchers = []
    mocks.toolLaunchersVersion = 0
    mocks.setFiles.mockImplementation((value) => {
      mocks.files = typeof value === 'function' ? value(mocks.files) : value
    })
    mocks.insertToken.mockReset()
    mocks.replaceDraft.mockReset()
    mocks.toggleExpanded.mockReset()
    mocks.availableSkills = []
    mocks.availableSkillsRefresh.mockReset()
    mocks.availableSkillsRefresh.mockResolvedValue(undefined)
    mocks.contextUsagePercentage = null
    mocks.surfaceProps = undefined
    mocks.derivedToolState = undefined
    mocks.runtimeHostProps = undefined
    mocks.sessionWorkspaceId = 'workspace-1'
    mocks.sessionWorkspaceName = 'Workspace 1'
    mocks.sessionWorkspacePath = '/workspace'
    mocks.runtimeProviderMounts = 0
    mocks.runtimeProviderUnmounts = 0
    mocks.sessionLayout = undefined
    mocks.getDraft.mockReset()
    mocks.shortcutHandlers.clear()
    mocks.shortcutOptions.clear()
    mocks.ipcListeners.clear()
    mocks.ipcOn.mockReset()
    mocks.ipcOn.mockImplementation((channel: string, listener: (_event: unknown, payload: unknown) => void) => {
      mocks.ipcListeners.set(channel, listener)
      return () => mocks.ipcListeners.delete(channel)
    })
    MockUseCacheUtils.resetMocks()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          on: mocks.ipcOn
        }
      }
    })
    restoreRequestAnimationFrame = installSyncRafMock()
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
    restoreRequestAnimationFrame?.()
    restoreRequestAnimationFrame = undefined
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
    expect(mocks.surfaceProps?.narrowMode).toBe(false)
  })

  it('uses the same 20px size for the model and workspace icons', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        onWorkspaceChange={vi.fn()}
      />
    )

    expect(screen.getByTestId('model-avatar')).toHaveAttribute('data-size', '20')
    expect(screen.getByText('Workspace 1').closest('button')?.querySelector('.lucide-folder')).toHaveAttribute(
      'width',
      '20'
    )
  })

  it('uses the same 20px size for missing agent, model, and workspace icons', async () => {
    mocks.sessionLayout = 'time'

    render(<MissingAgentHomeComposer onAgentChange={vi.fn()} />)

    await notifyComposerBottomToolbarWidth(420)

    expect(document.querySelector('.lucide-bot')).toHaveAttribute('width', '20')
    expect(document.querySelector('.lucide-sparkles')).toHaveAttribute('width', '20')
    expect(document.querySelector('.lucide-folder')).toHaveAttribute('width', '20')
  })

  it('updates the agent model from the inline model selector when model changes are allowed', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        canChangeModel
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('agent-model-selector')).toHaveAttribute('data-shortcut', 'chat.model.select')
    expect(screen.getByTestId('agent-model-selector').querySelector('.lucide-chevron-down')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet 4.5')).toHaveClass('text-foreground/85')

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.updateModel).toHaveBeenCalledWith('agent-1', 'anthropic::claude-opus-4', {
      showSuccessToast: false
    })
  })

  it('keeps the inline model selector read-only when model changes are locked', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        canChangeModel={false}
        isStreaming={false}
      />
    )

    const modelLabel = screen.getByText('Claude Sonnet 4.5')
    expect(modelLabel).not.toHaveClass('text-muted-foreground')
    expect(modelLabel).not.toHaveClass('text-foreground/85')
    expect(modelLabel.closest('button')).toBeDisabled()
    expect(screen.getByTestId('agent-model-selector')).toHaveAttribute('data-shortcut', '')

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.updateModel).not.toHaveBeenCalled()
  })

  it('routes new session shortcuts through the empty session action', () => {
    const onCreateEmptySession = vi.fn()

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onCreateEmptySession={onCreateEmptySession}
        isStreaming={false}
      />
    )

    mocks.shortcutHandlers.get('topic.create')?.()

    expect(onCreateEmptySession).toHaveBeenCalledTimes(1)
  })

  it('routes classic-layout new session shortcuts through the empty session action', () => {
    mocks.sessionLayout = 'classic'
    const onCreateEmptySession = vi.fn()

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onCreateEmptySession={onCreateEmptySession}
        isStreaming={false}
      />
    )

    mocks.shortcutHandlers.get('topic.create')?.()

    expect(onCreateEmptySession).toHaveBeenCalledTimes(1)
  })

  it('puts the classic-layout empty session action first in the toolbar and calls the explicit handler', () => {
    mocks.sessionLayout = 'classic'
    const onCreateEmptySession = vi.fn()

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onCreateEmptySession={onCreateEmptySession}
        isStreaming={false}
      />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    const newSessionButton = within(leftControls).getByRole('button', { name: 'agent.session.new' })
    const modelButton = within(leftControls).getByRole('button', { name: /Claude Sonnet 4.5/ })
    const toolMenuButton = within(leftControls).getByRole('button', { name: 'tool menu' })
    expect(newSessionButton.compareDocumentPosition(modelButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(modelButton.compareDocumentPosition(toolMenuButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(newSessionButton).toHaveClass('text-foreground/70!', 'hover:bg-accent/60', 'hover:text-foreground!')
    expect(newSessionButton).toHaveClass('[&_.new-conversation-icon]:!size-5')
    const newConversationIcon = newSessionButton.querySelector('.new-conversation-icon')
    expect(newConversationIcon).toHaveAttribute('width', '20')
    expect(newConversationIcon).toHaveAttribute('height', '20')
    expect(
      within(screen.getByTestId('composer-send-accessory')).queryByRole('button', { name: 'tool menu' })
    ).not.toBeInTheDocument()
    fireEvent.click(newSessionButton)
    expect(onCreateEmptySession).toHaveBeenCalledTimes(1)

    const newSessionItem = mocks.surfaceProps?.rootPanelLeadingItems?.[0]
    expect(newSessionItem).toEqual(
      expect.objectContaining({
        id: 'composer:new-session',
        label: 'agent.session.new',
        filterText: 'agent.session.new'
      })
    )
    render(<div data-testid="new-session-panel-icon">{newSessionItem?.icon}</div>)
    expect(screen.getByTestId('new-session-panel-icon').querySelector('.new-conversation-icon')).toBeInTheDocument()
    newSessionItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: newSessionItem
    })

    expect(onCreateEmptySession).toHaveBeenCalledTimes(2)
  })

  it('keeps the new session action at the far left and the tool menu at the far right of the left toolbar', () => {
    const onCreateEmptySession = vi.fn()

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onCreateEmptySession={onCreateEmptySession}
        isStreaming={false}
      />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    const newSessionButton = within(leftControls).getByRole('button', { name: 'agent.session.new' })
    const agentButton = within(leftControls).getByRole('button', { name: /Agent/ })
    const modelButton = within(leftControls).getByRole('button', { name: /Claude Sonnet 4.5/ })
    const toolMenuButton = within(leftControls).getByRole('button', { name: 'tool menu' })

    expect(newSessionButton.compareDocumentPosition(agentButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(agentButton.compareDocumentPosition(modelButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(modelButton.compareDocumentPosition(toolMenuButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      within(screen.getByTestId('composer-send-accessory')).queryByRole('button', { name: 'tool menu' })
    ).not.toBeInTheDocument()

    const newSessionItem = mocks.surfaceProps?.rootPanelLeadingItems?.[0]
    expect(newSessionItem).toEqual(
      expect.objectContaining({
        id: 'composer:new-session',
        label: 'agent.session.new'
      })
    )
    newSessionItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: newSessionItem
    })

    expect(onCreateEmptySession).toHaveBeenCalledTimes(1)
  })

  it('keeps reasoning and skill shortcuts in the input toolbar and opens the unified panel', () => {
    mocks.toolLaunchers = [createThinkingLauncher()]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    const reasoningButton = within(leftControls).getByRole('button', {
      name: 'assistants.settings.reasoning_effort.label'
    })
    const skillButton = within(leftControls).getByRole('button', { name: 'plugins.skills' })
    const agentButton = within(leftControls).getByRole('button', { name: /Agent/ })

    expect(reasoningButton.compareDocumentPosition(skillButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(reasoningButton).toHaveClass('text-foreground/70!', 'hover:bg-accent/60', 'hover:text-foreground!')
    expect(skillButton.compareDocumentPosition(agentButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(skillButton).toHaveClass('text-foreground/70!', 'hover:bg-accent/60', 'hover:text-foreground!')
    expect(skillButton.querySelector('.lucide-zap')).toBeInTheDocument()

    fireEvent.click(reasoningButton)
    expect(mocks.quickPanelOpen).toHaveBeenCalledWith({
      launcherId: 'thinking',
      searchText: 'assistants.settings.reasoning_effort.label'
    })

    fireEvent.click(skillButton)
    expect(mocks.quickPanelOpen).toHaveBeenLastCalledWith({ searchText: 'plugins.skills' })
  })

  it('exposes slash commands and MCP as skill-style toolbar shortcuts', () => {
    mocks.pinnedToolIds = ['slash-commands', 'mcp-status']

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    const slashCommandsButton = within(leftControls).getByRole('button', {
      name: 'chat.input.slash_commands.title'
    })
    const mcpButton = within(leftControls).getByRole('button', { name: 'MCP' })

    expect(slashCommandsButton.querySelector('.lucide-terminal')).toBeInTheDocument()
    expect(mcpButton.querySelector('.lucide-cable')).toBeInTheDocument()
    expect(within(leftControls).queryByRole('button', { name: '/clear' })).not.toBeInTheDocument()

    fireEvent.click(slashCommandsButton)
    expect(mocks.quickPanelOpen).toHaveBeenCalledWith({ searchText: 'chat.input.slash_commands.title' })

    fireEvent.click(mcpButton)
    expect(mocks.quickPanelOpen).toHaveBeenLastCalledWith({ launcherId: 'mcp-status', searchText: 'MCP' })
  })

  it('disables the reasoning shortcut when the model cannot configure reasoning', () => {
    mocks.toolLaunchers = [
      createThinkingLauncher({
        disabled: true,
        disabledReason: 'chat.input.thinking.unsupported_model'
      })
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

    const reasoningButton = within(screen.getByTestId('composer-left-controls')).getByRole('button', {
      name: 'assistants.settings.reasoning_effort.label'
    })
    expect(reasoningButton).toBeDisabled()
    expect(screen.getByText('chat.input.thinking.unsupported_model')).toBeInTheDocument()

    fireEvent.click(reasoningButton)

    expect(mocks.quickPanelOpen).not.toHaveBeenCalled()
  })

  it('uses the active reasoning launcher icon and style after reasoning is selected', () => {
    mocks.toolLaunchers = [
      createThinkingLauncher({
        active: true,
        icon: <span data-testid="thinking-active-icon" />,
        suffix: 'assistants.settings.reasoning_effort.high'
      })
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

    const reasoningButton = within(screen.getByTestId('composer-left-controls')).getByRole('button', {
      name: 'assistants.settings.reasoning_effort.label'
    })
    expect(reasoningButton).toHaveAttribute('data-active', 'true')
    expect(reasoningButton).toHaveClass('bg-accent', 'data-[active=true]:text-primary!')
    expect(within(reasoningButton).getByTestId('thinking-active-icon')).toBeInTheDocument()
  })

  it('hides the empty session action without a handler', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.queryByRole('button', { name: 'agent.session.new' })).not.toBeInTheDocument()
    expect(mocks.surfaceProps?.rootPanelLeadingItems).toEqual([])
  })

  it('wires input history navigation into the composer surface', async () => {
    seedInputHistory(['previous agent prompt'])

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
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.text).toBe('previous agent prompt')
    })
  })

  it('replaces the full composer draft when recalling history with the same text', () => {
    seedInputHistory(['hello'])
    mocks.getDraft.mockReturnValue({
      text: 'hello',
      tokens: [
        {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'pdf',
          promptText: 'hello',
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

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })

    expect(mocks.replaceDraft).toHaveBeenCalledWith({ text: 'hello', tokens: [] })
  })

  it('saves input history after a successful agent send', async () => {
    mocks.sendMessage.mockResolvedValue(undefined)

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'agent says hi', tokens: [] })
    })

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalled()
      expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual(['agent says hi'])
    })
  })

  it('resets input history navigation after a successful agent send, so a subsequent ArrowDown does not restore the recalled draft', async () => {
    // Regression: clearCurrentDraft must also drop useInputHistory's nav state.
    // Without that, recalling a history item, sending it, then pressing ArrowDown
    // would restore the already-sent draft instead of staying on the fresh empty
    // composer; ArrowUp would also resume from the stale index.
    seedInputHistory(['sent history entry'])
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))
    mocks.sendMessage.mockResolvedValue(undefined)

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    // Recall the history entry.
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('sent history entry'))

    // Send the recalled draft without any further edits.
    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'sent history entry', tokens: [] })
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe(''))

    // ArrowDown after a successful send must NOT restore the recalled draft.
    act(() => {
      mocks.surfaceProps?.onInputHistoryNavigate?.('down')
    })
    expect(mocks.surfaceProps?.text).toBe('')

    // ArrowUp from the fresh composer should re-enter history at the latest entry.
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('sent history entry'))
  })

  it('does NOT save input history when an agent send rejects', async () => {
    mocks.sendMessage.mockRejectedValue(new Error('agent send failed'))

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'doomed agent send', tokens: [] })
    })

    expect(mocks.sendMessage).toHaveBeenCalled()
    expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual([])
  })

  it('does NOT save input history when the follow-up is enqueued during streaming (only on real drain)', async () => {
    mocks.sendMessage.mockResolvedValue(undefined)

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'queued agent follow-up', tokens: [] })
    })

    // Enqueue path: sendMessage is NOT called directly — it goes through the dock.
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual([])
    expect(mocks.surfaceProps?.queueContent).toBeTruthy()

    // Manually drain the dock. Now sendMessage runs and saveHistory fires.
    const queueContent = mocks.surfaceProps?.queueContent as any
    const itemId = queueContent.props.items[0].id
    await act(async () => {
      await queueContent.props.onSteer(itemId)
    })

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalled()
      expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual(['queued agent follow-up'])
    })
  })

  it('round-trips in-progress skill tokens through agent input history navigation', async () => {
    seedInputHistory(['history entry'])

    const inProgressSkillToken = {
      id: 'skill:pdf',
      kind: 'skill',
      label: 'pdf',
      index: 0,
      textOffset: 0
    }
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: [inProgressSkillToken]
    }))

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    // Pre-condition: no skill tokens yet.
    expect(mocks.surfaceProps?.tokens ?? []).toEqual([])

    // Enter history.
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))

    // Exit history — entry draft's skill token must come back as a live selectedSkill.
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    // applyHistoryDraft rebuilds skill tokens via getCachedSkillTokens(historyDraft.tokens).
    // The entry draft had tokens: [skill:pdf], so on ArrowDown that token should reappear.
    await waitFor(() => {
      const tokens = mocks.surfaceProps?.tokens ?? []
      expect(tokens).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'skill:pdf' })]))
    })
  })

  it('does not overwrite the persisted agent draft while previewing input history', async () => {
    seedInputHistory(['history entry'])
    vi.mocked(cacheService.getCasual).mockReturnValue({
      text: 'long in-progress agent draft',
      tokens: []
    })
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )
    vi.mocked(cacheService.setCasual).mockClear()

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))

    expect(cacheService.setCasual).not.toHaveBeenCalledWith(
      'agent-session-draft-agent-1',
      expect.objectContaining({ text: 'history entry' }),
      expect.any(Number)
    )
  })

  it('cancels the delayed post-send clear when recalling input history', async () => {
    seedInputHistory(['history entry'])
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))
    mocks.sendMessage.mockResolvedValue(undefined)

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'agent says hi', tokens: [] })
    })
    expect(mocks.timeoutCallbacks.has('agentComposerSendMessage')).toBe(true)

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    // The successful send is now the newest history entry, so ArrowUp recalls it first.
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('agent says hi'))

    expect(mocks.clearTimeoutTimer).toHaveBeenCalledWith('agentComposerSendMessage')
    expect(mocks.timeoutCallbacks.has('agentComposerSendMessage')).toBe(false)
  })

  it('clears agent files while previewing plain-text history and restores the entry draft files', async () => {
    seedInputHistory(['history entry'])
    mocks.files = [file]
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: mocks.surfaceProps?.tokens.map((token, index) => ({ ...token, index, textOffset: 0 })) ?? []
    }))

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.surfaceProps?.tokens).toEqual([expect.objectContaining({ id: 'file:source-file-1' })])

    act(() => {
      mocks.surfaceProps?.onTextChange('agent draft')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('agent draft'))

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))
    expect(mocks.files).toEqual([])
    expect(mocks.surfaceProps?.tokens).toEqual([])

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('agent draft'))
    expect(mocks.files).toEqual([file])
    expect(mocks.surfaceProps?.tokens).toEqual([expect.objectContaining({ id: 'file:source-file-1' })])
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

    // The agent forwards attachments to its runtime as file paths and reads them with its
    // own tools, so every file type is attachable on any model (modality is irrelevant).
    expect(mocks.derivedToolState).toEqual({
      couldAddImageFile: true,
      extensions: mocks.surfaceProps?.supportedExts
    })
  })

  it('renders context usage next to the send action when cached usage exists', async () => {
    mocks.contextUsagePercentage = 42
    mocks.sessionLayout = 'time'

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    const modelButton = within(leftControls).getByRole('button', { name: /Claude Sonnet 4.5/ })
    const workspaceButton = within(leftControls).getByText('Workspace 1').closest('button')!
    const toolMenuButton = within(leftControls).getByRole('button', { name: 'tool menu' })
    const sendAccessory = screen.getByTestId('composer-send-accessory')
    const indicator = within(sendAccessory).getByLabelText('agent.right_pane.info.context_usage 42%')
    expect(modelButton.compareDocumentPosition(workspaceButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(workspaceButton.compareDocumentPosition(toolMenuButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(toolMenuButton.compareDocumentPosition(indicator)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(sendAccessory).queryByRole('button', { name: 'tool menu' })).not.toBeInTheDocument()
    expect(indicator).toBeInTheDocument()
    expect(indicator).not.toHaveTextContent('42%')
    expect(indicator).toHaveAttribute('style', expect.stringContaining('--context-usage-progress: 42%'))
    expect(indicator).toHaveAttribute('style', expect.stringContaining('color-mix(in oklch'))

    await waitFor(() => expect(screen.getByText('42 / 100 (42%)')).toBeInTheDocument())
    expect(screen.getByText('agent/deepseek-v4-flash')).toBeInTheDocument()
  })

  it('provides workspace file resources through the unified panel resource provider', async () => {
    mocks.listDirectoryEntries.mockResolvedValue([
      { path: '/workspace/docs', isDirectory: true },
      { path: '/workspace/docs/notes.md', isDirectory: false },
      { path: '/workspace/docs/notes.md', isDirectory: false }
    ])

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const resourceProvider = mocks.surfaceProps?.resourceProvider
    expect(resourceProvider).toEqual(expect.any(Function))
    expect(mocks.surfaceProps?.suggestionSources).toEqual([])

    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      insertToken: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    const emptyItems = await resourceProvider?.('', { inputAdapter, quickPanel: {} as any })
    expect(emptyItems).toEqual([])
    expect(mocks.listDirectoryEntries).not.toHaveBeenCalled()

    const items = await resourceProvider?.('notes', { inputAdapter, quickPanel: {} as any })
    expect(mocks.listDirectoryEntries).toHaveBeenCalledWith(
      '/workspace',
      expect.objectContaining({
        recursive: true,
        includeDirectories: false,
        maxDepth: 3,
        searchPattern: 'notes'
      })
    )
    expect(items).toHaveLength(1)
    const item = items?.[0]
    if (!item?.id) throw new Error('Expected a resource provider item')
    expect(items?.[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^agent-resource:.+/),
        label: 'docs/notes.md',
        description: '/workspace/docs/notes.md',
        disabled: false
      })
    )
    expect(item.id).not.toContain('/workspace/docs/notes.md')

    const refreshedItems = await resourceProvider?.('notes', { inputAdapter, quickPanel: {} as any })
    expect(refreshedItems?.[0]?.id).toBe(item.id)

    item.action?.({ action: 'enter', context: {} as any, item, inputAdapter })

    expect(inputAdapter.insertToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^file:.+/),
        kind: 'file',
        label: 'notes.md',
        payload: expect.objectContaining({
          fileTokenSourceId: expect.any(String),
          path: '/workspace/docs/notes.md'
        })
      })
    )
    expect(inputAdapter.focus).toHaveBeenCalled()

    const setFilesUpdater = mocks.setFiles.mock.calls.at(-1)?.[0]
    expect(typeof setFilesUpdater).toBe('function')
    const selectedFile = { id: '/workspace/docs/notes.md', path: '/workspace/docs/notes.md' } as FileMetadata
    expect(setFilesUpdater([])).toEqual([
      expect.objectContaining({
        fileTokenSourceId: expect.any(String),
        path: '/workspace/docs/notes.md'
      })
    ])
    expect(setFilesUpdater([selectedFile])).toBeInstanceOf(Array)
    expect(setFilesUpdater([selectedFile])).toHaveLength(1)
  })

  it('keeps ComposerSurface suggestion sources stable across streaming rerenders', () => {
    const { rerender } = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const initialSuggestionSources = mocks.surfaceProps?.suggestionSources
    expect(initialSuggestionSources).toEqual([])

    rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    expect(mocks.surfaceProps?.isLoading).toBe(true)
    expect(mocks.surfaceProps?.suggestionSources).toBe(initialSuggestionSources)
  })

  it('changes the unified panel resource provider when the workspace scope changes', () => {
    const { rerender } = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const firstResourceProvider = mocks.surfaceProps?.resourceProvider
    expect(firstResourceProvider).toEqual(expect.any(Function))

    mocks.sessionWorkspaceId = 'workspace-2'
    mocks.sessionWorkspaceName = 'Workspace 2'
    mocks.sessionWorkspacePath = '/workspace-2'

    rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.surfaceProps?.resourceProvider).toEqual(expect.any(Function))
    expect(mocks.surfaceProps?.resourceProvider).not.toBe(firstResourceProvider)
  })

  it('calls onWorkspaceChange with null when clicking the quick clear button on hover', async () => {
    mocks.sessionLayout = 'time'
    const onWorkspaceChange = vi.fn()
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        onWorkspaceChange={onWorkspaceChange}
      />
    )

    const clearButton = screen.getByTestId('clear-workspace-button')
    expect(clearButton).toBeInTheDocument()

    fireEvent.click(clearButton)
    expect(onWorkspaceChange).toHaveBeenCalledWith(null)
  })

  it('keeps the workspace selector trigger as a native button without nested interactive roles', () => {
    mocks.sessionLayout = 'time'
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        onWorkspaceChange={vi.fn()}
      />
    )

    const workspaceButton = screen.getByText('Workspace 1').closest('button')
    expect(workspaceButton).toBeInTheDocument()
    expect(workspaceButton).toHaveAttribute('type', 'button')
    expect(within(workspaceButton!).queryByRole('button')).not.toBeInTheDocument()
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
    mocks.listDirectoryEntries.mockResolvedValue([{ path: '/workspace/docs/notes.md', isDirectory: false }])

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const items = await mocks.surfaceProps?.resourceProvider?.('notes', {
      inputAdapter: undefined,
      quickPanel: {} as any
    })
    expect(items?.[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^agent-resource:.+/),
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
        filterText: 'pdf'
      })
    )
    render(<div data-testid="skill-panel-icon">{skillItem?.icon}</div>)
    expect(screen.getByTestId('skill-panel-icon').querySelector('.lucide-zap')).toBeInTheDocument()
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

  it('sends workspace resource file references with their original workspace path', async () => {
    const workspaceFile = {
      id: 'workspace-file-1',
      fileTokenSourceId: 'source-workspace-file-1',
      name: 'notes.md',
      origin_name: 'notes.md',
      path: '/workspace/docs/notes.md'
    } as FileMetadata
    mocks.files = [workspaceFile]
    mocks.draftTokens = [
      {
        id: `file:${workspaceFile.fileTokenSourceId}`,
        kind: 'file',
        label: workspaceFile.name,
        payload: workspaceFile,
        index: 0,
        textOffset: mocks.draftText.length
      } as ComposerSerializedToken
    ]
    mocks.createInternalEntry.mockRejectedValueOnce(new Error('workspace resources should not be internalized'))

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
    expect(mocks.createInternalEntry).not.toHaveBeenCalled()
    expect(mocks.ipcApiRequest).toHaveBeenCalledWith('file.batch_get_metadata', {
      items: [{ key: '/workspace/docs/notes.md', handle: { kind: 'path', path: '/workspace/docs/notes.md' } }]
    })
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      {
        body: {
          agentId: 'agent-1',
          sessionId: 'session-1',
          userMessageParts: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              text: 'hello'
            }),
            {
              type: 'file',
              url: 'file:///workspace/docs/notes.md',
              mediaType: 'text/markdown',
              filename: 'notes.md',
              providerMetadata: {
                cherry: {
                  fileTokenSourceId: 'source-workspace-file-1'
                }
              }
            }
          ])
        }
      }
    )
  })

  it('batches workspace attachment metadata while preserving attachment order', async () => {
    const workspaceFileA = {
      id: 'workspace-file-1',
      fileTokenSourceId: 'source-workspace-file-1',
      name: 'alpha.md',
      origin_name: 'alpha.md',
      path: '/workspace/docs/alpha.md'
    } as FileMetadata
    const localFile = {
      id: 'local-file-1',
      fileTokenSourceId: 'source-local-file-1',
      name: 'local.md',
      origin_name: 'local.md',
      path: '/tmp/local.md'
    } as FileMetadata
    const workspaceFileB = {
      id: 'workspace-file-2',
      fileTokenSourceId: 'source-workspace-file-2',
      name: 'beta.md',
      origin_name: 'beta.md',
      path: '/workspace/docs/beta.md'
    } as FileMetadata
    mocks.files = [workspaceFileA, localFile, workspaceFileB]
    mocks.draftTokens = [workspaceFileA, localFile, workspaceFileB].map(
      (attachedFile, index) =>
        ({
          id: `file:${attachedFile.fileTokenSourceId}`,
          kind: 'file',
          label: attachedFile.name,
          payload: attachedFile,
          index,
          textOffset: mocks.draftText.length
        }) as ComposerSerializedToken
    )

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
    expect(mocks.ipcApiRequest).toHaveBeenCalledTimes(1)
    expect(mocks.ipcApiRequest).toHaveBeenCalledWith('file.batch_get_metadata', {
      items: [
        { key: '/workspace/docs/alpha.md', handle: { kind: 'path', path: '/workspace/docs/alpha.md' } },
        { key: '/workspace/docs/beta.md', handle: { kind: 'path', path: '/workspace/docs/beta.md' } }
      ]
    })
    expect(mocks.createInternalEntry).toHaveBeenCalledTimes(1)
    expect(mocks.createInternalEntry).toHaveBeenCalledWith({ source: 'path', path: '/tmp/local.md' })

    const userMessageParts = mocks.sendMessage.mock.calls[0]?.[1]?.body?.userMessageParts
    expect(userMessageParts?.map((part) => part.type)).toEqual(['text', 'file', 'file', 'file'])
    expect(userMessageParts?.slice(1).map((part) => (part as FileUIPart).filename)).toEqual([
      'alpha.md',
      'local.md',
      'beta.md'
    ])
    expect(userMessageParts?.slice(1).map((part) => (part as FileUIPart).url)).toEqual([
      'file:///workspace/docs/alpha.md',
      'file:///p/fe-1.png',
      'file:///workspace/docs/beta.md'
    ])
  })

  it('sends Windows drive-slash workspace resource file references without internalizing them', async () => {
    mocks.sessionWorkspacePath = 'C:\\workspace'
    const workspaceFile = {
      id: 'workspace-file-1',
      fileTokenSourceId: 'source-workspace-file-1',
      name: 'notes.md',
      origin_name: 'notes.md',
      path: 'C:/workspace/docs/notes.md'
    } as FileMetadata
    mocks.files = [workspaceFile]
    mocks.draftTokens = [
      {
        id: `file:${workspaceFile.fileTokenSourceId}`,
        kind: 'file',
        label: workspaceFile.name,
        payload: workspaceFile,
        index: 0,
        textOffset: mocks.draftText.length
      } as ComposerSerializedToken
    ]
    mocks.createInternalEntry.mockRejectedValueOnce(new Error('workspace resources should not be internalized'))

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
    expect(mocks.createInternalEntry).not.toHaveBeenCalled()
    expect(mocks.ipcApiRequest).toHaveBeenCalledWith('file.batch_get_metadata', {
      items: [{ key: 'C:\\workspace\\docs\\notes.md', handle: { kind: 'path', path: 'C:\\workspace\\docs\\notes.md' } }]
    })
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      {
        body: {
          agentId: 'agent-1',
          sessionId: 'session-1',
          userMessageParts: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              text: 'hello'
            }),
            {
              type: 'file',
              url: 'file:///C:/workspace/docs/notes.md',
              mediaType: 'text/markdown',
              filename: 'notes.md',
              providerMetadata: {
                cherry: {
                  fileTokenSourceId: 'source-workspace-file-1'
                }
              }
            }
          ])
        }
      }
    )
  })

  it('fails the send when a workspace reference is missing from the batch metadata lookup', async () => {
    const workspaceFile = {
      id: 'workspace-file-1',
      fileTokenSourceId: 'source-workspace-file-1',
      name: 'notes.md',
      origin_name: 'notes.md',
      path: '/workspace/docs/notes.md'
    } as FileMetadata
    mocks.files = [workspaceFile]
    mocks.draftTokens = [
      {
        id: `file:${workspaceFile.fileTokenSourceId}`,
        kind: 'file',
        label: workspaceFile.name,
        payload: workspaceFile,
        index: 0,
        textOffset: mocks.draftText.length
      } as ComposerSerializedToken
    ]
    mocks.ipcApiRequest.mockResolvedValue({})

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

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('chat.input.send_failed'))
    expect(mocks.sendMessage).not.toHaveBeenCalled()
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

    // The FileEntry is created at send time: the file part carries both file identities,
    // a file:// URL, and a real MIME instead of the raw path / literal extension.
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
                  fileEntryId: 'fe-1',
                  fileTokenSourceId: 'source-file-1'
                }
              }
            }
          ]
        }
      }
    )
    expect(mocks.setFiles).toHaveBeenLastCalledWith([])
  })

  it('does not send while only some attached file tokens are reflected in the editor', async () => {
    const secondFile = {
      id: 'file-2',
      fileTokenSourceId: 'source-file-2',
      name: 'summary.md',
      origin_name: 'summary.md',
      path: '/tmp/summary.md'
    } as FileMetadata
    mocks.files = [file, secondFile]
    mocks.draftTokens = [
      {
        id: `file:${file.fileTokenSourceId}`,
        kind: 'file',
        label: file.name,
        payload: file,
        index: 0,
        textOffset: mocks.draftText.length
      } as ComposerSerializedToken
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

    await act(async () => {
      fireEvent.click(screen.getByText('send'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.setFiles).not.toHaveBeenCalledWith([])
    expect(mocks.files).toEqual([file, secondFile])
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

  it('atomically restores same-text queued tokens and the skill cache from a history preview', async () => {
    seedInputHistory(['queued agent draft'])
    mocks.availableSkills = [pdfSkill]
    mocks.files = [file]
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: mocks.surfaceProps?.tokens.map((token) => ({ ...token, index: 0, textOffset: 0 })) ?? []
    }))

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: 'queued agent draft',
        tokens: [
          {
            ...pdfSkillToken,
            index: 0,
            textOffset: 0
          },
          {
            id: 'quote:queued-agent',
            kind: 'quote',
            label: 'Queued quote',
            promptText: 'quoted agent context',
            index: 1,
            textOffset: 0
          },
          {
            id: `file:${file.fileTokenSourceId}`,
            kind: 'file',
            label: file.name,
            payload: file,
            index: 2,
            textOffset: 0
          }
        ]
      })
    })

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued agent draft'))

    const queueContent = mocks.surfaceProps?.queueContent as any
    const itemId = queueContent.props.items[0].id
    await act(async () => {
      await queueContent.props.onEdit(itemId)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued agent draft'))
    await waitFor(() => expect(mocks.surfaceProps?.queueContent).toBeUndefined())
    expect(mocks.files).toEqual([file])
    expect(mocks.replaceDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: 'queued agent draft',
        tokens: expect.arrayContaining([
          expect.objectContaining({ id: 'skill:pdf', kind: 'skill' }),
          expect.objectContaining({ id: 'quote:queued-agent', kind: 'quote' }),
          expect.objectContaining({ id: `file:${file.fileTokenSourceId}`, kind: 'file' })
        ])
      })
    )
    expect(mocks.surfaceProps?.draftTokens).toEqual([expect.objectContaining({ id: 'skill:pdf', kind: 'skill' })])
    expect(cacheService.setCasual).toHaveBeenCalledWith(
      'agent-session-draft-agent-1',
      {
        text: 'queued agent draft',
        tokens: [expect.objectContaining({ id: 'skill:pdf', kind: 'skill' })]
      },
      86400000
    )

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(false)
    })
    expect(mocks.surfaceProps?.text).toBe('queued agent draft')

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued agent draft'))
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued agent draft'))
    expect(mocks.files).toEqual([file])
  })

  it('isolates input history and files when the session changes', async () => {
    seedInputHistory(['history entry'])
    mocks.files = [file]
    mocks.getDraft.mockReturnValue({ text: 'session one draft', tokens: [] })
    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))
    expect(mocks.files).toEqual([])

    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-2"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(false)
    })
    expect(mocks.files).toEqual([])
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
    const queueContent = mocks.surfaceProps?.queueContent as any
    expect(queueContent).toBeTruthy()
    const itemId = queueContent.props.items[0].id

    mocks.sendMessage.mockRejectedValueOnce(new Error('send failed'))
    await act(async () => {
      await queueContent.props.onSteer(itemId)
    })

    // A failed manual steer must not silently drop the queued item.
    expect(queueContent.props.items.map((entry: any) => entry.id)).toContain(itemId)
    expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual([])
  })

  it('restores the current draft, files, and skill tokens when sending a new agent message fails', async () => {
    mocks.availableSkills = [pdfSkill]
    mocks.draftText = 'draft message'
    const skillToken = {
      ...pdfSkillToken,
      index: 0,
      textOffset: 0
    }
    const fileToken = {
      id: `file:${file.fileTokenSourceId}`,
      kind: 'file',
      label: file.name,
      payload: file,
      index: 1,
      textOffset: mocks.draftText.length
    } as ComposerSerializedToken
    mocks.draftTokens = [skillToken, fileToken]
    mocks.files = [file]
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
      mocks.surfaceProps?.onTokensChange(mocks.draftTokens ?? [])
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.draftTokens).toEqual([skillToken])
    })

    fireEvent.click(screen.getByText('send'))

    await waitFor(() => {
      expect(mocks.surfaceProps?.text).toBe('draft message')
    })

    expect(mocks.sendMessage).toHaveBeenCalled()
    expect(mocks.setFiles).toHaveBeenCalledWith([])
    expect(mocks.setFiles).toHaveBeenLastCalledWith([file])
    expect(mocks.surfaceProps?.text).toBe('draft message')
    expect(mocks.surfaceProps?.draftTokens).toEqual([skillToken])
    expect(cacheService.setCasual).toHaveBeenLastCalledWith(
      'agent-session-draft-agent-1',
      {
        text: 'draft message',
        tokens: [skillToken]
      },
      86400000
    )
    expect(mocks.clearTimeoutTimer).toHaveBeenCalledWith('agentComposerSendMessage')
    expect(mocks.timeoutCallbacks.has('agentComposerSendMessage')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('chat.input.send_failed')
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
    expect(mocks.toggleExpanded).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.text).toBe('Existing draft')
  })

  it('opens the agent edit dialog for a session with history', async () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.queryByTestId('agent-selector')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-model-selector')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Agent').closest('button')!)

    const dialog = await screen.findByTestId('resource-edit-dialog-host')
    expect(dialog).toHaveAttribute('data-kind', 'agent')
    expect(dialog).toHaveAttribute('data-id', 'agent-1')
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('uses the agent selector for an empty session and updates the session agent', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        canChangeAgent
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('agent-selector')).toBeInTheDocument()
    expect(screen.getByText('select agent 2')).toBeInTheDocument()
    expect(screen.getByTestId('agent-selector')).toHaveAttribute('data-auto-select-on-create', 'true')

    fireEvent.click(screen.getByText('select agent 2'))

    expect(mocks.updateSession).toHaveBeenCalledWith(
      { id: 'session-1', agentId: 'agent-2' },
      { showSuccessToast: false }
    )
  })

  it('resets the agent-scoped draft and tool runtime after switching agents', async () => {
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key === 'agent-session-draft-agent-1'
        ? { text: 'draft for agent one', tokens: [{ ...pdfSkillToken, index: 0, textOffset: 0 }] }
        : ''
    )

    const { rerender } = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        canChangeAgent
        isStreaming={false}
      />
    )

    expect(mocks.surfaceProps?.text).toBe('draft for agent one')
    expect(mocks.surfaceProps?.tokens).toContainEqual(pdfSkillToken)
    expect(mocks.runtimeProviderMounts).toBe(1)

    fireEvent.click(screen.getByText('select agent 2'))
    await waitFor(() => {
      expect(mocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-1', agentId: 'agent-2' },
        { showSuccessToast: false }
      )
    })

    rerender(
      <AgentComposer
        agentId="agent-2"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        canChangeAgent
        isStreaming={false}
      />
    )

    expect(mocks.surfaceProps?.text).toBe('')
    expect(mocks.surfaceProps?.tokens).toEqual([])
    expect(mocks.surfaceProps?.draftTokens).toEqual([])
    expect(mocks.runtimeProviderMounts).toBe(2)
    expect(mocks.runtimeProviderUnmounts).toBe(1)
  })

  it('restores composer focus after closing the active session agent edit dialog', async () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('Agent').closest('button')!)
    await screen.findByTestId('resource-edit-dialog-host')

    fireEvent.click(screen.getByText('close edit dialog'))

    expect(mocks.inputAdapterFocus).toHaveBeenCalledTimes(1)
  })

  it('keeps the active session agent control visible in classic layout', () => {
    mocks.sessionLayout = 'classic'

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.queryByTestId('agent-selector')).not.toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByTestId('agent-model-selector')).toBeInTheDocument()
    expect(screen.queryByTestId('resource-edit-dialog-host')).not.toBeInTheDocument()
    expect(mocks.updateSession).not.toHaveBeenCalled()
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

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Agent')).toHaveClass('sr-only')
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
  })

  it('renders the agent, model, and workspace below the surface in draft home mode', () => {
    mocks.sessionLayout = 'time'

    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    expect(within(leftControls).getByRole('button', { name: 'tool menu' })).toBeInTheDocument()
    expect(leftControls).not.toHaveTextContent('Agent')
    expect(mocks.surfaceProps?.narrowMode).toBe(true)
    const belowControls = screen.getByTestId('composer-below-controls')
    expect(belowControls).toHaveTextContent('Agent')
    expect(belowControls).toHaveTextContent('Claude Sonnet 4.5')
    expect(belowControls).toHaveTextContent('Workspace 1')
    const sendAccessory = screen.getByTestId('composer-send-accessory')
    expect(within(sendAccessory).queryByRole('button', { name: 'tool menu' })).not.toBeInTheDocument()
    expect(sendAccessory).not.toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('agent-model-selector')).toBeInTheDocument()

    expect(screen.getByText('Agent').closest('button')).toHaveClass('h-8', 'rounded-lg')
    expect(screen.getByText('Claude Sonnet 4.5').closest('button')).toHaveClass('h-8', 'rounded-lg')
    const workspaceButton = screen.getByText('Workspace 1').closest('button')
    expect(workspaceButton).toHaveClass('h-8', 'rounded-lg')

    const belowText = belowControls.textContent ?? ''
    expect(belowText.indexOf('Agent')).toBeLessThan(belowText.indexOf('Claude Sonnet 4.5'))
    expect(belowText.indexOf('Claude Sonnet 4.5')).toBeLessThan(belowText.indexOf('Workspace 1'))
  })

  it('renders a missing-agent home composer with a selectable agent and blocked sending', () => {
    const onAgentChange = vi.fn()

    render(<MissingAgentHomeComposer onAgentChange={onAgentChange} />)

    expect(screen.getByTestId('agent-selector')).toHaveAttribute('data-auto-select-on-create', 'true')
    const leftControls = screen.getByTestId('composer-left-controls')
    expect(leftControls).toHaveTextContent('chat.alerts.select_agent')
    // The model selector renders inline as a disabled placeholder until an agent is picked.
    expect(leftControls).toHaveTextContent('button.select_model')
    expect(leftControls).not.toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('composer-below-controls')).toBeEmptyDOMElement()
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('chat.alerts.select_agent')
    expect(mocks.surfaceProps?.narrowMode).toBe(false)

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

  it('keeps the missing-agent trigger visible in classic layout', () => {
    mocks.sessionLayout = 'classic'

    render(<MissingAgentHomeComposer onAgentChange={vi.fn()} />)

    expect(screen.getByTestId('agent-selector')).toBeInTheDocument()
    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent('chat.alerts.select_agent')
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('chat.alerts.select_agent')
  })

  it('shows a disabled workspace placeholder in the missing-agent composer outside workdir mode', () => {
    mocks.sessionLayout = 'time'

    render(<MissingAgentHomeComposer onAgentChange={vi.fn()} />)

    const leftControls = screen.getByTestId('composer-left-controls')
    const workspaceLabel = within(leftControls).getByText('agent.session.workspace_selector.placeholder')
    expect(workspaceLabel.closest('button')).toBeDisabled()
  })

  it('keeps the workspace placeholder visible in the missing-agent composer in workdir mode', () => {
    mocks.sessionLayout = 'workdir'

    render(<MissingAgentHomeComposer onAgentChange={vi.fn()} />)

    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent(
      'agent.session.workspace_selector.placeholder'
    )
  })

  it('shows only icons in the draft home bottom toolbar when it is narrow', async () => {
    mocks.sessionLayout = 'time'

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
    expect(screen.getByText('Claude Sonnet 4.5')).not.toHaveClass('sr-only')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('composer-send-accessory')).not.toHaveTextContent('Workspace 1')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Agent')).toHaveClass('sr-only')
      expect(screen.getByText('Claude Sonnet 4.5')).toHaveClass('sr-only')
    })
    expect(screen.getByText('Workspace 1')).toHaveClass('sr-only')
  })

  it('renders a workspace opener in docked composer mode', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('workspace-open-button')).toHaveAttribute('data-workdir', '/workspace')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('composer-send-accessory')).not.toHaveTextContent('Workspace 1')
    expect(screen.queryByText('select workspace 2')).not.toBeInTheDocument()
  })

  it('keeps the workspace selector visible when sessions are grouped by workspace', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onWorkspaceChange={vi.fn()}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent('Workspace 1')
    expect(screen.getByText('select workspace 2')).toBeInTheDocument()
  })

  it('keeps the workspace opener visible in the alternate grouping mode', () => {
    mocks.sessionLayout = 'time'

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    expect(leftControls).toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('workspace-open-button')).toHaveAttribute('data-workdir', '/workspace')
    expect(screen.getByTestId('composer-send-accessory')).not.toHaveTextContent('Workspace 1')
    expect(screen.queryByText('select workspace 2')).not.toBeInTheDocument()
  })

  it('releases docked workspace changes to the provided handler', () => {
    mocks.sessionLayout = 'time'
    const onWorkspaceChange = vi.fn()

    render(
      <AgentComposer
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

  it('releases draft workspace changes to the provided handler', () => {
    mocks.sessionLayout = 'time'
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

    expect(screen.queryByText('agent.session.workspace_status.inaccessible')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('send'))

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
  })

  it('uses the same 20px size for the workspace warning icon', async () => {
    mocks.sessionLayout = 'time'
    mocks.isDirectory.mockResolvedValueOnce(false)

    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => expect(document.querySelector('.lucide-triangle-alert')).toHaveAttribute('width', '20'))
  })

  it('does not preflight the system no-project workspace path', () => {
    mocks.sessionLayout = 'time'

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sessionOverride={{
          workspaceId: 'system-workspace-1',
          workspace: {
            id: 'system-workspace-1',
            type: 'system',
            name: 'agent.session.workspace_selector.no_project',
            path: '/Users/jd/Library/Application Support/CherryStudioDev/Data/Agents/system-workspace-1'
          }
        }}
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent(
      'agent.session.workspace_selector.no_project'
    )
    expect(screen.getByTestId('composer-send-accessory')).not.toHaveTextContent(
      'agent.session.workspace_selector.no_project'
    )
    expect(document.querySelector('.lucide-circle-slash')).toHaveAttribute('width', '20')
    expect(mocks.isDirectory).not.toHaveBeenCalled()
  })
})

async function notifyComposerBottomToolbarWidth(width: number, scrollWidth = width + 240) {
  await waitFor(() => {
    expect(
      resizeObserverMockInstances.some((instance) =>
        Array.from(instance.targets).some((target) => String(target.getAttribute('class') ?? '').includes('max-w-full'))
      )
    ).toBe(true)
  })

  const toolbarObservers = resizeObserverMockInstances.flatMap((instance) => {
    const target = Array.from(instance.targets).find((target) =>
      String(target.getAttribute('class') ?? '').includes('max-w-full')
    )
    return target ? [{ instance, target }] : []
  })
  if (toolbarObservers.length === 0) {
    throw new Error('Expected composer bottom toolbar to create a ResizeObserver')
  }

  act(() => {
    for (const { instance, target } of toolbarObservers) {
      Object.defineProperty(target, 'clientWidth', { configurable: true, value: width })
      Object.defineProperty(target, 'scrollWidth', { configurable: true, value: scrollWidth })
      instance.callback(
        [
          {
            target,
            contentRect: { width }
          } as ResizeObserverEntry
        ],
        {} as ResizeObserver
      )
    }
  })
}
