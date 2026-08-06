import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, type MarkdownSource, StreamingMarkdown, withChatPlugins } from '@cherrystudio/ui'
import {
  useMessageRenderConfig,
  useOptionalMessageListActions
} from '@renderer/components/chat/messages/MessageListProvider'
import type { Citation } from '@renderer/types/message'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { openFileTarget } from '@renderer/utils/openFileTarget'
import { isEmpty } from 'es-toolkit/compat'
import { type FC, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'
import type { Pluggable } from 'unified'

import { HtmlArtifactPopupHost } from '../../HtmlArtifactView'
import { ChatMarkdownRenderProvider } from './ChatMarkdownRenderContext'
import { CHAT_MARKDOWN_COMPONENTS, CHAT_MARKDOWN_COMPONENTS_WITH_STYLE } from './ChatMarkdownRenderers'
import { remarkHtmlArtifact, transformMarkdownOutsideHtmlArtifacts } from './plugins/remarkHtmlArtifact'

interface Props {
  block: MarkdownSource
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  /** Pre-process the markdown content (e.g. citation tag injection). */
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
  trustedCitations?: readonly Citation[]
}

export type InlineHtmlPreviewMode = 'generating' | 'ready'

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const HTML_ARTIFACT_REMARK_PLUGINS: Pluggable[] = [remarkHtmlArtifact]
const EMPTY_CITATION_REGISTRY: ReadonlyMap<number, Citation> = new Map()

const ChatMarkdown: FC<Props> = ({
  block,
  inlineHtmlPreviewMode,
  postProcess,
  className,
  components,
  trustedCitations
}) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const actions = useOptionalMessageListActions()
  const isStreaming = block.status === 'streaming'
  const hasStreamedRef = useRef(isStreaming)
  if (isStreaming) hasStreamedRef.current = true

  const plugins = useMemo(() => withChatPlugins({ singleDollarMath: mathEnableSingleDollar }), [mathEnableSingleDollar])

  const content = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    const transform = (source: string) => {
      let text = removeSvgEmptyLines(processLatexBrackets(source))
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
  const remarkPlugins = inlineHtmlPreviewMode ? HTML_ARTIFACT_REMARK_PLUGINS : undefined

  // Only intercept schemeless markdown links as workspace files when the host can actually
  // resolve+open them: openArtifactFile is the workspace-aware opener (agent sessions with an
  // artifact pane). Surfaces without it — Home chat, Quick Assistant, the selection window —
  // must not intercept (dead/no-op or wrong-CWD open), and keep Streamdown's link hardening.
  const canOpenWorkspaceFiles = !!actions?.openArtifactFile
  const openFilePath = useMemo(
    () =>
      actions?.openArtifactFile
        ? (path: string) =>
            openFileTarget(path, {
              openArtifactFile: actions.openArtifactFile,
              openPath: actions.openPath,
              onError: () => actions.notifyError?.(t('chat.input.tools.open_file_error', { path }))
            })
        : undefined,
    [actions, t]
  )

  // Keep the renderer type stable when an active text tail is sealed by a
  // later process part. Historical markdown still mounts the static renderer.
  const renderer = hasStreamedRef.current ? (
    <StreamingMarkdown
      id={block.id}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      components={mergedComponents}
      footnoteLabel={footnoteLabel}
      animated={isStreaming ? undefined : false}
      parseIncompleteMarkdown={isStreaming}
      disableLinkHardening={canOpenWorkspaceFiles}>
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
      disableLinkHardening={canOpenWorkspaceFiles}>
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
      {inlineHtmlPreviewMode ? <HtmlArtifactPopupHost>{renderer}</HtmlArtifactPopupHost> : renderer}
    </ChatMarkdownRenderProvider>
  )
}

export default ChatMarkdown
