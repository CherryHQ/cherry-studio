import 'katex/dist/katex.min.css'

import { TableKit } from '@cherrystudio/extension-table-plus'
import { loggerService } from '@logger'
import { MARKDOWN_SOURCE_LINE_ATTR } from '@renderer/components/RichEditor/constants'
import type { FormattingState } from '@renderer/components/RichEditor/types'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import {
  htmlToMarkdown,
  isMarkdownContent,
  markdownToHtml,
  markdownToPreviewText
} from '@renderer/utils/markdownConverter'
import type { Editor } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { migrateMathStrings } from '@tiptap/extension-mathematics'
import Mention from '@tiptap/extension-mention'
import {
  getHierarchicalIndexes,
  type TableOfContentDataItem,
  TableOfContents
} from '@tiptap/extension-table-of-contents'
import Typography from '@tiptap/extension-typography'
import { useEditor, useEditorState } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { t } from 'i18next'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { commandSuggestion } from './command'
import { CodeBlockShiki } from './extensions/code-block-shiki/code-block-shiki'
import { EnhancedImage } from './extensions/enhanced-image'
import { EnhancedLink } from './extensions/enhanced-link'
import { EnhancedMath } from './extensions/enhanced-math'
import { Placeholder } from './extensions/placeholder'
import { YamlFrontMatter } from './extensions/yaml-front-matter'
import { blobToArrayBuffer, compressImage, shouldCompressImage } from './helpers/imageUtils'

const logger = loggerService.withContext('useRichEditor')

