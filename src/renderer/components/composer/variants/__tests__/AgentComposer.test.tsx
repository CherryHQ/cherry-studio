import { basename } from 'node:path'

import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { toast } from '@renderer/services/toast'
import type { FileMetadata } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { FileUIPart } from '@shared/data/types/message'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { LocalSkill } from '@shared/types/skill'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installSyncRafMock } from '../../../../../../tests/__mocks__/requestAnimationFrame'
import * as ComposerDraftModule from '../../composerDraft'
import type { ComposerSurfaceProps } from '../../ComposerSurface'
import { COMPOSER_TOKEN_NODE_NAME } from '../../ComposerTokenNode'
import type { ComposerSerializedToken } from '../../tokens'
import type { ComposerToolLauncher } from '../../toolLauncher'
import { useAgentResourceMentionSource } from '../agent/useAgentResourceMentionSource'
import AgentComposerImpl, {
  AgentHomeComposer as AgentHomeComposerImpl,
  MissingAgentHomeComposer
} from '../AgentComposer'
import type * as ComposerSpeedControlModule from '../shared/ComposerSpeedControl'

const mocks = vi.hoisted(() => ({
  draftText: 'hello',
  draftTokens: undefined as ComposerSerializedToken[] | undefined,
  files: [] as FileMetadata[],
  selectedKnowledgeBases: [] as KnowledgeBase[],
  knowledgeBases: [] as KnowledgeBase[],
  knowledgeBasesLoading: false,
  agentKnowledgeBaseIds: [] as string[],
  agentConfiguration: {} as AgentConfiguration,
  modelResult: undefined as Model | undefined,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  listDirectory: vi.fn(),
  listDirectoryEntries: vi.fn(),
  createInternalEntry: vi.fn(),
  getPhysicalPath: vi.fn(),
  ipcApiRequest: vi.fn(),
  timeoutCallbacks: new Map<string, () => void>(),
  setTimeoutTimer: vi.fn(),
  clearTimeoutTimer: vi.fn(),
  updateAgent: vi.fn(),
  updateModel: vi.fn(),
  updateSession: vi.fn(),
  setFiles: vi.fn(),
  setSelectedKnowledgeBases: vi.fn(),
  inputAdapterFocus: vi.fn(),
  surfaceFocus: vi.fn(),
  quickPanelOpen: vi.fn(),
  pinnedToolIds: ['composer:new-session', 'skills'] as string[],
  pinnedLauncherIds: [] as readonly string[],
  toolLaunchers: [] as ComposerToolLauncher[],
  toolLaunchersVersion: 0,
  reconcileTokens: vi.fn(),
  insertToken: vi.fn(),
  replaceDraft: vi.fn(),
  toggleExpanded: vi.fn(),
  availableSkills: [] as LocalSkill[],
  availableSkillsLoading: false,
  availableSkillsError: null as string | null,
  availableSkillsRefresh: vi.fn(),
  openResourceEditDialog: vi.fn(),
  registeredLaunchers: new Map<string, ComposerToolLauncher[]>(),
  optionalQuickPanel: null as { isVisible: boolean; symbol: string; updateList: (items: unknown) => void } | null,
  surfaceProps: undefined as ComposerSurfaceProps | undefined,
  getDraft: vi.fn(),
  derivedToolState: undefined as
    | { couldAddImageFile: boolean; extensions: string[]; selectableKnowledgeBases?: KnowledgeBase[] }
    | undefined,
  shortcutHandlers: new Map<string, () => void>(),
  shortcutOptions: new Map<string, Record<string, unknown> | undefined>(),
  topicFulfilled: false,
  markTopicSeen: vi.fn(),
  ipcListeners: new Map<string, (_event: unknown, payload: unknown) => void>(),
  ipcOn: vi.fn(),
  sessionLayout: undefined as string | undefined,
  runtimeHostProps: undefined as
    | {
        assistant?: { modelId?: string | null }
        model?: Model
        session?: { agentId?: string }
      }
    | undefined,
  speedControlProps: undefined as
    | {
        model: Model
        reasoningEffort: string
        fastMode: boolean
        onReasoningEffortChange: (effort: string) => void
        onFastModeChange: (enabled: boolean) => void
      }
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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const createSerializedFolderToken = (folderPath: string): ComposerSerializedToken => ({
  id: `folder:${folderPath}`,
  kind: 'folder',
  label: basename(folderPath),
  description: folderPath,
  promptText: folderPath,
  index: 0,
  textOffset: 0
})

const renderAgentResourceMentionSource = (accessiblePaths: readonly string[] = ['/workspace']) =>
  renderHook(
    ({ paths }) =>
      useAgentResourceMentionSource({
        accessiblePaths: paths,
        files: mocks.files as unknown as ComposerAttachment[],
        setFiles: mocks.setFiles,
        enabled: true
      }),
    { initialProps: { paths: accessiblePaths } }
  )

const requireFirstResourceMentionSource = (
  sources: ReturnType<typeof useAgentResourceMentionSource>
): NonNullable<ReturnType<typeof useAgentResourceMentionSource>[number]> => {
  const source = sources[0]
  if (!source) throw new Error('Expected an agent resource mention source')
  return source
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

type ControlledComposerProps = ComponentProps<typeof AgentComposerImpl>
type TestComposerProps = Omit<
  ControlledComposerProps,
  'sessionOverride' | 'resolvedAgent' | 'resolvedModel' | 'resolvedWorkspaceWarning'
> &
  Partial<
    Pick<ControlledComposerProps, 'sessionOverride' | 'resolvedAgent' | 'resolvedModel' | 'resolvedWorkspaceWarning'>
  >

const createControlledSession = (): ControlledComposerProps['sessionOverride'] => ({
  workspaceId: mocks.sessionWorkspaceId,
  workspace: {
    id: mocks.sessionWorkspaceId,
    type: 'user',
    name: mocks.sessionWorkspaceName,
    path: mocks.sessionWorkspacePath
  }
})

const createControlledAgent = (): NonNullable<ControlledComposerProps['resolvedAgent']> =>
  ({
    id: 'agent-1',
    name: 'Agent',
    type: 'claude-code',
    model: 'anthropic::claude-sonnet-4-5',
    modelName: 'Claude Sonnet 4.5',
    instructions: 'Follow instructions',
    knowledgeBaseIds: mocks.agentKnowledgeBaseIds,
    configuration: mocks.agentConfiguration
  }) as unknown as NonNullable<ControlledComposerProps['resolvedAgent']>

const AgentComposer = (props: TestComposerProps) => (
  <AgentComposerImpl
    sessionOverride={createControlledSession()}
    resolvedAgent={createControlledAgent()}
    resolvedModel={mocks.modelResult}
    resolvedWorkspaceWarning={null}
    {...props}
  />
)

const AgentHomeComposer = (props: TestComposerProps) => (
  <AgentHomeComposerImpl
    sessionOverride={createControlledSession()}
    resolvedAgent={createControlledAgent()}
    resolvedModel={mocks.modelResult}
    resolvedWorkspaceWarning={null}
    {...props}
  />
)

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
const knowledgeBaseOne = { id: 'kb-1', name: 'Knowledge One' } as KnowledgeBase
const knowledgeBaseTwo = { id: 'kb-2', name: 'Knowledge Two' } as KnowledgeBase

const knowledgeBaseToken = (base: KnowledgeBase): ComposerSerializedToken => ({
  id: `knowledge:${base.id}`,
  kind: 'knowledge',
  label: base.name,
  payload: base,
  index: 0,
  textOffset: 0
})

const pdfSkillToken = {
  id: 'skill:pdf',
  kind: 'skill',
  label: 'pdf',
  description: 'Read and analyze PDFs',
  promptText: 'Use the pdf skill.',
  payload: pdfSkill
} as const

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) => mocks.ipcApiRequest(route, input)
  }
}))

// useAgentSessionSlashCommands now observes the shared slash-command catalog via
// useSharedCacheValue (globally mocked); with no catalog seeded the composer
// falls back to the builtin list. This inline cacheService only serves the
// remaining typed-draft, casual queue, and subscribe consumers.
vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: vi.fn(() => undefined),
    has: vi.fn(() => false),
    set: vi.fn(),
    getCasual: vi.fn(() => ''),
    hasCasual: vi.fn(() => false),
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
        focus: mocks.surfaceFocus,
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
        <div data-testid="composer-compact-controls">
          {props.compactWhenSingleLine ? props.renderCompactControls?.(inputAdapter, unifiedPanelControl) : null}
        </div>
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
  ComposerToolRuntimeProvider: ({
    children,
    initialState
  }: {
    children: ReactNode
    initialState?: { files?: FileMetadata[]; selectedKnowledgeBases?: KnowledgeBase[] }
  }) => {
    // The real provider seeds its selection state from `initialState` before children render, which is
    // what lets a cached knowledge chip survive the surface's managed-token sync. Mirror that here or
    // the seed is invisible to these tests. An EMPTY seed has to reset too — the real `useState` does,
    // and treating it as a no-op would let one agent's selection survive a switch to another.
    const seededRef = useRef(false)
    if (!seededRef.current) {
      seededRef.current = true
      mocks.selectedKnowledgeBases = initialState?.selectedKnowledgeBases ?? []
      if ((initialState?.files?.length ?? 0) > 0 || mocks.runtimeProviderMounts > 0) {
        mocks.files = initialState?.files ?? []
      }
    }
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
    extensions,
    selectableKnowledgeBases
  }: {
    children: ReactNode
    couldAddImageFile: boolean
    extensions: string[]
    selectableKnowledgeBases?: KnowledgeBase[]
  }) => {
    mocks.derivedToolState = { couldAddImageFile, extensions, selectableKnowledgeBases }
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
  ComposerPinnedToolsProvider: ({ children, value }: { children: ReactNode; value: readonly string[] }) => {
    mocks.pinnedLauncherIds = value
    return children
  },
  useComposerToolState: () => ({
    files: mocks.files,
    mentionedModels: [],
    selectedKnowledgeBases: mocks.selectedKnowledgeBases,
    isExpanded: false,
    couldAddImageFile: false,
    extensions: []
  }),
  useComposerToolDispatch: () => ({
    setFiles: mocks.setFiles,
    setSelectedKnowledgeBases: mocks.setSelectedKnowledgeBases,
    setIsExpanded: vi.fn(),
    addNewTopic: vi.fn(),
    onTextChange: vi.fn(),
    toolsRegistry: {
      registerLaunchers: (key: string, entries: ComposerToolLauncher[]) => {
        mocks.registeredLaunchers.set(key, entries)
        return vi.fn()
      }
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

vi.mock('@renderer/components/composer/variants/shared/ComposerSpeedControl', async (importOriginal) => {
  const actual = await importOriginal<typeof ComposerSpeedControlModule>()
  return {
    ...actual,
    ComposerSpeedControl: (props: {
      model: Model
      reasoningEffort: string
      fastMode: boolean
      onReasoningEffortChange: (effort: string) => void
      onFastModeChange: (enabled: boolean) => void
    }) => {
      mocks.speedControlProps = props
      return <div data-testid="agent-speed-control" />
    }
  }
})

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useUpdateAgent: () => ({ updateAgent: mocks.updateAgent, updateModel: mocks.updateModel })
}))

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelFilter: () => undefined
}))

