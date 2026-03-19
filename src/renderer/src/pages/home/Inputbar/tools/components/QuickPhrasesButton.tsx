import { Tooltip } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import {
  type QuickPanelListItem,
  type QuickPanelOpenOptions,
  QuickPanelReservedSymbol,
  type QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { useTimer } from '@renderer/hooks/useTimer'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { Prompt, PromptVersion } from '@shared/data/types/prompt'
import { Input, Modal, Radio, Space } from 'antd'
import { BotMessageSquare, Plus, Zap } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  assistantId: string
}

/**
 * Prompt item used internally in this component.
 */
interface PromptItem {
  id: string
  title: string
  content: string
  currentVersion: number
  source: 'global' | 'assistant'
}

const logger = loggerService.withContext('QuickPhrasesButton')

const QuickPhrasesButton = ({ quickPanel, setInputValue, resizeTextArea, assistantId }: Props) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addFormData, setAddFormData] = useState({ title: '', content: '', location: 'global' })
  const [versionMenuPrompt, setVersionMenuPrompt] = useState<PromptItem | null>(null)
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const { setTimeoutTimer } = useTimer()
  const triggerInfoRef = useRef<
    (QuickPanelTriggerInfo & { symbol?: QuickPanelReservedSymbol; searchText?: string }) | undefined
  >(undefined)

  const {
    data: globalPromptsRaw,
    isLoading: isGlobalPromptsLoading,
    error: globalPromptsError
  } = useQuery('/prompts', { query: { scope: 'global' } })
  const {
    data: assistantPromptsRaw,
    isLoading: isAssistantPromptsLoading,
    error: assistantPromptsError
  } = useQuery('/prompts', { query: { assistantId } })

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

  const promptItems = useMemo<PromptItem[]>(() => {
    const assistantPrompts = (assistantPromptsRaw || []) as Prompt[]
    const globalPrompts = (globalPromptsRaw || []) as Prompt[]
    return [
      ...assistantPrompts.map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        currentVersion: p.currentVersion,
        source: 'assistant' as const
      })),
      ...globalPrompts.map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        currentVersion: p.currentVersion,
        source: 'global' as const
      }))
    ]
  }, [assistantPromptsRaw, globalPromptsRaw])

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
    (item: PromptItem) => {
      insertText(item.content)
    },
    [insertText]
  )

  const openVersionSubMenu = useCallback(
    (item: PromptItem) => {
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
      label: `v${version.version}`,
      description: version.content,
      icon: <Zap />,
      isSelected: version.version === versionMenuPrompt.currentVersion,
      action: () => insertText(version.content)
    }))

    quickPanelHook.open({
      title: versionMenuPrompt.title,
      list: versionItems,
      symbol: QuickPanelReservedSymbol.QuickPhrases
    })
    setVersionMenuPrompt(null)
  }, [insertText, isVersionMenuLoading, quickPanelHook, t, versionMenuError, versionMenuPrompt, versionMenuVersions])

  const handleAddModalOk = useCallback(async () => {
    if (!addFormData.title.trim() || !addFormData.content.trim()) {
      return
    }

    try {
      await createPrompt({
        body: {
          title: addFormData.title,
          content: addFormData.content,
          assistantId: addFormData.location === 'assistant' ? assistantId : undefined
        }
      })
      setIsAddModalOpen(false)
      setAddFormData({ title: '', content: '', location: 'global' })
    } catch {
      // handled by useMutation onError
    }
  }, [addFormData, assistantId, createPrompt])

  const isPromptsLoading = isGlobalPromptsLoading || isAssistantPromptsLoading
  const promptsLoadError = globalPromptsError || assistantPromptsError

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = []

    if (isPromptsLoading && promptItems.length === 0) {
      newList.push({
        label: t('common.loading'),
        icon: <Zap />,
        disabled: true
      })
    } else if (promptsLoadError && promptItems.length === 0) {
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
            icon: item.source === 'assistant' ? <BotMessageSquare /> : <Zap />,
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
  }, [handleItemSelect, isPromptsLoading, openVersionSubMenu, promptItems, promptsLoadError, t])

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
      <Tooltip content={t('settings.prompts.title')} closeDelay={0}>
        <ActionIconButton
          onClick={handleOpenQuickPanel}
          aria-label={t('settings.prompts.title')}
          icon={<Zap size={18} />}
        />
      </Tooltip>

      {/* Add Prompt Modal */}
      <Modal
        title={t('settings.prompts.add')}
        open={isAddModalOpen}
        onOk={handleAddModalOk}
        confirmLoading={isCreatingPrompt}
        maskClosable={false}
        onCancel={() => {
          setIsAddModalOpen(false)
          setAddFormData({ title: '', content: '', location: 'global' })
        }}
        width={520}
        transitionName="animation-move-down"
        centered>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div className="mb-1 text-(--color-text) text-sm">{t('settings.prompts.titleLabel')}</div>
            <Input
              placeholder={t('settings.prompts.titlePlaceholder')}
              value={addFormData.title}
              onChange={(e) => setAddFormData({ ...addFormData, title: e.target.value })}
            />
          </div>
          <div>
            <div className="mb-1 text-(--color-text) text-sm">{t('settings.prompts.contentLabel')}</div>
            <Input.TextArea
              placeholder={t('settings.prompts.contentPlaceholder')}
              value={addFormData.content}
              onChange={(e) => setAddFormData({ ...addFormData, content: e.target.value })}
              rows={6}
              style={{ resize: 'none' }}
            />
          </div>
          <div>
            <div className="mb-1 text-(--color-text) text-sm">{t('settings.prompts.locationLabel')}</div>
            <Radio.Group
              value={addFormData.location}
              onChange={(e) => setAddFormData({ ...addFormData, location: e.target.value })}>
              <Radio value="global">
                <Zap size={20} style={{ paddingRight: '4px', verticalAlign: 'middle', paddingBottom: '3px' }} />
                {t('settings.prompts.global')}
              </Radio>
              <Radio value="assistant">
                <BotMessageSquare
                  size={20}
                  style={{ paddingRight: '4px', verticalAlign: 'middle', paddingBottom: '3px' }}
                />
                {t('settings.prompts.assistant')}
              </Radio>
            </Radio.Group>
          </div>
        </Space>
      </Modal>
    </>
  )
}

export default memo(QuickPhrasesButton)
