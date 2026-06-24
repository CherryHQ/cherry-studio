import { type Editor, mergeAttributes, Node } from '@tiptap/core'
import { AllSelection, NodeSelection } from '@tiptap/pm/state'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { type ReactNode, useCallback, useLayoutEffect, useState } from 'react'

import { ComposerToken } from '../tokens'
import { type PromptVariableCommitReason, PromptVariableToken } from './PromptVariableToken'
import type { ActiveComposerInputToken, ComposerDraftToken, PromptVariableComposerInputToken } from './tokens'
import { normalizeComposerTokenAttrs } from './tokens'

export const COMPOSER_TOKEN_NODE_NAME = 'composerToken'
export const COMPOSER_PROMPT_VARIABLE_EDIT_EVENT = 'composer-prompt-variable-edit'

export interface ComposerPromptVariableEditEventDetail {
  tokenId: string
  position?: number
}

export function requestComposerPromptVariableEdit(
  editorDom: HTMLElement | null | undefined,
  tokenId: string,
  position?: number
) {
  if (!editorDom) return

  const view = editorDom.ownerDocument.defaultView ?? window
  const requestFrame = view.requestAnimationFrame.bind(view)
  const dispatchEditRequest = () => {
    editorDom.dispatchEvent(new CustomEvent(COMPOSER_PROMPT_VARIABLE_EDIT_EVENT, { detail: { tokenId, position } }))
  }
  requestFrame(() => {
    dispatchEditRequest()
    requestFrame(dispatchEditRequest)
  })
}

export type ComposerTokenRenderer = (
  token: ComposerDraftToken,
  props: { selected: boolean; nodeViewProps: NodeViewProps }
) => ReactNode

interface ComposerTokenNodeOptions {
  renderToken?: ComposerTokenRenderer
}

function deleteComposerTokenRange(editor: Editor, from: number, to: number) {
  editor.view.dispatch(editor.state.tr.delete(from, to).scrollIntoView())
  return true
}

function deleteComposerTokenNearSelection(editor: Editor, nodeName: string, direction: -1 | 1) {
  const { selection } = editor.state

  if (selection instanceof NodeSelection && selection.node.type.name === nodeName) {
    return deleteComposerTokenRange(editor, selection.from, selection.to)
  }

  if (!selection.empty) return false

  const adjacentNode = direction < 0 ? selection.$from.nodeBefore : selection.$from.nodeAfter
  if (!adjacentNode || adjacentNode.type.name !== nodeName) return false

  const from = direction < 0 ? selection.from - adjacentNode.nodeSize : selection.from
  return deleteComposerTokenRange(editor, from, from + adjacentNode.nodeSize)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    composerToken: {
      insertComposerToken: (token: ComposerDraftToken) => ReturnType
      editComposerToken: (tokenId: string, position?: number) => ReturnType
    }
  }
}

