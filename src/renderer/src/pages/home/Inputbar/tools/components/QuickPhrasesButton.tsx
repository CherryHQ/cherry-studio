import { ActionIconButton } from '@renderer/components/Buttons'
import {
  type QuickPanelListItem,
  type QuickPanelOpenOptions,
  QuickPanelReservedSymbol
} from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useTimer } from '@renderer/hooks/useTimer'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import QuickPhraseService from '@renderer/services/QuickPhraseService'
import type { QuickPhrase } from '@renderer/types'
import { Input, Modal, Radio, Space, Tooltip } from 'antd'
import { BotMessageSquare, Plus, Zap } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  quickPanel: ToolQuickPanelApi
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  assistantId: string
}

const QuickPhrasesButton = ({ quickPanel, setInputValue, resizeTextArea, assistantId }: Props) => {
  const [quickPhrasesList, setQuickPhrasesList] = useState<QuickPhrase[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState({ title: '', content: '', location: 'global' })
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const { assistant, updateAssistant } = useAssistant(assistantId)
  const { setTimeoutTimer } = useTimer()

  const loadQuickListPhrases = useCallback(
    async (regularPhrases: QuickPhrase[] = []) => {
      const phrases = await QuickPhraseService.getAll()
      if (regularPhrases.length) {
        setQuickPhrasesList([...regularPhrases, ...phrases])
        return
      }
      const assistantPrompts = assistant.regularPhrases || []
      setQuickPhrasesList([...assistantPrompts, ...phrases])
    },
    [assistant.regularPhrases]
  )

  useEffect(() => {
    loadQuickListPhrases()
  }, [loadQuickListPhrases])

  const handlePhraseSelect = useCallback(
    (phrase: QuickPhrase) => {
      setTimeoutTimer(
        'handlePhraseSelect_1',
        () => {
          setInputValue((prev) => {
            const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement
            const cursorPosition = textArea.selectionStart
            const selectionStart = cursorPosition
            const selectionEndPosition = cursorPosition + phrase.content.length
            const newText = prev.slice(0, cursorPosition) + phrase.content + prev.slice(cursorPosition)

            setTimeoutTimer(
              'handlePhraseSelect_2',
              () => {
                textArea.focus()
                textArea.setSelectionRange(selectionStart, selectionEndPosition)
                resizeTextArea()
              },
              10
            )
            return newText
          })
        },
        10
      )
    },
    [setTimeoutTimer, setInputValue, resizeTextArea]
  )

  const handleModalOk = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    const updatedPrompts = [
      ...(assistant.regularPhrases || []),
      {
        id: crypto.randomUUID(),
        title: formData.title,
        content: formData.content,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
    if (formData.location === 'assistant') {
      // 添加到助手的 regularPhrases
      await updateAssistant({ ...assistant, regularPhrases: updatedPrompts })
    } else {
      // 添加到全局 Quick Phrases
      await QuickPhraseService.add(formData)
    }
    setIsModalOpen(false)
    setFormData({ title: '', content: '', location: 'global' })
    if (formData.location === 'assistant') {
      await loadQuickListPhrases(updatedPrompts)
      return
    }
    await loadQuickListPhrases()
  }

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = quickPhrasesList.map((phrase, index) => ({
      label: phrase.title,
      description: phrase.content,
      icon: index < (assistant.regularPhrases?.length || 0) ? <BotMessageSquare /> : <Zap />,
      action: () => handlePhraseSelect(phrase)
    }))

    newList.push({
      label: t('settings.quickPhrase.add') + '...',
      icon: <Plus />,
      action: () => setIsModalOpen(true)
    })
    return newList
  }, [quickPhrasesList, t, handlePhraseSelect, assistant])

  const quickPanelOpenOptions = useMemo<QuickPanelOpenOptions>(
    () => ({
      title: t('settings.quickPhrase.title'),
      list: phraseItems,
      symbol: QuickPanelReservedSymbol.QuickPhrases
    }),
    [phraseItems, t]
  )

  const openQuickPanel = useCallback(() => {
    quickPanelHook.open(quickPanelOpenOptions)
  }, [quickPanelHook, quickPanelOpenOptions])

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
        label: t('settings.quickPhrase.title'),
        description: '',
        icon: <Zap />,
        isMenu: true,
        action: () => openQuickPanel()
      }
    ])

    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.QuickPhrases, () => openQuickPanel())

    return () => {
      disposeRootMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, quickPanel, t])

  return (
    <>
      <Tooltip placement="top" title={t('settings.quickPhrase.title')} mouseLeaveDelay={0} arrow>
        <ActionIconButton onClick={handleOpenQuickPanel}>
          <Zap size={18} />
        </ActionIconButton>
      </Tooltip>

      <Modal
        title={t('settings.quickPhrase.add')}
        open={isModalOpen}
        onOk={handleModalOk}
        maskClosable={false}
        onCancel={() => {
          setIsModalOpen(false)
          setFormData({ title: '', content: '', location: 'global' })
        }}
        width={520}
        transitionName="animation-move-down"
        centered>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Label>{t('settings.quickPhrase.titleLabel')}</Label>
            <Input
              placeholder={t('settings.quickPhrase.titlePlaceholder')}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div>
            <Label>{t('settings.quickPhrase.contentLabel')}</Label>
            <Input.TextArea
              placeholder={t('settings.quickPhrase.contentPlaceholder')}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={6}
              style={{ resize: 'none' }}
            />
          </div>
          <div>
            <Label>{t('settings.quickPhrase.locationLabel', '添加位置')}</Label>
            <Radio.Group
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}>
              <Radio value="global">
                <Zap size={20} style={{ paddingRight: '4px', verticalAlign: 'middle', paddingBottom: '3px' }} />
                {t('settings.quickPhrase.global', '全局快速短语')}
              </Radio>
              <Radio value="assistant">
                <BotMessageSquare
                  size={20}
                  style={{ paddingRight: '4px', verticalAlign: 'middle', paddingBottom: '3px' }}
                />
                {t('settings.quickPhrase.assistant', '助手提示词')}
              </Radio>
            </Radio.Group>
          </div>
        </Space>
      </Modal>
    </>
  )
}

const Label = styled.div`
  font-size: 14px;
  color: var(--color-text);
  margin-bottom: 8px;
`

export default memo(QuickPhrasesButton)
