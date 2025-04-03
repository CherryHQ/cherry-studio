import { ExportOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
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
  ToolbarButton: any
}

const QuickPhrasesButton = ({ ref, setInputValue, ToolbarButton }: Props) => {
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
      setInputValue((prev) => {
        const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement

        const cursorPosition = textArea.selectionStart
        const selectionEnd = textArea.selectionEnd
        const hasSelection = cursorPosition !== selectionEnd

        // 查找最近的 / 符号位置
        const lastSlashIndex = prev.lastIndexOf('/', cursorPosition)
        const shouldReplaceSlash = lastSlashIndex !== -1 && lastSlashIndex < cursorPosition

        let newText = prev
        let selectionStart = cursorPosition
        let selectionEndPosition = cursorPosition + phrase.content.length

        if (hasSelection) {
          // 有选中内容时，直接替换选中内容
          newText = `${prev.slice(0, cursorPosition)}${phrase.content}${prev.slice(selectionEnd)}`
          selectionStart = cursorPosition
          selectionEndPosition = cursorPosition + phrase.content.length
        } else if (shouldReplaceSlash) {
          // 没有选中内容时，替换从 / 到光标位置的内容
          newText = `${prev.slice(0, lastSlashIndex)}${phrase.content}${prev.slice(cursorPosition)}`
          selectionStart = lastSlashIndex
          selectionEndPosition = lastSlashIndex + phrase.content.length
        } else {
          // 既没有选中内容也没有 / 时，在光标位置插入
          newText = `${prev.slice(0, cursorPosition)}${phrase.content}${prev.slice(cursorPosition)}`
          selectionStart = cursorPosition
          selectionEndPosition = cursorPosition + phrase.content.length
        }

        setTimeout(() => {
          textArea.focus()
          // 设置选中范围
          textArea.setSelectionRange(selectionStart, selectionEndPosition)
        }, 0)
        return newText
      })
    },
    [setInputValue]
  )

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = quickPhrasesList.map((phrase, index) => ({
      label: phrase.title,
      description: phrase.content,
      icon: <ThunderboltOutlined />,
      disabled: index === 4,
      action: () => handlePhraseSelect(phrase)
    }))
    newList.push({
      label: t('settings.quickPhrase.add'),
      suffix: <ExportOutlined />,
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
