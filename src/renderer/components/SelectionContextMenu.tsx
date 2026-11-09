import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { readSideChatSelection } from '@renderer/utils/sideChatSelection'
import { isHttpUrl } from '@shared/utils/url'

import { TextSelectionToolbar } from './TextSelectionToolbar'

const logger = loggerService.withContext('SelectionContextMenu')

const MARKDOWN_FENCE_LINE = /^(?:`{3,}[^`]*|~{3,}.*)$/

const TEXT_BLOCK_TAGS = new Set(['BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE', 'TR'])

interface SelectionContextMenuProps {
  openSideChat?: (messageId: string, selection?: string) => void
  children: React.ReactNode
  openBrowserUrl?: (url: string) => void
}

/**
 * Extract text content from a Selection, restoring KaTeX formulas to their TeX source and
 * filtering out line numbers in code viewers.
 */
function extractSelectedText(selection: Selection, mathOptions?: { singleDollar: boolean }): string {
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
  // Literal dollars anywhere in the selection can pair with generated math fences.
  const allowDollarFences = mathOptions?.singleDollar && !fragment.textContent?.includes('$')
  const inlineMathSources = new Map<Node, string>()
  katexMathMlElements.forEach((element) => {
    const texSource = element.querySelector('annotation')?.textContent
    if (texSource !== null && texSource !== undefined) {
      const textNode = document.createTextNode(texSource)
      if (mathOptions) {
        // MathML retains display mode even when the selection excludes the outer KaTeX wrapper.
        if (element.querySelector('math[display="block"]')) {
          textNode.textContent = `\n$$\n${texSource}\n$$\n`
        } else {
          inlineMathSources.set(textNode, texSource)
        }
      }
      element.replaceWith(textNode)
    }
  })

  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null)

  let result = ''
  let node = walker.nextNode()

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const texSource = inlineMathSources.get(node)
      if (texSource !== undefined) {
        // Adjacent dollar fences would merge separate formulas.
        const useDollars = allowDollarFences && !result.endsWith('$')
        result += useDollars ? `$${texSource}$` : `\\(${texSource}\\)`
      } else {
        result += node.textContent
      }
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
 * Context menu and automatic toolbar actions for selected conversation content.
 */
const SelectionContextMenu: React.FC<SelectionContextMenuProps> = ({ children, openBrowserUrl, openSideChat }) => {
  const { t } = useTranslation()
  const [mathEnableSingleDollar] = usePreference('chat.message.math.single_dollar')
  const [notesPath] = usePreference('feature.notes.path')
  const savingNote = useRef(false)
  const [isSavingNote, setIsSavingNote] = useState(false)
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

  const handleSaveToNotes = useCallback(
    async (text: string) => {
      if (!text.trim() || savingNote.current) return
      savingNote.current = true
      setIsSavingNote(true)
      try {
        const { exportContentToNotes } = await import('@renderer/services/ExportService')
        const title = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line && !MARKDOWN_FENCE_LINE.test(line))
        await exportContentToNotes(title?.slice(0, 50) || t('notes.untitled_note'), text, notesPath)
      } catch (error) {
        // The Notes exporter owns the write-failure toast.
        logger.error('Failed to save selection to Notes', error as Error)
      } finally {
        savingNote.current = false
        setIsSavingNote(false)
      }
    },
    [notesPath, t]
  )

  const sideChatAction = useCallback(
    (selection: Selection) => {
      const source = readSideChatSelection(selection)
      if (!source) return
      if (!source.selection) toast.info(t('side_chat.selection_fallback'))
      openSideChat?.(source.messageId, source.selection)
    },
    [openSideChat, t]
  )

  const getMenuItems = useCallback(
    (text: string, quoteText: string, canSaveSelection: boolean): CommandContextMenuExtraItem[] => {
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
          onSelect: () => handleQuote(quoteText)
        },
        ...(canSaveSelection
          ? [
              {
                type: 'item' as const,
                id: 'selection.save-notes',
                label: t('notes.save'),
                enabled: !isSavingNote && !!quoteText.trim(),
                onSelect: () => void handleSaveToNotes(quoteText)
              }
            ]
          : [])
      ]
    },
    [handleCopy, handleQuote, handleSaveToNotes, isSavingNote, t]
  )

  const getExtraItems = useCallback(
    (event: React.MouseEvent): CommandContextMenuExtraItem[] => {
      const selection = window.getSelection()
      const selectedText = selection ? extractSelectedText(selection) : ''
      const quoteText = selection ? extractSelectedText(selection, { singleDollar: mathEnableSingleDollar }) : ''
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      const canSaveSelection =
        !!range &&
        [range.startContainer, range.endContainer].every((node) => {
          const element = node instanceof Element ? node : node.parentElement
          return (
            element &&
            event.currentTarget.contains(element) &&
            !element.closest(
              'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
            )
          )
        })
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
        return selectedLinkText
          ? [...getMenuItems(selectedLinkText, quoteText, canSaveSelection), { type: 'separator' }, ...linkItems]
          : linkItems
      }

      const source = selection && openSideChat ? readSideChatSelection(selection) : null
      return [
        ...getMenuItems(selectedText, quoteText, canSaveSelection),
        ...(source
          ? [
              {
                type: 'item' as const,
                id: 'selection.side-chat',
                label: t('side_chat.create'),
                onSelect: () => {
                  if (!source.selection) toast.info(t('side_chat.selection_fallback'))
                  openSideChat?.(source.messageId, source.selection)
                }
              }
            ]
          : [])
      ]
    },
    [getMenuItems, handleCopy, mathEnableSingleDollar, openBrowserUrl, openSideChat, t]
  )

  return (
    <TextSelectionToolbar
      onSideChat={openSideChat ? sideChatAction : undefined}
      canSideChat={(selection) => readSideChatSelection(selection) !== null}
      onCopy={(selection) => handleCopy(extractSelectedText(selection))}
      onQuote={(selection) => handleQuote(extractSelectedText(selection, { singleDollar: mathEnableSingleDollar }))}
      onSaveToNotes={(selection) =>
        void handleSaveToNotes(extractSelectedText(selection, { singleDollar: mathEnableSingleDollar }))
      }
      isSavingNote={isSavingNote}>
      <CommandContextMenu location="chat.message.context" getExtraItems={getExtraItems}>
        {children}
      </CommandContextMenu>
    </TextSelectionToolbar>
  )
}

export default SelectionContextMenu
