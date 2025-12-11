import { Dropdown } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ContextMenuProps {
  children: React.ReactNode
}

/**
 * Extract text content from selection, filtering out line numbers in code viewers.
 * This ensures right-click copy in code blocks doesn't include line numbers.
 */
function extractSelectedText(selection: Selection): string {
  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()

  // Remove all line number elements from the selection
  const lineNumbers = fragment.querySelectorAll('.line-number')
  lineNumbers.forEach((el) => el.remove())

  // Get the remaining text content
  const result = fragment.textContent || ''

  // If we removed line numbers, return the cleaned text
  // Otherwise, return the original selection
  if (lineNumbers.length > 0) {
    return result
  }

  return selection.toString()
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
