import { Tooltip } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import PromptEditModal from '@renderer/components/PromptEditModal'
import {
  type QuickPanelListItem,
  type QuickPanelOpenOptions,
  QuickPanelReservedSymbol,
  type QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { useTimer } from '@renderer/hooks/useTimer'
import { useInputbarToolsDispatch } from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import { getPromptVersionRollbackMarker } from '@renderer/utils/promptVersion'
import type { Prompt, PromptVariable, PromptVersion } from '@shared/data/types/prompt'
import { Plus, Zap } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
}

const logger = loggerService.withContext('QuickPhrasesButton')

const QuickPhrasesButton = ({ quickPanel, setInputValue, resizeTextArea }: Props) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [versionMenuPrompt, setVersionMenuPrompt] = useState<Prompt | null>(null)
  const { setVariablePrompt } = useInputbarToolsDispatch()
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const { setTimeoutTimer } = useTimer()
  const triggerInfoRef = useRef<
    (QuickPanelTriggerInfo & { symbol?: QuickPanelReservedSymbol; searchText?: string }) | undefined
  >(undefined)

  const { data: promptsRaw, isLoading: isPromptsLoading, error: promptsError } = useQuery('/prompts')

  const versionMenuPath: `/prompts/${string}/versions` = `/prompts/${versionMenuPrompt?.id ?? '__pending__'}/versions`
  const {
    data: versionMenuVersionsRaw,
    isLoading: isVersionMenuLoading,
    error: versionMenuError
  } = useQuery(versionMenuPath, {
    enabled: !!versionMenuPrompt
  })
  const versionMenuVersions = useMemo(() => (versionMenuVersionsRaw || []) as PromptVersion[], [versionMenuVersionsRaw])

  const { trigger: createPrompt, isLoading: isCreatingPrompt } = useMutation('POST', '/prompts', {
    refresh: ['/prompts'],
    onError: (error) => {
      logger.error('Failed to create prompt', error)
      window.toast.error(t('message.error.unknown'))
    }
  })

  const promptItems = useMemo(() => promptsRaw || [], [promptsRaw])

  const insertText = useCallback(
    (text: string) => {
      setTimeoutTimer(
        'handlePhraseSelect_1',
        () => {
          setInputValue((prev) => {
            const triggerInfo = triggerInfoRef.current
            const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null

            const focusAndSelect = (start: number) => {
              setTimeoutTimer(
                'handlePhraseSelect_2',
                () => {
                  if (textArea) {
                    textArea.focus()
                    textArea.setSelectionRange(start, start + text.length)
                  }
                  resizeTextArea()
                },
                10
              )
            }

            if (triggerInfo?.type === 'input' && triggerInfo.position !== undefined) {
              const symbol = triggerInfo.symbol ?? QuickPanelReservedSymbol.Root
              const searchText = triggerInfo.searchText ?? ''
              const startIndex = triggerInfo.position

              let endIndex = startIndex + 1
              if (searchText) {
                const expected = symbol + searchText
                const actual = prev.slice(startIndex, startIndex + expected.length)
                if (actual === expected) {
                  endIndex = startIndex + expected.length
                } else {
                  while (endIndex < prev.length && !/\s/.test(prev[endIndex])) {
                    endIndex++
                  }
                }
              } else {
                while (endIndex < prev.length && !/\s/.test(prev[endIndex])) {
                  endIndex++
                }
              }

              const newText = prev.slice(0, startIndex) + text + prev.slice(endIndex)
              triggerInfoRef.current = undefined
              focusAndSelect(startIndex)
              return newText
            }

            if (!textArea) {
              triggerInfoRef.current = undefined
              return prev + text
            }

            const cursorPosition = textArea.selectionStart ?? prev.length
            const newText = prev.slice(0, cursorPosition) + text + prev.slice(cursorPosition)
            triggerInfoRef.current = undefined
            focusAndSelect(cursorPosition)
            return newText
          })
        },
        10
      )
    },
    [setTimeoutTimer, setInputValue, resizeTextArea]
  )

  const handleItemSelect = useCallback(
    (item: Prompt) => {
      if (item.variables && item.variables.length > 0) {
        setVariablePrompt({ content: item.content, variables: item.variables })
      } else {
        insertText(item.content)
      }
    },
    [insertText, setVariablePrompt]
  )

  const openVersionSubMenu = useCallback(
    (item: Prompt) => {
      quickPanelHook.open({
        title: item.title,
        list: [
          {
            label: t('common.loading'),
            description: item.content,
            icon: <Zap />,
            disabled: true
          }
        ],
        symbol: QuickPanelReservedSymbol.QuickPhrases
      })
      setVersionMenuPrompt(item)
    },
    [quickPanelHook, t]
  )

  useEffect(() => {
    if (!versionMenuPrompt || isVersionMenuLoading) {
      return
    }

    if (versionMenuError) {
      logger.error('Failed to fetch prompt versions', versionMenuError)
      window.toast.error(t('message.error.unknown'))
      insertText(versionMenuPrompt.content)
      setVersionMenuPrompt(null)
      return
    }

    if (versionMenuVersions.length === 0) {
      window.toast.error(t('message.error.unknown'))
      insertText(versionMenuPrompt.content)
      setVersionMenuPrompt(null)
      return
    }

    const versionItems: QuickPanelListItem[] = versionMenuVersions.map((version) => ({
      label:
        getPromptVersionRollbackMarker(
          version.rollbackFrom,
          (rollbackFrom) =>
            `v${version.version} (${t('settings.prompts.restoredFromVersion', { version: rollbackFrom })})`
        ) ?? `v${version.version}`,
      description: version.content,
      icon: <Zap />,
      isSelected: version.version === versionMenuPrompt.currentVersion,
      action: () => {
        if (version.variables && version.variables.length > 0) {
          setVariablePrompt({ content: version.content, variables: version.variables })
        } else {
          insertText(version.content)
        }
      }
    }))

    quickPanelHook.open({
      title: versionMenuPrompt.title,
      list: versionItems,
      symbol: QuickPanelReservedSymbol.QuickPhrases
    })
    setVersionMenuPrompt(null)
  }, [insertText, isVersionMenuLoading, quickPanelHook, t, versionMenuError, versionMenuPrompt, versionMenuVersions])

  const handleAddModalSave = useCallback(
    async (data: { title: string; content: string; variables: PromptVariable[] | null }) => {
      try {
        await createPrompt({
          body: {
            title: data.title,
            content: data.content,
            variables: data.variables ?? undefined
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
        label: t('message.error.unknown'),
        icon: <Zap />,
        disabled: true
      })
    } else {
      newList.push(
        ...promptItems.map((item) => {
          const hasMultipleVersions = item.currentVersion > 1

          return {
            label: item.title,
            description: item.content,
            icon: <Zap />,
            isMenu: hasMultipleVersions,
            action: hasMultipleVersions ? () => openVersionSubMenu(item) : () => handleItemSelect(item)
          }
        })
      )
    }

    newList.push({
      label: t('settings.prompts.add') + '...',
      icon: <Plus />,
      action: () => setIsAddModalOpen(true)
    })

    return newList
  }, [handleItemSelect, isPromptsLoading, openVersionSubMenu, promptItems, promptsError, t])

  const quickPanelOpenOptions = useMemo<QuickPanelOpenOptions>(
    () => ({
      title: t('settings.prompts.title'),
      list: phraseItems,
      symbol: QuickPanelReservedSymbol.QuickPhrases
    }),
    [phraseItems, t]
  )

  type QuickPhraseTrigger =
    | (QuickPanelTriggerInfo & { symbol?: QuickPanelReservedSymbol; searchText?: string })
    | undefined

  const openQuickPanel = useCallback(
    (triggerInfo?: QuickPhraseTrigger) => {
      triggerInfoRef.current = triggerInfo
      quickPanelHook.open({
        ...quickPanelOpenOptions,
        triggerInfo:
          triggerInfo && triggerInfo.type === 'input'
            ? {
                type: triggerInfo.type,
                position: triggerInfo.position,
                originalText: triggerInfo.originalText
              }
            : triggerInfo,
        onClose: () => {
          triggerInfoRef.current = undefined
        }
      })
    },
    [quickPanelHook, quickPanelOpenOptions]
  )

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.QuickPhrases) {
      quickPanelHook.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanelHook])

  useEffect(() => {
    const disposeRootMenu = quickPanel.registerRootMenu([
      {
        label: t('settings.prompts.title'),
        description: '',
        icon: <Zap />,
        isMenu: true,
        action: ({ context, searchText }) => {
          const rootTrigger =
            context.triggerInfo && context.triggerInfo.type === 'input'
              ? {
                  ...context.triggerInfo,
                  symbol: QuickPanelReservedSymbol.Root,
                  searchText: searchText ?? ''
                }
              : undefined

          context.close('select')
          setTimeout(() => {
            openQuickPanel(rootTrigger)
          }, 0)
        }
      }
    ])

    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.QuickPhrases, (payload) => {
      const trigger = (payload || undefined) as QuickPhraseTrigger
      openQuickPanel(trigger)
    })

    return () => {
      disposeRootMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, quickPanel, t])

  return (
    <>
      <Tooltip content={t('settings.prompts.title')}>
        <ActionIconButton
          onClick={handleOpenQuickPanel}
          aria-label={t('settings.prompts.title')}
          icon={<Zap size={18} />}
        />
      </Tooltip>

      <PromptEditModal
        open={isAddModalOpen}
        saving={isCreatingPrompt}
        onSave={handleAddModalSave}
        onCancel={() => setIsAddModalOpen(false)}
      />
    </>
  )
}

export default memo(QuickPhrasesButton)
