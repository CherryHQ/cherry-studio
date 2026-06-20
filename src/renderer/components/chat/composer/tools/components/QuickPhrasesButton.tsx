import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ComposerPanelSymbol } from '@renderer/components/chat/composer/quickPanel/symbols'
import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import {
  type QuickPanelCallBackOptions,
  type QuickPanelListItem,
  type QuickPanelOpenOptions
} from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import PromptEditDialog from '@renderer/components/resource/dialogs/PromptEditDialog'
import { useTimer } from '@renderer/hooks/useTimer'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Prompt } from '@shared/data/types/prompt'
import { Plus, Zap } from 'lucide-react'
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
      window.toast.error(formatErrorMessageWithPrefix(error, t('settings.prompts.errors.createFailed')))
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
      } catch {
        // handled by useMutation onError
      }
    },
    [createPrompt]
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
      label: t('settings.prompts.add') + '...',
      icon: <Plus />,
      action: () => setIsAddModalOpen(true)
    })

    return newList
  }, [handleItemSelect, isPromptsLoading, promptItems, promptsError, t])

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
        sources: ['root-panel'],
        order: 70,
        label: t('settings.prompts.title'),
        description: '',
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
    setIsAddModalOpen
  }
}

const QuickPhrasesModal = ({
  handleAddModalSave,
  isAddModalOpen,
  isCreatingPrompt,
  setIsAddModalOpen
}: Pick<
  ReturnType<typeof useQuickPhrasesToolController>,
  'handleAddModalSave' | 'isAddModalOpen' | 'isCreatingPrompt' | 'setIsAddModalOpen'
>) => (
  <PromptEditDialog
    open={isAddModalOpen}
    saving={isCreatingPrompt}
    onSave={handleAddModalSave}
    onCancel={() => setIsAddModalOpen(false)}
  />
)

export const QuickPhrasesToolRuntime = (props: Props) => {
  const controller = useQuickPhrasesToolController(props)
  return <QuickPhrasesModal {...controller} />
}
