import { combineTransactionSteps, type Editor, getChangedRanges, mergeAttributes } from '@tiptap/core'
import { InlineMath } from '@tiptap/extension-mathematics'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import type { EditorState } from '@tiptap/pm/state'
import { AllSelection, NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'
import { StepMap } from '@tiptap/pm/transform'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { COMPOSER_INLINE_MATH_NODE_NAME, serializeComposerMath, transformComposerMathTextRun } from './composerMath'
import { ComposerMathNodeView } from './ComposerMathNodeView'

const COMPOSER_MATH_META = 'composerMath'

function transformDocument(state: EditorState, enabled: boolean, ranges: readonly { from: number; to: number }[]) {
  const expansions: { from: number; to: number; latex: string }[] = []
  const insertions: { runStart: number; from: number; to: number; latex: string }[] = []
  state.doc.descendants((node, position) => {
    if (node.type.name !== 'paragraph') return

    let runText = ''
    let runStart = position + 1
    let runEnd = runStart
    let atoms: { from: number; to: number; docFrom: number; docTo: number; latex: string }[] = []
    const flush = () => {
      const changedRanges = ranges.filter((range) => range.from <= runEnd && range.to >= runStart)
      if (runText && (!enabled || changedRanges.length)) {
        const sourceMap = new StepMap(
          atoms.flatMap((atom) => [atom.from, atom.to - atom.from, atom.docTo - atom.docFrom])
        )
        const toSource = sourceMap.invert()
        const localRanges = changedRanges.map((range) => {
          const from = toSource.map(Math.max(runStart, range.from) - runStart)
          let to = toSource.map(Math.min(runEnd, range.to) - runStart)
          while (runText[to] === '\\') to += 1
          return { from, to }
        })
        const segments = enabled
          ? transformComposerMathTextRun(runText, [...localRanges, ...atoms]).filter(
              (segment) => segment.type === 'inlineMath'
            )
          : []
        const matches = (atom: (typeof atoms)[number], segment: (typeof segments)[number]) =>
          atom.from === segment.from && atom.to === segment.to && atom.latex === segment.latex
        const retained = atoms.filter((atom) => segments.some((segment) => matches(atom, segment)))
        const retainedMap = new StepMap(
          retained.flatMap((atom) => [atom.from, atom.to - atom.from, atom.docTo - atom.docFrom])
        )
        for (const atom of atoms) {
          if (!retained.includes(atom)) expansions.push({ from: atom.docFrom, to: atom.docTo, latex: atom.latex })
        }
        for (const segment of segments) {
          if (!atoms.some((atom) => matches(atom, segment))) {
            insertions.push({
              runStart,
              from: retainedMap.map(segment.from),
              to: retainedMap.map(segment.to),
              latex: segment.latex
            })
          }
        }
      }
      runText = ''
      atoms = []
    }
    node.forEach((child, offset) => {
      if (child.isText || child.type.name === COMPOSER_INLINE_MATH_NODE_NAME) {
        const docFrom = position + 1 + offset
        if (!runText) runStart = docFrom
        runEnd = docFrom + child.nodeSize
        if (child.isText) {
          runText += child.text
        } else {
          const from = runText.length
          runText += serializeComposerMath(child.attrs.latex)
          atoms.push({ from, to: runText.length, docFrom, docTo: runEnd, latex: child.attrs.latex })
        }
      } else {
        flush()
      }
    })
    flush()
    return false
  })

  if (!expansions.length && !insertions.length) return null
  const tr = state.tr.setMeta(COMPOSER_MATH_META, 'derived')
  for (const { from, to, latex } of expansions.toSorted((a, b) => b.from - a.from)) {
    tr.replaceWith(from, to, state.schema.text(serializeComposerMath(latex)))
  }
  // New spans can use a delimiter inside an expanded atom, so map them after expansion.
  const mappedInsertions = insertions.map(({ runStart, from, to, latex }) => {
    const start = tr.mapping.map(runStart, -1)
    return { from: start + from, to: start + to, latex }
  })
  for (const { from, to, latex } of mappedInsertions.toSorted((a, b) => b.from - a.from)) {
    tr.replaceWith(from, to, state.schema.nodes.inlineMath.create({ latex }))
  }
  if (
    state.selection instanceof NodeSelection &&
    expansions.some((expansion) => expansion.from === state.selection.from)
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
