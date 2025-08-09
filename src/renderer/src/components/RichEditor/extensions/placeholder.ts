import { Editor, Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Node } from 'prosemirror-model'

export interface PlaceholderOptions {
  placeholder: ((props: { editor: Editor; node: Node; pos: number; hasAnchor: boolean }) => string) | string | undefined
  showOnlyWhenEditable: boolean
  showOnlyCurrent: boolean
  includeChildren: boolean
}

export const Placeholder = Extension.create<PlaceholderOptions>({
  name: 'placeholder',

  addOptions() {
    return {
      placeholder: 'Write something...',
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('placeholder'),
        props: {
          decorations: ({ doc, selection }) => {
            const active = this.editor.isEditable
            const { anchor } = selection
            const decorations: Decoration[] = []

            if (!active && this.options.showOnlyWhenEditable) {
              return DecorationSet.empty
            }

            // Check if we're in the middle of a drag operation
            const isDragging = this.editor.view.dragging

            doc.descendants((node, pos) => {
              const hasAnchor = anchor >= pos && anchor <= pos + node.nodeSize
              const isEmpty = !node.isLeaf && !node.childCount

              // Skip codeBlock nodes as they have their own content management
              if (node.type.name === 'codeBlock' || isDragging) {
                return false
              }

              // Only show placeholder on current node (where cursor is) or all nodes based on showOnlyCurrent
              if ((hasAnchor || !this.options.showOnlyCurrent) && isEmpty) {
                const classes = ['placeholder']
                if (hasAnchor) {
                  classes.push('has-focus')
                }

                const decoration = Decoration.node(pos, pos + node.nodeSize, {
                  class: classes.join(' '),
                  'data-placeholder':
                    typeof this.options.placeholder === 'function'
                      ? this.options.placeholder({
                          editor: this.editor,
                          node,
                          pos,
                          hasAnchor
                        })
                      : this.options.placeholder
                })

                decorations.push(decoration)
              }

              return this.options.includeChildren
            })

            return DecorationSet.create(doc, decorations)
          }
        }
      })
    ]
  }
})
