import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, type MarkdownSource, StreamingMarkdown, withChatPlugins } from '@cherrystudio/ui'
import { MessageHtmlArtifact } from '@renderer/components/chat/messages/blocks/MessageHtmlArtifact'
import {
  useMessageRenderConfig,
  useOptionalMessageListActions,
  useOptionalMessageListUi
} from '@renderer/components/chat/messages/MessageListProvider'
import { ClickableFilePath } from '@renderer/components/chat/messages/tools/shared/ClickableFilePath'
import { useMarkdownComponents } from '@renderer/components/markdown'
import { type MarkdownHost, MarkdownHostContext } from '@renderer/hooks/useMarkdownHost'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { openFileTarget } from '@renderer/utils/openFileTarget'
import { isEmpty } from 'es-toolkit/compat'
import { type FC, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'
import type { Pluggable } from 'unified'

import { remarkHtmlArtifact } from './plugins/remarkHtmlArtifact'

export type InlineHtmlPreviewMode = 'generating' | 'ready'

interface Props {
  block: MarkdownSource
  inlineHtmlPreviewMode?: InlineHtmlPreviewMode
  /** Pre-process the markdown content (e.g. citation tag injection). */
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
}

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i
const HTML_ARTIFACT_REMARK_PLUGINS: Pluggable[] = [remarkHtmlArtifact]

const ChatMarkdown: FC<Props> = ({ block, inlineHtmlPreviewMode, postProcess, className, components }) => {
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
    let text = removeSvgEmptyLines(processLatexBrackets(block.content))
    if (postProcess) text = postProcess(text)
    return text
  }, [block.status, block.content, postProcess, t])

  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const chatComponents = useMarkdownComponents({ blockId: block.id, hasStyleElement, isStreaming })
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
              isDirectory: actions.isDirectory,
              onError: () => actions.notifyError?.(t('chat.input.tools.open_file_error', { path }))
            })
        : undefined,
      renderInlineFilePath: (path: string) => <ClickableFilePath path={path} />,
      // Chat renders assistant HTML fences as an immersive inline preview; the shared
      // CodeBlock stays chat-agnostic and asks the host to draw it.
      renderHtmlArtifact: inlineHtmlPreviewMode
        ? (html, { isStreaming: htmlStreaming }) => (
            <MessageHtmlArtifact html={html} isStreaming={htmlStreaming || inlineHtmlPreviewMode === 'generating'} />
          )
        : undefined
    }),
    [actions, ui?.readonly, codeFancyBlock, t, inlineHtmlPreviewMode]
  )

  // Keep the renderer type stable when an active text tail is sealed by a
  // later process part. Historical markdown still mounts the static renderer.
  if (hasStreamedRef.current) {
    return (
      <MarkdownHostContext value={markdownHost}>
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
      </MarkdownHostContext>
    )
  }
  return (
    <MarkdownHostContext value={markdownHost}>
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
    </MarkdownHostContext>
  )
}

export default ChatMarkdown