// Create extension to preserve data-source-line attribute
const SourceLineAttribute = Extension.create({
  name: 'sourceLineAttribute',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'horizontalRule'],
        attributes: {
          dataSourceLine: {
            default: null,
            parseHTML: (element) => {
              const value = element.getAttribute(MARKDOWN_SOURCE_LINE_ATTR)
              return value
            },
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

export interface UseRichEditorOptions {
  /** Initial markdown content */
  initialContent?: string
  /** Callback when markdown content changes */
  onChange?: (markdown: string) => void
  /** Callback when HTML content changes */
  onHtmlChange?: (html: string) => void
  /** Callback when content changes (plain text) */
  onContentChange?: (content: string) => void
  /** Callback when editor loses focus */
  onBlur?: () => void
  /** Callback when paste event occurs */
  onPaste?: (html: string) => void
  /** Maximum length for preview text */
  previewLength?: number
  /** Placeholder text when editor is empty */
  placeholder?: string
  /** Whether the editor is editable */
  editable?: boolean
  /** Whether to enable table of contents functionality */
  enableTableOfContents?: boolean
  /** Whether to enable spell check */
  enableSpellCheck?: boolean
  /** Show table action menu (row/column) with concrete actions and position */
  onShowTableActionMenu?: (payload: {
    type: 'row' | 'column'
    index: number
    position: { x: number; y: number }
    actions: { id: string; label: string; action: () => void }[]
  }) => void
  scrollParent?: () => HTMLElement | null
}

export interface UseRichEditorReturn {
  /** TipTap editor instance */
  editor: Editor
  /** Current markdown content */
  markdown: string
  /** Current HTML content (converted from markdown) */
  html: string
  /** Preview text for display */
  previewText: string
  /** Whether content is detected as markdown */
  isMarkdown: boolean
  /** Whether editor is disabled */
  disabled: boolean
  /** Current formatting state from TipTap editor */
  formattingState: FormattingState
  /** Table of contents items */
  tableOfContentsItems: TableOfContentDataItem[]
  /** Link editor state */
  linkEditor: {
    show: boolean
    position: { x: number; y: number }
    link: { href: string; text: string; title?: string }
    onSave: (href: string, text: string, title?: string) => void
    onRemove: () => void
    onCancel: () => void
  }

  /** Set markdown content */
  setMarkdown: (content: string) => void
  /** Set HTML content (converts to markdown) */
  setHtml: (html: string) => void
  /** Clear all content */
  clear: () => void

  /** Convert markdown to HTML */
  toHtml: (markdown: string) => string
  /** Convert markdown to safe HTML */
  toSafeHtml: (markdown: string) => string
  /** Convert HTML to markdown */
  toMarkdown: (html: string) => string
  /** Get preview text from markdown */
  getPreviewText: (markdown: string, maxLength?: number) => string
}

/**
 * Custom hook for managing rich text content with Markdown storage
 * Provides conversion between Markdown and HTML with sanitization
 */
export const useRichEditor = (options: UseRichEditorOptions = {}): UseRichEditorReturn => {
  const {
    initialContent = '',
    onChange,
    onHtmlChange,
    onContentChange,
    onBlur,
    onPaste,
    previewLength = 50,
    placeholder = '',
    editable = true,
    enableSpellCheck = false,
    onShowTableActionMenu,
    scrollParent
  } = options

  const [markdown, setMarkdownState] = useState<string>(initialContent)

  const html = useMemo(() => {
    if (!markdown) return ''
    return markdownToHtml(markdown)
  }, [markdown])

  const previewText = useMemo(() => {
    if (!markdown) return ''
    return markdownToPreviewText(markdown, previewLength)
  }, [markdown, previewLength])

  const isMarkdown = useMemo(() => {
    return isMarkdownContent(markdown)
  }, [markdown])

  // Get theme and language mapping from CodeStyleProvider
  const { activeShikiTheme } = useCodeStyle()

  const [tableOfContentsItems, setTableOfContentsItems] = useState<TableOfContentDataItem[]>([])

  // Link editor state
  const [linkEditorState, setLinkEditorState] = useState<{
    show: boolean
    position: { x: number; y: number }
    link: { href: string; text: string; title?: string }
    linkRange?: { from: number; to: number }
  }>({
    show: false,
    position: { x: 0, y: 0 },
    link: { href: '', text: '' }
  })

  // Link hover handlers
  const handleLinkHover = useCallback(
    (
      attrs: { href: string; text: string; title?: string },
      position: DOMRect,
      _element: HTMLElement,
      linkRange?: { from: number; to: number }
    ) => {
      if (!editable) return

      const linkPosition = { x: position.left, y: position.top }

      // For empty href, use the text content as initial href suggestion
      const effectiveHref = attrs.href || attrs.text || ''

      setLinkEditorState({
        show: true,
        position: linkPosition,
        link: { ...attrs, href: effectiveHref },
        linkRange
      })
    },
    [editable]
  )

  const handleLinkHoverEnd = useCallback(() => {}, [])

  // TipTap editor extensions
  const extensions = useMemo(
    () => [
      SourceLineAttribute,
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6]
        },
        codeBlock: false,
        link: false
      }),
      EnhancedLink.configure({
        onLinkHover: handleLinkHover,
        onLinkHoverEnd: handleLinkHoverEnd,
        editable: editable
      }),
      TableOfContents.configure({
        getIndex: getHierarchicalIndexes,
        onUpdate(content) {
          const resolveParent = (): HTMLElement | null => {
            if (!scrollParent) return null
            return typeof scrollParent === 'function' ? (scrollParent as () => HTMLElement)() : scrollParent
          }

          const parent = resolveParent()
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
            // If all are above the viewport, pick the last one above
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

          setTableOfContentsItems(normalized)
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
            // Get position from the clicked element
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
                  editor.commands.focus()
                },
                onFormulaChange: (formula: string) => {
                  editor.chain().setNodeSelection(pos).updateBlockMath({ latex: formula }).run()
                }
              }
            })
            window.dispatchEvent(customEvent)
            return true
          }
        },
        inlineOptions: {
          onClick: (node, pos) => {
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
                  editor.commands.focus()
                },
                onFormulaChange: (formula: string) => {
                  editor.chain().setNodeSelection(pos).updateInlineMath({ latex: formula }).run()
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
            showTableActionMenu('row', rowIndex, position)
          },
          onColumnActionClick: ({ colIndex, position }) => {
            showTableActionMenu('column', colIndex, position)
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
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeholder, activeShikiTheme, handleLinkHover, handleLinkHoverEnd]
  )

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions,
    content: html || '',
    editable: editable,
    editorProps: {
      handlePaste: (view, event) => {
        // First check if we're inside a code block - if so, insert plain text
        const { selection } = view.state
        const { $from } = selection
        if ($from.parent.type.name === 'codeBlock') {
          const text = event.clipboardData?.getData('text/plain') || ''
          if (text) {
            const tr = view.state.tr.insertText(text, selection.from, selection.to)
            view.dispatch(tr)
            return true
          }
        }

        // Handle image paste
        const items = Array.from(event.clipboardData?.items || [])
        const imageItem = items.find((item) => item.type.startsWith('image/'))

        if (imageItem) {
          const file = imageItem.getAsFile()
          if (file) {
            // Handle image paste by saving to local storage
            handleImagePaste(file)
            return true
          }
        }

        // Default behavior for non-code blocks
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (text) {
          const html = markdownToHtml(text)
          const { $from } = selection
          const atStartOfLine = $from.parentOffset === 0
          const inEmptyParagraph = $from.parent.type.name === 'paragraph' && $from.parent.textContent === ''

          if (!atStartOfLine && !inEmptyParagraph) {
            const cleanHtml = html.replace(/^<p>(.*?)<\/p>/s, '$1')
            editor.commands.insertContent(cleanHtml)
          } else {
            editor.commands.insertContent(html)
          }
          onPaste?.(html)
          return true
        }
        return false
      },
      attributes: {
        // Allow text selection even when not editable
        style: editable
          ? ''
          : 'user-select: text; -webkit-user-select: text; -moz-user-select: text; -ms-user-select: text;',
        // Set spellcheck attribute on the contenteditable element
        spellcheck: enableSpellCheck ? 'true' : 'false'
      }
    },
    onUpdate: ({ editor }) => {
      const content = editor.getText()
      const htmlContent = editor.getHTML()
      try {
        const convertedMarkdown = htmlToMarkdown(htmlContent)
        setMarkdownState(convertedMarkdown)
        onChange?.(convertedMarkdown)

        onContentChange?.(content)
        if (onHtmlChange) {
          onHtmlChange(htmlContent)
        }
      } catch (error) {
        logger.error('Error converting HTML to markdown:', error as Error)
      }
    },
    onBlur: () => {
      onBlur?.()
    },
    onCreate: ({ editor: currentEditor }) => {
      migrateMathStrings(currentEditor)
      try {
        currentEditor.commands.focus('end')
      } catch (error) {
        logger.warn('Could not set cursor to end:', error as Error)
      }
    }
  })

  // Handle image paste function
  const handleImagePaste = useCallback(
    async (file: File) => {
      try {
        let processedFile: File | Blob = file
        let extension = file.type.split('/')[1] ? `.${file.type.split('/')[1]}` : '.png'

        // 如果图片需要压缩，先进行压缩
        if (shouldCompressImage(file)) {
          logger.info('Image needs compression, compressing...', {
            originalSize: file.size,
            fileName: file.name
          })

          processedFile = await compressImage(file, {
            maxWidth: 1200,
            maxHeight: 1200,
            quality: 0.8,
            outputFormat: file.type.includes('png') ? 'png' : 'jpeg'
          })

          // 更新扩展名
          extension = file.type.includes('png') ? '.png' : '.jpg'

          logger.info('Image compressed successfully', {
            originalSize: file.size,
            compressedSize: processedFile.size,
            compressionRatio: (((file.size - processedFile.size) / file.size) * 100).toFixed(1) + '%'
          })
        }

        // Convert file to buffer
        const arrayBuffer = await blobToArrayBuffer(processedFile)
        const buffer = new Uint8Array(arrayBuffer)

        // Save image to local storage
        const fileMetadata = await window.api.file.savePastedImage(buffer, extension)

        // Insert image into editor using local file path
        if (editor && !editor.isDestroyed) {
          const imageUrl = `file://${fileMetadata.path}`
          editor.chain().focus().setImage({ src: imageUrl, alt: fileMetadata.origin_name }).run()
        }

        logger.info('Image pasted and saved:', fileMetadata)
      } catch (error) {
        logger.error('Failed to handle image paste:', error as Error)
      }
    },
    [editor]
  )

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(editable)
      if (editable) {
        try {
          setTimeout(() => {
            if (editor && !editor.isDestroyed) {
              const isLong = editor.getText().length > 2000
              if (!isLong) {
                editor.commands.focus('end')
              }
            }
          }, 0)
        } catch (error) {
          logger.warn('Could not set cursor to end after enabling editable:', error as Error)
        }
      }
    }
  }, [editor, editable])

  // Link editor callbacks (after editor is defined)
  const handleLinkSave = useCallback(
    (href: string, text: string) => {
      if (!editor || editor.isDestroyed) return

      const { linkRange } = linkEditorState

      if (linkRange) {
        // We have explicit link range - use it
        editor
          .chain()
          .focus()
          .setTextSelection({ from: linkRange.from, to: linkRange.to })
          .insertContent(text)
          .setTextSelection({ from: linkRange.from, to: linkRange.from + text.length })
          .setEnhancedLink({ href })
          .run()
      }
      setLinkEditorState({
        show: false,
        position: { x: 0, y: 0 },
        link: { href: '', text: '' }
      })
    },
    [editor, linkEditorState]
  )

  const handleLinkRemove = useCallback(() => {
    if (!editor || editor.isDestroyed) return

    const { linkRange } = linkEditorState

    if (linkRange) {
      // Use a more reliable method - directly remove the mark from the range
      const tr = editor.state.tr
      tr.removeMark(linkRange.from, linkRange.to, editor.schema.marks.enhancedLink || editor.schema.marks.link)
      editor.view.dispatch(tr)
    } else {
      // No explicit range - try to extend current mark range and remove
      editor.chain().focus().extendMarkRange('enhancedLink').unsetEnhancedLink().run()
    }

    // Close link editor
    setLinkEditorState({
      show: false,
      position: { x: 0, y: 0 },
      link: { href: '', text: '' }
    })
  }, [editor, linkEditorState])

  const handleLinkCancel = useCallback(() => {
    setLinkEditorState({
      show: false,
      position: { x: 0, y: 0 },
      link: { href: '', text: '' }
    })
  }, [])

  // Show action menu for table rows/columns
  const showTableActionMenu = useCallback(
    (type: 'row' | 'column', index: number, position?: { x: number; y: number }) => {
      if (!editor) return

      const actions = [
        {
          id: type === 'row' ? 'insertRowBefore' : 'insertColumnBefore',
          label:
            type === 'row'
              ? t('richEditor.action.table.insertRowBefore')
              : t('richEditor.action.table.insertColumnBefore'),
          action: () => {
            if (type === 'row') {
              editor.chain().focus().addRowBefore().run()
            } else {
              editor.chain().focus().addColumnBefore().run()
            }
          }
        },
        {
          id: type === 'row' ? 'insertRowAfter' : 'insertColumnAfter',
          label:
            type === 'row'
              ? t('richEditor.action.table.insertRowAfter')
              : t('richEditor.action.table.insertColumnAfter'),
          action: () => {
            if (type === 'row') {
              editor.chain().focus().addRowAfter().run()
            } else {
              editor.chain().focus().addColumnAfter().run()
            }
          }
        },
        {
          id: type === 'row' ? 'deleteRow' : 'deleteColumn',
          label: type === 'row' ? t('richEditor.action.table.deleteRow') : t('richEditor.action.table.deleteColumn'),
          action: () => {
            if (type === 'row') {
              editor.chain().focus().deleteRow().run()
            } else {
              editor.chain().focus().deleteColumn().run()
            }
          }
        }
      ]

      // Compute fallback position if not provided
      let finalPosition = position
      if (!finalPosition) {
        const rect = editor.view.dom.getBoundingClientRect()
        finalPosition = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }

      onShowTableActionMenu?.({ type, index, position: finalPosition!, actions })
    },
    [editor, onShowTableActionMenu]
  )

  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) {
        editor.destroy()
      }
    }
  }, [editor])

  const formattingState = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor || editor.isDestroyed) {
        return {
          isBold: false,
          canBold: false,
          isItalic: false,
          canItalic: false,
          isUnderline: false,
          canUnderline: false,
          isStrike: false,
          canStrike: false,
          isCode: false,
          canCode: false,
          canClearMarks: false,
          isParagraph: false,
          isHeading1: false,
          isHeading2: false,
          isHeading3: false,
          isHeading4: false,
          isHeading5: false,
          isHeading6: false,
          isBulletList: false,
          isOrderedList: false,
          isCodeBlock: false,
          isBlockquote: false,
          isLink: false,
          canLink: false,
          canUnlink: false,
          canUndo: false,
          canRedo: false,
          isTable: false,
          canTable: false,
          canImage: false,
          isMath: false,
          isInlineMath: false,
          canMath: false,
          isTaskList: false
        }
      }

      return {
        isBold: editor.isActive('bold') ?? false,
        canBold: editor.can().chain().toggleBold().run() ?? false,
        isItalic: editor.isActive('italic') ?? false,
        canItalic: editor.can().chain().toggleItalic().run() ?? false,
        isUnderline: editor.isActive('underline') ?? false,
        canUnderline: editor.can().chain().toggleUnderline().run() ?? false,
        isStrike: editor.isActive('strike') ?? false,
        canStrike: editor.can().chain().toggleStrike().run() ?? false,
        isCode: editor.isActive('code') ?? false,
        canCode: editor.can().chain().toggleCode().run() ?? false,
        canClearMarks: editor.can().chain().unsetAllMarks().run() ?? false,
        isParagraph: editor.isActive('paragraph') ?? false,
        isHeading1: editor.isActive('heading', { level: 1 }) ?? false,
        isHeading2: editor.isActive('heading', { level: 2 }) ?? false,
        isHeading3: editor.isActive('heading', { level: 3 }) ?? false,
        isHeading4: editor.isActive('heading', { level: 4 }) ?? false,
        isHeading5: editor.isActive('heading', { level: 5 }) ?? false,
        isHeading6: editor.isActive('heading', { level: 6 }) ?? false,
        isBulletList: editor.isActive('bulletList') ?? false,
        isOrderedList: editor.isActive('orderedList') ?? false,
        isCodeBlock: editor.isActive('codeBlock') ?? false,
        isBlockquote: editor.isActive('blockquote') ?? false,
        isLink: (editor.isActive('enhancedLink') || editor.isActive('link')) ?? false,
        canLink: editor.can().chain().setEnhancedLink({ href: '' }).run() ?? false,
        canUnlink: editor.can().chain().unsetEnhancedLink().run() ?? false,
        canUndo: editor.can().chain().undo().run() ?? false,
        canRedo: editor.can().chain().redo().run() ?? false,
        isTable: editor.isActive('table') ?? false,
        canTable: editor.can().chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() ?? false,
        canImage: editor.can().chain().setImage({ src: '' }).run() ?? false,
        isMath: editor.isActive('blockMath') ?? false,
        isInlineMath: editor.isActive('inlineMath') ?? false,
        canMath: true,
        isTaskList: editor.isActive('taskList') ?? false
      }
    }
  })

  const setMarkdown = useCallback(
    (content: string) => {
      try {
        setMarkdownState(content)
        onChange?.(content)

        const convertedHtml = markdownToHtml(content)

        editor.commands.setContent(convertedHtml)

        onHtmlChange?.(convertedHtml)
      } catch (error) {
        logger.error('Error setting markdown content:', error as Error)
      }
    },
    [editor.commands, onChange, onHtmlChange]
  )

  const setHtml = useCallback(
    (htmlContent: string) => {
      try {
        const convertedMarkdown = htmlToMarkdown(htmlContent)
        setMarkdownState(convertedMarkdown)
        onChange?.(convertedMarkdown)

        editor.commands.setContent(htmlContent)

        onHtmlChange?.(htmlContent)
      } catch (error) {
        logger.error('Error setting HTML content:', error as Error)
      }
    },
    [editor.commands, onChange, onHtmlChange]
  )

  const clear = useCallback(() => {
    setMarkdownState('')
    onChange?.('')
    onHtmlChange?.('')
  }, [onChange, onHtmlChange])

  // Utility methods
  const toHtml = useCallback((content: string): string => {
    try {
      return markdownToHtml(content)
    } catch (error) {
      logger.error('Error converting markdown to HTML:', error as Error)
      return ''
    }
  }, [])

  const toSafeHtml = useCallback((content: string): string => {
    try {
      return markdownToHtml(content)
    } catch (error) {
      logger.error('Error converting markdown to safe HTML:', error as Error)
      return ''
    }
  }, [])

  const toMarkdown = useCallback((htmlContent: string): string => {
    try {
      return htmlToMarkdown(htmlContent)
    } catch (error) {
      logger.error('Error converting HTML to markdown:', error as Error)
      return ''
    }
  }, [])

  const getPreviewText = useCallback(
    (content: string, maxLength?: number): string => {
      try {
        return markdownToPreviewText(content, maxLength || previewLength)
      } catch (error) {
        logger.error('Error generating preview text:', error as Error)
        return ''
      }
    },
    [previewLength]
  )

  return {
    // Editor instance
    editor,

    // State
    markdown,
    html,
    previewText,
    isMarkdown,
    disabled: !editable,
    formattingState,
    tableOfContentsItems,
    linkEditor: {
      show: linkEditorState.show,
      position: linkEditorState.position,
      link: linkEditorState.link,
      onSave: handleLinkSave,
      onRemove: handleLinkRemove,
      onCancel: handleLinkCancel
    },

    // Actions
    setMarkdown,
    setHtml,
    clear,

    // Utilities
    toHtml,
    toSafeHtml,
    toMarkdown,
    getPreviewText
  }
}
