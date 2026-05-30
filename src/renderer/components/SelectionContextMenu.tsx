import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useState } from 'react'
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

  return result.trim()
}

/**
 * Right-click menu for any text region: copy the current selection or quote it
 * back to the main window. Items are disabled when there is no live selection
 * so a non-text right-click still surfaces the menu (discoverability) but the
 * actions remain inert until the user selects something.
 */
const SelectionContextMenu: React.FC<SelectionContextMenuProps> = ({ children }) => {
  const { t } = useTranslation()
  const [selectedText, setSelectedText] = useState('')

  const handleOpenChange = (open: boolean) => {
    if (!open) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectedText('')
      return
    }
    setSelectedText(extractSelectedText(selection))
  }

  const handleCopy = () => {
    navigator.clipboard
      .writeText(selectedText)
      .then(() => window.toast.success(t('message.copied')))
      .catch((error) => {
        logger.error('clipboard write failed', error as Error)
        window.toast.error(t('message.copy.failed'))
      })
  }

  const handleQuote = () => {
    void window.api.quoteToMainWindow(selectedText)
  }

  const hasSelection = selectedText.length > 0

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!hasSelection} onSelect={handleCopy}>
          {t('common.copy')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasSelection} onSelect={handleQuote}>
          {t('chat.message.quote')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default SelectionContextMenu