function ComposerTokenNodeView(props: NodeViewProps & { renderToken?: ComposerTokenRenderer }) {
  const token = normalizeComposerTokenAttrs(props.node.attrs)
  const getNodePosition = props.getPos
  const [isPromptVariableEditing, setPromptVariableEditing] = useState(false)

  const isPromptVariableEditRequestForCurrentNode = useCallback(
    (detail?: ComposerPromptVariableEditEventDetail) => {
      if (!detail || detail.tokenId !== token.id) return false
      if (typeof detail.position !== 'number') return true

      const currentPosition = typeof getNodePosition === 'function' ? getNodePosition() : undefined
      return currentPosition === detail.position
    },
    [getNodePosition, token.id]
  )

  useLayoutEffect(() => {
    if (token.kind !== 'promptVariable') return

    const handlePromptVariableEdit = (event: Event) => {
      const detail = (event as CustomEvent<ComposerPromptVariableEditEventDetail>).detail
      if (isPromptVariableEditRequestForCurrentNode(detail)) setPromptVariableEditing(true)
    }

    props.editor.view.dom.addEventListener(COMPOSER_PROMPT_VARIABLE_EDIT_EVENT, handlePromptVariableEdit)
    return () => {
      props.editor.view.dom.removeEventListener(COMPOSER_PROMPT_VARIABLE_EDIT_EVENT, handlePromptVariableEdit)
    }
  }, [isPromptVariableEditRequestForCurrentNode, props.editor.view.dom, token.kind])

  const commitPromptVariableValue = (value: string) => {
    props.updateAttributes({
      label: value || token.label,
      promptText: value
    })
  }

  const selectAdjacentPromptVariableToken = (direction: 1 | -1) => {
    const currentPosition = typeof props.getPos === 'function' ? props.getPos() : undefined
    if (typeof currentPosition !== 'number') return

    const tokens: Array<{ position: number; token: ComposerDraftToken }> = []
    props.editor.state.doc.descendants((node, position) => {
      if (node.type.name !== COMPOSER_TOKEN_NODE_NAME) return
      const nextToken = normalizeComposerTokenAttrs(node.attrs)
      if (nextToken.kind === 'promptVariable') tokens.push({ position, token: nextToken })
    })

    if (!tokens.length) return

    const currentIndex = tokens.findIndex((item) => item.position === currentPosition)
    const nextIndex =
      direction > 0
        ? currentIndex >= 0
          ? (currentIndex + 1) % tokens.length
          : Math.max(
              0,
              tokens.findIndex((item) => item.position > currentPosition)
            )
        : currentIndex >= 0
          ? (currentIndex - 1 + tokens.length) % tokens.length
          : tokens.findLastIndex((item) => item.position < currentPosition)
    const target = tokens[nextIndex >= 0 ? nextIndex : tokens.length - 1]

    props.editor.chain().focus().setNodeSelection(target.position).run()
    props.editor.commands.editComposerToken(target.token.id, target.position)
  }

  const selectCurrentToken = () => {
    const position = typeof props.getPos === 'function' ? props.getPos() : undefined
    if (typeof position !== 'number') return

    props.editor.chain().focus().setNodeSelection(position).run()
  }

  const finishPromptVariableEdit = (
    value: string,
    reason: PromptVariableCommitReason,
    options: { dirty: boolean; direction?: 1 | -1 }
  ) => {
    if (token.kind !== 'promptVariable') return
    if (options.dirty) {
      commitPromptVariableValue(value)
    }
    setPromptVariableEditing(false)

    if (reason === 'tab' && options.direction) {
      selectAdjacentPromptVariableToken(options.direction)
      return
    }

    if (reason === 'enter') {
      const position = typeof props.getPos === 'function' ? props.getPos() : undefined
      if (typeof position === 'number') {
        props.editor
          .chain()
          .focus()
          .setTextSelection(position + props.node.nodeSize)
          .run()
      }
    }
  }
  const selectAllComposerContent = (value: string, options: { dirty: boolean }) => {
    if (token.kind !== 'promptVariable') return
    if (options.dirty) {
      commitPromptVariableValue(value)
    }
    setPromptVariableEditing(false)

    props.editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        dispatch?.(tr.setSelection(new AllSelection(tr.doc)))
        return true
      })
      .run()
  }
  const rendered =
    props.renderToken?.(token, { selected: props.selected, nodeViewProps: props }) ??
    (token.kind === 'promptVariable' ? (
      <PromptVariableToken
        token={token as PromptVariableComposerInputToken}
        selected={props.selected}
        editing={isPromptVariableEditing}
        onCommit={finishPromptVariableEdit}
        onSelectAll={selectAllComposerContent}
        onEditRequest={() => {
          selectCurrentToken()
          setPromptVariableEditing(true)
        }}
      />
    ) : (
      <ComposerToken token={token as ActiveComposerInputToken} selected={props.selected} />
    ))

  return (
    <NodeViewWrapper
      as="span"
      className="inline-flex align-baseline"
      contentEditable={false}
      data-composer-token-node="">
      {rendered}
    </NodeViewWrapper>
  )
}

export const ComposerTokenNode = Node.create<ComposerTokenNodeOptions>({
  name: COMPOSER_TOKEN_NODE_NAME,

  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addOptions() {
    return {
      renderToken: undefined
    }
  },

  addAttributes() {
    return {
      id: { default: null },
      kind: { default: 'reference' },
      label: { default: '' },
      icon: { default: null },
      description: { default: null },
      promptText: { default: null },
      payload: { default: null }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-composer-token]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const safeAttributes = { ...HTMLAttributes }
    delete safeAttributes.payload

    return [
      'span',
      mergeAttributes(safeAttributes, {
        'data-composer-token': '',
        'data-token-id': HTMLAttributes.id,
        'data-token-kind': HTMLAttributes.kind,
        contenteditable: 'false'
      })
    ]
  },

  renderText({ node }) {
    const token = normalizeComposerTokenAttrs(node.attrs)
    return token.promptText ?? ''
  },

  addCommands() {
    return {
      insertComposerToken:
        (token) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: token
          })
        },
      editComposerToken:
        (tokenId, position) =>
        ({ editor }) => {
          requestComposerPromptVariableEdit(editor.view.dom, tokenId, position)
          return true
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteComposerTokenNearSelection(this.editor, this.name, -1),
      Delete: () => deleteComposerTokenNearSelection(this.editor, this.name, 1)
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => <ComposerTokenNodeView {...props} renderToken={this.options.renderToken} />)
  }
})