vi.mock('@renderer/hooks/agent/useAgentSessionCompaction', () => ({
  useAgentSessionCompaction: () => ({ status: 'idle' })
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useUpdateSession: () => ({ updateSession: mocks.updateSession })
}))

vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => ({ bases: mocks.knowledgeBases, isLoading: mocks.knowledgeBasesLoading })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useAvailableSkills: () => ({
    skills: mocks.availableSkills,
    loading: mocks.availableSkillsLoading,
    error: mocks.availableSkillsError,
    refresh: mocks.availableSkillsRefresh
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    isPending: false,
    isFulfilled: mocks.topicFulfilled,
    markSeen: mocks.markTopicSeen
  })
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
      <button
        type="button"
        onClick={() =>
          onSelect({
            id: 'anthropic::claude-opus-4',
            providerId: 'anthropic',
            apiModelId: 'claude-opus-4',
            name: 'Claude Opus 4',
            capabilities: [],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false
          })
        }>
        select model 2
      </button>
      <button
        type="button"
        onClick={() =>
          onSelect({
            id: 'anthropic::claude-reasoning',
            providerId: 'anthropic',
            apiModelId: 'claude-reasoning',
            name: 'Claude Reasoning',
            capabilities: [],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false,
            reasoning: {
              controls: [{ kind: 'effort', values: ['low', 'high'] }],
              selectableEfforts: ['low', 'high']
            }
          })
        }>
        select reasoning model
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

