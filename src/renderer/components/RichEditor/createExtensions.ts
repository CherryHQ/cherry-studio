import { TableCell, TableHeader, TableRow } from '@cherrystudio/extension-table-plus'
import type { Extensions } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Mention from '@tiptap/extension-mention'
import {
  getHierarchicalIndexes,
  type TableOfContentDataItem,
  TableOfContents
} from '@tiptap/extension-table-of-contents'
import Typography from '@tiptap/extension-typography'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'

import { commandSuggestion } from './command'
import { CodeBlockShiki } from './extensions/codeBlockShiki/codeBlockShiki'
import { EnhancedImage } from './extensions/enhancedImage'
import { EnhancedLink, type EnhancedLinkOptions } from './extensions/enhancedLink'
import { EnhancedMath } from './extensions/enhancedMath'
import { MarkdownTable } from './extensions/markdownTable'
import { Placeholder } from './extensions/placeholder'
import { YamlFrontMatter } from './extensions/yamlFrontMatter'

/** Click handler shape forwarded to EnhancedMath block/inline node options. */
type MathClickOptions = { onClick?: (node: { attrs: { latex?: string } }, pos: number) => boolean | void }

/** Table row/column action handler shape (mirrors `@cherrystudio/extension-table-plus`). */
type TableActionHandler<T extends 'rowIndex' | 'colIndex'> = (
  args: { [K in T]: number } & { position?: { x: number; y: number } }
) => void

export interface CreateRichEditorExtensionsOptions {
  /** Whether the editor is editable (affects link hover behavior). */
  editable?: boolean
  /** Placeholder text shown in the empty editor. */
  placeholder?: string
  /** Shiki theme for the code block extension. */
  shikiTheme?: string
  /** Link hover callback. */
  onLinkHover?: EnhancedLinkOptions['onLinkHover']
  /** Link hover-end callback. */
  onLinkHoverEnd?: EnhancedLinkOptions['onLinkHoverEnd']
  /** Scroll parent for the table-of-contents active-item tracking. */
  tocScrollParent?: (() => HTMLElement | null) | null
  /** Table-of-contents update callback. */
  onTocUpdate?: (content: TableOfContentDataItem[]) => void
  /** Block math node click handler. */
  mathBlockOptions?: MathClickOptions
  /** Inline math node click handler. */
  mathInlineOptions?: MathClickOptions
  /** Table row action-menu trigger. */
  onRowActionClick?: TableActionHandler<'rowIndex'>
  /** Table column action-menu trigger. */
  onColumnActionClick?: TableActionHandler<'colIndex'>
}

/**
 * Single source of truth for the RichEditor's Tiptap extension set.
 *
 * Both `useRichEditor` (production) and the markdown round-trip tests build their editor from this
 * factory so the test schema can never silently drift from production — the drift that previously let
 * GFM-table serialization break unnoticed. Interactive callbacks (link hover, math click, table action
 * menus, ToC tracking) are injected by the hook; they do not affect markdown parse/serialize, so tests
 * call this with no options and still exercise the exact same node/mark schema and markdown hooks.
 */
export const createRichEditorExtensions = (options: CreateRichEditorExtensionsOptions = {}): Extensions => {
  const {
    editable = true,
    placeholder = '',
    shikiTheme = 'one-light',
    onLinkHover,
    onLinkHoverEnd,
    tocScrollParent,
    onTocUpdate,
    mathBlockOptions,
    mathInlineOptions,
    onRowActionClick,
    onColumnActionClick
  } = options

  return [
    // Native Markdown parsing/serialization via the official @tiptap/markdown AST
    // (marked-based). Custom nodes contribute their own parse/render hooks.
    Markdown.configure({
      markedOptions: {
        gfm: true
      }
    }),
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
      onUpdate: onTocUpdate ?? (() => {}),
      scrollParent: (tocScrollParent as any) ?? window
    }),
    CodeBlockShiki.configure({
      theme: shikiTheme,
      defaultLanguage: 'text'
    }),
    EnhancedMath.configure({
      blockOptions: mathBlockOptions,
      inlineOptions: mathInlineOptions
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
    MarkdownTable.configure({
      resizable: true,
      allowTableNodeSelection: true,
      onRowActionClick,
      onColumnActionClick
    }),
    TableRow,
    TableHeader,
    TableCell.configure({
      allowNestedNodes: false
    }),
    TaskList,
    TaskItem.configure({
      nested: true
    })
  ]
}
