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
  // First check if the selection contains code viewer elements
  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()
  const lineNumbers = fragment.querySelectorAll('.line-number')

  // If there are line numbers, we need to clean them up
  if (lineNumbers.length > 0) {
    // Get the raw selected text to preserve formatting
    const rawText = selection.toString()

    // Split into lines and filter out lines that are just line numbers
    const lines = rawText.split('\n')
    const cleanedLines = lines.filter((line) => {
      // Check if this line looks like a line number (digits at the start, optional whitespace)
      const lineNumberPattern = /^\s*\d+\s*$/
      return !lineNumberPattern.test(line)
    })

    // If we filtered out some lines, it's likely line numbers were included
    if (cleanedLines.length !== lines.length) {
      return cleanedLines.join('\n')
    }

    // If the pattern doesn't match, try to remove line numbers from the beginning of lines
    const cleanedText = rawText.replace(/^\s*\d+\s+/gm, '')

    // Only use cleaned text if it's different and has content
    if (cleanedText !== rawText && cleanedText.trim().length > 0) {
      return cleanedText
    }

    // Fallback to the original text
    return rawText
  }

  // No line numbers detected, return the original selection
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
