import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { BranchAnchor } from '@renderer/pages/home/Messages/BranchPanel'
import { type BlockContext, findBlockContext } from '@renderer/utils/branchAnchor/findBlockContext'
import { captureSelectionOffsets } from '@renderer/utils/branchAnchor/sourceHighlight'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SelectionContextMenu')

interface SelectionContextMenuProps {
  children: React.ReactNode
  /**
   * Optional callback fired when the user clicks "Ask about this" or
   * "Open as branch" on a resolvable selection (i.e. a single MainTextBlock).
   * When provided, this is how the BranchPanel host (e.g. Messages.tsx)
   * receives the anchor and opens its panel. When omitted, the menu still
   * surfaces those items but their handlers just log — preserves T-006C
   * behaviour for any non-host consumer (e.g. CitationsList).
   */
  onOpenBranchPanel?: (anchor: BranchAnchor) => void
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
 * Right-click menu for any text region. Always offers Copy / Quote on the
 * current selection; additionally, when the selection sits inside a single
 * **assistant** `MainTextBlock` (identified by `data-message-id` +
 * `data-block-id` + `data-message-role="assistant"` — established in T-006B),
 * surfaces the branch-anchor actions:
 *
 *   - Ask about this (针对此处提问)
 *   - Open as branch (展开为分支)
 *
 * User messages, error cards, and regions without the data-attributes only
 * surface Copy / Quote — branching from a user prompt or an error card has no
 * meaning in the conversation graph (branches fork from an assistant turn).
 *
 * The branch-anchor handlers are placeholders in T-006C — they log the
 * captured context. T-006D / T-006E wire them to the BranchPanel and
 * highlight overlay respectively.
 *
 * Items remain inert when there is no live selection (so a non-text
 * right-click still surfaces the menu for discoverability) and the branch
 * items additionally require a resolvable single-block context.
 */
const SelectionContextMenu: React.FC<SelectionContextMenuProps> = ({ children, onOpenBranchPanel }) => {
  const { t } = useTranslation()
  const [selectedText, setSelectedText] = useState('')
  const [blockContext, setBlockContext] = useState<BlockContext | null>(null)
  // S6': char offsets of the selection within its source block, captured
  // from the SAME range as blockContext so they stay consistent.
  const [selectionOffsets, setSelectionOffsets] = useState<{ start: number; end: number } | null>(null)

  const handleOpenChange = (open: boolean) => {
    if (!open) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectedText('')
      setBlockContext(null)
      setSelectionOffsets(null)
      return
    }
    const range = selection.getRangeAt(0)
    setSelectedText(extractSelectedText(selection))
    setBlockContext(findBlockContext(range))
    setSelectionOffsets(captureSelectionOffsets(range))
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

  // Hand the captured anchor to the host (e.g. Messages.tsx → Chat.tsx) so it
  // can open its BranchPane. Without a host callback, fall back to a
  // diagnostic log — useful for any SelectionContextMenu instance mounted
  // outside the chat scroll (CitationsList, etc.).
  const buildAnchor = (): BranchAnchor | null => {
    if (!blockContext) return null
    return {
      messageId: blockContext.messageId,
      blockId: blockContext.blockId,
      selectedText,
      // 0/0 when offsets weren't resolvable → S6' highlight resolves to
      // nothing rather than tinting the whole block.
      selectionStart: selectionOffsets?.start ?? 0,
      selectionEnd: selectionOffsets?.end ?? 0
    }
  }

  const emitAnchor = (anchor: BranchAnchor, logLabel: string) => {
    if (onOpenBranchPanel) {
      onOpenBranchPanel(anchor)
    } else {
      logger.debug(logLabel, anchor)
    }
  }

  const handleAskHere = () => {
    const anchor = buildAnchor()
    if (anchor) emitAnchor(anchor, 'branch-anchor: ask here')
  }

  const handleOpenAsBranch = () => {
    const anchor = buildAnchor()
    if (anchor) emitAnchor(anchor, 'branch-anchor: open as branch')
  }

  const hasSelection = selectedText.length > 0
  // Branch actions are only meaningful on assistant text — user messages and
  // error cards (which expose no data wrapper, so blockContext is null) keep
  // Copy / Quote only.
  const hasAnchor = hasSelection && blockContext !== null && blockContext.role === 'assistant'

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
        <ContextMenuItem disabled={!hasAnchor} onSelect={handleAskHere}>
          {t('chat.message.anchor.ask_here')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasAnchor} onSelect={handleOpenAsBranch}>
          {t('chat.message.anchor.open_as_branch')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default SelectionContextMenu
