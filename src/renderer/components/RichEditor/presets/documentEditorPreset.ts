import { TableKit } from '@cherrystudio/extension-table-plus'
import { MARKDOWN_SOURCE_LINE_ATTR } from '@renderer/components/RichEditor/constants'
import type { Editor, EditorOptions } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Mention from '@tiptap/extension-mention'
import {
  getHierarchicalIndexes,
  type TableOfContentDataItem,
  TableOfContents
} from '@tiptap/extension-table-of-contents'
import Typography from '@tiptap/extension-typography'
import { StarterKit } from '@tiptap/starter-kit'

import { commandSuggestion } from '../command'
import { CodeBlockShiki } from '../extensions/codeBlockShiki/codeBlockShiki'
import { EnhancedImage } from '../extensions/enhancedImage'
import { EnhancedLink } from '../extensions/enhancedLink'
import { EnhancedMath } from '../extensions/enhancedMath'
import { Placeholder } from '../extensions/placeholder'
import { YamlFrontMatter } from '../extensions/yamlFrontMatter'

type TableActionType = 'row' | 'column'

export interface DocumentEditorPresetOptions {
  activeShikiTheme: string
  editable: boolean
  placeholder: string
  scrollParent?: () => HTMLElement | null
  getEditor: () => Editor | null
  onLinkHover: (
    attrs: { href: string; text: string; title?: string },
    position: DOMRect,
    element: HTMLElement,
    linkRange?: { from: number; to: number }
  ) => void
  onLinkHoverEnd: () => void
  onTableActionClick: (type: TableActionType, index: number, position?: { x: number; y: number }) => void
  onTableOfContentsItemsChange: (items: TableOfContentDataItem[]) => void
}

const SourceLineAttribute = Extension.create({
  name: 'sourceLineAttribute',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'horizontalRule'],
        attributes: {
          dataSourceLine: {
            default: null,
            parseHTML: (element) => element.getAttribute(MARKDOWN_SOURCE_LINE_ATTR),
            renderHTML: (attributes) => {
              if (!attributes.dataSourceLine) return {}
              return { [MARKDOWN_SOURCE_LINE_ATTR]: attributes.dataSourceLine }
            }
          }
        }
      }
    ]
  }
})

export function createDocumentEditorPreset({
  activeShikiTheme,
  editable,
  placeholder,
  scrollParent,
  getEditor,
  onLinkHover,
  onLinkHoverEnd,
  onTableActionClick,
  onTableOfContentsItemsChange
}: DocumentEditorPresetOptions): EditorOptions['extensions'] {
  return [
    SourceLineAttribute,
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3, 4, 5, 6]
      },
      codeBlock: false,
      link: false
    }),
    EnhancedLink.configure({
      onLinkHover,
      onLinkHoverEnd,
      editable
    }),
    TableOfContents.configure({
      getIndex: getHierarchicalIndexes,
      onUpdate(content) {
        const parent = scrollParent?.()
        if (!parent) return
        const parentTop = parent.getBoundingClientRect().top

        let closestIndex = -1
        let minDelta = Number.POSITIVE_INFINITY
        for (let i = 0; i < content.length; i++) {
          const rect = content[i].dom.getBoundingClientRect()
          const delta = rect.top - parentTop
          const inThreshold = delta >= -50 && delta < minDelta

          if (inThreshold) {
            minDelta = delta
            closestIndex = i
          }
        }
        if (closestIndex === -1) {
          for (let i = 0; i < content.length; i++) {
            const rect = content[i].dom.getBoundingClientRect()
            if (rect.top < parentTop) closestIndex = i
          }
          if (closestIndex === -1) closestIndex = 0
        }

        const normalized = content.map((item, idx) => {
          const rect = item.dom.getBoundingClientRect()
          const isScrolledOver = rect.top < parentTop
          const isActive = idx === closestIndex
          return { ...item, isActive, isScrolledOver }
        })

        onTableOfContentsItemsChange(normalized)
      },
      scrollParent: (scrollParent as any) ?? window
    }),
    CodeBlockShiki.configure({
      theme: activeShikiTheme,
      defaultLanguage: 'text'
    }),
    EnhancedMath.configure({
      blockOptions: {
        onClick: (node, pos) => {
          const editor = getEditor()
          let position: { x: number; y: number; top: number } | undefined
          if (event?.target instanceof HTMLElement) {
            const rect =
              event.target.closest('.math-display')?.getBoundingClientRect() || event.target.getBoundingClientRect()
            position = {
              x: rect.left + rect.width / 2,
              y: rect.bottom,
              top: rect.top
            }
          }

          const customEvent = new CustomEvent('openMathDialog', {
            detail: {
              defaultValue: node.attrs.latex || '',
              position: position,
              onSubmit: () => {
                editor?.commands.focus()
              },
              onFormulaChange: (formula: string) => {
                editor?.chain().setNodeSelection(pos).updateBlockMath({ latex: formula }).run()
              }
            }
          })
          window.dispatchEvent(customEvent)
          return true
        }
      },
      inlineOptions: {
        onClick: (node, pos) => {
          const editor = getEditor()
          let position: { x: number; y: number; top: number } | undefined
          if (event?.target instanceof HTMLElement) {
            const rect =
              event.target.closest('.math-inline')?.getBoundingClientRect() || event.target.getBoundingClientRect()
            position = {
              x: rect.left + rect.width / 2,
              y: rect.bottom,
              top: rect.top
            }
          }

          const customEvent = new CustomEvent('openMathDialog', {
            detail: {
              defaultValue: node.attrs.latex || '',
              position: position,
              onSubmit: () => {
                editor?.commands.focus()
              },
              onFormulaChange: (formula: string) => {
                editor?.chain().setNodeSelection(pos).updateInlineMath({ latex: formula }).run()
              }
            }
          })
          window.dispatchEvent(customEvent)
          return true
        }
      }
    }),
    EnhancedImage,
    Placeholder.configure({
      placeholder,
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false
    }),
    YamlFrontMatter,
    Mention.configure({
      HTMLAttributes: {
        class: 'mention'
      },
      suggestion: commandSuggestion
    }),
    Typography,
    TableKit.configure({
      table: {
        resizable: true,
        allowTableNodeSelection: true,
        onRowActionClick: ({ rowIndex, position }) => {
          onTableActionClick('row', rowIndex, position)
        },
        onColumnActionClick: ({ colIndex, position }) => {
          onTableActionClick('column', colIndex, position)
        }
      },
      tableRow: {},
      tableHeader: {},
      tableCell: {
        allowNestedNodes: false
      }
    }),
    TaskList,
    TaskItem.configure({
      nested: true
    })
  ]
}
