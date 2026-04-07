/**
 * PromptVariableRenderer
 *
 * TipTap-based rich text editor for prompt template mode.
 * Replaces the Textarea slot in InputbarCore when a variable prompt is active.
 *
 * - Static text is fully editable (user can modify prompt context)
 * - ${key} variables are rendered as inline atom nodes (Input/Select)
 * - resolve() extracts text + variable values into plain text for sending
 * - Auto-exits template mode when all content is cleared
 */

import type { PromptVariable } from '@shared/data/types/prompt'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { type FC, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import { PromptVariableNode } from './PromptVariableNode'

/** Imperative API exposed to InputbarCore via ref */
export interface PromptVariableRendererRef {
  /** Resolve: extract text + variable values. Returns null if validation fails. */
  resolve: () => string | null
}

interface Props {
  content: string
  variables: PromptVariable[]
  rendererRef: React.RefObject<PromptVariableRendererRef | null>
  fontSize?: number
  height?: number
  /** Called when editor content becomes empty — parent should exit template mode */
  onEmpty?: () => void
  /** Called when user presses Esc — parent should exit template mode */
  onCancel?: () => void
}

const VARIABLE_PATTERN = /\$\{(\w+)\}/g

/**
 * Build inline nodes (text + variable atoms) for a single line of template content.
 */
function buildLineNodes(line: string, variableMap: Map<string, PromptVariable>): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = []
  let lastIndex = 0

  for (const match of line.matchAll(VARIABLE_PATTERN)) {
    const matchIndex = match.index
    const key = match[1]

    if (matchIndex > lastIndex) {
      nodes.push({ type: 'text', text: line.slice(lastIndex, matchIndex) })
    }

    const variable = variableMap.get(key)
    if (variable) {
      nodes.push({
        type: 'promptVariable',
        attrs: {
          variableId: variable.id,
          variableKey: variable.key,
          variableType: variable.type,
          options: variable.type === 'select' ? JSON.stringify(variable.options) : '[]',
          placeholder: variable.type === 'input' ? (variable.placeholder ?? '') : '',
          defaultValue: variable.defaultValue ?? '',
          currentValue: variable.defaultValue ?? ''
        }
      })
    } else {
      nodes.push({ type: 'text', text: match[0] })
    }

    lastIndex = matchIndex + match[0].length
  }

  if (lastIndex < line.length) {
    nodes.push({ type: 'text', text: line.slice(lastIndex) })
  }

  return nodes
}

/**
 * Parse template content + variables into TipTap JSON document.
 * Splits by newlines to produce multiple paragraphs.
 */
function buildEditorContent(content: string, variables: PromptVariable[]) {
  const variableMap = new Map(variables.map((v) => [v.key, v]))
  const lines = content.split('\n')

  const paragraphs = lines.map((line) => {
    const inlineNodes = buildLineNodes(line, variableMap)
    return {
      type: 'paragraph',
      content: inlineNodes.length > 0 ? inlineNodes : [{ type: 'text', text: '' }]
    }
  })

  return {
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]
  }
}

/**
 * Check if the editor document is empty (no text and no variable nodes).
 */
function isEditorEmpty(doc: {
  descendants: (cb: (node: { isText: boolean; text?: string | null; type: { name: string } }) => void) => void
}): boolean {
  let hasContent = false
  doc.descendants((node) => {
    if (node.type.name === 'promptVariable') {
      hasContent = true
    } else if (node.isText && node.text && node.text.length > 0) {
      hasContent = true
    }
  })
  return !hasContent
}

const PromptVariableRenderer: FC<Props> = ({
  content,
  variables,
  rendererRef,
  fontSize,
  height,
  onEmpty,
  onCancel
}) => {
  const editorContent = useMemo(() => buildEditorContent(content, variables), [content, variables])

  // Ref to keep onCancel accessible from editor's handleKeyDown without re-creating the editor
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false
      }),
      PromptVariableNode
    ],
    content: editorContent,
    editorProps: {
      attributes: {
        class: 'prompt-variable-editor'
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          return true
        }
        if (event.key === 'Escape') {
          onCancelRef.current?.()
          return true
        }
        return false
      }
    },
    onUpdate: ({ editor: e }) => {
      if (onEmpty && isEditorEmpty(e.state.doc)) {
        onEmpty()
      }
    }
  })

  const resolve = useCallback((): string | null => {
    if (!editor) return null

    const doc = editor.state.doc
    const paragraphs: string[] = []
    let hasEmpty = false

    for (let i = 0; i < doc.childCount; i++) {
      if (hasEmpty) break
      const paragraph = doc.child(i)
      let text = ''
      for (let j = 0; j < paragraph.childCount; j++) {
        const node = paragraph.child(j)
        if (node.isText) {
          text += node.text ?? ''
        } else if (node.type.name === 'promptVariable') {
          const value = (node.attrs.currentValue as string) ?? ''
          if (!value.trim()) {
            hasEmpty = true
            break
          }
          text += value
        }
      }
      if (!hasEmpty) {
        paragraphs.push(text)
      }
    }

    if (hasEmpty) return null
    return paragraphs.join('\n')
  }, [editor])

  useImperativeHandle(rendererRef, () => ({ resolve }), [resolve])

  if (!editor) return null

  return (
    <>
      <style>{`
        .prompt-variable-editor.tiptap.tiptap {
          outline: none;
          padding: 6px 15px 0px;
          min-height: unset;
          line-height: 1.5;
          overflow-y: auto;
          font-size: ${fontSize ?? 14}px;
        }
        .prompt-variable-editor.tiptap.tiptap p {
          margin: 0;
          line-height: inherit;
        }
        .prompt-variable-editor.tiptap.tiptap::after {
          height: 16px;
        }
      `}</style>
      <EditorContent editor={editor} style={{ height: height ?? undefined }} />
    </>
  )
}

export default PromptVariableRenderer
