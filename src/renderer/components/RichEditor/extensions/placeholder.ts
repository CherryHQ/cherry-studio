import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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
            // Tiptap keeps this plugin instance when React updates editor options, so
            // read the currently configured extension instead of the creation-time options.
            const options =
              (this.editor.options.extensions.find((extension) => extension.name === this.name)?.options as
                | PlaceholderOptions
                | undefined) ?? this.options
            const active = this.editor.isEditable
            const { anchor } = selection
            const decorations: Decoration[] = []

            if (!active && options.showOnlyWhenEditable) {
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
              if ((hasAnchor || !options.showOnlyCurrent) && isEmpty) {
                const classes = ['placeholder']
                if (hasAnchor) {
                  classes.push('has-focus')
                }

                const decoration = Decoration.node(pos, pos + node.nodeSize, {
                  class: classes.join(' '),
                  'data-placeholder':
                    typeof options.placeholder === 'function'
                      ? options.placeholder({
                          editor: this.editor,
                          node,
                          pos,
                          hasAnchor
                        })
                      : options.placeholder
                })

                decorations.push(decoration)
              }

              return options.includeChildren
            })

            return DecorationSet.create(doc, decorations)
          }
        }
      })
    ]
  }
})
