import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem } from '@renderer/components/QuickPanel/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import QuickPhraseService from '@renderer/services/QuickPhraseService'
import { useAppSelector } from '@renderer/store'
import { Assistant, QuickPhrase } from '@renderer/types'
import { Input, Modal, Radio, Space, Tooltip } from 'antd'
import { BotMessageSquare, Plus, Zap } from 'lucide-react'
import { memo, useCallback, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface QuickPhrasesButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<QuickPhrasesButtonRef | null>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  ToolbarButton: any
  assistantObj: Assistant
}

const QuickPhrasesButton = ({ ref, setInputValue, resizeTextArea, ToolbarButton, assistantObj }: Props) => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState({ title: '', content: '', location: 'global' })
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const activeAssistantId = useAppSelector(
    (state) =>
      state.assistants.assistants.find((a) => a.id === assistantObj.id)?.id || state.assistants.defaultAssistant.id
  )
  const { assistant, updateAssistant } = useAssistant(activeAssistantId)

  // FIXME: 在 useEffect 中触发会报错，看起来它在消息发送过程的某个 transaction 中被意外调用。
  // 目前没有找到确切路径，先把 useEffect 移除，把它延迟到 quickpanel 打开时再触发。
  const loadQuickListPhrases = useCallback(async (): Promise<QuickPhrase[]> => {
    const phrases = await QuickPhraseService.getAll()
    const assistantPrompts = assistant.regularPhrases || []
    return [...assistantPrompts, ...phrases]
  }, [assistant])

  const handlePhraseSelect = useCallback(
    (phrase: QuickPhrase) => {
      setTimeout(() => {
        setInputValue((prev) => {
          const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement
          const cursorPosition = textArea.selectionStart
          const selectionStart = cursorPosition
          const selectionEndPosition = cursorPosition + phrase.content.length
          const newText = prev.slice(0, cursorPosition) + phrase.content + prev.slice(cursorPosition)

          setTimeout(() => {
            textArea.focus()
            textArea.setSelectionRange(selectionStart, selectionEndPosition)
            resizeTextArea()
          }, 10)
          return newText
        })
      }, 10)
    },
    [setInputValue, resizeTextArea]
  )

  const handleModalOk = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    if (formData.location === 'assistant') {
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
      // 添加到助手的 regularPhrases
      updateAssistant({ ...assistant, regularPhrases: updatedPrompts })
    } else {
      // 添加到全局 Quick Phrases
      await QuickPhraseService.add(formData)
    }
    setIsModalOpen(false)
    setFormData({ title: '', content: '', location: 'global' })

    // Modal 出现时 quickpanel 应该会关闭，新的短语会在下次打开时显示。
    // 万一没有关闭，就在这里主动关闭它。
  }

  const openQuickPanel = useCallback(async () => {
    const quickPhrasesList = await loadQuickListPhrases()

    const phraseItems: QuickPanelListItem[] = quickPhrasesList.map((phrase, index) => ({
      label: phrase.title,
      description: phrase.content,
      icon: index < (assistant.regularPhrases?.length || 0) ? <BotMessageSquare /> : <Zap />,
      action: () => handlePhraseSelect(phrase)
    }))

    phraseItems.push({
      label: t('settings.quickPhrase.add') + '...',
      icon: <Plus />,
      action: () => setIsModalOpen(true)
    })

    quickPanel.open({
      title: t('settings.quickPhrase.title'),
      list: phraseItems,
      symbol: 'quick-phrases'
    })
  }, [assistant.regularPhrases?.length, handlePhraseSelect, loadQuickListPhrases, quickPanel, t])

  const handleOpenQuickPanel = useCallback(async () => {
    if (quickPanel.isVisible && quickPanel.symbol === 'quick-phrases') {
      quickPanel.close()
    } else {
      await openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <>
      <Tooltip placement="top" title={t('settings.quickPhrase.title')} arrow>
        <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
          <Zap size={18} />
        </ToolbarButton>
      </Tooltip>

      <Modal
        title={t('settings.quickPhrase.add')}
        open={isModalOpen}
        onOk={handleModalOk}
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
