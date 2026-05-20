import { ClickableFilePath } from '@renderer/components/chat/messages/tools/agent/ClickableFilePath'
import { CodeBlockView, HtmlArtifactsCard } from '@renderer/components/CodeBlockView'
import { isWin } from '@renderer/config/constant'
import { getCodeBlockId } from '@renderer/utils/markdown'
import type { Node } from 'mdast'
import React, { memo, useCallback, useMemo } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'

import { useMessageRenderConfig, useOptionalMessageListActions } from '../MessageListProvider'
import { isInlineAbsoluteFilePath } from '../utils/filePath'

interface Props {
  children: string
  className?: string
  node?: Omit<Node, 'type'>
  blockId: string // Message block id
  [key: string]: any
}

const INLINE_CODE_CLASS =
  'inline-flex items-center whitespace-pre-wrap! break-words! rounded-[5px] px-1! py-0.5! text-[0.95em]! leading-normal'
const INLINE_FILE_PATH_CODE_CLASS = `${INLINE_CODE_CLASS} max-w-full align-middle break-all! [&>span]:translate-y-px`

const mergeClassNames = (...classNames: Array<string | undefined>) => classNames.filter(Boolean).join(' ')

const CodeBlock: React.FC<Props> = ({ children, className, node, blockId }) => {
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
  const { codeFancyBlock } = useMessageRenderConfig()
  const isIncomplete = useIsCodeFenceIncomplete()

  // 代码块 id
  const id = useMemo(() => getCodeBlockId(node?.position?.start), [node?.position?.start])

  const actions = useOptionalMessageListActions()

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

  if (language !== null) {
    // Fancy code block
    if (codeFancyBlock) {
      if (language === 'html') {
        return <HtmlArtifactsCard html={children} onSave={handleSave} isStreaming={isIncomplete} />
      }
    }

    return (
      <CodeBlockView language={language} onSave={handleSave}>
        {children}
      </CodeBlockView>
    )
  }

  // Detect inline code that looks like an absolute file path (e.g. /Users/foo/bar.tsx)
  // On Windows, Unix-style paths are not valid local paths, so skip detection there.
  if (!isWin && typeof children === 'string' && isInlineAbsoluteFilePath(children)) {
    return (
      <code className={mergeClassNames(className, INLINE_FILE_PATH_CODE_CLASS)}>
        <ClickableFilePath path={children} />
      </code>
    )
  }

  return <code className={mergeClassNames(className, INLINE_CODE_CLASS)}>{children}</code>
}

export default memo(CodeBlock)
