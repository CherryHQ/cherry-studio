import { cacheService } from '@data/CacheService'
import { MessageEditingProvider, useMessageEditing } from '@renderer/components/chat/editing/MessageEditingContext'
import { toast } from '@renderer/services/toast'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '../../ComposerSurface'
import type { ComposerSerializedToken } from '../../tokens'
import ChatComposer, { ChatHomeComposer, ChatPlacementComposer } from '../ChatComposer'

const mocks = vi.hoisted(() => ({
  createTopic: vi.fn(),
  updateTopic: vi.fn(),
  setModel: vi.fn(),
  setDefaultModel: vi.fn(),
  setFiles: vi.fn(),
  setMentionedModels: vi.fn(),
  setSelectedKnowledgeBases: vi.fn(),
  setIsExpanded: vi.fn(),
  updateAssistant: vi.fn(),
  focusComposer: vi.fn(),
  insertToken: vi.fn(),
  replaceDraft: vi.fn(),
  toggleExpanded: vi.fn(),
  getDraft: vi.fn(),
  reconcileTokens: vi.fn(),
  commandHandlers: new Map<string, () => void>(),
  eventListeners: new Map<string, (payload: unknown) => void>(),
  eventEmit: vi.fn(),
  eventOn: vi.fn(),
  mentionedModels: undefined as Model[] | undefined,
  selectedKnowledgeBases: undefined as KnowledgeBase[] | undefined,
  knowledgeBases: [] as KnowledgeBase[],
  assistant: undefined as any,
  model: undefined as Model | undefined,
  assistantLoading: false,
  modelPending: false,
  modelMissing: undefined as boolean | undefined,
  selectedModel: undefined as Model | undefined,
  modelSelectorProps: [] as any[],
  topicPending: false,
  surfaceProps: undefined as ComposerSurfaceProps | undefined,
  derivedToolState: undefined as { couldAddImageFile: boolean; extensions: string[] } | undefined,
  toolLaunchers: [] as any[],
  toolLaunchersVersion: 0,
  dispatchLauncher: vi.fn(),
  unifiedPanelOpen: vi.fn(),
  unifiedPanelAvailable: true,
  ipcListeners: new Map<string, (_event: unknown, payload: unknown) => void>(),
  ipcOn: vi.fn(),
  chatWrite: undefined as any,
  files: undefined as any[] | undefined,
  topicLayout: undefined as string | undefined,
  inputAdapterFocus: vi.fn()
}))

const originalResizeObserver = globalThis.ResizeObserver

const seedInputHistory = (items: string[]) => {
  MockUseCacheUtils.setPersistCacheValue('ui.composer.input_history', items)
}

const serializeComposerToken = (token: ComposerSurfaceProps['tokens'][number]) => ({
  ...token,
  index: 0,
  textOffset: 0
})

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  targets: Set<Element>
  observe: ReturnType<typeof vi.fn>
  unobserve: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

const resizeObserverMockInstances: ResizeObserverMockInstance[] = []

const model = {
  id: 'provider::model-a',
  providerId: 'provider',
  apiModelId: 'model-a',
  name: 'Model A',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} satisfies Model

const modelB = {
  id: 'provider::model-b',
  providerId: 'provider',
  apiModelId: 'model-b',
  name: 'Model B',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} satisfies Model

const modelBWithFunctionCall = {
  ...modelB,
  capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
} satisfies Model

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn(() => ''),
    setCasual: vi.fn()
  }
}))

vi.mock('@renderer/components/composer/ComposerSurface', () => {
  function MockComposerSurface(props: ComposerSurfaceProps) {
    useEffect(() => {
      props.onActionsChange?.({
        focus: mocks.focusComposer,
        onTextChange: (updater) => {
          const nextText = typeof updater === 'function' ? updater(props.text) : updater
          props.onTextChange(nextText)
        },
        toggleExpanded: mocks.toggleExpanded,
        removeToken: vi.fn(),
        insertToken: mocks.insertToken,
        replaceDraft: mocks.replaceDraft,
        getDraft: mocks.getDraft
      })
    }, [props])

    const inputAdapter = {
      focus: mocks.inputAdapterFocus,
      getText: () => props.text,
      insertText: vi.fn(),
      insertToken: vi.fn(),
      deleteTriggerRange: vi.fn()
    }
    const unifiedPanelControl = {
      available: mocks.unifiedPanelAvailable,
      open: mocks.unifiedPanelOpen
    }

    mocks.surfaceProps = props
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
      </div>
    )
  }

  return {
    default: MockComposerSurface
  }
})

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    FOCUS_CHAT_COMPOSER: 'FOCUS_CHAT_COMPOSER',
    LOCATE_MESSAGE: 'LOCATE_MESSAGE',
    SEND_MESSAGE: 'SEND_MESSAGE'
  },
  EventEmitter: {
    emit: mocks.eventEmit,
    on: mocks.eventOn
  }
}))

vi.mock('@renderer/components/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({
    children,
    initialState
  }: {
    children: ReactNode
    initialState?: { files?: any[]; mentionedModels?: Model[]; selectedKnowledgeBases?: KnowledgeBase[] }
  }) => {
    if (mocks.files === undefined) {
      mocks.files = initialState?.files ?? []
    }
    if (mocks.mentionedModels === undefined) {
      mocks.mentionedModels = initialState?.mentionedModels ?? []
    }
    if (mocks.selectedKnowledgeBases === undefined) {
      mocks.selectedKnowledgeBases = initialState?.selectedKnowledgeBases ?? []
    }
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
  ComposerToolRuntimeHost: () => null,
  ComposerToolMenu: () => <button type="button">tool menu</button>,
  ComposerActiveToolControls: () => null,
  useComposerTokenReconcile: () => mocks.reconcileTokens,
  useComposerToolState: () => ({
    files: mocks.files ?? [],
    mentionedModels: mocks.mentionedModels ?? [],
    selectedKnowledgeBases: mocks.selectedKnowledgeBases ?? [],
    isExpanded: false,
    couldAddImageFile: false,
    extensions: []
  }),
  useComposerToolDispatch: () => ({
    setFiles: mocks.setFiles,
    setMentionedModels: mocks.setMentionedModels,
    setSelectedKnowledgeBases: mocks.setSelectedKnowledgeBases,
    setIsExpanded: mocks.setIsExpanded,
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
    getLaunchers: vi.fn(() => mocks.toolLaunchers),
    dispatchLauncher: mocks.dispatchLauncher
  }),
  useComposerToolLauncherActions: () => ({
    getLaunchers: vi.fn(() => mocks.toolLaunchers),
    dispatchLauncher: mocks.dispatchLauncher
  }),
  useComposerToolLauncherVersion: () => mocks.toolLaunchersVersion
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('../SelectedModelsTrigger', () => ({
  SelectedModelsTrigger: ({
    models,
    assistantModel,
    fallbackLabel,
    iconOnly,
    className,
    disabled,
    suppressSelectionPopover,
    onModelsChange,
    onRestore
  }: any) => (
    <div
      data-testid="selected-models-trigger"
      className={className}
      data-assistant-model-id={assistantModel?.id ?? ''}
      data-model-count={String(models.length)}
      data-disabled={String(Boolean(disabled))}
      data-suppress-selection-popover={String(Boolean(suppressSelectionPopover))}>
      <span className={iconOnly ? 'sr-only' : undefined}>{models.length === 0 ? fallbackLabel : models[0].name}</span>
      <button
        type="button"
        onClick={() => onModelsChange(models.filter((currentModel: Model) => currentModel.id !== modelB.id))}>
        trigger remove model 2
      </button>
      <button type="button" onClick={() => onModelsChange([])}>
        trigger clear models
      </button>
      <button type="button" onClick={onRestore}>
        trigger restore model
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/EmojiIcon', () => ({
  default: ({ emoji }: { emoji: string }) => <span>{emoji}</span>
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: (props: any) => {
    const {
      onSelect,
      trigger,
      multiple,
      open,
      onOpenChange,
      value,
      defaultMultiSelectMode,
      multiSelectMode,
      onMultiSelectModeChange
    } = props
    mocks.modelSelectorProps.push(props)

    return (
      <div
        data-testid="model-selector"
        data-multiple={String(multiple)}
        data-open={String(Boolean(open))}
        data-default-multi-select={String(Boolean(defaultMultiSelectMode))}
        data-multi-select-mode={String(Boolean(multiSelectMode))}
        data-value-count={Array.isArray(value) ? String(value.length) : ''}>
        {trigger}
        {onOpenChange ? (
          <>
            <button type="button" onClick={() => onOpenChange(true)}>
              open model selector popup
            </button>
            <button type="button" onClick={() => onOpenChange(false)}>
              close model selector popup
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => {
            const selectedModel = mocks.selectedModel ?? modelB
            onSelect(multiple ? [selectedModel] : selectedModel)
          }}>
          select model 2
        </button>
        {multiple ? (
          <>
            <button type="button" onClick={() => onMultiSelectModeChange?.(!multiSelectMode)}>
              toggle model multi select
            </button>
            <button type="button" onClick={() => onSelect([model, modelB])}>
              select models 1 and 2
            </button>
            <button type="button" onClick={() => onSelect([])}>
              clear model selection
            </button>
          </>
        ) : null}
      </div>
    )
  }
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AssistantSelector: ({ autoSelectOnCreate, onChange, trigger, value }: any) => (
    <div
      data-testid="assistant-selector"
      data-value={value ?? ''}
      data-auto-select-on-create={String(Boolean(autoSelectOnCreate))}>
      {trigger}
      <button type="button" onClick={() => onChange('assistant-2')}>
        select assistant 2
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

vi.mock('@renderer/utils/model', () => ({
  // Mirrors the real reconcile logic using the mocked predicates below:
  // canModelUseAssistantWebSearch = isWebSearchModel || isOpenRouterBuiltInWebSearchModel || isFunctionCallingModel.
  // The first two predicates are stubbed to false here, so it reduces to the function-call check.
  canModelUseAssistantWebSearch: (currentModel?: Model) =>
    currentModel?.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL) ?? false,
  getThinkModelType: () => 'default',
  isAudioModel: () => false,
  isAudioModels: () => false,
  isEmbeddingModel: () => false,
  isFunctionCallingModel: (currentModel?: Model) =>
    currentModel?.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL) ?? false,
  isGenerateImageModel: () => false,
  isGenerateImageModels: () => false,
  isOpenRouterBuiltInWebSearchModel: () => false,
  isRerankModel: () => false,
  isSupportedReasoningEffortModel: () => false,
  isSupportedThinkingTokenModel: () => false,
  isVideoModel: () => false,
  isVideoModels: () => false,
  isVisionModel: () => false,
  isVisionModels: () => false,
  isWebSearchModel: () => false,
  MODEL_SUPPORTED_OPTIONS: { default: ['none'] },
  MODEL_SUPPORTED_REASONING_EFFORT: { default: ['none'] }
}))

vi.mock('@renderer/data/hooks/useCache', async () => {
  const { MockUseCache } = await import('@test-mocks/renderer/useCache')

  return {
    ...MockUseCache,
    useCache: (key: string) => (key === 'chat.multi_select_mode' ? [false] : [false, vi.fn()])
  }
})

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'app.spell_check.enabled': true,
      'chat.message.font_size': 14,
      'chat.narrow_mode': false,
      'chat.input.send_message_shortcut': 'Enter',
      'topic.tab.display_mode': mocks.topicLayout === 'classic' ? 'assistant' : 'time'
    }
    return [values[key]]
  }
}))

vi.mock('@renderer/hooks/chat/ChatWriteContext', () => ({
  useChatWrite: () => mocks.chatWrite ?? { pause: vi.fn() }
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: mocks.assistant,
    isLoading: mocks.assistantLoading,
    model: mocks.model,
    isModelPending: mocks.modelPending,
    isModelMissing: mocks.modelMissing ?? (!mocks.assistantLoading && !mocks.modelPending && !mocks.model),
    setModel: mocks.setModel,
    updateAssistant: mocks.updateAssistant
  })
}))

vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => ({ bases: mocks.knowledgeBases, isLoading: false })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ setDefaultModel: mocks.setDefaultModel }),
  useModels: () => ({ models: [model, modelB] })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  getProviderDisplayName: () => 'Provider',
  useProviders: () => ({ providers: [{ id: 'provider', name: 'Provider' }] })
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void) => {
    mocks.commandHandlers.set(command, handler)
  }
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicMutations: () => ({
    createTopic: mocks.createTopic,
    updateTopic: mocks.updateTopic
  })
}))

vi.mock('@renderer/hooks/useTopicAwaitingApproval', () => ({
  useTopicAwaitingApproval: () => false
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicAwaitingApproval: () => false,
  useTopicStreamStatus: () => ({ isPending: mocks.topicPending, isFulfilled: false, markSeen: () => {} })
}))

vi.mock('@shared/utils/model', () => ({
  isFunctionCallingModel: (currentModel?: Model) =>
    currentModel?.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL) ?? false,
  isNonChatModel: (currentModel?: Model) => currentModel?.capabilities.includes(MODEL_CAPABILITY.RERANK) ?? false,
  isWebSearchModel: () => false
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18nextModule>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'common.selectedItems') return `${options?.count ?? 0} selected`
        return String(options?.defaultValue ?? key)
      }
    })
  }
})

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  type: 'chat'
} as any

const unlinkedTopic = {
  id: 'topic-unlinked',
  assistantId: undefined,
  type: 'chat'
} as any

const missingAssistantTopic = {
  id: 'topic-missing',
  assistantId: 'missing-assistant',
  type: 'chat'
} as any

const StartEditingOnMount = ({ enabled = true, message, parts }: { enabled?: boolean; message: any; parts: any }) => {
  const { startEditing } = useMessageEditing()

  useEffect(() => {
    if (!enabled) return
    startEditing(message, parts)
  }, [enabled, message, parts, startEditing])

  return null
}

const StartEditingWithLockedModelsOnMount = ({
  message,
  parts,
  lockedMentionedModels
}: {
  message: any
  parts: any
  lockedMentionedModels: Model[]
}) => {
  const { startEditing } = useMessageEditing()

  useEffect(() => {
    startEditing(message, parts, { lockedMentionedModels })
  }, [lockedMentionedModels, message, parts, startEditing])

  return null
}

const StartEditingButton = ({ message, parts }: { message: any; parts: any }) => {
  const { startEditing } = useMessageEditing()

  return (
    <button type="button" onClick={() => startEditing(message, parts)}>
      start editing
    </button>
  )
}

