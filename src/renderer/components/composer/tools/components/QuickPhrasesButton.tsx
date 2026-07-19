import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
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
import type { Prompt } from '@shared/data/types/prompt'
import { Pencil, Plus, Zap } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  launcher: ToolLauncherApi
  setInputValue: Dispatch<SetStateAction<string>>
}

const logger = loggerService.withContext('QuickPhrasesButton')

const useQuickPhrasesToolController = ({ launcher, setInputValue }: Props) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isManageModalOpen, setIsManageModalOpen] = useState(false)
  const restoreInputFocusRef = useRef<(() => void) | null>(null)
  const { t } = useTranslation()
  const {
    isVisible: isQuickPanelVisible,
    open: openQuickPanelContext,
    symbol: quickPanelSymbol,
    updateList: updateQuickPanelList
  } = useQuickPanel()
  const { setTimeoutTimer } = useTimer()

  const { data: promptsRaw, isLoading: isPromptsLoading, error: promptsError } = useQuery('/prompts')

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
    async (data: { title: string; content: string }) => {
      try {
        await createPrompt({
          body: {
            title: data.title,
            content: data.content
          }
        })
        setIsAddModalOpen(false)
        restoreInputFocus()
      } catch {
        // handled by useMutation onError
      }
    },
    [createPrompt, restoreInputFocus]
  )

  const openAddModal = useCallback((options?: QuickPanelCallBackOptions) => {
    restoreInputFocusRef.current = options?.inputAdapter?.focus ?? null
    setIsAddModalOpen(true)
  }, [])

  const closeAddModal = useCallback(() => {
    setIsAddModalOpen(false)
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

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = []

    if (isPromptsLoading && promptItems.length === 0) {
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
  }, [handleItemSelect, isPromptsLoading, openAddModal, openManageModal, promptItems, promptsError, t])

  const quickPanelOpenOptions = useMemo<QuickPanelOpenOptions>(
    () => ({
      title: t('settings.prompts.title'),
      list: phraseItems,
      symbol: ComposerPanelSymbol.QuickPhrases
    }),
    [phraseItems, t]
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
        id: 'quick-phrases',
        kind: 'panel',
        sources: ['popover', 'root-panel'],
        order: 70,
        label: t('settings.prompts.title'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'settings.prompts.title'),
        icon: <Zap />,
        action: ({ parentPanel, queryAnchor, triggerInfo }) => {
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
    closeAddModal,
    handleManageModalOpenChange
  }
}

const QuickPhrasesModal = ({
  handleAddModalSave,
  isAddModalOpen,
  isCreatingPrompt,
  isManageModalOpen,
  closeAddModal,
  handleManageModalOpenChange
}: Pick<
  ReturnType<typeof useQuickPhrasesToolController>,
  | 'handleAddModalSave'
  | 'isAddModalOpen'
  | 'isCreatingPrompt'
  | 'isManageModalOpen'
  | 'closeAddModal'
  | 'handleManageModalOpenChange'
>) => (
  <>
    <PromptEditDialog
      open={isAddModalOpen}
      saving={isCreatingPrompt}
      onSave={handleAddModalSave}
      onCancel={closeAddModal}
    />
    <PromptManagementDialog open={isManageModalOpen} onOpenChange={handleManageModalOpenChange} />
  </>
)

export const QuickPhrasesToolRuntime = (props: Props) => {
  const controller = useQuickPhrasesToolController(props)
  return <QuickPhrasesModal {...controller} />
}
