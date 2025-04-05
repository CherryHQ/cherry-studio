import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem, QuickPanelOpenOptions } from '@renderer/components/QuickPanel/types'
import QuickPhraseService from '@renderer/services/QuickPhraseService'
import { QuickPhrase } from '@renderer/types'
import { Tooltip } from 'antd'
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export interface QuickPhrasesButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<QuickPhrasesButtonRef | null>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
  ToolbarButton: any
}

const QuickPhrasesButton = ({ ref, setInputValue, resizeTextArea, ToolbarButton }: Props) => {
  const [quickPhrasesList, setQuickPhrasesList] = useState<QuickPhrase[]>([])
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()

  const navigate = useNavigate()

  useEffect(() => {
    const loadQuickListPhrases = async () => {
      const phrases = await QuickPhraseService.getAll()
      setQuickPhrasesList(phrases.reverse())
    }
    loadQuickListPhrases()
  }, [])

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
    const newList: QuickPanelListItem[] = quickPhrasesList.map((phrase) => ({
      label: phrase.title,
      description: phrase.content,
      icon: <ThunderboltOutlined />,
      action: () => handlePhraseSelect(phrase)
    }))
    newList.push({
      label: t('settings.quickPhrase.add') + '...',
      icon: <PlusOutlined />,
      action: () => navigate('/settings/quickPhrase')
    })
    return newList
  }, [quickPhrasesList, t, handlePhraseSelect, navigate])

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
        <ThunderboltOutlined />
      </ToolbarButton>
    </Tooltip>
  )
}

export default memo(QuickPhrasesButton)
