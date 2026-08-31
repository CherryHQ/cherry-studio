import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { QUICK_PHRASES_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import {
  type QuickPanelCallBackOptions,
  type QuickPanelFooterAction,
  type QuickPanelListItem,
  type QuickPanelOpenOptions
} from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { PromptEditDialog } from '@renderer/components/resourceCatalog/dialogs/edit'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { useTimer } from '@renderer/hooks/useTimer'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ListPromptsQueryParams } from '@shared/data/api/schemas/prompts'
import type { Prompt, PromptBindingTarget, PromptVisibility } from '@shared/data/types/prompt'
import { Globe2, Plus, Settings2, Zap } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  launcher: ToolLauncherApi
  setInputValue: Dispatch<SetStateAction<string>>
  assistantId?: string
  agentId?: string
}

const logger = loggerService.withContext('QuickPhrasesButton')
const PROMPT_QUERY_SWR_OPTIONS = { keepPreviousData: false } as const

const useQuickPhrasesToolController = ({ agentId, assistantId, launcher, setInputValue }: Props) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [promptsEnabled, setPromptsEnabled] = useState(false)
  const restoreInputFocusRef = useRef<(() => void) | null>(null)
  const { t } = useTranslation()
  const {
    isVisible: isQuickPanelVisible,
    open: openQuickPanelContext,
    symbol: quickPanelSymbol,
    updateList: updateQuickPanelList
  } = useQuickPanel()
  const { setTimeoutTimer } = useTimer()
  const bindingTarget = useMemo<PromptBindingTarget | undefined>(
    () => (agentId ? { type: 'agent', id: agentId } : assistantId ? { type: 'assistant', id: assistantId } : undefined),
    [agentId, assistantId]
  )
  const promptQuery = useMemo<ListPromptsQueryParams | undefined>(() => {
    if (!bindingTarget) return { visibility: 'global' }
    return bindingTarget.type === 'assistant'
      ? { targetType: 'assistant', targetId: bindingTarget.id, includeGlobal: true }
      : { targetType: 'agent', targetId: bindingTarget.id, includeGlobal: true }
  }, [bindingTarget])

  const {
    data: promptsRaw,
    isLoading: isPromptsLoading,
    error: promptsError,
    refetch: refetchPrompts
  } = useQuery('/prompts', {
    enabled: promptsEnabled,
    swrOptions: PROMPT_QUERY_SWR_OPTIONS,
    ...(promptQuery ? { query: promptQuery } : {})
  })
  useDataChange('/prompts', () => {
    if (promptsEnabled) void refetchPrompts()
  })

  const { trigger: createPrompt, isLoading: isCreatingPrompt } = useMutation('POST', '/prompts', {
    refresh: ['/prompts'],
    onError: (error) => {
      logger.error('Failed to create prompt', error)
      toast.error(formatErrorMessageWithPrefix(error, t('settings.prompts.errors.createFailed')))
    }
  })

  const promptItems = useMemo(() => promptsRaw || [], [promptsRaw])

  const insertText = useCallback(
    (text: string, options?: QuickPanelCallBackOptions) => {
      const inputAdapter = options?.inputAdapter
      if (inputAdapter) {
        inputAdapter.insertText(text)
        inputAdapter.focus()
        return
      }

      setTimeoutTimer(
        'handlePhraseSelect_1',
        () => {
          setInputValue((prev) => `${prev}${text}`)
        },
        10
      )
    },
    [setTimeoutTimer, setInputValue]
  )

  const handleItemSelect = useCallback(
    (item: Prompt, options?: QuickPanelCallBackOptions) => {
      insertText(item.content, options)
    },
    [insertText]
  )

  const restoreInputFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      restoreInputFocusRef.current?.()
      restoreInputFocusRef.current = null
    })
  }, [])

  const handleAddModalSave = useCallback(
    async (data: { title: string; content: string; visibility: PromptVisibility }) => {
      try {
        await createPrompt({
          body: {
            title: data.title,
            content: data.content,
            visibility: data.visibility,
            ...(data.visibility === 'restricted' && bindingTarget ? { bindingTarget } : {})
          }
        })
        setIsAddModalOpen(false)
        restoreInputFocus()
      } catch {
        // handled by useMutation onError
      }
    },
    [bindingTarget, createPrompt, restoreInputFocus]
  )

  const openAddModal = useCallback((options?: QuickPanelCallBackOptions) => {
    restoreInputFocusRef.current = options?.inputAdapter?.focus ?? null
    setIsAddModalOpen(true)
  }, [])

  const closeAddModal = useCallback(() => {
    setIsAddModalOpen(false)
    restoreInputFocus()
  }, [restoreInputFocus])

  const openCurrentPromptManagement = useCallback(() => {
    if (!bindingTarget) return
    openResourceEditDialog({ kind: bindingTarget.type, id: bindingTarget.id, initialTab: 'prompts' })
  }, [bindingTarget])

  const openGlobalPromptManagement = useCallback(() => {
    openSettingsTab('/settings/prompts')
  }, [])

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = []

    if ((!promptsEnabled || isPromptsLoading) && promptItems.length === 0) {
      newList.push({
        label: t('common.loading'),
        icon: <Zap />,
        disabled: true
      })
    } else if (promptsError && promptItems.length === 0) {
      newList.push({
        label: formatErrorMessageWithPrefix(promptsError, t('settings.prompts.errors.loadFailed')),
        icon: <Zap />,
        disabled: true
      })
    } else {
      newList.push(
        ...promptItems.map((item) => ({
          label: item.title,
          description: item.content,
          icon: <Zap />,
          action: (options) => handleItemSelect(item, options)
        }))
      )
    }

    return newList
  }, [handleItemSelect, isPromptsLoading, promptItems, promptsEnabled, promptsError, t])

  const footerActions = useMemo<QuickPanelFooterAction[]>(() => {
    const actions: QuickPanelFooterAction[] = [
      {
        id: 'quick-phrases:add',
        label: t('settings.prompts.add'),
        ariaLabel: t('settings.prompts.add'),
        tooltip: t('settings.prompts.add'),
        icon: <Plus />,
        action: openAddModal
      }
    ]

    if (bindingTarget) {
      const ariaLabel =
        bindingTarget.type === 'assistant'
          ? t('settings.prompts.manageCurrentAssistant')
          : t('settings.prompts.manageCurrentAgent')
      actions.push({
        id: 'quick-phrases:manage-current',
        label:
          bindingTarget.type === 'assistant'
            ? t('settings.quickPanel.scope.currentAssistant')
            : t('settings.quickPanel.scope.currentAgent'),
        ariaLabel,
        tooltip: ariaLabel,
        icon: <Settings2 />,
        action: openCurrentPromptManagement
      })
    }

    const globalAriaLabel = t('settings.prompts.manageGlobal')
    actions.push({
      id: 'quick-phrases:manage-global',
      label: t('settings.quickPanel.scope.global'),
      ariaLabel: globalAriaLabel,
      tooltip: globalAriaLabel,
      icon: <Globe2 />,
      action: openGlobalPromptManagement
    })

    return actions
  }, [bindingTarget, openAddModal, openCurrentPromptManagement, openGlobalPromptManagement, t])

  const quickPanelOpenOptions = useMemo<QuickPanelOpenOptions>(
    () => ({
      title: t('settings.prompts.title'),
      footerActions,
      list: phraseItems,
      symbol: ComposerPanelSymbol.QuickPhrases,
      trackInputQuery: true
    }),
    [footerActions, phraseItems, t]
  )

  const quickPanelOpenOptionsRef = useRef(quickPanelOpenOptions)

  useEffect(() => {
    quickPanelOpenOptionsRef.current = quickPanelOpenOptions
  }, [quickPanelOpenOptions])

  useEffect(() => {
    if (isQuickPanelVisible && quickPanelSymbol === ComposerPanelSymbol.QuickPhrases) {
      updateQuickPanelList(phraseItems)
    }
  }, [isQuickPanelVisible, phraseItems, quickPanelSymbol, updateQuickPanelList])

  const openQuickPanel = useCallback(
    (parentPanel?: QuickPanelOpenOptions, queryAnchor?: number) => {
      openQuickPanelContext({
        ...quickPanelOpenOptionsRef.current,
        parentPanel,
        queryAnchor,
        triggerInfo: { type: 'button' }
      })
    },
    [openQuickPanelContext]
  )

  useEffect(() => {
    const disposeLauncher = launcher.registerLaunchers([
      {
        ...QUICK_PHRASES_TOOLBAR_MANIFEST.toolbar,
        sources: ['popover', 'root-panel'],
        label: t('settings.prompts.title'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'settings.prompts.title'),
        action: ({ parentPanel, queryAnchor }) => {
          setPromptsEnabled(true)
          openQuickPanel(parentPanel, queryAnchor)
        }
      }
    ])

    return () => {
      disposeLauncher()
    }
  }, [launcher, openQuickPanel, t])

  return {
    handleAddModalSave,
    isAddModalOpen,
    isCreatingPrompt,
    defaultVisibility: bindingTarget ? ('restricted' as const) : ('global' as const),
    closeAddModal
  }
}

const QuickPhrasesModal = ({
  defaultVisibility,
  handleAddModalSave,
  isAddModalOpen,
  isCreatingPrompt,
  closeAddModal
}: Pick<
  ReturnType<typeof useQuickPhrasesToolController>,
  'defaultVisibility' | 'handleAddModalSave' | 'isAddModalOpen' | 'isCreatingPrompt' | 'closeAddModal'
>) => (
  <PromptEditDialog
    open={isAddModalOpen}
    defaultVisibility={defaultVisibility}
    saving={isCreatingPrompt}
    onSave={handleAddModalSave}
    onCancel={closeAddModal}
  />
)

export const QuickPhrasesToolRuntime = (props: Props) => {
  const controller = useQuickPhrasesToolController(props)
  return <QuickPhrasesModal {...controller} />
}
