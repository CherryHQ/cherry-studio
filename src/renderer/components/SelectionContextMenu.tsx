import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { isHttpUrl } from '@shared/utils/url'

const logger = loggerService.withContext('SelectionContextMenu')

const TEXT_BLOCK_TAGS = new Set(['BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE', 'TR'])

interface SelectionContextMenuProps {
  children: React.ReactNode
  openBrowserUrl?: (url: string) => void
}

/**
 * Extract text content from a Selection, restoring KaTeX formulas to their TeX source and
 * filtering out line numbers in code viewers.
 */
function extractSelectedText(selection: Selection): string {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return ''
  }

  const range = selection.getRangeAt(0).cloneRange()
  const startElement =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const endElement = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const startKatex = startElement?.closest('.katex')
  const endKatex = endElement?.closest('.katex')

  if (startKatex) range.setStartBefore(startKatex)
  if (endKatex) range.setEndAfter(endKatex)

  const fragment = range.cloneContents()
  const hasLineNumbers = fragment.querySelectorAll('.line-number').length > 0
  const katexMathMlElements = fragment.querySelectorAll('.katex-mathml')
  const hasKatex = katexMathMlElements.length > 0

  if (!hasLineNumbers && !hasKatex) {
    return selection.toString()
  }

  fragment.querySelectorAll('.line-number').forEach((el) => el.remove())
  fragment.querySelectorAll('.katex-mathml + .katex-html').forEach((el) => el.remove())
  katexMathMlElements.forEach((element) => {
    const texSource = element.querySelector('annotation')?.textContent
    if (texSource !== null && texSource !== undefined) {
      element.replaceWith(document.createTextNode(texSource))
    }
  })

  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null)

  let result = ''
  let node = walker.nextNode()

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      if (element.tagName === 'BR') {
        result += '\n'
      } else if (
        result.length > 0 &&
        !result.endsWith('\n') &&
        (TEXT_BLOCK_TAGS.has(element.tagName) || element.classList.contains('line'))
      ) {
        result += '\n'
      }
    }

    node = walker.nextNode()
  }

  return result
}

/**
 * Right-click actions for website links and selected text in conversation content.
 */
const SelectionContextMenu: React.FC<SelectionContextMenuProps> = ({ children, openBrowserUrl }) => {
  const { t } = useTranslation()
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

  const getExtraItems = useCallback(
    (event: React.MouseEvent): CommandContextMenuExtraItem[] => {
      const selection = window.getSelection()
      const selectedText = selection ? extractSelectedText(selection) : ''
      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest('a[href]')
      const href = anchor?.getAttribute('href')
      if (href && isHttpUrl(href)) {
        const selectedLinkText =
          selectedText && selection && anchor && selection.getRangeAt(0).intersectsNode(anchor) ? selectedText : ''
        const linkItems: CommandContextMenuExtraItem[] = [
          {
            type: 'item',
            id: 'link.openBrowser',
            label: t('common.link.open_browser'),
            onSelect: () => {
              if (openBrowserUrl) openBrowserUrl(href)
              else openRoute('/app/browser', { url: href })
            }
          },
          {
            type: 'item',
            id: 'link.openExternal',
            label: t('webview.navigation.open_external'),
            onSelect: () => {
              void ipcApi.request('system.shell.open_external_website', href).catch((error) => {
                logger.error('Failed to open external website', error as Error)
                toast.error(t('chat.artifacts.preview.openExternal.error.content'))
              })
            }
          },
          { type: 'separator' },
          {
            type: 'item',
            id: 'link.copy',
            label: t('common.link.copy'),
            onSelect: () => handleCopy(href)
          }
        ]
        return selectedLinkText ? [...getMenuItems(selectedLinkText), { type: 'separator' }, ...linkItems] : linkItems
      }

      return getMenuItems(selectedText)
    },
    [getMenuItems, handleCopy, openBrowserUrl, t]
  )

  return (
    <CommandContextMenu location="chat.message.context" getExtraItems={getExtraItems}>
      {children}
    </CommandContextMenu>
  )
}

export default SelectionContextMenu
