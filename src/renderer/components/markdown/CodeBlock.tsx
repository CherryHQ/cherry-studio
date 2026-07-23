import { CodeBlockView } from '@renderer/components/CodeBlockView/CodeBlockView'
import HtmlArtifactsCard from '@renderer/components/CodeBlockView/HtmlArtifactsCard'
import { useMarkdownHost } from '@renderer/hooks/useMarkdownHost'
import { isInlineFilePath, normalizeInlineFilePath } from '@renderer/utils/filePath'
import { getCodeBlockId } from '@renderer/utils/markdown'
import { isWin } from '@renderer/utils/platform'
import type { Node } from 'mdast'
import React, { memo, useCallback, useMemo } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'

interface Props {
  children: string
  className?: string
  node?: Omit<Node, 'type'>
  blockId: string // Message block id
  isStreaming?: boolean
  [key: string]: any
}

const INLINE_CODE_CLASS =
  'inline-flex items-center whitespace-pre-wrap! break-words! rounded-[5px] px-1! py-0.5! text-[0.95em]! leading-normal'
const INLINE_FILE_PATH_CODE_CLASS = `${INLINE_CODE_CLASS} max-w-full align-middle break-all! [&>span]:translate-y-px`

const mergeClassNames = (...classNames: Array<string | undefined>) => classNames.filter(Boolean).join(' ')

const CodeBlock: React.FC<Props> = ({ children, className, node, blockId, isStreaming = false }) => {
  const languageMatch = /language-([\w-+]+)/.exec(className || '')
  const isMultiline = children?.includes('\n')
  const detectedLanguage = languageMatch?.[1] ?? (isMultiline ? 'text' : null)
  const language = useMemo(() => {
    return detectedLanguage !== 'xml'
      ? detectedLanguage
      : /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(children)
        ? 'svg'
        : detectedLanguage
  }, [children, detectedLanguage])
  const { codeFancyBlock, saveCodeBlock, readonly, renderInlineFilePath, renderHtmlArtifact } = useMarkdownHost()
  const isIncomplete = useIsCodeFenceIncomplete()

  // 代码块 id
  const id = useMemo(() => getCodeBlockId(node?.position?.start), [node?.position?.start])

  const canSaveCodeBlock = !!id && !!saveCodeBlock && readonly !== true

  const handleSave = useCallback(
    (newContent: string) => {
      if (id != null) {
        void saveCodeBlock?.({
          msgBlockId: blockId,
          codeBlockId: id,
          newContent
        })
      }
    },
    [saveCodeBlock, blockId, id]
  )

  // A plain text fence may be the model's way to present a single generated file or directory path.
  // The host decides how to render it (e.g. an interactive file link); off-host it falls through
  // to a normal inline code element.
  if (
    !isWin &&
    (language === null || language === 'text') &&
    typeof children === 'string' &&
    isInlineFilePath(children) &&
    renderInlineFilePath
  ) {
    return (
      <code className={mergeClassNames(className, INLINE_FILE_PATH_CODE_CLASS)}>
        {renderInlineFilePath(normalizeInlineFilePath(children))}
      </code>
    )
  }

  if (language !== null) {
    // Fancy code block
    if (codeFancyBlock) {
      if (language.toLowerCase() === 'html') {
        const isHtmlArtifactStreaming = isStreaming || isIncomplete

        // The host may render HTML fences as an inline immersive preview (chat); otherwise
        // fall back to the default artifact card. Keeps this shared block chat-agnostic.
        if (renderHtmlArtifact) {
          return renderHtmlArtifact(children, { isStreaming: isHtmlArtifactStreaming })
        }

        return (
          <HtmlArtifactsCard
            html={children}
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
        {children}
      </CodeBlockView>
    )
  }

  return <code className={mergeClassNames(className, INLINE_CODE_CLASS)}>{children}</code>
}

export default memo(CodeBlock)
