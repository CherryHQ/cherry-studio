import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import {
  type QuickPanelListItem,
  type QuickPanelOpenOptions,
  QuickPanelReservedSymbol,
  type QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { dataApiService } from '@renderer/data/DataApiService'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTimer } from '@renderer/hooks/useTimer'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { QuickPhrase } from '@renderer/types'
import type { PromptVersion } from '@shared/data/types/prompt'
import { Input, Modal, Radio, Space } from 'antd'
import { BotMessageSquare, Plus, Zap } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  quickPanel: ToolQuickPanelApi
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  assistantId: string
}

/**
 * Unified prompt item used internally in this component.
 * Merges legacy assistant regularPhrases and new Prompt entities.
 */
interface UnifiedPromptItem {
  id: string
  title: string
  content: string
  /** Whether this item comes from the assistant's regularPhrases */
  isAssistantPhrase: boolean
  /** Current version number. Assistant phrases always have 1. */
  currentVersion: number
}

const QuickPhrasesButton = ({ quickPanel, setInputValue, resizeTextArea, assistantId }: Props) => {
  const [promptItems, setPromptItems] = useState<UnifiedPromptItem[]>([])
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addFormData, setAddFormData] = useState({ title: '', content: '', location: 'global' })
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const { setTimeoutTimer } = useTimer()
  const triggerInfoRef = useRef<
    (QuickPanelTriggerInfo & { symbol?: QuickPanelReservedSymbol; searchText?: string }) | undefined
  >(undefined)

  const loadPromptItems = useCallback(async () => {
    // Load global prompts from DataApi
    const prompts = await dataApiService.get('/prompts')

    // Build unified list: assistant phrases first, then global prompts
    const assistantPhrases: UnifiedPromptItem[] = (assistant.regularPhrases || []).map((p: QuickPhrase) => ({
      id: p.id,
      title: p.title,
      content: p.content,
      isAssistantPhrase: true,
      currentVersion: 1
    }))

    const globalPrompts: UnifiedPromptItem[] = prompts.map((p) => ({
      id: p.id,
      title: p.title,
      content: p.content,
      isAssistantPhrase: false,
      currentVersion: p.currentVersion
    }))

    setPromptItems([...assistantPhrases, ...globalPrompts])
  }, [assistant.regularPhrases])

  useEffect(() => {
    loadPromptItems()
  }, [loadPromptItems])

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
    (item: UnifiedPromptItem) => {
      insertText(item.content)
    },
    [insertText]
  )

  const openVersionSubMenu = useCallback(
    async (item: UnifiedPromptItem) => {
      try {
        const versions: PromptVersion[] = await dataApiService.get(`/prompts/${item.id}/versions`)

        const versionItems: QuickPanelListItem[] = versions.map((v) => ({
          label: `v${v.version}`,
          description: v.content,
          icon: <Zap />,
          isSelected: v.version === item.currentVersion,
          action: () => insertText(v.content)
        }))

        quickPanelHook.open({
          title: item.title,
          list: versionItems,
          symbol: QuickPanelReservedSymbol.QuickPhrases
        })
      } catch {
        // If version fetch fails, fall back to inserting current content
        insertText(item.content)
      }
    },
    [quickPanelHook, insertText]
  )

  const handleAddModalOk = useCallback(async () => {
    if (!addFormData.title.trim() || !addFormData.content.trim()) {
      return
    }

    if (addFormData.location === 'assistant') {
      const updatedPhrases = [
        ...(assistant.regularPhrases || []),
        {
          id: crypto.randomUUID(),
          title: addFormData.title,
          content: addFormData.content,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ]
      await updateAssistant({ ...assistant, regularPhrases: updatedPhrases })
    } else {
      await dataApiService.post('/prompts', {
        body: {
          title: addFormData.title,
          content: addFormData.content
        }
      })
    }
    setIsAddModalOpen(false)
    setAddFormData({ title: '', content: '', location: 'global' })
    await loadPromptItems()
  }, [addFormData, assistant, updateAssistant, loadPromptItems])

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = promptItems.map((item) => {
      const hasMultipleVersions = !item.isAssistantPhrase && item.currentVersion > 1

      return {
        label: item.title,
        description: item.content,
        icon: item.isAssistantPhrase ? <BotMessageSquare /> : <Zap />,
        isMenu: hasMultipleVersions,
        action: hasMultipleVersions ? () => openVersionSubMenu(item) : () => handleItemSelect(item)
      }
    })

    newList.push({
      label: t('settings.prompts.add') + '...',
      icon: <Plus />,
      action: () => setIsAddModalOpen(true)
    })

    return newList
  }, [promptItems, handleItemSelect, openVersionSubMenu, t])

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
            <VarLabel>{t('settings.prompts.titleLabel')}</VarLabel>
            <Input
              placeholder={t('settings.prompts.titlePlaceholder')}
              value={addFormData.title}
              onChange={(e) => setAddFormData({ ...addFormData, title: e.target.value })}
            />
          </div>
          <div>
            <VarLabel>{t('settings.prompts.contentLabel')}</VarLabel>
            <Input.TextArea
              placeholder={t('settings.prompts.contentPlaceholder')}
              value={addFormData.content}
              onChange={(e) => setAddFormData({ ...addFormData, content: e.target.value })}
              rows={6}
              style={{ resize: 'none' }}
            />
          </div>
          <div>
            <VarLabel>{t('settings.prompts.locationLabel')}</VarLabel>
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

const VarLabel = styled.div`
  font-size: 14px;
  color: var(--color-text);
  margin-bottom: 4px;
`

export default memo(QuickPhrasesButton)
