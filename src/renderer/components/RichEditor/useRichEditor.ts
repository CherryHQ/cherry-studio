import 'katex/dist/katex.min.css'

import { loggerService } from '@logger'
import type { FormattingState } from '@renderer/components/RichEditor/types'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import type { Editor } from '@tiptap/core'
import { migrateMathStrings } from '@tiptap/extension-mathematics'
import type { TableOfContentDataItem } from '@tiptap/extension-table-of-contents'
import { useEditor, useEditorState } from '@tiptap/react'
import { t } from 'i18next'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { createRichEditorExtensions } from './createExtensions'
import { blobToArrayBuffer, compressImage, shouldCompressImage } from './helpers/imageUtils'
import { pickInlinePasteContent } from './helpers/markdownPaste'

const logger = loggerService.withContext('useRichEditor')

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
  /** Clear all content */
  clear: () => void
}

/**
 * Custom hook for managing rich text content. Markdown is the single source of truth: parsing and
 * serialization go through the native @tiptap/markdown AST (see createRichEditorExtensions).
 */
export const useRichEditor = (options: UseRichEditorOptions = {}): UseRichEditorReturn => {
  const {
    initialContent = '',
    onChange,
    onHtmlChange,
    onContentChange,
    onBlur,
    onPaste,
    placeholder = '',
    editable = true,
    enableSpellCheck = false,
    onShowTableActionMenu,
    scrollParent
  } = options

  const [markdown, setMarkdownState] = useState<string>(initialContent)

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

  // TipTap editor extensions. The schema/markdown hooks live in createRichEditorExtensions (shared
  // with the round-trip tests); only the interactive callbacks below are wired up from the hook.
  const extensions = useMemo(
    () =>
      createRichEditorExtensions({
        editable,
        placeholder,
        shikiTheme: activeShikiTheme,
        onLinkHover: handleLinkHover,
        onLinkHoverEnd: handleLinkHoverEnd,
        tocScrollParent: scrollParent,
        onTocUpdate: (content) => {
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
        mathBlockOptions: {
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
        mathInlineOptions: {
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
        },
        onRowActionClick: ({ rowIndex, position }) => {
          showTableActionMenu('row', rowIndex, position)
        },
        onColumnActionClick: ({ colIndex, position }) => {
          showTableActionMenu('column', colIndex, position)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeholder, activeShikiTheme, handleLinkHover, handleLinkHoverEnd]
  )

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions,
    content: markdown || '',
    contentType: 'markdown',
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
            void handleImagePaste(file)
            return true
          }
        }

        // Default behavior for non-code blocks: insert clipboard text via the native markdown AST
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (text) {
          const { $from } = selection
          const atStartOfLine = $from.parentOffset === 0
          const inEmptyParagraph = $from.parent.type.name === 'paragraph' && $from.parent.textContent === ''
          const hasMultipleLines = text.includes('\n')

          if (!atStartOfLine && !inEmptyParagraph && !hasMultipleLines) {
            // Inline paste inside a non-empty block: parse the markdown so markers like **bold** /
            // [text](url) become real marks (otherwise getMarkdown would later escape the literal
            // text), but splice in only the inline content so the paste isn't wrapped in a new block.
            // Fall back to verbatim text for block-y lines (heading/list/etc.) that have no inline form.
            const inline = pickInlinePasteContent(editor.markdown?.parse(text))
            if (inline) {
              editor.commands.insertContent(inline)
            } else {
              const tr = view.state.tr.insertText(text, selection.from, selection.to)
              view.dispatch(tr)
            }
          } else {
            editor.commands.insertContent(text, { contentType: 'markdown' })
          }
          onPaste?.(text)
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
    onUpdate: ({ editor, transaction }) => {
      // Ignore non-user updates (initialization/mode toggles/programmatic transactions)
      // to avoid re-serializing markdown while switching view modes.
      if (!editable || !transaction.docChanged || !editor.isFocused) return

      const content = editor.getText()
      try {
        // Serialize straight from the ProseMirror doc via the native markdown AST.
        const convertedMarkdown = editor.getMarkdown()
        setMarkdownState(convertedMarkdown)
        onChange?.(convertedMarkdown)

        onContentChange?.(content)
        if (onHtmlChange) {
          onHtmlChange(editor.getHTML())
        }
      } catch (error) {
        logger.error('Error serializing editor content to markdown:', error as Error)
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

      onShowTableActionMenu?.({ type, index, position: finalPosition, actions })
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

        // Parse markdown straight into the ProseMirror doc via the native AST.
        editor.commands.setContent(content, { contentType: 'markdown' })

        onHtmlChange?.(editor.getHTML())
      } catch (error) {
        logger.error('Error setting markdown content:', error as Error)
      }
    },
    [editor, onChange, onHtmlChange]
  )

  const clear = useCallback(() => {
    setMarkdownState('')
    onChange?.('')
    onHtmlChange?.('')
  }, [onChange, onHtmlChange])

  return {
    // Editor instance
    editor,

    // State
    markdown,
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
    clear
  }
}
