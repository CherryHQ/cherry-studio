import { MessageHtmlArtifact } from '@renderer/components/chat/messages/blocks/MessageHtmlArtifact'
import { isKnownNavigationPath, NavigateToolInline } from '@renderer/components/chat/messages/tools/agent'
import { ClickableFilePath } from '@renderer/components/chat/messages/tools/shared/ClickableFilePath'
import { CodeBlockView } from '@renderer/components/CodeBlockView/CodeBlockView'
import { MAX_COLLAPSED_CODE_HEIGHT } from '@renderer/components/CodeBlockView/constants'
import HtmlArtifactsCard from '@renderer/components/CodeBlockView/HtmlArtifactsCard'
import { isInlineFilePath, normalizeInlineFilePath } from '@renderer/utils/filePath'
import { getCodeBlockId } from '@renderer/utils/markdownLight'
import { isWin } from '@renderer/utils/platform'
import { getNodeText } from '@renderer/utils/reactNodeText'
import type { Node } from 'mdast'
import React, { memo, type ReactNode, useCallback, useMemo } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'

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

const INLINE_CODE_CLASS = 'whitespace-pre-wrap! break-words! rounded-[5px] px-1! py-0.5! text-[0.95em]! leading-normal'
const INLINE_FILE_PATH_CODE_CLASS = `${INLINE_CODE_CLASS} inline-flex max-w-full items-center align-middle break-all! [&>span]:translate-y-px`

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
  // Each stream tick rebuilds the animate spans, so `children` gets a fresh
  // reference and memoizing the walk would never hit; recompute per render.
  const text = getNodeText(children)
  const languageMatch = /language-([\w-+]+)/.exec(className || '')
  const isMultiline = text.includes('\n')
  const detectedLanguage = languageMatch?.[1] ?? (isMultiline ? 'text' : null)
  const language = useMemo(() => {
    return detectedLanguage !== 'xml'
      ? detectedLanguage
      : /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(text)
        ? 'svg'
        : detectedLanguage
  }, [text, detectedLanguage])
  const { codeFancyBlock } = useMessageRenderConfig()
  const isIncomplete = useIsCodeFenceIncomplete()

  // 代码块 id
  const id = useMemo(() => getCodeBlockId(node?.position?.start), [node?.position?.start])

  const actions = useOptionalMessageListActions()
  const canSaveCodeBlock = !!id && !!actions?.saveCodeBlock

  const handleSave = useCallback(
    (newContent: string) => {
      if (id != null) {
        void actions?.saveCodeBlock?.({
          msgBlockId: blockId,
          codeBlockId: id,
          newContent
        })
      }
    },
    [actions, blockId, id]
  )

  // Widget swaps race the per-tick span rebuild, so they wait for this block
  // to stop growing (an unclosed tail fence); part-level state is too coarse.
  const inlinePath = !isIncomplete && (language === null || language === 'text') ? normalizeInlineFilePath(text) : null

  if (inlinePath && isKnownNavigationPath(inlinePath)) {
    return <NavigateToolInline input={{ path: inlinePath }} />
  }

  // A plain text fence may be the model's way to present a single generated file or directory path.
  if (!isWin && inlinePath && isInlineFilePath(text)) {
    return (
      <code className={mergeClassNames(className, INLINE_FILE_PATH_CODE_CLASS)}>
        <ClickableFilePath path={inlinePath} />
      </code>
    )
  }

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
