import type { QuickPanelListItem } from '@renderer/components/chat/composer/panelEngine'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import type { ComposerSuggestionItem } from './suggestionExtension'

export const ROOT_QUICK_PANEL_ALLOWED_PREFIXES = [' ', '\n', '\t']

export function hasComposerQuickPanelTriggerBoundary(textBeforeTrigger: string) {
  if (textBeforeTrigger.length === 0) return true
  return /\s/.test(textBeforeTrigger.slice(-1))
}

export function getComposerInputLeafText(node: ProseMirrorNode) {
  if (node.type.name === 'hardBreak') return '\n'
  return ''
}

export function getComposerInputText(editor: Editor) {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', getComposerInputLeafText)
}

export function getComposerTextOffset(editor: Editor, position: number) {
  return editor.state.doc.textBetween(0, position, '\n', getComposerInputLeafText).length
}

export function getComposerCursorTextOffset(editor: Editor) {
  return getComposerTextOffset(editor, editor.state.selection.from)
}

export function getComposerSuggestionTriggerContext(
  editor: Editor,
  options: {
    range: { from: number }
    query: string
    text?: string
    triggerChar: string
  }
) {
  const textBeforeTrigger = editor.state.doc.textBetween(0, options.range.from, '\n', getComposerInputLeafText)
  const queryAnchor = textBeforeTrigger.length
  const triggerText = options.text || `${options.triggerChar}${options.query}`
  const cursorOffset = editor.state.selection?.from
    ? getComposerCursorTextOffset(editor)
    : queryAnchor + triggerText.length

  return {
    cursorOffset,
    queryAnchor,
    textBeforeTrigger,
    triggerText
  }
}

export function getComposerPositionAtTextOffset(editor: Editor, textOffset: number) {
  const targetOffset = Math.max(0, textOffset)
  let low = 0
  let high = editor.state.doc.content.size

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (getComposerTextOffset(editor, mid) < targetOffset) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return Math.max(1, Math.min(low, editor.state.doc.content.size))
}

export function createComposerSuggestionQuickPanelItem(
  item: ComposerSuggestionItem,
  options: {
    editor: Editor
    query: string
    range: { from: number; to: number }
  }
): QuickPanelListItem {
  return {
    id: item.id,
    label: item.label,
    description: item.description,
    icon: item.icon,
    suffix: item.suffix,
    filterText: item.filterText,
    isSelected: item.selected,
    isMenu: item.isMenu,
    disabled: item.disabled,
    action: () => {
      item.command({
        editor: options.editor,
        range: options.range,
        item,
        query: options.query
      })
    }
  }
}
