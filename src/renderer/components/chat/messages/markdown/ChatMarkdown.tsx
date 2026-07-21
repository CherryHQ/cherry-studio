import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, type MarkdownSource, StreamingMarkdown, withChatPlugins } from '@cherrystudio/ui'
import {
  useMessageRenderConfig,
  useOptionalMessageListActions,
  useOptionalMessageListUi
} from '@renderer/components/chat/messages/MessageListProvider'
import { ClickableFilePath } from '@renderer/components/chat/messages/tools/shared/ClickableFilePath'
import { openFileTarget } from '@renderer/components/chat/messages/tools/shared/openFileTarget'
import { useMarkdownComponents } from '@renderer/components/markdown'
import { type MarkdownHost, MarkdownHostContext } from '@renderer/hooks/useMarkdownHost'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { isEmpty } from 'es-toolkit/compat'
import { type FC, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'

interface Props {
  block: MarkdownSource
  /** Pre-process the markdown content (e.g. citation tag injection). */
  postProcess?: (text: string) => string
  className?: string
  components?: Partial<Components>
}

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i

const ChatMarkdown: FC<Props> = ({ block, postProcess, className, components }) => {
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
      openFilePath: (path: string) =>
        openFileTarget(path, {
          openArtifactFile: actions?.openArtifactFile,
          openPath: actions?.openPath,
          isDirectory: actions?.isDirectory,
          onError: () => actions?.notifyError?.(t('chat.input.tools.open_file_error', { path }))
        }),
      renderInlineFilePath: (path: string) => <ClickableFilePath path={path} />
    }),
    [actions, ui?.readonly, codeFancyBlock, t]
  )

  // Keep the renderer type stable when an active text tail is sealed by a
  // later process part. Historical markdown still mounts the static renderer.
  if (hasStreamedRef.current) {
    return (
      <MarkdownHostContext value={markdownHost}>
        <StreamingMarkdown
          id={block.id}
          plugins={plugins}
          components={mergedComponents}
          footnoteLabel={footnoteLabel}
          animated={isStreaming ? undefined : false}
          parseIncompleteMarkdown={isStreaming}
          disableLinkHardening>
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
        components={mergedComponents}
        className={className}
        footnoteLabel={footnoteLabel}
        disableLinkHardening>
        {content}
      </Markdown>
    </MarkdownHostContext>
  )
}

export default ChatMarkdown
