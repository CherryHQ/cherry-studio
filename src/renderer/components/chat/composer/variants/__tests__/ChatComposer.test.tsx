import { cacheService } from '@data/CacheService'
import {
  MessageEditingProvider,
  useMessageEditing
} from '@renderer/components/chat/messages/editing/MessageEditingContext'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  toastError: vi.fn(),
  focusComposer: vi.fn(),
  insertToken: vi.fn(),
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
  topicPending: false,
  surfaceProps: undefined as ComposerSurfaceProps | undefined,
  derivedToolState: undefined as { couldAddImageFile: boolean; extensions: string[] } | undefined,
  ipcListeners: new Map<string, (_event: unknown, payload: unknown) => void>(),
  ipcOn: vi.fn(),
  chatWrite: undefined as any,
  files: undefined as any[] | undefined
}))

const originalResizeObserver = globalThis.ResizeObserver

const serializeComposerToken = (token: ComposerSurfaceProps['tokens'][number]) => ({
  ...token,
  index: 0,
  textOffset: 0
})

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  target?: Element
  observe: ReturnType<typeof vi.fn>
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

vi.mock('@renderer/components/chat/composer/ComposerSurface', () => {
  function MockComposerSurface(props: ComposerSurfaceProps) {
    useEffect(() => {
      props.onActionsChange?.({
        focus: mocks.focusComposer,
        onTextChange: (updater) => {
          const nextText = typeof updater === 'function' ? updater(props.text) : updater
          props.onTextChange(nextText)
        },
        toggleExpanded: vi.fn(),
        removeToken: vi.fn(),
        insertToken: mocks.insertToken,
        getDraft: mocks.getDraft
      })
    }, [props])

    mocks.surfaceProps = props
    return (
      <div>
        <div data-testid="composer-left-controls">{props.renderLeftControls?.(undefined)}</div>
        <div data-testid="composer-below-controls">{props.renderBelowControls?.(undefined)}</div>
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

vi.mock('@renderer/components/chat/composer/ComposerToolRuntime', () => ({
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
    getLaunchers: vi.fn(() => []),
    dispatchLauncher: vi.fn()
  }),
  useComposerToolLauncherActions: () => ({
    getLaunchers: vi.fn(() => []),
    dispatchLauncher: vi.fn()
  })
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
      <span className={iconOnly ? 'sr-only' : undefined}>
        {models.length === 0 ? fallbackLabel : `${models[0].name} | Provider`}
      </span>
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

vi.mock('@renderer/components/Selector', () => ({
  ModelSelector: ({
    onSelect,
    trigger,
    multiple,
    open,
    onOpenChange,
    value,
    defaultMultiSelectMode,
    multiSelectMode,
    onMultiSelectModeChange
  }: any) => (
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
}))

vi.mock('@renderer/components/resource', () => ({
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

vi.mock('@renderer/config/models', () => ({
  getThinkModelType: () => 'default',
  isEmbeddingModel: () => false,
  isFunctionCallingModel: (currentModel?: Model) =>
    currentModel?.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL) ?? false,
  isGenerateImageModel: () => false,
  isGenerateImageModels: () => false,
  isOpenRouterBuiltInWebSearchModel: () => false,
  isRerankModel: () => false,
  isSupportedReasoningEffortModel: () => false,
  isSupportedThinkingTokenModel: () => false,
  isVisionModel: () => false,
  isVisionModels: () => false,
  isWebSearchModel: () => false,
  MODEL_SUPPORTED_OPTIONS: { default: ['none'] },
  MODEL_SUPPORTED_REASONING_EFFORT: { default: ['none'] }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: (key: string) => (key === 'chat.multi_select_mode' ? [false] : [false, vi.fn()])
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
  useProviderDisplayName: (providerId?: string) => (providerId ? 'Provider' : undefined),
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
  isNonChatModel: () => false,
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
    mocks.toastError.mockReset()
    mocks.focusComposer.mockReset()
    mocks.insertToken.mockReset()
    mocks.getDraft.mockReset()
    mocks.getDraft.mockReturnValue({ text: 'original draft', tokens: [] })
    mocks.reconcileTokens.mockReset()
    mocks.reconcileTokens.mockImplementation((draftTokens: readonly ComposerSerializedToken[]) => {
      const knowledgeTokenIds = new Set(
        draftTokens.filter((token) => token.kind === 'knowledge').map((token) => token.id)
      )
      const configuredKnowledgeBaseIds = new Set(mocks.assistant?.knowledgeBaseIds ?? [])
      const selectableKnowledgeBases = mocks.knowledgeBases.filter((base) => configuredKnowledgeBaseIds.has(base.id))
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
    mocks.topicPending = false
    mocks.surfaceProps = undefined
    mocks.derivedToolState = undefined
    mocks.ipcListeners.clear()
    mocks.ipcOn.mockReset()
    mocks.chatWrite = undefined
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
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { error: mocks.toastError }
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

  it('renders the tool menu before assistant and model selectors', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByText('tool menu')).toBeInTheDocument()
    expect(screen.getByText('Assistant 1')).toBeInTheDocument()
    expect(screen.getByText('Model A | Provider')).toBeInTheDocument()
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
    expect(screen.getByText('Model A | Provider')).not.toHaveClass('sr-only')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Assistant 1')).toHaveClass('sr-only')
      expect(screen.getByText('Model A | Provider')).toHaveClass('sr-only')
    })
  })

  it('keeps input bottom toolbar labels visible when the toolbar fits', async () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    await notifyComposerBottomToolbarWidth(420, 420)

    expect(screen.getByText('Assistant 1')).not.toHaveClass('sr-only')
    expect(screen.getByText('Model A | Provider')).not.toHaveClass('sr-only')
  })

  it('passes attachment capabilities through the provider without effect mirroring', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(mocks.derivedToolState).toEqual({
      couldAddImageFile: false,
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
    expect(mocks.surfaceProps?.text).toBe('Existing draft')
  })

  it('updates the topic assistant from the composer toolbar', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select assistant 2'))

    expect(mocks.updateTopic).toHaveBeenCalledWith('topic-1', { assistantId: 'assistant-2' })
  })

  it('updates the assistant model from the composer toolbar', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setModel).toHaveBeenCalledWith(modelB, { enableWebSearch: false })
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
    expect(mocks.setMentionedModels).toHaveBeenCalledWith([])
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
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Default Assistant')
    expect(screen.getByTestId('assistant-selector')).toHaveAttribute('data-value', '')
    expect(mocks.surfaceProps?.sendBlockedReason).toBeUndefined()
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
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('blocks sends for missing-assistant topics until a new assistant is selected', async () => {
    mocks.assistant = undefined
    const onSend = vi.fn()

    render(<ChatComposer topic={missingAssistantTopic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })
    fireEvent.click(screen.getByText('select assistant 2'))

    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('button.select_assistant')
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
    expect(mocks.toastError).toHaveBeenCalledWith('code.model_required')
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

  it('stays sendable with attachments but no text (pure-attachment, matching the v1 Inputbar)', () => {
    mocks.files = [{ fileTokenSourceId: 'src-1', name: 'doc.pdf', path: '/tmp/doc.pdf' } as any]

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    // No text typed, but a file is attached → the composer must not disable send.
    expect(mocks.surfaceProps?.sendDisabled).toBe(false)
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
    expect(mocks.toastError).toHaveBeenCalledWith('chat.input.send_failed')
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

    // The FileEntry is created at send time: the sent file part carries fileEntryId + a file:// url
    // + a real MIME, not the raw path / literal extension.
    expect(window.api.file.createInternalEntry).toHaveBeenCalledWith({ source: 'path', path: '/tmp/doc.pdf' })
    const sentOptions = onSend.mock.calls[0]?.[1]
    expect(sentOptions?.userMessageParts).toEqual([
      expect.objectContaining({ type: 'text', text: 'quoted text follow up' }),
      {
        type: 'file',
        url: 'file:///p/fe-1.pdf',
        mediaType: 'application/pdf',
        filename: 'doc.pdf',
        providerMetadata: { cherry: { fileEntryId: 'fe-1' } }
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

  it('renders selectors below the surface in draft home mode', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent('tool menu')
    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
  })

  it('shows only icons in the draft home bottom toolbar when it is narrow', async () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByText('Assistant 1')).not.toHaveClass('sr-only')
    expect(screen.getByText('Model A | Provider')).not.toHaveClass('sr-only')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Assistant 1')).toHaveClass('sr-only')
      expect(screen.getByText('Model A | Provider')).toHaveClass('sr-only')
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
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
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
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B | Provider')
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

    expect(mocks.setMentionedModels).toHaveBeenCalledWith([])
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
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
  })

  it('does not hydrate the docked model selector from mentioned-model cache', () => {
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key.startsWith('inputbar-mentioned-models-') ? [model, modelB] : ''
    )

    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByText('Model A | Provider')).toBeInTheDocument()
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
    expect(mocks.toastError).toHaveBeenCalledWith('message.error.operation_unavailable')
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
      knowledgeBaseIds: []
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
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
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
    const view = render(<ChatPlacementComposer isHome topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-model-count', '2')

    view.rerender(<ChatPlacementComposer isHome={false} topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')
    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-model-count', '2')
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
