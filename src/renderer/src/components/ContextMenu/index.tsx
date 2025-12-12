import { Dropdown } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ContextMenuProps {
  children: React.ReactNode
}

/**
 * Extract text content from selection, filtering out line numbers in code viewers.
 * Preserves all content including plain text and code blocks, only removing line numbers.
 * This ensures right-click copy in code blocks doesn't include line numbers while preserving indentation.
 */
function extractSelectedText(selection: Selection): string {
  // Validate selection
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return ''
  }

  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()

  // Check if the selection contains code viewer elements
  const hasLineNumbers = fragment.querySelectorAll('.line-number').length > 0

  // If no line numbers, return the original text (preserves formatting)
  if (!hasLineNumbers) {
    return selection.toString()
  }

  // Remove all line number elements
  fragment.querySelectorAll('.line-number').forEach((el) => el.remove())

  // Handle all content (text + code blocks) using TreeWalker to preserve order
  // This approach handles mixed content correctly
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ALL, null)

  let result = ''
  let node = walker.nextNode()

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Preserve text content including whitespace
      result += node.textContent
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element

      // Add newline after block elements and code lines to preserve structure
      if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) {
        result += '\n'
      } else if (element.classList.contains('line')) {
        // Add newline after code lines to preserve code structure
        result += '\n'
      }
    }

    node = walker.nextNode()
  }

  // Clean up excessive newlines but preserve code structure
  //return result.replace(/\n{3,}/g, '\n\n').trim()
  return result.trim()
}

// FIXME: Why does this component name look like a generic component but is not customizable at all?
const ContextMenu: React.FC<ContextMenuProps> = ({ children }) => {
  const { t } = useTranslation()
  const [selectedText, setSelectedText] = useState<string | undefined>(undefined)

  const contextMenuItems = useMemo(() => {
    if (!selectedText) return []

    return [
      {
        key: 'copy',
        label: t('common.copy'),
        onClick: () => {
          if (selectedText) {
            navigator.clipboard
              .writeText(selectedText)
              .then(() => {
                window.toast.success(t('message.copied'))
              })
              .catch(() => {
                window.toast.error(t('message.copy.failed'))
              })
          }
        }
      },
      {
        key: 'quote',
        label: t('chat.message.quote'),
        onClick: () => {
          if (selectedText) {
            window.api?.quoteToMainWindow(selectedText)
          }
        }
      }
    ]
  }, [selectedText, t])

  const onOpenChange = (open: boolean) => {
    if (open) {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setSelectedText(undefined)
        return
      }
      setSelectedText(extractSelectedText(selection) || undefined)
    }
  }

  return (
    <Dropdown onOpenChange={onOpenChange} menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
      {children}
    </Dropdown>
  )
}

export default ContextMenu
