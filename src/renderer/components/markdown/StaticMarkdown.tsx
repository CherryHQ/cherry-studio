import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, withFullMarkdown } from '@cherrystudio/ui'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { type FC, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { remarkFileLinks } from './remarkFileLinks'
import { useMarkdownComponents } from './useMarkdownComponents'

/** Stable identity so the memoized markdown block isn't invalidated each render. */
const REMARK_PLUGINS = [remarkFileLinks]

interface Props {
  children: string
  /** Stable id (heading-id prefix + block memo key). Defaults to a generated id. */
  id?: string
  className?: string
}

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i

/**
 * Non-streaming markdown rendered with the exact same plugins and component
 * overrides as chat messages (`ChatMarkdown`), minus the streaming path. Use for
 * off-chat previews — release notes, file preview, prompt preview, agent tool
 * output. It mounts no `MarkdownHost`, so its components run in their neutral,
 * action-less mode (no code-save / table-export / citation-open affordances).
 */
export const StaticMarkdown: FC<Props> = ({ children, id, className }) => {
  const { t } = useTranslation()
  const generatedId = useId()
  const blockId = id ?? generatedId

  const plugins = useMemo(() => withFullMarkdown(), [])
  const content = useMemo(() => removeSvgEmptyLines(processLatexBrackets(children)), [children])
  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const components = useMarkdownComponents({ blockId, hasStyleElement, isStreaming: false })

  return (
    <Markdown
      id={blockId}
      plugins={plugins}
      components={components}
      remarkPlugins={REMARK_PLUGINS}
      className={className}
      footnoteLabel={t('common.footnotes')}>
      {content}
    </Markdown>
  )
}
