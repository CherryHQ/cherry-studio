import type { Editor } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/react'
import { Button } from 'antd'
import React, { useCallback } from 'react'
import styled from 'styled-components'

const LazyCompareBlockPopoverEditor = React.lazy(() => import('./CompareBlockPopoverEditor'))

interface CompareBlockNodeViewProps {
  node: any
  updateAttributes: (attributes: Record<string, any>) => void
  editor: Editor
}

export const CompareBlockNodeView: React.FC<CompareBlockNodeViewProps> = ({ node, updateAttributes, editor }) => {
  const collapsed = Boolean(node?.attrs?.collapsed ?? true)
  const content = String(node?.attrs?.content ?? '')

  const open = !collapsed

  const close = useCallback(() => {
    updateAttributes({ collapsed: true })
  }, [updateAttributes])

  const openPanel = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      updateAttributes({ collapsed: false })
    },
    [updateAttributes]
  )

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (open) {
        close()
      } else {
        openPanel(e)
      }
    },
    [open, close, openPanel]
  )

  const handleContentChange = useCallback(
    (markdown: string) => {
      updateAttributes({ content: markdown })
    },
    [updateAttributes]
  )

  const isEditable = editor.isEditable

  return (
    <NodeViewWrapper className="compare-block-wrapper">
      <CompareDividerButton
        type="text"
        onClick={isEditable ? handleToggle : undefined}
        onMouseDown={(e) => {
          // 避免 ProseMirror 抢焦点导致闪烁/选择异常
          e.preventDefault()
          e.stopPropagation()
        }}>
        <DividerInner aria-hidden="true">---</DividerInner>
      </CompareDividerButton>

      {open && isEditable && (
        <PopoverContainer
          onMouseDown={(e) => {
            e.stopPropagation()
          }}>
          <PopoverHeader>
            <PopoverTitle>对照留白区</PopoverTitle>
            <Button size="small" onClick={close}>
              收起
            </Button>
          </PopoverHeader>
          <PopoverBody>
            <React.Suspense fallback={<LoadingText>加载编辑器中…</LoadingText>}>
              <LazyCompareBlockPopoverEditor initialContent={content} onMarkdownChange={handleContentChange} />
            </React.Suspense>
          </PopoverBody>
        </PopoverContainer>
      )}
    </NodeViewWrapper>
  )
}

const CompareDividerButton = styled(Button)`
  width: 100%;
  padding: 0;
  border-radius: 0;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
  background: transparent;

  &:hover {
    background: var(--color-background-soft);
  }
`

const DividerInner = styled.div`
  width: 100%;
  position: relative;
  text-align: center;
  user-select: none;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    border-top: 1px solid var(--color-border);
    opacity: 0.6;
    transform: translateY(-50%);
  }

  /* 保留 --- 的“可识别感”，但让视觉更淡 */
  & {
    letter-spacing: 0.12em;
    font-size: 12px;
    opacity: 0.75;
  }
`

const PopoverContainer = styled.div`
  margin-top: 8px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-background) 92%, white);
`

const PopoverHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
`

const PopoverTitle = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  user-select: none;
`

const PopoverBody = styled.div`
  padding: 10px;
`

const LoadingText = styled.div`
  padding: 10px;
  font-size: 12px;
  color: var(--color-text-3);
`
