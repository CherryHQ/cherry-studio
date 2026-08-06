import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, withFullMarkdown } from '@cherrystudio/ui'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { type FC, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  children: string
  /** Stable id (heading-id prefix + block memo key). Defaults to a generated id. */
  id?: string
  className?: string
}

/**
 * Non-streaming markdown for off-chat surfaces — release notes, the update dialog,
 * prompt preview, agent tool output. Renders through `@cherrystudio/ui`'s `<Markdown>`
 * with the full plugin preset and the app sanitize schema, replacing bare `<Streamdown>`
 * call sites so every preview shares one pipeline.
 *
 * It uses the default component set: chat-only overrides (code-save, table export,
 * citations, file-link opening) live in `ChatMarkdown` and require the chat message
 * context (`MessageListProvider` / `ChatMarkdownRenderProvider`), so they are
 * intentionally absent here — mirroring the built-in `MarkdownFilePreview`.
 */
export const StaticMarkdown: FC<Props> = ({ children, id, className }) => {
  const { t } = useTranslation()
  const generatedId = useId()
  const blockId = id ?? generatedId

  const plugins = useMemo(() => withFullMarkdown(), [])
  const content = useMemo(() => removeSvgEmptyLines(processLatexBrackets(children)), [children])

  return (
    <Markdown id={blockId} plugins={plugins} className={className} footnoteLabel={t('common.footnotes')}>
      {content}
    </Markdown>
  )
}
