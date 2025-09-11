import { type ComputePositionConfig } from '@floating-ui/dom'
import { Editor, Extension } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

import { PlusButtonPlugin } from '../plugins/plusButtonPlugin'

export const defaultComputePositionConfig: ComputePositionConfig = {
  placement: 'left-start',
  strategy: 'absolute'
}

export interface PlusButtonOptions {
  /**
   * Renders an element that is positioned with the floating-ui/dom package
   */
  render(): HTMLElement
  /**
   * Configuration for position computation of the drag handle
   * using the floating-ui/dom package
   */
  computePositionConfig?: ComputePositionConfig
  /**
   * Returns a node or null when a node is hovered over
   */
  onNodeChange?: (options: { node: Node | null; editor: Editor; pos: number }) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    plusButton: {
      /**
       * Insert a paragraph after the current block
       */
      insertParagraphAfter: () => ReturnType
    }
  }
}

export const PlusButton = Extension.create<PlusButtonOptions>({
  name: 'plusButton',

  addOptions() {
    return {
      render() {
        const element = document.createElement('div')
        return element
      }
    }
  },

  addProseMirrorPlugins() {
    const element = this.options.render()
    return [
      PlusButtonPlugin({
        computePositionConfig: { ...defaultComputePositionConfig, ...this.options.computePositionConfig },
        element,
        editor: this.editor,
        onNodeChange: this.options.onNodeChange
      }).plugin
    ]
  },

  addCommands() {
    return {
      insertParagraphAfter:
        () =>
        ({ state, dispatch, view }) => {
          const { $from } = state.selection
          const { schema } = state

          const endOfBlock = $from.end($from.depth)

          const paragraphNode = schema.nodes.paragraph
          if (!paragraphNode) return false

          let tr = state.tr.insert(endOfBlock, paragraphNode.create())

          const insidePos = endOfBlock + 1
          tr = tr.setSelection(TextSelection.create(tr.doc, insidePos))

          tr = tr.scrollIntoView()

          if (dispatch) dispatch(tr)

          view?.focus()

          return true
        }
    }
  }
})

export default PlusButton
