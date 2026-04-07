/**
 * TipTap custom inline Node for prompt template variables.
 *
 * Renders as an atom (non-editable inline block) within editable text.
 * Uses ReactNodeViewRenderer to render Input/Select components.
 */

import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import PromptVariableNodeView from './PromptVariableNodeView'

export interface PromptVariableNodeAttrs {
  variableId: string
  variableKey: string
  variableType: 'input' | 'select'
  options: string // JSON-serialized string[]
  placeholder: string
  defaultValue: string
}

export const PromptVariableNode = Node.create({
  name: 'promptVariable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      variableId: { default: '' },
      variableKey: { default: '' },
      variableType: { default: 'input' },
      options: { default: '[]' },
      placeholder: { default: '' },
      defaultValue: { default: '' },
      currentValue: { default: '' }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="prompt-variable"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'prompt-variable' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PromptVariableNodeView)
  }
})
