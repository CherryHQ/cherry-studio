import '@cherrystudio/ui/components/composites/markdown/styles'

import { defaultMarkdownPlugins, Markdown, StreamingMarkdown, withMath } from '@cherrystudio/ui'
import {
  useMessageRenderConfig,
  useOptionalMessageListActions
} from '@renderer/components/chat/messages/MessageListProvider'
import { remarkLatexMath } from '@renderer/components/markdown'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { openFileTarget } from '@renderer/utils/openFileTarget'
import { isEmpty } from 'es-toolkit/compat'
import { type FC, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import type { ChatMarkdownProps } from './ChatMarkdown'
import { ChatMarkdownRenderProvider } from './ChatMarkdownRenderContext'
import { CHAT_MARKDOWN_COMPONENTS, CHAT_MARKDOWN_COMPONENTS_WITH_STYLE } from './ChatMarkdownRenderers'
import { remarkHtmlArtifact, transformMarkdownOutsideHtmlArtifacts } from './plugins/remarkHtmlArtifact'
import { remarkLiteralAutolinkFix } from './plugins/remarkLiteralAutolinkFix'

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const REMARK_PLUGINS: Pluggable[] = [remarkLiteralAutolinkFix, remarkLatexMath]
const HTML_ARTIFACT_REMARK_PLUGINS: Pluggable[] = [remarkLiteralAutolinkFix, remarkLatexMath, remarkHtmlArtifact]
const EMPTY_CITATION_REGISTRY = new Map()
const MAX_ANIMATED_CONTENT_LENGTH = 64 * 1024
const MAX_STREAMING_TRANSFORM_LENGTH = 256 * 1024

export interface ChatMarkdownRuntimeProps extends ChatMarkdownProps {
  createPlugins?: (singleDollarMath: boolean) => PluginConfig
}

const createDefaultPlugins = (singleDollarMath: boolean): PluginConfig => ({
  ...defaultMarkdownPlugins,
  math: withMath({ singleDollar: singleDollarMath })
})

const ChatMarkdownRuntime: FC<ChatMarkdownRuntimeProps> = ({
  block,
  inlineHtmlPreviewMode,
  postProcess,
  className,
  components,
  trustedCitations,
  createPlugins = createDefaultPlugins
}) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const actions = useOptionalMessageListActions()
  const isStreaming = block.status === 'streaming'
  const hasStreamedRef = useRef(isStreaming)
  if (isStreaming) hasStreamedRef.current = true

  const plugins = useMemo(() => createPlugins(mathEnableSingleDollar), [createPlugins, mathEnableSingleDollar])

  const content = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) return t('message.chat.completion.paused')
    if (block.status === 'streaming' && block.content.length > MAX_STREAMING_TRANSFORM_LENGTH) return block.content

    const transform = (source: string) => {
      let text = removeSvgEmptyLines(source)
      if (postProcess) text = postProcess(text)
      return text
    }
    return inlineHtmlPreviewMode
      ? transformMarkdownOutsideHtmlArtifacts(block.content, transform)
      : transform(block.content)
  }, [block.status, block.content, inlineHtmlPreviewMode, postProcess, t])

  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const citationRegistry = useMemo(() => {
    if (!trustedCitations?.length) return EMPTY_CITATION_REGISTRY
    return new Map(trustedCitations.map((citation) => [citation.number, citation]))
  }, [trustedCitations])
  const chatComponents = hasStyleElement ? CHAT_MARKDOWN_COMPONENTS_WITH_STYLE : CHAT_MARKDOWN_COMPONENTS
  const mergedComponents = useMemo(
    () => (components ? { ...chatComponents, ...components } : chatComponents),
    [chatComponents, components]
  )
  const footnoteLabel = t('common.footnotes')
  const remarkPlugins = inlineHtmlPreviewMode ? HTML_ARTIFACT_REMARK_PLUGINS : REMARK_PLUGINS
  // Relative markdown links are workspace files only when the host has the
  // workspace-aware artifact opener. Other chat surfaces retain link hardening.
  const canOpenWorkspaceFiles = Boolean(actions?.openArtifactFile)
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
  const renderer = hasStreamedRef.current ? (
    <StreamingMarkdown
      id={block.id}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={mergedComponents}
      footnoteLabel={footnoteLabel}
      animated={isStreaming && content.length <= MAX_ANIMATED_CONTENT_LENGTH ? undefined : false}
      parseIncompleteMarkdown={isStreaming}
      preserveFileLinkHrefs={canOpenWorkspaceFiles}>
      {content}
    </StreamingMarkdown>
  ) : (
    <Markdown
      id={block.id}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={mergedComponents}
      className={className}
      footnoteLabel={footnoteLabel}
      preserveFileLinkHrefs={canOpenWorkspaceFiles}>
      {content}
    </Markdown>
  )

  return (
    <ChatMarkdownRenderProvider
      blockId={block.id}
      citationRegistry={citationRegistry}
      inlineHtmlPreviewMode={inlineHtmlPreviewMode}
      isStreaming={isStreaming}
      openFilePath={openFilePath}>
      {renderer}
    </ChatMarkdownRenderProvider>
  )
}

export default ChatMarkdownRuntime
