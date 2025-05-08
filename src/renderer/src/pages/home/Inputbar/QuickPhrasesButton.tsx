import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem, QuickPanelOpenOptions } from '@renderer/components/QuickPanel/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import QuickPhraseService from '@renderer/services/QuickPhraseService'
import { useAppSelector } from '@renderer/store'
import { QuickPhrase } from '@renderer/types'
import { Tooltip } from 'antd'
import { Plus, Zap, BotMessageSquare } from 'lucide-react'
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Assistant } from '@renderer/types'

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
  const [quickPhrasesList, setQuickPhrasesList] = useState<QuickPhrase[]>([])
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const navigate = useNavigate()
  const activeAssistantId = useAppSelector(
    (state) =>
      state.assistants.assistants.find((a) => a.id === assistantObj.id)?.id || state.assistants.defaultAssistant.id
  )
  const { assistant } = useAssistant(activeAssistantId)

  useEffect(() => {
    const loadQuickListPhrases = async () => {
      const phrases = await QuickPhraseService.getAll()
      const assistantPrompts = assistant.regularPrompts || []
      setQuickPhrasesList([...assistantPrompts, ...phrases])
    }
    loadQuickListPhrases()
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

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = quickPhrasesList.map((phrase, index) => ({
      label: phrase.title,
      description: phrase.content,
      icon: index < (assistant.regularPrompts?.length || 0) ? <BotMessageSquare /> : <Zap />,
      action: () => handlePhraseSelect(phrase)
    }))

    newList.push({
      label: t('settings.quickPhrase.add') + '...',
      icon: <Plus />,
      action: () => navigate('/settings/quickPhrase')
    })
    return newList
  }, [quickPhrasesList, t, handlePhraseSelect, navigate, assistant])

  const quickPanelOpenOptions = useMemo<QuickPanelOpenOptions>(
    () => ({
      title: t('settings.quickPhrase.title'),
      list: phraseItems,
      symbol: 'quick-phrases'
    }),
    [phraseItems, t]
  )

  const openQuickPanel = useCallback(() => {
    quickPanel.open(quickPanelOpenOptions)
  }, [quickPanel, quickPanelOpenOptions])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === 'quick-phrases') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip placement="top" title={t('settings.quickPhrase.title')} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <Zap size={18} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(QuickPhrasesButton)
