import 'katex/dist/katex.min.css'

import { TableKit } from '@cherrystudio/extension-table-plus'
import { loggerService } from '@logger'
import type { FormattingState } from '@renderer/components/RichEditor/types'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import {
  htmlToMarkdown,
  isMarkdownContent,
  markdownToHtml,
  markdownToPreviewText,
  markdownToSafeHtml,
  sanitizeHtml
} from '@renderer/utils/markdownConverter'
import type { Editor } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { migrateMathStrings } from '@tiptap/extension-mathematics'
import Mention from '@tiptap/extension-mention'
import Typography from '@tiptap/extension-typography'
import { useEditor, useEditorState } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { commandSuggestion } from './command'
import { CodeBlockShiki } from './extensions/code-block-shiki/code-block-shiki'
import { EnhancedImage } from './extensions/enhanced-image'
import { EnhancedMath } from './extensions/enhanced-math'
import { Placeholder } from './extensions/placeholder'

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
  /** Maximum length for preview text */
  previewLength?: number
  /** Placeholder text when editor is empty */
  placeholder?: string
  /** Whether the editor is editable */
  editable?: boolean
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
    previewLength = 50,
    placeholder = '',
    editable = true
  } = options

  const [markdown, setMarkdownState] = useState<string>(initialContent)

  // Get theme and language mapping from CodeStyleProvider
  const { activeShikiTheme, languageMap } = useCodeStyle()

  // TipTap editor extensions
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        },
        codeBlock: false
      }),
      CodeBlockShiki.configure({
        theme: activeShikiTheme,
        defaultLanguage: 'text'
      }),
      EnhancedMath.configure({
        blockOptions: {
          onClick: (node, pos) => {
            const event = new CustomEvent('openMathDialog', {
              detail: {
                defaultValue: node.attrs.latex || '',
                onSubmit: () => {
                  editor.commands.focus()
                },
                onFormulaChange: (formula: string) => {
                  editor.chain().setNodeSelection(pos).updateBlockMath({ latex: formula }).run()
                }
              }
            })
            window.dispatchEvent(event)
            return true
          }
        },
        inlineOptions: {
          onClick: (node, pos) => {
            const event = new CustomEvent('openMathDialog', {
              detail: {
                defaultValue: node.attrs.latex || '',
                onSubmit: () => {
                  editor.commands.focus()
                },
                onFormulaChange: (formula: string) => {
                  editor.chain().setNodeSelection(pos).updateInlineMath({ latex: formula }).run()
                }
              }
            })
            window.dispatchEvent(event)
            return true
          }
        }
      }),
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
        includeChildren: false
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'mention'
        },
        suggestion: commandSuggestion
      }),
      Typography,
      EnhancedImage,
      TableKit.configure({
        table: {
          resizable: true,
          allowTableNodeSelection: true
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
    [placeholder, activeShikiTheme, languageMap]
  )

  const html = useMemo(() => {
    if (!markdown) return ''
    return markdownToSafeHtml(markdown)
  }, [markdown])

  const previewText = useMemo(() => {
    if (!markdown) return ''
    return markdownToPreviewText(markdown, previewLength)
  }, [markdown, previewLength])

  const isMarkdown = useMemo(() => {
    return isMarkdownContent(markdown)
  }, [markdown])

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions,
    content: html || '',
    editable: editable,
    onUpdate: ({ editor }) => {
      const content = editor.getText()
      const htmlContent = editor.getHTML()
      try {
        const convertedMarkdown = htmlToMarkdown(htmlContent)
        setMarkdownState(convertedMarkdown)
        onChange?.(convertedMarkdown)

        onContentChange?.(content)
        if (onHtmlChange) {
          const safeHtml = sanitizeHtml(htmlContent)
          onHtmlChange(safeHtml)
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

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(editable)
      if (editable) {
        try {
          setTimeout(() => {
            if (editor && !editor.isDestroyed) {
              editor.commands.focus('end')
            }
          }, 0)
        } catch (error) {
          logger.warn('Could not set cursor to end after enabling editable:', error as Error)
        }
      }
    }
  }, [editor, editable])

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
      if (!editor) {
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
          canMath: false
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
        isLink: editor.isActive('link') ?? false,
        canLink: editor.can().chain().setLink({ href: '' }).run() ?? false,
        canUnlink: editor.can().chain().unsetLink().run() ?? false,
        canUndo: editor.can().chain().undo().run() ?? false,
        canRedo: editor.can().chain().redo().run() ?? false,
        isTable: editor.isActive('table') ?? false,
        canTable: editor.can().chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() ?? false,
        canImage: editor.can().chain().setImage({ src: '' }).run() ?? false,
        isMath: editor.isActive('blockMath') ?? false,
        isInlineMath: editor.isActive('inlineMath') ?? false,
        canMath: true
      }
    }
  })

  const setMarkdown = useCallback(
    (content: string) => {
      try {
        setMarkdownState(content)
        onChange?.(content)

        if (onHtmlChange && content) {
          const convertedHtml = markdownToSafeHtml(content)
          onHtmlChange(convertedHtml)
        }
      } catch (error) {
        logger.error('Error setting markdown content:', error as Error)
      }
    },
    [onChange, onHtmlChange]
  )

  const setHtml = useCallback(
    (htmlContent: string) => {
      try {
        const convertedMarkdown = htmlToMarkdown(htmlContent)
        setMarkdownState(convertedMarkdown)
        onChange?.(convertedMarkdown)

        // Trigger HTML change callback with safe HTML
        if (onHtmlChange) {
          const safeHtml = sanitizeHtml(htmlContent)
          onHtmlChange(safeHtml)
        }
      } catch (error) {
        logger.error('Error setting HTML content:', error as Error)
      }
    },
    [onChange, onHtmlChange]
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
      return markdownToSafeHtml(content)
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
