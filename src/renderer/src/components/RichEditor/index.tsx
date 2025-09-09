import { loggerService } from '@logger'
import { ContentSearch, type ContentSearchRef } from '@renderer/components/ContentSearch'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { EditorContent } from '@tiptap/react'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import Scrollbar from '../Scrollbar'
import {
  getAllCommands,
  getToolbarCommands,
  registerCommand,
  registerToolbarCommand,
  setCommandAvailability,
  unregisterCommand,
  unregisterToolbarCommand
} from './command'
import { ActionMenu, type ActionMenuItem } from './components/ActionMenu'
// DragContextMenuWrapper 已被 TipTap 扩展替代
import LinkEditor from './components/LinkEditor'
import PlusButton from './components/PlusButton'
import { EditorContent as StyledEditorContent, RichEditorWrapper } from './styles'
import { ToC } from './TableOfContent'
import { Toolbar } from './toolbar'
import type { FormattingCommand, RichEditorProps, RichEditorRef } from './types'
import { useRichEditor } from './useRichEditor'
const logger = loggerService.withContext('RichEditor')

const RichEditor = ({
  ref,
  initialContent = '',
  placeholder = t('richEditor.placeholder'),
  onContentChange,
  onHtmlChange,
  onMarkdownChange,
  onBlur,
  editable = true,
  className = '',
  showToolbar = true,
  minHeight,
  maxHeight,
  initialCommands,
  onCommandsReady,
  showTableOfContents = false,
  enableContentSearch = false,
  isFullWidth = false,
  fontFamily = 'default',
  fontSize = 16
  // toolbarItems: _toolbarItems // TODO: Implement custom toolbar items
}: RichEditorProps & { ref?: React.RefObject<RichEditorRef | null> }) => {
  // Use the rich editor hook for complete editor management
  const {
    editor,
    markdown,
    html,
    formattingState,
    tableOfContentsItems,
    linkEditor,
    setMarkdown,
    setHtml,
    clear,
    getPreviewText
  } = useRichEditor({
    initialContent,
    onChange: onMarkdownChange,
    onHtmlChange,
    onContentChange,
    onBlur,
    placeholder,
    editable,
    scrollParent: () => scrollContainerRef.current,
    onShowTableActionMenu: ({ position, actions }) => {
      const iconMap: Record<string, React.ReactNode> = {
        insertRowBefore: <ArrowUp size={16} />,
        insertColumnBefore: <ArrowLeft size={16} />,
        insertRowAfter: <ArrowDown size={16} />,
        insertColumnAfter: <ArrowRight size={16} />,
        deleteRow: <Trash2 size={16} />,
        deleteColumn: <Trash2 size={16} />
      }

      const items: ActionMenuItem[] = actions.map((a, idx) => ({
        key: String(idx),
        label: a.label,
        icon: iconMap[a.id],
        onClick: a.action
      }))
      setTableActionMenu({ show: true, position, items })
    }
  })

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const contentSearchRef = useRef<ContentSearchRef>(null)

  const onKeyDownEditor = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!enableContentSearch) return
      const isModF = (event.metaKey || event.ctrlKey) && (event.key === 'f' || event.key === 'F')
      if (isModF) {
        event.preventDefault()
        const selectedText = window.getSelection()?.toString().trim()
        contentSearchRef.current?.enable(selectedText)
        return
      }
      if (event.key === 'Escape') {
        contentSearchRef.current?.disable()
      }
    },
    [enableContentSearch]
  )

  useHotkeys(
    'mod+f',
    (event) => {
      if (!enableContentSearch) return
      event.preventDefault()
      const selectedText = window.getSelection()?.toString().trim()
      contentSearchRef.current?.enable(selectedText)
    },
    { enableOnContentEditable: true, preventDefault: true, enabled: enableContentSearch },
    [enableContentSearch]
  )
  useHotkeys(
    'esc',
    () => {
      if (!enableContentSearch) return
      contentSearchRef.current?.disable()
    },
    { enableOnContentEditable: true, enabled: enableContentSearch },
    [enableContentSearch]
  )

  // Table action menu state
  const [tableActionMenu, setTableActionMenu] = useState<{
    show: boolean
    position: { x: number; y: number }
    items: ActionMenuItem[]
  }>({
    show: false,
    position: { x: 0, y: 0 },
    items: []
  })

  // Register initial commands on mount
  useEffect(() => {
    if (initialCommands) {
      initialCommands.forEach((cmd) => {
        if (cmd.showInToolbar) {
          registerToolbarCommand(cmd)
        } else {
          registerCommand(cmd)
        }
      })
    }
  }, [initialCommands])

  // Call onCommandsReady when editor is ready
  useEffect(() => {
    if (editor && onCommandsReady) {
      const commandAPI = {
        registerCommand,
        registerToolbarCommand,
        unregisterCommand,
        unregisterToolbarCommand,
        setCommandAvailability
      }
      onCommandsReady(commandAPI)
    }
  }, [editor, onCommandsReady])

  // Handle drag end callback to clean up draggable attribute
  const handleDragEnd = useCallback((e: DragEvent) => {
    // Clean up draggable attribute from the drag handle element
    const target = e.target as HTMLElement
    if (target && target.classList.contains('drag-handle')) {
      target.removeAttribute('draggable')
    }
  }, [])

  const closeTableActionMenu = () => {
    setTableActionMenu({
      show: false,
      position: { x: 0, y: 0 },
      items: []
    })
  }

  const handlePlusButtonClick = useCallback(
    (event: MouseEvent) => {
      // 防止事件冒泡
      event.preventDefault()
      event.stopPropagation()

      // 使用 setTimeout 确保在下一个事件循环中执行
      setTimeout(() => {
        if (editor && !editor.isDestroyed) {
          // 聚焦编辑器并插入 '/'
          editor.commands.insertContent('/')
        }
      }, 10)
    },
    [editor]
  )

  const handleCommand = useCallback(
    (command: FormattingCommand) => {
      if (!editor) return

      switch (command) {
        case 'bold':
          editor.chain().focus().toggleBold().run()
          break
        case 'italic':
          editor.chain().focus().toggleItalic().run()
          break
        case 'underline':
          editor.chain().focus().toggleUnderline().run()
          break
        case 'strike':
          editor.chain().focus().toggleStrike().run()
          break
        case 'code':
          editor.chain().focus().toggleCode().run()
          break
        case 'clearMarks':
          editor.chain().focus().unsetAllMarks().run()
          break
        case 'paragraph':
          editor.chain().focus().setParagraph().run()
          break
        case 'heading1':
          editor.chain().focus().toggleHeading({ level: 1 }).run()
          break
        case 'heading2':
          editor.chain().focus().toggleHeading({ level: 2 }).run()
          break
        case 'heading3':
          editor.chain().focus().toggleHeading({ level: 3 }).run()
          break
        case 'heading4':
          editor.chain().focus().toggleHeading({ level: 4 }).run()
          break
        case 'heading5':
          editor.chain().focus().toggleHeading({ level: 5 }).run()
          break
        case 'heading6':
          editor.chain().focus().toggleHeading({ level: 6 }).run()
          break
        case 'bulletList':
          editor.chain().focus().toggleBulletList().run()
          break
        case 'orderedList':
          editor.chain().focus().toggleOrderedList().run()
          break
        case 'codeBlock':
          editor.chain().focus().toggleCodeBlock().run()
          break
        case 'blockquote':
          editor.chain().focus().toggleBlockquote().run()
          break
        case 'link': {
          const { selection } = editor.state
          const { from, to, $from } = selection

          // 如果当前已经是链接，则取消链接
          if (editor.isActive('enhancedLink')) {
            editor.chain().focus().unsetEnhancedLink().run()
          } else {
            // 获取当前段落的文本内容
            if (from !== to) {
              const selectedText = editor.state.doc.textBetween(from, to)
              if (selectedText.trim()) {
                const url = selectedText.trim().startsWith('http')
                  ? selectedText.trim()
                  : `https://${selectedText.trim()}`
                editor.chain().focus().setTextSelection({ from, to }).setEnhancedLink({ href: url }).run()
              }
            } else {
              const paragraphText = $from.parent.textContent

              // 如果段落有文本，将段落文本设置为链接
              if (paragraphText.trim()) {
                const url = paragraphText.trim().startsWith('http')
                  ? paragraphText.trim()
                  : `https://${paragraphText.trim()}`

                try {
                  const { $from } = selection
                  const start = $from.start()
                  const end = $from.end()
                  editor.chain().focus().setTextSelection({ from: start, to: end }).setEnhancedLink({ href: url }).run()
                } catch (error) {
                  logger.warn('Failed to set enhanced link:', error as Error)
                  editor.chain().focus().toggleEnhancedLink({ href: '' }).run()
                }
              } else {
                editor.chain().focus().toggleEnhancedLink({ href: '' }).run()
              }
            }
          }
          break
        }
        case 'undo':
          editor.chain().focus().undo().run()
          break
        case 'redo':
          editor.chain().focus().redo().run()
          break
        case 'blockMath': {
          // Math is handled by the MathInputDialog component in toolbar
          // This case is here for completeness but shouldn't be called directly
          break
        }
        case 'table':
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          break
        case 'image':
          // Image insertion is handled by the ImageUploader component in toolbar
          // This case is here for completeness but shouldn't be called directly
          break
        case 'taskList':
          editor.chain().focus().toggleTaskList().run()
      }
    },
    [editor]
  )

  // Expose editor methods via ref
  useImperativeHandle(
    ref,
    () => ({
      getContent: () => editor?.getText() || '',
      getHtml: () => html,
      getMarkdown: () => markdown,
      setContent: (content: string) => {
        editor?.commands.setContent(content)
      },
      setHtml: (htmlContent: string) => {
        setHtml(htmlContent)
      },
      setMarkdown: (markdownContent: string) => {
        setMarkdown(markdownContent)
      },
      focus: () => {
        editor?.commands.focus()
      },
      clear: () => {
        clear()
        editor?.commands.clearContent()
      },
      insertText: (text: string) => {
        editor?.commands.insertContent(text)
      },
      executeCommand: (command: string, value?: any) => {
        if (editor?.commands && command in editor.commands) {
          editor.commands[command](value)
        }
      },
      getPreviewText: (maxLength?: number) => {
        return getPreviewText(markdown, maxLength)
      },
      getScrollTop: () => {
        return scrollContainerRef.current?.scrollTop ?? 0
      },
      setScrollTop: (value: number) => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = value
        }
      },
      // Dynamic command management
      registerCommand,
      registerToolbarCommand,
      unregisterCommand,
      unregisterToolbarCommand,
      setCommandAvailability,
      getAllCommands,
      getToolbarCommands
    }),
    [editor, html, markdown, setHtml, setMarkdown, clear, getPreviewText]
  )

  return (
    <RichEditorWrapper
      className={`rich-editor-wrapper ${className}`}
      $minHeight={minHeight}
      $maxHeight={maxHeight}
      $isFullWidth={isFullWidth}
      $fontFamily={fontFamily}
      $fontSize={fontSize}
      onKeyDown={onKeyDownEditor}>
      {showToolbar && (
        <Toolbar
          editor={editor}
          formattingState={formattingState}
          onCommand={handleCommand}
          scrollContainer={scrollContainerRef}
        />
      )}
      <Scrollbar ref={scrollContainerRef} style={{ flex: 1, display: 'flex' }}>
        <StyledEditorContent>
          <PlusButton editor={editor} onElementClick={handlePlusButtonClick}>
            <Tooltip title={t('richEditor.plusButton')}>
              <Plus />
            </Tooltip>
          </PlusButton>
          <DragHandle editor={editor} onElementDragEnd={handleDragEnd}>
            <Tooltip title={t('richEditor.dragHandle')}>
              <GripVertical />
            </Tooltip>
          </DragHandle>
          <EditorContent style={{ height: '100%' }} editor={editor} />
        </StyledEditorContent>
      </Scrollbar>
      {enableContentSearch && (
        <ContentSearch
          ref={contentSearchRef}
          searchTarget={scrollContainerRef as React.RefObject<HTMLElement>}
          filter={{
            acceptNode(node) {
              const inEditor = (node as Node).parentElement?.closest('.ProseMirror')
              return inEditor ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
            }
          }}
          includeUser={false}
          onIncludeUserChange={() => {}}
          showUserToggle={false}
          positionMode="absolute"
        />
      )}
      {showTableOfContents && (
        <ToC items={tableOfContentsItems} editor={editor} scrollContainerRef={scrollContainerRef} />
      )}
      <ActionMenu
        show={tableActionMenu.show}
        position={tableActionMenu.position}
        items={tableActionMenu.items}
        onClose={closeTableActionMenu}
      />
      <LinkEditor
        visible={linkEditor.show}
        position={linkEditor.position}
        link={linkEditor.link}
        onSave={linkEditor.onSave}
        onRemove={linkEditor.onRemove}
        onCancel={linkEditor.onCancel}
      />
    </RichEditorWrapper>
  )
}

RichEditor.displayName = 'RichEditor'

export default RichEditor