vi.mock('@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost', () => ({
  ResourceEditDialogEventHost: () => null,
  openResourceEditDialog: (target: any) => mocks.openResourceEditDialog(target)
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
  // Real i18next returns a referentially stable `t`; keep it stable here so memoized
  // consumers (e.g. the @ mention suggestion source) don't churn across rerenders.
  const t = (key: string) => key
  return {
    ...actual,
    useTranslation: () => ({ t })
  }
})

// The @ mention command inserts a token via the editor chain and dedupes against the live document;
// stub the serializer so the command runs against a lightweight chain mock.
vi.mock('@renderer/components/composer/composerDraft', async (importOriginal) => ({
  ...(await importOriginal<typeof ComposerDraftModule>()),
  serializeComposerDocument: vi.fn(() => ({ text: '', tokens: [] }))
}))

// AgentComposer reads the quick panel to refresh an open skills submenu; drive it from the mock.
vi.mock('@renderer/components/QuickPanel/useQuickPanel', () => ({
  useOptionalQuickPanel: () => mocks.optionalQuickPanel,
  useQuickPanel: () => mocks.optionalQuickPanel
}))

// Mirrors just enough of the editor for token commands: the chain records inserted tokens as
// document nodes so the async reference settle path can find (or miss) them afterwards.
function buildComposerEditorMock() {
  const nodes: Array<{ type: { name: string }; attrs: Record<string, unknown>; nodeSize: number }> = []
  const chain = {
    focus: vi.fn(() => chain),
    insertComposerToken: vi.fn((token: Record<string, unknown>) => {
      nodes.push({ type: { name: COMPOSER_TOKEN_NODE_NAME }, attrs: { ...token }, nodeSize: 1 })
      return chain
    }),
    insertContent: vi.fn(() => chain),
    run: vi.fn()
  }
  const transaction = { setNodeMarkup: vi.fn(), delete: vi.fn() }
  const editor = {
    isDestroyed: false,
    chain: () => chain,
    state: {
      doc: {
        descendants: (visit: (node: unknown, position: number) => void) =>
          nodes.forEach((node, index) => visit(node, index))
      },
      tr: transaction
    },
    view: { dispatch: vi.fn() }
  } as any
  return { editor, chain, transaction, nodes }
}

// Skills live in the registered `agent-skills` launcher submenu; invoke its action with a capturing
// quickPanel to read the list it opens (skill rows followed by the pinned "manage skills" footer).
function getAgentSkillsPanelItems() {
  const launcher = mocks.registeredLaunchers.get('agent-skills')?.[0]
  if (!launcher) throw new Error('agent-skills launcher not registered')
  let list: any[] = []
  launcher.action?.({
    source: 'root-panel',
    quickPanel: { open: (options: { list: any[] }) => (list = options.list) }
  } as any)
  return list
}

// `queueContent` is the whole above-input slot, so dock assertions locate the dock child instead of
// assuming the slot IS the dock.
function getQueueDock(): any {
  const slot = mocks.surfaceProps?.queueContent as any
  if (!slot) return undefined
  const children = Array.isArray(slot.props?.children) ? slot.props.children : [slot.props?.children]
  return children.flat().find((child: any) => child?.props?.items)
}

describe('AgentComposer', () => {
  beforeEach(() => {
    // The `@` panel's entity-reference merge hits these paths; the mock factory has no
    // canned data for them, so default both to empty results.
    const dataApiGetBase = vi.mocked(dataApiService.get).getMockImplementation()
    vi.mocked(dataApiService.get).mockImplementation((async (path: string, options?: unknown) => {
      if (path === '/agent-sessions') return { items: [] }
      if (path === '/search/entities') return { query: '', groups: [] }
      return dataApiGetBase?.(path as never, options as never)
    }) as never)
    mocks.openResourceEditDialog.mockReset()
    mocks.registeredLaunchers.clear()
    mocks.optionalQuickPanel = null
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
    mocks.selectedKnowledgeBases = []
    mocks.knowledgeBases = []
    mocks.knowledgeBasesLoading = false
    mocks.agentKnowledgeBaseIds = []
    mocks.agentConfiguration = {}
    mocks.modelResult = model
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockResolvedValue(undefined)
    mocks.stop.mockReset()
    mocks.stop.mockResolvedValue(undefined)
    mocks.topicFulfilled = false
    mocks.markTopicSeen.mockReset()
    mocks.listDirectory.mockReset()
    mocks.listDirectory.mockResolvedValue([])
    mocks.listDirectoryEntries.mockReset()
    mocks.listDirectoryEntries.mockResolvedValue([])
    vi.mocked(ComposerDraftModule.serializeComposerDocument).mockReset()
    vi.mocked(ComposerDraftModule.serializeComposerDocument).mockReturnValue({ text: '', tokens: [] })
    vi.mocked(cacheService.get).mockReset()
    vi.mocked(cacheService.get).mockReturnValue(undefined)
    vi.mocked(cacheService.has).mockReset()
    vi.mocked(cacheService.has).mockReturnValue(false)
    vi.mocked(cacheService.set).mockReset()
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.getCasual).mockReturnValue(undefined)
    vi.mocked(cacheService.hasCasual).mockReset()
    vi.mocked(cacheService.hasCasual).mockReturnValue(false)
    vi.mocked(cacheService.setCasual).mockReset()
    mocks.createInternalEntry.mockReset()
    mocks.createInternalEntry.mockResolvedValue({ id: 'fe-1', ext: 'png' })
    mocks.getPhysicalPath.mockReset()
    mocks.getPhysicalPath.mockResolvedValue('/p/fe-1.png')
    mocks.ipcApiRequest.mockReset()
    mocks.ipcApiRequest.mockImplementation(
      async (route: string, input: { items?: { key: string }[]; kind?: string; path?: string }) => {
        if (route === 'file.get_metadata') {
          // The session workspace-status preflight stays pending so it never flips the composer into a
          // blocking warning (mirrors the former hanging `isDirectory` default). Send-path physical files
          // (from buildFileParts) resolve to a real file MIME instead.
          if (input.kind === 'path' && input.path === mocks.sessionWorkspacePath) {
            return new Promise(() => undefined)
          }
          return { kind: 'file', mime: 'text/markdown', size: 1, mtime: 0 }
        }
        if (route !== 'file.batch_get_metadata') return {}
        return Object.fromEntries(
          (input.items ?? []).map((item) => [item.key, { kind: 'file', mime: 'text/markdown', size: 1, mtime: 0 }])
        )
      }
    )
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
        listDirectory: mocks.listDirectory,
        listDirectoryEntries: mocks.listDirectoryEntries,
        createInternalEntry: mocks.createInternalEntry,
        getPhysicalPath: mocks.getPhysicalPath
      }
    }
    mocks.updateModel.mockReset()
    mocks.updateModel.mockResolvedValue({})
    mocks.updateAgent.mockReset()
    mocks.updateAgent.mockImplementation(async (form) => {
      mocks.agentConfiguration = { ...mocks.agentConfiguration, ...form.configuration }
      return { configuration: mocks.agentConfiguration }
    })
    mocks.updateSession.mockReset()
    mocks.setFiles.mockReset()
    mocks.setSelectedKnowledgeBases.mockReset()
    mocks.inputAdapterFocus.mockReset()
    mocks.surfaceFocus.mockReset()
    mocks.quickPanelOpen.mockReset()
    mocks.pinnedToolIds = ['composer:new-session', 'skills']
    mocks.pinnedLauncherIds = []
    mocks.toolLaunchers = []
    mocks.toolLaunchersVersion = 0
    mocks.setFiles.mockImplementation((value) => {
      mocks.files = typeof value === 'function' ? value(mocks.files) : value
    })
    mocks.setSelectedKnowledgeBases.mockImplementation((value) => {
      mocks.selectedKnowledgeBases = typeof value === 'function' ? value(mocks.selectedKnowledgeBases) : value
    })
    mocks.insertToken.mockReset()
    mocks.replaceDraft.mockReset()
    mocks.toggleExpanded.mockReset()
    mocks.availableSkills = []
    mocks.availableSkillsLoading = false
    mocks.availableSkillsError = null
    mocks.availableSkillsRefresh.mockReset()
    mocks.availableSkillsRefresh.mockResolvedValue(undefined)
    mocks.surfaceProps = undefined
    mocks.speedControlProps = undefined
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

  it('uses the page-resolved model', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.runtimeHostProps?.model).toBe(model)
    expect(mocks.runtimeHostProps?.session?.agentId).toBe('agent-1')
    expect(mocks.surfaceProps?.narrowMode).toBe(false)
    expect(mocks.surfaceProps?.deferQuickPanel).toBe(true)
  })

  it('limits Session knowledge choices to the Agent static binding', () => {
    mocks.knowledgeBases = [knowledgeBaseOne, knowledgeBaseTwo]
    mocks.agentKnowledgeBaseIds = [knowledgeBaseOne.id]
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.derivedToolState?.selectableKnowledgeBases).toEqual([knowledgeBaseOne])
    expect(mocks.runtimeHostProps?.session).toMatchObject({ knowledgeBaseIds: [knowledgeBaseOne.id] })
    expect(mocks.surfaceProps?.resolveKnowledgeBaseMarker?.(knowledgeBaseOne.name)).toMatchObject({
      id: `knowledge:${knowledgeBaseOne.id}`,
      kind: 'knowledge'
    })
    expect(mocks.surfaceProps?.resolveKnowledgeBaseMarker?.(knowledgeBaseTwo.name)).toBeNull()
  })

  it('sends the selected knowledge scope on consecutive Agent turns without clearing it', async () => {
    mocks.knowledgeBases = [knowledgeBaseOne]
    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    void act(() => mocks.setSelectedKnowledgeBases([knowledgeBaseOne]))
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )
    mocks.draftTokens = [knowledgeBaseToken(knowledgeBaseOne)]

    fireEvent.click(screen.getByText('send'))
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
    expect(mocks.sendMessage.mock.calls[0][1].body.userMessageParts).toContainEqual({
      type: 'data-knowledge-scope',
      data: { baseIds: [knowledgeBaseOne.id] }
    })

    mocks.draftText = 'second question'
    fireEvent.click(screen.getByText('send'))
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(2))
    expect(mocks.sendMessage.mock.calls[1][1].body.userMessageParts).toContainEqual({
      type: 'data-knowledge-scope',
      data: { baseIds: [knowledgeBaseOne.id] }
    })
    expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBaseOne])
  })

  it('omits the Agent scope part after the knowledge selection is cleared', async () => {
    mocks.knowledgeBases = [knowledgeBaseOne]
    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    void act(() => mocks.setSelectedKnowledgeBases([knowledgeBaseOne]))
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )
    void act(() => mocks.setSelectedKnowledgeBases([]))
    mocks.draftTokens = []
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('send'))
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce())
    expect(mocks.sendMessage.mock.calls[0][1].body.userMessageParts).not.toContainEqual(
      expect.objectContaining({ type: 'data-knowledge-scope' })
    )
  })

  it('restores a queued Agent message knowledge scope when editing it', async () => {
    mocks.knowledgeBases = [knowledgeBaseOne, knowledgeBaseTwo]
    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    void act(() => mocks.setSelectedKnowledgeBases([knowledgeBaseOne]))
    mocks.draftTokens = [knowledgeBaseToken(knowledgeBaseOne)]
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )
    fireEvent.click(screen.getByText('send'))
    const queued = getQueueDock()
    expect(queued).toBeTruthy()
    expect(queued.props.items[0].payload.userMessageParts).toContainEqual({
      type: 'data-knowledge-scope',
      data: { baseIds: [knowledgeBaseOne.id] }
    })

    void act(() => mocks.setSelectedKnowledgeBases([knowledgeBaseTwo]))
    await act(async () => queued.props.onEdit(queued.props.items[0].id))
    expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBaseOne])
  })

  it('captures Fast in the submitted Work Agent turn', async () => {
    mocks.modelResult = { ...model, supportsFastMode: true }
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    act(() => mocks.speedControlProps?.onFastModeChange(true))
    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'Use Fast', tokens: [] })
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'Use Fast' },
      {
        body: expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 'session-1',
          fastMode: true
        })
      }
    )
  })

  it('restores queued reasoning and Fast controls when editing the item', async () => {
    mocks.modelResult = {
      ...model,
      supportsFastMode: true,
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'high'] }],
        selectableEfforts: ['low', 'high']
      }
    }
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    act(() => {
      mocks.speedControlProps?.onReasoningEffortChange('high')
      mocks.speedControlProps?.onFastModeChange(true)
    })
    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'queued controls', tokens: [] })
    })

    act(() => {
      mocks.speedControlProps?.onReasoningEffortChange('low')
      mocks.speedControlProps?.onFastModeChange(false)
    })
    const dock = getQueueDock()
    await act(async () => {
      await dock.props.onEdit(dock.props.items[0].id)
    })

    expect(mocks.speedControlProps?.reasoningEffort).toBe('high')
    expect(mocks.speedControlProps?.fastMode).toBe(true)
  })

  it('preserves Default when a multi-tier model has no declared default effort', async () => {
    mocks.modelResult = {
      ...model,
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'effort', values: ['none', 'low', 'high'] }],
        selectableEfforts: ['none', 'low', 'high']
      }
    }

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
      await mocks.surfaceProps?.onSendDraft({ text: 'match the UI', tokens: [] })
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'match the UI' },
      { body: expect.objectContaining({ reasoningEffort: 'default' }) }
    )
  })

  it('clears Fast when the current provider-model pair loses support', async () => {
    mocks.modelResult = { ...model, supportsFastMode: true }
    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    act(() => mocks.speedControlProps?.onFastModeChange(true))
    expect(mocks.speedControlProps?.fastMode).toBe(true)

    mocks.modelResult = { ...model, supportsFastMode: false }
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => expect(mocks.speedControlProps?.fastMode).toBe(false))
  })

  it('blocks the send button with a model-required prompt when the agent has no configured model', async () => {
    mocks.modelResult = undefined

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('code.model_required')

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('code.model_required')
  })

  it('uses the controlled session, agent, and model context', () => {
    const resolvedAgent = {
      id: 'agent-1',
      name: 'Agent',
      type: 'claude-code',
      model: model.id,
      configuration: {}
    } as any
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sessionOverride={{
          workspaceId: 'workspace-1',
          workspace: { id: 'workspace-1', type: 'user', name: 'Workspace 1', path: '/workspace' }
        }}
        resolvedAgent={resolvedAgent}
        resolvedModel={model}
        resolvedWorkspaceWarning={null}
        externalContextControls
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.runtimeHostProps?.model).toBe(model)
    expect(mocks.runtimeHostProps?.session?.agentId).toBe('agent-1')
  })

  it('loads and persists the agent reasoning effort without replacing other configuration', () => {
    mocks.agentConfiguration = { permission_mode: 'plan', reasoning_effort: 'high' }
    mocks.modelResult = {
      ...model,
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'high'] }],
        selectableEfforts: ['low', 'high']
      }
    }

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.speedControlProps?.reasoningEffort).toBe('high')

    act(() => mocks.speedControlProps?.onReasoningEffortChange('low'))

    expect(mocks.updateAgent).toHaveBeenCalledWith(
      {
        id: 'agent-1',
        configuration: { reasoning_effort: 'low' }
      },
      { showSuccessToast: false }
    )
    expect(mocks.speedControlProps?.reasoningEffort).toBe('low')
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

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.updateModel).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        modelId: 'anthropic::claude-opus-4'
      },
      { showSuccessToast: false }
    )
  })

  it('carries a local reasoning edit into a model update only while that edit is pending', () => {
    mocks.updateAgent.mockImplementationOnce(() => new Promise(() => undefined))

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

    act(() => mocks.speedControlProps?.onReasoningEffortChange('high'))
    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.updateModel).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        modelId: 'anthropic::claude-opus-4',
        reasoningEffort: 'high'
      },
      { showSuccessToast: false }
    )
  })

  it('does not mistake an in-flight model update for a pending reasoning edit', () => {
    mocks.updateModel.mockImplementation(() => new Promise(() => undefined))

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

    fireEvent.click(screen.getByText('select model 2'))
    fireEvent.click(screen.getByText('select reasoning model'))

    expect(mocks.updateModel).toHaveBeenLastCalledWith(
      {
        agentId: 'agent-1',
        modelId: 'anthropic::claude-reasoning'
      },
      { showSuccessToast: false }
    )
  })

  it('reconciles the session reasoning selection after the model update succeeds', async () => {
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

    act(() => mocks.speedControlProps?.onReasoningEffortChange('high'))
    expect(mocks.speedControlProps?.reasoningEffort).toBe('high')

    fireEvent.click(screen.getByText('select model 2'))

    await waitFor(() => expect(mocks.speedControlProps?.reasoningEffort).toBe('default'))
  })

  it('keeps the session reasoning selection when the model update fails', async () => {
    mocks.modelResult = {
      ...model,
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'high'] }],
        selectableEfforts: ['low', 'high']
      }
    }
    mocks.updateModel.mockResolvedValueOnce(undefined)

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

    act(() => mocks.speedControlProps?.onReasoningEffortChange('high'))

    await act(async () => {
      fireEvent.click(screen.getByText('select model 2'))
      await Promise.resolve()
    })

    expect(mocks.speedControlProps?.reasoningEffort).toBe('high')
  })

  it('reconciles from the latest reasoning selection when it changes while the model update is pending', async () => {
    mocks.modelResult = {
      ...model,
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'high'] }],
        selectableEfforts: ['low', 'high']
      }
    }
    let finishModelUpdate!: (value: object) => void
    mocks.updateModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishModelUpdate = resolve
        })
    )

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

    act(() => mocks.speedControlProps?.onReasoningEffortChange('high'))
    fireEvent.click(screen.getByText('select reasoning model'))
    act(() => mocks.speedControlProps?.onReasoningEffortChange('low'))

    await act(async () => finishModelUpdate({}))

    expect(mocks.speedControlProps?.reasoningEffort).toBe('low')
  })

  it('reveals an external canonical reasoning update after the pending mutation settles', async () => {
    const reasoningUpdate = createDeferred<{ configuration: AgentConfiguration }>()
    mocks.agentConfiguration = { reasoning_effort: 'low' }
    mocks.modelResult = {
      ...model,
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
        selectableEfforts: ['low', 'medium', 'high']
      }
    }
    mocks.updateAgent.mockReturnValueOnce(reasoningUpdate.promise)
    const props = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      sendMessage: mocks.sendMessage,
      stop: mocks.stop,
      isStreaming: false
    }

    const { rerender } = render(<AgentComposer {...props} />)

    act(() => mocks.speedControlProps?.onReasoningEffortChange('high'))
    expect(mocks.speedControlProps?.reasoningEffort).toBe('high')

    mocks.agentConfiguration = { reasoning_effort: 'medium' }
    rerender(<AgentComposer {...props} />)

    expect(mocks.speedControlProps?.reasoningEffort).toBe('high')

    await act(async () => {
      reasoningUpdate.resolve({ configuration: { reasoning_effort: 'high' } })
      await reasoningUpdate.promise
    })

    expect(mocks.speedControlProps?.reasoningEffort).toBe('medium')
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

    act(() => {
      mocks.surfaceProps?.rootPanelAdditionalItems?.[0]?.action?.({} as any)
    })
    const newSessionSwitch = screen.getByRole('switch', { name: 'agent.session.new' })
    expect(newSessionSwitch).toBeChecked()
    expect(newSessionSwitch).toBeEnabled()
  })

  it('returns the new session action to the plus panel when it is unpinned', () => {
    mocks.pinnedToolIds = ['skills']
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

    expect(
      within(screen.getByTestId('composer-left-controls')).queryByRole('button', {
        name: 'agent.session.new'
      })
    ).not.toBeInTheDocument()
    expect(mocks.surfaceProps?.rootPanelLeadingItems).toEqual([expect.objectContaining({ id: 'composer:new-session' })])

    act(() => {
      mocks.surfaceProps?.rootPanelAdditionalItems?.[0]?.action?.({} as any)
    })
    expect(screen.getAllByRole('switch')[0]).toHaveAccessibleName('agent.session.new')
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

  it('keeps the skill shortcut in the input toolbar and opens the unified panel', () => {
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
    const skillButton = within(leftControls).getByRole('button', { name: 'plugins.skills' })
    const agentButton = within(leftControls).getByRole('button', { name: /Agent/ })

    expect(skillButton.compareDocumentPosition(agentButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.click(skillButton)
    expect(mocks.quickPanelOpen).toHaveBeenCalledWith({ launcherId: 'agent-skills', searchText: 'plugins.skills' })
  })

  it('keeps only pinned shortcuts in compact controls', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        compactWhenSingleLine
      />
    )

    const compactControls = screen.getByTestId('composer-compact-controls')
    expect(mocks.surfaceProps?.compactWhenSingleLine).toBe(true)
    expect(within(compactControls).getByRole('button', { name: 'plugins.skills' })).toBeInTheDocument()
    expect(within(compactControls).queryByRole('button', { name: 'agent.session.new' })).not.toBeInTheDocument()
    expect(within(compactControls).queryByRole('button', { name: /Claude Sonnet 4.5/ })).not.toBeInTheDocument()
    expect(within(compactControls).queryByRole('button', { name: 'tool menu' })).not.toBeInTheDocument()
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

    expect(within(leftControls).queryByRole('button', { name: '/clear' })).not.toBeInTheDocument()

    fireEvent.click(slashCommandsButton)
    expect(mocks.quickPanelOpen).toHaveBeenCalledWith({ searchText: 'chat.input.slash_commands.title' })

    fireEvent.click(mcpButton)
    expect(mocks.quickPanelOpen).toHaveBeenLastCalledWith({ launcherId: 'mcp-status', searchText: 'MCP' })
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

  it('strips the knowledge sentence from input history but keeps a skill sentence', async () => {
    // Input history is the one composer path backed by localStorage, so it is the only place a
    // knowledge token's prompt text could outlive its `data-knowledge-scope` part across a restart —
    // replayed as prose it would claim a base the kb_* tools were never authorized for. A skill's
    // sentence needs no accompanying part, so it must survive verbatim.
    const knowledgePrompt = `The user attached knowledge base "${knowledgeBaseOne.name}" (id: ${knowledgeBaseOne.id}).`
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
      await mocks.surfaceProps?.onSendDraft({
        text: `summarize ${knowledgePrompt} ${pdfSkillToken.promptText} now`,
        tokens: [
          { ...knowledgeBaseToken(knowledgeBaseOne), promptText: knowledgePrompt, textOffset: 'summarize '.length },
          {
            ...pdfSkillToken,
            index: 1,
            textOffset: `summarize ${knowledgePrompt} `.length
          } as ComposerSerializedToken
        ]
      })
    })

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled())
    const [saved = ''] = MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history') ?? []
    expect(saved).not.toContain(knowledgeBaseOne.id)
    expect(saved).not.toContain(knowledgePrompt)
    expect(saved).toContain(pdfSkillToken.promptText)
    expect(saved).toContain('summarize')
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
    expect(getQueueDock()).toBeTruthy()

    // Manually drain the dock. Now sendMessage runs and saveHistory fires.
    const dock = getQueueDock()
    const itemId = dock.props.items[0].id
    await act(async () => {
      await dock.props.onSteer(itemId)
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

  it('does not overwrite the persisted agent draft when dependencies change during input history preview', async () => {
    seedInputHistory(['history entry'])
    const draftCacheKey = 'agent.composer_draft.session_session-1'
    const drafts = new Map<string, unknown>([
      [
        draftCacheKey,
        {
          text: 'long in-progress agent draft',
          tokens: [],
          files: [],
          knowledgeBaseIds: [],
          workspaceKey: 'workspace-1\0/workspace',
          agentId: 'agent-1'
        }
      ]
    ])
    vi.mocked(cacheService.get).mockImplementation((key: string) => drafts.get(key))
    vi.mocked(cacheService.set).mockImplementation((key: string, value: unknown) => {
      drafts.set(key, value)
    })
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))

    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )
    vi.mocked(cacheService.set).mockClear()

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))

    mocks.files = [file]
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(cacheService.set).not.toHaveBeenCalledWith(
      draftCacheKey,
      expect.objectContaining({ text: 'history entry' }),
      expect.any(Number)
    )

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('long in-progress agent draft'))
    expect(drafts.get(draftCacheKey)).toMatchObject({ text: 'long in-progress agent draft' })
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
  it('parks the knowledge selection while previewing plain-text history and restores it on exit', async () => {
    // A history entry is stored as plain text with the knowledge sentence already folded in. Leaving
    // the pick selected would re-insert its chip on top of that sentence and send the claim twice —
    // skills and files already step aside for exactly this reason.
    seedInputHistory(['history entry'])
    mocks.knowledgeBases = [knowledgeBaseOne]
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

    void act(() => mocks.setSelectedKnowledgeBases([knowledgeBaseOne]))
    act(() => {
      mocks.surfaceProps?.onTextChange('agent draft')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('agent draft'))
    expect(mocks.surfaceProps?.tokens).toEqual([
      expect.objectContaining({ id: `knowledge:${knowledgeBaseOne.id}`, kind: 'knowledge' })
    ])

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))
    expect(mocks.selectedKnowledgeBases).toEqual([])
    expect(mocks.surfaceProps?.tokens).toEqual([])

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('agent draft'))
    expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBaseOne])
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
      extensions: mocks.surfaceProps?.supportedExts,
      selectableKnowledgeBases: []
    })
  })

  it('renders context usage for the selected Gateway model but hides a different model cache', async () => {
    mocks.modelResult = {
      ...model,
      id: 'minimax::MiniMax-M3',
      providerId: 'minimax',
      apiModelId: 'MiniMax-M3',
      name: 'MiniMax M3'
    }
    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-1', {
      categories: [],
      totalTokens: 42,
      maxTokens: 100,
      percentage: 42,
      model: 'minimax:MiniMax-M3'
    })
    mocks.sessionLayout = 'time'

    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    const modelButton = within(leftControls).getByRole('button', { name: /MiniMax M3/ })
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
    expect(within(sendAccessory).getByText('MiniMax M3')).toBeInTheDocument()
    expect(within(sendAccessory).queryByText('minimax:MiniMax-M3')).not.toBeInTheDocument()

    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-1', {
      categories: [],
      totalTokens: 24,
      maxTokens: 100,
      percentage: 24,
      model: 'openai:gpt-4o'
    })
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(
      within(screen.getByTestId('composer-send-accessory')).queryByLabelText(/context_usage/)
    ).not.toBeInTheDocument()
  })

  it('provides workspace file resources through the @ mention suggestion source', async () => {
    vi.useFakeTimers()
    try {
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

      const source = mocks.surfaceProps?.suggestionSources?.[0]
      expect(mocks.surfaceProps?.resourceProvider).toBeUndefined()
      expect(mocks.surfaceProps?.suggestionSources).toHaveLength(1)
      expect(source?.char).toBe('@')

      const emptyItems = await source?.items({ query: '', editor: buildComposerEditorMock().editor })
      expect(mocks.listDirectoryEntries).toHaveBeenLastCalledWith('/workspace', {
        recursive: false,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: true,
        maxEntries: 40,
        searchPattern: '.'
      })
      expect(mocks.listDirectory).not.toHaveBeenCalled()
      expect(emptyItems?.map((item) => item.label)).toEqual(['docs', 'docs/notes.md'])

      const itemsPromise = source?.items({ query: ' notes ', editor: buildComposerEditorMock().editor })
      await vi.advanceTimersByTimeAsync(200)
      const items = await itemsPromise
      expect(mocks.listDirectoryEntries).toHaveBeenLastCalledWith('/workspace', {
        recursive: true,
        maxDepth: 3,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: true,
        maxEntries: 40,
        searchPattern: 'notes'
      })
      expect(mocks.listDirectory).not.toHaveBeenCalled()
      expect(items?.map((item) => item.label)).toEqual(['docs', 'docs/notes.md'])

      const item = items?.find((candidate) => candidate.label === 'docs/notes.md')
      if (!item?.id) throw new Error('Expected a file suggestion item')
      expect(item).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^agent-resource:.+/),
          description: '/workspace/docs/notes.md',
          disabled: false
        })
      )
      expect(item.id).not.toContain('/workspace/docs/notes.md')

      const { editor, chain } = buildComposerEditorMock()
      item.command?.({ editor, range: { from: 0, to: 0 }, item, query: 'notes' })

      expect(chain.insertComposerToken).toHaveBeenCalledWith(
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

      const setFilesUpdater = mocks.setFiles.mock.calls.at(-1)?.[0]
      expect(typeof setFilesUpdater).toBe('function')
      const selectedFile = { id: '/workspace/docs/notes.md', path: '/workspace/docs/notes.md' } as FileMetadata
      expect(setFilesUpdater([])).toEqual([
        expect.objectContaining({
          fileTokenSourceId: expect.any(String),
          path: '/workspace/docs/notes.md'
        })
      ])
      expect(setFilesUpdater([selectedFile])).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lists an empty folder through one bounded combined root query and inserts a folder token', async () => {
    mocks.listDirectoryEntries.mockResolvedValue([{ path: '/workspace/empty', isDirectory: true }])
    const { result } = renderAgentResourceMentionSource()
    const source = requireFirstResourceMentionSource(result.current)

    const items = await source.items({ query: '', editor: buildComposerEditorMock().editor })

    expect(mocks.listDirectoryEntries).toHaveBeenCalledOnce()
    expect(mocks.listDirectoryEntries).toHaveBeenCalledWith('/workspace', {
      recursive: false,
      includeHidden: false,
      includeFiles: true,
      includeDirectories: true,
      maxEntries: 40,
      searchPattern: '.'
    })
    expect(mocks.listDirectory).not.toHaveBeenCalled()

    const folderItem = items.find((item) => item.label === 'empty')
    if (!folderItem) throw new Error('Expected an empty-folder suggestion item')
    mocks.setFiles.mockClear()
    const { editor, chain } = buildComposerEditorMock()
    folderItem.command?.({ editor, range: { from: 0, to: 0 }, item: folderItem, query: '' })

    expect(chain.insertComposerToken).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'folder',
        label: 'empty',
        description: '/workspace/empty',
        promptText: '/workspace/empty'
      })
    )
    expect(mocks.setFiles).not.toHaveBeenCalled()
  })

  it('debounces non-empty combined resource search for 200ms', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderAgentResourceMentionSource()
      const source = requireFirstResourceMentionSource(result.current)
      const itemsPromise = source.items({ query: 'notes', editor: buildComposerEditorMock().editor })

      await vi.advanceTimersByTimeAsync(199)
      expect(mocks.listDirectoryEntries).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(mocks.listDirectoryEntries).toHaveBeenCalledTimes(1)
      expect(mocks.listDirectoryEntries).toHaveBeenLastCalledWith('/workspace', {
        recursive: true,
        maxDepth: 3,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: true,
        maxEntries: 40,
        searchPattern: 'notes'
      })

      await itemsPromise
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops stale in-flight combined resource results when a newer query finishes first', async () => {
    vi.useFakeTimers()
    try {
      const noteResult = createDeferred<Array<{ path: string; isDirectory: boolean }>>()
      const notesResult = createDeferred<Array<{ path: string; isDirectory: boolean }>>()
      mocks.listDirectoryEntries.mockImplementation((_dirPath: string, options: { searchPattern?: string }) =>
        options.searchPattern === 'note' ? noteResult.promise : notesResult.promise
      )
      const { result } = renderAgentResourceMentionSource()
      const source = requireFirstResourceMentionSource(result.current)

      const staleItemsPromise = source.items({ query: 'note', editor: buildComposerEditorMock().editor })
      await vi.advanceTimersByTimeAsync(200)
      const latestItemsPromise = source.items({ query: 'notes', editor: buildComposerEditorMock().editor })
      await vi.advanceTimersByTimeAsync(200)

      notesResult.resolve([{ path: '/workspace/latest.md', isDirectory: false }])
      await expect(latestItemsPromise).resolves.toEqual([
        expect.objectContaining({ label: 'latest.md', description: '/workspace/latest.md' })
      ])

      noteResult.resolve([{ path: '/workspace/stale.md', isDirectory: false }])
      await expect(staleItemsPromise).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('invalidates an in-flight resource query when the accessible path scope changes', async () => {
    const staleResult = createDeferred<Array<{ path: string; isDirectory: boolean }>>()
    mocks.listDirectoryEntries.mockImplementation((dirPath: string) => {
      if (dirPath === '/workspace') return staleResult.promise
      return Promise.resolve([{ path: '/workspace-2/current', isDirectory: true }])
    })
    const hook = renderAgentResourceMentionSource(['/workspace'])
    const staleSource = requireFirstResourceMentionSource(hook.result.current)
    const staleItemsPromise = staleSource.items({ query: '', editor: buildComposerEditorMock().editor })

    hook.rerender({ paths: ['/workspace-2'] })
    const currentSource = requireFirstResourceMentionSource(hook.result.current)
    await expect(currentSource.items({ query: '', editor: buildComposerEditorMock().editor })).resolves.toEqual([
      expect.objectContaining({ label: 'current', description: '/workspace-2/current' })
    ])

    staleResult.resolve([{ path: '/workspace/stale', isDirectory: true }])
    await expect(staleItemsPromise).resolves.toEqual([])
  })

  it('cancels a pending debounced resource query when the mention panel exits', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderAgentResourceMentionSource()
      const source = requireFirstResourceMentionSource(result.current)
      const itemsPromise = source.items({ query: 'notes', editor: buildComposerEditorMock().editor })

      source.onExit?.({} as any)
      await vi.advanceTimersByTimeAsync(200)

      expect(mocks.listDirectoryEntries).not.toHaveBeenCalled()
      await expect(itemsPromise).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps successful resource rows when another accessible root fails', async () => {
    mocks.listDirectoryEntries
      .mockResolvedValueOnce([{ path: '/workspace/docs', isDirectory: true }])
      .mockRejectedValueOnce(new Error('offline'))
    const { result } = renderAgentResourceMentionSource(['/workspace', '/offline'])
    const source = requireFirstResourceMentionSource(result.current)

    const items = await source.items({ query: '', editor: buildComposerEditorMock().editor })

    expect(items).toEqual([expect.objectContaining({ label: 'docs', disabled: false })])
    expect(items.some((item) => item.id === 'agent-resource:error')).toBe(false)
  })

  it('describes an all-roots rejection as a workspace resource load failure', async () => {
    mocks.listDirectoryEntries.mockRejectedValue(new Error('offline'))
    const { result } = renderAgentResourceMentionSource(['/workspace', '/offline'])
    const source = requireFirstResourceMentionSource(result.current)

    await expect(source.items({ query: '', editor: buildComposerEditorMock().editor })).resolves.toEqual([
      expect.objectContaining({
        id: 'agent-resource:error',
        label: 'common.error',
        description: 'chat.input.resource_panel.load_failed',
        disabled: true
      })
    ])
  })

  it('describes a workspace without accessible paths as having no resources', async () => {
    const { result } = renderAgentResourceMentionSource([])
    const source = requireFirstResourceMentionSource(result.current)

    await expect(source.items({ query: '', editor: buildComposerEditorMock().editor })).resolves.toEqual([
      expect.objectContaining({
        id: 'agent-resource:no-paths',
        label: 'chat.input.resource_panel.no_resources_found.label',
        description: 'chat.input.resource_panel.no_resources_found.description',
        disabled: true
      })
    ])
  })

  it('marks a lexically equivalent Windows folder disabled after serializing the editor once', async () => {
    const folderPath = 'C:/workspace/docs'
    mocks.listDirectoryEntries.mockResolvedValue([{ path: folderPath, isDirectory: true }])
    vi.mocked(ComposerDraftModule.serializeComposerDocument).mockReturnValue({
      text: '',
      tokens: [createSerializedFolderToken('C:\\workspace\\docs\\.\\')]
    })
    const { result } = renderAgentResourceMentionSource(['C:/workspace'])
    const source = requireFirstResourceMentionSource(result.current)
    const { editor } = buildComposerEditorMock()

    const items = await source.items({ query: '', editor })

    expect(items).toEqual([expect.objectContaining({ label: 'docs', disabled: true })])
  })

  it('rechecks a lexically equivalent Windows folder before inserting from a stale enabled item', async () => {
    const folderPath = 'C:/workspace/docs'
    mocks.listDirectoryEntries.mockResolvedValue([{ path: folderPath, isDirectory: true }])
    const { result } = renderAgentResourceMentionSource(['C:/workspace'])
    const source = requireFirstResourceMentionSource(result.current)
    const { editor, chain } = buildComposerEditorMock()
    const items = await source.items({ query: '', editor })
    const folderItem = items[0]
    expect(folderItem).toEqual(expect.objectContaining({ label: 'docs', disabled: false }))

    vi.mocked(ComposerDraftModule.serializeComposerDocument).mockReturnValue({
      text: '',
      tokens: [createSerializedFolderToken('C:\\workspace\\docs\\.\\')]
    })
    folderItem?.command?.({ editor, range: { from: 0, to: 0 }, item: folderItem, query: '' })

    expect(chain.insertComposerToken).not.toHaveBeenCalled()
    expect(chain.insertContent).not.toHaveBeenCalled()
  })

  it('groups workspace resources and sessions under header rows when @ has no query', async () => {
    mocks.listDirectoryEntries.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({ path: `/workspace/docs/f${index}.md`, isDirectory: false }))
    )
    vi.mocked(dataApiService.get).mockImplementation((async (path: string) => {
      if (path === '/agent-sessions') {
        return {
          items: [{ id: 's1', agentId: 'agent-1', name: 'Session One', updatedAt: '2026-01-01T00:00:00.000Z' }]
        }
      }
      if (path === '/search/entities') return { query: '', groups: [] }
      return undefined
    }) as never)

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const source = mocks.surfaceProps?.suggestionSources?.[0]
    const items = await source?.items({ query: '', editor: {} as any })
    const ids = items?.map((item) => item.id)

    expect(ids?.[0]).toBe('agent-resource:resources-header')
    expect(ids).toContain('agent-resource:sessions-header')
    expect(ids).toContain('reference:session:s1')
    // Workspace resources are capped below the fold so the sessions group stays visible.
    const resourceRows = items?.filter((item) => item.id?.startsWith('agent-resource:') && !item.disabled)
    expect(resourceRows).toHaveLength(5)
    expect(ids?.indexOf('agent-resource:sessions-header')).toBeGreaterThan(
      Number(ids?.indexOf('agent-resource:resources-header'))
    )
  })

  it('inserts the reference chip at once, blocks sending, then fills it when the transcript lands', async () => {
    mocks.listDirectoryEntries.mockResolvedValue([])
    let resolveMessages: ((value: unknown) => void) | undefined
    vi.mocked(dataApiService.get).mockImplementation((async (path: string) => {
      if (path === '/agent-sessions') {
        return {
          items: [{ id: 's1', agentId: 'agent-1', name: 'Session One', updatedAt: '2026-01-01T00:00:00.000Z' }]
        }
      }
      if (path === '/agent-sessions/s1/messages') {
        return new Promise((resolve) => {
          resolveMessages = resolve
        })
      }
      if (path === '/search/entities') return { query: '', groups: [] }
      return undefined
    }) as never)

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const source = mocks.surfaceProps?.suggestionSources?.[0]
    const items = await source?.items({ query: '', editor: {} as any })
    const item = items?.find((entry) => entry.id === 'reference:session:s1')
    if (!item) throw new Error('Expected a session reference item')
    const { editor, chain, transaction } = buildComposerEditorMock()

    await act(async () => {
      item.command?.({ editor, range: { from: 0, to: 0 }, item, query: '' } as any)
    })

    // The chip is bound to this draft synchronously, still empty of context...
    expect(chain.insertComposerToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'reference:session:s1', kind: 'reference', promptText: '' })
    )
    // ...so sending stays blocked until the transcript arrives.
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('common.loading')

    await act(async () => {
      resolveMessages?.({
        items: [
          {
            id: 'm1',
            sessionId: 's1',
            role: 'user',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'session context' }] }
          }
        ],
        nextCursor: undefined
      })
    })

    expect(transaction.setNodeMarkup).toHaveBeenCalledWith(
      0,
      undefined,
      expect.objectContaining({ promptText: expect.stringContaining('session context') })
    )
    expect(mocks.surfaceProps?.sendBlockedReason).toBeUndefined()
  })

  it('drops the reference chip when its transcript fails to load', async () => {
    mocks.listDirectoryEntries.mockResolvedValue([])
    vi.mocked(dataApiService.get).mockImplementation((async (path: string) => {
      if (path === '/agent-sessions') {
        return {
          items: [{ id: 's1', agentId: 'agent-1', name: 'Session One', updatedAt: '2026-01-01T00:00:00.000Z' }]
        }
      }
      if (path === '/agent-sessions/s1/messages') throw new Error('offline')
      if (path === '/search/entities') return { query: '', groups: [] }
      return undefined
    }) as never)

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const source = mocks.surfaceProps?.suggestionSources?.[0]
    const items = await source?.items({ query: '', editor: {} as any })
    const item = items?.find((entry) => entry.id === 'reference:session:s1')
    if (!item) throw new Error('Expected a session reference item')
    const { editor, transaction } = buildComposerEditorMock()

    await act(async () => {
      item.command?.({ editor, range: { from: 0, to: 0 }, item, query: '' } as any)
    })

    expect(transaction.delete).toHaveBeenCalledWith(0, 1)
    expect(toast.error).toHaveBeenCalledWith('chat.input.reference_panel.load_failed')
    expect(mocks.surfaceProps?.sendBlockedReason).toBeUndefined()
  })

  it('keeps workspace files in the @ panel when the session query fails', async () => {
    mocks.listDirectoryEntries.mockResolvedValue([{ path: '/workspace/docs/notes.md', isDirectory: false }])
    vi.mocked(dataApiService.get).mockImplementation((async (path: string) => {
      if (path === '/agent-sessions') throw new Error('offline')
      if (path === '/search/entities') throw new Error('offline')
      return undefined
    }) as never)

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const source = mocks.surfaceProps?.suggestionSources?.[0]
    const items = await source?.items({ query: 'notes', editor: {} as any })
    const ids = items?.map((entry) => entry.id)

    expect(ids).toContain('agent-resource:sessions-error')
    expect(items?.some((entry) => entry.label === 'docs/notes.md')).toBe(true)
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
    expect(initialSuggestionSources).toHaveLength(1)

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

  it('queries the updated workspace scope through the @ mention suggestion source', async () => {
    mocks.listDirectoryEntries.mockResolvedValue([])
    const { rerender } = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const firstSource = mocks.surfaceProps?.suggestionSources?.[0]
    expect(firstSource?.char).toBe('@')
    await firstSource?.items({ query: 'notes', editor: {} as any })
    expect(mocks.listDirectoryEntries).toHaveBeenLastCalledWith(
      '/workspace',
      expect.objectContaining({ searchPattern: 'notes' })
    )

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

    const nextSource = mocks.surfaceProps?.suggestionSources?.[0]
    await nextSource?.items({ query: 'notes', editor: {} as any })
    expect(mocks.listDirectoryEntries).toHaveBeenLastCalledWith(
      '/workspace-2',
      expect.objectContaining({ searchPattern: 'notes' })
    )
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

    const source = mocks.surfaceProps?.suggestionSources?.[0]
    const items = await source?.items({ query: 'notes', editor: {} as any })
    expect(items?.[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^agent-resource:.+/),
        disabled: true
      })
    )
    expect(items?.[0]?.id).not.toContain('/workspace/docs/notes.md')
  })

  it('exposes available skills and a manage footer through the skills submenu launcher', () => {
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

    // Skills no longer render inline in the root panel; only the customize-toolbar footer does.
    expect(mocks.surfaceProps?.rootPanelAdditionalItems).toEqual([
      expect.objectContaining({ id: 'composer:customize-toolbar', fixedToBottom: true })
    ])
    const skillsLauncher = mocks.registeredLaunchers.get('agent-skills')?.[0]
    expect(skillsLauncher?.rootPanelPlacement).toBeUndefined()
    expect(skillsLauncher?.order).toBe(40)
    expect(skillsLauncher?.rootSearchItems).toEqual([expect.objectContaining({ id: 'skill:pdf' })])
    expect(mocks.pinnedLauncherIds).toEqual(['composer:new-session', 'agent-skills'])

    const items = getAgentSkillsPanelItems()
    expect(items).not.toContainEqual(expect.objectContaining({ id: 'composer:customize-toolbar' }))
    const skillItem = items[0]
    expect(skillItem).toEqual(
      expect.objectContaining({
        id: 'skill:pdf',
        label: 'pdf',
        description: 'Read and analyze PDFs',
        suffix: 'plugins.skills',
        filterText: 'pdf'
      })
    )

    // The pinned footer opens the agent's skills config.
    const manageItem = items.at(-1)
    expect(manageItem).toEqual(expect.objectContaining({ id: 'agent-skills:manage', fixedToBottom: true }))
    manageItem?.action?.({} as any)
    expect(mocks.openResourceEditDialog).toHaveBeenCalledWith({
      kind: 'agent',
      id: 'agent-1',
      initialTab: 'tools.skills'
    })

    render(<div data-testid="skill-panel-icon">{skillItem?.icon}</div>)
    expect(screen.getByTestId('skill-panel-icon').querySelector('.lucide-tool-case')).toBeInTheDocument()
    expect(mocks.surfaceProps?.managedTokenKinds).toEqual(['file', 'knowledge', 'skill'])

    mocks.availableSkillsRefresh.mockClear()
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

  it('stops excluding the skills launcher when the toolbar shortcut is unpinned in place', () => {
    const renderComposer = () => (
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )
    const { rerender } = render(renderComposer())

    expect(mocks.pinnedLauncherIds).toContain('agent-skills')

    mocks.pinnedToolIds = mocks.pinnedToolIds.filter((id) => id !== 'skills')
    rerender(renderComposer())

    expect(mocks.pinnedLauncherIds).not.toContain('agent-skills')
  })

  it('refreshes an already-open skills submenu when the skill list changes', () => {
    const updateList = vi.fn()
    mocks.optionalQuickPanel = { isVisible: true, symbol: 'agent-skills', updateList }
    mocks.availableSkills = [pdfSkill]

    const { rerender } = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(updateList).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'skill:pdf' })]))

    updateList.mockClear()
    mocks.availableSkills = [pdfSkill, reviewSkill]
    rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(updateList).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'skill:review-fast' })])
    )
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

    const skillItem = getAgentSkillsPanelItems()[0]
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

    const skillItem = getAgentSkillsPanelItems()[0]
    await act(async () => {
      skillItem?.action?.({
        context: {} as any,
        action: 'enter',
        item: skillItem,
        inputAdapter
      })
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.tokens).toContainEqual(pdfSkillToken)
    })

    inputAdapter.insertToken.mockClear()
    const currentSkillItem = getAgentSkillsPanelItems()[0]
    currentSkillItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: currentSkillItem,
      inputAdapter
    })

    expect(inputAdapter.insertToken).not.toHaveBeenCalled()
  })

  it('restores cached skill draft tokens after composer remount', () => {
    vi.mocked(cacheService.get).mockReturnValue({
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

  it('waits for the new workspace skill list before removing only unavailable cached skills', async () => {
    const staleSkill = { name: 'stale', filename: 'stale' } satisfies LocalSkill
    const staleSkillPrompt = 'Use the stale skill.'
    const folderPrompt = '/old-workspace/project'
    const cachedFileToken = {
      id: `file:${file.fileTokenSourceId}`,
      kind: 'file' as const,
      label: file.name,
      payload: file,
      index: 3,
      textOffset: 0
    }
    const cachedFolderToken = {
      id: `folder:${folderPrompt}`,
      kind: 'folder' as const,
      label: 'project',
      promptText: folderPrompt,
      index: 2,
      textOffset: pdfSkillToken.promptText.length + staleSkillPrompt.length + 2
    }
    const cachedPdfSkillToken = { ...pdfSkillToken, index: 0, textOffset: 0 }
    const cachedStaleSkillToken = {
      id: 'skill:stale',
      kind: 'skill' as const,
      label: staleSkill.name,
      promptText: staleSkillPrompt,
      payload: staleSkill,
      index: 1,
      textOffset: pdfSkillToken.promptText.length + 1
    }
    const cachedText = `${pdfSkillToken.promptText} ${staleSkillPrompt} ${folderPrompt} keep this`
    vi.mocked(cacheService.get).mockReturnValue({
      text: cachedText,
      tokens: [cachedPdfSkillToken, cachedStaleSkillToken, cachedFolderToken, cachedFileToken],
      files: [file],
      knowledgeBaseIds: [],
      workspaceKey: 'workspace-old\0/old-workspace',
      agentId: 'agent-1'
    })
    mocks.availableSkills = [pdfSkill]
    mocks.availableSkillsLoading = true

    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.files).toEqual([file])
    expect(mocks.surfaceProps?.text).toBe(cachedText)
    expect(mocks.surfaceProps?.draftTokens).toEqual([
      cachedPdfSkillToken,
      cachedStaleSkillToken,
      cachedFolderToken,
      cachedFileToken
    ])
    expect(mocks.replaceDraft).not.toHaveBeenCalled()

    mocks.availableSkillsLoading = false
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => {
      expect(mocks.surfaceProps?.text).toBe(`${pdfSkillToken.promptText} ${folderPrompt} keep this`)
    })
    expect(mocks.files).toEqual([file])
    expect(mocks.surfaceProps?.draftTokens?.map((token) => token.id)).toEqual([
      'skill:pdf',
      `folder:${folderPrompt}`,
      `file:${file.fileTokenSourceId}`
    ])
    expect(mocks.surfaceProps?.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'skill:pdf' }),
        expect.objectContaining({ id: `file:${file.fileTokenSourceId}` })
      ])
    )
    expect(mocks.surfaceProps?.tokens).not.toContainEqual(expect.objectContaining({ id: 'skill:stale' }))
  })

  it('uses an ephemeral launch draft, selects its skill, and focuses without caching', async () => {
    const issueReporter = { name: 'issue-reporter', filename: 'issue-reporter' }
    const issueReporterToken = {
      id: 'skill:issue-reporter',
      kind: 'skill' as const,
      label: 'issue-reporter',
      promptText: 'Use the issue-reporter skill.',
      payload: issueReporter,
      index: 0,
      textOffset: 0
    }
    vi.mocked(cacheService.get).mockImplementation((key: string) =>
      key === 'agent.composer_draft.session_feedback-session'
        ? { text: 'preserved ordinary draft', tokens: [] }
        : undefined
    )

    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="feedback-session"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        launchOptions={{
          initialDraft: {
            text: 'Use the issue-reporter skill.',
            tokens: [issueReporterToken]
          }
        }}
      />
    )

    expect(cacheService.get).not.toHaveBeenCalledWith('agent.composer_draft.session_feedback-session')
    expect(mocks.surfaceProps?.text).toBe('Use the issue-reporter skill.')
    expect(mocks.surfaceProps?.tokens).toContainEqual(expect.objectContaining({ id: 'skill:issue-reporter' }))
    expect(mocks.surfaceProps?.draftTokens).toEqual([issueReporterToken])
    await waitFor(() => expect(mocks.surfaceFocus).toHaveBeenCalledWith('end'))
    expect(mocks.sendMessage).not.toHaveBeenCalled()

    act(() => {
      mocks.surfaceProps?.onTextChange('Edited feedback draft')
    })
    view.unmount()

    expect(cacheService.set).not.toHaveBeenCalledWith(
      'agent.composer_draft.session_feedback-session',
      expect.anything(),
      expect.anything()
    )
  })

  it('adopts launch options that arrive after the restored session first renders', async () => {
    const issueReporterToken = {
      id: 'skill:issue-reporter',
      kind: 'skill' as const,
      label: 'issue-reporter',
      promptText: 'Use the issue-reporter skill.',
      payload: { name: 'issue-reporter', filename: 'issue-reporter' },
      index: 0,
      textOffset: 0
    }
    const defaultProps = {
      agentId: 'restored-assistant',
      sessionId: 'feedback-session',
      sendMessage: mocks.sendMessage,
      stop: mocks.stop,
      isStreaming: false
    }
    const view = render(<AgentComposer {...defaultProps} />)

    expect(mocks.surfaceProps?.text).toBe('')

    view.rerender(
      <AgentComposer
        {...defaultProps}
        launchOptions={{
          initialDraft: { text: 'Use the issue-reporter skill.', tokens: [issueReporterToken] }
        }}
      />
    )

    expect(mocks.surfaceProps?.text).toBe('Use the issue-reporter skill.')
    expect(mocks.surfaceProps?.draftTokens).toEqual([issueReporterToken])
    expect(mocks.surfaceProps?.tokens).toContainEqual(expect.objectContaining({ id: 'skill:issue-reporter' }))
    await waitFor(() => expect(mocks.surfaceFocus).toHaveBeenCalledWith('end'))

    view.rerender(<AgentComposer {...defaultProps} />)

    expect(mocks.surfaceProps?.text).toBe('Use the issue-reporter skill.')
    expect(mocks.surfaceProps?.draftTokens).toEqual([issueReporterToken])
  })

  it('consumes the launch state only after the user successfully sends the editable draft', async () => {
    const onSent = vi.fn()
    const token = {
      id: 'skill:issue-reporter',
      kind: 'skill' as const,
      label: 'issue-reporter',
      promptText: 'Use the issue-reporter skill.',
      payload: { name: 'issue-reporter', filename: 'issue-reporter' },
      index: 0,
      textOffset: 0
    }
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="feedback-session"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        launchOptions={{
          initialDraft: { text: 'Use the issue-reporter skill.', tokens: [token] },
          onSent
        }}
      />
    )

    expect(onSent).not.toHaveBeenCalled()
    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: 'Use the issue-reporter skill. The settings page is unresponsive.',
        tokens: [token]
      })
    })

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    expect(onSent).toHaveBeenCalledTimes(1)
    expect(cacheService.set).not.toHaveBeenCalledWith(
      'agent.composer_draft.session_feedback-session',
      expect.anything(),
      expect.anything()
    )
  })

  it('persists follow-up drafts once the launch draft has been sent', async () => {
    const onSent = vi.fn()
    const defaultProps = {
      agentId: 'agent-1',
      sessionId: 'feedback-session',
      sendMessage: mocks.sendMessage,
      stop: mocks.stop,
      isStreaming: false
    }
    const view = render(
      <AgentComposer
        {...defaultProps}
        launchOptions={{ initialDraft: { text: 'Use the issue-reporter skill.', tokens: [] }, onSent }}
      />
    )

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'Use the issue-reporter skill.', tokens: [] })
    })
    expect(onSent).toHaveBeenCalledTimes(1)

    // The page drops the launch options once the seeded message is sent, which hands the
    // session's draft back to the normal cache.
    view.rerender(<AgentComposer {...defaultProps} />)
    act(() => {
      mocks.surfaceProps?.onTextChange('a follow-up question')
    })
    view.unmount()

    expect(cacheService.set).toHaveBeenCalledWith(
      'agent.composer_draft.session_feedback-session',
      expect.objectContaining({ text: 'a follow-up question' }),
      expect.anything()
    )
  })

  it('carries an edited launch draft across a workspace change instead of re-seeding the template', () => {
    const defaultProps = {
      agentId: 'agent-1',
      sessionId: 'feedback-session',
      sendMessage: mocks.sendMessage,
      stop: mocks.stop,
      isStreaming: false,
      launchOptions: { initialDraft: { text: 'Use the issue-reporter skill.', tokens: [] } }
    }
    const view = render(<AgentComposer {...defaultProps} />)

    expect(mocks.surfaceProps?.text).toBe('Use the issue-reporter skill.')
    act(() => {
      mocks.surfaceProps?.onTextChange('Use the issue-reporter skill. Settings is unresponsive.')
    })

    view.rerender(<AgentComposer {...defaultProps} workspaceId="workspace-2" />)

    expect(mocks.surfaceProps?.text).toBe('Use the issue-reporter skill. Settings is unresponsive.')
  })

  it('keeps the launch state when sending fails', async () => {
    const onSent = vi.fn()
    mocks.sendMessage.mockRejectedValue(new Error('send failed'))
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="feedback-session"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        launchOptions={{
          initialDraft: { text: 'Use the issue-reporter skill.', tokens: [] },
          onSent
        }}
      />
    )

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'Use the issue-reporter skill.', tokens: [] })
    })

    expect(onSent).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.text).toBe('Use the issue-reporter skill.')
    expect(cacheService.set).not.toHaveBeenCalledWith(
      'agent.composer_draft.session_feedback-session',
      expect.anything(),
      expect.anything()
    )
  })

  it('restores a cached knowledge chip and its prompt text', async () => {
    mocks.knowledgeBases = [knowledgeBaseOne]
    const cachedToken = knowledgeBaseToken(knowledgeBaseOne)
    const promptText = 'The user attached knowledge base "Knowledge One" (id: kb-1) — use that id with the kb_* tools.'
    vi.mocked(cacheService.get).mockReturnValue({
      text: promptText,
      tokens: [
        {
          ...cachedToken,
          promptText
        }
      ],
      files: [],
      knowledgeBaseIds: [knowledgeBaseOne.id],
      workspaceKey: 'workspace-1\0/workspace',
      agentId: 'agent-1'
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

    await waitFor(() => expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBaseOne]))
    expect(mocks.surfaceProps?.text).toBe(promptText)
    expect(mocks.surfaceProps?.draftTokens).toEqual([{ ...cachedToken, promptText }])
    expect(mocks.surfaceProps?.tokens).toContainEqual(
      expect.objectContaining({ id: `knowledge:${knowledgeBaseOne.id}`, kind: 'knowledge' })
    )
  })

  it('waits for knowledge bases before reconciling a cached agent knowledge token', async () => {
    mocks.knowledgeBasesLoading = true
    vi.mocked(cacheService.get).mockReturnValue({
      text: 'cached knowledge draft',
      tokens: [knowledgeBaseToken(knowledgeBaseOne)],
      files: [],
      knowledgeBaseIds: [knowledgeBaseOne.id],
      workspaceKey: 'workspace-1\0/workspace',
      agentId: 'agent-1'
    })
    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.surfaceProps?.managedTokenKinds).toEqual(['file', 'skill'])
    expect(mocks.selectedKnowledgeBases).toEqual([])
    expect(cacheService.set).not.toHaveBeenCalled()

    mocks.knowledgeBases = [knowledgeBaseOne]
    mocks.knowledgeBasesLoading = false
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBaseOne]))
    expect(mocks.surfaceProps?.managedTokenKinds).toEqual(['file', 'knowledge', 'skill'])
    expect(cacheService.set).not.toHaveBeenCalledWith(
      'agent.composer_draft.session_session-1',
      expect.objectContaining({ knowledgeBaseIds: [] }),
      expect.any(Number)
    )
  })

  it('persists the latest agent draft when the session changes before knowledge bases finish loading', async () => {
    const draftCacheKey = 'agent.composer_draft.session_session-1'
    const drafts = new Map<string, unknown>([
      [
        draftCacheKey,
        {
          text: 'cached agent draft',
          tokens: [],
          files: [],
          knowledgeBaseIds: ['pending-kb'],
          workspaceKey: 'workspace-1\0/workspace',
          agentId: 'agent-1'
        }
      ]
    ])
    vi.mocked(cacheService.get).mockImplementation((key: string) => drafts.get(key))
    vi.mocked(cacheService.set).mockImplementation((key: string, value: unknown) => {
      drafts.set(key, value)
    })
    mocks.knowledgeBasesLoading = true

    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    act(() => mocks.surfaceProps?.onTextChange('latest agent draft'))
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('latest agent draft'))

    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-2"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(drafts.get(draftCacheKey)).toMatchObject({
      text: 'latest agent draft',
      knowledgeBaseIds: ['pending-kb']
    })
  })

  it('seeds cached files before managed file tokens reconcile', () => {
    const cachedFileToken = {
      id: `file:${file.fileTokenSourceId}`,
      kind: 'file',
      label: file.name,
      payload: file,
      index: 0,
      textOffset: 0
    } as ComposerSerializedToken
    vi.mocked(cacheService.get).mockReturnValue({
      text: 'cached file draft',
      tokens: [cachedFileToken],
      files: [file],
      knowledgeBaseIds: [],
      workspaceKey: 'workspace-1\0/workspace',
      agentId: 'agent-1'
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

    expect(mocks.files).toEqual([file])
    expect(mocks.surfaceProps?.draftTokens).toEqual([cachedFileToken])
    expect(mocks.surfaceProps?.tokens).toContainEqual(
      expect.objectContaining({ id: `file:${file.fileTokenSourceId}`, kind: 'file' })
    )
  })

  it('persists a knowledge chip and its selected id in the agent draft cache', async () => {
    mocks.knowledgeBases = [knowledgeBaseOne]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const promptText = 'The user attached knowledge base "Knowledge One" (id: kb-1) — use that id with the kb_* tools.'
    const cachedToken = { ...knowledgeBaseToken(knowledgeBaseOne), promptText }
    mocks.selectedKnowledgeBases = [knowledgeBaseOne]
    act(() => {
      mocks.surfaceProps?.onTextChange(`${promptText} keep this`)
      mocks.surfaceProps?.onTokensChange?.([cachedToken])
    })

    await waitFor(() => {
      expect(cacheService.set).toHaveBeenLastCalledWith(
        'agent.composer_draft.session_session-1',
        {
          text: `${promptText} keep this`,
          tokens: [cachedToken],
          files: [],
          knowledgeBaseIds: [knowledgeBaseOne.id],
          workspaceKey: 'workspace-1\0/workspace',
          agentId: 'agent-1'
        },
        expect.any(Number)
      )
    })
  })

  it('isolates drafts between sessions and restores knowledge when returning to a session', async () => {
    mocks.knowledgeBases = [knowledgeBaseOne]
    const cachedFileToken = {
      id: `file:${file.fileTokenSourceId}`,
      kind: 'file',
      label: file.name,
      payload: file,
      index: 1,
      textOffset: 0
    } as ComposerSerializedToken
    const cachedDrafts = new Map<string, unknown>([
      [
        'agent.composer_draft.session_session-1',
        {
          text: 'session one draft',
          tokens: [knowledgeBaseToken(knowledgeBaseOne), cachedFileToken, pdfSkillToken],
          files: [file],
          knowledgeBaseIds: [knowledgeBaseOne.id],
          workspaceKey: 'workspace-1\0/workspace',
          agentId: 'agent-1'
        }
      ],
      [
        'agent.composer_draft.session_session-2',
        {
          text: 'session two draft',
          tokens: [],
          files: [],
          knowledgeBaseIds: [],
          workspaceKey: 'workspace-1\0/workspace',
          agentId: 'agent-1'
        }
      ]
    ])
    vi.mocked(cacheService.get).mockImplementation((key: string) => cachedDrafts.get(key))

    const view = render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBaseOne]))
    expect(mocks.surfaceProps?.text).toBe('session one draft')
    expect(mocks.files).toEqual([file])
    expect(mocks.surfaceProps?.draftTokens).toEqual([
      knowledgeBaseToken(knowledgeBaseOne),
      cachedFileToken,
      pdfSkillToken
    ])

    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-2"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('session two draft'))
    expect(mocks.selectedKnowledgeBases).toEqual([])
    expect(mocks.files).toEqual([])
    expect(cacheService.set).toHaveBeenCalledWith(
      'agent.composer_draft.session_session-1',
      {
        text: 'session one draft',
        tokens: [knowledgeBaseToken(knowledgeBaseOne), cachedFileToken, pdfSkillToken],
        files: [file],
        knowledgeBaseIds: [knowledgeBaseOne.id],
        workspaceKey: 'workspace-1\0/workspace',
        agentId: 'agent-1'
      },
      expect.any(Number)
    )
    view.rerender(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('session one draft'))
    await waitFor(() => expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBaseOne]))
    expect(mocks.files).toEqual([file])
    expect(mocks.surfaceProps?.draftTokens).toEqual([
      knowledgeBaseToken(knowledgeBaseOne),
      cachedFileToken,
      pdfSkillToken
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
    const skillItem = getAgentSkillsPanelItems()[0]
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
      promptText: 'Use the review-fast skill.',
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
    const skillItem = getAgentSkillsPanelItems()[0]
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
          reasoningEffort: 'default',
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
          reasoningEffort: 'default',
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
    expect(mocks.ipcApiRequest.mock.calls.filter(([route]) => route === 'file.batch_get_metadata')).toHaveLength(1)
    expect(mocks.ipcApiRequest).toHaveBeenCalledWith('file.batch_get_metadata', {
      items: [
        { key: '/workspace/docs/alpha.md', handle: { kind: 'path', path: '/workspace/docs/alpha.md' } },
        { key: '/workspace/docs/beta.md', handle: { kind: 'path', path: '/workspace/docs/beta.md' } }
      ]
    })
    expect(mocks.createInternalEntry).toHaveBeenCalledTimes(1)
    expect(mocks.createInternalEntry).toHaveBeenCalledWith({
      source: 'path',
      path: '/tmp/local.md',
      cleanupPolicy: 'delete_when_unreferenced'
    })

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
          reasoningEffort: 'default',
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
    expect(mocks.createInternalEntry).toHaveBeenCalledWith({
      source: 'path',
      path: '/tmp/notes.md',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      {
        body: {
          agentId: 'agent-1',
          sessionId: 'session-1',
          reasoningEffort: 'default',
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
    expect(getQueueDock()).toBeTruthy()
  })

  it('sends a follow-up immediately while background tasks remain after the foreground stream ends', async () => {
    MockUseCacheUtils.setSharedCacheValue('agent.session.background_tasks.session-1', [
      { id: 'subagent-1', type: 'subagent', description: 'Audit the codebase' },
      { id: 'shell-1', type: 'local_bash', description: 'sleep 300' }
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

    fireEvent.click(screen.getByText('send'))

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
    expect(getQueueDock()).toBeFalsy()
  })

  it('drains a streaming-period follow-up when the foreground stream ends despite background tasks', async () => {
    MockUseCacheUtils.setSharedCacheValue('agent.session.background_tasks.session-1', [
      { id: 'subagent-1', type: 'subagent', description: 'Audit the codebase' }
    ])
    const props = (isStreaming: boolean) => ({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sendMessage: mocks.sendMessage,
      stop: mocks.stop,
      isStreaming
    })
    const { rerender } = render(<AgentComposer {...props(true)} />)

    fireEvent.click(screen.getByText('send'))
    mocks.topicFulfilled = true
    rerender(<AgentComposer {...props(false)} />)

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
    expect(mocks.markTopicSeen).toHaveBeenCalledTimes(1)
  })

  it('atomically restores same-text queued tokens and the skill cache from a history preview', async () => {
    seedInputHistory(['queued agent draft'])
    mocks.availableSkills = [pdfSkill]
    mocks.files = [file]
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: mocks.surfaceProps?.draftTokens?.map((token) => ({ ...token, index: 0, textOffset: 0 })) ?? []
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

    const dock = getQueueDock()
    const itemId = dock.props.items[0].id
    await act(async () => {
      await dock.props.onEdit(itemId)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued agent draft'))
    await waitFor(() => expect(getQueueDock()).toBeUndefined())
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
    expect(mocks.surfaceProps?.draftTokens).toEqual([
      expect.objectContaining({ id: 'skill:pdf', kind: 'skill' }),
      expect.objectContaining({ id: 'quote:queued-agent', kind: 'quote' }),
      expect.objectContaining({ id: `file:${file.fileTokenSourceId}`, kind: 'file' })
    ])
    expect(cacheService.set).toHaveBeenCalledWith(
      'agent.composer_draft.session_session-1',
      {
        text: 'queued agent draft',
        tokens: [
          expect.objectContaining({ id: 'skill:pdf', kind: 'skill' }),
          expect.objectContaining({ id: 'quote:queued-agent', kind: 'quote' }),
          expect.objectContaining({ id: `file:${file.fileTokenSourceId}`, kind: 'file' })
        ],
        files: [file],
        knowledgeBaseIds: [],
        workspaceKey: 'workspace-1\0/workspace',
        agentId: 'agent-1'
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
    const dock = getQueueDock()
    expect(dock).toBeTruthy()
    const itemId = dock.props.items[0].id

    mocks.sendMessage.mockRejectedValueOnce(new Error('send failed'))
    await act(async () => {
      await dock.props.onSteer(itemId)
    })

    // A failed manual steer must not silently drop the queued item.
    expect(getQueueDock().props.items.map((entry: any) => entry.id)).toContain(itemId)
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
      expect(mocks.surfaceProps?.draftTokens).toEqual([skillToken, fileToken])
    })

    fireEvent.click(screen.getByText('send'))

    await waitFor(() => {
      expect(mocks.surfaceProps?.text).toBe('draft message')
    })

    expect(mocks.sendMessage).toHaveBeenCalled()
    expect(mocks.setFiles).toHaveBeenCalledWith([])
    expect(mocks.setFiles).toHaveBeenLastCalledWith([file])
    expect(mocks.surfaceProps?.text).toBe('draft message')
    expect(mocks.surfaceProps?.draftTokens).toEqual([skillToken, fileToken])
    expect(cacheService.set).toHaveBeenLastCalledWith(
      'agent.composer_draft.session_session-1',
      {
        text: 'draft message',
        tokens: [skillToken, fileToken],
        files: [file],
        knowledgeBaseIds: [],
        workspaceKey: 'workspace-1\0/workspace',
        agentId: 'agent-1'
      },
      86400000
    )
    expect(mocks.clearTimeoutTimer).toHaveBeenCalledWith('agentComposerSendMessage')
    expect(mocks.timeoutCallbacks.has('agentComposerSendMessage')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('chat.input.send_failed')
  })

  it('inserts quoted selected text as a quote token from the main-window quote IPC', async () => {
    vi.mocked(cacheService.get).mockReturnValue({
      text: 'Existing draft',
      tokens: [],
      files: [],
      knowledgeBaseIds: [],
      workspaceKey: 'workspace-1\0/workspace',
      agentId: 'agent-1'
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
    vi.mocked(cacheService.get).mockImplementation((key: string) =>
      key === 'agent.composer_draft.session_session-1'
        ? {
            text: 'draft for agent one',
            tokens: [{ ...pdfSkillToken, index: 0, textOffset: 0 }],
            files: [],
            knowledgeBaseIds: [],
            workspaceKey: 'workspace-1\0/workspace',
            agentId: 'agent-1'
          }
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

    const belowText = belowControls.textContent ?? ''
    expect(belowText.indexOf('Agent')).toBeLessThan(belowText.indexOf('Claude Sonnet 4.5'))
    expect(belowText.indexOf('Claude Sonnet 4.5')).toBeLessThan(belowText.indexOf('Workspace 1'))
  })

  it('keeps missing-agent input local while selecting an agent', () => {
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

    expect(cacheService.set).not.toHaveBeenCalled()
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

  it('renders the controlled system no-project workspace without a local preflight', () => {
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
    expect(mocks.ipcApiRequest).not.toHaveBeenCalledWith('file.get_metadata', expect.anything())
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
