import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { QUICK_PHRASES_TOOLBAR_MANIFEST } from '@renderer/components/composer/tools/toolbarManifests'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import {
  type QuickPanelCallBackOptions,
  type QuickPanelListItem,
  type QuickPanelOpenOptions
} from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { PromptEditDialog } from '@renderer/components/resourceCatalog/dialogs/edit'
import { PromptManagementDialog } from '@renderer/components/resourceCatalog/dialogs/manage'
import { useTimer } from '@renderer/hooks/useTimer'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Prompt, PromptBindingTarget } from '@shared/data/types/prompt'
import { List, Pencil, Plus, Zap } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  launcher: ToolLauncherApi
  setInputValue: Dispatch<SetStateAction<string>>
  bindingTarget?: PromptBindingTarget
}

const logger = loggerService.withContext('QuickPhrasesButton')

const useQuickPhrasesToolController = ({ bindingTarget, launcher, setInputValue }: Props) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isManageModalOpen, setIsManageModalOpen] = useState(false)
  const [promptsEnabled, setPromptsEnabled] = useState(false)
  const [allPromptsEnabled, setAllPromptsEnabled] = useState(false)
  const [capturedBindingTarget, setCapturedBindingTarget] = useState<PromptBindingTarget>()
  const restoreInputFocusRef = useRef<(() => void) | null>(null)
  const { t } = useTranslation()
  const {
    isVisible: isQuickPanelVisible,
    open: openQuickPanelContext,
    symbol: quickPanelSymbol,
    updateList: updateQuickPanelList
  } = useQuickPanel()
  const { setTimeoutTimer } = useTimer()
  const hasBindingTarget = bindingTarget !== undefined

  const {
    data: boundPromptsRaw,
    isLoading: isBoundPromptsLoading,
    error: boundPromptsError
  } = useQuery('/prompts', {
    enabled: promptsEnabled && hasBindingTarget,
    ...(bindingTarget ? { query: { targetType: bindingTarget.type, targetId: bindingTarget.id } } : {})
  })

  const {
    data: allPromptsRaw,
    isLoading: isAllPromptsLoading,
    error: allPromptsError
  } = useQuery('/prompts', { enabled: promptsEnabled && (!hasBindingTarget || allPromptsEnabled) })

  const { trigger: createPrompt, isLoading: isCreatingPrompt } = useMutation('POST', '/prompts', {
    refresh: ['/prompts'],
    onError: (error) => {
      logger.error('Failed to create prompt', error)
      toast.error(formatErrorMessageWithPrefix(error, t('settings.prompts.errors.createFailed')))
    }
  })

  const boundPromptItems = useMemo(() => boundPromptsRaw ?? [], [boundPromptsRaw])
  const allPromptItems = useMemo(() => allPromptsRaw ?? [], [allPromptsRaw])

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
    async (data: { title: string; content: string }) => {
      try {
        await createPrompt({
          body: {
            title: data.title,
            content: data.content,
            ...(capturedBindingTarget ? { bindingTarget: capturedBindingTarget } : {})
          }
        })
        setIsAddModalOpen(false)
        setCapturedBindingTarget(undefined)
        restoreInputFocus()
      } catch {
        // handled by useMutation onError
      }
    },
    [capturedBindingTarget, createPrompt, restoreInputFocus]
  )

  const openAddModal = useCallback(
    (options?: QuickPanelCallBackOptions) => {
      restoreInputFocusRef.current = options?.inputAdapter?.focus ?? null
      setCapturedBindingTarget(bindingTarget)
      setIsAddModalOpen(true)
    },
    [bindingTarget]
  )

  const closeAddModal = useCallback(() => {
    setIsAddModalOpen(false)
    setCapturedBindingTarget(undefined)
    restoreInputFocus()
  }, [restoreInputFocus])

  const openManageModal = useCallback((options?: QuickPanelCallBackOptions) => {
    restoreInputFocusRef.current = options?.inputAdapter?.focus ?? null
    setIsManageModalOpen(true)
  }, [])

  const handleManageModalOpenChange = useCallback(
    (open: boolean) => {
      setIsManageModalOpen(open)
      if (!open) {
        restoreInputFocus()
      }
    },
    [restoreInputFocus]
  )

  const buildPromptItems = useCallback(
    (
      items: Prompt[],
      options: { requested: boolean; isLoading: boolean; error: unknown; emptyLabel: string }
    ): QuickPanelListItem[] => {
      if ((!options.requested || options.isLoading) && items.length === 0) {
        return [{ label: t('common.loading'), icon: <Zap />, disabled: true }]
      }
      if (options.error && items.length === 0) {
        return [
          {
            label: formatErrorMessageWithPrefix(options.error, t('settings.prompts.errors.loadFailed')),
            icon: <Zap />,
            disabled: true
          }
        ]
      }
      if (items.length === 0) {
        return [{ label: options.emptyLabel, icon: <Zap />, disabled: true }]
      }
      return items.map((item) => ({
        id: item.id,
        label: item.title,
        description: item.content,
        icon: <Zap />,
        action: (callbackOptions) => handleItemSelect(item, callbackOptions)
      }))
    },
    [handleItemSelect, t]
  )

  const allPanelOpenOptionsRef = useRef<QuickPanelOpenOptions>({
    list: [],
    symbol: ComposerPanelSymbol.QuickPhrasesAll
  })

  const openAllPrompts = useCallback((options: QuickPanelCallBackOptions) => {
    setAllPromptsEnabled(true)
    options.context.open({
      ...allPanelOpenOptionsRef.current,
      parentPanel: options.parentPanel,
      queryAnchor: options.queryAnchor,
      triggerInfo: options.parentPanel?.triggerInfo,
      initialSearchText: options.searchText
    })
  }, [])

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = []

    if (bindingTarget) {
      newList.push(
        ...buildPromptItems(boundPromptItems, {
          requested: promptsEnabled,
          isLoading: isBoundPromptsLoading,
          error: boundPromptsError,
          emptyLabel: t('settings.prompts.noBoundPrompts')
        })
      )
      newList.push({
        id: 'quick-phrases:all',
        label: t('settings.prompts.allPrompts'),
        icon: <List />,
        isMenu: true,
        alwaysVisible: true,
        action: openAllPrompts
      })
    } else {
      newList.push(
        ...buildPromptItems(allPromptItems, {
          requested: promptsEnabled,
          isLoading: isAllPromptsLoading,
          error: allPromptsError,
          emptyLabel: t('settings.prompts.noPrompts')
        })
      )
    }

    newList.push({
      label: t('settings.prompts.manage'),
      icon: <Pencil />,
      action: openManageModal
    })

    newList.push({
      label: t('settings.prompts.add') + '...',
      icon: <Plus />,
      action: openAddModal
    })

    return newList
  }, [
    allPromptItems,
    allPromptsError,
    bindingTarget,
    boundPromptItems,
    boundPromptsError,
    buildPromptItems,
    isAllPromptsLoading,
    isBoundPromptsLoading,
    openAddModal,
    openAllPrompts,
    openManageModal,
    promptsEnabled,
    t
  ])

  const allPhraseItems = useMemo(() => {
    const items = buildPromptItems(allPromptItems, {
      requested: allPromptsEnabled,
      isLoading: isAllPromptsLoading,
      error: allPromptsError,
      emptyLabel: t('settings.prompts.noPrompts')
    })
    items.push(
      { label: t('settings.prompts.manage'), icon: <Pencil />, action: openManageModal },
      { label: `${t('settings.prompts.add')}...`, icon: <Plus />, action: openAddModal }
    )
    return items
  }, [
    allPromptItems,
    allPromptsEnabled,
    allPromptsError,
    buildPromptItems,
    isAllPromptsLoading,
    openAddModal,
    openManageModal,
    t
  ])

  const quickPanelOpenOptions = useMemo<QuickPanelOpenOptions>(
    () => ({
      title: t('settings.prompts.title'),
      list: phraseItems,
      symbol: ComposerPanelSymbol.QuickPhrases
    }),
    [phraseItems, t]
  )

  const quickPanelOpenOptionsRef = useRef(quickPanelOpenOptions)

  const allPanelOpenOptions = useMemo<QuickPanelOpenOptions>(
    () => ({
      title: t('settings.prompts.allPrompts'),
      list: allPhraseItems,
      symbol: ComposerPanelSymbol.QuickPhrasesAll
    }),
    [allPhraseItems, t]
  )

  useEffect(() => {
    quickPanelOpenOptionsRef.current = quickPanelOpenOptions
    allPanelOpenOptionsRef.current = allPanelOpenOptions
  }, [allPanelOpenOptions, quickPanelOpenOptions])

  useEffect(() => {
    if (isQuickPanelVisible && quickPanelSymbol === ComposerPanelSymbol.QuickPhrases) {
      updateQuickPanelList(phraseItems)
    }
    if (isQuickPanelVisible && quickPanelSymbol === ComposerPanelSymbol.QuickPhrasesAll) {
      updateQuickPanelList(allPhraseItems)
    }
  }, [allPhraseItems, isQuickPanelVisible, phraseItems, quickPanelSymbol, updateQuickPanelList])

  const openQuickPanel = useCallback(
    (parentPanel?: QuickPanelOpenOptions, queryAnchor?: number, triggerInfo?: QuickPanelOpenOptions['triggerInfo']) => {
      openQuickPanelContext({
        ...quickPanelOpenOptionsRef.current,
        parentPanel,
        queryAnchor,
        triggerInfo
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
        action: ({ parentPanel, queryAnchor, triggerInfo }) => {
          setPromptsEnabled(true)
          openQuickPanel(parentPanel, queryAnchor, triggerInfo)
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
    isManageModalOpen,
    bindingTarget,
    capturedBindingTarget,
    closeAddModal,
    handleManageModalOpenChange
  }
}

const QuickPhrasesModal = ({
  handleAddModalSave,
  isAddModalOpen,
  isCreatingPrompt,
  isManageModalOpen,
  bindingTarget,
  capturedBindingTarget,
  closeAddModal,
  handleManageModalOpenChange
}: Pick<
  ReturnType<typeof useQuickPhrasesToolController>,
  | 'handleAddModalSave'
  | 'isAddModalOpen'
  | 'isCreatingPrompt'
  | 'isManageModalOpen'
  | 'bindingTarget'
  | 'capturedBindingTarget'
  | 'closeAddModal'
  | 'handleManageModalOpenChange'
>) => (
  <>
    <PromptEditDialog
      open={isAddModalOpen}
      saving={isCreatingPrompt}
      bindingTarget={capturedBindingTarget}
      onSave={handleAddModalSave}
      onCancel={closeAddModal}
    />
    <PromptManagementDialog
      open={isManageModalOpen}
      onOpenChange={handleManageModalOpenChange}
      bindingTarget={bindingTarget}
    />
  </>
)

export const QuickPhrasesToolRuntime = (props: Props) => {
  const controller = useQuickPhrasesToolController(props)
  return <QuickPhrasesModal {...controller} />
}
