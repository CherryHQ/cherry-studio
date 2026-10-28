import { combineTransactionSteps, type Editor, getChangedRanges, mergeAttributes } from '@tiptap/core'
import { InlineMath } from '@tiptap/extension-mathematics'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import type { EditorState } from '@tiptap/pm/state'
import { AllSelection, NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { COMPOSER_INLINE_MATH_NODE_NAME, serializeComposerMath, transformComposerMathTextRun } from './composerMath'
import { ComposerMathNodeView } from './ComposerMathNodeView'

const COMPOSER_MATH_META = 'composerMath'

function transformDocument(state: EditorState, enabled: boolean, ranges: readonly { from: number; to: number }[]) {
  const replacements: { from: number; to: number; latex: string; asText?: boolean }[] = []
  state.doc.descendants((node, position) => {
    if (node.type.name === COMPOSER_INLINE_MATH_NODE_NAME) {
      const affected = ranges.some((range) => range.from <= position + node.nodeSize + 1 && range.to >= position - 1)
      if (!enabled || affected) {
        const source = serializeComposerMath(node.attrs.latex)
        const before = state.doc.resolve(position).nodeBefore
        const after = state.doc.resolve(position + node.nodeSize).nodeAfter
        const prev = before?.isText ? (before.text?.match(/\$?\\*$/)?.[0] ?? '') : ''
        const next =
          after?.isText && !replacements.some((replacement) => replacement.from === position + node.nodeSize)
            ? (after.text?.[0] ?? '')
            : ''
        const from = prev.length
        const to = from + source.length
        const segments = enabled
          ? transformComposerMathTextRun(prev + source + next, [{ from, to }]).filter(
              (segment) => segment.type === 'inlineMath'
            )
          : []
        if (
          segments.length !== 1 ||
          segments[0].from !== from ||
          segments[0].to !== to ||
          segments[0].latex !== node.attrs.latex
        ) {
          replacements.push({ from: position, to: position + node.nodeSize, latex: node.attrs.latex, asText: true })
        }
      }
    }
    if (!enabled || node.type.name !== 'paragraph') return

    let runText = ''
    let runStart = position + 1
    const flush = () => {
      const localRanges = ranges
        .filter((range) => range.from <= runStart + runText.length && range.to >= runStart)
        .map((range) => ({
          from: Math.max(0, range.from - runStart),
          to: Math.min(runText.length, range.to - runStart)
        }))
      if (!runText || !localRanges.length) return
      for (const segment of transformComposerMathTextRun(runText, localRanges)) {
        if (segment.type === 'inlineMath') {
          replacements.push({ from: runStart + segment.from, to: runStart + segment.to, latex: segment.latex })
        }
      }
      runText = ''
    }
    node.forEach((child, offset) => {
      if (child.isText) {
        if (!runText) runStart = position + 1 + offset
        runText += child.text
      } else {
        flush()
        runText = ''
      }
    })
    flush()
  })

  if (!replacements.length) return null
  const tr = state.tr.setMeta(COMPOSER_MATH_META, 'derived')
  for (const { from, to, latex, asText } of replacements.toSorted((a, b) => b.from - a.from)) {
    tr.replaceWith(
      from,
      to,
      asText ? state.schema.text(serializeComposerMath(latex)) : state.schema.nodes.inlineMath.create({ latex })
    )
  }
  if (
    state.selection instanceof NodeSelection &&
    replacements.some((replacement) => replacement.asText && replacement.from === state.selection.from)
  ) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(state.selection.to))))
  }
  if (!enabled) tr.setMeta('addToHistory', false)
  return tr
}

/** Refresh the derived display when the preference changes without replacing the editor. */
export function synchronizeComposerMath(editor: Editor, enabled: boolean) {
  if (editor.isDestroyed || editor.view.composing) return
  const tr = transformDocument(editor.state, enabled, [{ from: 0, to: editor.state.doc.content.size }])
  if (tr) editor.view.dispatch(tr.setMeta('addToHistory', false))
}

function createComposerMathPlugin(editor: Editor, enabled: () => boolean) {
  let pendingComposition = false
  let wasEnabled = enabled()
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      if (editor.view.composing) {
        pendingComposition = true
        return null
      }
      if (transactions.some((tr) => !tr.docChanged)) return null
      const active = enabled()
      const scanAll = pendingComposition || active !== wasEnabled
      pendingComposition = false
      wasEnabled = active
      if (!active) return transformDocument(newState, false, [])
      if (transactions.some((tr) => tr.getMeta(COMPOSER_MATH_META) === 'derived' || isHistoryTransaction(tr)))
        return null
      const ranges = scanAll
        ? [{ from: 0, to: newState.doc.content.size }]
        : getChangedRanges(combineTransactionSteps(oldState.doc, [...transactions])).map((range) => range.newRange)
      return transformDocument(newState, true, ranges)
    }
  })
}

function deleteMathRange(editor: Editor, from: number, to: number) {
  editor.view.dispatch(closeHistory(editor.state.tr).delete(from, to))
  editor.view.dispatch(closeHistory(editor.state.tr))
  return true
}

function deleteAdjacentMath(editor: Editor, direction: -1 | 1) {
  const { selection } = editor.state
  if (editor.view.composing || !editor.isEditable || selection instanceof AllSelection) return false
  if (selection instanceof NodeSelection && selection.node.type.name === COMPOSER_INLINE_MATH_NODE_NAME) {
    return deleteMathRange(editor, selection.from, selection.to)
  }
  if (!selection.empty) return false
  const node = direction < 0 ? selection.$from.nodeBefore : selection.$from.nodeAfter
  if (node?.type.name !== COMPOSER_INLINE_MATH_NODE_NAME) return false
  const from = direction < 0 ? selection.from - node.nodeSize : selection.from
  return deleteMathRange(editor, from, from + node.nodeSize)
}

const ComposerInlineMath = InlineMath.extend<{ enabled: () => boolean }>({
  priority: 1000,
  selectable: true,
  addOptions() {
    return { ...this.parent?.(), enabled: () => false }
  },
  addInputRules() {
    return []
  },
  addCommands() {
    return {}
  },
  renderText({ node }) {
    return serializeComposerMath(node.attrs.latex)
  },
  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]', getAttrs: () => (this.options.enabled() ? null : false) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math', contenteditable: 'false' }),
      serializeComposerMath(node.attrs.latex)
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComposerMathNodeView)
  },
  addKeyboardShortcuts() {
    // Core tries undoInputRule before deleteSelection/joinBackward/selectNodeBackward;
    // atom alone cannot guarantee a single keypress removes the whole formula.
    return {
      Backspace: () => deleteAdjacentMath(this.editor, -1),
      Delete: () => deleteAdjacentMath(this.editor, 1)
    }
  },
  addProseMirrorPlugins() {
    return [createComposerMathPlugin(this.editor, this.options.enabled)]
  },
  onCreate() {
    synchronizeComposerMath(this.editor, this.options.enabled())
  }
})

export function configureComposerInlineMath(enabled: () => boolean) {
  return ComposerInlineMath.configure({ enabled })
}
