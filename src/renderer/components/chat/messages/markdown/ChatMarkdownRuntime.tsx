import { isEmpty } from 'es-toolkit/compat'
import { type FC, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Pluggable } from 'unified'

import {
  useMessageRenderConfig,
  useOptionalMessageListActions
} from '@renderer/components/chat/messages/MessageListProvider'
import { AppMarkdown, MarkdownHostProvider } from '@renderer/components/markdown'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { openFileTarget } from '@renderer/utils/openFileTarget'
import { isWin } from '@renderer/utils/platform'

import type { ChatMarkdownProps } from './ChatMarkdown'
import { ChatMarkdownRenderProvider } from './ChatMarkdownRenderContext'
import { CHAT_MARKDOWN_COMPONENTS } from './ChatMarkdownRenderers'
import { rehypeBareFilePaths } from './plugins/rehypeBareFilePaths'
import { remarkHtmlArtifact, transformMarkdownOutsideHtmlArtifacts } from './plugins/remarkHtmlArtifact'

const HTML_ARTIFACT_REMARK_PLUGINS: Pluggable[] = [remarkHtmlArtifact]
const FILE_PATH_REHYPE_PLUGINS: Pluggable[] = [[rehypeBareFilePaths, { platform: isWin ? 'windows' : 'posix' }]]
const EMPTY_CITATION_REGISTRY = new Map()

const ChatMarkdownRuntime: FC<ChatMarkdownProps> = ({
  block,
  inlineHtmlPreviewMode,
  postProcess,
  className,
  components,
  trustedCitations,
  linkifyFilePaths = false
}) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const actions = useOptionalMessageListActions()
  const isStreaming = block.status === 'streaming'
  const content =
    block.status === 'paused' && isEmpty(block.content) ? t('message.chat.completion.paused') : block.content
  const transformSource = useCallback(
    (source: string) => {
      const transform = (text: string) => {
        const cleaned = removeSvgEmptyLines(text)
        return postProcess ? postProcess(cleaned) : cleaned
      }
      return inlineHtmlPreviewMode ? transformMarkdownOutsideHtmlArtifacts(source, transform) : transform(source)
    },
    [inlineHtmlPreviewMode, postProcess]
  )

  const citationRegistry = useMemo(() => {
    if (!trustedCitations?.length) return EMPTY_CITATION_REGISTRY
    return new Map(trustedCitations.map((citation) => [citation.number, citation]))
  }, [trustedCitations])
  const mergedComponents = useMemo(
    () => (components ? { ...CHAT_MARKDOWN_COMPONENTS, ...components } : CHAT_MARKDOWN_COMPONENTS),
    [components]
  )
  const remarkPlugins = inlineHtmlPreviewMode ? HTML_ARTIFACT_REMARK_PLUGINS : undefined
  // Relative markdown links are workspace files only when the host has the
  // workspace-aware artifact opener. Other chat surfaces retain link hardening.
  const openFilePath = useMemo(
    () =>
      actions?.openArtifactFile
        ? (path: string) =>
            openFileTarget(path, {
              openArtifactFile: actions.openArtifactFile,
              openPath: actions.openPath,
              isDirectory: actions.isDirectory,
              onError: () => actions.notifyError?.(t('chat.input.tools.open_file_error', { path }))
            })
        : undefined,
    [actions, t]
  )

  return (
    <ChatMarkdownRenderProvider
      blockId={block.id}
      citationRegistry={citationRegistry}
      inlineHtmlPreviewMode={inlineHtmlPreviewMode}
      isStreaming={isStreaming}
      openFilePath={openFilePath}>
      <MarkdownHostProvider
        openFilePath={openFilePath}
        openExternalUrl={actions?.openExternalUrl}
        copyRichContent={actions?.copyRichContent}
        exportTableAsExcel={actions?.exportTableAsExcel}
        notifySuccess={actions?.notifySuccess}
        notifyError={actions?.notifyError}>
        <AppMarkdown
          id={block.id}
          isStreaming={isStreaming}
          paragraphLayout="justified"
          singleDollarMath={mathEnableSingleDollar}
          components={mergedComponents}
          remarkPlugins={remarkPlugins}
          rehypePlugins={linkifyFilePaths ? FILE_PATH_REHYPE_PLUGINS : undefined}
          className={className}
          transformSource={transformSource}>
          {content}
        </AppMarkdown>
      </MarkdownHostProvider>
    </ChatMarkdownRenderProvider>
  )
}

export default ChatMarkdownRuntime
