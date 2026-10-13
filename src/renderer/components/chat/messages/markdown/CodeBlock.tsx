import type { Node } from 'mdast'
import React, { memo, type ReactNode, useCallback, useMemo } from 'react'

import { MessageHtmlArtifact } from '@renderer/components/chat/messages/blocks/MessageHtmlArtifact'
import { CodeBlockView } from '@renderer/components/CodeBlockView/CodeBlockView'
import { MAX_COLLAPSED_CODE_HEIGHT } from '@renderer/components/CodeBlockView/constants'
import HtmlArtifactsCard from '@renderer/components/CodeBlockView/HtmlArtifactsCard'
import { INLINE_CODE_CLASS, useMarkdownCode } from '@renderer/components/markdown'
import { getCodeBlockId } from '@renderer/utils/markdownLight'

import { useMessageRenderConfig, useOptionalMessageListActions } from '../MessageListProvider'
import type { InlineHtmlPreviewMode } from './ChatMarkdown'
import { classifyHtmlArtifactSource } from './plugins/remarkHtmlArtifact'

interface Props {
  /**
   * Strings for fences and non-animated content; animate-span elements for
   * streamed inline code — and they persist post-settle (streamdown#570).
   */
  children?: ReactNode
  className?: string
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  node?: Omit<Node, 'type'>
  blockId: string // Message block id
  isStreaming?: boolean
  [key: string]: any
}

const mergeClassNames = (...classNames: Array<string | undefined>) => classNames.filter(Boolean).join(' ')

const CodeBlock: React.FC<Props> = ({
  children: rawChildren,
  className,
  inlineHtmlPreviewMode,
  node,
  blockId,
  isStreaming = false
}) => {
  const children = rawChildren ?? ''
  const { text, language, isIncomplete } = useMarkdownCode(children, className)
  const { codeFancyBlock } = useMessageRenderConfig()

  // 代码块 id
  const id = useMemo(() => getCodeBlockId(node?.position?.start), [node?.position?.start])

  const actions = useOptionalMessageListActions()
  const canSaveCodeBlock = !!id && !!actions?.saveCodeBlock

  const handleSave = useCallback(
    (newContent: string) => {
      if (id != null) {
        void actions?.saveCodeBlock?.({
          msgBlockId: blockId,
          originalContent: text,
          newContent
        })
      }
    },
    [actions, blockId, id, text]
  )

  if (language !== null) {
    // Fancy code block
    if (codeFancyBlock) {
      if (language.toLowerCase() === 'html') {
        const isHtmlArtifactStreaming = inlineHtmlPreviewMode === 'generating' || isStreaming || isIncomplete
        // The single classification for the whole artifact pipeline: it picks the streaming
        // surface here and travels down as `kind` to decide the safety gate once complete.
        const htmlKind = classifyHtmlArtifactSource(text)

        if (inlineHtmlPreviewMode) {
          // Too short to classify yet — render nothing rather than pick a surface we would
          // have to swap out a few characters later.
          if (isHtmlArtifactStreaming && htmlKind === undefined) return null

          if (isHtmlArtifactStreaming && htmlKind === 'document') {
            return (
              <CodeBlockView
                language={language}
                editable={false}
                isStreaming={isHtmlArtifactStreaming}
                maxHeight={MAX_COLLAPSED_CODE_HEIGHT}
                showToolbar={false}>
                {text}
              </CodeBlockView>
            )
          }

          return (
            <MessageHtmlArtifact
              artifactId={`${blockId}:${id}`}
              html={text}
              onSave={handleSave}
              editable={canSaveCodeBlock}
              kind={htmlKind ?? 'fragment'}
              isStreaming={isHtmlArtifactStreaming}
            />
          )
        }

        return (
          <HtmlArtifactsCard
            html={text}
            onSave={handleSave}
            editable={canSaveCodeBlock}
            isStreaming={isHtmlArtifactStreaming}
          />
        )
      }
    }

    return (
      <CodeBlockView
        language={language}
        onSave={handleSave}
        editable={canSaveCodeBlock}
        isStreaming={isStreaming || isIncomplete}>
        {text}
      </CodeBlockView>
    )
  }

  return <code className={mergeClassNames(className, INLINE_CODE_CLASS)}>{children}</code>
}

export default memo(CodeBlock)
