import { cacheService } from '@data/CacheService'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '../../ComposerSurface'
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
  insertToken: vi.fn(),
  commandHandlers: new Map<string, () => void>(),
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
  ipcOn: vi.fn()
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
        onTextChange: (updater) => {
          const nextText = typeof updater === 'function' ? updater(props.text) : updater
          props.onTextChange(nextText)
        },
        toggleExpanded: vi.fn(),
        removeToken: vi.fn(),
        insertToken: mocks.insertToken
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

vi.mock('@renderer/components/chat/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({
    children,
    initialState
  }: {
    children: ReactNode
    initialState?: { mentionedModels?: Model[]; selectedKnowledgeBases?: KnowledgeBase[] }
  }) => {
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
  useComposerToolState: () => ({
    files: [],
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
    suppressSelectionPopover,
    onModelsChange,
    onRestore
  }: any) => (
    <div
      data-testid="selected-models-trigger"
      className={className}
      data-assistant-model-id={assistantModel?.id ?? ''}
      data-model-count={String(models.length)}
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
  AssistantSelector: ({ onChange, trigger, value }: any) => (
    <div data-testid="assistant-selector" data-value={value ?? ''}>
      {trigger}
      <button type="button" onClick={() => onChange('assistant-2')}>
        select assistant 2
      </button>
    </div>
  ),
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

vi.mock('@renderer/hooks/ChatWriteContext', () => ({
  useChatWrite: () => ({ pause: vi.fn() })
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
  }),
  useDefaultAssistant: () => ({
    assistant: {
      id: 'default-assistant',
      name: 'Default Assistant',
      emoji: 'D'
    }
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

vi.mock('@renderer/commands', () => ({
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
  useTopicStreamStatus: () => ({ isPending: mocks.topicPending })
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
    mocks.insertToken.mockReset()
    mocks.commandHandlers.clear()
    mocks.mentionedModels = undefined
    mocks.selectedKnowledgeBases = undefined
    mocks.knowledgeBases = []
    mocks.assistant = {
      id: 'assistant-1',
      name: 'Assistant 1',
      emoji: 'A',
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
    mocks.model = undefined

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByText('button.select_model')).toBeInTheDocument()
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('code.model_required')
  })

  it('shows assistant selection instead of the default assistant for unlinked home topics', () => {
    mocks.assistant = undefined

    render(<ChatHomeComposer topic={unlinkedTopic} onSend={vi.fn()} />)

    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('button.select_assistant')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Default Assistant')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Model A | Provider')
    expect(screen.getByTestId('assistant-selector')).toHaveAttribute('data-value', '')
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('button.select_assistant')
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
    mocks.model = undefined
    const onSend = vi.fn()

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('code.model_required')
  })

  it('does not send while the topic is streaming', async () => {
    mocks.topicPending = true
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('routes new topic shortcuts through the explicit parent action', () => {
    const onNewTopic = vi.fn()
    render(<ChatComposer topic={topic} onSend={vi.fn()} onNewTopic={onNewTopic} />)

    mocks.commandHandlers.get('topic.create')?.()

    expect(onNewTopic).toHaveBeenCalledWith(undefined)
    expect(mocks.createTopic).not.toHaveBeenCalled()
  })

  it('renders selectors below the surface in temporary home mode', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent('tool menu')
    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
  })

  it('shows only icons in the temporary home bottom toolbar when it is narrow', async () => {
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

  it('routes temporary home assistant changes to the temporary handler', async () => {
    const onTemporaryAssistantChange = vi.fn()
    const view = render(
      <ChatHomeComposer topic={topic} onSend={vi.fn()} onTemporaryAssistantChange={onTemporaryAssistantChange} />
    )

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
        onTemporaryAssistantChange={onTemporaryAssistantChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B | Provider')
    })
    expect(mocks.setMentionedModels).not.toHaveBeenCalledWith([modelB])
    expect(onTemporaryAssistantChange).toHaveBeenCalledWith('assistant-2')
    expect(mocks.updateTopic).not.toHaveBeenCalled()
  })

  it('uses the temporary home model selector as single-select until multi-select is enabled', async () => {
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

  it('does not hydrate temporary home model selection from mentioned-model cache', () => {
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

  it('keeps the temporary home model selector empty after manual clear', () => {
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

  it('reinitializes the temporary home selector when a new topic is created', async () => {
    const view = render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('clear model selection'))
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '0')

    view.rerender(<ChatHomeComposer topic={{ ...topic, id: 'topic-2' }} onSend={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
    })
  })

  it('renders multiple temporary home model selections through the selected-model trigger', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')

    expect(screen.getByTestId('selected-models-trigger')).toHaveAttribute('data-model-count', '2')
  })

  it('keeps temporary multi-model selection when the composer placement docks', () => {
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
