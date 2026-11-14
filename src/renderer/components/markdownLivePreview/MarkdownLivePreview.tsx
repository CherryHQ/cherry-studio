import './markdownLivePreview.css'
import { Extension } from '@tiptap/core'
import { baseKeymap, splitBlock } from '@tiptap/pm/commands'
import { keymap } from '@tiptap/pm/keymap'
import { Fragment, Slice } from '@tiptap/pm/model'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Root } from 'hast'
import { createContext, Suspense, use, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Components } from 'streamdown'
import type { Plugin } from 'unified'

import { AppMarkdown } from '@renderer/components/markdown'

import { handleMarkdownCodeKey } from './codeBlockKeys'
import { createDocumentPreviewPlugin, type PreviewTarget } from './documentPreviewPlugin'
import { documentSource, previewSource, sourceDocument } from './documentSource'
import { ComposerMarkdownLivePreview } from './livePreviewPlugin'
import { handleMarkdownFormatKey } from './selectionFormatKeys'
import { ComposerDocument, ComposerHardBreak, ComposerParagraph, ComposerText, ComposerUndoRedo } from './sourceSchema'

const portalBlocks: Plugin<[], Root> = () => (tree) => {
  for (const node of tree.children) {
    if (node.type !== 'element' || !('dataFootnotes' in node.properties)) continue
    const list = node.children.find((child) => child.type === 'element' && child.tagName === 'ol')
    if (list?.type !== 'element') continue
    // Footnotes render in reference order; each item retains its definition's source position.
    for (const item of list.children) {
      if (item.type === 'element' && item.position?.start.offset !== undefined) {
        item.properties['data-source-from'] = item.position.start.offset
      }
    }
  }
  tree.children = tree.children.map((node) => ({
    type: 'element',
    tagName: 'div',
    properties: { 'data-live-preview-offset': node.position?.start.offset ?? -1 },
    children: [node.type === 'doctype' ? { type: 'text', value: '' } : node]
  }))
}
const previewPlugins = [portalBlocks]

function createPreviewStore() {
  let snapshot = { source: '', targets: [] as PreviewTarget[] }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish: (next: typeof snapshot) => {
      if (
        snapshot.source === next.source &&
        snapshot.targets.length === next.targets.length &&
        snapshot.targets.every(
          (target, index) =>
            target.dom === next.targets[index].dom &&
            target.from === next.targets[index].from &&
            target.to === next.targets[index].to
        )
      )
        return
      snapshot = next
      listeners.forEach((listener) => listener())
    }
  }
}

const PreviewTargetsContext = createContext<PreviewTarget[]>([])
const components: Partial<Components> = {
  div: function PreviewBlock({ node, children, ...props }) {
    const targets = use(PreviewTargetsContext)
    const offset = node?.properties?.['data-live-preview-offset']
    if (offset === undefined) return <div {...props}>{children}</div>
    const position = Number(offset)
    const target =
      targets.find((item) => position >= item.from && position < item.to) ??
      (position === -1 ? targets.find((item) => item.from === -1) : undefined)
    return target ? createPortal(children, target.dom) : null
  }
}

interface MarkdownLivePreviewProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  label: string
}

/** Edits original Markdown source while rendering inactive blocks through the application pipeline. */
export function MarkdownLivePreview({ value, onChange, readOnly = false, label }: MarkdownLivePreviewProps) {
  const [store] = useState(createPreviewStore)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const composingRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ComposerDocument,
      ComposerParagraph,
      ComposerText,
      ComposerHardBreak,
      ComposerUndoRedo,
      ComposerMarkdownLivePreview,
      Extension.create({
        name: 'markdownDocument',
        addProseMirrorPlugins: () => [
          createDocumentPreviewPlugin(store.publish),
          keymap({ ...baseKeymap, 'Shift-Enter': splitBlock })
        ]
      })
    ],
    content: sourceDocument(value),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'markdown-live-source',
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true'
      },
      handleKeyDown: (view, event) => handleMarkdownCodeKey(view, event) || handleMarkdownFormatKey(view, event),
      clipboardTextSerializer: (slice) => {
        const lines: string[] = []
        slice.content.forEach((node) => lines.push(node.textContent))
        return lines.join('\n')
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return false
        const nodes = sourceDocument(text).content!.map((node) => view.state.schema.nodeFromJSON(node))
        view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 1, 1)).scrollIntoView())
        return true
      }
    },
    onUpdate: ({ editor: current }) => {
      if (!composingRef.current && !current.view.composing) onChangeRef.current(documentSource(current.state.doc))
    }
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly, false)
  }, [editor, readOnly])
  useEffect(() => {
    if (editor && !composingRef.current && !editor.view.composing && documentSource(editor.state.doc) !== value) {
      editor.commands.setContent(sourceDocument(value), { emitUpdate: false })
    }
  }, [editor, value])
  useEffect(() => {
    if (!editor) return
    let timer: number | undefined
    const finish = () => {
      window.clearTimeout(timer)
      timer = undefined
      composingRef.current = false
      if (!editor.isDestroyed) onChangeRef.current(documentSource(editor.state.doc))
    }
    const start = () => {
      window.clearTimeout(timer)
      timer = undefined
      composingRef.current = true
    }
    const end = () => {
      timer = window.setTimeout(finish, 40)
    }
    const blur = () => {
      if (timer !== undefined) finish()
    }
    const element = editor.view.dom
    element.addEventListener('compositionstart', start, true)
    element.addEventListener('compositionend', end, true)
    element.addEventListener('blur', blur, true)
    return () => {
      if (timer !== undefined) finish()
      element.removeEventListener('compositionstart', start, true)
      element.removeEventListener('compositionend', end, true)
      element.removeEventListener('blur', blur, true)
    }
  }, [editor])

  return (
    <div className="markdown static-markdown markdown-live-preview">
      <EditorContent editor={editor} />
      <PreviewTargetsContext value={snapshot.targets}>
        <Suspense fallback={null}>
          <AppMarkdown
            className="hidden"
            components={components}
            rehypePlugins={previewPlugins}
            transformSource={previewSource}>
            {snapshot.source}
          </AppMarkdown>
        </Suspense>
      </PreviewTargetsContext>
    </div>
  )
}
