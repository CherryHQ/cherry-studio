import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, type MarkdownSource, StreamingMarkdown, withChatPlugins } from '@cherrystudio/ui'
import { MessageHtmlArtifact } from '@renderer/components/chat/messages/blocks/MessageHtmlArtifact'
import {
  useMessageRenderConfig,
  useOptionalMessageListActions,
  useOptionalMessageListUi
} from '@renderer/components/chat/messages/MessageListProvider'
import { ClickableFilePath } from '@renderer/components/chat/messages/tools/shared/ClickableFilePath'
import { CodeBlockView } from '@renderer/components/CodeBlockView/CodeBlockView'
import { MAX_COLLAPSED_CODE_HEIGHT } from '@renderer/components/CodeBlockView/constants'
import { useMarkdownComponents } from '@renderer/components/markdown'
import { type MarkdownHost, MarkdownHostContext } from '@renderer/hooks/useMarkdownHost'
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
import {
  classifyHtmlArtifactSource,
  remarkHtmlArtifact,
  transformMarkdownOutsideHtmlArtifacts
} from './plugins/remarkHtmlArtifact'

export type InlineHtmlPreviewMode = 'generating' | 'ready'

interface Props {
  block: MarkdownSource
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  /** Pre-process the markdown content (e.g. citation tag injection). */
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
  trustedCitations?: readonly Citation[]
}

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const HTML_ARTIFACT_REMARK_PLUGINS: Pluggable[] = [remarkHtmlArtifact]

const ChatMarkdown: FC<Props> = ({
  block,
  inlineHtmlPreviewMode,
  postProcess,
  className,
  components,
  trustedCitations
}) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar, codeFancyBlock } = useMessageRenderConfig()
  const actions = useOptionalMessageListActions()
  const ui = useOptionalMessageListUi()
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
  const citationRegistry = useMemo(
    () => new Map((trustedCitations ?? []).map((citation) => [citation.number, citation])),
    [trustedCitations]
  )
  const chatComponents = useMarkdownComponents({ blockId: block.id, hasStyleElement, isStreaming, citationRegistry })
  const mergedComponents = useMemo(
    () => (components ? { ...chatComponents, ...components } : chatComponents),
    [chatComponents, components]
  )

  const footnoteLabel = t('common.footnotes')
  const remarkPlugins = inlineHtmlPreviewMode ? HTML_ARTIFACT_REMARK_PLUGINS : undefined

  // Only intercept schemeless markdown links as workspace files when the host can actually
  // resolve+open them: `openArtifactFile` is the workspace-aware opener (agent sessions with
  // an artifact pane). Surfaces without it — Home chat, Quick Assistant, the selection window —
  // have no workspace base, so they must not intercept (dead/no-op or wrong-CWD open).
  const canOpenWorkspaceFiles = !!actions?.openArtifactFile

  // Bridge the chat message list's actions/config into the domain-neutral
  // MarkdownHost the shared markdown components read from.
  const markdownHost = useMemo<MarkdownHost>(
    () => ({
      codeFancyBlock,
      readonly: ui?.readonly,
      saveCodeBlock: actions?.saveCodeBlock,
      openExternalUrl: actions?.openExternalUrl,
      copyRichContent: actions?.copyRichContent,
      exportTableAsExcel: actions?.exportTableAsExcel,
      notifySuccess: actions?.notifySuccess,
      notifyError: actions?.notifyError,
      openFilePath: actions?.openArtifactFile
        ? (path: string) =>
            openFileTarget(path, {
              openArtifactFile: actions.openArtifactFile,
              openPath: actions.openPath,
              onError: () => actions.notifyError?.(t('chat.input.tools.open_file_error', { path }))
            })
        : undefined,
      renderInlineFilePath: (path: string) => <ClickableFilePath path={path} />,
      // Chat renders assistant HTML fences as an immersive inline preview; the shared CodeBlock
      // stays chat-agnostic and asks the host to draw it. Classification picks the streaming
      // surface (collapsed source for a full document, live artifact for a fragment) and travels
      // down as `kind` to gate safety once complete.
      renderHtmlArtifact: inlineHtmlPreviewMode
        ? (html, { isStreaming: htmlStreaming, artifactId, editable, onSave }) => {
            const streaming = htmlStreaming || inlineHtmlPreviewMode === 'generating'
            const htmlKind = classifyHtmlArtifactSource(html)
            // Too short to classify yet — render nothing rather than pick a surface we would
            // have to swap out a few characters later.
            if (streaming && htmlKind === undefined) return null
            if (streaming && htmlKind === 'document') {
              return (
                <CodeBlockView
                  language="html"
                  editable={false}
                  isStreaming
                  maxHeight={MAX_COLLAPSED_CODE_HEIGHT}
                  showToolbar={false}>
                  {html}
                </CodeBlockView>
              )
            }
            return (
              <MessageHtmlArtifact
                artifactId={artifactId}
                html={html}
                onSave={onSave}
                editable={editable}
                kind={htmlKind ?? 'fragment'}
                isStreaming={streaming}
              />
            )
          }
        : undefined
    }),
    [actions, ui?.readonly, codeFancyBlock, t, inlineHtmlPreviewMode]
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
    <MarkdownHostContext value={markdownHost}>
      {inlineHtmlPreviewMode ? <HtmlArtifactPopupHost>{renderer}</HtmlArtifactPopupHost> : renderer}
    </MarkdownHostContext>
  )
}

export default ChatMarkdown
