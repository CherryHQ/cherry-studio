import { loggerService } from '@logger'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { toast } from '@renderer/services/toast'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SelectionContextMenu')

interface SelectionContextMenuProps {
  children: React.ReactNode
}

/**
 * Extract text content from a Selection, filtering out line numbers in code viewers.
 * Preserves all content including plain text and code blocks, only removing line numbers.
 * This ensures right-click copy in code blocks doesn't include line numbers while preserving indentation.
 */
function extractSelectedText(selection: Selection): string {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return ''
  }

  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()

  const hasLineNumbers = fragment.querySelectorAll('.line-number').length > 0

  if (!hasLineNumbers) {
    return selection.toString()
  }

  fragment.querySelectorAll('.line-number').forEach((el) => el.remove())

  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null)

  let result = ''
  let node = walker.nextNode()

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) {
        result += '\n'
      } else if (element.classList.contains('line')) {
        result += '\n'
      }
    }

    node = walker.nextNode()
  }

  return result.startsWith('\n') ? result.slice(1) : result
}

/**
 * Right-click menu for selected text regions: copy the current selection or quote it
 * back to the main window. No selection means no selection-specific actions.
 */
const SelectionContextMenu: React.FC<SelectionContextMenuProps> = ({ children }) => {
  const { t } = useTranslation()
  const [selectedText, setSelectedText] = useState('')

  const getSelectedText = useCallback((): string => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return ''
    }
    return extractSelectedText(selection)
  }, [])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return
      setSelectedText(getSelectedText())
    },
    [getSelectedText]
  )

  const handleCopy = useCallback(
    (text: string) => {
      navigator.clipboard
        .writeText(text)
        .then(() => toast.success(t('message.copied')))
        .catch((error) => {
          logger.error('clipboard write failed', error as Error)
          toast.error(t('message.copy.failed'))
        })
    },
    [t]
  )

  const handleQuote = useCallback((text: string) => {
    void window.api.quoteToMainWindow(text)
  }, [])

  const getMenuItems = useCallback(
    (text: string): CommandContextMenuExtraItem[] => {
      if (text.length === 0) return []

      return [
        {
          type: 'item',
          id: 'selection.copy',
          label: t('common.copy'),
          onSelect: () => handleCopy(text)
        },
        {
          type: 'item',
          id: 'selection.quote',
          label: t('chat.message.quote'),
          onSelect: () => handleQuote(text)
        }
      ]
    },
    [handleCopy, handleQuote, t]
  )

  const extraItems = useMemo(() => getMenuItems(selectedText), [getMenuItems, selectedText])
  const getExtraItems = useCallback(() => {
    const text = getSelectedText()
    setSelectedText(text)
    return getMenuItems(text)
  }, [getMenuItems, getSelectedText])

  return (
    <CommandContextMenu
      location="chat.message.context"
      extraItems={extraItems}
      getExtraItems={getExtraItems}
      onOpenChange={handleOpenChange}>
      {children}
    </CommandContextMenu>
  )
}

export default SelectionContextMenu