describe('ChatComposer', () => {
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

    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.getCasual).mockReturnValue('')
    vi.mocked(cacheService.setCasual).mockReset()
    mocks.createTopic.mockReset()
    mocks.updateTopic.mockReset()
    mocks.setModel.mockReset()
    mocks.setDefaultModel.mockReset()
    mocks.setFiles.mockReset()
    mocks.setFiles.mockImplementation((value) => {
      mocks.files = typeof value === 'function' ? value(mocks.files ?? []) : value
    })
    mocks.setMentionedModels.mockReset()
    mocks.setMentionedModels.mockImplementation((nextModels: Model[] | ((previous: Model[]) => Model[])) => {
      mocks.mentionedModels = typeof nextModels === 'function' ? nextModels(mocks.mentionedModels ?? []) : nextModels
    })
    mocks.setSelectedKnowledgeBases.mockReset()
    mocks.setSelectedKnowledgeBases.mockImplementation(
      (nextBases: KnowledgeBase[] | ((previousBases: KnowledgeBase[]) => KnowledgeBase[])) => {
        const previousBases = mocks.selectedKnowledgeBases ?? []
        mocks.selectedKnowledgeBases = typeof nextBases === 'function' ? nextBases(previousBases) : nextBases
      }
    )
    mocks.setIsExpanded.mockReset()
    mocks.updateAssistant.mockReset()
    mocks.focusComposer.mockReset()
    mocks.insertToken.mockReset()
    mocks.replaceDraft.mockReset()
    mocks.toggleExpanded.mockReset()
    mocks.getDraft.mockReset()
    mocks.getDraft.mockReturnValue({ text: 'original draft', tokens: [] })
    mocks.reconcileTokens.mockReset()
    mocks.reconcileTokens.mockImplementation((draftTokens: readonly ComposerSerializedToken[]) => {
      const knowledgeTokenIds = new Set(
        draftTokens.filter((token) => token.kind === 'knowledge').map((token) => token.id)
      )
      const configuredKnowledgeBaseIds = new Set(mocks.assistant?.knowledgeBaseIds ?? [])
      const selectableKnowledgeBases =
        configuredKnowledgeBaseIds.size === 0
          ? mocks.knowledgeBases
          : mocks.knowledgeBases.filter((base) => configuredKnowledgeBaseIds.has(base.id))
      mocks.setSelectedKnowledgeBases((previousBases: KnowledgeBase[]) => {
        const nextBases = previousBases.filter((base) => knowledgeTokenIds.has(`knowledge:${base.id}`))
        const nextBaseIds = new Set(nextBases.map((base) => `knowledge:${base.id}`))
        let changed = nextBases.length !== previousBases.length

        for (const base of selectableKnowledgeBases) {
          const tokenId = `knowledge:${base.id}`
          if (!knowledgeTokenIds.has(tokenId) || nextBaseIds.has(tokenId)) continue
          nextBases.push(base)
          nextBaseIds.add(tokenId)
          changed = true
        }

        return changed ? nextBases : previousBases
      })
    })
    mocks.commandHandlers.clear()
    mocks.eventListeners.clear()
    mocks.eventEmit.mockReset()
    mocks.eventOn.mockReset()
    mocks.eventOn.mockImplementation((eventName: string, listener: (payload: unknown) => void) => {
      mocks.eventListeners.set(eventName, listener)
      return () => mocks.eventListeners.delete(eventName)
    })
    mocks.mentionedModels = undefined
    mocks.selectedKnowledgeBases = undefined
    mocks.files = undefined
    mocks.knowledgeBases = []
    mocks.assistant = {
      id: 'assistant-1',
      name: 'Assistant 1',
      emoji: 'A',
      modelId: model.id,
      settings: { enableWebSearch: true },
      knowledgeBaseIds: []
    }
    mocks.model = model
    mocks.assistantLoading = false
    mocks.modelPending = false
    mocks.modelMissing = undefined
    mocks.selectedModel = undefined
    mocks.modelSelectorProps = []
    mocks.topicPending = false
    mocks.surfaceProps = undefined
    mocks.derivedToolState = undefined
    mocks.toolLaunchers = []
    mocks.toolLaunchersVersion = 0
    mocks.dispatchLauncher.mockReset()
    mocks.unifiedPanelOpen.mockReset()
    mocks.unifiedPanelAvailable = true
    mocks.ipcListeners.clear()
    mocks.ipcOn.mockReset()
    mocks.chatWrite = undefined
    mocks.topicLayout = undefined
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
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          createInternalEntry: vi.fn(async () => ({ id: 'fe-1', ext: 'pdf' })),
          getPhysicalPath: vi.fn(async () => '/p/fe-1.pdf'),
          getMetadata: vi.fn(async () => ({ kind: 'file', mime: 'application/pdf', size: 1, mtime: 0 }))
        }
      }
    })
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('puts the tool menu at the far right of the left toolbar in the modern layout', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    const leftControls = screen.getByTestId('composer-left-controls')
    const assistantButton = within(leftControls).getByRole('button', { name: /Assistant 1/ })
    const modelButton = within(leftControls).getByRole('button', { name: /Model A/ })
    const toolMenuButton = within(leftControls).getByRole('button', { name: 'tool menu' })

    expect(assistantButton.compareDocumentPosition(modelButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(modelButton.compareDocumentPosition(toolMenuButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      within(screen.getByTestId('composer-send-accessory')).queryByRole('button', { name: 'tool menu' })
    ).not.toBeInTheDocument()
    expect(mocks.surfaceProps?.narrowMode).toBe(false)
  })

  it('keeps reasoning and web search shortcuts in the assistant composer toolbar', () => {
    const thinkingLauncher = {
      id: 'thinking',
      kind: 'group',
      label: 'assistants.settings.reasoning_effort.label',
      icon: <span data-testid="thinking-icon" />,
      sources: ['popover'],
      active: true
    }
    const webSearchLauncher = {
      id: 'web-search',
      kind: 'command',
      label: 'chat.input.web_search.label',
      icon: <span data-testid="web-search-icon" />,
      sources: ['popover'],
      active: false
    }
    mocks.toolLaunchers = [thinkingLauncher, webSearchLauncher]
    mocks.toolLaunchersVersion = 1

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    const leftControls = screen.getByTestId('composer-left-controls')
    const reasoningButton = within(leftControls).getByRole('button', {
      name: 'assistants.settings.reasoning_effort.label'
    })
    const webSearchButton = within(leftControls).getByRole('button', { name: 'chat.input.web_search.label' })
    const toolMenuButton = within(leftControls).getByRole('button', { name: 'tool menu' })

    expect(reasoningButton).toHaveAttribute('data-active', 'true')
    expect(reasoningButton).toHaveClass('text-foreground/70!', 'hover:bg-accent/60', 'hover:text-foreground!')
    expect(webSearchButton).toHaveAttribute('aria-pressed', 'false')
    expect(webSearchButton).toHaveClass('text-foreground/70!', 'hover:bg-accent/60', 'hover:text-foreground!')
    expect(webSearchButton.compareDocumentPosition(toolMenuButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.click(reasoningButton)
    expect(mocks.unifiedPanelOpen).toHaveBeenCalledWith({
      launcherId: 'thinking',
      searchText: 'assistants.settings.reasoning_effort.label'
    })

    fireEvent.click(webSearchButton)
    expect(mocks.dispatchLauncher).toHaveBeenCalledWith(
      webSearchLauncher,
      expect.objectContaining({
        source: 'popover',
        inputAdapter: expect.objectContaining({ focus: mocks.inputAdapterFocus })
      })
    )
  })

  it('keeps the home composer narrow even when chat wide layout is enabled', () => {
    render(<ChatPlacementComposer placement="home" topic={topic} onSend={vi.fn()} />)

    expect(mocks.surfaceProps?.narrowMode).toBe(true)
  })

  it('renders docked placement with toolbar controls and sendDisabled behavior', () => {
    render(<ChatPlacementComposer placement="docked" topic={topic} onSend={vi.fn()} sendDisabled />)

    expect(mocks.surfaceProps?.narrowMode).toBe(false)
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(screen.getByText('tool menu')).toBeInTheDocument()
    expect(screen.getByText('Assistant 1')).toBeInTheDocument()
    expect(screen.getByText('Model A')).toBeInTheDocument()
  })

  it('does not enable skill marker paste handling', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(mocks.surfaceProps?.resolveSkillMarker).toBeUndefined()
  })

  it('focuses only the current topic composer from the focus event', async () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    await waitFor(() => {
      expect(mocks.eventOn).toHaveBeenCalledWith('FOCUS_CHAT_COMPOSER', expect.any(Function))
    })

    act(() => {
      mocks.eventListeners.get('FOCUS_CHAT_COMPOSER')?.({ topicId: 'other-topic' })
    })
    expect(mocks.focusComposer).not.toHaveBeenCalled()

    act(() => {
      mocks.eventListeners.get('FOCUS_CHAT_COMPOSER')?.({ topicId: 'topic-1' })
    })
    expect(mocks.focusComposer).toHaveBeenCalledTimes(1)
  })

  it('shows only icons in the input bottom toolbar when it is narrow', async () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByText('Assistant 1')).not.toHaveClass('sr-only')
    expect(screen.getByText('Model A')).not.toHaveClass('sr-only')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Assistant 1')).toHaveClass('sr-only')
      expect(screen.getByText('Model A')).toHaveClass('sr-only')
    })
  })

  it('keeps input bottom toolbar labels visible when the toolbar fits', async () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    await notifyComposerBottomToolbarWidth(420, 420)

    expect(screen.getByText('Assistant 1')).not.toHaveClass('sr-only')
    expect(screen.getByText('Model A')).not.toHaveClass('sr-only')
  })

  it('passes attachment capabilities through the provider without effect mirroring', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    // Chat allows images on any model (native on a vision model, OCR text otherwise),
    // so the capability is true even though the mocked model is non-vision.
    expect(mocks.derivedToolState).toEqual({
      couldAddImageFile: true,
      extensions: mocks.surfaceProps?.supportedExts
    })
  })

  it('inserts quoted selected text as a quote token from the main-window quote IPC', async () => {
    vi.mocked(cacheService.getCasual).mockReturnValue('Existing draft')

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

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

  it('updates the topic assistant from the composer toolbar', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('assistant-selector').querySelector('.lucide-chevron-down')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select assistant 2'))

    expect(mocks.updateTopic).toHaveBeenCalledWith('topic-1', { assistantId: 'assistant-2' })
  })

  it('updates the assistant model from the composer toolbar', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector').querySelector('.lucide-chevron-down')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setModel).toHaveBeenCalledWith(modelB, { enableWebSearch: false })
  })

  it('filters reranker models from the composer model selector', () => {
    const rerankerModel = { ...modelB, capabilities: [MODEL_CAPABILITY.RERANK] }

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(mocks.modelSelectorProps.at(-1)?.filter?.(rerankerModel)).toBe(false)
  })

  it('keeps web search enabled when switching to a function-calling model', () => {
    mocks.selectedModel = modelBWithFunctionCall

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setModel).toHaveBeenCalledWith(modelBWithFunctionCall, { enableWebSearch: true })
  })

  it('uses mentioned-model multi-select when requested by the composer toolbar', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multiple', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')
    expect(mocks.setMentionedModels).toHaveBeenCalledWith([model, modelB])
    expect(mocks.setModel).not.toHaveBeenCalled()
  })

  it('sets the assistant model from the first mentioned model before sending when multi-selecting without a configured model', async () => {
    mocks.assistant = {
      ...mocks.assistant,
      modelId: null
    }
    mocks.model = undefined
    const onSend = vi.fn()

    render(<ChatComposer topic={topic} onSend={onSend} useMentionedModelSelector />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    expect(mocks.setMentionedModels).toHaveBeenCalledWith([model, modelB])
    expect(mocks.setModel).not.toHaveBeenCalled()

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(mocks.setModel).toHaveBeenCalledWith(model, { enableWebSearch: false })
    expect(onSend).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        mentionedModels: [model.id, modelB.id]
      })
    )
  })

  it('suppresses the selected-model trigger popover while the mentioned-model selector is open', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-suppress-selection-popover', 'false')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByText('open model selector popup'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-suppress-selection-popover', 'true')

    fireEvent.click(screen.getByText('close model selector popup'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-suppress-selection-popover', 'false')
  })

  it('updates the assistant model from the home model selector in single-select mode', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setModel).toHaveBeenCalledWith(modelB, { enableWebSearch: false })
    expect(mocks.setMentionedModels).toHaveBeenCalledWith([modelB])
  })

  it('does not expose selected models as editor tokens', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')

    expect(mocks.surfaceProps?.tokens.map((token) => token.kind)).not.toContain('model')
    expect(screen.queryByTestId('remove-token-model:provider::model-a')).not.toBeInTheDocument()
    expect(screen.queryByTestId('remove-token-model:provider::model-b')).not.toBeInTheDocument()
  })

  it('updates mentioned models when the selected-model trigger removes one model', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-model-count', '2')

    fireEvent.click(screen.getByText('trigger remove model 2'))

    expect(mocks.setMentionedModels).toHaveBeenLastCalledWith([model])
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(mocks.setModel).not.toHaveBeenCalled()
  })

  it('keeps an empty mentioned-model selection when the selected-model trigger removes the last model', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    fireEvent.click(screen.getByText('trigger clear models'))

    expect(mocks.setMentionedModels).toHaveBeenLastCalledWith([])
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '0')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('code.model_required')
    expect(mocks.setModel).not.toHaveBeenCalled()
  })

  it('restores the selected-model trigger to the current assistant model', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    fireEvent.click(screen.getByText('trigger restore model'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'false')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-assistant-model-id', model.id)
    expect(mocks.setMentionedModels).toHaveBeenLastCalledWith([])
    expect(mocks.setModel).not.toHaveBeenCalled()
  })

  it('does not update the default model while a persisted assistant is loading', () => {
    mocks.assistant = undefined
    mocks.model = undefined

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setDefaultModel).not.toHaveBeenCalled()
    expect(mocks.setModel).not.toHaveBeenCalled()
  })

  it('shows model selection instead of a fallback model when the assistant has no configured model', () => {
    mocks.assistant = {
      ...mocks.assistant,
      modelId: null
    }
    mocks.model = undefined

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByText('button.select_model')).toBeInTheDocument()
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('code.model_required')
  })

  it('shows assistant selection with the default model for unlinked home topics', () => {
    mocks.assistant = undefined

    render(<ChatHomeComposer topic={unlinkedTopic} onSend={vi.fn()} />)

    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('button.select_assistant')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Default Assistant')
    expect(screen.getByTestId('assistant-selector')).toHaveAttribute('data-value', '')
    expect(mocks.surfaceProps?.sendBlockedReason).toBeUndefined()
  })

  it('keeps the active assistant trigger visible in classic layout', () => {
    mocks.topicLayout = 'classic'

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('assistant-selector')).toBeInTheDocument()
    expect(screen.getByText('Assistant 1')).toBeInTheDocument()
    expect(screen.getByText('Model A')).toBeInTheDocument()
    expect(screen.queryByTestId('resource-edit-dialog-host')).not.toBeInTheDocument()
    expect(mocks.updateTopic).not.toHaveBeenCalled()
  })

  it('keeps the assistant selector available in classic layout when no assistant is selected', () => {
    mocks.topicLayout = 'classic'
    mocks.assistant = undefined

    render(<ChatHomeComposer topic={unlinkedTopic} onSend={vi.fn()} onDraftAssistantChange={vi.fn()} />)

    expect(screen.getByTestId('assistant-selector')).toHaveAttribute('data-value', '')
    expect(screen.getByTestId('assistant-selector')).toHaveAttribute('data-auto-select-on-create', 'true')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('button.select_assistant')
  })

  it('keeps the assistant switcher in the toolbar in the modern layout', () => {
    mocks.topicLayout = 'modern'

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('assistant-selector')).toBeInTheDocument()
    expect(screen.queryByTestId('resource-edit-dialog-host')).not.toBeInTheDocument()
  })

  it('puts the classic-layout empty topic action first in the toolbar and passes the selected assistant', () => {
    mocks.topicLayout = 'classic'
    const onCreateEmptyTopic = vi.fn()

    render(<ChatComposer topic={topic} onSend={vi.fn()} onCreateEmptyTopic={onCreateEmptyTopic} />)

    const leftControls = screen.getByTestId('composer-left-controls')
    const newTopicButton = within(leftControls).getByRole('button', { name: 'chat.conversation.new' })
    const modelButton = within(leftControls).getByRole('button', { name: /Model A/ })
    const toolMenuButton = within(leftControls).getByRole('button', { name: 'tool menu' })
    expect(newTopicButton.compareDocumentPosition(modelButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(modelButton.compareDocumentPosition(toolMenuButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(newTopicButton).toHaveClass('text-foreground/70!', 'hover:bg-accent/60', 'hover:text-foreground!')
    const newConversationIcon = newTopicButton.querySelector('.new-conversation-icon')
    expect(newTopicButton).toHaveClass('[&_.new-conversation-icon]:!size-5')
    expect(newConversationIcon).toHaveAttribute('width', '20')
    expect(newConversationIcon).toHaveAttribute('height', '20')
    expect(newConversationIcon).toHaveAttribute('viewBox', '0 0 24 24')
    expect(newConversationIcon).toHaveAttribute('stroke', 'currentColor')
    expect(newConversationIcon).toHaveAttribute('stroke-width', '2')
    expect(
      within(screen.getByTestId('composer-send-accessory')).queryByRole('button', { name: 'tool menu' })
    ).not.toBeInTheDocument()
    fireEvent.click(newTopicButton)
    expect(onCreateEmptyTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' })

    const newTopicItem = mocks.surfaceProps?.rootPanelLeadingItems?.[0]
    expect(newTopicItem).toEqual(
      expect.objectContaining({
        id: 'composer:new-conversation',
        label: 'chat.conversation.new',
        disabled: false,
        filterText: 'chat.conversation.new'
      })
    )
    render(<div data-testid="new-topic-panel-icon">{newTopicItem?.icon}</div>)
    expect(screen.getByTestId('new-topic-panel-icon').querySelector('.new-conversation-icon')).toBeInTheDocument()
    newTopicItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: newTopicItem
    })

    expect(onCreateEmptyTopic).toHaveBeenCalledTimes(2)
    expect(onCreateEmptyTopic).toHaveBeenLastCalledWith({ assistantId: 'assistant-1' })
  })

  it('disables the classic-layout empty topic slash action while the assistant is loading', () => {
    mocks.topicLayout = 'classic'
    mocks.assistantLoading = true
    const onCreateEmptyTopic = vi.fn()

    render(<ChatComposer topic={topic} onSend={vi.fn()} onCreateEmptyTopic={onCreateEmptyTopic} />)

    expect(mocks.surfaceProps?.rootPanelLeadingItems?.[0]).toEqual(
      expect.objectContaining({
        id: 'composer:new-conversation',
        disabled: true
      })
    )
    expect(
      within(screen.getByTestId('composer-left-controls')).getByRole('button', {
        name: 'chat.conversation.new'
      })
    ).toBeDisabled()

    mocks.commandHandlers.get('topic.create')?.()

    expect(onCreateEmptyTopic).not.toHaveBeenCalled()
  })

  it('puts the modern-layout new topic action first in the toolbar', () => {
    mocks.topicLayout = 'modern'
    const onNewTopic = vi.fn()
    const onCreateEmptyTopic = vi.fn()

    render(
      <ChatComposer topic={topic} onSend={vi.fn()} onNewTopic={onNewTopic} onCreateEmptyTopic={onCreateEmptyTopic} />
    )

    const leftControls = screen.getByTestId('composer-left-controls')
    const newTopicButton = within(leftControls).getByRole('button', { name: 'chat.conversation.new' })
    const assistantButton = within(leftControls).getByRole('button', { name: /Assistant 1/ })
    const toolMenuButton = within(leftControls).getByRole('button', { name: 'tool menu' })
    expect(newTopicButton.compareDocumentPosition(assistantButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(assistantButton.compareDocumentPosition(toolMenuButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      within(screen.getByTestId('composer-send-accessory')).queryByRole('button', { name: 'tool menu' })
    ).not.toBeInTheDocument()

    const newTopicItem = mocks.surfaceProps?.rootPanelLeadingItems?.[0]
    expect(newTopicItem).toEqual(
      expect.objectContaining({
        id: 'composer:new-conversation',
        label: 'chat.conversation.new'
      })
    )
    newTopicItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: newTopicItem
    })

    expect(onCreateEmptyTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' })
    expect(onNewTopic).not.toHaveBeenCalled()
  })

  it('shows the empty topic slash panel action when a create handler is available', () => {
    mocks.topicLayout = 'modern'
    const onCreateEmptyTopic = vi.fn()

    const { rerender } = render(<ChatComposer topic={topic} onSend={vi.fn()} onCreateEmptyTopic={onCreateEmptyTopic} />)

    expect(
      within(screen.getByTestId('composer-left-controls')).getByRole('button', {
        name: 'chat.conversation.new'
      })
    ).toBeInTheDocument()
    const newTopicItem = mocks.surfaceProps?.rootPanelLeadingItems?.[0]
    expect(newTopicItem).toEqual(
      expect.objectContaining({
        id: 'composer:new-conversation',
        label: 'chat.conversation.new'
      })
    )
    newTopicItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: newTopicItem
    })
    expect(onCreateEmptyTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' })

    mocks.topicLayout = 'classic'
    rerender(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(
      within(screen.getByTestId('composer-left-controls')).queryByRole('button', {
        name: 'chat.conversation.new'
      })
    ).not.toBeInTheDocument()
    expect(mocks.surfaceProps?.rootPanelLeadingItems).toEqual([])
  })

  it('sends unlinked home topics through the default model fallback', async () => {
    mocks.assistant = undefined
    const onSend = vi.fn()

    render(<ChatHomeComposer topic={unlinkedTopic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        mentionedModels: undefined
      })
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('sends an explicitly selected model when an unlinked home topic has no default', async () => {
    mocks.assistant = undefined
    mocks.model = undefined
    const onSend = vi.fn()

    render(<ChatHomeComposer topic={unlinkedTopic} onSend={onSend} />)

    fireEvent.click(screen.getByText('select model 2'))
    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        mentionedModels: [modelB.id]
      })
    )
    expect(toast.error).not.toHaveBeenCalledWith('code.model_required')
  })

  it('keeps an explicit unlinked-home selection when the runtime default rolls back', async () => {
    mocks.assistant = undefined
    const onSend = vi.fn()
    const view = render(<ChatHomeComposer topic={unlinkedTopic} onSend={onSend} />)

    fireEvent.click(screen.getByText('select model 2'))

    mocks.model = modelB
    view.rerender(<ChatHomeComposer topic={unlinkedTopic} onSend={onSend} />)
    mocks.model = model
    view.rerender(<ChatHomeComposer topic={unlinkedTopic} onSend={onSend} />)

    await waitFor(() => {
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B')
    })
    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        mentionedModels: [modelB.id]
      })
    )
  })

  it('keeps the remaining model in the payload when multi-select is disabled', async () => {
    mocks.assistant = undefined
    mocks.model = undefined
    const onSend = vi.fn()

    render(<ChatHomeComposer topic={unlinkedTopic} onSend={onSend} />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select model 2'))
    fireEvent.click(screen.getByText('toggle model multi select'))
    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        mentionedModels: [modelB.id]
      })
    )
  })

  it('blocks sends for missing-assistant topics until a new assistant is selected', async () => {
    mocks.assistant = undefined
    const onSend = vi.fn()

    render(<ChatComposer topic={missingAssistantTopic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })
    fireEvent.click(screen.getByText('select assistant 2'))

    expect(onSend).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('button.select_assistant')
    expect(mocks.updateTopic).toHaveBeenCalledWith('topic-missing', { assistantId: 'assistant-2' })
    expect(mocks.setDefaultModel).not.toHaveBeenCalled()
  })

  it('does not auto-select assistants created from a persisted topic', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('assistant-selector')).toHaveAttribute('data-auto-select-on-create', 'false')
  })

  it('shows a loading model state while the assistant model is resolving', () => {
    mocks.assistant = undefined
    mocks.model = undefined
    mocks.assistantLoading = true
    mocks.modelPending = true

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getAllByText('common.loading').length).toBeGreaterThan(0)
    expect(screen.queryByText('button.select_model')).not.toBeInTheDocument()
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBeUndefined()
  })

  it('blocks send with a model-required toast when the assistant has no configured model', async () => {
    mocks.assistant = {
      ...mocks.assistant,
      modelId: null
    }
    mocks.model = undefined
    const onSend = vi.fn()

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('code.model_required')
  })

  it('queues a follow-up while the topic is streaming (does not send directly)', async () => {
    mocks.topicPending = true
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })
    })

    // Busy → the message is queued, not sent; the dock surfaces through `queueContent`.
    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.queueContent).toBeTruthy()
  })

  it('atomically restores a same-text queued draft with unmanaged tokens from a history preview', async () => {
    seedInputHistory(['queued draft'])
    mocks.topicPending = true
    const queuedFile = { fileTokenSourceId: 'queued-source', name: 'queued.pdf', path: '/tmp/queued.pdf' } as any
    const queuedQuote = {
      id: 'quote:queued',
      kind: 'quote' as const,
      label: 'Queued quote',
      promptText: 'quoted context',
      index: 0,
      textOffset: 0
    }
    mocks.files = [queuedFile]
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: mocks.surfaceProps?.tokens.map(serializeComposerToken) ?? []
    }))

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: 'queued draft',
        tokens: [
          queuedQuote,
          {
            id: 'file:queued-source',
            kind: 'file',
            label: 'queued.pdf',
            payload: queuedFile,
            index: 1,
            textOffset: 0
          }
        ]
      })
    })

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued draft'))

    const queueContent = mocks.surfaceProps?.queueContent as any
    const itemId = queueContent.props.items[0].id
    await act(async () => {
      await queueContent.props.onEdit(itemId)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued draft'))
    await waitFor(() => expect(mocks.surfaceProps?.queueContent).toBeUndefined())
    expect(mocks.files).toEqual([queuedFile])
    expect(mocks.replaceDraft).toHaveBeenLastCalledWith({
      text: 'queued draft',
      tokens: [queuedQuote, expect.objectContaining({ id: 'file:queued-source', kind: 'file' })]
    })

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(false)
    })
    expect(mocks.surfaceProps?.text).toBe('queued draft')

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued draft'))
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('queued draft'))
    expect(mocks.files).toEqual([queuedFile])
  })

  it('stays sendable with attachments but no text (pure-attachment, matching the v1 Inputbar)', () => {
    mocks.files = [{ fileTokenSourceId: 'src-1', name: 'doc.pdf', path: '/tmp/doc.pdf' } as any]

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    // No text typed, but a file is attached → the composer must not disable send.
    expect(mocks.surfaceProps?.sendDisabled).toBe(false)
  })

  it('does not submit a file-only draft before the file token is reflected in the editor', async () => {
    mocks.files = [{ fileTokenSourceId: 'src-1', name: 'doc.pdf', path: '/tmp/doc.pdf' } as any]
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: '', tokens: [] })
    })

    expect(onSend).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalledWith('chat.input.send_failed')
  })

  it('does not submit a text draft before a newly attached file token is reflected in the editor', async () => {
    mocks.files = [{ fileTokenSourceId: 'src-1', name: 'doc.pdf', path: '/tmp/doc.pdf' } as any]
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'summarize this', tokens: [] })
    })

    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.files).toHaveLength(1)
    expect(toast.error).not.toHaveBeenCalledWith('chat.input.send_failed')
  })

  it('does not submit a text draft while only some attached file tokens are reflected in the editor', async () => {
    const syncedFile = { fileTokenSourceId: 'src-1', name: 'first.pdf', path: '/tmp/first.pdf' } as any
    const unsyncedFile = { fileTokenSourceId: 'src-2', name: 'second.pdf', path: '/tmp/second.pdf' } as any
    mocks.files = [syncedFile, unsyncedFile]
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: 'summarize these',
        tokens: [
          {
            id: 'file:src-1',
            kind: 'file',
            label: 'first.pdf',
            payload: syncedFile,
            index: 0,
            textOffset: 0
          } as ComposerSerializedToken
        ]
      })
    })

    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.files).toEqual([syncedFile, unsyncedFile])
    expect(toast.error).not.toHaveBeenCalledWith('chat.input.send_failed')
  })

  it('keeps a steered follow-up in the dock and toasts when its manual send fails', async () => {
    mocks.topicPending = true
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'queued', tokens: [] })
    })
    const queueContent = mocks.surfaceProps?.queueContent as any
    expect(queueContent).toBeTruthy()
    const itemId = queueContent.props.items[0].id

    onSend.mockRejectedValueOnce(new Error('send failed'))
    await act(async () => {
      await queueContent.props.onSteer(itemId)
    })

    // A failed manual steer must not silently drop the queued item.
    expect(queueContent.props.items.map((entry: any) => entry.id)).toContain(itemId)
    expect(toast.error).toHaveBeenCalledWith('chat.input.send_failed')
    expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual([])
  })

  describe('input history', () => {
    it('saves the sent text to input history after onSend resolves', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined)

      render(<ChatComposer topic={topic} onSend={onSend} />)

      await act(async () => {
        await mocks.surfaceProps?.onSendDraft({ text: 'final message', tokens: [] })
      })

      // saveHistory fires after onSend resolves; wait for the awaited promise to settle.
      await waitFor(() => {
        expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual(['final message'])
      })
    })

    it('does NOT save input history when onSend rejects', async () => {
      const onSend = vi.fn().mockRejectedValue(new Error('send failed'))

      render(<ChatComposer topic={topic} onSend={onSend} />)

      await act(async () => {
        await mocks.surfaceProps?.onSendDraft({ text: 'doomed message', tokens: [] })
      })

      // onSend rejected → saveHistory must NOT have been called.
      expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual([])
    })

    it('does NOT save input history for queued steer follow-ups during streaming', async () => {
      mocks.topicPending = true
      const onSend = vi.fn().mockResolvedValue(undefined)

      render(<ChatComposer topic={topic} onSend={onSend} />)

      await act(async () => {
        await mocks.surfaceProps?.onSendDraft({ text: 'queued steer', tokens: [] })
      })

      // The follow-up is queued (not actually sent), so history must stay clean.
      // onSend should also NOT have been called directly — it goes through the dock.
      expect(onSend).not.toHaveBeenCalled()
      expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual([])

      // Manually draining the dock via the queue's onSteer should send through onSend
      // AND save history. This proves the history write happens only at the real-send moment.
      const queueContent = mocks.surfaceProps?.queueContent as any
      const itemId = queueContent.props.items[0].id
      await act(async () => {
        await queueContent.props.onSteer(itemId)
      })

      await waitFor(() => {
        expect(onSend).toHaveBeenCalled()
        expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual(['queued steer'])
      })
    })
  })

  it('keeps the current draft when sending a new message fails', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('open failed'))

    render(<ChatComposer topic={topic} onSend={onSend} />)

    act(() => {
      mocks.surfaceProps?.onTextChange('draft message')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('draft message'))

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'draft message', tokens: [] })
    })

    expect(onSend).toHaveBeenCalledWith(
      'draft message',
      expect.objectContaining({
        userMessageParts: [expect.objectContaining({ type: 'text', text: 'draft message' })]
      })
    )
    expect(mocks.surfaceProps?.text).toBe('draft message')
  })

  it('wires ArrowUp input history navigation and applies the latest history text to the composer', async () => {
    seedInputHistory(['previous chat prompt'])

    // getDraft() is called by handleInputHistoryNavigate to snapshot the entry
    // draft. Default vi.fn() returns undefined, which would cause useInputHistory
    // to treat the snapshot as missing and restore the empty fallback. Return the
    // current text/tokens prop to simulate the live composer draft.
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.text).toBe('previous chat prompt')
    })
  })

  it('replaces the full composer draft when recalling history with the same text', async () => {
    seedInputHistory(['same prompt'])
    mocks.getDraft.mockReturnValue({
      text: 'same prompt',
      tokens: [
        {
          id: 'quote-1',
          kind: 'quote',
          label: 'Quote',
          promptText: 'same prompt',
          index: 0,
          textOffset: 0
        }
      ]
    })

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)
    act(() => {
      mocks.surfaceProps?.onTextChange('same prompt')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('same prompt'))

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })

    expect(mocks.replaceDraft).toHaveBeenCalledWith({ text: 'same prompt', tokens: [] })
  })

  it('does not overwrite the cached draft while previewing input history', async () => {
    seedInputHistory(['history entry'])
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    act(() => {
      mocks.surfaceProps?.onTextChange('real draft')
    })
    await waitFor(() => {
      expect(cacheService.setCasual).toHaveBeenCalledWith(
        'inputbar-draft',
        { text: 'real draft', tokens: [], files: [] },
        expect.any(Number)
      )
    })
    vi.mocked(cacheService.setCasual).mockClear()

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))

    expect(cacheService.setCasual).not.toHaveBeenCalled()

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => {
      expect(cacheService.setCasual).toHaveBeenCalledWith(
        'inputbar-draft',
        { text: 'real draft', tokens: [], files: [] },
        expect.any(Number)
      )
    })
  })

  it('wires ArrowDown input history navigation to restore the entry draft', async () => {
    seedInputHistory(['history entry'])

    // Mirror the live draft on every getDraft() call so navigateHistory can snapshot it.
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    // Walk in then out: the last applied value must be the original draft.
    act(() => {
      mocks.surfaceProps?.onTextChange('my original draft')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('my original draft'))

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('my original draft'))
  })

  it('resets input history navigation after a successful send, so a subsequent ArrowDown does not restore the recalled draft', async () => {
    // Regression: clearCurrentDraft must also drop useInputHistory's nav state.
    // Without that, recalling a history item, sending it, then pressing ArrowDown
    // would restore the already-sent draft instead of staying on the fresh empty
    // composer; ArrowUp would also resume from the stale index.
    seedInputHistory(['sent history entry'])
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))

    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<ChatComposer topic={topic} onSend={onSend} />)

    // Recall the history entry — composer text becomes the recalled content.
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('sent history entry'))

    // Send the recalled draft without any further edits.
    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'sent history entry', tokens: [] })
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe(''))

    // ArrowDown after a successful send must NOT restore the recalled draft;
    // it should leave the composer empty (and ArrowUp should restart from -1,
    // i.e. recall the latest history entry on the next press).
    act(() => {
      mocks.surfaceProps?.onInputHistoryNavigate?.('down')
    })
    expect(mocks.surfaceProps?.text).toBe('')

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('sent history entry'))
  })

  it('preserves in-progress draftTokens when navigating to history (does not clear them)', async () => {
    seedInputHistory(['history entry'])

    // The entry draft must carry a non-empty token array so we can verify the round-trip
    // restores it. getDraft() is what handleInputHistoryNavigate calls to snapshot the
    // current draft — its return value flows into useInputHistory's draftBeforeHistoryRef
    // and ultimately back into ChatComposer.applyHistoryDraft on ArrowDown.
    const inProgressSkillToken = {
      id: 'skill:pdf',
      kind: 'skill',
      label: 'pdf',
      index: 0,
      textOffset: 0
    }
    mocks.getDraft.mockImplementation(() => ({
      text: 'partial @pdf',
      tokens: [inProgressSkillToken]
    }))

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    // Pre-condition: no draft tokens yet.
    expect(mocks.surfaceProps?.draftTokens).toBeUndefined()

    // Enter history. useInputHistory snapshots the entry draft (with the in-progress
    // skill token) and applies the history content. History has no tokens, so
    // ChatComposer.applyHistoryDraft sets draftTokens to undefined.
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))
    expect(mocks.surfaceProps?.draftTokens).toBeUndefined()

    // Exit history. The entry draft (with the skill token) must come back.
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('partial @pdf'))
    expect(mocks.surfaceProps?.draftTokens).toEqual([inProgressSkillToken])

    // Reference the local symbol so the lint tool doesn't flag it as unused.
    expect(inProgressSkillToken.id).toBe('skill:pdf')
  })

  it('clears chat tool state while previewing plain-text history and restores the entry draft tools', async () => {
    seedInputHistory(['history entry'])
    const file = { fileTokenSourceId: 'source-1', name: 'doc.pdf', path: '/tmp/doc.pdf' } as any
    const knowledgeBase = { id: 'kb-1', name: 'Knowledge One', documentCount: 1 } as KnowledgeBase
    mocks.files = [file]
    mocks.knowledgeBases = [knowledgeBase]
    mocks.assistant = {
      ...mocks.assistant,
      knowledgeBaseIds: ['kb-1']
    }
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: mocks.surfaceProps?.tokens.map(serializeComposerToken) ?? []
    }))

    const onSend = vi.fn()
    const view = render(<ChatComposer topic={topic} onSend={onSend} />)
    mocks.selectedKnowledgeBases = [knowledgeBase]
    view.rerender(<ChatComposer topic={topic} onSend={onSend} />)

    expect(mocks.surfaceProps?.tokens).toEqual([
      expect.objectContaining({ id: 'file:source-1' }),
      expect.objectContaining({ id: 'knowledge:kb-1' })
    ])
    expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBase])

    act(() => {
      mocks.surfaceProps?.onTextChange('chat draft')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('chat draft'))

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))
    expect(mocks.files).toEqual([])
    expect(mocks.selectedKnowledgeBases).toEqual([])
    expect(mocks.surfaceProps?.tokens).toEqual([])

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('chat draft'))
    expect(mocks.files).toEqual([file])
    expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBase])
    expect(mocks.surfaceProps?.tokens).toEqual([
      expect.objectContaining({ id: 'file:source-1' }),
      expect.objectContaining({ id: 'knowledge:kb-1' })
    ])
  })

  it('clears mentioned models while previewing plain-text history before sending', async () => {
    seedInputHistory(['history entry'])
    mocks.mentionedModels = [model, modelB]
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatHomeComposer topic={topic} onSend={onSend} />)

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))
    expect(mocks.mentionedModels).toEqual([])

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'history entry', tokens: [] })
    })

    expect(onSend).toHaveBeenCalledWith(
      'history entry',
      expect.objectContaining({
        mentionedModels: undefined
      })
    )
  })

  it('restores mentioned models when leaving input history navigation', async () => {
    seedInputHistory(['history entry'])
    mocks.mentionedModels = [model, modelB]
    mocks.getDraft.mockImplementation(() => ({
      text: mocks.surfaceProps?.text ?? '',
      tokens: []
    }))

    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    await waitFor(() => expect(mocks.mentionedModels).toEqual([model, modelB]))
  })

  it('keeps a mentioned-model selection made while previewing history', async () => {
    seedInputHistory(['history entry'])
    mocks.mentionedModels = [model]
    mocks.getDraft.mockImplementation(() => ({ text: mocks.surfaceProps?.text ?? '', tokens: [] }))

    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))
    vi.mocked(cacheService.setCasual).mockClear()

    fireEvent.click(screen.getByText('toggle model multi select'))
    expect(cacheService.setCasual).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('select models 1 and 2'))
    expect(mocks.mentionedModels).toEqual([model, modelB])
    expect(cacheService.setCasual).toHaveBeenCalledWith(
      'inputbar-draft',
      { text: 'history entry', tokens: [], files: [] },
      expect.any(Number)
    )

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(false)
    })
    expect(mocks.mentionedModels).toEqual([model, modelB])
  })

  it('does NOT save input history when editing a previous message via forkAndResend', async () => {
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage: vi.fn(), resend: vi.fn(), forkAndResend }

    const message = { id: 'msg-1', topicId: topic.id }
    const parts = [{ type: 'text', text: 'original message' }]

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={parts} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'edited text', tokens: [] })
    })

    expect(forkAndResend).toHaveBeenCalled()
    // Edits do not represent new "things the user said" — they should not enter history.
    expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual([])
  })

  it('restores file and quote tokens with attached files from the global draft cache', async () => {
    const cachedFile = {
      id: 'file-1',
      name: 'doc.pdf',
      origin_name: 'doc.pdf',
      ext: '.pdf',
      type: 'document',
      size: 1,
      count: 1,
      path: '/tmp/doc.pdf',
      created_at: '2026-01-01T00:00:00.000Z',
      fileTokenSourceId: 'source-1'
    } as any
    const cachedFileToken = {
      id: 'file:source-1',
      kind: 'file',
      label: 'doc.pdf',
      payload: cachedFile,
      index: 0,
      textOffset: 0
    } as ComposerSerializedToken
    const cachedQuoteToken = {
      id: 'quote-1',
      kind: 'quote',
      label: 'Quote',
      promptText: 'quoted text',
      index: 1,
      textOffset: 0
    } as ComposerSerializedToken
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key === 'inputbar-draft'
        ? { text: 'quoted text follow up', tokens: [cachedFileToken, cachedQuoteToken], files: [cachedFile] }
        : ''
    )
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    expect(mocks.surfaceProps?.text).toBe('quoted text follow up')
    expect(mocks.surfaceProps?.draftTokens).toEqual([
      expect.objectContaining({ id: 'file:source-1', kind: 'file' }),
      expect.objectContaining({ id: 'quote-1', kind: 'quote' })
    ])
    // Files seed the tool provider synchronously, so the surface's managed-token sync (driven by
    // the derived `tokens` prop) keeps the restored file token instead of stripping it.
    expect(mocks.files).toEqual([cachedFile])
    expect(mocks.surfaceProps?.tokens).toEqual([expect.objectContaining({ id: 'file:source-1', kind: 'file' })])

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: 'quoted text follow up',
        tokens: [cachedFileToken, cachedQuoteToken]
      })
    })

    // The FileEntry is created at send time: the sent file part carries both file identities,
    // a file:// URL, and a real MIME instead of the raw path / literal extension.
    expect(window.api.file.createInternalEntry).toHaveBeenCalledWith({ source: 'path', path: '/tmp/doc.pdf' })
    const sentOptions = onSend.mock.calls[0]?.[1]
    expect(sentOptions?.userMessageParts).toEqual([
      expect.objectContaining({ type: 'text', text: 'quoted text follow up' }),
      {
        type: 'file',
        url: 'file:///p/fe-1.pdf',
        mediaType: 'application/pdf',
        filename: 'doc.pdf',
        providerMetadata: { cherry: { fileEntryId: 'fe-1', fileTokenSourceId: 'source-1' } }
      }
    ])
  })

  it('does not restore knowledge tokens from the draft cache', () => {
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key === 'inputbar-draft'
        ? {
            text: 'hello',
            tokens: [{ id: 'knowledge:base-1', kind: 'knowledge', label: 'Base 1', index: 0, textOffset: 0 }],
            files: []
          }
        : ''
    )

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(mocks.surfaceProps?.text).toBe('hello')
    expect(mocks.surfaceProps?.draftTokens).toBeUndefined()
    expect(mocks.selectedKnowledgeBases).toEqual([])
  })

  it('persists the live draft minus knowledge tokens with the current files', async () => {
    const cachedFile = {
      name: 'doc.pdf',
      origin_name: 'doc.pdf',
      path: '/tmp/doc.pdf',
      fileTokenSourceId: 'source-1'
    } as any
    const cachedFileToken = {
      id: 'file:source-1',
      kind: 'file',
      label: 'doc.pdf',
      index: 0,
      textOffset: 0
    } as ComposerSerializedToken
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key === 'inputbar-draft' ? { text: '', tokens: [cachedFileToken], files: [cachedFile] } : ''
    )

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)
    expect(mocks.files).toEqual([cachedFile])

    // Deleting the file token in the editor prunes the attached file through reconcile.
    mocks.reconcileTokens.mockImplementation((draftTokens: readonly ComposerSerializedToken[]) => {
      const fileTokenIds = new Set(draftTokens.filter((token) => token.kind === 'file').map((token) => token.id))
      mocks.setFiles((previousFiles: any[]) =>
        previousFiles.filter((file) => fileTokenIds.has(`file:${file.fileTokenSourceId}`))
      )
    })
    act(() => {
      mocks.surfaceProps?.onTokensChange([])
    })
    expect(mocks.files).toEqual([])

    const quoteToken = {
      id: 'quote-1',
      kind: 'quote',
      label: 'Quote',
      promptText: 'quoted text',
      index: 0,
      textOffset: 0
    } as ComposerSerializedToken
    const knowledgeToken = {
      id: 'knowledge:base-1',
      kind: 'knowledge',
      label: 'Base 1',
      index: 1,
      textOffset: 11
    } as ComposerSerializedToken
    mocks.getDraft.mockReturnValue({ text: 'quoted text', tokens: [quoteToken, knowledgeToken] })
    act(() => {
      mocks.surfaceProps?.onTextChange('quoted text')
    })

    await waitFor(() => {
      expect(cacheService.setCasual).toHaveBeenCalledWith(
        'inputbar-draft',
        { text: 'quoted text', tokens: [quoteToken], files: [] },
        expect.any(Number)
      )
    })
  })

  it('clears the cached draft after a successful send', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    act(() => {
      mocks.surfaceProps?.onTextChange('hello')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('hello'))

    mocks.getDraft.mockReturnValue({ text: '', tokens: [] })
    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })
    })

    expect(onSend).toHaveBeenCalled()
    expect(vi.mocked(cacheService.setCasual).mock.lastCall).toEqual([
      'inputbar-draft',
      { text: '', tokens: [], files: [] },
      expect.any(Number)
    ])
  })

  it('does not write the draft cache while editing and restores it on cancel', async () => {
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const parts = [{ type: 'text', text: 'old prompt' }] as any[]

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={parts} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    vi.mocked(cacheService.setCasual).mockClear()

    act(() => {
      mocks.surfaceProps?.onTextChange('edited text')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('edited text'))
    expect(cacheService.setCasual).not.toHaveBeenCalledWith('inputbar-draft', expect.anything(), expect.anything())

    act(() => {
      mocks.surfaceProps?.editingState?.onCancel()
    })

    await waitFor(() => expect(mocks.surfaceProps?.editingState).toBeUndefined())
    expect(vi.mocked(cacheService.setCasual).mock.lastCall).toEqual([
      'inputbar-draft',
      { text: 'original draft', tokens: [], files: [] },
      expect.any(Number)
    ])
  })

  it('routes new topic shortcuts through the explicit parent action', () => {
    const onNewTopic = vi.fn()
    render(<ChatComposer topic={topic} onSend={vi.fn()} onNewTopic={onNewTopic} />)

    mocks.commandHandlers.get('topic.create')?.()

    expect(onNewTopic).toHaveBeenCalledWith(undefined)
    expect(mocks.createTopic).not.toHaveBeenCalled()
  })

  it('routes classic-layout new topic shortcuts through the empty topic action', () => {
    mocks.topicLayout = 'classic'
    const onNewTopic = vi.fn()
    const onCreateEmptyTopic = vi.fn()

    render(
      <ChatComposer topic={topic} onSend={vi.fn()} onNewTopic={onNewTopic} onCreateEmptyTopic={onCreateEmptyTopic} />
    )

    mocks.commandHandlers.get('topic.create')?.()

    expect(onCreateEmptyTopic).toHaveBeenCalledWith({ assistantId: 'assistant-1' })
    expect(onNewTopic).not.toHaveBeenCalled()
  })

  it('renders selectors below the surface in draft home mode', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent('tool menu')
    expect(screen.getByTestId('composer-send-accessory')).not.toHaveTextContent('tool menu')
    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A')
  })

  it('shows only icons in the draft home bottom toolbar when it is narrow', async () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByText('Assistant 1')).not.toHaveClass('sr-only')
    expect(screen.getByText('Model A')).not.toHaveClass('sr-only')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Assistant 1')).toHaveClass('sr-only')
      expect(screen.getByText('Model A')).toHaveClass('sr-only')
      expect(screen.getByTestId('selected-models-trigger')).toHaveClass('w-8')
    })
  })

  it('routes draft home assistant changes to the draft handler', async () => {
    const onDraftAssistantChange = vi.fn()
    const view = render(
      <ChatHomeComposer topic={topic} onSend={vi.fn()} onDraftAssistantChange={onDraftAssistantChange} />
    )

    expect(screen.getByTestId('assistant-selector')).toHaveAttribute('data-auto-select-on-create', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A')
    expect(mocks.setMentionedModels).not.toHaveBeenCalledWith([model])
    mocks.setMentionedModels.mockClear()

    fireEvent.click(screen.getByText('select assistant 2'))

    mocks.assistant = { ...mocks.assistant, id: 'assistant-2' }
    mocks.model = modelB
    mocks.mentionedModels = []
    view.rerender(
      <ChatHomeComposer
        topic={{ ...topic, assistantId: 'assistant-2' }}
        onSend={vi.fn()}
        onDraftAssistantChange={onDraftAssistantChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B')
    })
    expect(mocks.setMentionedModels).not.toHaveBeenCalledWith([modelB])
    expect(onDraftAssistantChange).toHaveBeenCalledWith('assistant-2')
    expect(mocks.updateTopic).not.toHaveBeenCalled()
  })

  it('uses the draft home model selector as single-select until multi-select is enabled', async () => {
    const view = render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    const selector = screen.getByTestId('model-selector')
    expect(selector).toHaveAttribute('data-multiple', 'true')
    expect(selector).toHaveAttribute('data-default-multi-select', 'false')
    expect(selector).toHaveAttribute('data-multi-select-mode', 'false')
    expect(selector).toHaveAttribute('data-value-count', '1')

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setMentionedModels).toHaveBeenCalledWith([modelB])
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B')
    expect(mocks.setModel).toHaveBeenCalledWith(modelB, { enableWebSearch: false })

    mocks.model = undefined
    mocks.modelPending = true
    view.rerender(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B')
    })
  })

  it('does not hydrate draft home model selection from mentioned-model cache', () => {
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key.startsWith('inputbar-mentioned-models-') ? [model, modelB] : ''
    )

    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A')
  })

  it('does not hydrate the docked model selector from mentioned-model cache', () => {
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key.startsWith('inputbar-mentioned-models-') ? [model, modelB] : ''
    )

    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByText('Model A')).toBeInTheDocument()
  })

  it('does not read or write mentioned-model rich-text cache', () => {
    const { unmount } = render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    unmount()

    expect(cacheService.getCasual).not.toHaveBeenCalledWith(expect.stringMatching(/^inputbar-mentioned-models-/))
    expect(cacheService.setCasual).not.toHaveBeenCalledWith(
      expect.stringMatching(/^inputbar-mentioned-models-/),
      expect.anything(),
      expect.anything()
    )
  })

  it('sends selected model ids from the model selector without editor model tokens', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(<ChatHomeComposer topic={topic} onSend={onSend} />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')
    expect(mocks.setMentionedModels).toHaveBeenCalledWith([model, modelB])
    expect(mocks.surfaceProps?.tokens.map((token) => token.kind)).not.toContain('model')

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        mentionedModels: [model.id, modelB.id],
        userMessageParts: [{ type: 'text', text: 'hello' }]
      })
    )
  })

  it('shows locked mentioned models while editing a multi-model user message', async () => {
    mocks.mentionedModels = []
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const parts = [{ type: 'text', text: 'old prompt' }] as any[]

    render(
      <MessageEditingProvider>
        <StartEditingWithLockedModelsOnMount
          message={message as any}
          parts={parts}
          lockedMentionedModels={[model, modelB]}
        />
        <ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    const trigger = screen.getByTestId('selected-models-trigger')

    expect(trigger).toHaveAttribute('data-model-count', '2')
    expect(trigger).toHaveAttribute('data-disabled', 'true')
    expect(trigger).toHaveAttribute('data-suppress-selection-popover', 'true')
    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('trigger clear models'))
    fireEvent.click(screen.getByText('trigger restore model'))

    expect(mocks.setMentionedModels).not.toHaveBeenCalled()
  })

  it('does not lock the model selector while editing without a multi-model cohort', async () => {
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const parts = [{ type: 'text', text: 'old prompt' }] as any[]

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={parts} />
        <ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-disabled', 'false')
  })

  it('hydrates Composer from an edited message and restores the previous draft on cancel', async () => {
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const parts = [
      {
        type: 'text',
        text: '<blockquote>\n\nSelected text\n</blockquote>\n\nFollow up',
        providerMetadata: {
          cherry: {
            composer: {
              version: 1,
              tokens: [
                {
                  id: 'quote-1',
                  kind: 'quote',
                  label: 'Quote',
                  description: 'Selected text',
                  index: 0,
                  textOffset: 0,
                  promptText: '<blockquote>\n\nSelected text\n</blockquote>'
                }
              ]
            }
          }
        }
      },
      {
        type: 'file',
        url: 'file:///tmp/default-topic.png',
        mediaType: '.png',
        filename: 'default-topic.png'
      },
      {
        type: 'file',
        url: 'file:///tmp/report.pdf',
        mediaType: '.pdf',
        filename: 'report.pdf'
      }
    ] as any[]

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={parts as any} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    expect(mocks.surfaceProps?.text).toBe('<blockquote>\n\nSelected text\n</blockquote>\n\nFollow up')
    expect(mocks.surfaceProps?.draftTokens).toEqual([
      expect.objectContaining({
        id: 'quote-1',
        kind: 'quote',
        label: 'Quote',
        textOffset: 0
      })
    ])
    expect(mocks.surfaceProps?.tokens).toEqual([
      expect.objectContaining({
        kind: 'file',
        label: 'default-topic.png',
        payload: expect.objectContaining({
          type: 'image',
          ext: '.png',
          name: 'default-topic.png',
          origin_name: 'default-topic.png'
        })
      }),
      expect.objectContaining({
        kind: 'file',
        label: 'report.pdf',
        payload: expect.objectContaining({
          type: 'document',
          ext: '.pdf',
          name: 'report.pdf',
          origin_name: 'report.pdf'
        })
      })
    ])
    expect(mocks.surfaceProps?.tokens).not.toEqual([
      expect.objectContaining({
        kind: 'file',
        label: 'default-topic.png',
        payload: expect.objectContaining({
          type: 'document'
        })
      }),
      expect.objectContaining({
        kind: 'file',
        label: 'report.pdf'
      })
    ])

    act(() => {
      mocks.surfaceProps?.editingState?.onCancel()
    })

    await waitFor(() => expect(mocks.surfaceProps?.editingState).toBeUndefined())
    expect(mocks.surfaceProps?.text).toBe('original draft')
  })

  it('restores the real live draft after editing from an active history preview', async () => {
    seedInputHistory(['history entry'])
    const liveQuote = {
      id: 'quote:live',
      kind: 'quote' as const,
      label: 'Live quote',
      promptText: 'live quoted context',
      index: 0,
      textOffset: 0
    }
    const liveDraft = { text: 'live draft', tokens: [liveQuote] }
    const liveFile = { fileTokenSourceId: 'live-file', name: 'live.pdf', path: '/tmp/live.pdf' } as any
    const liveKnowledgeBase = { id: 'kb-live', name: 'Live KB', documentCount: 1 } as KnowledgeBase
    mocks.files = [liveFile]
    mocks.mentionedModels = [model, modelB]
    mocks.selectedKnowledgeBases = [liveKnowledgeBase]
    mocks.knowledgeBases = [liveKnowledgeBase]
    mocks.getDraft.mockReturnValue(liveDraft)
    const message = {
      id: 'message-history-edit',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    }

    render(
      <MessageEditingProvider>
        <StartEditingButton message={message} parts={[{ type: 'text', text: 'edited message' }]} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('history entry'))
    fireEvent.click(screen.getByRole('button', { name: 'start editing' }))
    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe(message.id))
    expect(mocks.replaceDraft).toHaveBeenLastCalledWith({ text: 'edited message', tokens: [] })

    act(() => {
      mocks.surfaceProps?.editingState?.onCancel()
    })
    await waitFor(() => expect(mocks.surfaceProps?.editingState).toBeUndefined())
    expect(mocks.replaceDraft).toHaveBeenLastCalledWith(liveDraft)
    expect(mocks.files).toEqual([liveFile])
    expect(mocks.mentionedModels).toEqual([model, modelB])
    expect(mocks.selectedKnowledgeBases).toEqual([liveKnowledgeBase])

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(false)
    })
    expect(mocks.replaceDraft).toHaveBeenLastCalledWith(liveDraft)

    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('up')).toBe(true)
    })
    act(() => {
      expect(mocks.surfaceProps?.onInputHistoryNavigate?.('down')).toBe(true)
    })
    expect(mocks.replaceDraft).toHaveBeenLastCalledWith(liveDraft)
  })

  it('restores the edited message draft only once per editing session', async () => {
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const parts = [{ type: 'text', text: 'old' }] as any

    render(
      <MessageEditingProvider>
        <StartEditingButton message={message as any} parts={parts} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps).toBeDefined())
    mocks.setFiles.mockClear()
    mocks.setSelectedKnowledgeBases.mockClear()
    mocks.getDraft.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'start editing' }))

    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('old'))

    expect(mocks.setFiles).toHaveBeenCalledTimes(1)
    expect(mocks.setSelectedKnowledgeBases).toHaveBeenCalledTimes(1)
    expect(mocks.getDraft).toHaveBeenCalledTimes(1)
  })

  it('locates the edited message from the Composer editing state', async () => {
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={[{ type: 'text', text: 'old' }] as any} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))

    act(() => {
      mocks.surfaceProps?.editingState?.onLocate?.()
    })

    expect(mocks.eventEmit).toHaveBeenCalledWith('LOCATE_MESSAGE:message-1', true)
  })

  it('passes a new composer highlight key for each edit trigger', async () => {
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const parts = [{ type: 'text', text: 'old' }] as any

    render(
      <MessageEditingProvider>
        <StartEditingButton message={message as any} parts={parts} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'start editing' }))
    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    const firstHighlightKey = mocks.surfaceProps?.editingState?.highlightKey
    expect(firstHighlightKey).toEqual(expect.any(Number))
    if (typeof firstHighlightKey !== 'number') throw new Error('Expected first highlight key')

    fireEvent.click(screen.getByRole('button', { name: 'start editing' }))
    await waitFor(() => expect(mocks.surfaceProps?.editingState?.highlightKey).toBeGreaterThan(firstHighlightKey))
  })

  it('exits edit mode and restores the saved draft when the topic changes', async () => {
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage: vi.fn(), resend: vi.fn(), forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const nextTopic = { ...topic, id: 'topic-2' }
    const onSend = vi.fn().mockResolvedValue(undefined)
    const view = render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={[{ type: 'text', text: 'old' }] as any} />
        <ChatComposer topic={topic} onSend={onSend} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    expect(mocks.surfaceProps?.text).toBe('old')

    view.rerender(
      <MessageEditingProvider>
        <StartEditingOnMount enabled={false} message={message as any} parts={[{ type: 'text', text: 'old' }] as any} />
        <ChatComposer topic={nextTopic} onSend={onSend} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState).toBeUndefined())
    expect(mocks.surfaceProps?.text).toBe('original draft')

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'topic 2 draft', tokens: [] })
    })

    expect(forkAndResend).not.toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledWith(
      'topic 2 draft',
      expect.objectContaining({
        userMessageParts: [{ type: 'text', text: 'topic 2 draft' }]
      })
    )
  })

  it('preserves Cherry file metadata when resending an edited message with an existing attachment', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const filePart = {
      type: 'file',
      url: 'file:///tmp/report.pdf',
      mediaType: 'application/pdf',
      filename: 'report.pdf',
      providerMetadata: {
        cherry: {
          fileEntryId: 'file-entry-1'
        }
      }
    }

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={[{ type: 'text', text: 'old text' }, filePart] as any} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    const fileToken = mocks.surfaceProps?.tokens.find((token) => token.kind === 'file')
    expect(fileToken).toBeDefined()
    expect(fileToken?.id).toMatch(/^file:.+/)
    expect(fileToken?.id).not.toBe('file:file-entry-1')
    expect((fileToken?.payload as any)?.fileTokenSourceId).not.toBe('file-entry-1')

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: 'new text',
        tokens: [serializeComposerToken(fileToken!)]
      })
    })

    const editedParts = forkAndResend.mock.calls[0]?.[1] as Array<Record<string, unknown>>
    expect(editedParts.find((part) => part.type === 'file')).toEqual({
      ...filePart,
      providerMetadata: {
        cherry: {
          fileEntryId: 'file-entry-1',
          fileTokenSourceId: fileToken?.id.slice('file:'.length)
        }
      }
    })
    expect(forkAndResend).toHaveBeenCalledWith('message-1', expect.any(Array))
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
  })

  it('keeps edited message file tokens at their persisted text offsets', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const filePart = {
      type: 'file',
      url: 'file:///tmp/test.pdf',
      mediaType: 'application/pdf',
      filename: 'test.pdf',
      providerMetadata: {
        cherry: {
          fileEntryId: 'file-entry-1'
        }
      }
    }
    const fileToken: ComposerSerializedToken = {
      id: 'file:file-entry-1',
      kind: 'file',
      label: 'test.pdf',
      index: 0,
      textOffset: 0,
      promptText: 'test.pdf',
      payload: {
        type: 'document',
        ext: '.pdf',
        name: 'test.pdf',
        origin_name: 'test.pdf'
      }
    }

    render(
      <MessageEditingProvider>
        <StartEditingOnMount
          message={message as any}
          parts={
            [
              {
                type: 'text',
                text: 'test.pdf 你好',
                providerMetadata: {
                  cherry: {
                    composer: {
                      version: 1,
                      tokens: [fileToken]
                    }
                  }
                }
              },
              filePart
            ] as any
          }
        />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    const rewrittenToken = mocks.surfaceProps?.draftTokens?.[0]
    expect(rewrittenToken).toEqual(
      expect.objectContaining({
        kind: 'file',
        label: 'test.pdf',
        textOffset: 0
      })
    )
    expect(rewrittenToken?.id).toMatch(/^file:.+/)
    expect(rewrittenToken?.id).not.toBe(fileToken.id)
    expect(mocks.surfaceProps?.tokens).toEqual([expect.objectContaining({ id: rewrittenToken?.id, kind: 'file' })])

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: 'test.pdf 你好',
        tokens: [rewrittenToken!]
      })
    })

    const editedParts = forkAndResend.mock.calls[0]?.[1] as Array<Record<string, any>>
    expect(editedParts[0]).toMatchObject({
      type: 'text',
      text: 'test.pdf 你好',
      providerMetadata: {
        cherry: {
          composer: {
            tokens: [expect.objectContaining({ id: rewrittenToken?.id, kind: 'file', textOffset: 0 })]
          }
        }
      }
    })
    expect(editedParts.find((part) => part.type === 'file')).toEqual({
      ...filePart,
      providerMetadata: {
        cherry: {
          fileEntryId: 'file-entry-1',
          fileTokenSourceId: rewrittenToken?.id.slice('file:'.length)
        }
      }
    })
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
  })

  it('re-links multiple edited file tokens to their original parts by source id regardless of order', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const pdfPart = {
      type: 'file',
      url: 'file:///tmp/a.pdf',
      mediaType: 'application/pdf',
      filename: 'a.pdf',
      providerMetadata: { cherry: { fileEntryId: 'entry-pdf' } }
    }
    const pngPart = {
      type: 'file',
      url: 'file:///tmp/b.png',
      mediaType: '.png',
      filename: 'b.png',
      providerMetadata: { cherry: { fileEntryId: 'entry-png' } }
    }
    const pdfToken: ComposerSerializedToken = {
      id: 'file:entry-pdf',
      kind: 'file',
      label: 'a.pdf',
      index: 1,
      textOffset: 0,
      promptText: 'a.pdf',
      payload: { type: 'document', ext: '.pdf', name: 'a.pdf', origin_name: 'a.pdf' }
    }
    const pngToken: ComposerSerializedToken = {
      id: 'file:entry-png',
      kind: 'file',
      label: 'b.png',
      index: 0,
      textOffset: 6,
      promptText: 'b.png',
      payload: { type: 'image', ext: '.png', name: 'b.png', origin_name: 'b.png' }
    }

    render(
      <MessageEditingProvider>
        <StartEditingOnMount
          message={message as any}
          parts={
            [
              {
                type: 'text',
                text: 'a.pdf b.png',
                // Stored token order is intentionally reversed relative to text offset to prove
                // matching is by source id, not document position.
                providerMetadata: { cherry: { composer: { version: 1, tokens: [pngToken, pdfToken] } } }
              },
              pngPart,
              pdfPart
            ] as any
          }
        />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    const rewrittenPdfToken = mocks.surfaceProps?.draftTokens?.find((token) => token.label === 'a.pdf')
    const rewrittenPngToken = mocks.surfaceProps?.draftTokens?.find((token) => token.label === 'b.png')
    expect(rewrittenPdfToken?.id).toMatch(/^file:.+/)
    expect(rewrittenPngToken?.id).toMatch(/^file:.+/)
    expect(rewrittenPdfToken?.id).not.toBe(pdfToken.id)
    expect(rewrittenPngToken?.id).not.toBe(pngToken.id)

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'a.pdf b.png', tokens: [rewrittenPdfToken!, rewrittenPngToken!] })
    })

    const editedParts = forkAndResend.mock.calls[0]?.[1] as Array<Record<string, any>>
    const fileParts = editedParts.filter((part) => part.type === 'file')
    // Both originals are reused by file fields, each linked through legacy hints while the
    // editable draft and resent parts use fresh file token sources.
    expect(fileParts).toEqual([
      {
        ...pngPart,
        providerMetadata: {
          cherry: {
            fileEntryId: 'entry-png',
            fileTokenSourceId: rewrittenPngToken?.id.slice('file:'.length)
          }
        }
      },
      {
        ...pdfPart,
        providerMetadata: {
          cherry: {
            fileEntryId: 'entry-pdf',
            fileTokenSourceId: rewrittenPdfToken?.id.slice('file:'.length)
          }
        }
      }
    ])
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
  })

  it('falls back to the sole remaining file token when no source id matches', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    // Neither the part's fileEntryId nor its url equals the token source id, so only the
    // single-unused-token fallback can keep the attachment linked.
    const filePart = {
      type: 'file',
      url: 'file:///tmp/x.pdf',
      mediaType: 'application/pdf',
      filename: 'x.pdf',
      providerMetadata: { cherry: { fileEntryId: 'real-1' } }
    }
    const ghostToken: ComposerSerializedToken = {
      id: 'file:ghost',
      kind: 'file',
      label: 'x.pdf',
      index: 0,
      textOffset: 0,
      promptText: 'x.pdf',
      payload: { type: 'document', ext: '.pdf', name: 'x.pdf', origin_name: 'x.pdf' }
    }

    render(
      <MessageEditingProvider>
        <StartEditingOnMount
          message={message as any}
          parts={
            [
              {
                type: 'text',
                text: 'x.pdf 你好',
                providerMetadata: { cherry: { composer: { version: 1, tokens: [ghostToken] } } }
              },
              filePart
            ] as any
          }
        />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    const rewrittenToken = mocks.surfaceProps?.draftTokens?.[0]
    expect(rewrittenToken?.id).toMatch(/^file:.+/)
    expect(rewrittenToken?.id).not.toBe(ghostToken.id)

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: 'x.pdf 你好', tokens: [rewrittenToken!] })
    })

    const editedParts = forkAndResend.mock.calls[0]?.[1] as Array<Record<string, any>>
    // The attachment is preserved, not dropped, via the unambiguous fallback while the
    // resent part records the canonical file token source.
    expect(editedParts.find((part) => part.type === 'file')).toEqual({
      ...filePart,
      providerMetadata: {
        cherry: {
          fileEntryId: 'real-1',
          fileTokenSourceId: rewrittenToken?.id.slice('file:'.length)
        }
      }
    })
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
  })

  it('keeps editable knowledge tokens when forking and resending an edited message', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    const knowledgeBase = {
      id: 'kb-1',
      name: 'Knowledge One',
      documentCount: 1
    } as KnowledgeBase
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    mocks.assistant = {
      ...mocks.assistant,
      knowledgeBaseIds: ['kb-1']
    }
    mocks.knowledgeBases = [knowledgeBase]
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const

    render(
      <MessageEditingProvider>
        <StartEditingOnMount
          message={message as any}
          parts={
            [
              {
                type: 'text',
                text: 'question with knowledge',
                providerMetadata: {
                  cherry: {
                    composer: {
                      version: 1,
                      tokens: [
                        {
                          id: 'knowledge:kb-1',
                          kind: 'knowledge',
                          label: 'Knowledge One',
                          index: 0,
                          textOffset: 0
                        }
                      ]
                    }
                  }
                }
              }
            ] as any
          }
        />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    await waitFor(() =>
      expect(mocks.surfaceProps?.tokens).toEqual([
        expect.objectContaining({
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Knowledge One'
        })
      ])
    )

    const [knowledgeToken] = mocks.surfaceProps?.tokens ?? []
    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: 'edited question with knowledge',
        tokens: [serializeComposerToken(knowledgeToken)]
      })
    })

    const editedParts = forkAndResend.mock.calls[0]?.[1] as Array<Record<string, any>>
    expect(forkAndResend).toHaveBeenCalledWith('message-1', expect.any(Array))
    expect(editedParts[0]).toMatchObject({
      type: 'text',
      text: 'edited question with knowledge',
      providerMetadata: {
        cherry: {
          composer: {
            tokens: [
              expect.objectContaining({
                id: 'knowledge:kb-1',
                kind: 'knowledge',
                label: 'Knowledge One'
              })
            ]
          }
        }
      }
    })
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
  })

  it('forks and resends the edited message when Composer sends in edit mode', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={[{ type: 'text', text: 'old' }] as any} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    await mocks.surfaceProps?.onSendDraft({ text: 'new text', tokens: [] })

    expect(forkAndResend).toHaveBeenCalledWith('message-1', [{ type: 'text', text: 'new text' }])
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.surfaceProps?.editingState).toBeUndefined())
  })

  it('saves an edited assistant reply without forking and removes derived translation parts', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'assistant-message-1',
      role: 'assistant',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const originalParts = [
      { type: 'reasoning', text: 'reasoning' },
      { type: 'text', text: 'old reply' },
      { type: 'data-translation', data: { content: 'translated reply' } }
    ] as any

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={originalParts} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe(message.id))
    await mocks.surfaceProps?.onSendDraft({ text: 'new reply', tokens: [] })

    expect(editMessage).toHaveBeenCalledWith(message.id, [originalParts[0], { type: 'text', text: 'new reply' }])
    expect(forkAndResend).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.surfaceProps?.editingState).toBeUndefined())
  })

  it('does not save an assistant reply whose editable parts are separated by a tool call', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend: vi.fn(), forkAndResend }
    const message = {
      id: 'assistant-message-1',
      role: 'assistant',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const originalParts = [
      { type: 'text', text: 'before tool' },
      { type: 'dynamic-tool', toolCallId: 'tool-1', toolName: 'read', state: 'output-available' },
      { type: 'text', text: 'after tool' }
    ] as any

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={originalParts} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe(message.id))
    await mocks.surfaceProps?.onSendDraft({ text: 'edited reply', tokens: [] })

    expect(editMessage).not.toHaveBeenCalled()
    expect(forkAndResend).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.editingState?.messageId).toBe(message.id)
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('does not save an assistant reply whose text has provider metadata Composer cannot round-trip', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend: vi.fn(), forkAndResend }
    const message = {
      id: 'assistant-message-1',
      role: 'assistant',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const originalParts = [
      {
        type: 'text',
        text: 'signed reply',
        providerMetadata: { google: { thoughtSignature: 'signature-1' } }
      }
    ] as any

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={originalParts} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe(message.id))
    await mocks.surfaceProps?.onSendDraft({ text: 'edited reply', tokens: [] })

    expect(editMessage).not.toHaveBeenCalled()
    expect(forkAndResend).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.editingState?.messageId).toBe(message.id)
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('does not fork and resend an edited file-only draft before the file token is reflected in the editor', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={[{ type: 'text', text: 'old' }] as any} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))

    act(() => {
      mocks.files = [{ fileTokenSourceId: 'src-1', name: 'doc.pdf', path: '/tmp/doc.pdf' } as any]
      mocks.surfaceProps?.onTextChange('')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe(''))

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({ text: '', tokens: [] })
    })

    expect(forkAndResend).not.toHaveBeenCalled()
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1')
    expect(toast.error).not.toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('does not fork and resend an edited draft while only some attached file tokens are reflected in the editor', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const
    const syncedFile = { fileTokenSourceId: 'src-1', name: 'first.pdf', path: '/tmp/first.pdf' } as any
    const unsyncedFile = { fileTokenSourceId: 'src-2', name: 'second.pdf', path: '/tmp/second.pdf' } as any

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={[{ type: 'text', text: 'old' }] as any} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))

    act(() => {
      mocks.files = [syncedFile, unsyncedFile]
      mocks.surfaceProps?.onTextChange('')
    })
    await waitFor(() => expect(mocks.surfaceProps?.text).toBe(''))

    await act(async () => {
      await mocks.surfaceProps?.onSendDraft({
        text: '',
        tokens: [
          {
            id: 'file:src-1',
            kind: 'file',
            label: 'first.pdf',
            payload: syncedFile,
            index: 0,
            textOffset: 0
          } as ComposerSerializedToken
        ]
      })
    })

    expect(forkAndResend).not.toHaveBeenCalled()
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1')
    expect(toast.error).not.toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('keeps editing when the edited message fork and resend fails', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockRejectedValue(new Error('stream open failed'))
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }
    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={[{ type: 'text', text: 'old' }] as any} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))
    await expect(mocks.surfaceProps?.onSendDraft({ text: 'new text', tokens: [] })).resolves.toBeUndefined()

    expect(forkAndResend).toHaveBeenCalledWith('message-1', [{ type: 'text', text: 'new text' }])
    expect(editMessage).not.toHaveBeenCalled()
    expect(resend).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1')
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('keeps editing and errors out when buildEditedMessageParts fails (e.g. attachment builder rejects)', async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined)
    const resend = vi.fn().mockResolvedValue(undefined)
    const forkAndResend = vi.fn().mockResolvedValue(undefined)
    mocks.chatWrite = { pause: vi.fn(), editMessage, resend, forkAndResend }

    vi.mocked(window.api.file.createInternalEntry).mockRejectedValue(new Error('filesystem error'))

    const message = {
      id: 'message-1',
      role: 'user',
      topicId: topic.id,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success'
    } as const

    const newFile = {
      id: 'file-1',
      name: 'doc.pdf',
      path: '/tmp/doc.pdf',
      size: 100,
      mime: 'application/pdf',
      composerFileKind: 'file',
      fileTokenSourceId: 'source-1'
    }

    render(
      <MessageEditingProvider>
        <StartEditingOnMount message={message as any} parts={[{ type: 'text', text: 'old' }] as any} />
        <ChatComposer topic={topic} onSend={vi.fn()} />
      </MessageEditingProvider>
    )

    await waitFor(() => expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1'))

    act(() => {
      mocks.files = [newFile as any]
      mocks.surfaceProps?.onTextChange('new text')
    })

    await waitFor(() => expect(mocks.surfaceProps?.text).toBe('new text'))

    const fileToken = {
      id: 'file:source-1',
      kind: 'file' as const,
      label: 'doc.pdf',
      payload: newFile,
      index: 0,
      textOffset: 0
    }

    await expect(
      mocks.surfaceProps?.onSendDraft({
        text: 'new text',
        tokens: [fileToken]
      })
    ).resolves.toBeUndefined()

    expect(forkAndResend).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.editingState?.messageId).toBe('message-1')
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('does not auto-enable assistant knowledge bases and keeps manual deletion', async () => {
    const knowledgeBase = {
      id: 'kb-1',
      name: 'Knowledge One',
      documentCount: 1
    } as KnowledgeBase
    mocks.assistant = {
      ...mocks.assistant,
      knowledgeBaseIds: ['kb-1']
    }
    mocks.knowledgeBases = [knowledgeBase]
    const view = render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.selectedKnowledgeBases).toEqual([])
    expect(mocks.setSelectedKnowledgeBases).not.toHaveBeenCalledWith([knowledgeBase])
    expect(mocks.surfaceProps?.tokens).toEqual([])

    mocks.selectedKnowledgeBases = [knowledgeBase]
    view.rerender(<ChatComposer topic={topic} onSend={vi.fn()} />)
    expect(mocks.surfaceProps?.tokens).toEqual([
      expect.objectContaining({
        id: 'knowledge:kb-1',
        kind: 'knowledge'
      })
    ])

    act(() => {
      mocks.surfaceProps?.onTokensChange([])
    })

    expect(mocks.selectedKnowledgeBases).toEqual([])
    mocks.setSelectedKnowledgeBases.mockClear()
    mocks.knowledgeBases = [{ ...knowledgeBase }]

    view.rerender(<ChatComposer topic={topic} onSend={vi.fn()} />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.setSelectedKnowledgeBases).not.toHaveBeenCalled()
    expect(mocks.surfaceProps?.tokens).toEqual([])
  })

  it('clears selected knowledge bases after sending a draft', async () => {
    const knowledgeBase = {
      id: 'kb-1',
      name: 'Knowledge One',
      documentCount: 1
    } as KnowledgeBase
    mocks.assistant = {
      ...mocks.assistant,
      knowledgeBaseIds: ['kb-1']
    }
    mocks.knowledgeBases = [knowledgeBase]
    const onSend = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatComposer topic={topic} onSend={onSend} />)

    mocks.selectedKnowledgeBases = [knowledgeBase]
    view.rerender(<ChatComposer topic={topic} onSend={onSend} />)

    const [knowledgeToken] = mocks.surfaceProps?.tokens ?? []
    expect(knowledgeToken).toMatchObject({
      id: 'knowledge:kb-1',
      kind: 'knowledge'
    })

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [serializeComposerToken(knowledgeToken)] })

    expect(onSend).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        knowledgeBaseIds: ['kb-1'],
        userMessageParts: [expect.objectContaining({ type: 'text', text: 'hello' })]
      })
    )
    expect(mocks.selectedKnowledgeBases).toEqual([])
  })

  it('does not render stale knowledge tokens during same-topic assistant switches', () => {
    const knowledgeBase = {
      id: 'kb-1',
      name: 'Knowledge One',
      documentCount: 1
    } as KnowledgeBase
    mocks.assistant = {
      ...mocks.assistant,
      knowledgeBaseIds: ['kb-1']
    }
    mocks.knowledgeBases = [knowledgeBase]
    const onSend = vi.fn()
    const view = render(<ChatComposer topic={topic} onSend={onSend} />)

    mocks.selectedKnowledgeBases = [knowledgeBase]
    view.rerender(<ChatComposer topic={topic} onSend={onSend} />)
    expect(mocks.surfaceProps?.tokens).toEqual([
      expect.objectContaining({
        id: 'knowledge:kb-1',
        kind: 'knowledge'
      })
    ])

    mocks.assistant = {
      ...mocks.assistant,
      id: 'assistant-2',
      knowledgeBaseIds: []
    }
    view.rerender(<ChatComposer topic={{ ...topic, assistantId: 'assistant-2' }} onSend={onSend} />)

    expect(mocks.surfaceProps?.tokens).toEqual([])
  })

  it('drops selected knowledge bases that are no longer configured before sending', async () => {
    const knowledgeBase = {
      id: 'kb-1',
      name: 'Knowledge One',
      documentCount: 1
    } as KnowledgeBase
    mocks.assistant = {
      ...mocks.assistant,
      knowledgeBaseIds: ['kb-1']
    }
    mocks.knowledgeBases = [knowledgeBase]
    const onSend = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatComposer topic={topic} onSend={onSend} />)

    mocks.selectedKnowledgeBases = [knowledgeBase]
    view.rerender(<ChatComposer topic={topic} onSend={onSend} />)
    const [staleKnowledgeToken] = mocks.surfaceProps?.tokens ?? []
    expect(staleKnowledgeToken).toMatchObject({
      id: 'knowledge:kb-1',
      kind: 'knowledge'
    })

    mocks.assistant = {
      ...mocks.assistant,
      knowledgeBaseIds: ['kb-2']
    }
    view.rerender(<ChatComposer topic={topic} onSend={onSend} />)

    expect(mocks.surfaceProps?.tokens).toEqual([])

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [serializeComposerToken(staleKnowledgeToken)] })

    expect(onSend).toHaveBeenCalledWith('hello', expect.any(Object))
    expect(onSend.mock.calls[0]?.[1]?.knowledgeBaseIds).toBeUndefined()
  })

  it('restores pasted knowledge tokens into selected knowledge base state before sending', async () => {
    const knowledgeBase = {
      id: 'kb-1',
      name: 'Knowledge One',
      documentCount: 1
    } as KnowledgeBase
    mocks.assistant = {
      ...mocks.assistant,
      knowledgeBaseIds: ['kb-1']
    }
    mocks.knowledgeBases = [knowledgeBase]
    const onSend = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatComposer topic={topic} onSend={onSend} />)

    act(() => {
      mocks.surfaceProps?.onTokensChange([
        {
          id: 'knowledge:kb-1',
          kind: 'knowledge',
          label: 'Knowledge One',
          index: 0,
          textOffset: 0
        }
      ])
    })

    expect(mocks.selectedKnowledgeBases).toEqual([knowledgeBase])

    view.rerender(<ChatComposer topic={topic} onSend={onSend} />)
    const [knowledgeToken] = mocks.surfaceProps?.tokens ?? []
    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [serializeComposerToken(knowledgeToken)] })

    expect(onSend).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        knowledgeBaseIds: ['kb-1']
      })
    )
  })

  it('keeps the draft home model selector empty after manual clear', () => {
    const view = render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')

    fireEvent.click(screen.getByText('clear model selection'))

    expect(mocks.setMentionedModels).toHaveBeenCalledWith([])

    mocks.mentionedModels = []
    view.rerender(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '0')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('button.select_model')
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('code.model_required')
  })

  it('reinitializes the draft home selector when a new topic is created', async () => {
    const view = render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('clear model selection'))
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '0')

    view.rerender(<ChatHomeComposer topic={{ ...topic, id: 'topic-2' }} onSend={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A')
    })
  })

  it('renders multiple draft home model selections through the selected-model trigger', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')

    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-model-count', '2')
  })

  it('keeps draft multi-model selection when the composer placement docks', () => {
    const view = render(<ChatPlacementComposer placement="home" topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-model-count', '2')

    view.rerender(<ChatPlacementComposer placement="docked" topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-model-count', '2')
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
